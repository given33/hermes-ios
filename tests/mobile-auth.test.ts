import assert from 'node:assert/strict';
import test from 'node:test';

import { HermesApiClient } from '../src/api/HermesApiClient';
import { AccessTokenController } from '../src/auth/access-token-controller';
import type { SavedConnection } from '../src/auth/credential-contract';
import {
  MobileAuthApiClient,
  MobileAuthApiError,
  resolveMobileAuthMode,
  type MobileAuthSession,
} from '../src/auth/mobile-auth';

interface FetchCall {
  url: string;
  init: RequestInit;
}

const initialConnection: SavedConnection = {
  baseUrl: 'https://hermes.test',
  username: 'owner',
  accessToken: 'access-one',
  refreshToken: 'refresh-stable',
  expiresAt: 1_000,
};

function tokenResponse(
  accessToken = 'access-two',
  refreshToken = 'refresh-two',
  expiresAt = 2_000,
): Record<string, unknown> {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_at: expiresAt,
    device_id: 'ios-test-device',
    account: { username: 'owner', display_name: 'Owner' },
  };
}

function session(
  accessToken = 'access-two',
  refreshToken = 'refresh-two',
  expiresAt = 2_000,
): MobileAuthSession {
  return {
    accessToken,
    refreshToken,
    expiresAt,
    deviceId: 'ios-test-device',
    account: { username: 'owner', displayName: 'Owner' },
  };
}

function jsonResponse(url: string, body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const response = new Response(JSON.stringify(body), { ...init, headers });
  Object.defineProperty(response, 'url', { configurable: true, value: url });
  return response;
}

test('registration status selects first-owner registration or normal login', () => {
  assert.equal(
    resolveMobileAuthMode({
      registrationOpen: true,
      accountConfigured: false,
      emailVerificationRequired: true,
      ownerEmailConfigured: true,
    }),
    'register',
  );
  assert.equal(
    resolveMobileAuthMode({
      registrationOpen: false,
      accountConfigured: true,
      emailVerificationRequired: true,
      ownerEmailConfigured: true,
    }),
    'login',
  );
  assert.throws(
    () => resolveMobileAuthMode({
      registrationOpen: false,
      accountConfigured: false,
      emailVerificationRequired: true,
      ownerEmailConfigured: true,
    }),
    /owner account/i,
  );
});

test('owner status exposes registration and QQ verification capability', async () => {
  const client = new MobileAuthApiClient('https://hermes.test', async (input) =>
    jsonResponse(String(input), {
      registration_open: false,
      account_configured: true,
      email_verification_required: true,
      owner_email_configured: true,
    }));

  assert.deepEqual(await client.getStatus(), {
    registrationOpen: false,
    accountConfigured: true,
    emailVerificationRequired: true,
    ownerEmailConfigured: true,
  });
});

test('authentication requests terminate even when the transport ignores abort', async () => {
  const captured: { signal?: AbortSignal } = {};
  const client = new MobileAuthApiClient(
    'https://hermes.test',
    (_input, init) => {
      if (init?.signal) captured.signal = init.signal;
      return new Promise<Response>(() => undefined);
    },
    10,
  );

  await assert.rejects(client.getStatus(), /timed out/i);
  assert.equal(captured.signal?.aborted, true);
});

test('first-owner registration sends QQ email and verification code only in the body', async () => {
  const calls: FetchCall[] = [];
  const client = new MobileAuthApiClient('https://hermes.test', async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return jsonResponse(url, tokenResponse());
  });

  await client.register(
    ' 2821961676@QQ.COM ',
    '123456',
    'owner',
    'correct-horse-42',
  );

  assert.equal(new URL(calls[0].url).search, '');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    email: '2821961676@qq.com',
    verification_code: '123456',
    username: 'owner',
    password: 'correct-horse-42',
  });
});

test('QQ registration code request parses resend timing', async () => {
  const calls: FetchCall[] = [];
  const client = new MobileAuthApiClient('https://hermes.test', async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return jsonResponse(url, { ok: true, expires_in: 600, resend_after: 60 });
  });

  assert.deepEqual(await client.requestRegistrationCode(' 2821961676@QQ.COM '), {
    expiresIn: 600,
    resendAfter: 60,
  });
  assert.equal(new URL(calls[0].url).pathname, '/auth/mobile/registration-code');
  assert.equal(calls[0].init.body, JSON.stringify({ email: '2821961676@qq.com' }));
});

test('native login sends stable device metadata and retains the returned server device id', async () => {
  const calls: FetchCall[] = [];
  const client = new MobileAuthApiClient(
    'https://hermes.test',
    async (input, init) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      return jsonResponse(url, tokenResponse());
    },
  );
  const result = await client.login('owner', 'correct-horse-42', {
    id: 'ios_stable_123456',
    name: 'Owner iPhone',
    model: 'iPhone 16 Pro · iPhone17,1',
    osVersion: 'iOS 18.5',
    appVersion: '2.0.0',
  });

  assert.equal(result.deviceId, 'ios-test-device');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    username: 'owner',
    password: 'correct-horse-42',
    device: {
      id: 'ios_stable_123456',
      name: 'Owner iPhone',
      model: 'iPhone 16 Pro · iPhone17,1',
      os_version: 'iOS 18.5',
      app_version: '2.0.0',
    },
  });
});

test('logout revokes the protected refresh session without placing tokens in the URL', async () => {
  const calls: FetchCall[] = [];
  const client = new MobileAuthApiClient(
    'https://hermes.test',
    async (input, init) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      return jsonResponse(url, { ok: true });
    },
  );
  await client.logout('refresh-stable', 'access-one');

  assert.equal(new URL(calls[0].url).pathname, '/auth/mobile/logout');
  assert.equal(new URL(calls[0].url).search, '');
  assert.equal(
    new Headers(calls[0].init.headers).get('Authorization'),
    'Bearer access-one',
  );
  assert.equal(
    calls[0].init.body,
    JSON.stringify({ refresh_token: 'refresh-stable' }),
  );
});

test('refresh uses only the protected refresh token and validates the token session', async () => {
  const calls: FetchCall[] = [];
  const client = new MobileAuthApiClient(
    'https://hermes.test',
    async (input, init) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      return jsonResponse(url, tokenResponse());
    },
  );

  assert.deepEqual(await client.refresh(' refresh-stable '), session());
  assert.equal(new URL(calls[0].url).pathname, '/auth/mobile/refresh');
  assert.equal(
    calls[0].init.body,
    JSON.stringify({ refresh_token: 'refresh-stable' }),
  );

  const malformed = new MobileAuthApiClient('https://hermes.test', async (input) =>
    jsonResponse(String(input), { access_token: 'incomplete' }));
  await assert.rejects(malformed.login('owner', 'password'), /invalid authentication session/i);
});

test('authentication errors redact submitted secrets and reject redirected origins', async () => {
  const password = 'correct horse/42';
  const rejected = new MobileAuthApiClient('https://hermes.test', async (input) =>
    jsonResponse(
      String(input),
      { detail: `invalid ${encodeURIComponent(password)}` },
      { status: 401 },
    ));
  await assert.rejects(rejected.login('owner', password), (error: unknown) => {
    assert.ok(error instanceof MobileAuthApiError);
    const serialized = `${String(error)}\n${JSON.stringify(error)}`;
    assert.doesNotMatch(serialized, /correct(?:%20| )horse/i);
    return true;
  });

  let bodyRead = false;
  const redirectedResponse = jsonResponse(
    'https://attacker.test/auth/mobile/status',
    { registration_open: true, account_configured: false },
  );
  Object.defineProperty(redirectedResponse, 'text', {
    configurable: true,
    value: async () => {
      bodyRead = true;
      return '{}';
    },
  });
  const redirected = new MobileAuthApiClient(
    'https://hermes.test',
    async () => redirectedResponse,
  );
  await assert.rejects(redirected.getStatus(), /same-origin/i);
  assert.equal(bodyRead, false);
});

test('token pairs rotate once across concurrent requests near expiry', async () => {
  let refreshCalls = 0;
  const refreshedSessions: MobileAuthSession[] = [];
  const saved: Array<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }> = [];
  const controller = new AccessTokenController(initialConnection, {
    now: () => 950,
    store: {
      async saveSessionTokens(accessToken, refreshToken, expiresAt) {
        saved.push({ accessToken, refreshToken, expiresAt });
      },
    },
    onSessionRefreshed(value) {
      refreshedSessions.push(value);
    },
    async refresh(refreshToken) {
      refreshCalls += 1;
      assert.equal(refreshToken, initialConnection.refreshToken);
      await Promise.resolve();
      return session('access-two', 'refresh-two', 2_000);
    },
  });

  const tokens = await Promise.all([
    controller.getAccessToken(),
    controller.getAccessToken(),
    controller.getAccessToken(),
  ]);
  assert.deepEqual(tokens, ['access-two', 'access-two', 'access-two']);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(saved, [{
    accessToken: 'access-two',
    refreshToken: 'refresh-two',
    expiresAt: 2_000,
  }]);
  assert.equal(controller.getCurrentAccessToken(), 'access-two');
  assert.deepEqual(refreshedSessions, [session('access-two', 'refresh-two', 2_000)]);
});

test('disposing a token controller drains refresh before logout cleanup and blocks stale writes', async () => {
  let releaseRefresh: ((value: MobileAuthSession) => void) | undefined;
  const writes: string[] = [];
  const controller = new AccessTokenController(
    { ...initialConnection, expiresAt: 1 },
    {
      now: () => 100,
      store: {
        async saveSessionTokens(accessToken) {
          writes.push(accessToken);
        },
      },
      refresh: () => new Promise((resolve) => {
        releaseRefresh = resolve;
      }),
    },
  );
  const refresh = controller.getAccessToken();
  const disposal = controller.dispose();
  releaseRefresh?.(session('stale-access', 'stale-refresh', 2_000));

  await assert.rejects(refresh, /no longer active/);
  await disposal;
  assert.deepEqual(writes, []);
  await assert.rejects(controller.getAccessToken(), /no longer active/);
});

test('a 401 refresh is single-flight and stale 401 responses reuse the rotated token', async () => {
  let now = 100;
  let refreshCalls = 0;
  const controller = new AccessTokenController(
    { ...initialConnection, expiresAt: 1_000 },
    {
      now: () => now,
      refreshLeewaySeconds: 0,
      store: { async saveSessionTokens() {} },
      async refresh(refreshToken) {
        refreshCalls += 1;
        assert.equal(refreshToken, refreshCalls === 1 ? 'refresh-stable' : 'refresh-2');
        return session(
          `access-${refreshCalls + 1}`,
          `refresh-${refreshCalls + 1}`,
          now + 1_000,
        );
      },
    },
  );

  assert.equal(await controller.getAccessToken(), 'access-one');
  assert.equal(
    await controller.getAccessToken({ forceRefresh: true, rejectedToken: 'access-one' }),
    'access-2',
  );
  assert.equal(
    await controller.getAccessToken({ forceRefresh: true, rejectedToken: 'access-one' }),
    'access-2',
  );
  assert.equal(refreshCalls, 1);

  now = 1_100;
  assert.equal(await controller.getAccessToken(), 'access-3');
  assert.equal(refreshCalls, 2);
});

test('HermesApiClient retries one 401 with a refreshed bearer token', async () => {
  let providerCalls = 0;
  let currentToken = 'access-one';
  const provider = {
    getCurrentAccessToken: () => currentToken,
    async getAccessToken(options?: { forceRefresh?: boolean }) {
      providerCalls += 1;
      if (options?.forceRefresh) currentToken = 'access-two';
      return currentToken;
    },
  };
  const bearerTokens: string[] = [];
  const client = new HermesApiClient(
    'https://hermes.test',
    provider,
    async (input, init) => {
      const bearer = new Headers(init?.headers).get('Authorization') ?? '';
      bearerTokens.push(bearer);
      return jsonResponse(
        String(input),
        bearer === 'Bearer access-one' ? { detail: 'expired' } : { ok: true },
        bearer === 'Bearer access-one' ? { status: 401 } : {},
      );
    },
  );

  assert.deepEqual(await client.request('/api/status'), { ok: true });
  assert.deepEqual(bearerTokens, ['Bearer access-one', 'Bearer access-two']);
  assert.equal(providerCalls, 2);
});
