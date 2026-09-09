import assert from 'node:assert/strict';
import test from 'node:test';
import type { HermesChatViewMessage } from '../src/api/chat-view-model';
import { buildConversationTimeline, timelineBarWidth, timelineTurnAtOffset } from '../src/studio/chat/conversation-timeline-model';

const task: HermesChatViewMessage = { id: 'local', renderKey: 'stable', role: 'user', name: 'User', content: 'Review \u{1F680}' };

test('only user instructions become navigation entries, stable through streaming and ID reconciliation', () => {
  const entries = buildConversationTimeline([task]);
  const reply: HermesChatViewMessage = { id: 'assistant', role: 'assistant', name: 'Hermes', content: 'Working' };
  assert.equal(buildConversationTimeline([{ ...task, id: 'server-id' }, reply], entries), entries);
  assert.equal(entries[0].length, 8);
  assert.equal(entries[0].id, 'stable');
  const changed = buildConversationTimeline([{ ...task, content: 'New instruction' }], entries);
  assert.notEqual(changed, entries);
  assert.equal(changed[0].prompt, 'New instruction');
  assert.deepEqual(buildConversationTimeline([], changed), []);
});

test('waveform length is monotonic and bounded for empty and very long prompts', () => {
  let previous = 0;
  for (const length of [0, 1, 10, 100, 1000, 100000]) {
    const width = timelineBarWidth(length, 1000);
    assert.ok(width >= previous && width >= 8 && width <= 32);
    previous = width;
  }
  assert.equal(timelineBarWidth(0, 0), 8);
});

test('current task follows measured boundaries after layout changes and history navigation', () => {
  const anchors = [{ id: 'one', y: 20 }, { id: 'two', y: 500 }, { id: 'three', y: 1500 }];
  assert.equal(timelineTurnAtOffset([], 100), '');
  assert.equal(timelineTurnAtOffset(anchors, -20), 'one');
  assert.equal(timelineTurnAtOffset(anchors, 488), 'two');
  assert.equal(timelineTurnAtOffset(anchors, 2000), 'three');
  assert.equal(timelineTurnAtOffset([{ ...anchors[0] }, { id: 'two', y: 900 }], 488), 'one');
  assert.equal(timelineTurnAtOffset(anchors, 700, 700), 'three');
  assert.equal(timelineTurnAtOffset(anchors, 600, 700), 'two');
  assert.equal(timelineTurnAtOffset(anchors, 0, 0), 'one');
});

test('the longest prompt can appear anywhere and a large paste keeps shorter bars distinguishable', () => {
  const widths = [40, 400, 80, 50000].map(length => timelineBarWidth(length, 50000));
  assert.ok(widths[1] - widths[0] > 4);
  assert.ok(widths[3] > widths[1] && widths[1] > widths[2] && widths[2] > widths[0]);
});
