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
  ACCESS_EXPIRES_AT_STORAGE_KEY,
  ACCESS_TOKEN_STORAGE_KEY,
  BASE_URL_STORAGE_KEY,
  CREDENTIAL_STORAGE_KEYS,
  DEVICE_ID_STORAGE_KEY,
  FACE_ID_PROMPT,
  REFRESH_TOKEN_KEY_PREFIX,
  REFRESH_TOKEN_POINTER_STORAGE_KEY,
  REFRESH_TOKEN_STORAGE_KEY,
  REMEMBER_LOGIN_STORAGE_KEY,
  REMEMBERED_PASSWORD_STORAGE_KEY,
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
  });

  assert.deepEqual(calls, [
    'baseUrl',
    'refreshToken',
    'username',
    'accessToken',
    'expiresAt',
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

test('SecureStore protects access token, refresh token, and remembered password with Face ID', async () => {
  const values = new Map<string, string>([
    [BASE_URL_STORAGE_KEY, session.baseUrl],
    [USERNAME_STORAGE_KEY, session.username],
    [ACCESS_TOKEN_STORAGE_KEY, session.accessToken],
    [REFRESH_TOKEN_STORAGE_KEY, session.refreshToken],
    [ACCESS_EXPIRES_AT_STORAGE_KEY, String(session.expiresAt)],
  ]);
  const operations: Array<{
    operation: 'get' | 'set' | 'delete';
    key: string;
    value?: string;
    options?: object;
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
  };
  const store = new CredentialStore(secureStore);
  const protectedOptions = {
    requireAuthentication: true,
    authenticationPrompt: FACE_ID_PROMPT,
  };

  assert.deepEqual(CREDENTIAL_STORAGE_KEYS, [
    'hermes.native.baseUrl',
    'hermes.native.username',
    'hermes.native.accessToken',
    'hermes.native.refreshToken',
    'hermes.native.refreshTokenKey',
    'hermes.native.accessExpiresAt',
    'hermes.native.deviceId',
    'hermes.native.rememberLogin',
    'hermes.native.rememberedPassword',
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
  );
  await store.clear();

  const operationKeys = new Set(operations.map(({ key }) => key));
  for (const key of CREDENTIAL_STORAGE_KEYS) assert.ok(operationKeys.has(key));
  assert.ok(
    [...operationKeys].some((key) => key.startsWith(REFRESH_TOKEN_KEY_PREFIX)),
  );
  const isProtectedSecretKey = (key: string) => (
    key === ACCESS_TOKEN_STORAGE_KEY
    || key === REFRESH_TOKEN_STORAGE_KEY
    || key === REMEMBERED_PASSWORD_STORAGE_KEY
    || key.startsWith(REFRESH_TOKEN_KEY_PREFIX)
  );
  const protectedOperations = operations.filter(
    ({ operation, key }) =>
      isProtectedSecretKey(key) && (operation === 'get' || operation === 'set'),
  );
  assert.ok(protectedOperations.length >= 4);
  for (const operation of protectedOperations) {
    assert.deepEqual(operation.options, protectedOptions);
  }
  const accessTokenOperations = operations.filter(
    ({ operation, key }) =>
      key === ACCESS_TOKEN_STORAGE_KEY && (operation === 'get' || operation === 'set'),
  );
  assert.ok(accessTokenOperations.length >= 2);
  assert.ok(accessTokenOperations.every(
    ({ options }) => JSON.stringify(options) === JSON.stringify(protectedOptions),
  ));
  const pointerOperations = operations.filter(
    ({ key }) => key === REFRESH_TOKEN_POINTER_STORAGE_KEY,
  );
  assert.ok(pointerOperations.length >= 2);
  assert.ok(pointerOperations.every(({ options }) => options === undefined));
  const rememberedPasswordOperations = operations.filter(
    ({ key, operation }) =>
      key === REMEMBERED_PASSWORD_STORAGE_KEY && (operation === 'get' || operation === 'set'),
  );
  assert.ok(rememberedPasswordOperations.length >= 1);
  assert.ok(rememberedPasswordOperations.every(
    ({ options }) => JSON.stringify(options) === JSON.stringify(protectedOptions),
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
  assert.equal(FACE_ID_PROMPT, '使用 Face ID 登录 Hermes');
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
  assert.deepEqual(written.slice(0, 4), [
    BASE_URL_STORAGE_KEY,
    USERNAME_STORAGE_KEY,
    ACCESS_TOKEN_STORAGE_KEY,
    ACCESS_EXPIRES_AT_STORAGE_KEY,
  ]);
  assert.ok(written[4].startsWith(REFRESH_TOKEN_KEY_PREFIX));
  assert.deepEqual(
    new Set(deleted),
    new Set([...CREDENTIAL_STORAGE_KEYS, written[4]]),
  );
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

test('native auth integrates owner endpoints, refresh, Face ID, and the complete app root', () => {
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
  assert.match(providerSource, /AccessTokenController/);
  assert.match(providerSource, /clientSession\?\.accessTokens\.dispose\(\)/);
  assert.match(providerSource, /new AbortController\(\)/);
  assert.match(providerSource, /APNS_LOGOUT_DEADLINE_MS/);
  assert.match(providerSource, /FACE_ID_UNLOCK_DEADLINE_MS\s*=\s*45_000/);
  assert.match(
    providerSource,
    /withDeadline\(\s*bootstrapSavedConnection\(credentialStore\),\s*FACE_ID_UNLOCK_DEADLINE_MS/,
  );
  assert.match(providerSource, /readRememberedLoginPreference\(\)/);
  assert.match(providerSource, /AsyncDeadlineError/);
  assert.match(providerSource, /\/api\/mobile\/v1\/handshake/);
  assert.match(providerSource, /HermesIOSContext\.activateOwnerScope\(/);
  assert.match(providerSource, /runOptionalAuthEffect/);
  assert.match(providerSource, /currentMobileAppVersion\(\)/);
  assert.match(providerSource, /expoConfig\?\.ios\?\.buildNumber/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/status/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/registration-code/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/register/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/token/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/refresh/);
  assert.match(appSource, /<AuthProvider>/);
  assert.match(providerSource, /new IOSIntelligenceApi\(client\)\.deleteAccount\(ownerScope\)/);
  assert.match(providerSource, /HermesIOSContext\.deleteOwnerScope\(ownerScope\)/);
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
  assert.match(loginSource, /react-native-svg/);
  assert.match(loginSource, /RadialGradient/);
  assert.match(loginSource, /Pattern/);
  assert.match(loginSource, /borderRadius:\s*0/);
  assert.match(loginSource, /minHeight:\s*(?:44|4[5-9]|[5-9]\d)/);
  assert.match(loginSource, /maxWidth:\s*416/);
  assert.match(loginSource, /buttonBevel/);
  assert.match(loginSource, /login-visual-contract/);
  assert.match(loginSource, /fontSize:\s*16\.8/);
  assert.match(loginSource, /letterSpacing:\s*5\.376/);
  assert.match(loginSource, /fontSize:\s*29\.6/);
  assert.match(loginSource, /letterSpacing:\s*1\.48/);
  assert.match(loginSource, /fontSize:\s*15\.2/);
  assert.match(loginSource, /lineHeight:\s*22\.8/);
  assert.match(loginSource, /fontSize:\s*11\.52/);
  assert.match(loginSource, /letterSpacing:\s*2\.0736/);
  assert.match(loginSource, /letterSpacing:\s*1\.3824/);
  assert.match(loginSource, /paddingVertical:\s*11\.2/);
  assert.match(loginSource, /paddingHorizontal:\s*12\.8/);
  assert.match(loginSource, /fontSize:\s*12\.48/);
  assert.match(loginSource, /letterSpacing:\s*2\.496/);
  assert.match(loginSource, /fontSize:\s*13\.12/);
  assert.match(loginSource, /letterSpacing:\s*0\.2624/);
  assert.match(loginSource, /Animated\.Value\(0\)/);
  assert.match(loginSource, /useNativeDriver:\s*true/);
  assert.match(loginSource, /height\s*\*\s*0\.06/);
  assert.match(loginSource, /Math\.min\(96/);
  assert.match(loginSource, /Math\.max\(24/);
  assert.doesNotMatch(loginSource, /input:\s*\{[^}]*minHeight/s);
  assert.match(loginSource, /inputFocusRing/);
  assert.match(loginSource, /FeGaussianBlur/);
  assert.match(loginSource, /FeOffset/);
  assert.match(loginSource, /FeFlood/);
  assert.match(loginSource, /FeComposite/);
  assert.doesNotMatch(
    `${providerSource}\n${appSource}\n${loginSource}`,
    /WebView|\bdocument\b|\bwindow\b/,
  );
});
