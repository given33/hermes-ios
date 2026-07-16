import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  authReducer,
  bootstrapSavedConnection,
  initialAuthState,
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
      error: '无法解锁连接，请重试。',
    },
  );
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
  assert.deepEqual(canceled, { status: 'locked', baseUrl: session.baseUrl });
});

test('SecureStore protects only refresh-token reads and writes with Face ID', async () => {
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

  assert.deepEqual(CREDENTIAL_STORAGE_KEYS, [
    'hermes.native.baseUrl',
    'hermes.native.username',
    'hermes.native.accessToken',
    'hermes.native.refreshToken',
    'hermes.native.refreshTokenKey',
    'hermes.native.accessExpiresAt',
    'hermes.native.deviceId',
  ]);
  assert.equal(await store.readBaseUrl(), session.baseUrl);
  assert.equal(await store.readRefreshToken(), session.refreshToken);
  assert.equal(await store.readUsername(), session.username);
  assert.equal(await store.readAccessToken(), session.accessToken);
  assert.equal(await store.readAccessExpiresAt(), session.expiresAt);
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
  const protectedOperations = operations.filter(
    ({ operation, key }) =>
      (key === REFRESH_TOKEN_STORAGE_KEY || key.startsWith(REFRESH_TOKEN_KEY_PREFIX))
      && (operation === 'get' || operation === 'set'),
  );
  assert.ok(protectedOperations.length >= 2);
  for (const operation of protectedOperations) {
    assert.deepEqual(operation.options, {
      requireAuthentication: true,
      authenticationPrompt: FACE_ID_PROMPT,
    });
  }
  const accessTokenOperations = operations.filter(
    ({ operation, key }) =>
      key === ACCESS_TOKEN_STORAGE_KEY && (operation === 'get' || operation === 'set'),
  );
  assert.ok(accessTokenOperations.length >= 2);
  assert.ok(accessTokenOperations.every(({ options }) => options === undefined));
  const pointerOperations = operations.filter(
    ({ key }) => key === REFRESH_TOKEN_POINTER_STORAGE_KEY,
  );
  assert.ok(pointerOperations.length >= 2);
  assert.ok(pointerOperations.every(({ options }) => options === undefined));
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
  assert.match(providerSource, /AccessTokenController/);
  assert.match(providerSource, /\/api\/mobile\/v1\/handshake/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/status/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/registration-code/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/register/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/token/);
  assert.match(mobileAuthSource, /\/auth\/mobile\/refresh/);
  assert.match(appSource, /<AuthProvider>/);
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
