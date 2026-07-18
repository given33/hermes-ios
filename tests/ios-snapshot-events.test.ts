import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCollectionSnapshotEvents } from '../src/context/ios-snapshot-events';

test('calendar snapshots publish exact current IDs and immutable content revisions', () => {
  const first = buildCollectionSnapshotEvents('calendar', [{
    id: 'event-1',
    start: 1_000,
    end: 2_000,
    title: 'Holiday',
  }], 10_000, 'iphone');
  const edited = buildCollectionSnapshotEvents('calendar', [{
    id: 'event-1',
    start: 1_000,
    end: 2_000,
    title: 'Work',
  }], 20_000, 'iphone');

  assert.notEqual(first[0].id, edited[0].id);
  assert.equal(first[0].timestamp, 1_000);
  assert.deepEqual(first[1].payload.ids, ['event-1']);
  assert.deepEqual(first[1].payload.versions, { 'event-1': first[0].id });
  assert.deepEqual(edited[1].payload.versions, { 'event-1': edited[0].id });
  assert.notEqual(first[1].id, edited[1].id);
  assert.equal(edited[1].source_device_id, 'iphone');
});

test('empty reminder snapshots publish a deletion-capable collection index', () => {
  const events = buildCollectionSnapshotEvents('reminder', [], 30_000, 'iphone');

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'reminder-index');
  assert.deepEqual(events[0].payload.ids, []);
  assert.deepEqual(events[0].payload.versions, {});
});

test('collection records without an EventKit ID receive a deterministic identity', () => {
  const item = { start: 1_000, end: 2_000, title: 'Untitled source' };
  const first = buildCollectionSnapshotEvents('calendar', [item], 10_000, 'iphone');
  const retry = buildCollectionSnapshotEvents('calendar', [item], 20_000, 'iphone');

  assert.equal(first[0].id, retry[0].id);
  assert.match(String(first[0].payload.id), /^content:[0-9a-f]{8}$/);
});
