import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HermesApiError,
  type HermesApiClient,
  type HermesRequestOptions,
} from '../src/api/HermesApiClient';
import { ConversationSyncGeneration } from '../src/api/conversation-sync-generation';
import { conversationOwnerDeletionKey } from '../src/api/conversation-draft-repository';
import { selectReadyHostedTurnOutboxItems } from '../src/api/conversation-hosted-turn-outbox';
import {
  HermesCloudApi,
  officialConversationPlaceholderId,
  type SingleConversation,
} from '../src/api/HermesCloudApi';
import {
  ConversationLocalStore,
  mergeDownloadedConversations,
  reconcileConversationCache,
  synchronizeConversationCache,
} from '../src/api/conversation-local-store';
import { decideHostedTurnCancellationFailure } from '../src/api/hosted-turn-delivery-state';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../src/api/conversation-storage-coordinator';

class MemoryStorage {
  readonly values = new Map<string, string>();
  readonly removeFailures = new Set<string>();
  readonly setFailureSubstrings = new Set<string>();
  readonly setCalls: string[] = [];

  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  async removeItem(key: string) {
    if (this.removeFailures.has(key)) throw new Error('storage cleanup failed');
    this.values.delete(key);
  }

  async setItem(key: string, value: string) {
    if ([...this.setFailureSubstrings].some((part) => key.includes(part))) {
      throw new Error('storage write failed');
    }
    this.setCalls.push(key);
    this.values.set(key, value);
  }
}

/**
 * No stored key belongs to two accounts.
 *
 * Owner keys are a reversible hex encoding of the lowercased owner, and every
 * key for an account (index and rows alike) is prefixed with it — so an
 * account's keys are exactly those containing its encoding. The v1 owner HASH
 * collided across accounts, which is the bug this guards; asserting
 * disjointness states that property directly instead of inferring it from a
 * total key count, which now moves whenever the shard layout changes.
 */
function assertOwnerKeysDisjoint(storage: MemoryStorage, owners: readonly string[]): void {
  const encode = (owner: string) => `u${Array.from(owner.toLowerCase())
    .map((character) => character.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')}`;
  const seen = new Map<string, string>();
  for (const owner of owners) {
    const encoded = encode(owner);
    const keys = [...storage.values.keys()].filter((key) => key.includes(encoded));
    assert.ok(keys.length > 0, `no stored keys for ${owner}`);
    for (const key of keys) {
      const other = seen.get(key);
      assert.equal(other, undefined, `key ${key} is shared by ${other} and ${owner}`);
      seen.set(key, owner);
    }
  }
}

function conversation(
  id: string,
  updatedAt: number,
  messages: SingleConversation['messages'],
  messageCount = messages.length,
): SingleConversation {
  return {
    id,
    profile: 'default',
    title: id,
    messages,
    message_count: messageCount,
    runtime_sessions: {},
    updated_at: updatedAt,
  };
}

function hostedTurnFixture(
  requestId: string,
  conversationId = 'conversation-1',
) {
  const message = {
    content: 'queued text',
    created_at: 100,
    id: requestId,
    name: 'You',
    role: 'user' as const,
    status: 'completed' as const,
  };
  return {
    item: {
      attempts: 0,
      conversationId,
      conversationProfile: 'default',
      conversationTitle: 'Queued turn',
      draftClaim: {
        attachments: [{ id: 'draft-file-1', uri: 'file:///cache/draft-file.txt' }],
        content: 'queued text',
        requestId,
      },
      input: {
        attachmentIds: [],
        message,
        profiles: ['default'],
        recentMessages: [{ content: message.content, role: message.role }],
        requestId,
        turnId: `turn-${requestId}`,
      },
      pendingAttachments: [{
        id: 'upload-file-1',
        kind: 'file' as const,
        name: 'draft-file.txt',
        ownedTemporary: true,
        sourceUri: 'file:///cache/draft-file.txt',
        uri: `file:///outbox/${requestId}/draft-file.txt.hermes-encrypted`,
      }],
      queuedAt: 100,
    },
    message,
    pendingTurn: {
      attempt: 0,
      phase: 'thinking' as const,
      phaseStartedAt: 100,
      turnId: `turn-${requestId}`,
      updatedAt: 100,
      userMessageId: requestId,
    },
  };
}

test('conversation index refreshes never invalidate an active conversation stream generation', () => {
  const generations = new ConversationSyncGeneration();
  const activeGeneration = generations.advanceActive();
  const firstIndexGeneration = generations.advanceIndex();

  assert.equal(generations.isActiveCurrent(activeGeneration), true);
  assert.equal(generations.isIndexCurrent(firstIndexGeneration), true);

  const secondIndexGeneration = generations.advanceIndex();
  assert.equal(generations.isActiveCurrent(activeGeneration), true);
  assert.equal(generations.isIndexCurrent(firstIndexGeneration), false);
  assert.equal(generations.isIndexCurrent(secondIndexGeneration), true);

  generations.advanceActive();
  assert.equal(generations.isActiveCurrent(activeGeneration), false);
});

test('hosted cancellation retries transport failures but only settles explicit terminal statuses', () => {
  const now = 1_000;
  const retry = decideHostedTurnCancellationFailure(
    new HermesApiError(503, 'unavailable'),
    0,
    now,
  );
  assert.equal(retry.outcome, 'retry');
  assert.equal(retry.attempts, 1);
  assert.equal(retry.nextAttemptAt, 61_000);

  for (const status of [404, 409, 410]) {
    assert.equal(
      decideHostedTurnCancellationFailure(
        new HermesApiError(status, 'already settled'),
        0,
        now,
      ).outcome,
      'settled',
    );
  }

  for (const status of [400, 401, 403, 422]) {
    assert.equal(
      decideHostedTurnCancellationFailure(
        new HermesApiError(status, 'not cancelled'),
        0,
        now,
      ).outcome,
      'failed',
    );
  }

  const exhausted = decideHostedTurnCancellationFailure(
    new HermesApiError(503, 'still unavailable'),
    4,
    now,
  );
  assert.equal(exhausted.outcome, 'failed');
  assert.equal(exhausted.attempts, 5);
});

test('local conversation history is isolated by server account and restores the active chat', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const ownerA = 'https://example.test|owner-a@example.test';
  const ownerB = 'https://example.test|owner-b@example.test';
  const chatA = conversation('chat-a', 10, [
    { id: 'a-1', role: 'user', name: '你', content: 'A 的本地历史' },
  ]);
  const chatB = conversation('chat-b', 20, [
    { id: 'b-1', role: 'user', name: '你', content: 'B 的本地历史' },
  ]);

  await store.write(ownerA, [chatA], chatA.id);
  await store.write(ownerB, [chatB], chatB.id);

  const restoredA = await store.read(ownerA.toUpperCase());
  const restoredB = await store.read(ownerB);
  // v4 shards each account into one index plus one row per conversation, so
  // two single-chat accounts occupy 2 keys each (was 1 blob each under v3).
  // The property under test is isolation, not the count — assert that
  // directly so a future re-shard updates one number, not the guarantee.
  assert.equal(storage.values.size, 4);
  assertOwnerKeysDisjoint(storage, [ownerA, ownerB]);
  assert.equal(restoredA?.activeConversationId, 'chat-a');
  assert.equal(restoredA?.conversations[0].messages[0].content, 'A 的本地历史');
  assert.equal(restoredB?.activeConversationId, 'chat-b');
  assert.equal(restoredB?.conversations[0].messages[0].content, 'B 的本地历史');
});

test('local account keys remain isolated for owners that collide under the legacy hash', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const ownerA = 'owner-1i52j08-1jc8';
  const ownerB = 'owner-1t58hz4-3eq8';
  const chatA = conversation('collision-a', 10, [
    { id: 'a', role: 'user', name: '你', content: '账户 A' },
  ]);
  const chatB = conversation('collision-b', 20, [
    { id: 'b', role: 'user', name: '你', content: '账户 B' },
  ]);

  await store.write(ownerA, [chatA], chatA.id);
  await store.write(ownerB, [chatB], chatB.id);

  // 2 keys per account under v4 (index + one row) — see the isolation test
  // above. The legacy-hash collision this guards is about key OWNERSHIP, so
  // the disjointness assertion is the one that must never weaken.
  assert.equal(storage.values.size, 4);
  assertOwnerKeysDisjoint(storage, [ownerA, ownerB]);
  assert.equal((await store.read(ownerA))?.conversations[0].id, 'collision-a');
  assert.equal((await store.read(ownerB))?.conversations[0].id, 'collision-b');
});

test('v1 and v2 conversation caches are deleted and ignored after the clean schema bump', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'legacy-owner';
  const encodedOwner = `u${Array.from(owner)
    .map((character) => character.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')}`;
  let hash = 0x811c9dc5;
  for (const character of owner) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  storage.values.set(`hermes.native.conversations.v1.${(hash >>> 0).toString(16)}`, JSON.stringify({
    version: 1,
    owner,
    activeConversationId: 'legacy-chat',
    conversations: [conversation('legacy-chat', 10, [])],
    syncedAt: 10,
  }));
  storage.values.set(`hermes.native.conversations.v2.${encodedOwner}`, JSON.stringify({
    version: 2,
    owner,
    activeConversationId: 'e2e-contamination',
    conversations: [conversation('e2e-contamination', 20, [
      { id: 'e2e-message', role: 'user', name: '你', content: 'test fixture' },
    ])],
    syncedAt: 20,
  }));

  assert.equal(await store.read(owner), null);
  assert.equal(storage.values.size, 0);
});

test('legacy cleanup failure never blocks the clean cache or subsequent cloud sync', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'cleanup-failure-owner';
  const encodedOwner = `u${Array.from(owner)
    .map((character) => character.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')}`;
  const previousKey = `hermes.native.conversations.v2.${encodedOwner}`;
  storage.values.set(previousKey, 'contaminated-v2');
  storage.removeFailures.add(previousKey);

  assert.equal(await store.read(owner), null);
  assert.equal(storage.values.get(previousKey), 'contaminated-v2');
  const synchronized = await synchronizeConversationCache({
    async getUnifiedConversations() {
      return { conversations: [] };
    },
  } as unknown as HermesCloudApi, store, owner);
  assert.deepEqual(synchronized.conversations, []);
  assert.deepEqual((await store.read(owner))?.conversations, []);
});

test('hosted-turn outbox is owner-isolated, idempotently replaced, and removed after acknowledgement', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const ownerA = 'https://example.test|owner-a@example.test';
  const ownerB = 'https://example.test|owner-b@example.test';
  const pending = {
    conversationId: 'conversation-1',
    conversationPending: true,
    conversationProfile: 'reviewer',
    conversationTitle: 'Durable upload',
    input: {
      attachmentIds: ['file-1'],
      message: {
        content: '继续任务',
        id: 'user-stable-1',
        name: '你',
        role: 'user',
      },
      recentMessages: [{ role: 'assistant', content: '已准备。' }],
      requestId: 'request-stable-1',
      turnId: 'turn-stable-1',
    },
    pendingAttachments: [{
      id: 'upload-stable-1',
      kind: 'file' as const,
      mimeType: 'text/plain',
      name: 'input.txt',
      size: 12,
      uri: 'file:///documents/hermes-outbox/input.txt',
      uploaded: { id: 'file-cloud-1', status: 'available' },
    }],
    queuedAt: 100,
  };

  await store.upsertPendingEnqueue(ownerA, pending);
  await store.upsertPendingEnqueue(ownerA, { ...pending, queuedAt: 200 });
  await store.upsertPendingEnqueue(ownerB, {
    ...pending,
    conversationId: 'conversation-2',
  });

  const ownerAPending = await store.readPendingEnqueues(ownerA.toUpperCase());
  assert.equal(ownerAPending.length, 1);
  assert.equal(ownerAPending[0].queuedAt, 200);
  assert.equal(ownerAPending[0].input.requestId, 'request-stable-1');
  assert.equal(ownerAPending[0].conversationPending, true);
  assert.equal(ownerAPending[0].conversationProfile, 'reviewer');
  assert.equal(ownerAPending[0].pendingAttachments?.[0].id, 'upload-stable-1');
  assert.equal(ownerAPending[0].pendingAttachments?.[0].uploaded?.id, 'file-cloud-1');
  assert.equal((await store.readPendingEnqueues(ownerB))[0].conversationId, 'conversation-2');

  await store.removePendingEnqueue(ownerA, 'request-stable-1');
  assert.deepEqual(await store.readPendingEnqueues(ownerA), []);
  assert.equal((await store.readPendingEnqueues(ownerB)).length, 1);
});

test('hosted-turn replay skips a delayed conversation without reordering that conversation', () => {
  const delayed = {
    ...hostedTurnFixture('request-a1', 'conversation-a').item,
    nextAttemptAt: 10_000,
    queuedAt: 100,
  };
  const sameConversationLater = {
    ...hostedTurnFixture('request-a2', 'conversation-a').item,
    queuedAt: 200,
  };
  const ready = {
    ...hostedTurnFixture('request-b1', 'conversation-b').item,
    queuedAt: 300,
  };
  const cancellation = {
    ...hostedTurnFixture('request-c1', 'conversation-c').item,
    cancelledAt: 400,
    queuedAt: 400,
  };

  const selected = selectReadyHostedTurnOutboxItems(
    [delayed, sameConversationLater, ready, cancellation],
    1_000,
  );

  assert.deepEqual(
    selected.map((item) => item.input.requestId),
    ['request-c1', 'request-b1'],
  );
});

test('hosted-turn delivery leases fence dual workers and recover after expiry', async () => {
  const storage = new MemoryStorage();
  const owner = 'https://example.test|lease@example.test';
  const firstProcess = new ConversationLocalStore(storage);
  await firstProcess.upsertPendingEnqueue(
    owner,
    hostedTurnFixture('request-leased', 'conversation-leased').item,
  );

  const firstClaim = await firstProcess.claimReadyPendingEnqueues(
    owner,
    'worker-1',
    1_000,
    1_000,
  );
  const competingClaim = await new ConversationLocalStore(storage)
    .claimReadyPendingEnqueues(owner, 'worker-2', 1_500, 1_000);

  assert.equal(firstClaim.length, 1);
  assert.deepEqual(competingClaim, []);

  const recoveredClaim = await new ConversationLocalStore(storage)
    .claimReadyPendingEnqueues(owner, 'worker-2', 2_001, 1_000);
  assert.equal(recoveredClaim.length, 1);
  assert.notEqual(
    recoveredClaim[0].deliveryLeaseToken,
    firstClaim[0].deliveryLeaseToken,
  );
  assert.equal((await firstProcess.upsertPendingEnqueueIfActive(owner, {
    ...firstClaim[0],
    lastError: 'late worker result',
  })).updated, false);
  assert.equal(
    await firstProcess.removePendingEnqueueIfLeaseOwned(owner, firstClaim[0]),
    false,
  );
  assert.equal(
    await firstProcess.releasePendingEnqueueLease(owner, firstClaim[0]),
    false,
  );
  assert.equal(
    await firstProcess.releasePendingEnqueueLease(owner, recoveredClaim[0]),
    true,
  );
  assert.equal(
    (await firstProcess.claimReadyPendingEnqueues(owner, 'worker-3', 2_002)).length,
    1,
  );
});

test('foreground cancellation cannot bypass an active replay lease', async () => {
  const storage = new MemoryStorage();
  const owner = 'https://example.test|cancel-lease@example.test';
  const store = new ConversationLocalStore(storage);
  const cancellation = {
    ...hostedTurnFixture('cancel-turn-1', 'conversation-1').item,
    cancelledAt: 1_000,
    purpose: 'hosted-turn-cancel' as const,
  };
  await store.upsertPendingEnqueue(owner, cancellation);

  const replayClaim = await store.claimPendingEnqueueByRequest(
    owner,
    cancellation.input.requestId,
    'replay-worker',
    2_000,
    1_000,
  );
  const foregroundClaim = await new ConversationLocalStore(storage)
    .claimPendingEnqueueByRequest(
      owner,
      cancellation.input.requestId,
      'foreground-worker',
      2_500,
      1_000,
    );

  assert.ok(replayClaim?.deliveryLeaseToken);
  assert.equal(foregroundClaim, null);
  await store.releasePendingEnqueueLease(owner, replayClaim!);
  assert.ok(await store.claimPendingEnqueueByRequest(
    owner,
    cancellation.input.requestId,
    'foreground-worker',
    2_501,
    1_000,
  ));
});

test('hosted-turn initialization exposes a durable intent when the optimistic ledger write fails', async () => {
  const storage = new MemoryStorage();
  storage.setFailureSubstrings.add('optimistic-messages');
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|ledger-failure@example.test';
  const fixture = hostedTurnFixture('request-ledger-failure');

  const result = await store.initializePendingEnqueue(
    owner,
    fixture.item,
    [fixture.message],
    fixture.pendingTurn,
  );

  assert.equal(result.durable, true);
  assert.equal(result.updated, true);
  assert.equal(result.recovery, 'optimistic-ledger-replay');
  assert.equal(result.item?.input.requestId, fixture.item.input.requestId);
  assert.equal((await store.readPendingEnqueues(owner)).length, 1);
  assert.deepEqual(await store.readOptimisticConversations(owner), []);
});

test('a failed first outbox write leaves the original draft and attachment claim intact', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|outbox-failure@example.test';
  const fixture = hostedTurnFixture('request-outbox-failure');
  await store.writeDraft(owner, fixture.item.conversationId, 'queued text', [{
    draftPersistent: true,
    id: 'draft-file-1',
    kind: 'file',
    name: 'draft-file.txt',
    ownedTemporary: true,
    uri: 'file:///cache/draft-file.txt',
  }]);
  storage.setFailureSubstrings.add('hosted-turn-outbox');

  await assert.rejects(() => store.initializePendingEnqueue(
    owner,
    fixture.item,
    [fixture.message],
    fixture.pendingTurn,
  ), /storage write failed/);

  assert.deepEqual(await store.readPendingEnqueues(owner), []);
  const recovered = await store.readDraft(owner, fixture.item.conversationId);
  assert.equal(recovered?.content, 'queued text');
  assert.equal(recovered?.attachments[0]?.uri, 'file:///cache/draft-file.txt');
});

test('initialization recovers an outbox write committed before its adapter reports failure', async () => {
  let interruptNextOutboxWrite = true;
  const storage = new class extends MemoryStorage {
    override async setItem(key: string, value: string) {
      if (interruptNextOutboxWrite && key.includes('hosted-turn-outbox')) {
        interruptNextOutboxWrite = false;
        this.values.set(key, value);
        throw new Error('storage acknowledgement interrupted');
      }
      return super.setItem(key, value);
    }
  }();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|ambiguous-write@example.test';
  const fixture = hostedTurnFixture('request-ambiguous-write');

  const result = await store.initializePendingEnqueue(
    owner,
    fixture.item,
    [fixture.message],
    fixture.pendingTurn,
  );

  assert.equal(result.durable, true);
  assert.equal(result.updated, true);
  assert.equal(result.recovery, 'none');
  assert.equal((await store.readPendingEnqueues(owner)).length, 1);
});

test('restart consumes only the draft snapshot claimed by a durable hosted turn', async () => {
  const storage = new MemoryStorage();
  const owner = 'https://example.test|restart-window@example.test';
  const fixture = hostedTurnFixture('request-restart-window');
  const firstProcess = new ConversationLocalStore(storage);
  await firstProcess.writeDraft(owner, fixture.item.conversationId, 'queued text', [{
    draftPersistent: true,
    id: 'draft-file-1',
    kind: 'file',
    name: 'draft-file.txt',
    ownedTemporary: true,
    uri: 'file:///cache/draft-file.txt',
  }]);
  await firstProcess.initializePendingEnqueue(
    owner,
    fixture.item,
    [fixture.message],
    fixture.pendingTurn,
  );

  const restartedBeforeDraftClear = new ConversationLocalStore(storage);
  assert.equal(
    await restartedBeforeDraftClear.readDraft(owner, fixture.item.conversationId),
    null,
  );
  assert.equal((await restartedBeforeDraftClear.readPendingEnqueues(owner)).length, 1);

  await restartedBeforeDraftClear.writeDraft(
    owner,
    fixture.item.conversationId,
    'new text typed after enqueue',
  );
  const restartedWithNewerDraft = new ConversationLocalStore(storage);
  assert.equal(
    (await restartedWithNewerDraft.readDraft(owner, fixture.item.conversationId))?.content,
    'new text typed after enqueue',
  );
  await restartedWithNewerDraft.removePendingEnqueue(owner, fixture.item.input.requestId);
  assert.equal(
    (await new ConversationLocalStore(storage).readDraft(
      owner,
      fixture.item.conversationId,
    ))?.content,
    'new text typed after enqueue',
  );
});

test('outbox removal clears its claimed draft before an interrupted outbox delete', async () => {
  const storage = new MemoryStorage();
  const owner = 'https://example.test|remove-window@example.test';
  const fixture = hostedTurnFixture('request-remove-window');
  const store = new ConversationLocalStore(storage);
  await store.writeDraft(owner, fixture.item.conversationId, 'queued text', [{
    draftPersistent: true,
    id: 'draft-file-1',
    kind: 'file',
    name: 'draft-file.txt',
    ownedTemporary: true,
    uri: 'file:///cache/draft-file.txt',
  }]);
  await store.initializePendingEnqueue(
    owner,
    fixture.item,
    [fixture.message],
    fixture.pendingTurn,
  );
  storage.setFailureSubstrings.add('hosted-turn-outbox');

  await assert.rejects(
    () => store.removePendingEnqueue(owner, fixture.item.input.requestId),
    /storage write failed/,
  );

  const restarted = new ConversationLocalStore(storage);
  assert.equal(await restarted.readDraft(owner, fixture.item.conversationId), null);
  assert.equal((await restarted.readPendingEnqueues(owner)).length, 1);
});

test('hosted intervention intent is durable, owner-isolated, and rebuilds the optimistic message', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const ownerA = 'https://example.test|owner-a@example.test';
  const ownerB = 'https://example.test|owner-b@example.test';
  const intervention = {
    attempts: 0,
    content: '@Hermes Worker 检查边界',
    conversationId: 'conversation-1',
    message: {
      content: '@Hermes Worker 检查边界',
      created_at: 100,
      id: 'intervention-stable-1',
      name: '你',
      role: 'user',
      status: 'completed',
    },
    messageId: 'intervention-stable-1',
    nextAttemptAt: 0,
    queuedAt: 100,
    turnId: 'turn-1',
  };

  const first = await store.initializePendingIntervention(ownerA, intervention);
  const duplicate = await store.initializePendingIntervention(ownerA.toUpperCase(), {
    ...intervention,
    queuedAt: 200,
  });
  await store.initializePendingIntervention(ownerB, {
    ...intervention,
    conversationId: 'conversation-2',
  });

  assert.equal(first.updated, true);
  assert.equal(duplicate.updated, false);
  assert.equal((await store.readPendingInterventions(ownerA))[0].queuedAt, 100);
  assert.equal((await store.readPendingInterventions(ownerB))[0].conversationId, 'conversation-2');
  assert.equal(
    (await store.readOptimisticConversations(ownerA))[0].messages[0].id,
    intervention.messageId,
  );

  await store.upsertPendingIntervention(ownerA, {
    ...intervention,
    attempts: 1,
    lastError: 'offline',
    nextAttemptAt: 60_100,
  });
  assert.equal((await store.readPendingInterventions(ownerA))[0].attempts, 1);
  await store.removePendingIntervention(ownerA, intervention.messageId);
  assert.deepEqual(await store.readPendingInterventions(ownerA), []);
  assert.equal((await store.readPendingInterventions(ownerB)).length, 1);
});

test('hosted intervention remains accepted when the secondary optimistic ledger write fails', async () => {
  const storage = new MemoryStorage();
  storage.setFailureSubstrings.add('optimistic-messages');
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|owner@example.test';
  const intervention = {
    content: '@Hermes Worker 先核对边界',
    conversationId: 'conversation-1',
    message: {
      content: '@Hermes Worker 先核对边界',
      id: 'intervention-ledger-failure',
      name: '你',
      role: 'user',
    },
    messageId: 'intervention-ledger-failure',
    queuedAt: 100,
    turnId: 'turn-1',
  };

  const result = await store.initializePendingIntervention(owner, intervention);

  assert.equal(result.updated, true);
  assert.equal(result.item?.messageId, intervention.messageId);
  assert.equal((await store.readPendingInterventions(owner)).length, 1);

  storage.setFailureSubstrings.clear();
  await store.failPendingIntervention(owner, intervention, 'HTTP 409: turn completed');
  assert.deepEqual(await store.readPendingInterventions(owner), []);
  const failed = (await store.readOptimisticConversations(owner))[0].messages[0];
  assert.equal(failed.id, intervention.messageId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.meta?.delivery_error, 'HTTP 409: turn completed');
});

test('collaboration room outbox keeps one stable request until server acknowledgement', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const ownerA = 'https://example.test|owner-a@example.test';
  const ownerB = 'https://example.test|owner-b@example.test';
  const pending = {
    content: '并行检查并汇报',
    profiles: ['dbb3-worker', 'pc-worker'],
    queuedAt: 100,
    requestId: 'room-request-stable-1',
    roomId: 'room-1',
  };

  await store.upsertPendingRoomMessage(ownerA, pending);
  await store.upsertPendingRoomMessage(ownerA, { ...pending, queuedAt: 200 });
  await store.upsertPendingRoomMessage(ownerB, { ...pending, roomId: 'room-2' });

  const ownerAPending = await store.readPendingRoomMessages(ownerA.toUpperCase());
  assert.equal(ownerAPending.length, 1);
  assert.deepEqual(ownerAPending[0], { ...pending, queuedAt: 200 });
  assert.equal((await store.readPendingRoomMessages(ownerB))[0].roomId, 'room-2');

  await store.removePendingRoomMessage(ownerA, pending.requestId);
  assert.deepEqual(await store.readPendingRoomMessages(ownerA), []);
  assert.equal((await store.readPendingRoomMessages(ownerB)).length, 1);
});

test('account purge removes conversation and outbox keys while preserving attachment cleanup data', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|owner@example.test';
  const pending = {
    conversationId: 'conversation-delete',
    input: {
      attachmentIds: [],
      message: { content: 'delete me', id: 'message-delete', name: '你', role: 'user' },
      recentMessages: [],
      requestId: 'request-delete',
      turnId: 'turn-delete',
    },
    pendingAttachments: [{
      id: 'upload-delete',
      kind: 'file' as const,
      mimeType: 'text/plain',
      name: 'delete.txt',
      size: 6,
      uri: 'file:///documents/hermes-outbox/delete.txt',
    }],
    queuedAt: 100,
  };

  await store.write(owner, [conversation('conversation-delete', 1, [])], 'conversation-delete');
  await store.upsertPendingEnqueue(owner, pending);
  await store.upsertPendingRoomMessage(owner, {
    content: 'delete room message',
    profiles: ['default'],
    queuedAt: 100,
    requestId: 'room-delete',
    roomId: 'room-delete',
  });
  const normalizedOwner = owner.toLowerCase();
  const encodedOwner = `u${Array.from(normalizedOwner)
    .map((character) => character.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')}`;
  let legacyHash = 0x811c9dc5;
  for (const character of normalizedOwner) {
    legacyHash ^= character.charCodeAt(0);
    legacyHash = Math.imul(legacyHash, 0x01000193);
  }
  storage.values.set(`hermes.native.conversations.v1.${encodedOwner}`, 'legacy-v1');
  storage.values.set(`hermes.native.conversations.v2.${encodedOwner}`, 'legacy-v2');
  storage.values.set(
    `hermes.native.conversations.v1.${(legacyHash >>> 0).toString(16)}`,
    'legacy-hash',
  );

  const cleanup = await store.purge(owner);

  assert.equal(cleanup[0].pendingAttachments?.[0].uri, pending.pendingAttachments[0].uri);
  assert.equal(await store.read(owner), null);
  assert.deepEqual(await store.readPendingEnqueues(owner), []);
  assert.deepEqual(await store.readPendingRoomMessages(owner), []);
  assert.equal(storage.values.size, 0);

  // Successful deletion keeps a process-local fence but leaves no persistent
  // tombstone that could poison the next authenticated lifecycle.
  await store.writeDraft(owner, 'late-old-generation', 'must stay deleted');
  assert.equal(await store.readDraft(owner, 'late-old-generation'), null);
  await store.activate(owner);
  await store.writeDraft(owner, 'new-generation', 'preserve me');
  assert.equal((await store.readDraft(owner, 'new-generation'))?.content, 'preserve me');
  assert.equal(storage.values.has(conversationOwnerDeletionKey(owner)), false);
});

test('account purge retains retry metadata when attachment cleanup fails', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'owner-retry';
  await store.upsertPendingEnqueue(owner, {
    conversationId: 'conversation-retry',
    input: {
      attachmentIds: [],
      message: { content: 'retry', id: 'message-retry', name: '你', role: 'user' },
      recentMessages: [],
      requestId: 'request-retry',
      turnId: 'turn-retry',
    },
    pendingAttachments: [{
      id: 'upload-retry',
      kind: 'file',
      mimeType: 'text/plain',
      name: 'retry.txt',
      size: 5,
      uri: 'file:///documents/hermes-outbox/retry.txt',
    }],
    queuedAt: 100,
  });

  await assert.rejects(
    store.purge(owner, async () => { throw new Error('file busy'); }),
    /file busy/,
  );

  assert.equal((await store.readPendingEnqueues(owner)).length, 1);
  await store.purge(owner, async () => undefined);
  assert.deepEqual(await store.readPendingEnqueues(owner), []);
});

test('a fresh account activation queued during purge preserves only its new writes', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|generation-race@example.test';
  await store.write(owner, [conversation('old-generation', 1, [])], 'old-generation');
  let releasePurge: (() => void) | undefined;
  let markPurgeStarted: (() => void) | undefined;
  const purgeStarted = new Promise<void>((resolve) => { markPurgeStarted = resolve; });
  const purgeGate = new Promise<void>((resolve) => { releasePurge = resolve; });
  const purge = store.purge(owner, async () => {
    markPurgeStarted?.();
    await purgeGate;
  });
  await purgeStarted;

  const activation = store.activate(owner);
  const freshWrite = store.writeDraft(owner, 'new-generation', 'new account draft');
  releasePurge?.();
  await Promise.all([purge, activation, freshWrite]);

  assert.equal(await store.read(owner), null);
  assert.equal((await store.readDraft(owner, 'new-generation'))?.content, 'new account draft');
  assert.equal(storage.values.has(conversationOwnerDeletionKey(owner)), false);
});

test('same-owner reactivation rejects old index detail create and fork callbacks', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|same-owner-generation@example.test';
  await store.activate(owner);
  const oldEpoch = captureConversationStorageEpoch(owner);
  const oldUiApplies: string[] = [];
  let releaseOldCallbacks: (() => void) | undefined;
  const oldCallbackGate = new Promise<void>((resolve) => { releaseOldCallbacks = resolve; });
  const staleCallbacks = ['index', 'detail', 'create', 'fork'].map(async (kind) => {
    await oldCallbackGate;
    if (isConversationStorageEpochCurrent(owner, oldEpoch)) oldUiApplies.push(kind);
    await store.write(
      owner,
      [conversation(`old-${kind}`, 1, [])],
      `old-${kind}`,
      oldEpoch,
    );
  });

  await store.purge(owner);
  await store.activate(owner);
  await store.write(owner, [conversation('new-generation', 2, [])], 'new-generation');
  releaseOldCallbacks?.();
  await Promise.all(staleCallbacks);

  assert.deepEqual(oldUiApplies, []);
  assert.equal(isConversationStorageEpochCurrent(owner, oldEpoch), false);
  const restored = await store.read(owner);
  assert.deepEqual(restored?.conversations.map(({ id }) => id), ['new-generation']);

  const newEpoch = captureConversationStorageEpoch(owner);
  assert.equal(isConversationStorageEpochCurrent(owner, newEpoch), true);
  await store.write(
    owner,
    [conversation('new-generation-callback', 3, [])],
    'new-generation-callback',
    newEpoch,
  );
  assert.deepEqual(
    (await store.read(owner))?.conversations.map(({ id }) => id),
    ['new-generation-callback'],
  );
});

test('cloud reconciliation reuses unchanged local transcripts and downloads only changed records', () => {
  const unchanged = conversation('unchanged', 100, [
    { id: 'm-1', role: 'user', name: '你', content: '完整本地正文' },
  ]);
  const changed = conversation('changed', 100, [
    { id: 'm-2', role: 'user', name: '你', content: '旧正文' },
  ]);
  const deletedElsewhere = conversation('deleted', 100, []);
  const remoteUnchanged = conversation('unchanged', 100, [
    { id: 'last', role: 'user', name: '你', content: '轻量索引末条' },
  ]);
  const remoteChanged = conversation('changed', 200, [
    { id: 'last-2', role: 'assistant', name: 'Hermes', content: '新末条' },
  ], 3);
  const official = {
    ...conversation('official:session-1', 300, [], 8),
    official_session_id: 'session-1',
    title: '官方任务摘要',
  };

  const result = reconcileConversationCache(
    [unchanged, changed, deletedElsewhere],
    [official, remoteChanged, remoteUnchanged],
  );

  assert.deepEqual(result.downloadIds, ['changed']);
  assert.equal(result.conversations.find(({ id }) => id === 'unchanged')?.messages[0].content, '完整本地正文');
  assert.equal(result.conversations.some(({ id }) => id === 'deleted'), false);
  assert.equal(result.conversations.find(({ id }) => id.startsWith('official:'))?.title, '官方任务摘要');

  const synchronized = mergeDownloadedConversations(result.conversations, [
    conversation('changed', 200, [
      { id: 'm-2', role: 'user', name: '你', content: '完整新正文' },
      { id: 'm-3', role: 'assistant', name: 'Hermes', content: '完整新回复' },
      { id: 'm-4', role: 'user', name: '你', content: '继续' },
    ]),
  ]);
  assert.equal(synchronized.find(({ id }) => id === 'changed')?.messages.length, 3);
});

test('session-page synchronization stores full changed transcripts for later local-first startup', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|sync-owner@example.test';
  const unchanged = conversation('unchanged', 100, [
    { id: 'm-1', role: 'user', name: '你', content: '本地完整正文' },
  ]);
  const changedSummary = conversation('changed', 200, [
    { id: 'last', role: 'assistant', name: 'Hermes', content: '索引末条' },
  ], 2);
  await store.write(owner, [unchanged], unchanged.id);
  const detailCalls: string[] = [];
  const api = {
    async getUnifiedConversations() {
      return {
        conversations: [
          changedSummary,
          conversation('unchanged', 100, [
            { id: 'last-local', role: 'user', name: '你', content: '索引末条' },
          ]),
        ],
      };
    },
    async getConversation(id: string) {
      detailCalls.push(id);
      return {
        conversation: conversation('changed', 200, [
          { id: 'c-1', role: 'user', name: '你', content: '云端新消息' },
          { id: 'c-2', role: 'assistant', name: 'Hermes', content: '云端新回复' },
        ]),
      };
    },
  } as unknown as HermesCloudApi;

  const synchronized = await synchronizeConversationCache(api, store, owner);
  const restored = await store.read(owner);

  assert.deepEqual(detailCalls, ['changed']);
  assert.equal(synchronized.activeConversationId, 'unchanged');
  assert.equal(restored?.conversations.find(({ id }) => id === 'unchanged')?.messages[0].content, '本地完整正文');
  assert.equal(restored?.conversations.find(({ id }) => id === 'changed')?.messages.length, 2);
});

test('unchanged authoritative transcripts perform no detail download or local write', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|unchanged-sync@example.test';
  const complete = conversation('unchanged', 100, [
    { id: 'm-1', role: 'user', name: 'You', content: 'complete local transcript' },
  ]);
  await store.write(owner, [complete], complete.id);
  storage.setCalls.length = 0;
  const detailCalls: string[] = [];
  const api = {
    async getUnifiedConversations() {
      return {
        conversations: [conversation('unchanged', 100, [
          { id: 'summary', role: 'user', name: 'You', content: 'summary only' },
        ])],
      };
    },
    async getConversation(id: string) {
      detailCalls.push(id);
      return { conversation: complete };
    },
  } as unknown as HermesCloudApi;

  const synchronized = await synchronizeConversationCache(api, store, owner);

  assert.deepEqual(detailCalls, []);
  assert.deepEqual(storage.setCalls, []);
  assert.equal(synchronized.conversations[0].messages[0].content, 'complete local transcript');
});

test('a detail 404 removes the stale summary and selects the next live conversation', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|stale-summary@example.test';
  const api = {
    async getUnifiedConversations() {
      return {
        conversations: [
          conversation('missing', 200, [], 1),
          conversation('survivor', 100, []),
        ],
      };
    },
    async getConversation(id: string) {
      if (id === 'survivor') return { conversation: conversation('survivor', 100, []) };
      throw Object.assign(new Error('Conversation not found'), { status: 404 });
    },
  } as unknown as HermesCloudApi;

  const synchronized = await synchronizeConversationCache(api, store, owner);
  const restored = await store.read(owner);

  assert.deepEqual(synchronized.conversations.map(({ id }) => id), ['survivor']);
  assert.equal(synchronized.activeConversationId, 'survivor');
  assert.deepEqual(restored?.conversations.map(({ id }) => id), ['survivor']);
});

test('a slower stale synchronization cannot overwrite a newer device snapshot', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|race@example.test';
  let releaseOld: (() => void) | undefined;
  let signalOldStarted: (() => void) | undefined;
  const oldStarted = new Promise<void>((resolve) => { signalOldStarted = resolve; });
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  const oldApi = {
    async getUnifiedConversations() {
      signalOldStarted?.();
      await oldGate;
      return { conversations: [conversation('chat', 100, [], 1)] };
    },
    async getConversation() {
      return { conversation: conversation('chat', 100, [
        { id: 'old', role: 'assistant', name: 'Hermes', content: '旧设备结果' },
      ]) };
    },
  } as unknown as HermesCloudApi;
  const newApi = {
    async getUnifiedConversations() {
      return { conversations: [conversation('chat', 200, [], 1)] };
    },
    async getConversation() {
      return { conversation: conversation('chat', 200, [
        { id: 'new', role: 'assistant', name: 'Hermes', content: '新设备结果' },
      ]) };
    },
  } as unknown as HermesCloudApi;

  const stale = synchronizeConversationCache(oldApi, store, owner);
  await oldStarted;
  await synchronizeConversationCache(newApi, store, owner);
  releaseOld?.();
  await stale;

  const restored = await store.read(owner);
  assert.equal(restored?.conversations[0].updated_at, 200);
  assert.equal(restored?.conversations[0].messages[0].content, '新设备结果');
});

test('official sessions are adopted through the modified Hermes flow before chat opens', async () => {
  const calls: Array<{ path: string; options: HermesRequestOptions }> = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ path, options });
      if (path === '/api/sessions/session-1') {
        return Promise.resolve({ title: '官方任务摘要标题' } as T);
      }
      if (path === '/api/sessions/session-1/messages') {
        return Promise.resolve({
          session_id: 'session-1',
          messages: [
            { role: 'user', content: '检查项目', timestamp: 10 },
            {
              role: 'assistant',
              reasoning_content: '先检查状态',
              tool_calls: [{ id: 'tool-1', function: { name: 'terminal', arguments: '{}' } }],
              timestamp: 11,
            },
            { role: 'tool', tool_call_id: 'tool-1', content: 'clean', timestamp: 12 },
            { role: 'assistant', content: '项目状态正常', timestamp: 13 },
          ],
        } as T);
      }
      if (path.endsWith('/profiles')) {
        return Promise.resolve({
          profiles: [{
            name: 'default',
            description: '',
            model: '',
            provider: '',
            gateway_running: true,
          }],
        } as T);
      }
      if (path.endsWith('/single/conversations/adopt')) {
        return Promise.resolve({
          conversation: conversation('adopted-1', 13_000, []),
          created: true,
        } as T);
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  } as HermesApiClient;

  const result = await new HermesCloudApi(client).adoptOfficialConversation(
    officialConversationPlaceholderId('reviewer', 'session-1'),
    'default',
  );
  const body = JSON.parse(String(calls[2].options.body)) as {
    title: string;
    session_id: string;
    messages: Array<Record<string, unknown>>;
  };

  assert.equal(result.conversation.id, 'adopted-1');
  assert.equal(calls[0].options.profile, 'reviewer');
  assert.equal(calls[1].options.profile, 'reviewer');
  assert.deepEqual(calls.map(({ path }) => path), [
    '/api/sessions/session-1',
    '/api/sessions/session-1/messages',
    '/api/plugins/collaboration/single/conversations/adopt',
  ]);
  assert.equal(body.session_id, 'session-1');
  assert.equal((body as { profile?: string }).profile, 'reviewer');
  assert.equal(body.title, '官方任务摘要标题');
  assert.deepEqual(body.messages.map(({ role }) => role), ['user', 'assistant']);
  assert.equal(body.messages[0].timestamp, 10);
  assert.equal(body.messages[1].content, '项目状态正常');
  assert.equal((body.messages[1].meta as { activities: unknown[] }).activities.length, 2);
});

test('appending one message rewrites only that conversation row plus the index', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|append@example.test';
  const conversations = Array.from({ length: 5 }, (_, index) => conversation(
    `chat-${index}`,
    100 + index,
    [{ id: `m-${index}`, role: 'user', name: '你', content: `历史正文 ${index}` }],
  ));

  await store.write(owner, conversations, 'chat-0');
  const indexKey = [...storage.values.keys()].find((key) => !key.includes('.row.'));
  const changedRowKey = [...storage.values.keys()].find((key) => (
    key.includes('.row.') && (storage.values.get(key) || '').includes('"chat-2"')
  ));
  assert.ok(indexKey && changedRowKey);
  assert.equal(storage.setCalls.length, 6);

  storage.setCalls.length = 0;
  const appended = conversations.map((entry) => entry.id === 'chat-2'
    ? {
      ...entry,
      updated_at: 900,
      message_count: 2,
      messages: [
        ...entry.messages,
        { id: 'm-new', role: 'assistant', name: 'Hermes', content: '新增回复' },
      ],
    }
    : entry);
  await store.write(owner, appended, 'chat-2');

  // The append must touch exactly two keys: the changed conversation's row
  // and the small index. The other four transcripts stay untouched.
  assert.deepEqual(storage.setCalls, [changedRowKey, indexKey]);
  const restored = await store.read(owner);
  assert.equal(
    restored?.conversations.find(({ id }) => id === 'chat-2')?.messages.length,
    2,
  );

  storage.setCalls.length = 0;
  await store.write(owner, appended, 'chat-2');
  // A write with no conversation changes performs no storage write.
  assert.deepEqual(storage.setCalls, []);

  storage.setCalls.length = 0;
  await store.write(owner, appended.filter(({ id }) => id !== 'chat-4'), 'chat-2');
  assert.deepEqual(storage.setCalls, [indexKey]);
  assert.equal(
    [...storage.values.values()].some((value) => value.includes('"chat-4"')),
    false,
  );
});

test('v3 single-blob history loads unchanged and is sharded by the next write', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'blob-migration-owner';
  const encodedOwner = `u${Array.from(owner)
    .map((character) => character.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')}`;
  const blobKey = `hermes.native.conversations.v3.${encodedOwner}`;
  storage.values.set(blobKey, JSON.stringify({
    version: 3,
    owner,
    activeConversationId: 'blob-chat',
    conversations: [conversation('blob-chat', 50, [
      { id: 'b-1', role: 'user', name: '你', content: '升级前的历史' },
    ])],
    syncedAt: 50,
  }));

  const restored = await store.read(owner);
  assert.equal(restored?.activeConversationId, 'blob-chat');
  assert.equal(restored?.conversations[0].messages[0].content, '升级前的历史');
  assert.equal(restored?.syncedAt, 50);

  await store.write(owner, restored!.conversations, restored!.activeConversationId);
  assert.equal(storage.values.has(blobKey), false);
  assert.ok([...storage.values.keys()].every((key) => key.includes('conversations.v4')));

  // The sharded layout must be complete on disk: a brand-new store instance
  // (fresh process, empty stamp cache) reads the same history back.
  const rehydrated = await new ConversationLocalStore(storage).read(owner);
  assert.equal(rehydrated?.conversations[0].id, 'blob-chat');
  assert.equal(rehydrated?.conversations[0].messages[0].content, '升级前的历史');
});

test('a fresh process seeds row stamps from disk and still skips clean rows', async () => {
  const storage = new MemoryStorage();
  const owner = 'https://example.test|rehydrate@example.test';
  const conversations = [
    conversation('stable', 100, [
      { id: 's-1', role: 'user', name: '你', content: '不变的会话' },
    ]),
    conversation('growing', 200, [
      { id: 'g-1', role: 'user', name: '你', content: '继续任务' },
    ]),
  ];
  await new ConversationLocalStore(storage).write(owner, conversations, 'growing');

  const fresh = new ConversationLocalStore(storage);
  const restored = await fresh.read(owner);
  assert.equal(restored?.conversations.length, 2);
  storage.setCalls.length = 0;

  const appended = restored!.conversations.map((entry) => entry.id === 'growing'
    ? {
      ...entry,
      updated_at: 300,
      message_count: 2,
      messages: [
        ...entry.messages,
        { id: 'g-2', role: 'assistant', name: 'Hermes', content: '已完成' },
      ],
    }
    : entry);
  await fresh.write(owner, appended, 'growing');

  // read() hydrated the stamp cache, so the restart does not trigger a full
  // rewrite: only the appended row and the index hit storage.
  assert.equal(storage.setCalls.length, 2);
  assert.equal(storage.setCalls.filter((key) => key.includes('.row.')).length, 1);
  assert.ok((storage.values.get(storage.setCalls[0]) || '').includes('"g-2"'));
});

test('two live store facades merge interleaved messages instead of overwriting a stale row', async () => {
  const storage = new MemoryStorage();
  const owner = 'https://example.test|two-consumers@example.test';
  const chatPageStore = new ConversationLocalStore(storage);
  const swiftRouteStore = new ConversationLocalStore(storage);
  const baseline = conversation('shared-chat', 100, [
    { id: 'm-1', role: 'user', name: '你', content: '开始任务', created_at: 100 },
  ]);

  await chatPageStore.write(owner, [baseline], 'shared-chat');
  const chatPageSnapshot = await chatPageStore.read(owner);
  const swiftRouteSnapshot = await swiftRouteStore.read(owner);

  await swiftRouteStore.write(owner, [{
    ...swiftRouteSnapshot!.conversations[0],
    updated_at: 200,
    message_count: 2,
    messages: [
      ...swiftRouteSnapshot!.conversations[0].messages,
      {
        id: 'm-route',
        role: 'assistant',
        name: 'Hermes',
        content: 'SwiftUI 路由已刷新',
        created_at: 200,
      },
    ],
  }], 'shared-chat');

  await chatPageStore.write(owner, [{
    ...chatPageSnapshot!.conversations[0],
    updated_at: 300,
    message_count: 2,
    messages: [
      ...chatPageSnapshot!.conversations[0].messages,
      {
        id: 'm-chat',
        role: 'assistant',
        name: 'Hermes',
        content: '聊天流收到新 token',
        created_at: 300,
      },
    ],
  }], 'shared-chat');

  const restored = await new ConversationLocalStore(storage).read(owner);
  assert.deepEqual(
    restored!.conversations[0].messages.map(({ id }) => id),
    ['m-1', 'm-route', 'm-chat'],
  );
  assert.equal(restored!.conversations[0].message_count, 3);
});
