import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasActiveManagedInstallation,
  initialRouteRefreshDelay,
  MAX_IDLE_REFRESH_MS,
  nextRouteRefreshDelay,
} from '../src/app/route-refresh-policy';

const BASE = 15_000;
const INSTALL = 2_000;

function snapshotWithInstallations(operations: unknown[]): string {
  return JSON.stringify({ version: 3, route: 'skills', installations: operations });
}

test('installation routes poll tightly only while an operation is progressing', () => {
  const active = snapshotWithInstallations([
    { id: 'op-1', kind: 'skill', state: 'running', targets: [] },
  ]);
  const settled = snapshotWithInstallations([
    { id: 'op-1', kind: 'skill', state: 'completed', targets: [{ nodeId: 'dbb3', state: 'completed' }] },
  ]);

  assert.equal(hasActiveManagedInstallation(active), true);
  assert.equal(hasActiveManagedInstallation(settled), false);
  assert.equal(initialRouteRefreshDelay('skills', BASE, INSTALL, active), INSTALL);
  assert.equal(initialRouteRefreshDelay('skills', BASE, INSTALL, settled), BASE);
  assert.equal(initialRouteRefreshDelay('sessions', BASE, INSTALL, active), BASE);

  // A lagging target keeps the tight cadence even when the parent settled,
  // and an unknown future state is treated as active, never as stalled.
  assert.equal(hasActiveManagedInstallation(snapshotWithInstallations([
    { state: 'completed', targets: [{ nodeId: 'wsl', state: 'dispatching' }] },
  ])), true);
  assert.equal(hasActiveManagedInstallation(snapshotWithInstallations([
    { state: 'quarantined', targets: [] },
  ])), true);
  assert.equal(hasActiveManagedInstallation(snapshotWithInstallations([])), false);
  assert.equal(hasActiveManagedInstallation('not json'), false);
  assert.equal(hasActiveManagedInstallation(''), false);

  assert.equal(nextRouteRefreshDelay({
    baseDelayMs: BASE,
    installationDelayMs: INSTALL,
    installationRoute: true,
    payloadChanged: false,
    pinned: false,
    previousDelayMs: INSTALL,
    routeDataJson: active,
  }), INSTALL);
  assert.equal(nextRouteRefreshDelay({
    baseDelayMs: BASE,
    installationDelayMs: INSTALL,
    installationRoute: true,
    payloadChanged: true,
    pinned: false,
    previousDelayMs: INSTALL,
    routeDataJson: settled,
  }), BASE);
});

test('idle routes back off geometrically and any change resets the cadence', () => {
  const still = JSON.stringify({ version: 3, route: 'cron', cron: [] });
  let delay = BASE;
  const idleTick = () => nextRouteRefreshDelay({
    baseDelayMs: BASE,
    installationDelayMs: INSTALL,
    installationRoute: false,
    payloadChanged: false,
    pinned: false,
    previousDelayMs: delay,
    routeDataJson: still,
  });

  delay = idleTick();
  assert.equal(delay, 30_000);
  delay = idleTick();
  assert.equal(delay, 60_000);
  delay = idleTick();
  assert.equal(delay, MAX_IDLE_REFRESH_MS);

  assert.equal(nextRouteRefreshDelay({
    baseDelayMs: BASE,
    installationDelayMs: INSTALL,
    installationRoute: false,
    payloadChanged: true,
    pinned: false,
    previousDelayMs: delay,
    routeDataJson: still,
  }), BASE);
});

test('pinned routes (system health expiry) never back off', () => {
  assert.equal(nextRouteRefreshDelay({
    baseDelayMs: BASE,
    installationDelayMs: INSTALL,
    installationRoute: false,
    payloadChanged: false,
    pinned: true,
    previousDelayMs: 60_000,
    routeDataJson: JSON.stringify({ version: 3, route: 'system' }),
  }), BASE);
});
