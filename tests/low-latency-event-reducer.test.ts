import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OrderedLowLatencyReducer,
  lowLatencyEventToAgentGroupEvent,
  removeThinkingPlaceholders,
  thinkingPlaceholderId,
} from '../src/studio/agent-group/low-latency-event-reducer';
import { emptyRoomSnapshot } from '../src/studio/agent-group/agent-group-model';

const room = {
  id: 'room-1', name: 'Room', ownerId: 'owner', createdAt: 1, updatedAt: 1,
  profiles: [], hostedTurns: {}, members: [], agents: [],
} as any;

test('low-latency message normalization keeps missing timestamps deterministic', () => {
  const event = {
    event_id: 'missing-timestamp',
    type: 'assistant.message',
    payload: {
      message: { id: 'message-1', role: 'assistant', content: 'hello', sender_name: 'Hermes' },
    },
  };
  const first = lowLatencyEventToAgentGroupEvent(event, room.id) as any;
  const second = lowLatencyEventToAgentGroupEvent(event, room.id) as any;
  assert.equal(first.type, 'message');
  assert.deepEqual(second.message, first.message);
  assert.equal(first.message.timestamp, 0);
});

test('ordered reducer applies manager/assistant deltas once and fences duplicates', () => {
  const reducer = new OrderedLowLatencyReducer();
  let snapshot = emptyRoomSnapshot(room);
  snapshot = reducer.reduce(snapshot, {
    sequence: 1, event_id: 'e1', type: 'assistant.message',
    payload: { message: { id: 'm1', role: 'assistant', content: '', sender_name: 'Hermes' } },
  });
  snapshot = reducer.reduce(snapshot, {
    sequence: 2, event_id: 'e2', type: 'assistant.delta',
    payload: { message_id: 'm1', delta: '你好' },
  });
  snapshot = reducer.reduce(snapshot, {
    sequence: 2, event_id: 'e2', type: 'assistant.delta',
    payload: { message_id: 'm1', delta: '你好' },
  });
  assert.equal(snapshot.messages[0]?.content, '你好');
  assert.equal(reducer.sequence, 2);
});

test('account reset starts an independent sequence window', () => {
  const reducer = new OrderedLowLatencyReducer();
  reducer.reduce(emptyRoomSnapshot(room), { sequence: 9, event_id: 'old', type: 'room.cleared', payload: {} });
  reducer.reset();
  assert.equal(reducer.sequence, 0);
  const next = reducer.reduce(emptyRoomSnapshot(room), {
    sequence: 1, event_id: 'new', type: 'assistant.message',
    payload: { message: { id: 'new-message', role: 'assistant', content: 'new' } },
  });
  assert.equal(next.messages[0]?.content, 'new');
});

test('equal transport cursors preserve distinct ordered events', () => {
  const reducer = new OrderedLowLatencyReducer();
  let snapshot = emptyRoomSnapshot(room);
  snapshot = reducer.reduce(snapshot, {
    cursor: 7,
    sequence: 7,
    event_id: 'message',
    type: 'assistant.message',
    payload: { message: { id: 'm1', role: 'assistant', content: '', timestamp: 1 } },
  });
  snapshot = reducer.reduce(snapshot, {
    cursor: 7,
    sequence: 7,
    event_id: 'started',
    type: 'worker.started',
    payload: { node_id: 'pc-worker' },
  });
  snapshot = reducer.reduce(snapshot, {
    cursor: 7,
    sequence: 7,
    event_id: 'delta',
    type: 'assistant.delta',
    payload: { message_id: 'm1', delta: 'same-boundary' },
  });
  assert.equal(snapshot.runningAgents.includes('pc-worker'), true);
  assert.equal(snapshot.messages.some((message) => message.content === 'same-boundary'), true);
  assert.equal(reducer.sequence, 7);

  const stale = reducer.reduce(snapshot, {
    cursor: 6,
    sequence: 6,
    event_id: 'stale',
    type: 'assistant.delta',
    payload: { message_id: 'm1', delta: 'stale' },
  });
  assert.equal(stale, snapshot);
});

test('server-backed sequence reset accepts the lower-sequence replay', () => {
  const reducer = new OrderedLowLatencyReducer();
  let snapshot = emptyRoomSnapshot(room);
  snapshot = reducer.reduce(snapshot, {
    sequence: 9, event_id: 'old', type: 'assistant.message',
    payload: { message: { id: 'old-message', role: 'assistant', content: 'old', timestamp: 1 } },
  });

  snapshot = reducer.reduce(snapshot, { sequence: 0, event_id: 'reset', type: 'sequence.reset', payload: {} });
  snapshot = reducer.reduce(snapshot, {
    sequence: 1, event_id: 'new', type: 'assistant.message',
    payload: { message: { id: 'new-message', role: 'assistant', content: '', timestamp: 2 } },
  });
  snapshot = reducer.reduce(snapshot, {
    sequence: 2, event_id: 'new-delta', type: 'assistant.delta',
    payload: { message_id: 'new-message', delta: 'replayed', timestamp: 2 },
  });
  assert.equal(reducer.sequence, 2);
  assert.equal(reducer.sequence, 2);
  assert.equal(snapshot.messages.at(-1)?.content, 'replayed');
});

test('thinking placeholder is removed only after a real assistant event exists', () => {
  const thinking = {
    id: thinkingPlaceholderId('request-1'), roomId: room.id, senderId: 'hermes-manager',
    senderName: 'Hermes Manager', content: '', role: 'assistant', isStreaming: true,
    deliveryStatus: 'pending', timestamp: 1,
  } as any;
  const user = {
    id: 'request-1', roomId: room.id, senderId: 'user', senderName: 'User',
    content: '你好', role: 'user', deliveryStatus: 'sent', timestamp: 1,
  } as any;
  assert.equal(removeThinkingPlaceholders([user, thinking]).length, 2);
  const assistant = { ...thinking, id: 'assistant-1', content: '你好！', isStreaming: false, deliveryStatus: 'sent' };
  const cleaned = removeThinkingPlaceholders([user, thinking, assistant]);
  assert.deepEqual(cleaned.map((message) => message.id), ['request-1', 'assistant-1']);
});

test('a recreated room must not inherit the previous room ordering window', () => {
  // Mirrors the controller contract: lowLatencyReducersRef maps roomId ->
  // OrderedLowLatencyReducer and is pruned whenever the room's lifecycle
  // ends (list refresh prune + removeRoomFromState).
  const reducers = new Map<string, OrderedLowLatencyReducer>();
  const reducerFor = (roomId: string): OrderedLowLatencyReducer => {
    let reducer = reducers.get(roomId);
    if (!reducer) {
      reducer = new OrderedLowLatencyReducer();
      reducers.set(roomId, reducer);
    }
    return reducer;
  };

  const advance = (roomId: string) => {
    let snapshot = emptyRoomSnapshot(room);
    snapshot = reducerFor(roomId).reduce(snapshot, {
      sequence: 9,
      event_id: 'old-window',
      type: 'assistant.message',
      payload: { message: { id: 'old-message', role: 'assistant', content: 'old', timestamp: 1 } },
    });
    return snapshot;
  };
  advance('room-1');

  // Room recreation: the controller drops every per-room state entry,
  // including the ordered reducer, before the next event arrives.
  reducers.delete('room-1');

  const recreated = reducerFor('room-1').reduce(emptyRoomSnapshot(room), {
    sequence: 1,
    event_id: 'new-window',
    type: 'assistant.message',
    payload: { message: { id: 'new-message', role: 'assistant', content: 'fresh', timestamp: 2 } },
  });
  assert.equal(recreated.messages[0]?.content, 'fresh');
});

test('controller retires the room reducer on removal and list-refresh prune', () => {
  // Source contract (same style as ios-context-native.test.ts): both
  // lifecycle paths must retire the orphaned per-room reducer so a room
  // recreated under the same id starts a fresh ordered window.
  const source = readFileSync(resolve(
    process.cwd(),
    'src/studio/agent-group/useAgentGroupChatController.ts',
  ), 'utf8');
  const removeRoomFromState = source.slice(
    source.indexOf('const removeRoomFromState'),
    source.indexOf('const deleteRoom'),
  );
  assert.match(removeRoomFromState, /lowLatencyReducersRef\.current\.delete\(roomId\)/);
  const applyRoomList = source.slice(
    source.indexOf('const applyRoomList'),
    source.indexOf('const hydrateCachedRooms'),
  );
  assert.match(applyRoomList, /if \(!roomIds\.has\(roomId\)\) \{[\s\S]*?lowLatencyReducersRef\.current\.delete\(roomId\)/);
});

test('a previous turn streaming does not remove the new thinking placeholder', () => {
  const previous = {
    id: 'assistant-old', roomId: room.id, senderId: 'hermes-manager',
    senderName: 'Hermes Manager', content: '仍在生成', role: 'assistant',
    isStreaming: true, timestamp: 10,
  } as any;
  const current = {
    id: thinkingPlaceholderId('request-new'), roomId: room.id, senderId: 'hermes-manager',
    senderName: 'Hermes Manager', content: '', role: 'assistant',
    isStreaming: true, deliveryStatus: 'pending', timestamp: 20,
  } as any;
  assert.deepEqual(removeThinkingPlaceholders([previous, current]).map((message) => message.id), [
    'assistant-old', thinkingPlaceholderId('request-new'),
  ]);
});
