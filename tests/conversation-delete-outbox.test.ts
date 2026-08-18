import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConversationLocalStore,
  type ConversationDeleteOutboxItem,
} from '../src/api/conversation-local-store';
import {
  conversationDeleteOutboxKey,
  filterConversationDeletionTombstones,
  selectReadyConversationDeleteOutboxItems,
} from '../src/api/conversation-delete-outbox';
import { createConversationDeleteReplayService } from '../src/api/conversation-delete-replay';
import type { SingleConversation } from '../src/api/HermesCloudApi';
import { synchronizeConversationCache } from '../src/api/conversation-cache-sync';
import { captureConversationDeletionRevision } from '../src/api/conversation-storage-coordinator';

class MemoryStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function conversation(id: string, updatedAt: number): SingleConversation {
  return {
    id,
    profile: 'default',
    title: id,
    messages: [{
      content: `message-${id}`,
      created_at: updatedAt,
      id: `message-${id}`,
      name: 'You',
      role: 'user',
      status: 'completed',
    }],
    message_count: 1,
    updated_at: updatedAt,
  };
}

function deletion(
  conversationId: string,
  queuedAt = 100,
  kind: ConversationDeleteOutboxItem['kind'] = 'conversation',
): ConversationDeleteOutboxItem {
  return { conversationId, kind, profile: 'default', queuedAt };
}

test('staging a deletion prunes local history before remote replay and survives restart', async () => {
  const storage = new MemoryStorage();
  const owner = 'https://example.test|delete@example.test';
  const first = new ConversationLocalStore(storage);
  await first.write(owner, [conversation('keep', 1), conversation('remove', 2)], 'remove');

  const queued = await first.stageConversationDeletion(owner, deletion('remove'), 'keep');
  assert.equal(queued?.conversationId, 'remove');
  assert.deepEqual((await first.read(owner))?.conversations.map(({ id }) => id), ['keep']);
  assert.equal((await first.read(owner))?.activeConversationId, 'keep');

  const restarted = new ConversationLocalStore(storage);
  assert.deepEqual(
    [...await restarted.readPendingConversationDeletionIds(owner)],
    ['remove'],
  );
  assert.equal(storage.values.has(conversationDeleteOutboxKey(owner)), true);
  assert.deepEqual((await restarted.read(owner))?.conversations.map(({ id }) => id), ['keep']);
});

test('delete outbox rows are owner-isolated, deduplicated, leased, retried, and completed', async () => {
  const storage = new MemoryStorage();
  const ownerA = 'owner-a@example.test';
  const ownerB = 'owner-b@example.test';
  const store = new ConversationLocalStore(storage);

  await store.queueConversationDeletion(ownerA, deletion('same', 200));
  await store.queueConversationDeletion(ownerA, deletion('same', 100));
  await store.queueConversationDeletion(ownerB, deletion('same', 300));
  assert.equal((await store.readPendingConversationDeletions(ownerA)).length, 1);
  assert.equal((await store.readPendingConversationDeletions(ownerA))[0].queuedAt, 100);
  assert.equal((await store.readPendingConversationDeletions(ownerB)).length, 1);

  const claimed = await store.claimReadyConversationDeletions(ownerA, 'worker-a', 1_000, 1_000);
  assert.equal(claimed.length, 1);
  assert.equal((await store.claimReadyConversationDeletions(ownerA, 'worker-b', 1_500, 1_000)).length, 0);

  assert.equal(
    await store.retryConversationDeletion(ownerA, claimed[0], 'offline', 10_000),
    true,
  );
  const retried = (await store.readPendingConversationDeletions(ownerA))[0];
  assert.equal(retried.attempts, 1);
  assert.equal(retried.lastError, 'offline');
  assert.equal(retried.nextAttemptAt, 10_000);
  assert.equal((await store.claimReadyConversationDeletions(ownerA, 'worker-c', 9_999)).length, 0);

  const reclaimed = await store.claimReadyConversationDeletions(ownerA, 'worker-c', 10_000, 1_000);
  assert.equal(reclaimed.length, 1);
  assert.equal(await store.removeCompletedConversationDeletion(ownerA, reclaimed[0]), true);
  assert.deepEqual(await store.readPendingConversationDeletions(ownerA), []);
  assert.equal((await store.readPendingConversationDeletions(ownerB))[0].conversationId, 'same');
});

test('expired leases become ready while future backoff rows remain hidden', () => {
  const items: ConversationDeleteOutboxItem[] = [
    { ...deletion('future', 100), nextAttemptAt: 5_000 },
    { ...deletion('expired-lease', 200), leaseExpiresAt: 900, leaseOwner: 'old', leaseToken: 'token' },
    { ...deletion('active-lease', 300), leaseExpiresAt: 2_000, leaseOwner: 'new', leaseToken: 'token-2' },
  ];
  assert.deepEqual(
    selectReadyConversationDeleteOutboxItems(items, 1_000).map(({ conversationId }) => conversationId),
    ['expired-lease'],
  );
});

test('room tombstones can be replayed independently of conversation/session workers', () => {
  const items: ConversationDeleteOutboxItem[] = [
    deletion('conversation-row'),
    deletion('chat_room_legacy', 101, 'room'),
  ];
  assert.deepEqual(
    selectReadyConversationDeleteOutboxItems(items, 1_000, 8, ['room']).map(({ conversationId }) => conversationId),
    ['chat_room_legacy'],
  );
});

test('room remote identity is normalized and survives an outbox restart', async () => {
  const storage = new MemoryStorage();
  const owner = 'room-remote-id-owner';
  const first = new ConversationLocalStore(storage);
  const queued = await first.queueConversationDeletion(owner, {
    ...deletion('chat_room_local-copy', 100, 'room'),
    remoteId: '  upstream-room-id  ',
  });

  assert.equal(queued?.remoteId, 'upstream-room-id');
  const restarted = new ConversationLocalStore(storage);
  assert.deepEqual(await restarted.readPendingConversationDeletions(owner), [{
    attempts: 0,
    conversationId: 'chat_room_local-copy',
    kind: 'room',
    profile: 'default',
    queuedAt: 100,
    remoteId: 'upstream-room-id',
  }]);
});

test('tombstone filtering is shared by every remote-index consumer', () => {
  const remote = [{ id: 'keep' }, { id: 'deleted' }, { id: 'other' }];
  assert.deepEqual(
    filterConversationDeletionTombstones(remote, [deletion('deleted')]),
    [{ id: 'keep' }, { id: 'other' }],
  );
  assert.deepEqual(
    filterConversationDeletionTombstones(remote, new Set(['other'])),
    [{ id: 'keep' }, { id: 'deleted' }],
  );
});

test('staging an official session uses a distinct deletion identity and keeps its profile', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'official-owner';
  await store.stageConversationDeletion(owner, {
    ...deletion('session-1', 100, 'session'),
    profile: 'reviewer',
  });
  const pending = await store.readPendingConversationDeletions(owner);
  assert.equal(pending[0].kind, 'session');
  assert.equal(pending[0].profile, 'reviewer');
  await store.queueConversationDeletion(owner, deletion('session-1', 200, 'conversation'));
  assert.equal((await store.readPendingConversationDeletions(owner)).length, 2);
});

test('committed deletion intents advance the revision after the outbox write', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'delete-revision-commit-owner';
  const before = captureConversationDeletionRevision(owner);
  await store.queueConversationDeletion(owner, deletion('revision-row'));
  assert.equal(captureConversationDeletionRevision(owner), before + 2);
});

test('replay prunes locally before remote delivery and keeps transport failures durable', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'replay-owner';
  await store.write(owner, [conversation('replay-me', 1)], 'replay-me');
  await store.queueConversationDeletion(owner, deletion('replay-me', 100));

  let now = 1_000;
  let attempts = 0;
  const observedLocalIds: string[][] = [];
  const service = createConversationDeleteReplayService({
    cacheOwner: owner,
    deleteRemote: async () => {
      attempts += 1;
      observedLocalIds.push((await store.read(owner))?.conversations.map(({ id }) => id) || []);
      if (attempts === 1) throw new Error('offline');
    },
    isRetryable: () => true,
    now: () => now,
    outbox: store,
    retryDelayMs: 5_000,
    workerId: 'replay-worker',
  });

  const first = await service.replay();
  assert.deepEqual(first, { completed: 0, failed: 0, retried: 1 });
  assert.deepEqual(observedLocalIds, [[]]);
  assert.equal((await store.readPendingConversationDeletions(owner))[0].nextAttemptAt, 6_000);

  now = 6_000;
  const second = await service.replay();
  assert.deepEqual(second, { completed: 1, failed: 0, retried: 0 });
  assert.deepEqual(await store.readPendingConversationDeletions(owner), []);
});

test('replay treats an already-missing remote record as successful', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'replay-404-owner';
  await store.queueConversationDeletion(owner, deletion('already-gone'));
  const service = createConversationDeleteReplayService({
    cacheOwner: owner,
    deleteRemote: async () => { throw new Error('HTTP 404'); },
    isAlreadyDeleted: () => true,
    outbox: store,
    workerId: 'replay-worker',
  });
  assert.deepEqual(await service.replay(), { completed: 1, failed: 0, retried: 0 });
  assert.deepEqual(await store.readPendingConversationDeletions(owner), []);
});

test('one replay drains more rows than the default eight-row claim batch', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'multi-batch-replay-owner';
  const expectedIds = Array.from({ length: 10 }, (_, index) => `delete-${index}`);
  for (const [index, conversationId] of expectedIds.entries()) {
    await store.queueConversationDeletion(owner, deletion(conversationId, 100 + index));
  }

  const deliveredIds: string[] = [];
  const service = createConversationDeleteReplayService({
    cacheOwner: owner,
    deleteRemote: async (item) => { deliveredIds.push(item.conversationId); },
    outbox: store,
    workerId: 'multi-batch-worker',
  });

  assert.deepEqual(await service.replay(), { completed: 10, failed: 0, retried: 0 });
  assert.deepEqual(deliveredIds, expectedIds);
  assert.deepEqual(await store.readPendingConversationDeletions(owner), []);
});

test('account purge removes pending remote-delete intents with the rest of local data', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'purge-delete-owner';
  await store.queueConversationDeletion(owner, deletion('purge-me'));
  assert.equal(storage.values.has(conversationDeleteOutboxKey(owner)), true);
  await store.purge(owner);
  assert.equal(storage.values.has(conversationDeleteOutboxKey(owner)), false);
  assert.deepEqual(await store.readPendingConversationDeletions(owner), []);
});

test('cache synchronization does not reintroduce a locally deleted remote row', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'sync-tombstone-owner';
  await store.write(owner, [conversation('still-local', 1), conversation('pending-delete', 2)], 'still-local');
  await store.stageConversationDeletion(owner, deletion('pending-delete'), 'still-local');
  const synced = await synchronizeConversationCache({
    async getUnifiedConversations() {
      return { conversations: [conversation('pending-delete', 3), conversation('remote-new', 4)] };
    },
    async getConversation(id: string) {
      return { conversation: conversation(id, 4) };
    },
  } as never, store, owner);
  assert.deepEqual(synced.conversations.map(({ id }) => id), ['remote-new', 'still-local']);
  assert.deepEqual((await store.read(owner))?.conversations.map(({ id }) => id), ['remote-new', 'still-local']);
});

test('restart sync removes a tombstoned cache row even when the first local prune was interrupted', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'sync-interrupted-delete-owner';
  await store.write(owner, [conversation('pending-delete', 2)], 'pending-delete');
  // Simulate a process exit after the durable intent write but before
  // stageConversationDeletion reaches the row-level cache.
  await store.queueConversationDeletion(owner, deletion('pending-delete'));

  const synced = await synchronizeConversationCache({
    async getUnifiedConversations() {
      return { conversations: [conversation('pending-delete', 3), conversation('remote-new', 4)] };
    },
    async getConversation(id: string) {
      return { conversation: conversation(id, 4) };
    },
  } as never, store, owner);

  assert.deepEqual(synced.conversations.map(({ id }) => id), ['remote-new']);
  assert.deepEqual((await store.read(owner))?.conversations.map(({ id }) => id), ['remote-new']);
});
