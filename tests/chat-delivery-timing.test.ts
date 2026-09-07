import assert from 'node:assert/strict';
import test from 'node:test';
import { observeChatDelivery } from '../src/api/chat-delivery-timing';
import { messageDurationMs } from '../src/api/chat-view-timing';
import type { HermesChatViewMessage as Message } from '../src/api/chat-view-types';
import { turnTimingLine } from '../src/studio/workflow-timeline-model';

const user: Message = { id: 'u', role: 'user', name: 'You', content: 'task', runtimeTurnId: 't', submittedAt: 1000 };
const reply: Message = { id: 'a', role: 'assistant', name: 'Hermes', content: '', runtimeTurnId: 't', roleStage: 'chat',
  modelStartedAt: 21_000, firstTokenAt: 28_000, startedAt: 28_000, status: 'running' };

test('delivery timing includes queue and network delay and cannot fall back to model-only duration', () => {
  const thinking = observeChatDelivery([user, { ...reply, activities: [{ id: 'r', category: 'reasoning', name: 'thinking',
    preview: 'received reasoning', status: 'running', duration: '' }] }], [user], 30_000);
  assert.equal(thinking[1].firstObservedAt, 30_000);
  assert.equal(messageDurationMs(thinking[1], 31_000), 30_000);
  const done = observeChatDelivery([user, { ...reply, status: 'completed', content: '3973', completedAt: 29_000 }], thinking, 32_000);
  assert.equal(turnTimingLine(done[1], true, 32_000), '首字 29 s · 全程 31 s');
  const snapshot = observeChatDelivery([user, { ...reply, status: 'completed', content: '3973', completedAt: 29_000 }], done, 60_000);
  assert.equal(turnTimingLine(snapshot[1], true, 60_000), '首字 29 s · 全程 31 s');
});

test('history without a local send boundary keeps server timing', () => {
  const history = observeChatDelivery([{ ...reply, status: 'completed', completedAt: 29_000 }], [], 100_000);
  assert.equal(history[0].submittedAt, undefined);
  assert.equal(turnTimingLine(history[0], true), '首字 7 s · 全程 8 s');
});

test('canonical chat metadata and ids cannot reset locally observed first token time', () => {
  const live = { ...reply, firstObservedAt: 8000, submittedAt: 1000, rawRoleStage: 'chat' };
  const result = observeChatDelivery([user, { ...reply, id: 'durable-id', rawRoleStage: undefined,
    profile: 'default', memberId: 'hermes', status: 'completed', content: '3973' }], [user, live], 9000);
  assert.equal(result[1].firstObservedAt, 8000);
  assert.equal(result[1].completedObservedAt, 9000);
});

test('streaming the next reply preserves identities of settled history rows', () => {
  const history = observeChatDelivery([user, { ...reply, status: 'completed', content: '3973' }], [user], 9000);
  const incoming = { ...reply, id: 'next', runtimeTurnId: 'next-turn', content: 'new token', submittedAt: 10000 };
  const next = observeChatDelivery([...history, incoming], history, 11000);
  assert.equal(next[0], history[0]);
  assert.equal(next[1], history[1]);
  assert.equal(next[2].firstObservedAt, 11000);
  assert.equal(observeChatDelivery(next, next, 12000)[2], next[2]);
});
