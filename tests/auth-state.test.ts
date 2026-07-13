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
  API_KEY_STORAGE_KEY,
  BASE_URL_STORAGE_KEY,
  CREDENTIAL_STORAGE_KEYS,
  FACE_ID_PROMPT,
  type SavedConnection,
} from '../src/auth/credential-contract';
import {
  CredentialStore,
  provisionConnection,
  type SecureStoreAdapter,
} from '../src/auth/credential-store';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('auth reducer covers cold start, Face ID lock, retry, success, and logout', () => {
  const loading = initialAuthState;
  const locked = authReducer(loading, {
    type: 'BOOTSTRAP_LOCKED',
    baseUrl: 'https://hermes.test',
    error: 'Face ID 已取消，请重试。',
  });

  assert.deepEqual(locked, {
    status: 'locked',
    baseUrl: 'https://hermes.test',
    error: 'Face ID 已取消，请重试。',
    busy: false,
  });

  const retrying = authReducer(locked, { type: 'UNLOCK_STARTED' });
  assert.equal(retrying.status, 'locked');
  assert.equal(retrying.busy, true);
  assert.equal(retrying.error, undefined);

  const retryFailed = authReducer(retrying, {
    type: 'UNLOCK_FAILED',
    error: '无法解锁连接，请重试。',
  });
  assert.equal(retryFailed.status, 'locked');
  assert.equal(retryFailed.busy, false);
  assert.equal(retryFailed.error, '无法解锁连接，请重试。');

  const logoutFailed = authReducer(retryFailed, {
    type: 'LOGOUT_FAILED',
    error: '无法移除已保存的连接，请重试。',
  });
  assert.deepEqual(logoutFailed, {
    status: 'locked',
    baseUrl: 'https://hermes.test',
    busy: false,
    error: '无法移除已保存的连接，请重试。',
  });

  const connection: SavedConnection = {
    baseUrl: 'https://hermes.test',
    apiKey: 'mobile-secret',
  };
  const authenticated = authReducer(logoutFailed, {
    type: 'AUTHENTICATED',
    connection,
  });
  assert.deepEqual(authenticated, { status: 'authenticated', connection });
  assert.deepEqual(authReducer(authenticated, { type: 'LOGGED_OUT' }), {
    status: 'provisioning',
    busy: false,
  });
});

test('auth reducer covers first-run provisioning, failure, retry, and success', () => {
  const provisioning = authReducer(initialAuthState, { type: 'BOOTSTRAP_EMPTY' });
  assert.deepEqual(provisioning, { status: 'provisioning', busy: false });

  const submitting = authReducer(provisioning, { type: 'PROVISION_STARTED' });
  assert.deepEqual(submitting, { status: 'provisioning', busy: true });

  const failed = authReducer(submitting, {
    type: 'PROVISION_FAILED',
    error: '无法验证 Hermes 连接，请重试。',
  });
  assert.deepEqual(failed, {
    status: 'provisioning',
    busy: false,
    error: '无法验证 Hermes 连接，请重试。',
  });

  const retried = authReducer(failed, { type: 'PROVISION_STARTED' });
  assert.deepEqual(retried, { status: 'provisioning', busy: true });

  const connection = { baseUrl: 'https://hermes.test', apiKey: 'mobile-secret' };
  assert.deepEqual(
    authReducer(retried, { type: 'AUTHENTICATED', connection }),
    { status: 'authenticated', connection },
  );
});

test('cold start reads the base URL first and directly performs one protected API-key read', async () => {
  const calls: string[] = [];
  const unlocked = await bootstrapSavedConnection({
    async readBaseUrl() {
      calls.push('baseUrl');
      return 'https://hermes.test';
    },
    async readApiKey() {
      calls.push('apiKey');
      return 'mobile-secret';
    },
  });

  assert.deepEqual(calls, ['baseUrl', 'apiKey']);
  assert.deepEqual(unlocked, {
    status: 'authenticated',
    connection: { baseUrl: 'https://hermes.test', apiKey: 'mobile-secret' },
  });

  calls.length = 0;
  const firstRun = await bootstrapSavedConnection({
    async readBaseUrl() {
      calls.push('baseUrl');
      return null;
    },
    async readApiKey() {
      calls.push('apiKey');
      return 'should-not-be-read';
    },
  });
  assert.deepEqual(firstRun, { status: 'provisioning' });
  assert.deepEqual(calls, ['baseUrl']);
});

test('cold-start Face ID cancellation becomes a retryable locked result', async () => {
  const result = await bootstrapSavedConnection({
    async readBaseUrl() {
      return 'https://hermes.test';
    },
    async readApiKey() {
      throw new Error('User canceled authentication');
    },
  });

  assert.deepEqual(result, { status: 'locked', baseUrl: 'https://hermes.test' });
});

test('SecureStore uses exactly two keys and protects API-key writes and reads', async () => {
  const values = new Map<string, string>([
    [BASE_URL_STORAGE_KEY, 'https://hermes.test'],
    [API_KEY_STORAGE_KEY, 'mobile-secret'],
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
    'hermes.native.apiKey',
  ]);
  assert.equal(await store.readBaseUrl(), 'https://hermes.test');
  assert.equal(await store.readApiKey(), 'mobile-secret');
  await store.save({ baseUrl: 'https://new.test', apiKey: 'new-secret' });
  await store.clear();

  assert.deepEqual(
    new Set(operations.map(({ key }) => key)),
    new Set(CREDENTIAL_STORAGE_KEYS),
  );
  const protectedOperations = operations.filter(
    ({ operation, key }) =>
      key === API_KEY_STORAGE_KEY && (operation === 'get' || operation === 'set'),
  );
  assert.ok(protectedOperations.length >= 2);
  for (const operation of protectedOperations) {
    assert.deepEqual(operation.options, {
      requireAuthentication: true,
      authenticationPrompt: FACE_ID_PROMPT,
    });
  }
  assert.equal(FACE_ID_PROMPT, '使用 Face ID 登录 Hermes');
});

test('credential save rolls back both keys when the protected write fails', async () => {
  const deleted: string[] = [];
  const written: string[] = [];
  const secureStore: SecureStoreAdapter = {
    async getItemAsync() {
      return null;
    },
    async setItemAsync(key) {
      written.push(key);
      if (key === API_KEY_STORAGE_KEY) throw new Error('biometric enrollment changed');
    },
    async deleteItemAsync(key) {
      deleted.push(key);
    },
  };

  await assert.rejects(
    new CredentialStore(secureStore).save({
      baseUrl: 'https://hermes.test',
      apiKey: 'mobile-secret',
    }),
    /credential/i,
  );
  assert.deepEqual(written, [BASE_URL_STORAGE_KEY, API_KEY_STORAGE_KEY]);
  assert.deepEqual(new Set(deleted), new Set(CREDENTIAL_STORAGE_KEYS));
});

test('provisioning verifies the real connection before saving normalized credentials', async () => {
  const order: string[] = [];
  const saved: SavedConnection[] = [];
  const store = {
    async save(connection: SavedConnection) {
      order.push('save');
      saved.push(connection);
    },
  };

  const connection = await provisionConnection(
    { baseUrl: ' https://hermes.test/ ', apiKey: ' mobile-secret ' },
    {
      store,
      async verify(candidate) {
        order.push('handshake');
        assert.deepEqual(candidate, {
          baseUrl: 'https://hermes.test',
          apiKey: 'mobile-secret',
        });
      },
    },
  );

  assert.deepEqual(order, ['handshake', 'save']);
  assert.deepEqual(saved, [connection]);

  order.length = 0;
  await assert.rejects(
    provisionConnection(
      { baseUrl: 'https://hermes.test', apiKey: 'mobile-secret' },
      {
        store,
        async verify() {
          order.push('handshake');
          throw new Error('unauthorized');
        },
      },
    ),
    /unauthorized/,
  );
  assert.deepEqual(order, ['handshake']);
});

test('native auth root is integrated without an AppState foreground re-prompt listener', () => {
  const providerSource = readFileSync(
    resolve(projectRoot, 'src/auth/AuthProvider.tsx'),
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
  assert.match(providerSource, /\/api\/mobile\/v1\/handshake/);
  assert.match(appSource, /<AuthProvider>/);
  assert.match(appSource, /<LoginScreen/);
  assert.match(loginSource, /TextInput/);
  assert.match(loginSource, /secureTextEntry/);
  assert.match(loginSource, /autoComplete="off"/);
  assert.match(loginSource, /textContentType="none"/);
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
  assert.match(loginSource, /marginBottom:\s*6\.4/);
  assert.match(loginSource, /marginHorizontal:\s*9\.24/);
  assert.match(loginSource, /marginBottom:\s*3\.024/);
  assert.match(loginSource, /marginHorizontal:\s*7\.2/);
  assert.match(loginSource, /marginBottom:\s*2\.4/);
  assert.doesNotMatch(loginSource, /input:\s*\{[^}]*minHeight/s);
  assert.match(loginSource, /inputFocusRing/);
  assert.match(loginSource, /FeGaussianBlur/);
  assert.match(loginSource, /FeOffset/);
  assert.match(loginSource, /FeFlood/);
  assert.match(loginSource, /FeComposite/);
  assert.match(appSource, /#041c1c/i);
  assert.doesNotMatch(
    `${providerSource}\n${appSource}\n${loginSource}`,
    /WebView|\bdocument\b|\bwindow\b/,
  );
});
