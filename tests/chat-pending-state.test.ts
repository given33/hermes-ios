import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPendingTurnState,
  pendingTurnReducer,
} from '../src/studio/chat/usePendingTurnState';

test('pending turn state preserves explicit phase timing and reconnect count', () => {
  const initial = createPendingTurnState(100);
  const reconnecting = pendingTurnReducer(initial, {
    attempt: 2,
    type: 'reconnect-attempt',
  });
  const executing = pendingTurnReducer(reconnecting, {
    phase: 'executing',
    startedAt: 250,
    type: 'phase',
  });

  assert.deepEqual(executing, {
    phase: 'executing',
    phaseStartedAt: 250,
    reconnectAttempt: 2,
  });
});

test('pending turn reset clears attempts and restores a fresh thinking clock', () => {
  const running = {
    phase: 'reconnecting' as const,
    phaseStartedAt: 200,
    reconnectAttempt: 5,
  };
  assert.deepEqual(pendingTurnReducer(running, { now: 900, type: 'reset' }), {
    phase: 'thinking',
    phaseStartedAt: 900,
    reconnectAttempt: 0,
  });
});
