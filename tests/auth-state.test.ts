import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  authReducer,
  bootstrapSavedConnection,
  classifyProtectedCredentialError,
  inspectSavedConnection,
  initialAuthState,
  MAX_FACE_ID_ATTEMPTS,
} from '../src/auth/auth-state';
import {
  ACCOUNT_GENERATION_STORAGE_KEY,
  ACCESS_EXPIRES_AT_STORAGE_KEY,
  ACCESS_TOKEN_STORAGE_KEY,
  BASE_URL_STORAGE_KEY,
  BIOMETRIC_CREDENTIAL_PROTECTION,
  CREDENTIAL_PROTECTION_STORAGE_KEY,
  CREDENTIAL_STORAGE_KEYS,
  DEVICE_CREDENTIAL_PROTECTION,
  DEVICE_ID_STORAGE_KEY,
  LEGACY_ACCESS_TOKEN_STORAGE_KEY,
  LEGACY_BASE_URL_STORAGE_KEY,
  LEGACY_REFRESH_TOKEN_KEY_PREFIX,
  LEGACY_REFRESH_TOKEN_POINTER_STORAGE_KEY,
  LEGACY_REFRESH_TOKEN_STORAGE_KEY,
  LEGACY_REMEMBERED_PASSWORD_STORAGE_KEY,
  LEGACY_USERNAME_STORAGE_KEY,
  REFRESH_TOKEN_KEY_PREFIX,
  REFRESH_TOKEN_POINTER_STORAGE_KEY,
  REFRESH_TOKEN_STORAGE_KEY,
  REMEMBER_LOGIN_STORAGE_KEY,
  REMEMBERED_PASSWORD_STORAGE_KEY,
  SESSION_STORAGE_VERSION,
  SESSION_STORAGE_VERSION_KEY,
  USERNAME_STORAGE_KEY,
  type SavedConnection,
} from '../src/auth/credential-contract';
import {
  CredentialStore,
  provisionConnection,
  type SecureStoreAdapter,
} from '../src/auth/credential-store';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const session: SavedConnection = {
  accountGeneration: 'acctgen_generation_a',
  baseUrl: 'https://hermes.test',
  username: 'owner',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 2_000_000_000,
};

test('auth reducer covers owner registration, login selection, success, and expiry', () => {
  const registration = authReducer(initialAuthState, {
    type: 'BOOTSTRAP_EMPTY',
    mode: 'register',
    setupTokenRequired: true,
  });
  assert.deepEqual(registration, {
    status: 'provisioning',
    mode: 'register',
    setupTokenRequired: true,
    busy: false,
  });

  const loggingIn = authReducer(
    authReducer(registration, { type: 'PROVISION_STARTED' }),
    {
      type: 'AUTH_MODE_RESOLVED',
      mode: 'login',
      setupTokenRequired: false,
    },
  );
  assert.deepEqual(loggingIn, {
    status: 'provisioning',
    mode: 'login',
    setupTokenRequired: false,
    busy: true,
  });

  const failed = authReducer(loggingIn, {
    type: 'PROVISION_FAILED',
    error: '用户名或密码不正确。',
  });
  assert.deepEqual(failed, {
    status: 'provisioning',
    mode: 'login',
    setupTokenRequired: false,
    busy: false,
    error: '用户名或密码不正确。',
  });

  const authenticated = authReducer(failed, {
    type: 'AUTHENTICATED',
    connection: session,
  });
  assert.deepEqual(authenticated, { status: 'authenticated', connection: session });
  assert.deepEqual(
    authReducer(authenticated, {
      type: 'SESSION_REFRESHED',
      accountGeneration: session.accountGeneration,
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
      expiresAt: 2_100_000_000,
      deviceId: 'ios-device',
    }),
    {
      status: 'authenticated',
      connection: {
        ...session,
        accessToken: 'access-token-2',
        refreshToken: 'refresh-token-2',
        expiresAt: 2_100_000_000,
        deviceId: 'ios-device',
      },
    },
  );
  assert.deepEqual(
    authReducer(authenticated, {
      type: 'SESSION_EXPIRED',
      error: '登录已过期，请重新登录。',
    }),
    {
      status: 'provisioning',
      mode: 'login',
      setupTokenRequired: false,
      busy: false,
      error: '登录已过期，请重新登录。',
    },
  );
});

test('auth reducer preserves retryable Face ID unlock behavior', () => {
  const locked = authReducer(initialAuthState, {
    type: 'BOOTSTRAP_LOCKED',
    baseUrl: 'https://hermes.test',
    error: 'Face ID 已取消，请重试。',
  });
  const retrying = authReducer(locked, { type: 'UNLOCK_STARTED' });
  assert.deepEqual(retrying, {
    status: 'locked',
    baseUrl: 'https://hermes.test',
    busy: true,
    failedAttempts: 0,
  });
  assert.deepEqual(
    authReducer(retrying, {
      type: 'UNLOCK_FAILED',
      error: '无法解锁连接，请重试。',
    }),
    {
      status: 'locked',
      baseUrl: 'https://hermes.test',
      busy: false,
      failedAttempts: 1,
      error: '无法解锁连接，请重试。',
    },
  );
});

test('failed authenticated logout rebuilds the current client generation', () => {
  const authenticated = authReducer(initialAuthState, {
    type: 'AUTHENTICATED',
    connection: session,
  });
  const recovered = authReducer(authenticated, {
    type: 'LOGOUT_FAILED',
    error: 'offline',
  });

  assert.deepEqual(recovered, authenticated);
  assert.notEqual(recovered, authenticated);
});

test('Face ID stays retryable through four failures and falls back on the fifth', () => {
  let state = authReducer(initialAuthState, {
    type: 'BOOTSTRAP_LOCKED',
    baseUrl: session.baseUrl,
  });
  for (let attempt = 1; attempt < MAX_FACE_ID_ATTEMPTS; attempt += 1) {
    state = authReducer(authReducer(state, { type: 'UNLOCK_STARTED' }), {
      type: 'UNLOCK_FAILED',
      error: 'Face ID 验证失败，请重试。',
      fallbackError: '请使用账号密码登录。',
    });
    assert.equal(state.status, 'locked');
    if (state.status === 'locked') assert.equal(state.failedAttempts, attempt);
  }
  state = authReducer(authReducer(state, { type: 'UNLOCK_STARTED' }), {
    type: 'UNLOCK_FAILED',
    error: 'Face ID 验证失败，请重试。',
    fallbackError: '请使用账号密码登录。',
  });
  assert.deepEqual(state, {
    status: 'provisioning',
    mode: 'login',
    setupTokenRequired: false,
    busy: false,
    error: '请使用账号密码登录。',
  });
});

test('cold start reads base URL, protected refresh token, then session metadata', async () => {
  const calls: string[] = [];
  const result = await bootstrapSavedConnection({
    async readBaseUrl() {
      calls.push('baseUrl');
      return session.baseUrl;
    },
    async readRefreshToken() {
      calls.push('refreshToken');
      return session.refreshToken;
    },
    async readUsername() {
      calls.push('username');
      return session.username;
    },
    async readAccessToken() {
      calls.push('accessToken');
      return session.accessToken;
    },
    async readAccessExpiresAt() {
      calls.push('expiresAt');
      return session.expiresAt;
    },
    async readAccountGeneration() {
      calls.push('accountGeneration');
      return session.accountGeneration;
    },
  });

  assert.deepEqual(calls, [
    'baseUrl',
    'refreshToken',
    'username',
    'accessToken',
    'expiresAt',
    'accountGeneration',
  ]);
  assert.deepEqual(result, { status: 'authenticated', connection: session });
});

test('cold start inspection never opens protected storage before the user requests Face ID', async () => {
  const calls: string[] = [];
  const result = await inspectSavedConnection({
    async readBaseUrl() {
      calls.push('baseUrl');
      return session.baseUrl;
    },
  });

  assert.deepEqual(result, { status: 'locked', baseUrl: session.baseUrl });
  assert.deepEqual(calls, ['baseUrl']);
});

test('first run avoids biometric access and Face ID cancellation remains retryable', async () => {
  const firstRunCalls: string[] = [];
  const firstRun = await bootstrapSavedConnection({
    async readBaseUrl() {
      firstRunCalls.push('baseUrl');
      return null;
    },
    async readRefreshToken() {
      firstRunCalls.push('refreshToken');
      return 'must-not-be-read';
    },
    async readUsername() {
      return null;
    },
    async readAccessToken() {
      return null;
    },
    async readAccessExpiresAt() {
      return null;
    },
  });
  assert.deepEqual(firstRun, { status: 'provisioning' });
  assert.deepEqual(firstRunCalls, ['baseUrl']);

  const canceled = await bootstrapSavedConnection({
    async readBaseUrl() {
      return session.baseUrl;
    },
    async readRefreshToken() {
      throw new Error('User canceled authentication');
    },
    async readUsername() {
      return session.username;
    },
    async readAccessToken() {
      return session.accessToken;
    },
    async readAccessExpiresAt() {
      return session.expiresAt;
    },
  });
  assert.deepEqual(canceled, {
    status: 'locked',
    baseUrl: session.baseUrl,
    cancelled: true,
    failure: 'cancelled',
  });
});

test('SecureStore authentication errors distinguish retry, cancellation, and fallback', () => {
  assert.equal(
    classifyProtectedCredentialError(new Error('LAErrorAuthenticationFailed')),
    'authentication_failed',
  );
  assert.equal(
    classifyProtectedCredentialError(new Error('errSecUserCanceled (-128)')),
    'cancelled',
  );
  assert.equal(
    classifyProtectedCredentialError(new Error('Biometry is not enrolled')),
    'unavailable',
  );

  const locked = authReducer(initialAuthState, {
    type: 'BOOTSTRAP_LOCKED',
    baseUrl: session.baseUrl,
  });
  const unavailable = authReducer(
    authReducer(locked, { type: 'UNLOCK_STARTED' }),
    {
      type: 'UNLOCK_FAILED',
      error: 'Face ID unavailable',
      fallbackError: 'Use password',
      countAttempt: false,
      fallbackImmediately: true,
    },
  );
  assert.deepEqual(unavailable, {
    status: 'provisioning',
    mode: 'login',
    setupTokenRequired: false,
    busy: false,
    error: 'Use password',
  });
});

test('Face ID cancellation remains retryable without consuming an attempt', () => {
  const locked = authReducer(initialAuthState, {
    type: 'BOOTSTRAP_LOCKED',
    baseUrl: session.baseUrl,
  });
  const busy = authReducer(locked, { type: 'UNLOCK_STARTED' });
  const cancelled = authReducer(busy, {
    type: 'UNLOCK_FAILED',
    error: 'Face ID 已取消，请重试。',
    countAttempt: false,
  });

  assert.equal(cancelled.status, 'locked');
  if (cancelled.status === 'locked') {
    assert.equal(cancelled.failedAttempts, 0);
    assert.equal(cancelled.busy, false);
  }
});

test('SecureStore biometric-protects the refresh token and remembered password, keeps metadata non-interactive', async () => {
  const values = new Map<string, string>([
    [BASE_URL_STORAGE_KEY, session.baseUrl],
    [USERNAME_STORAGE_KEY, session.username],
    [ACCESS_TOKEN_STORAGE_KEY, session.accessToken],
    [REFRESH_TOKEN_STORAGE_KEY, session.refreshToken],
    [ACCESS_EXPIRES_AT_STORAGE_KEY, String(session.expiresAt)],
    [SESSION_STORAGE_VERSION_KEY, SESSION_STORAGE_VERSION],
  ]);
  const operations: Array<{
    operation: 'get' | 'set' | 'delete';
    key: string;
    value?: string;
    options?: { requireAuthentication?: boolean; authenticationPrompt?: string };
  }> = [];
  const secureStore: SecureStoreAdapter = {
    async getItemAsync(key, options) {
      operations.push({ operation: 'get', key, options });
      return values.get(key) ?? null;
    },
    async setItemAsync(key, value, options) {
      operations.push({ operation: 'set', key, value, options });
      values.set(key, value);
    },
    async deleteItemAsync(key, options) {
      operations.push({ operation: 'delete', key, options });
      values.delete(key);
    },
    canUseBiometricAuthentication: () => true,
  };
  const store = new CredentialStore(secureStore);
  const sessionOptions = undefined;

  assert.deepEqual(CREDENTIAL_STORAGE_KEYS, [
    'hermes.native.v2.baseUrl',
    'hermes.native.v2.username',
    'hermes.native.v2.accessToken',
    'hermes.native.v2.refreshToken',
    'hermes.native.v2.refreshTokenKey',
    'hermes.native.v2.credentialProtection',
    'hermes.native.v2.accessExpiresAt',
    'hermes.native.v2.accountGeneration',
    'hermes.native.deviceId',
    'hermes.native.v2.sessionVersion',
    'hermes.native.v2.rememberLogin',
    'hermes.native.v2.rememberedPassword',
  ]);
  assert.equal(await store.readBaseUrl(), session.baseUrl);
  assert.equal(await store.readRefreshToken(), session.refreshToken);
  assert.equal(await store.readUsername(), session.username);
  assert.equal(await store.readAccessToken(), session.accessToken);
  assert.equal(await store.readAccessExpiresAt(), session.expiresAt);
  assert.deepEqual(await store.readRememberedLoginPreference(), {
    enabled: false,
    password: '',
    username: session.username,
  });
  assert.deepEqual(await store.readRememberedLogin(), {
    enabled: false,
    password: '',
    username: session.username,
  });
  await store.saveRememberedLogin(session.username, 'account-password', true);
  assert.deepEqual(await store.readRememberedLoginPreference(), {
    enabled: true,
    password: '',
    username: session.username,
  });
  assert.deepEqual(await store.readRememberedLogin(), {
    enabled: true,
    password: 'account-password',
    username: session.username,
  });
  await store.saveRememberedLogin(session.username, 'account-password', false);
  assert.deepEqual(await store.readRememberedLogin(), {
    enabled: false,
    password: '',
    username: session.username,
  });
  await store.save({ ...session, accessToken: 'new-access' });
  await store.saveSessionTokens(
    'rotated-access',
    'rotated-refresh',
    session.expiresAt + 100,
    session.accountGeneration,
  );
  await store.clear();

  const operationKeys = new Set(operations.map(({ key }) => key));
  for (const key of CREDENTIAL_STORAGE_KEYS) assert.ok(operationKeys.has(key));
  assert.ok(
    [...operationKeys].some((key) => key.startsWith(REFRESH_TOKEN_KEY_PREFIX)),
  );
  const protectedOperations = operations.filter(
    ({ operation, key }) =>
      key === REMEMBERED_PASSWORD_STORAGE_KEY && (operation === 'get' || operation === 'set'),
  );
  assert.ok(protectedOperations.length >= 2);
  for (const operation of protectedOperations) {
    assert.equal(operation.options?.requireAuthentication, true);
    assert.ok(operation.options?.authenticationPrompt);
  }
  const accessTokenOperations = operations.filter(
    ({ operation, key }) =>
      key === ACCESS_TOKEN_STORAGE_KEY && (operation === 'get' || operation === 'set'),
  );
  assert.ok(accessTokenOperations.length >= 2);
  assert.ok(accessTokenOperations.every(({ options }) => options === sessionOptions));
  const pointerOperations = operations.filter(
    ({ key }) => key === REFRESH_TOKEN_POINTER_STORAGE_KEY,
  );
  assert.ok(pointerOperations.length >= 2);
  assert.ok(pointerOperations.every(({ options }) => options === undefined));
  const refreshItemWrites = operations.filter(
    ({ key, operation }) =>
      key.startsWith(REFRESH_TOKEN_KEY_PREFIX) && operation === 'set',
  );
  assert.ok(refreshItemWrites.length >= 2);
  assert.ok(refreshItemWrites.every(({ options }) => options?.requireAuthentication === true));
  assert.ok(operations.some(
    ({ key, operation, value }) =>
      key === CREDENTIAL_PROTECTION_STORAGE_KEY
      && operation === 'set'
      && value === BIOMETRIC_CREDENTIAL_PROTECTION,
  ));
  const preferenceReads = operations.filter(
    ({ key, operation }) =>
      key === REMEMBER_LOGIN_STORAGE_KEY && operation === 'get',
  );
  assert.ok(preferenceReads.every(({ options }) => options === undefined));
  assert.ok(operations.some(
    ({ key, operation, value }) =>
      key === REMEMBER_LOGIN_STORAGE_KEY && operation === 'set' && value === '1',
  ));
});

test('remembered password is never persisted without biometric protection', async () => {
  const values = new Map<string, string>();
  const store = new CredentialStore({
    async getItemAsync(key) {
      return values.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      values.set(key, value);
    },
    async deleteItemAsync(key) {
      values.delete(key);
    },
  });

  await assert.rejects(
    store.saveRememberedLogin(session.username, 'account-password', true),
    /biometric/i,
  );
  assert.equal(values.has(REMEMBERED_PASSWORD_STORAGE_KEY), false);
  assert.equal(values.get(REMEMBER_LOGIN_STORAGE_KEY), '0');
  assert.deepEqual(await store.readRememberedLogin(), {
    enabled: false,
    password: '',
    username: '',
  });
});

test('cold start unlock requirement follows the recorded protection mode', async () => {
  const biometricValues = new Map<string, string>();
  const biometricStore = new CredentialStore({
    async getItemAsync(key) {
      return biometricValues.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      biometricValues.set(key, value);
    },
    async deleteItemAsync(key) {
      biometricValues.delete(key);
    },
    canUseBiometricAuthentication: () => true,
  });
  assert.equal(await biometricStore.sessionUnlockRequired(), false);
  await biometricStore.save(session);
  assert.equal(biometricValues.get(CREDENTIAL_PROTECTION_STORAGE_KEY), BIOMETRIC_CREDENTIAL_PROTECTION);
  assert.equal(await biometricStore.sessionUnlockRequired(), true);
  await biometricStore.clearSession();
  assert.equal(await biometricStore.sessionUnlockRequired(), false);

  // Devices without enrolled biometrics keep the non-interactive restore.
  const deviceValues = new Map<string, string>();
  const deviceStore = new CredentialStore({
    async getItemAsync(key) {
      return deviceValues.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      deviceValues.set(key, value);
    },
    async deleteItemAsync(key) {
      deviceValues.delete(key);
    },
  });
  await deviceStore.save(session);
  assert.equal(deviceValues.get(CREDENTIAL_PROTECTION_STORAGE_KEY), DEVICE_CREDENTIAL_PROTECTION);
  assert.equal(await deviceStore.sessionUnlockRequired(), false);
});

test('refresh token falls back to device protection when the biometric write fails', async () => {
  const values = new Map<string, string>();
  const store = new CredentialStore({
    async getItemAsync(key) {
      return values.get(key) ?? null;
    },
    async setItemAsync(key, value, options) {
      if (options?.requireAuthentication) throw new Error('biometric enrollment changed');
      values.set(key, value);
    },
    async deleteItemAsync(key) {
      values.delete(key);
    },
    canUseBiometricAuthentication: () => true,
  });

  await store.save(session);
  assert.equal(values.get(CREDENTIAL_PROTECTION_STORAGE_KEY), DEVICE_CREDENTIAL_PROTECTION);
  assert.equal(await store.sessionUnlockRequired(), false);
  assert.equal(await store.readRefreshToken(), session.refreshToken);
});

test('legacy biometric entries are deleted without reading them before the first v2 login', async () => {
  const legacyRefreshKey = `${LEGACY_REFRESH_TOKEN_KEY_PREFIX}legacy`;
  const values = new Map<string, string>([
    [LEGACY_BASE_URL_STORAGE_KEY, session.baseUrl],
    [LEGACY_USERNAME_STORAGE_KEY, session.username],
    [LEGACY_ACCESS_TOKEN_STORAGE_KEY, session.accessToken],
    [LEGACY_REFRESH_TOKEN_POINTER_STORAGE_KEY, legacyRefreshKey],
    [legacyRefreshKey, session.refreshToken],
    [LEGACY_REMEMBERED_PASSWORD_STORAGE_KEY, 'account-password'],
  ]);
  const operations: Array<{ operation: 'get' | 'set' | 'delete'; key: string }> = [];
  const protectedKeys = new Set([
    LEGACY_ACCESS_TOKEN_STORAGE_KEY,
    LEGACY_REFRESH_TOKEN_STORAGE_KEY,
    LEGACY_REMEMBERED_PASSWORD_STORAGE_KEY,
    legacyRefreshKey,
  ]);
  const secureStore: SecureStoreAdapter = {
    async getItemAsync(key) {
      operations.push({ operation: 'get', key });
      if (protectedKeys.has(key) && values.has(key)) {
        throw new Error('biometric authentication required');
      }
      return values.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      operations.push({ operation: 'set', key });
      values.set(key, value);
    },
    async deleteItemAsync(key) {
      operations.push({ operation: 'delete', key });
      values.delete(key);
    },
  };
  const store = new CredentialStore(secureStore);

  await store.clearLegacySession();
  assert.equal(values.size, 0);
  assert.equal(
    operations.some(({ operation, key }) => operation === 'get' && protectedKeys.has(key)),
    false,
  );

  await store.save(session);
  assert.equal(values.get(SESSION_STORAGE_VERSION_KEY), SESSION_STORAGE_VERSION);
  assert.equal(values.get(ACCESS_TOKEN_STORAGE_KEY), session.accessToken);
});

test('a legacy ACL deletion failure cannot block or overwrite the v2 session', async () => {
  const values = new Map<string, string>([
    [LEGACY_ACCESS_TOKEN_STORAGE_KEY, 'legacy-protected-access'],
  ]);
  const reads: string[] = [];
  const secureStore: SecureStoreAdapter = {
    async getItemAsync(key) {
      reads.push(key);
      if (key === LEGACY_ACCESS_TOKEN_STORAGE_KEY) {
        throw new Error('legacy authentication required');
      }
      return values.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      values.set(key, value);
    },
    async deleteItemAsync(key) {
      if (key === LEGACY_ACCESS_TOKEN_STORAGE_KEY) {
        throw new Error('legacy ACL retained');
      }
      values.delete(key);
    },
  };
  const store = new CredentialStore(secureStore);

  await store.clearLegacySession();
  await store.save(session);

  assert.equal(values.get(LEGACY_ACCESS_TOKEN_STORAGE_KEY), 'legacy-protected-access');
  assert.equal(values.get(ACCESS_TOKEN_STORAGE_KEY), session.accessToken);
  assert.equal(values.get(SESSION_STORAGE_VERSION_KEY), SESSION_STORAGE_VERSION);
  assert.equal(reads.includes(LEGACY_ACCESS_TOKEN_STORAGE_KEY), false);
});

test('credential save rolls back every session key when protected storage fails', async () => {
  const deleted: string[] = [];
  const written: string[] = [];
  const secureStore: SecureStoreAdapter = {
    async getItemAsync() {
      return null;
    },
    async setItemAsync(key) {
      written.push(key);
      if (key.startsWith(REFRESH_TOKEN_KEY_PREFIX)) {
        throw new Error('biometric enrollment changed');
      }
    },
    async deleteItemAsync(key) {
      deleted.push(key);
    },
  };

  await assert.rejects(new CredentialStore(secureStore).save(session), /credential/i);
  assert.deepEqual(written.slice(0, 5), [
    BASE_URL_STORAGE_KEY,
    USERNAME_STORAGE_KEY,
    ACCOUNT_GENERATION_STORAGE_KEY,
    ACCESS_TOKEN_STORAGE_KEY,
    ACCESS_EXPIRES_AT_STORAGE_KEY,
  ]);
  assert.ok(written[5].startsWith(REFRESH_TOKEN_KEY_PREFIX));
  assert.deepEqual(
    new Set(deleted),
    new Set([...CREDENTIAL_STORAGE_KEYS, written[5]]),
  );
});

test('token rotation clears a partially written generation-bound session on storage failure', async () => {
  const deleted: string[] = [];
  const currentRefreshKey = `${REFRESH_TOKEN_KEY_PREFIX}current`;
  const secureStore: SecureStoreAdapter = {
    async getItemAsync(key) {
      return key === REFRESH_TOKEN_POINTER_STORAGE_KEY ? currentRefreshKey : null;
    },
    async setItemAsync(key) {
      if (key === ACCESS_EXPIRES_AT_STORAGE_KEY) throw new Error('storage full');
    },
    async deleteItemAsync(key) {
      deleted.push(key);
    },
  };

  await assert.rejects(
    new CredentialStore(secureStore).saveSessionTokens(
      'next-access',
      'next-refresh',
      session.expiresAt + 1,
      session.accountGeneration,
    ),
    /update Hermes token session/i,
  );
  for (const key of CREDENTIAL_STORAGE_KEYS) assert.ok(deleted.includes(key));
  assert.ok(deleted.some(
    (key) => key.startsWith(REFRESH_TOKEN_KEY_PREFIX) && key !== currentRefreshKey,
  ));
});

test('session clearing preserves remembered login only when the user opted in', async () => {
  const refreshPointer = `${REFRESH_TOKEN_KEY_PREFIX}current`;
  const values = new Map<string, string>([
    [BASE_URL_STORAGE_KEY, session.baseUrl],
    [USERNAME_STORAGE_KEY, session.username],
    [ACCESS_TOKEN_STORAGE_KEY, session.accessToken],
    [REFRESH_TOKEN_POINTER_STORAGE_KEY, refreshPointer],
    [refreshPointer, session.refreshToken],
    [ACCESS_EXPIRES_AT_STORAGE_KEY, String(session.expiresAt)],
    [DEVICE_ID_STORAGE_KEY, 'device-id'],
    [REMEMBER_LOGIN_STORAGE_KEY, '1'],
    [REMEMBERED_PASSWORD_STORAGE_KEY, 'account-password'],
  ]);
  const secureStore: SecureStoreAdapter = {
    async getItemAsync(key) {
      return values.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      values.set(key, value);
    },
    async deleteItemAsync(key) {
      values.delete(key);
    },
  };
  const store = new CredentialStore(secureStore);

  await store.clearSession();

  assert.deepEqual(await store.readRememberedLogin(), {
    enabled: true,
    password: 'account-password',
    username: session.username,
  });
  assert.equal(values.has(ACCESS_TOKEN_STORAGE_KEY), false);
  assert.equal(values.has(REFRESH_TOKEN_POINTER_STORAGE_KEY), false);
  assert.equal(values.has(refreshPointer), false);
  assert.equal(values.has(BASE_URL_STORAGE_KEY), false);

  await store.saveRememberedLogin(session.username, 'account-password', false);
  await store.clearSession();
  assert.equal(values.has(USERNAME_STORAGE_KEY), false);
  assert.equal(values.has(REMEMBER_LOGIN_STORAGE_KEY), false);
  assert.equal(values.has(REMEMBERED_PASSWORD_STORAGE_KEY), false);
});

test('authenticated sessions are normalized, handshaken, and only then saved', async () => {
  const order: string[] = [];
  const saved: SavedConnection[] = [];
  const connection = await provisionConnection(
    {
      ...session,
      baseUrl: ' https://hermes.test/ ',
      username: ' owner ',
      accessToken: ' access-token ',
      refreshToken: ' refresh-token ',
    },
    {
      store: {
        async save(candidate) {
          order.push('save');
          saved.push(candidate);
        },
      },
      async verify(candidate) {
        order.push('handshake');
        assert.deepEqual(candidate, session);
      },
    },
  );
  assert.deepEqual(order, ['handshake', 'save']);
  assert.deepEqual(saved, [connection]);

  await assert.rejects(
    provisionConnection(
      { ...session, refreshToken: ' ' },
      { store: { async save() {} }, async verify() {} },
    ),
    /refresh token/i,
  );
});

test('native auth gates the saved session behind the Face ID lock and keeps the complete app root', () => {
  const providerSource = readFileSync(
    resolve(projectRoot, 'src/auth/AuthProvider.tsx'),
    'utf8',
  );
  const mobileAuthSource = readFileSync(
    resolve(projectRoot, 'src/auth/mobile-auth.ts'),
    'utf8',
  );
  const appSource = readFileSync(
    resolve(projectRoot, 'src/app/HermesNativeApp.tsx'),
    'utf8',
  );
  const loginSource = readFileSync(
    resolve(projectRoot, 'src/auth/LoginScreen.tsx'),
    'utf8',
  );

  assert.doesNotMatch(providerSource, /\bAppState\b/);
  assert.match(providerSource, /bootstrapSavedConnection/);
  assert.match(providerSource, /inspectSavedConnection/);
  assert.match(providerSource, /result\.status === 'authenticated'/);
  assert.match(providerSource, /AccessTokenController/);
  assert.match(providerSource, /clientSession\?\.accessTokens\.dispose\(\)/);
  assert.match(providerSource, /new AbortController\(\)/);
  assert.match(providerSource, /APNS_LOGOUT_DEADLINE_MS/);
  assert.match(providerSource, /credentialMutations\.run\(\(\) => credentialStore\.clearSession\(\)\)/);
  // Cold start only reads the unprotected preference and protection flag;
  // the biometric-gated reads run inside unlock() / revealRememberedPassword().
  assert.match(providerSource, /readRememberedLoginPreference\(\)/);
  assert.match(providerSource, /sessionUnlockRequired\(\)/);
  assert.match(providerSource, /readRememberedLogin\(\)/);
  assert.match(providerSource, /BOOTSTRAP_LOCKED/);
  assert.match(providerSource, /UNLOCK_STARTED/);
  assert.match(providerSource, /UNLOCK_FAILED/);
  assert.match(providerSource, /MAX_FACE_ID_ATTEMPTS/);
  assert.match(providerSource, /revealRememberedPassword/);
  assert.match(loginSource, /void unlock\(\)/);
  assert.doesNotMatch(loginSource, /autoUnlockRequested/);
  assert.match(providerSource, /if \(!savedLogin\.enabled\)/);
  assert.match(providerSource, /if \(persistCredentials\) await credentialStore\.save\(candidate\)/);
  assert.match(providerSource, /!persistAuthenticatedSession\.current/);
  assert.match(providerSource, /\{ enabled: true, password: '', username: username\.trim\(\) \}/);
  assert.match(loginSource, /使用 Face ID 解锁/);
  assert.match(loginSource, /使用密码登录/);
  assert.match(loginSource, /MAX_FACE_ID_ATTEMPTS/);
  assert.match(loginSource, /revealRememberedPassword/);
  assert.match(providerSource, /\/api\/mobile\/v1\/handshake/);
  assert.match(providerSource, /verifyMobileHandshake\(client, mobileAuth\)/);
  const publicHandshakeProbe = providerSource.indexOf(
    'assertMobileHandshake(await mobileAuth.getHandshake())',
  );
  const authenticatedHandshakeFallback = providerSource.indexOf(
    "client.request<unknown>('/api/mobile/v1/handshake')",
  );
  assert.ok(publicHandshakeProbe >= 0, 'login must use the public Hermes handshake first');
  assert.ok(
    authenticatedHandshakeFallback > publicHandshakeProbe,
    'authenticated handshake must remain a compatibility fallback only',
  );
  assert.match(
    providerSource,
    /runOptionalAuthEffect\(\(\) => verifyMobileHandshake\(client, mobileAuth\)\)/,
    'a read-only handshake failure must not reject a valid mobile token',
  );
  assert.match(
    providerSource,
    /runOptionalAuthEffect\(\(\) => HermesIOSContext\.activateOwnerScope\(/,
    'native entitlement failures must not reject remote authentication',
  );
  assert.match(
    providerSource,
    /runOptionalAuthEffect\(\(\) => sharedConversationLocalStore\(\)\.activate/,
  );
  assert.match(providerSource, /HermesIOSContext\.activateOwnerScope\(/);
  assert.match(providerSource, /runOptionalAuthEffect/);
  assert.match(providerSource, /const volatileWebSession = new Map<string, string>\(\)/);
  assert.doesNotMatch(providerSource, /sessionStorage|localStorage/);
  assert.match(providerSource, /currentMobileAppVersion\(\)/);
  assert.match(providerSource, /expoConfig\?\.ios\?\.buildNumber/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/status/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/registration-code/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/register/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/token/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/refresh/);
  assert.match(appSource, /<AuthProvider>/);
  assert.match(providerSource, /new IOSIntelligenceApi\(client\)\.deleteAccount\(ownerScope\)/);
  assert.match(providerSource, /HermesIOSContext\.deleteOwnerScope\([\s\S]*ownerScope,[\s\S]*accountGenerationFromOwnerScope/);
  assert.match(providerSource, /credentialStore\.clear\(\)/);
  assert.match(appSource, /<LoginScreen/);
  assert.match(appSource, /<NotificationProvider>/);
  assert.match(appSource, /notificationTarget=\{notificationTarget\}/);
  assert.doesNotMatch(appSource, /<NativeShell \/>/);
  assert.match(loginSource, /accessibilityLabel="账号"/);
  assert.match(loginSource, /accessibilityLabel="密码"/);
  assert.match(loginSource, /accessibilityLabel="QQ 邮箱"/);
  assert.match(loginSource, /accessibilityLabel="邮箱验证码"/);
  assert.match(loginSource, /注册暂未开放/);
  assert.doesNotMatch(loginSource, /accessibilityLabel="Base URL"/);
  assert.doesNotMatch(loginSource, /服务器初始化码|setupToken/);
  assert.match(loginSource, /secureTextEntry/);
  assert.match(loginSource, /autoComplete="username"/);
  assert.match(loginSource, /current-password/);
  assert.match(loginSource, /new-password/);
  assert.doesNotMatch(`${providerSource}\n${loginSource}`, /apiKey|API 密钥/i);
  assert.match(loginSource, /KeyboardAvoidingView/);
  assert.match(loginSource, /lucide-react-native/);
  assert.match(loginSource, /assets\/icon\.png/);
  assert.match(loginSource, /loginPalette\(scheme\)/);
  assert.match(loginSource, /minHeight:\s*(?:44|4[5-9]|[5-9]\d)/);
  assert.match(loginSource, /maxWidth:\s*416/);
  assert.match(loginSource, /login-visual-contract/);
  assert.match(loginSource, /letterSpacing:\s*0/);
  assert.match(loginSource, /fontSize:\s*16/);
  assert.match(loginSource, /lineHeight:\s*24/);
  assert.match(loginSource, /Animated\.Value\(0\)/);
  assert.match(loginSource, /useNativeDriver:\s*true/);
  assert.match(loginSource, /height\s*\*\s*0\.06/);
  assert.match(loginSource, /Math\.min\(96/);
  assert.match(loginSource, /Math\.max\(24/);
  assert.match(loginSource, /inputFocusRing/);
  assert.doesNotMatch(
    `${providerSource}\n${appSource}\n${loginSource}`,
    /WebView|\bdocument\b|\bwindow\b/,
  );
});
