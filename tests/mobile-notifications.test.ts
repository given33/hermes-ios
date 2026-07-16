import assert from 'node:assert/strict';
import test from 'node:test';

import { HermesApiClient } from '../src/api/HermesApiClient';
import {
  INSTALLATION_ID_STORAGE_KEY,
} from '../src/auth/credential-contract';
import { getMobileDeviceIdentity } from '../src/auth/device-identity';
import {
  HermesMobileNotificationApi,
  normalizeApnsToken,
  synchronizeApnsRegistration,
  type ApnsRegistrationRuntime,
  type MobileNotificationApi,
} from '../src/notifications/mobile-notifications';
import {
  parseHermesNotificationPayload,
  parseHermesNotificationResponse,
} from '../src/notifications/notification-target';

const APNS_TOKEN = 'a1'.repeat(32);

function jsonResponse(url: string, body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const response = new Response(JSON.stringify(body), { ...init, headers });
  Object.defineProperty(response, 'url', { configurable: true, value: url });
  return response;
}

test('stable installation identity is persisted separately from cloud workspace data', async () => {
  const values = new Map<string, string>();
  const writes: Array<[string, string]> = [];
  const store = {
    async getItemAsync(key: string) {
      return values.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
  const metadata = {
    appVersion: '2.0.0',
    deviceName: 'Owner iPhone',
    modelId: 'iPhone17,1',
    modelName: 'iPhone 16 Pro',
    osName: 'iOS',
    osVersion: '18.5',
  };
  const first = await getMobileDeviceIdentity(store, metadata, () => 'ios_stable_123456');
  const second = await getMobileDeviceIdentity(store, metadata, () => 'must_not_run');

  assert.equal(first.id, 'ios_stable_123456');
  assert.deepEqual(second, first);
  assert.equal(first.model, 'iPhone 16 Pro · iPhone17,1');
  assert.equal(first.osVersion, 'iOS 18.5');
  assert.deepEqual(writes, [[INSTALLATION_ID_STORAGE_KEY, 'ios_stable_123456']]);
});

test('APNs synchronization is unavailable in Expo Go and registers only native iOS tokens', async () => {
  const calls: string[] = [];
  const api: MobileNotificationApi = {
    async resolveCurrentDeviceId() {
      calls.push('resolve');
      return 'ios-device';
    },
    async registerApns(_deviceId, token) {
      calls.push(`register:${token}`);
    },
    async unregisterApns() {
      calls.push('unregister');
    },
  };
  const unavailable: ApnsRegistrationRuntime = {
    available: false,
    async getPermission() { throw new Error('must not run'); },
    async requestPermission() { throw new Error('must not run'); },
    async getDevicePushToken() { throw new Error('must not run'); },
  };
  assert.deepEqual(
    await synchronizeApnsRegistration(
      api,
      'ios-device',
      unavailable,
      { bundleId: 'com.test.hermes', environment: 'production' },
    ),
    { status: 'unavailable' },
  );
  assert.deepEqual(calls, []);

  const runtime: ApnsRegistrationRuntime = {
    available: true,
    async getPermission() { return 'undetermined'; },
    async requestPermission() { return 'granted'; },
    async getDevicePushToken() { return { type: 'ios', data: `<${APNS_TOKEN}>` }; },
  };
  assert.deepEqual(
    await synchronizeApnsRegistration(
      api,
      'ios-device',
      runtime,
      { bundleId: 'com.test.hermes', environment: 'production' },
    ),
    { status: 'registered', deviceId: 'ios-device', token: APNS_TOKEN },
  );
  assert.deepEqual(calls, ['resolve', `register:${APNS_TOKEN}`]);
  assert.equal(normalizeApnsToken(`<${APNS_TOKEN.toUpperCase()}>`), APNS_TOKEN);
  assert.throws(() => normalizeApnsToken('ExponentPushToken[not-apns]'), /APNs token/);
});

test('notification API resolves the current auth device and uses only device delivery endpoints', async () => {
  const requests: Array<{ path: string; init: RequestInit }> = [];
  const client = new HermesApiClient(
    'https://hermes.test',
    'access-token',
    async (input, init) => {
      const url = String(input);
      requests.push({ path: new URL(url).pathname, init: init ?? {} });
      const body = new URL(url).pathname.endsWith('/devices')
        ? { devices: [{ id: 'ios-current', current: true }] }
        : { ok: true };
      return jsonResponse(url, body);
    },
  );
  const api = new HermesMobileNotificationApi(client);
  const deviceId = await api.resolveCurrentDeviceId();
  await api.registerApns(deviceId, APNS_TOKEN, {
    bundleId: 'com.test.hermes',
    environment: 'production',
  });
  await api.unregisterApns(deviceId);

  assert.equal(deviceId, 'ios-current');
  assert.deepEqual(requests.map(({ path }) => path), [
    '/api/mobile/v1/devices',
    '/api/mobile/v1/devices/ios-current/apns',
    '/api/mobile/v1/devices/ios-current/apns',
  ]);
  assert.equal(requests[1].init.method, 'PUT');
  assert.deepEqual(JSON.parse(String(requests[1].init.body)), {
    token: APNS_TOKEN,
    environment: 'production',
    bundle_id: 'com.test.hermes',
  });
  assert.equal(requests[2].init.method, 'DELETE');
});

test('Hermes notification taps accept only the conversation deep-link contract', () => {
  const target = parseHermesNotificationPayload({
    hermes: {
      conversation_id: 'conversation-42',
      turn_id: 'turn-9',
      status: 'completed',
      result: 'preview only',
      deep_link: 'hermes-agent://conversation/conversation-42?turn=turn-9',
    },
  }, 'notification-1');
  assert.deepEqual(target, {
    notificationId: 'notification-1',
    conversationId: 'conversation-42',
    turnId: 'turn-9',
    status: 'completed',
  });
  assert.equal(
    parseHermesNotificationPayload({
      hermes: {
        conversation_id: 'conversation-42',
        deep_link: 'https://attacker.test/conversation-42',
      },
    }),
    null,
  );
  assert.equal(
    parseHermesNotificationPayload({
      hermes: {
        conversation_id: 'conversation-42',
        deep_link: 'hermes-agent://conversation/different',
      },
    }),
    null,
  );

  assert.deepEqual(
    parseHermesNotificationResponse({
      notification: {
        request: {
          identifier: 'notification-2',
          content: { data: { hermes: { conversation_id: 'conversation-8' } } },
          trigger: { type: 'push' },
        },
      },
    }),
    { notificationId: 'notification-2', conversationId: 'conversation-8' },
  );
});
