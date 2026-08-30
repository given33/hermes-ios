import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  consumeKanbanEventsWebSocket,
  kanbanEventBoardFromRouteData,
  kanbanEventCursorFromBoard,
  type KanbanEventWebSocketSource,
} from '../src/api/kanban-events';

class FakeKanbanEventSocket {
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  close() {
    this.closed = true;
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function flushEvents() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('Kanban event stream resumes at the board cursor and advances once per batch', async () => {
  const socket = new FakeKanbanEventSocket();
  const calls: unknown[][] = [];
  const source: KanbanEventWebSocketSource = {
    openKanbanEventsWebSocket(...args) {
      calls.push(args);
      return Promise.resolve(socket as unknown as WebSocket);
    },
  };
  const controller = new AbortController();
  const cursors: number[] = [];
  const consuming = consumeKanbanEventsWebSocket(
    source,
    kanbanEventCursorFromBoard({ latest_event_id: 40 }),
    'hk',
    controller.signal,
    (frame) => { cursors.push(frame.cursor); },
    4_000,
  );
  await flushEvents();

  socket.emit({
    cursor: 42,
    events: [
      { id: 41, task_id: 'task-1', kind: 'status' },
      { id: 42, task_id: 'task-2', kind: 'completed' },
    ],
  });
  await flushEvents();
  // A duplicate native delivery does not invalidate the board twice.
  socket.emit({ cursor: 42, events: [{ id: 42, task_id: 'task-2', kind: 'completed' }] });
  await flushEvents();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 40);
  assert.equal(calls[0][1], 'hk');
  assert.equal(calls[0][2], 4_000);
  assert.equal(calls[0][3], controller.signal);
  assert.deepEqual(cursors, [42]);

  controller.abort();
  await assert.rejects(consuming, /aborted/);
  assert.equal(socket.closed, true);
});

test('Kanban event stream rejects a regressing cursor so its owner can reconnect', async () => {
  const socket = new FakeKanbanEventSocket();
  const source: KanbanEventWebSocketSource = {
    openKanbanEventsWebSocket() {
      return Promise.resolve(socket as unknown as WebSocket);
    },
  };
  const consuming = consumeKanbanEventsWebSocket(
    source,
    12,
    '',
    new AbortController().signal,
    () => undefined,
  );
  await flushEvents();
  socket.emit({ cursor: 11, events: [{ id: 11, task_id: 'stale' }] });

  await assert.rejects(consuming, /cursor regressed/);
  assert.equal(socket.closed, true);
});

test('Kanban event cursor uses a safe fallback for old or malformed servers', () => {
  assert.equal(kanbanEventCursorFromBoard({ latest_event_id: 19 }), 19);
  assert.equal(kanbanEventCursorFromBoard({ latest_event_id: -1 }, 7), 7);
  assert.equal(kanbanEventCursorFromBoard({}, 7), 7);
  assert.equal(kanbanEventCursorFromBoard(null, 7), 7);
});

test('Kanban event stream follows the board selected by route metadata', () => {
  assert.equal(kanbanEventBoardFromRouteData(JSON.stringify({
    kanbanMetaJSON: JSON.stringify({ boards: { current: 'hong-kong' } }),
  })), 'hong-kong');
  assert.equal(kanbanEventBoardFromRouteData(JSON.stringify({
    kanbanMetaJSON: JSON.stringify({
      boards: { boards: [{ slug: 'default' }, { slug: 'hk', active: true }] },
    }),
  })), 'hk');
  assert.equal(kanbanEventBoardFromRouteData('{}', 'default'), 'default');
  assert.equal(kanbanEventBoardFromRouteData('{broken', 'default'), 'default');
});

test('SwiftUI Kanban route owns one foreground socket and keeps polling fallback', () => {
  const hook = readFileSync(
    resolve(process.cwd(), 'src/app/useHermesSwiftUIRouteData.ts'),
    'utf8',
  );

  assert.match(hook, /if \(!api \|\| routeId !== 'kanban'\) return undefined/);
  assert.match(
    hook,
    /if \(disposed \|\| controller \|\| AppState\.currentState !== 'active'\) return/,
  );
  assert.match(hook, /consumeKanbanEventsWebSocket\([\s\S]{0,500}await reload\(\)/);
  assert.match(hook, /controller\?\.abort\(\)[\s\S]{0,100}clearReconnectTimer\(\)/);
  assert.match(hook, /scheduleReconnect\(\)/);
  assert.match(hook, /kanbanEventBoardFromRouteData\(dataJson\)/);
  assert.match(hook, /consumeKanbanEventsWebSocket\([\s\S]{0,200}activeKanbanBoard/);
  assert.match(hook, /routeStringField\(current, 'kanbanDetailJSON'\)/);
  // The live socket is an invalidation accelerator. The adaptive timer remains
  // active so older servers and failed WebSocket upgrades still refresh.
  assert.match(hook, /const tick = async \(\) => \{[\s\S]{0,700}await reload\(\)/);
});
