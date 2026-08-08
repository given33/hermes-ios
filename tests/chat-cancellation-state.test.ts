import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  conversationHostedTurnCancellationAuthority,
} from '../src/api/chat-view-model';
import type { SingleConversation } from '../src/api/HermesCloudApi';

function conversation(hostedTurn: Record<string, unknown>): SingleConversation {
  return {
    hosted_turns: { 'turn-1': hostedTurn },
    id: 'conversation-1',
    message_count: 1,
    messages: [{
      content: 'run it',
      id: 'message-1',
      name: 'You',
      role: 'user',
    }],
    profile: 'default',
    title: 'Cancellation race',
    updated_at: 100,
  };
}

test('cancel requested remains non-terminal until the server publishes authority', () => {
  assert.equal(conversationHostedTurnCancellationAuthority(conversation({
    cancel_requested: true,
    stage: 'cancel_requested',
    status: 'running',
    turn_id: 'turn-1',
    updated_at: 100,
  }), 'turn-1'), 'cancel_requested');
  assert.equal(conversationHostedTurnCancellationAuthority(conversation({
    status: 'cancelled',
    turn_id: 'turn-1',
    updated_at: 200,
  }), 'turn-1'), 'cancelled');
  assert.equal(conversationHostedTurnCancellationAuthority(conversation({
    status: 'completed',
    turn_id: 'turn-1',
    updated_at: 200,
  }), 'turn-1'), 'completed');
});

test('the iOS cancellation flow retains its outbox until snapshot reconciliation', () => {
  const cancellation = readFileSync(
    resolve(process.cwd(), 'src/studio/chat/useHostedCancellationController.ts'),
    'utf8',
  );
  const actions = readFileSync(
    resolve(process.cwd(), 'src/studio/chat/useConversationActionsController.ts'),
    'utf8',
  );

  assert.match(cancellation, /deliveryAcceptedAt: Date\.now\(\)[\s\S]*getConversation/);
  assert.match(cancellation, /authority === 'cancelled'[\s\S]*removePendingEnqueue/);
  assert.match(cancellation, /authority === 'missing'[\s\S]*reconciliationAttempts >= 5/);
  assert.match(cancellation, /claimPendingEnqueueByRequest/);
  assert.match(cancellation, /phase: 'cancel_requested'/);
  assert.match(cancellation, /updatePendingPhase\('thinking', 0\)/);
  assert.doesNotMatch(cancellation, /updatePendingPhase\('executing', Date\.now\(\)\)/);
  assert.match(actions, /正在取消任务/);
  // Cancellation is optimistic: the local streaming UI stops immediately
  // after the cancel POST is durable, without waiting for the server's
  // terminal event.
  assert.match(
    actions,
    /upsertPendingEnqueue\([\s\S]{0,1200}setHostedRunning\(false\)[\s\S]{0,400}setSending\(false\)/,
  );
});
