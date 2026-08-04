import assert from 'node:assert/strict';
import test from 'node:test';

import type { HostedLifecycleEvent } from '../src/api/hosted-conversation-events';
import { applyHostedLifecycleEvents } from '../src/api/hosted-lifecycle-view-model';
import { messageDurationMs } from '../src/api/chat-view-model';

function event(
  cursor: number,
  eventType: string,
  payload: Record<string, unknown> = {},
): HostedLifecycleEvent {
  return {
    account_generation: 'generation-1',
    conversation_id: 'conversation-1',
    cursor,
    entity_id: typeof payload.entity_id === 'string' ? payload.entity_id : undefined,
    event_id: `event-${cursor}`,
    event_type: eventType,
    idempotency_key: `key-${cursor}`,
    occurred_at: 1_000 + cursor * 100,
    payload,
    role_stage: 'chat',
    schema_version: 'hermes.hosted-event.v1',
    sequence: cursor,
    turn_id: 'turn-1',
  };
}

test('hosted lifecycle waits for real reasoning content before thinking and timing begin', () => {
  const connected = applyHostedLifecycleEvents([], [event(1, 'agent.started', {
    model: 'model-1',
    provider: 'provider-1',
    source_event_type: 'session.info',
  })], false);
  assert.equal(connected.phase, undefined);
  assert.equal(connected.messages[0].timingLabel, undefined);
  assert.equal(connected.messages[0].startedAt, undefined);
  assert.equal(connected.messages[0].modelStartedAt, undefined);

  const accepted = applyHostedLifecycleEvents(connected.messages, [event(2, 'agent.started', {
    source_event_type: 'request.accepted',
  })], false);
  assert.equal(accepted.messages[0].modelStartedAt, 1_200);

  const started = applyHostedLifecycleEvents(accepted.messages, [
    event(3, 'thinking.started', { entity_id: 'thought-1' }),
  ], false);
  assert.equal(started.phase, undefined);
  assert.equal(started.messages[0].startedAt, undefined);

  const thinking = applyHostedLifecycleEvents(started.messages, [
    event(4, 'thinking.delta', { entity_id: 'thought-1', text: 'Inspecting ' }),
    event(5, 'thinking.delta', { entity_id: 'thought-1', text: 'the request.' }),
  ], false);
  assert.equal(thinking.phase, 'thinking');
  assert.equal(thinking.messages[0].startedAt, 1_400);
  assert.equal(thinking.messages[0].firstTokenAt, 1_400);
  assert.equal(thinking.messages[0].timingLabel, 'Thinking');
  assert.equal(thinking.messages[0].activities?.[0].output, 'Inspecting the request.');
});

test('empty thinking completion never creates a reasoning row or starts timing', () => {
  const result = applyHostedLifecycleEvents([], [
    event(1, 'agent.started', { source_event_type: 'request.accepted' }),
    event(2, 'thinking.started', { entity_id: 'thought-1' }),
    event(3, 'thinking.completed', { entity_id: 'thought-1' }),
  ], false);

  assert.equal(result.phase, undefined);
  assert.equal(result.messages[0].startedAt, undefined);
  assert.equal(result.messages[0].firstTokenAt, undefined);
  assert.equal(result.messages[0].activities?.length || 0, 0);
});

test('retry lifecycle is visible only while reconnecting', () => {
  const reconnecting = applyHostedLifecycleEvents([], [
    event(1, 'connection.retry_scheduled', { attempt: 2, max_attempts: 5 }),
  ], false);
  assert.equal(reconnecting.phase, 'reconnecting');
  assert.equal(reconnecting.messages[0].timingLabel, 'Reconnecting (2/5)');

  const recovered = applyHostedLifecycleEvents(reconnecting.messages, [
    event(2, 'connection.retry_finished', { attempt: 2, success: true }),
  ], false);
  assert.equal(recovered.phase, undefined);
  assert.equal(recovered.messages[0].timingLabel, undefined);
  assert.equal(recovered.messages[0].activities?.length || 0, 0);
});

test('hosted lifecycle streams answer chunks into one stable assistant message', () => {
  const connected = applyHostedLifecycleEvents([], [event(1, 'agent.started', {
    source_event_type: 'request.accepted',
  })], false);
  const streamed = applyHostedLifecycleEvents(connected.messages, [
    event(2, 'message.delta', { entity_id: 'message-1', text: 'Hello' }),
    event(3, 'message.delta', { entity_id: 'message-1', text: ', world' }),
  ], false);
  assert.equal(streamed.messages.length, 1);
  assert.equal(streamed.messages[0].id, connected.messages[0].id);
  assert.equal(streamed.messages[0].content, 'Hello, world');
  assert.equal(streamed.messages[0].timingLabel, 'Responding');
  assert.equal(streamed.phase, 'responding');

  const completed = applyHostedLifecycleEvents(streamed.messages, [
    event(4, 'message.completed', { entity_id: 'message-1', text: 'Hello, world' }),
    event(5, 'turn.completed'),
  ], false);
  assert.equal(completed.messages.length, 1);
  assert.equal(completed.messages[0].content, 'Hello, world');
  assert.equal(completed.messages[0].status, 'completed');
  assert.equal(messageDurationMs(completed.messages[0], 9_999), 400);
});

test('interim answer text stays in the same streaming message', () => {
  const streamed = applyHostedLifecycleEvents([], [
    event(1, 'message.interim', { text: 'Early answer', already_streamed: true }),
    event(2, 'message.completed', { text: 'Early answer completed' }),
  ], false);

  assert.equal(streamed.messages.length, 1);
  assert.equal(streamed.messages[0].content, 'Early answer completed');
  assert.equal(streamed.messages[0].status, 'completed');
});

test('official browser and MoA progress render as stable structured activities', () => {
  const result = applyHostedLifecycleEvents([], [
    event(1, 'browser.progress', { message: 'Opening result' }),
    event(2, 'browser.progress', { message: 'Reading page' }),
    event(3, 'moa.progress', { refs_done: 1, refs_total: 3, label: 'reference-a' }),
    event(4, 'moa.phase', { phase: 'aggregator', refs_done: 3, refs_total: 3 }),
  ], false);

  assert.equal(result.messages[0].activities?.length, 2);
  assert.equal(result.messages[0].activities?.[0].category, 'browser');
  assert.match(result.messages[0].activities?.[0].output || '', /Opening resultReading page/);
  assert.equal(result.messages[0].activities?.[1].category, 'subagent');
  assert.equal(result.messages[0].activities?.[1].output, 'MoA 3/3');
  assert.equal(result.turnActive, true);
});

test('official approval requests are visible without becoming model text or timing', () => {
  const result = applyHostedLifecycleEvents([], [
    event(1, 'approval.request', {
      command: 'rm file',
      description: 'Remove generated output',
      request_id: 'approval-1',
    }),
  ], false);

  assert.equal(result.messages[0].content, '');
  assert.equal(result.messages[0].firstTokenAt, undefined);
  assert.equal(result.messages[0].activities?.[0].id, 'approval-1');
  assert.equal(result.messages[0].activities?.[0].name, '需要审批');
});

test('voice and wake control events do not create chat bubbles or activate a turn', () => {
  const result = applyHostedLifecycleEvents([], [
    event(1, 'voice.status', { state: 'listening' }),
    event(2, 'voice.transcript', { text: 'hello' }),
    event(3, 'wake.detected', { phrase: 'hey hermes' }),
  ], false);

  assert.deepEqual(result.messages, []);
  assert.equal(result.turnActive, false);
});

test('official notices stay out of message content and do not start a turn', () => {
  const result = applyHostedLifecycleEvents([], [
    event(1, 'notification.show', { text: 'Credits are low' }),
    event(2, 'gateway.protocol_error', { preview: 'bad frame' }),
  ], false);

  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.notices, [
    'Credits are low',
    'Hermes gateway protocol error: bad frame',
  ]);
  assert.equal(result.turnActive, false);
});

test('gateway spinner and status events remain hidden before real model output', () => {
  const waiting = applyHostedLifecycleEvents([], [
    event(1, 'agent.started', { source_event_type: 'request.accepted' }),
    event(2, 'thinking.delta', {
      source_event_type: 'thinking.delta',
      text: 'Mulling...',
    }),
    event(3, 'command.output', {
      source_event_type: 'status.update',
      text: 'Connecting to model',
    }),
  ], false);

  assert.equal(waiting.phase, undefined);
  assert.equal(waiting.messages[0].activities?.length || 0, 0);
  assert.equal(waiting.messages[0].firstTokenAt, undefined);
  assert.equal(waiting.messages[0].timingLabel, undefined);
});

test('hosted lifecycle maps canonical tools into structured execution details', () => {
  const applied = applyHostedLifecycleEvents([], [
    event(1, 'agent.started', { source_event_type: 'request.accepted' }),
    event(2, 'tool.started', {
      entity_id: 'tool-1',
      name: 'browser.search',
      args: { query: 'Hermes 0.20' },
    }),
    event(3, 'tool.completed', {
      entity_id: 'tool-1',
      name: 'browser.search',
      result: { matches: 3 },
    }),
  ], false);
  const activity = applied.messages[0].activities?.[0];
  assert.equal(activity?.id, 'tool-1');
  assert.equal(activity?.category, 'browser');
  assert.equal(activity?.status, 'completed');
  assert.match(activity?.output || '', /matches/);
});

test('hosted lifecycle keeps subagent progress as a structured execution step', () => {
  const result = applyHostedLifecycleEvents([], [
    event(1, 'agent.started', {
      model: 'test-model',
      source_event_type: 'request.accepted',
    }),
    event(2, 'subagent.started', {
      child_session_id: 'child-1',
      profile: 'reviewer',
      text: 'Reviewing the result',
    }),
    event(3, 'subagent.completed', {
      child_session_id: 'child-1',
      profile: 'reviewer',
      summary: 'Review passed',
    }),
  ], true);

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].activities?.length, 1);
  assert.equal(result.messages[0].activities?.[0].category, 'subagent');
  assert.equal(result.messages[0].activities?.[0].status, 'completed');
});

test('official subagent spawn requests remain queued without starting token timing', () => {
  const result = applyHostedLifecycleEvents([], [
    event(1, 'subagent.queued', {
      child_session_id: 'child-queued',
      profile: 'reviewer',
    }),
  ], false);

  assert.equal(result.messages[0].activities?.[0].id, 'child-queued');
  assert.equal(result.messages[0].activities?.[0].status, 'queued');
  assert.equal(result.messages[0].firstTokenAt, undefined);
});

test('hosted lifecycle accumulates command output in one structured step', () => {
  const result = applyHostedLifecycleEvents([], [
    event(1, 'command.started', {
      command_id: 'command-1',
      command: 'git status',
    }),
    event(2, 'command.output', {
      command_id: 'command-1',
      text: 'line one\n',
    }),
    event(3, 'command.output', {
      command_id: 'command-1',
      text: 'line two',
    }),
    event(4, 'command.completed', {
      command_id: 'command-1',
    }),
  ], false);

  const activity = result.messages[0].activities?.[0];
  assert.equal(activity?.category, 'command');
  assert.equal(activity?.input, 'git status');
  assert.equal(activity?.output, 'line one\nline two');
  assert.equal(activity?.status, 'completed');
});

test('cancel request immediately closes the live turn', () => {
  const running = applyHostedLifecycleEvents([], [
    event(1, 'message.delta', { text: 'Working' }),
  ], false);
  const cancelled = applyHostedLifecycleEvents(running.messages, [
    event(2, 'turn.cancel_requested'),
  ], false);

  assert.equal(cancelled.messages[0].status, 'cancelled');
  assert.equal(cancelled.messages[0].timingLabel, undefined);
  assert.equal(cancelled.messages[0].completedAt, 1_200);
});
