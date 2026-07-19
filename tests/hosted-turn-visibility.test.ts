import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hostedTurnVisibilityFailure,
  reconcileHostedTurnVisibilityFailures,
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
