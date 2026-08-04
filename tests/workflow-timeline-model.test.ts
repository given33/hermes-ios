import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesChatActivity } from '../src/api/chat-view-model';
import {
  activityElapsedLabel,
  activityIsRunning,
  activityPrimaryDetail,
  clampActivityText,
  createTimelineCollapseState,
  firstTokenLabel,
  formatDurationLabel,
  groupTimelineActivities,
  isTimelineEntryExpanded,
  reasoningElapsedLabel,
  reasoningPreviewLine,
  timelineCollapseReducer,
  timelineEntryLiveStates,
  timelineGroupElapsedLabel,
  turnPhaseChip,
  turnTimingLine,
} from '../src/studio/workflow-timeline-model';

function activity(overrides: Partial<HermesChatActivity> = {}): HermesChatActivity {
  return {
    category: 'command',
    duration: '',
    id: 'activity-1',
    name: '命令行',
    preview: '命令行',
    status: 'completed',
    ...overrides,
  };
}

test('the in-flight entry auto-expands and auto-collapses once it settles', () => {
  let state = createTimelineCollapseState();
  state = timelineCollapseReducer(state, {
    entries: [{ id: 'a', running: true }, { id: 'b', running: false }],
    type: 'sync',
  });
  assert.equal(isTimelineEntryExpanded(state, 'a'), true);
  assert.equal(isTimelineEntryExpanded(state, 'b'), false);

  state = timelineCollapseReducer(state, {
    entries: [{ id: 'a', running: false }, { id: 'b', running: true }],
    type: 'sync',
  });
  assert.equal(isTimelineEntryExpanded(state, 'a'), false);
  assert.equal(isTimelineEntryExpanded(state, 'b'), true);

  state = timelineCollapseReducer(state, {
    entries: [{ id: 'a', running: false }, { id: 'b', running: false }],
    type: 'sync',
  });
  assert.equal(isTimelineEntryExpanded(state, 'b'), false);
});

test('a manual toggle pins the entry against every later automatic transition', () => {
  let state = createTimelineCollapseState();
  state = timelineCollapseReducer(state, {
    entries: [{ id: 'a', running: true }],
    type: 'sync',
  });
  // The user collapses the auto-expanded running entry; sync must not
  // re-expand it while it keeps running.
  state = timelineCollapseReducer(state, { id: 'a', type: 'toggle' });
  assert.equal(isTimelineEntryExpanded(state, 'a'), false);
  state = timelineCollapseReducer(state, {
    entries: [{ id: 'a', running: true }],
    type: 'sync',
  });
  assert.equal(isTimelineEntryExpanded(state, 'a'), false);

  // The user expands a terminal entry; completion syncs never collapse it.
  state = timelineCollapseReducer(state, { id: 'b', type: 'toggle' });
  assert.equal(isTimelineEntryExpanded(state, 'b'), true);
  state = timelineCollapseReducer(state, {
    entries: [{ id: 'a', running: false }, { id: 'b', running: false }],
    type: 'sync',
  });
  assert.equal(isTimelineEntryExpanded(state, 'b'), true);
});

test('a sync without changes returns the identical state object', () => {
  let state = createTimelineCollapseState();
  state = timelineCollapseReducer(state, {
    entries: [{ id: 'a', running: true }],
    type: 'sync',
  });
  const next = timelineCollapseReducer(state, {
    entries: [{ id: 'a', running: true }],
    type: 'sync',
  });
  assert.equal(next, state);
});

test('three or more consecutive completed steps of one tool fold into a group', () => {
  const read = (id: string) => activity({
    category: 'file',
    id,
    name: '文件操作',
    toolName: 'read_file',
  });
  const entries = groupTimelineActivities([
    read('r1'),
    read('r2'),
    read('r3'),
    activity({ category: 'command', id: 'c1', name: '命令行' }),
    read('r4'),
    read('r5'),
  ]);
  assert.deepEqual(
    entries.map(({ id, kind }) => ({ id, kind })),
    [
      { id: 'group:r1:r3', kind: 'group' },
      { id: 'c1', kind: 'step' },
      { id: 'r4', kind: 'step' },
      { id: 'r5', kind: 'step' },
    ],
  );
  assert.equal(entries[0].activities.length, 3);
});

test('running and failed steps never disappear into a group', () => {
  const read = (id: string, status: HermesChatActivity['status'] = 'completed') => activity({
    category: 'file',
    id,
    name: '文件操作',
    status,
    toolName: 'read_file',
  });
  const entries = groupTimelineActivities([
    read('r1'),
    read('r2'),
    read('r3', 'failed'),
    read('r4', 'running'),
  ]);
  assert.deepEqual(entries.map(({ kind }) => kind), ['step', 'step', 'step', 'step']);
  const live = timelineEntryLiveStates(entries);
  assert.deepEqual(live.map(({ running }) => running), [false, false, false, true]);
});

test('the collapsed line surfaces the command, path, or query of the step', () => {
  assert.equal(
    activityPrimaryDetail(activity({
      input: '{"command":"npm test -- tests/a.test.ts"}',
    })),
    'npm test -- tests/a.test.ts',
  );
  assert.equal(
    activityPrimaryDetail(activity({
      category: 'file',
      input: '{"content":"...","path":"src/studio/PreviewChatPage.tsx"}',
      name: '文件操作',
    })),
    'src/studio/PreviewChatPage.tsx',
  );
  assert.equal(
    activityPrimaryDetail(activity({
      category: 'search',
      input: '{"query":"hermes timeline"}',
      name: '搜索',
    })),
    'hermes timeline',
  );
  assert.equal(
    activityPrimaryDetail(activity({ input: 'ls -la\npwd' })),
    'ls -la',
  );
  assert.equal(
    activityPrimaryDetail(activity({
      category: 'status',
      name: '运行状态',
      preview: '正在思考',
    })),
    '正在思考',
  );
  assert.equal(
    activityPrimaryDetail(activity({ category: 'status', name: '运行状态', preview: '运行状态' })),
    '',
  );
});

test('long outputs clamp with an accurate hidden-line count', () => {
  const short = clampActivityText('one\ntwo');
  assert.deepEqual(short, { clamped: false, hiddenLineCount: 0, text: 'one\ntwo' });

  const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n');
  const byLines = clampActivityText(lines);
  assert.equal(byLines.clamped, true);
  assert.equal(byLines.hiddenLineCount, 6);
  assert.equal(byLines.text.split('\n').length, 24);

  const byCharacters = clampActivityText('x'.repeat(2_000));
  assert.equal(byCharacters.clamped, true);
  assert.equal(byCharacters.text.length, 1_600);
  assert.equal(byCharacters.hiddenLineCount, 1);
});

test('the phase chip follows the persisted runtime states and terminal status', () => {
  assert.deepEqual(
    turnPhaseChip({ status: 'running', timingLabel: '正在执行' }, true),
    { label: '正在执行', tone: 'running' },
  );
  assert.deepEqual(
    turnPhaseChip({ roleStage: 'reviewer', status: 'running' }, false),
    { label: 'Reviewing', tone: 'running' },
  );
  assert.deepEqual(
    turnPhaseChip({ roleStage: 'chat', status: 'queued' }, false),
    { label: 'Thinking', tone: 'running' },
  );
  assert.deepEqual(
    turnPhaseChip({ status: 'completed' }, false),
    { label: 'Completed', tone: 'ok' },
  );
  assert.deepEqual(
    turnPhaseChip({ status: 'failed' }, true),
    { label: '失败', tone: 'failed' },
  );
  assert.deepEqual(
    turnPhaseChip({ status: 'stopped' }, false),
    { label: 'Cancelled', tone: 'cancelled' },
  );
});

test('the timing line exposes the first-token boundary and terminal elapsed time', () => {
  assert.equal(
    firstTokenLabel({ createdAt: 1_000, firstTokenAt: 1_900 }, false),
    'First token 900 ms',
  );
  assert.equal(firstTokenLabel({ createdAt: 1_000, firstTokenAt: 1_000 }, false), '');
  assert.equal(
    turnTimingLine({
      completedAt: 4_500,
      createdAt: 1_000,
      firstTokenAt: 1_900,
      startedAt: 1_000,
      status: 'completed',
    }, false),
    'First token 900 ms · Total 3 s',
  );
  assert.equal(
    turnTimingLine({ startedAt: 1_000, status: 'running' }, true, 13_000),
    '12 s',
  );
  assert.equal(
    turnTimingLine({
      durationMs: 21_000,
      firstTokenAt: 27_000,
      startedAt: 1_000,
      status: 'completed',
    }, false),
    'First token 26 s \u00b7 Total 26 s',
  );
});

test('reasoning previews the first settled line or the newest streamed line', () => {
  const text = '先梳理需求。\n\n然后检查两条链路。';
  assert.equal(reasoningPreviewLine(text), '先梳理需求。');
  assert.equal(reasoningPreviewLine(text, true), '然后检查两条链路。');
  assert.equal(reasoningPreviewLine('   '), '');
});

test('elapsed labels stay live for running work and settle with the record', () => {
  assert.equal(activityIsRunning(activity({ status: 'queued' })), true);
  assert.equal(
    activityElapsedLabel(activity({ startedAt: 5_000, status: 'running' }), 10_000),
    '5 s',
  );
  assert.equal(activityElapsedLabel(activity({ duration: '0.6s' })), '0.6s');
  assert.equal(activityElapsedLabel(activity({ durationMs: 340 })), '340 ms');
  assert.equal(
    timelineGroupElapsedLabel([
      activity({ durationMs: 400 }),
      activity({ completedAt: 2_000, id: 'a2', startedAt: 1_000 }),
    ]),
    '1 s',
  );
  assert.equal(
    reasoningElapsedLabel([
      activity({ category: 'reasoning', startedAt: 1_000, status: 'running' }),
    ], 4_000),
    '3 s',
  );
  assert.equal(formatDurationLabel(0), '');
  assert.equal(formatDurationLabel(75_000), '1m 15s');
});
