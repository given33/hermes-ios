import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { IOSContextCapabilities } from '../modules/hermes-ios-context/index';
import {
  canCollectIOSPermission,
  clearIOSPermissionRun,
  coordinateIOSPermissions,
  ensureIOSPermissions,
  type IOSPermissionRuntime,
} from '../src/context/ios-permission-coordinator';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const capabilities: IOSContextCapabilities = {
  apns: true,
  backgroundTasks: true,
  calendar: true,
  health: true,
  liveActivity: true,
  location: true,
  locationAlways: false,
  locationPrecise: false,
  motion: true,
  notesShare: true,
  reminders: true,
  screenTime: true,
  watch: true,
};

test('permission coordinator presents every undetermined request strictly in order', async () => {
  const requests: string[] = [];
  let activeRequest = '';
  let locationRequested = false;
  const request = async (name: string) => {
    assert.equal(activeRequest, '', `permission request overlapped ${activeRequest}`);
    activeRequest = name;
    requests.push(name);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
    activeRequest = '';
    return 'authorized' as const;
  };
  const runtime: IOSPermissionRuntime = {
    getCapabilities: async () => capabilities,
    getLocationAuthorization: async () => 'notDetermined',
    getLocationAuthorizationDetails: async () => locationRequested
      ? { accuracy: 'reduced', always: true }
      : { accuracy: 'reduced', always: false },
    requestLocationAuthorization: async () => {
      const result = await request('location');
      locationRequested = true;
      return result;
    },
    requestPreciseLocation: async () => {
      await request('precise-location');
      return true;
    },
    getMotionAuthorization: async () => 'notDetermined',
    requestMotionAuthorization: () => request('motion'),
    getHealthAuthorization: async () => 'notDetermined',
    requestHealthAuthorization: () => request('health'),
    getCalendarAuthorization: async () => 'notDetermined',
    requestCalendarAuthorization: () => request('calendar'),
    getReminderAuthorization: async () => 'notDetermined',
    requestReminderAuthorization: () => request('reminders'),
    getScreenTimeCapabilities: async () => ({ status: 'notDetermined' }),
    requestScreenTimeAuthorization: () => request('screen-time'),
    getNotificationAuthorization: async () => 'notDetermined',
    requestNotificationAuthorization: () => request('notification'),
  };

  const result = await coordinateIOSPermissions(runtime);

  assert.deepEqual(requests, [
    'location',
    'precise-location',
    'motion',
    'health',
    'calendar',
    'reminders',
    'screen-time',
    'notification',
  ]);
  assert.equal(result.phase, 'ready');
  assert.equal(result.locationAlways, true);
  assert.equal(result.locationPrecise, true);
  assert.equal(canCollectIOSPermission(result, 'location'), true);
});

test('denied permissions are not requested again and cannot start collectors', async () => {
  const runtime = authorizedRuntime({
    getLocationAuthorization: async () => 'denied',
    getLocationAuthorizationDetails: async () => ({ accuracy: 'reduced', always: false }),
    getMotionAuthorization: async () => 'restricted',
    getHealthAuthorization: async () => 'denied',
  });
  const result = await coordinateIOSPermissions(runtime);

  assert.equal(result.permissions.location, 'denied');
  assert.equal(result.permissions.motion, 'restricted');
  assert.equal(canCollectIOSPermission(result, 'location'), false);
  assert.equal(canCollectIOSPermission(result, 'motion'), false);
  assert.equal(canCollectIOSPermission(result, 'health'), false);
});

test('an unresolved system permission pauses before the next sheet', async () => {
  let healthRead = false;
  const runtime = authorizedRuntime({
    getMotionAuthorization: async () => 'notDetermined',
    requestMotionAuthorization: async () => 'notDetermined',
    getHealthAuthorization: async () => {
      healthRead = true;
      return 'authorized';
    },
  });
  const result = await coordinateIOSPermissions(runtime);

  assert.equal(result.phase, 'paused');
  assert.equal(result.current, 'motion');
  assert.equal(healthRead, false);
});

test('a settled paused run is reused until foreground recovery forces the next permission pass', async () => {
  const ownerScope = 'permission-resume-owner';
  let motionResolved = false;
  let motionReads = 0;
  const runtime = authorizedRuntime({
    getMotionAuthorization: async () => {
      motionReads += 1;
      return motionResolved ? 'authorized' : 'notDetermined';
    },
    requestMotionAuthorization: async () => 'notDetermined',
  });

  const paused = await ensureIOSPermissions(ownerScope, runtime);
  const cached = await ensureIOSPermissions(ownerScope, runtime);
  assert.equal(paused.phase, 'paused');
  assert.equal(cached.phase, 'paused');
  assert.equal(motionReads, 1);

  motionResolved = true;
  const resumed = await ensureIOSPermissions(ownerScope, runtime, undefined, true);
  assert.equal(resumed.phase, 'ready');
  assert.equal(resumed.permissions.motion, 'authorized');
  assert.equal(motionReads, 2);
  clearIOSPermissionRun(ownerScope);
});

test('native context verifier rejects a source tree that omits the map implementation', () => {
  const valid = spawnSync(process.execPath, [
    resolve(root, 'scripts/verify-ios-native-context.mjs'),
    '--root', root,
  ], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);

  const fixture = mkdtempSync(resolve(tmpdir(), 'hermes-native-context-'));
  cpSync(resolve(root, 'modules/hermes-ios-context'), resolve(fixture, 'modules/hermes-ios-context'), {
    recursive: true,
  });
  rmSync(resolve(fixture, 'modules/hermes-ios-context/ios/HermesStandardMapView.swift'));
  const invalid = spawnSync(process.execPath, [
    resolve(root, 'scripts/verify-ios-native-context.mjs'),
    '--root', fixture,
  ], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /HermesStandardMapView\.swift/);
});

function authorizedRuntime(overrides: Partial<IOSPermissionRuntime>): IOSPermissionRuntime {
  return {
    getCapabilities: async () => capabilities,
    getLocationAuthorization: async () => 'authorized',
    getLocationAuthorizationDetails: async () => ({ accuracy: 'full', always: true }),
    requestLocationAuthorization: async () => assert.fail('location should not be requested'),
    requestPreciseLocation: async () => assert.fail('precise location should not be requested'),
    getMotionAuthorization: async () => 'authorized',
    requestMotionAuthorization: async () => assert.fail('motion should not be requested'),
    getHealthAuthorization: async () => 'authorized',
    requestHealthAuthorization: async () => assert.fail('health should not be requested'),
    getCalendarAuthorization: async () => 'authorized',
    requestCalendarAuthorization: async () => assert.fail('calendar should not be requested'),
    getReminderAuthorization: async () => 'authorized',
    requestReminderAuthorization: async () => assert.fail('reminders should not be requested'),
    getScreenTimeCapabilities: async () => ({ status: 'authorized' }),
    requestScreenTimeAuthorization: async () => assert.fail('screen time should not be requested'),
    getNotificationAuthorization: async () => 'authorized',
    requestNotificationAuthorization: async () => assert.fail('notification should not be requested'),
    ...overrides,
  };
}
