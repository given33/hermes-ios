import assert from 'node:assert/strict';
import test from 'node:test';

import { createHostedSubagentControlActions } from '../src/studio/chat/hosted-subagent-controls';

test('hosted subagent actions bind controls to the active conversation and turn', () => {
  const steerCalls: unknown[][] = [];
  const stopCalls: unknown[][] = [];
  const api = {
    steerHostedSubagent: (...args: unknown[]) => {
      steerCalls.push(args);
      return Promise.resolve({});
    },
    stopHostedSubagent: (...args: unknown[]) => {
      stopCalls.push(args);
      return Promise.resolve({});
    },
  };
  const originalNow = Date.now;
  Date.now = () => 1234;
  try {
    const actions = createHostedSubagentControlActions({
      cloudApi: api,
      conversationId: 'conversation-1',
      isChinese: false,
      notify: () => undefined,
      turnId: 'turn-1',
    });
    actions.onSteerSubagent('worker-1', 'focus on tests');
    actions.onStopSubagent('worker-1');
  } finally {
    Date.now = originalNow;
  }

  assert.deepEqual(steerCalls, [[
    'conversation-1',
    'turn-1',
    'worker-1',
    'focus on tests',
    'ios-steer-turn-1-worker-1-1234',
  ]]);
  assert.equal(stopCalls.length, 1);
  assert.deepEqual(stopCalls[0]?.slice(0, 3), [
    'conversation-1',
    'turn-1',
    'worker-1',
  ]);
  assert.equal(stopCalls[0]?.[4], 'ios-stop-turn-1-worker-1-1234');
});

test('hosted subagent actions do not call the API without a durable scope', () => {
  let called = false;
  const api = {
    steerHostedSubagent: () => {
      called = true;
      return Promise.resolve({});
    },
    stopHostedSubagent: () => {
      called = true;
      return Promise.resolve({});
    },
  };
  const actions = createHostedSubagentControlActions({
    cloudApi: api,
    conversationId: '',
    isChinese: false,
    notify: () => undefined,
    turnId: 'turn-1',
  });
  actions.onSteerSubagent('worker-1', 'redirect');
  actions.onStopSubagent('worker-1');
  assert.equal(called, false);
});

test('hosted subagent action failures surface to the user', async () => {
  const notifications: string[] = [];
  const api = {
    steerHostedSubagent: () => Promise.reject(new Error('steer rejected')),
    stopHostedSubagent: () => Promise.resolve({}),
  };
  const actions = createHostedSubagentControlActions({
    cloudApi: api,
    conversationId: 'conversation-1',
    isChinese: false,
    notify: (message) => notifications.push(message),
    turnId: 'turn-1',
  });
  actions.onSteerSubagent('worker-1', 'redirect');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(notifications, ['steer rejected']);
});
