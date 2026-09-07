import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hostedTurnVisibilityFailure,
  reconcileHostedTurnVisibilityFailures,
  pruneConfirmedHostedTurnFailures,
} from '../src/api/chat-view-model';
import type { SingleConversation } from '../src/api/HermesCloudApi';

function conversation(overrides: Partial<SingleConversation> = {}): SingleConversation {
  return {
    id: 'conversation-1',
    messages: [],
    profile: 'default',
    title: 'Cloud conversation',
    ...overrides,
  };
}

test('hosted turn timeout produces one retryable terminal message', () => {
  const failure = hostedTurnVisibilityFailure('turn-timeout', false, 1_000);

  assert.equal(failure.turnId, 'turn-timeout');
  assert.equal(failure.message.id, 'hosted-sync-failed-turn-timeout');
  assert.equal(failure.message.status, 'failed');
  assert.equal(failure.message.createdAt, 1_000);
  assert.match(failure.message.content, /server did not confirm/i);
});

test('confirmed task removes legacy durable timeout notices without hiding other failures', () => {
  const timeout = hostedTurnVisibilityFailure('turn-1').message;
  const unknown = hostedTurnVisibilityFailure('turn-other').message;
  const actualFailure = { ...timeout, id: 'server-failed-1', content: 'Tool failed' };
  for (const status of ['running', 'completed', 'cancelled', 'failed']) {
    const snapshot = conversation({ hosted_turns: { 'turn-1': { status } } });
    assert.deepEqual(
      pruneConfirmedHostedTurnFailures(snapshot, [timeout, unknown, actualFailure]),
      [unknown, actualFailure],
    );
    assert.equal(reconcileHostedTurnVisibilityFailures(snapshot, [timeout], []).messages.length, 0);
  }
  assert.deepEqual(pruneConfirmedHostedTurnFailures(conversation(), [timeout]), [timeout]);
});

test('hosted turn visibility failure survives missing-state polls and clears on authority', () => {
  const failure = {
    turnId: 'turn-1',
    message: {
      content: 'Task was not confirmed',
      id: 'hosted-sync-failed-turn-1',
      name: 'Hermes Agent',
      role: 'assistant' as const,
      status: 'failed',
    },
  };
  const missing = reconcileHostedTurnVisibilityFailures(
    conversation(),
    [],
    [failure],
  );
  assert.deepEqual(missing.failures, [failure]);
  assert.deepEqual(missing.messages, [failure.message]);

  const repeated = reconcileHostedTurnVisibilityFailures(
    conversation(),
    missing.messages,
    missing.failures,
  );
  assert.equal(repeated.messages.length, 1);

  const authoritative = reconcileHostedTurnVisibilityFailures(
    conversation({ hosted_turns: { 'turn-1': { status: 'running' } } }),
    [],
    repeated.failures,
  );
  assert.deepEqual(authoritative, { failures: [], messages: [] });
});
