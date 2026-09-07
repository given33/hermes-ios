import assert from 'node:assert/strict';
import test from 'node:test';
import { chatExecutionPhases, executionReportText } from '../src/api/chat-execution-phases';

test('internal planning JSON exposes assignments without leaking partial protocol text', () => {
  const message = { rawRoleStage: 'manager_planning' };
  assert.equal(executionReportText(message, '{"workers":['), '');
  const plan = JSON.stringify({ workers: ['dbb3-worker'], plan: [{ assignee: 'dbb3-worker', title: 'Check hostname' }] });
  assert.equal(executionReportText(message, plan), 'dbb3-worker: Check hostname');
  assert.equal(executionReportText({ rawRoleStage: 'chat' }, plan), plan);
  assert.equal(executionReportText(message, 'Preparing a plan'), 'Preparing a plan');
});
import { applyHostedLifecycleEvents } from '../src/api/hosted-lifecycle-view-model';
import type { HostedLifecycleEvent } from '../src/api/hosted-conversation-events';

test('each model pass streams its own report, reasoning and tools before the separate final', () => {
  let cursor = 0;
  let state = applyHostedLifecycleEvents([], []);
  const send = (event_type: string, payload: Record<string, unknown>) => {
    cursor++;
    const event: HostedLifecycleEvent = {
      account_generation: 'g', conversation_id: 'c', cursor, event_id: String(cursor),
      event_type, idempotency_key: String(cursor), occurred_at: 1000 + cursor * 100,
      payload, role_stage: 'chat', schema_version: 'hermes.hosted-event.v1', sequence: cursor, turn_id: 'turn',
    };
    state = applyHostedLifecycleEvents(state.messages, [event], true, state.runtime);
    return state.messages[0];
  };
  send('reasoning.delta', { text: 'Inspect ' });
  send('reasoning.delta', { text: 'request' });
  let message = send('message.delta', { text: 'Searching now' });
  assert.equal(chatExecutionPhases(message)[0].reports[0].content, 'Searching now');
  send('reasoning.available', { text: 'Inspect request' });
  send('message.interim', { text: 'Searching now' });
  send('message.interim', { text: 'Searching now' });
  send('tool.started', { entity_id: 'search', name: 'web_search', args: { query: 'profiles' } });
  send('tool.completed', { entity_id: 'search', name: 'web_search', result: 'page' });
  message = send('reasoning.delta', { text: 'Read ' });
  assert.equal(chatExecutionPhases(message).length, 2);
  assert.equal(chatExecutionPhases(message)[1].activities[0].output, 'Read ');
  send('reasoning.delta', { text: 'the page' });
  send('reasoning.available', { text: 'Read the page' });
  send('message.interim', { text: 'Reading the official page' });
  send('tool.started', { entity_id: 'read', name: 'web_extract', args: { url: 'https://hermes-agent.nousresearch.com/' } });
  send('tool.completed', { entity_id: 'read', name: 'web_extract', result: 'documentation' });
  message = send('message.completed', { text: 'Done' });
  assert.equal(message.content, 'Done');
  assert.equal(message.status, 'completed');
  const phases = chatExecutionPhases(message);
  assert.deepEqual(phases.map(phase => phase.reports.map(report => report.content)), [['Searching now'], ['Reading the official page']]);
  assert.deepEqual(phases.map(phase => phase.activities.filter(activity => activity.category === 'reasoning').map(activity => activity.output)), [['Inspect request'], ['Read the page']]);
  assert.deepEqual(phases.map(phase => phase.activities.filter(activity => activity.category !== 'reasoning').map(activity => activity.id)), [['search'], ['read']]);
});
