import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeHermesSwiftUIRouteAction,
  encodeHermesSwiftUIRouteSnapshot,
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
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
  };

  assert.deepEqual(JSON.parse(encodeHermesSwiftUIRouteSnapshot(snapshot)), snapshot);
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
});
