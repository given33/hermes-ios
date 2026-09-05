import assert from 'node:assert/strict';
import test from 'node:test';
import { activityDetails, activitySourceUrl, activityStatusLabel } from '../src/studio/workflow-detail-model';
import { streamEventToActivity, type HermesChatActivity } from '../src/api/chat-view-model';
import { normalizeOfficialSessionMessages } from '../src/api/official-session-adoption';

const activity = (overrides: Partial<HermesChatActivity> = {}): HermesChatActivity => ({
  id: 'tool-1', category: 'tool', name: 'tool', duration: '', preview: '', status: 'completed', ...overrides,
});

test('official tool names distinguish search, reading, changes, schedules, collaboration and unknown tools', () => {
  for (const [name, category] of Object.entries({ web_search: 'search', web_extract: 'browser',
    browser_navigate: 'browser', file_read: 'file', apply_patch: 'edit', file_edit: 'edit',
    terminal: 'command', cronjob: 'schedule', delegate_task: 'subagent', mystery_tool: 'tool' })) {
    assert.equal(streamEventToActivity('tool.start', { tool_name: name })?.category, category);
  }
});

test('live waiting, running, failure and cancellation events never become success', () => {
  for (const [event, status] of [['tool.queued', 'queued'], ['tool.start', 'running'],
    ['tool.cancelled', 'cancelled'], ['command.cancelled', 'cancelled'], ['tool.end', 'completed']]) {
    assert.equal(streamEventToActivity(event, { tool_id: 'one' })?.status, status);
  }
  assert.equal(streamEventToActivity('tool.end', { error: 'network unavailable' })?.status, 'failed');
  assert.equal(streamEventToActivity('tool.end', { status: 'cancelled' })?.status, 'cancelled');
  assert.equal(new Set(['queued', 'running', 'completed', 'failed', 'cancelled'].map(
    (status) => activityStatusLabel(status as HermesChatActivity['status'], true))).size, 5);
});

test('call identifiers remain stable across replay and preserve parent task attribution', () => {
  const start = streamEventToActivity('tool.start', { call_id: 'call-1', parent_call_id: 'agent-1' }, 1000);
  const end = streamEventToActivity('tool.end', { tool_call_id: 'call-1' }, 2000);
  assert.equal(start?.id, end?.id);
  assert.equal(start?.parentCallId, 'agent-1');
  assert.equal(end?.callId, 'call-1');
});

test('sources preserve real titles, deduplicate URLs and refuse non-web or credential URLs', () => {
  const detail = activityDetails(activity({ input: JSON.stringify({ query: 'Hermes', url: 'https://example.com/' }),
    output: JSON.stringify({ results: [
      { title: 'Hermes', url: 'https://example.com', snippet: 'A source excerpt' },
      { url: 'https://example.com/' }, { url: 'javascript:alert(1)' }, { url: 'https://user:pass@example.com' },
    ] }) }));
  assert.deepEqual(detail.sources, [{ title: 'Hermes', url: 'https://example.com/', description: 'A source excerpt' }]);
  assert.deepEqual(detail.fields[0], { key: 'query', value: 'Hermes' });
  for (const url of ['file:///secret', 'data:text/html,test', 'not a url']) assert.equal(activitySourceUrl(url), null);
});

test('edit arguments produce requested diffs without claiming a failed edit was applied', () => {
  const detail = activityDetails(activity({ status: 'failed', input: JSON.stringify({
    path: 'src/main.ts', old_text: 'const value = 1;\n', new_text: 'const value = 2;\n',
  }) }));
  assert.equal(detail.change?.requested, true);
  assert.match(detail.change?.patch || '', /-const value = 1;/);
  assert.match(detail.change?.patch || '', /\+const value = 2;/);
  const reported = activityDetails(activity({ output: JSON.stringify({ diff: '@@ -1 +1 @@\n-a\n+b' }) }));
  assert.equal(reported.change?.requested, false);
});

test('oversized or malformed payloads remain accessible as raw output', () => {
  const text = '{' + 'x'.repeat(250_000);
  assert.equal(activityDetails(activity({ output: text })).output, text);
  assert.deepEqual(activityDetails(activity({ input: '{invalid' })).fields, [{ key: 'tool', value: 'tool' }]);
});

test('official history retains structured tool arguments and results for detail rendering', () => {
  const messages = normalizeOfficialSessionMessages([
    { role: 'assistant', tool_calls: [{ id: 'search-1', function: { name: 'web_search', arguments: { query: 'Hermes' } } }] },
    { role: 'tool', tool_call_id: 'search-1', content: { results: [{ title: 'Reference', url: 'https://example.com' }] } },
  ], 'research', 'session-1');
  const restored = (messages[0].meta?.activities as Record<string, unknown>[])[0];
  assert.deepEqual(JSON.parse(String(restored.input)), { query: 'Hermes' });
  assert.equal(activityDetails(activity({ input: String(restored.input), output: String(restored.output) })).sources[0].title, 'Reference');
});
