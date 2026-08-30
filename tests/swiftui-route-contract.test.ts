import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeHermesSwiftUIRouteAction,
  encodeHermesSwiftUIRouteSnapshot,
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
  isHermesSwiftUIRouteSnapshot,
  type HermesSwiftUIRouteSnapshot,
} from '../src/app/swiftui-route-contract';

test('SwiftUI route snapshots serialize with the versioned server-data contract', () => {
  const snapshot: HermesSwiftUIRouteSnapshot = {
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: 'sessions',
    sessions: [{
      id: 'session-42',
      title: 'Server session',
      model: 'model-1',
      date: 'now',
      running: true,
      detail: 'complete process',
    }],
    kanbanDetailJSON: '{"task":{"id":"task-42"}}',
  };

  assert.deepEqual(JSON.parse(encodeHermesSwiftUIRouteSnapshot(snapshot)), snapshot);
});

test('SwiftUI route snapshots reject drift before crossing the native bridge', () => {
  assert.equal(isHermesSwiftUIRouteSnapshot({ version: 2, route: 'sessions' }), false);
  assert.equal(isHermesSwiftUIRouteSnapshot({
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: 'sessions',
    sessions: 'not-an-array',
  }), false);
  assert.equal(isHermesSwiftUIRouteSnapshot({
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: 'models',
    detectedModels: ['valid', 42],
  }), false);
  assert.throws(
    () => encodeHermesSwiftUIRouteSnapshot({
      version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
      route: 'system',
      system: [],
    } as unknown as HermesSwiftUIRouteSnapshot),
    /Invalid Hermes SwiftUI route snapshot/,
  );
});

test('route snapshots reject fields absent from the generated cross-language contract', () => {
  assert.equal(isHermesSwiftUIRouteSnapshot({
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: 'sessions',
    unexpectedField: [],
  }), false);
});

test('SwiftUI route actions reject unknown names and malformed payloads', () => {
  assert.deepEqual(
    decodeHermesSwiftUIRouteAction(
      HERMES_SWIFTUI_ROUTE_ACTIONS.sessionRename,
      JSON.stringify({ route: 'sessions', id: 'session-42', name: 'Renamed' }),
    ),
    {
      action: 'session.rename',
      payload: { route: 'sessions', id: 'session-42', name: 'Renamed' },
    },
  );
  assert.equal(
    decodeHermesSwiftUIRouteAction('session.unknown', '{"route":"sessions"}'),
    null,
  );
  assert.equal(
    decodeHermesSwiftUIRouteAction('session.delete', '{"route":42}'),
    null,
  );
  assert.equal(
    decodeHermesSwiftUIRouteAction(
      HERMES_SWIFTUI_ROUTE_ACTIONS.sessionDelete,
      '{"route":"sessions","unexpected":true}',
    ),
    null,
  );
  assert.equal(
    decodeHermesSwiftUIRouteAction(
      HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanMove,
      '{"route":"kanban","position":1.5}',
    ),
    null,
  );
  assert.deepEqual(
    decodeHermesSwiftUIRouteAction(
      HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRunTerminate,
      JSON.stringify({
        route: 'kanban',
        id: 'task-42',
        targetId: '7',
        detail: 'operator stop',
        fields: { board: 'default' },
      }),
    ),
    {
      action: 'kanban.run.terminate',
      payload: {
        route: 'kanban',
        id: 'task-42',
        targetId: '7',
        detail: 'operator stop',
        fields: { board: 'default' },
      },
    },
  );
});
