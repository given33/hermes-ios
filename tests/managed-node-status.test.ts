import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expireSystemRouteData,
  isFreshObservation,
  managedNodeGatewayStatuses,
} from '../src/api/managed-node-status';

const now = Date.parse('2026-07-18T10:00:00Z');

test('managed node status accepts only fresh matching device observations', () => {
  const statuses = managedNodeGatewayStatuses({
    nodes: [
      {
        id: 'dbb3',
        label: 'DBB3',
        online: true,
        gateway_state: 'active',
        observed_at: '2026-07-18T09:59:30Z',
        version: 'v1.2.3',
      },
      {
        id: 'wsl',
        label: 'WSL',
        online: true,
        gateway_state: 'active',
        observed_at: '2026-07-18T09:55:00Z',
        version: 'v9.9.9',
      },
    ],
    sources: [{ id: 'home', online: true }],
  }, now);

  assert.deepEqual(statuses, [
    { id: 'dbb3', label: 'DBB3', state: 'online', version: 'v1.2.3' },
    { id: 'wsl', label: 'WSL', state: 'offline', version: 'v9.9.9' },
  ]);
});

test('missing devices never inherit another source state', () => {
  assert.deepEqual(
    managedNodeGatewayStatuses({ sources: [{ id: 'dbb3', online: true }] }, now),
    [
      { id: 'dbb3', label: 'DBB3', state: 'unknown' },
      { id: 'wsl', label: 'WSL', state: 'unknown' },
    ],
  );
});

test('invalid, explicitly stale, and far-future observations fail closed', () => {
  assert.equal(isFreshObservation({ observed_at: 'invalid' }, now), false);
  assert.equal(isFreshObservation({ fresh: false, observed_at: '2026-07-18T09:59:59Z' }, now), false);
  assert.equal(isFreshObservation({ observed_at: '2026-07-18T10:00:31Z' }, now), false);
  assert.equal(isFreshObservation({ observed_at: '2026-07-18T10:00:30Z' }, now), true);
});

test('system route data expires when polling stops or a node observation ages out', () => {
  const source = JSON.stringify({
    route: 'system',
    system: {
      gatewayOnline: true,
      nodes: [{
        id: 'dbb3',
        gatewayOnline: true,
        observedAt: '2026-07-18T09:59:30Z',
      }],
    },
  });

  const fresh = JSON.parse(expireSystemRouteData(source, now - 10_000, now));
  assert.equal(fresh.system.gatewayOnline, true);
  assert.equal(fresh.system.nodes[0].gatewayOnline, true);

  const stale = JSON.parse(expireSystemRouteData(source, now - 61_000, now));
  assert.equal(stale.system.gatewayOnline, false);
  assert.equal(stale.system.nodes[0].gatewayOnline, false);

  const staleObservation = JSON.parse(expireSystemRouteData(
    source,
    now - 10_000,
    now + 31_000,
  ));
  assert.equal(staleObservation.system.gatewayOnline, false);
  assert.equal(staleObservation.system.nodes[0].gatewayOnline, false);
});
