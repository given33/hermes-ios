import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  buildSmartWeatherFeedbackEvent,
  notificationDedupeKey,
  notificationMatchesAccount,
  parseHermesNotificationPayload,
  parseHermesNotificationResponse,
} from '../src/notifications/notification-target';
import {
  bindNotificationTarget,
  notificationAccountKey,
  notificationTargetForAccount,
} from '../src/notifications/notification-account-state';
import { clearNotificationState } from '../src/notifications/notification-cleanup';
import { processSmartWeatherNotificationResponse } from '../src/notifications/notification-response-processing';

const APNS_TOKEN = 'a1'.repeat(32);

test('notification routes remain bound to the server account that accepted them', () => {
  const target = parseHermesNotificationPayload({
    account_generation: 'generation-1',
    conversation_id: 'chat-1',
    event_key: 'event-1',
    owner_id: 'owner-a',
  }, 'notification-1');
  assert.ok(target);
  const first = {
    baseUrl: 'https://one.hermes.test',
    username: 'owner-a',
    accountGeneration: 'generation-1',
  };
  const sameIdentityOnAnotherServer = {
    ...first,
    baseUrl: 'https://two.hermes.test',
  };
  const bound = bindNotificationTarget(target, first);
  assert.ok(bound);
  assert.equal(notificationTargetForAccount(bound, first), target);
  assert.equal(notificationTargetForAccount(bound, sameIdentityOnAnotherServer), null);
  assert.equal(notificationTargetForAccount(bound, null), null);
});

test('smart-weather processing stops after a native await crosses account generations', async () => {
  const nativeResult = deferred<boolean | null>();
  const acceptedAccount = {
    accountGeneration: 'generation-1',
    baseUrl: 'https://one.hermes.test',
    username: 'owner-a',
  };
  const acceptedAccountKey = notificationAccountKey(acceptedAccount);
  let activeAccount = acceptedAccount;
  const calls: string[] = [];
  const processing = processSmartWeatherNotificationResponse({
    fallback: async () => { calls.push('fallback'); },
    isCurrentAccount: () => notificationAccountKey(activeAccount) === acceptedAccountKey,
    markHandled: () => { calls.push('handled'); },
    persistNative: async () => {
      calls.push('native');
      return nativeResult.promise;
    },
    publishTarget: () => { calls.push('target'); },
  });

  assert.deepEqual(calls, ['native']);
  activeAccount = { ...acceptedAccount, accountGeneration: 'generation-2' };
  nativeResult.resolve(false);

  assert.equal(await processing, 'discarded');
  assert.deepEqual(calls, ['native']);
});

test('smart-weather processing cannot publish or mark handled after fallback changes account', async () => {
  const fallbackFinished = deferred<void>();
  const fallbackStarted = deferred<void>();
  const acceptedAccount = {
    accountGeneration: 'generation-1',
    baseUrl: 'https://one.hermes.test',
    username: 'owner-a',
  };
  const acceptedAccountKey = notificationAccountKey(acceptedAccount);
  let activeAccount = acceptedAccount;
  const calls: string[] = [];
  const processing = processSmartWeatherNotificationResponse({
    fallback: async () => {
      calls.push('fallback');
      fallbackStarted.resolve();
      return fallbackFinished.promise;
    },
    isCurrentAccount: () => notificationAccountKey(activeAccount) === acceptedAccountKey,
    markHandled: () => { calls.push('handled'); },
    persistNative: async () => false,
    publishTarget: () => { calls.push('target'); },
  });

  await fallbackStarted.promise;
  activeAccount = { ...acceptedAccount, baseUrl: 'https://two.hermes.test' };
  fallbackFinished.resolve();

  assert.equal(await processing, 'discarded');
  assert.deepEqual(calls, ['fallback']);
});

test('account notification cleanup attempts every sensitive surface before failing', async () => {
  const calls: string[] = [];
  await assert.rejects(
    clearNotificationState({
      async cancelAllScheduledNotifications() { calls.push('scheduled'); },
      async clearLastResponse() { calls.push('response'); },
      async dismissAllNotifications() {
        calls.push('delivered');
        throw new Error('notification center unavailable');
      },
      async clearBadge() { calls.push('badge'); },
    }),
    /notification center unavailable/,
  );
  assert.deepEqual(calls, ['scheduled', 'response', 'delivered', 'badge']);

  const provider = readFileSync(
    resolve(process.cwd(), 'src', 'notifications', 'NotificationProvider.tsx'),
    'utf8',
  );
  const runtime = readFileSync(
    resolve(process.cwd(), 'src', 'notifications', 'expo-notification-runtime.ts'),
    'utf8',
  );
  assert.match(provider, /runtime\.clearAccountNotifications\(\)/);
  assert.match(runtime, /dismissAllNotificationsAsync/);
  assert.match(runtime, /cancelAllScheduledNotificationsAsync/);
  assert.match(runtime, /setBadgeCountAsync\(0\)/);

  const auth = readFileSync(
    resolve(process.cwd(), 'src', 'auth', 'AuthProvider.tsx'),
    'utf8',
  );
  assert.equal(
    (auth.match(/runOptionalAuthEffect\(clearAccountNotificationsBeforeAuthExit\)/g) || []).length,
    2,
  );
  assert.match(auth, /withDeadline\([\s\S]*clearExpoAccountNotifications\(\)[\s\S]*NOTIFICATION_CLEANUP_DEADLINE_MS/);
});

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

test('Keychain persistence failure does not block a remote login device identity', async () => {
  let createCalls = 0;
  const store = {
    async getItemAsync() {
      throw new Error('Keychain access group unavailable after re-signing');
    },
    async setItemAsync() {
      throw new Error('Keychain access group unavailable after re-signing');
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

  const first = await getMobileDeviceIdentity(store, metadata, () => {
    createCalls += 1;
    return 'ios_volatile_123456';
  });
  const second = await getMobileDeviceIdentity(store, metadata, () => {
    createCalls += 1;
    return 'must_not_replace_volatile_id';
  });

  assert.equal(first.id, 'ios_volatile_123456');
  assert.equal(second.id, first.id);
  assert.equal(createCalls, 1);
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

test('unified permission coordination prevents APNs from presenting a second system sheet', async () => {
  let requested = 0;
  let unregistered = 0;
  const result = await synchronizeApnsRegistration(
    {
      async resolveCurrentDeviceId() { return 'ios-device'; },
      async registerApns() { assert.fail('an undetermined permission cannot register'); },
      async unregisterApns() { unregistered += 1; },
    },
    'ios-device',
    {
      available: true,
      async getPermission() { return 'undetermined'; },
      async requestPermission() {
        requested += 1;
        return 'granted';
      },
      async getDevicePushToken() { assert.fail('token must not be read'); },
    },
    { bundleId: 'com.test.hermes', environment: 'production' },
    undefined,
    { requestUndeterminedPermission: false },
  );

  assert.deepEqual(result, { status: 'denied', deviceId: 'ios-device' });
  assert.equal(requested, 0);
  assert.equal(unregistered, 1);
});

test('Hermes notification taps accept conversation and smart-weather deep links', () => {
  const target = parseHermesNotificationPayload({
    hermes: {
      account_generation: 'acctgen_test',
      conversation_id: 'conversation-42',
      event_key: 'turn:conversation-42:turn-9',
      owner_id: 'owner-a',
      turn_id: 'turn-9',
      status: 'completed',
      result: 'preview only',
      deep_link: 'hermes-agent://conversation/conversation-42?turn=turn-9',
    },
  }, 'notification-1');
  assert.deepEqual(target, {
    accountGeneration: 'acctgen_test',
    eventKey: 'turn:conversation-42:turn-9',
    notificationId: 'notification-1',
    ownerId: 'owner-a',
    conversationId: 'conversation-42',
    turnId: 'turn-9',
    status: 'completed',
  });
  assert.equal(
    parseHermesNotificationPayload({
      hermes: { conversation_id: 'conversation-old' },
    }),
    null,
  );
  assert.equal(
    parseHermesNotificationPayload({
      hermes: {
        account_generation: 'acctgen_test',
        conversation_id: 'conversation-42',
        event_key: 'bad-link',
        owner_id: 'owner-a',
        deep_link: 'https://attacker.test/conversation-42',
      },
    }),
    null,
  );
  assert.equal(
    parseHermesNotificationPayload({
      hermes: {
        account_generation: 'acctgen_test',
        conversation_id: 'conversation-42',
        event_key: 'mismatch',
        owner_id: 'owner-a',
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
          content: { data: { hermes: {
            account_generation: 'acctgen_test',
            conversation_id: 'conversation-8',
            event_key: 'conversation-8',
            owner_id: 'owner-a',
          } } },
          trigger: { type: 'push' },
        },
      },
    }),
    {
      accountGeneration: 'acctgen_test',
      eventKey: 'conversation-8',
      notificationId: 'notification-2',
      ownerId: 'owner-a',
      conversationId: 'conversation-8',
    },
  );
  assert.deepEqual(
    parseHermesNotificationPayload({
      hermes: {
        account_generation: 'acctgen_test',
        category: 'smart-weather',
        deep_link: 'hermes-agent://weather',
        event_key: 'weather-event',
        owner_id: 'owner-a',
        data: { valid_until: 1_800_000_000 },
      },
    }, 'weather-notification', 1_700_000_000_000),
    {
      accountGeneration: 'acctgen_test',
      eventKey: 'weather-event',
      notificationId: 'weather-notification',
      ownerId: 'owner-a',
      conversationId: '',
      routePath: '/smart-weather',
      validUntil: 1_800_000_000_000,
    },
  );
  assert.equal(
    parseHermesNotificationPayload({
      hermes: {
        account_generation: 'acctgen_test',
        category: 'smart-weather',
        deep_link: 'hermes-agent://weather',
        event_key: 'expired-weather',
        owner_id: 'owner-a',
        data: { valid_until: 1_600_000_000 },
      },
    }, 'expired-weather', 1_700_000_000_000),
    null,
  );
});

test('notification account fences reject old generations and scope dedupe keys', () => {
  const target = parseHermesNotificationPayload({
    hermes: {
      account_generation: 'acctgen_current',
      conversation_id: 'conversation-1',
      event_key: 'turn:conversation-1:turn-1',
      owner_id: 'Owner-A',
    },
  }, 'request-id');
  assert.ok(target);
  assert.equal(notificationMatchesAccount(target, 'owner-a', 'acctgen_current'), true);
  assert.equal(notificationMatchesAccount(target, 'owner-a', 'acctgen_old'), false);
  assert.equal(
    notificationDedupeKey(target),
    'owner-a\u0000acctgen_current\u0000turn:conversation-1:turn-1',
  );
});

test('smart-weather notification feedback is persisted through the native encrypted queue', () => {
  assert.deepEqual(
    buildSmartWeatherFeedbackEvent('weather-42', 'iphone-1', {
      accountGeneration: 'acctgen_test',
      eventKey: 'weather-event',
      ownerId: 'owner-a',
    }, 1_700_000_000_000),
    {
      id: 'notification-feedback:weather-event',
      kind: 'notification-feedback',
      account_generation: 'acctgen_test',
      payload: {
        action: 'opened',
        account_generation: 'acctgen_test',
        event_key: 'weather-event',
        notification_id: 'weather-42',
        owner_id: 'owner-a',
        useful: true,
      },
      source_device_id: 'iphone-1',
      timestamp: 1_700_000_000_000,
    },
  );
  assert.equal(buildSmartWeatherFeedbackEvent('', 'iphone-1', {
    accountGeneration: 'acctgen_test',
    eventKey: 'weather-event',
    ownerId: 'owner-a',
  }), null);
});

test('notification provider exposes registration health and retries transient APNs failures', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src', 'notifications', 'NotificationProvider.tsx'),
    'utf8',
  );
  assert.match(source, /HermesNotificationHealth/);
  assert.match(source, /setNotificationHealth\('syncing'\)/);
  assert.match(source, /setNotificationHealth\(result\.status\)/);
  assert.match(source, /setNotificationHealth\('error'\)[\s\S]*setTimeout\([\s\S]*30_000/);
  assert.match(source, /useNotificationHealth/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}
