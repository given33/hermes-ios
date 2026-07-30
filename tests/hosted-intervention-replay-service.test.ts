import assert from 'node:assert/strict';
import test from 'node:test';

import type { HostedInterventionOutboxItem } from '../src/api/conversation-store-types';
import { createHostedInterventionReplayService } from '../src/studio/chat/hosted-intervention-replay-service';
import {
  beginConversationStorageOwnerActivation,
  beginConversationStorageOwnerPurge,
  captureConversationStorageEpoch,
  completeConversationStorageOwnerActivation,
} from '../src/api/conversation-storage-coordinator';

function intervention(overrides: Partial<HostedInterventionOutboxItem> = {}) {
  return {
    content: '@Worker check this',
    conversationId: 'conversation-1',
    message: {
      content: '@Worker check this',
      id: 'message-1',
      name: 'Given',
      role: 'user',
    },
    messageId: 'message-1',
    queuedAt: 1,
    turnId: 'turn-1',
    ...overrides,
  } satisfies HostedInterventionOutboxItem;
}

test('retryable intervention failures keep one intent with bounded backoff', async () => {
  const saved: HostedInterventionOutboxItem[] = [];
  const failed: string[] = [];
  const service = createHostedInterventionReplayService({
    cacheOwner: 'account-1',
    async deliver() { throw new Error('offline'); },
    describeError: () => 'offline',
    isRetryable: () => true,
    maxAttempts: 5,
    now: () => 1_000,
    outbox: {
      async failPendingIntervention(_owner, _item, message) { failed.push(message); },
      async readPendingInterventions() { return [intervention({ attempts: 1 })]; },
      async upsertPendingIntervention(_owner, item) { saved.push(item); },
    },
    retryDelayMs: 60_000,
  });

  await service.replay(0);

  assert.equal(saved[0].attempts, 2);
  assert.equal(saved[0].nextAttemptAt, 61_000);
  assert.deepEqual(failed, []);
});

test('the final retry records one permanent failure and exposes it to the UI', async () => {
  const failed: string[] = [];
  const surfaced: string[] = [];
  const service = createHostedInterventionReplayService({
    cacheOwner: 'account-1',
    async deliver() { throw new Error('HTTP 409'); },
    describeError: () => 'HTTP 409',
    isRetryable: () => false,
    maxAttempts: 5,
    onPermanentFailure(_item, message) { surfaced.push(message); },
    outbox: {
      async failPendingIntervention(_owner, _item, message) { failed.push(message); },
      async readPendingInterventions() { return [intervention()]; },
      async upsertPendingIntervention() {},
    },
    retryDelayMs: 60_000,
  });

  await service.replay(0);

  assert.deepEqual(failed, ['HTTP 409']);
  assert.deepEqual(surfaced, ['HTTP 409']);
});

test('concurrent replay requests share one drain operation', async () => {
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const service = createHostedInterventionReplayService({
    cacheOwner: 'account-1',
    async deliver() { await gate; },
    describeError: () => '',
    isRetryable: () => false,
    maxAttempts: 5,
    outbox: {
      async failPendingIntervention() {},
      async readPendingInterventions() { reads += 1; return [intervention()]; },
      async upsertPendingIntervention() {},
    },
    retryDelayMs: 60_000,
  });

  const first = service.replay(0);
  const second = service.replay(0);
  release();
  await Promise.all([first, second]);

  assert.equal(reads, 1);
});

test('old intervention replay cannot write retry state into a reactivated owner', async () => {
  const owner = 'intervention-owner-epoch-interleaving';
  const expectedOwnerEpoch = captureConversationStorageEpoch(owner);
  const saved: HostedInterventionOutboxItem[] = [];
  const failed: string[] = [];
  let releaseDelivery!: () => void;
  let deliveryStarted!: () => void;
  const deliveryGate = new Promise<void>((resolve) => { releaseDelivery = resolve; });
  const started = new Promise<void>((resolve) => { deliveryStarted = resolve; });
  const service = createHostedInterventionReplayService({
    cacheOwner: owner,
    async deliver() {
      deliveryStarted();
      await deliveryGate;
      throw new Error('offline');
    },
    describeError: () => 'offline',
    isRetryable: () => true,
    maxAttempts: 5,
    outbox: {
      async failPendingIntervention(_owner, _item, message) { failed.push(message); },
      async readPendingInterventions() { return [intervention()]; },
      async upsertPendingIntervention(_owner, item) { saved.push(item); },
    },
    retryDelayMs: 60_000,
  });

  const replay = service.replay(expectedOwnerEpoch);
  await started;
  beginConversationStorageOwnerPurge(owner);
  const newEpoch = beginConversationStorageOwnerActivation(owner);
  completeConversationStorageOwnerActivation(owner, newEpoch);
  releaseDelivery();

  await assert.rejects(replay, /lifecycle changed/i);
  assert.deepEqual(saved, []);
  assert.deepEqual(failed, []);
});
