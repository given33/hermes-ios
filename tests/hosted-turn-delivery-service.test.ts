import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  HostedInterventionOutboxItem,
  HostedTurnOutboxItem,
} from '../src/api/conversation-local-store';
import {
  createHostedTurnDeliveryService,
  type HostedTurnAttachmentPort,
  type HostedTurnCloudPort,
  type HostedTurnOutboxPort,
} from '../src/studio/chat/hosted-turn-delivery-service';
import { HostedTurnCancelledDuringDelivery } from '../src/studio/chat/chat-types';

function pendingItem(overrides: Partial<HostedTurnOutboxItem> = {}): HostedTurnOutboxItem {
  return {
    conversationId: 'conversation-deleted-on-server',
    conversationProfile: 'default',
    input: {
      attachmentContext: '',
      attachmentIds: [],
      deliveryContext: '',
      message: { content: 'hello', id: 'message-1', name: 'Given', role: 'user' },
      profiles: ['default'],
      recentMessages: [],
      requestId: 'request-1',
      turnId: 'turn-1',
    },
    pendingAttachments: [],
    queuedAt: 1,
    ...overrides,
  };
}

function ports() {
  const persisted: HostedTurnOutboxItem[] = [];
  const removedInterventions: string[] = [];
  const savedInterventions: HostedInterventionOutboxItem[] = [];
  const outbox: HostedTurnOutboxPort = {
    async removePendingIntervention(_owner, messageId) {
      removedInterventions.push(messageId);
    },
    async upsertPendingEnqueueIfActive(_owner, item) {
      persisted.push(item);
      return { item, updated: true };
    },
    async upsertPendingIntervention(_owner, item) {
      savedInterventions.push(item);
    },
  };
  return { outbox, persisted, removedInterventions, savedInterventions };
}

const attachments: HostedTurnAttachmentPort = {
  hydrate(item) {
    return item;
  },
  async persist(_owner, _requestId, items) {
    return [...items];
  },
  async upload() {
    return { id: 'attachment-1' };
  },
};

test('a deleted conversation is re-homed once without changing request identity', async () => {
  const state = ports();
  const created: string[] = [];
  const enqueued: Array<{ conversationId: string; requestId: string }> = [];
  let attempts = 0;
  const cloud: HostedTurnCloudPort = {
    async createConversation(_profile, _title, conversationId) {
      created.push(conversationId);
    },
    async enqueueHostedTurn(conversationId, input) {
      attempts += 1;
      enqueued.push({ conversationId, requestId: input.requestId });
      if (attempts === 1) throw { status: 404 };
      return { accepted: true } as never;
    },
    async interveneHostedTurn() {
      return { accepted: true };
    },
    async uploadConversationAttachment() {
      throw new Error('not used');
    },
  };
  const service = createHostedTurnDeliveryService({
    attachments,
    cacheOwner: 'account-1',
    cloud,
    isChinese: false,
    outbox: state.outbox,
    profile: 'default',
    requestTimeoutMs: 1_000,
  });

  const result = await service.deliverPendingEnqueue(pendingItem());

  assert.equal(attempts, 2);
  assert.equal(result.item.conversationId, 'chat_request-1');
  assert.deepEqual(created, ['chat_request-1']);
  assert.deepEqual(enqueued.map(({ requestId }) => requestId), ['request-1', 'request-1']);
  assert.ok(state.persisted.some(({ conversationPending }) => conversationPending));
  assert.equal(state.persisted.at(-1)?.conversationPending, false);
});

test('a lost outbox claim stops delivery before any server call', async () => {
  let serverCalls = 0;
  const cloud: HostedTurnCloudPort = {
    async createConversation() { serverCalls += 1; },
    async enqueueHostedTurn() { serverCalls += 1; return { accepted: true } as never; },
    async interveneHostedTurn() { serverCalls += 1; return { accepted: true }; },
    async uploadConversationAttachment() { serverCalls += 1; return {}; },
  };
  const outbox: HostedTurnOutboxPort = {
    async removePendingIntervention() {},
    async upsertPendingEnqueueIfActive(_owner, item) {
      return { item: { ...item, cancelledAt: Date.now() }, updated: false };
    },
    async upsertPendingIntervention() {},
  };
  const service = createHostedTurnDeliveryService({
    attachments,
    cacheOwner: 'account-1',
    cloud,
    isChinese: false,
    outbox,
    profile: 'default',
    requestTimeoutMs: 1_000,
  });

  await assert.rejects(
    service.deliverPendingEnqueue(pendingItem({ conversationId: '', conversationPending: true })),
    HostedTurnCancelledDuringDelivery,
  );
  assert.equal(serverCalls, 0);
});

test('an accepted intervention records acknowledgement before removing the intent', async () => {
  const state = ports();
  const calls: string[] = [];
  const cloud: HostedTurnCloudPort = {
    async createConversation() {},
    async enqueueHostedTurn() { return { accepted: true } as never; },
    async interveneHostedTurn(conversationId, turnId, content, messageId) {
      calls.push([conversationId, turnId, content, messageId].join(':'));
      return { accepted: true };
    },
    async uploadConversationAttachment() { return {}; },
  };
  const service = createHostedTurnDeliveryService({
    attachments,
    cacheOwner: 'account-1',
    cloud,
    isChinese: false,
    outbox: state.outbox,
    profile: 'default',
    requestTimeoutMs: 1_000,
  });
  const item: HostedInterventionOutboxItem = {
    content: '@Worker inspect this',
    conversationId: 'conversation-1',
    message: {
      content: '@Worker inspect this',
      id: 'message-2',
      name: 'Given',
      role: 'user',
    },
    messageId: 'message-2',
    queuedAt: 1,
    turnId: 'turn-1',
  };

  await service.deliverPendingIntervention(item);

  assert.deepEqual(calls, ['conversation-1:turn-1:@Worker inspect this:message-2']);
  assert.ok(state.savedInterventions[0].deliveryAcceptedAt);
  assert.deepEqual(state.removedInterventions, ['message-2']);
});
