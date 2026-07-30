import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HERMES_CLEARTEXT_BASE_URL_ERROR_CODE,
  HermesApiClient,
  HermesApiError,
  HermesCleartextBaseUrlError,
  normalizeBaseUrl,
} from '../src/api/HermesApiClient';
import { assertMobileHandshake } from '../src/api/hermes-types';
import { HermesThemeApi } from '../src/design/theme-api';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(url: string, body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  return withResponseUrl(
    new Response(JSON.stringify(body), { ...init, headers }),
    url,
  );
}

function withResponseUrl(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { configurable: true, value: url });
  return response;
}

test('normalizes the fixed server URL and rejects unsafe base URLs', () => {
  assert.equal(
    normalizeBaseUrl(' https://daxueshenmai.top/ '),
    'https://daxueshenmai.top',
  );
  // Cleartext HTTP stays usable for local development targets only: loopback
  // addresses and mDNS `.local` hosts never leave the developer's machine or LAN.
  assert.equal(normalizeBaseUrl('http://localhost:8080'), 'http://localhost:8080');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(normalizeBaseUrl('http://[::1]:8080'), 'http://[::1]:8080');
  assert.equal(normalizeBaseUrl('http://mac-studio.local:3000'), 'http://mac-studio.local:3000');

  for (const unsafe of [
    'http://hermes.test:8080',
    'http://192.168.1.20:3000',
    'http://daxueshenmai.top',
    'file:///tmp/hermes',
    'javascript:alert(1)',
    'https://user:password@hermes.test',
    'https://hermes.test/#fragment',
    'https://hermes.test/api',
    'https://hermes.test///',
    'https://hermes.test?api_key=mobile-secret',
    'https://hermes.test?',
    'https://hermes.test#',
  ]) {
    assert.throws(() => normalizeBaseUrl(unsafe), /base url/i);
  }
});

test('EXPO_PUBLIC_HERMES_ALLOW_HTTP=1 is the only escape hatch for LAN dev servers', () => {
  assert.throws(() => normalizeBaseUrl('http://192.168.1.20:3000'), /https/i);
  process.env.EXPO_PUBLIC_HERMES_ALLOW_HTTP = '1';
  try {
    assert.equal(normalizeBaseUrl('http://192.168.1.20:3000'), 'http://192.168.1.20:3000');
  } finally {
    delete process.env.EXPO_PUBLIC_HERMES_ALLOW_HTTP;
  }
  assert.throws(() => normalizeBaseUrl('http://192.168.1.20:3000'), /https/i);
});

test('an http:// base URL without the cleartext opt-in throws the typed terminal error', () => {
  // The session-restore policy classifies this exact type/code as terminal;
  // a bare Error here would demote the rejection to a transient failure and
  // reintroduce the permanent cold-start restore lockout.
  let thrown: unknown;
  try {
    new HermesApiClient('http://192.168.1.20:3000', 'mobile-secret');
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof HermesCleartextBaseUrlError);
  assert.equal(thrown.name, 'HermesCleartextBaseUrlError');
  assert.equal(thrown.code, HERMES_CLEARTEXT_BASE_URL_ERROR_CODE);
  // The message names both remediations for anyone reading logs.
  assert.match(thrown.message, /https/i);
  assert.match(thrown.message, /EXPO_PUBLIC_HERMES_ALLOW_HTTP=1/);
  assert.throws(() => normalizeBaseUrl('http://daxueshenmai.top'), HermesCleartextBaseUrlError);
  // The typed error is reserved for the cleartext-transport verdict; other
  // invalid base URLs keep their own messages.
  assert.throws(
    () => normalizeBaseUrl('file:///tmp/hermes'),
    (error: unknown) => error instanceof Error
      && !(error instanceof HermesCleartextBaseUrlError),
  );
});

test('rejects cross-origin request paths before bearer credentials reach fetch', async () => {
  const calls: FetchCall[] = [];
  const client = new HermesApiClient(
    'https://hermes.test',
    'mobile-secret',
    async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse('https://hermes.test/api/config', { ok: true });
    },
  );

  await assert.rejects(client.request('https://attacker.test/collect'), /same-origin/i);
  await assert.rejects(client.request('//attacker.test/collect'), /same-origin/i);
  assert.equal(calls.length, 0);
});

test('adds bearer auth and merges profile, query, and caller headers without token leakage', async () => {
  const calls: FetchCall[] = [];
  const client = new HermesApiClient(
    'https://hermes.test/',
    'mobile-secret',
    async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse('https://hermes.test/api/config', { ok: true });
    },
  );

  const result = await client.request<{ ok: boolean }>('/api/config?existing=yes&profile=old', {
    headers: {
      Authorization: 'Bearer caller-must-not-win',
      'X-Hermes-Test': 'present',
    },
    profile: 'reviewer / 中文',
    query: {
      page: 2,
      enabled: true,
      omitted: undefined,
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  const callUrl = new URL(calls[0].url);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(callUrl.origin, 'https://hermes.test');
  assert.equal(callUrl.searchParams.get('existing'), 'yes');
  assert.equal(callUrl.searchParams.get('profile'), 'reviewer / 中文');
  assert.equal(callUrl.searchParams.get('page'), '2');
  assert.equal(callUrl.searchParams.get('enabled'), 'true');
  assert.equal(callUrl.searchParams.has('omitted'), false);
  assert.equal(headers.get('Authorization'), 'Bearer mobile-secret');
  assert.equal(headers.get('X-Hermes-Test'), 'present');
  assert.doesNotMatch(calls[0].url, /mobile-secret/);
});

test('a short valid token is not confused with ordinary request URL characters', async () => {
  const calls: FetchCall[] = [];
  const client = new HermesApiClient(
    'https://hermes.test',
    'a',
    async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse('https://hermes.test/api/status', { ok: true });
    },
  );

  await client.request('/api/status');
  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer a');
  assert.doesNotMatch(calls[0].url, /[?&](?:api_?key|token)=/i);
});

test('rejects raw, URI-encoded, and form-encoded access tokens in request URLs', () => {
  const rawClient = new HermesApiClient('https://hermes.test', 'mobile-secret');
  assert.throws(
    () => rawClient.createAttachmentUrl('/api/files/mobile-secret'),
    /credentials/i,
  );

  const spacedClient = new HermesApiClient('https://hermes.test', 'mobile secret');
  assert.throws(
    () => spacedClient.createAttachmentUrl('/api/files/mobile%20secret'),
    /credentials/i,
  );
  assert.throws(
    () => spacedClient.createAttachmentUrl('/api/files', { token: 'mobile secret' }),
    /credentials/i,
  );

  const tildeClient = new HermesApiClient('https://hermes.test', 'mobile~secret');
  assert.throws(
    () => tildeClient.createAttachmentUrl('/api/files', { token: 'mobile~secret' }),
    /credentials/i,
  );
});

test('rejects a native-followed cross-origin response before reading its body', async () => {
  let bodyRead = false;
  let requestInit: RequestInit | undefined;
  const response = withResponseUrl(
    jsonResponse('https://hermes.test/api/config', { detail: 'mobile secret' }),
    'https://attacker.test/collect?token=mobile+secret',
  );
  Object.defineProperty(response, 'text', {
    configurable: true,
    value: async () => {
      bodyRead = true;
      return '{"detail":"mobile secret"}';
    },
  });
  const client = new HermesApiClient(
    'https://hermes.test',
    'mobile secret',
    async (_input, init) => {
      requestInit = init;
      return response;
    },
  );

  await assert.rejects(client.request('/api/config'), (error: unknown) => {
    const serialized = `${String(error)}\n${JSON.stringify(error)}\n${
      error instanceof Error ? error.stack ?? '' : ''
    }`;
    assert.doesNotMatch(serialized, /attacker\.test/i);
    assert.doesNotMatch(serialized, /mobile(?: secret|\+secret|%20secret)/i);
    assert.match(serialized, /same-origin/i);
    return true;
  });
  assert.equal(bodyRead, false);
  assert.equal(requestInit?.redirect, undefined);
});

test('accepts a direct response without a final URL (React Native transport)', async () => {
  // Expo/React Native often leaves Response.url empty for same-origin
  // replies. Hard-failing that path made password login look like
  // CONNECTION_ERROR after a successful /auth/mobile/token round trip.
  const client = new HermesApiClient(
    'https://hermes.test',
    'mobile-secret',
    async () => new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  const result = await client.request<{ ok: boolean }>('/api/config');
  assert.deepEqual(result, { ok: true });
});

test('parses JSON, text, and empty successful responses', async () => {
  const responses = [
    jsonResponse('https://hermes.test/api/json', { version: '2' }),
    withResponseUrl(
      new Response('ready', { headers: { 'Content-Type': 'text/plain' } }),
      'https://hermes.test/api/text',
    ),
    withResponseUrl(
      new Response(null, { status: 204 }),
      'https://hermes.test/api/empty',
    ),
  ];
  const client = new HermesApiClient(
    'https://hermes.test',
    'mobile-secret',
    async () => responses.shift()!,
  );

  assert.deepEqual(await client.request('/api/json'), { version: '2' });
  assert.equal(await client.request('/api/text'), 'ready');
  assert.equal(await client.request('/api/empty'), undefined);
});

test('authenticated binary downloads refresh one rejected token and preserve bytes', async () => {
  const calls: FetchCall[] = [];
  const provider = {
    getCurrentAccessToken: () => 'old-mobile-token',
    getAccessToken: async (request?: { forceRefresh?: boolean }) =>
      request?.forceRefresh ? 'new-mobile-token' : 'old-mobile-token',
  };
  const client = new HermesApiClient(
    'https://hermes.test',
    provider,
    async (input, init) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (calls.length === 1) {
        return jsonResponse(url, { detail: 'expired' }, { status: 401 });
      }
      return withResponseUrl(
        new Response(new Uint8Array([0, 1, 2, 255]), {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
        url,
      );
    },
  );

  const blob = await client.download('/api/files/download', {
    query: { path: 'outputs/最终报告.pdf' },
  });

  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0, 1, 2, 255]);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).searchParams.get('path'), 'outputs/最终报告.pdf');
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer old-mobile-token');
  assert.equal(new Headers(calls[1].init.headers).get('Authorization'), 'Bearer new-mobile-token');
  assert.doesNotMatch(calls.map(({ url }) => url).join('\n'), /mobile-token/);
});

test('hosted event streams refresh one rejected token without putting credentials in the URL', async () => {
  const calls: FetchCall[] = [];
  const provider = {
    getCurrentAccessToken: () => 'old-stream-token',
    getAccessToken: async (request?: { forceRefresh?: boolean }) =>
      request?.forceRefresh ? 'new-stream-token' : 'old-stream-token',
  };
  const client = new HermesApiClient(
    'https://hermes.test',
    provider,
    async () => { throw new Error('regular fetch must not serve SSE'); },
    async (input, init) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (calls.length === 1) {
        return jsonResponse(url, { detail: 'expired' }, { status: 401 });
      }
      return withResponseUrl(new Response(': keepalive\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      }), url);
    },
  );

  const response = await client.openEventStream('/api/plugins/collaboration/events', {
    query: { cursor: 12 },
    signal: new AbortController().signal,
  });

  assert.equal(await response.text(), ': keepalive\n\n');
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1].url).searchParams.get('cursor'), '12');
  assert.equal(new Headers(calls[0].init.headers).get('Accept'), 'text/event-stream');
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer old-stream-token');
  assert.equal(new Headers(calls[1].init.headers).get('Authorization'), 'Bearer new-stream-token');
  assert.doesNotMatch(calls.map(({ url }) => url).join('\n'), /stream-token/);
});

test('hosted event stream connection attempts have an abortable deadline', async () => {
  let requestSignal: AbortSignal | undefined;
  const client = new HermesApiClient(
    'https://hermes.test',
    'mobile-secret',
    async () => { throw new Error('regular fetch must not serve SSE'); },
    async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    },
  );

  await assert.rejects(
    client.openEventStream('/api/plugins/collaboration/events', { deadlineMs: 5 }),
    /event stream connection timed out/,
  );
  assert.equal(requestSignal?.aborted, true);
});

test('accepts only the actual mobile v1 handshake contract', () => {
  const handshake = {
    api_version: 1,
    hermes_version: '1.2.3',
    profiles: ['default'],
    capabilities: ['chat'],
    server_time: '2026-07-14T00:00:00Z',
  };
  assert.equal(assertMobileHandshake(handshake), handshake);
  assert.throws(
    () => assertMobileHandshake({ ...handshake, api_version: 2 }),
    /handshake/i,
  );
  assert.throws(
    () => assertMobileHandshake({ ...handshake, profiles: 'default' }),
    /handshake/i,
  );
});

test('non-2xx errors expose status but redact keys, headers, and echoed secrets', async () => {
  const client = new HermesApiClient(
    'https://hermes.test',
    'mobile-secret',
    async () =>
      jsonResponse(
        'https://hermes.test/api/config',
        {
          detail: 'Authorization: Bearer mobile-secret',
          error: 'invalid mobile-secret',
          headers: { Authorization: 'Bearer mobile-secret' },
        },
        { status: 401, statusText: 'Unauthorized' },
      ),
  );

  await assert.rejects(client.request('/api/config'), (error: unknown) => {
    assert.ok(error instanceof HermesApiError);
    assert.equal(error.status, 401);
    const serialized = `${String(error)}\n${JSON.stringify(error)}\n${error.stack ?? ''}`;
    assert.doesNotMatch(serialized, /mobile-secret/);
    assert.doesNotMatch(serialized, /Authorization/i);
    return true;
  });
});

test('gateway HTML is never exposed through Hermes API errors', async () => {
  const html = '<html><head><title>502 Bad Gateway</title></head><body><h1>nginx</h1></body></html>';
  const client = new HermesApiClient('https://hermes.test', 'mobile-secret', async () => {
    const response = new Response(html, {
      headers: { 'Content-Type': 'text/html' },
      status: 502,
      statusText: 'Bad Gateway',
    });
    return withResponseUrl(response, 'https://hermes.test/api/status');
  });

  await assert.rejects(client.request('/api/status'), (error: unknown) => {
    assert.ok(error instanceof HermesApiError);
    assert.equal(error.status, 502);
    assert.match(error.message, /Bad Gateway/);
    assert.doesNotMatch(error.message, /<html>|<h1>|nginx/i);
    return true;
  });
});

test('error redaction covers URLSearchParams space and tilde encoding', async () => {
  for (const { accessToken, echoed } of [
    { accessToken: 'mobile secret', echoed: 'mobile+secret' },
    { accessToken: 'mobile~secret', echoed: 'mobile%7Esecret' },
  ]) {
    const client = new HermesApiClient(
      'https://hermes.test',
      accessToken,
      async () =>
        jsonResponse(
          'https://hermes.test/api/config',
          { detail: `invalid ${echoed}` },
          { status: 401 },
        ),
    );

    await assert.rejects(client.request('/api/config'), (error: unknown) => {
      assert.ok(error instanceof HermesApiError);
      const serialized = `${String(error)}\n${JSON.stringify(error)}\n${error.stack ?? ''}`;
      const normalized = serialized.toLowerCase();
      assert.equal(normalized.includes(echoed.toLowerCase()), false);
      assert.equal(normalized.includes(accessToken.toLowerCase()), false);
      return true;
    });
  }
});

test('attachment helper builds only same-origin encoded URLs without credentials', () => {
  const client = new HermesApiClient('https://hermes.test', 'mobile-secret');
  const attachment = new URL(
    client.createAttachmentUrl('/api/files/report final.pdf?download=1', {
      profile: '审阅 / reviewer',
    }),
  );

  assert.equal(attachment.origin, 'https://hermes.test');
  assert.equal(attachment.pathname, '/api/files/report%20final.pdf');
  assert.equal(attachment.searchParams.get('download'), '1');
  assert.equal(attachment.searchParams.get('profile'), '审阅 / reviewer');
  assert.doesNotMatch(attachment.toString(), /mobile-secret/);
  assert.throws(
    () => client.createAttachmentUrl('https://attacker.test/file'),
    /same-origin/i,
  );
});

test('dashboard theme and font methods use the canonical GET and PUT endpoints', async () => {
  const calls: FetchCall[] = [];
  const client = new HermesApiClient(
    'https://hermes.test',
    'mobile-secret',
    async (input, init) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      const path = new URL(url).pathname;
      const responseBody = path.endsWith('/themes')
        ? { active: 'default', themes: [] }
        : path.endsWith('/font') && init?.method !== 'PUT'
          ? { font: 'theme' }
          : path.endsWith('/theme')
            ? { ok: true, theme: 'mono' }
            : { ok: true, font: 'inter' };
      return jsonResponse(url, responseBody);
    },
  );
  // The endpoints live in the design layer's HermesThemeApi; the transport
  // client carries no product methods of its own.
  const themeApi = new HermesThemeApi(client);

  assert.deepEqual(await themeApi.getThemes(), { active: 'default', themes: [] });
  assert.deepEqual(await themeApi.setTheme('mono'), { ok: true, theme: 'mono' });
  assert.deepEqual(await themeApi.getFontPref(), { font: 'theme' });
  assert.deepEqual(await themeApi.setFontPref('inter'), { ok: true, font: 'inter' });

  assert.deepEqual(
    calls.map((call) => ({
      path: new URL(call.url).pathname,
      method: call.init.method ?? 'GET',
      contentType: new Headers(call.init.headers).get('Content-Type'),
      body: call.init.body,
    })),
    [
      {
        path: '/api/dashboard/themes',
        method: 'GET',
        contentType: null,
        body: undefined,
      },
      {
        path: '/api/dashboard/theme',
        method: 'PUT',
        contentType: 'application/json',
        body: JSON.stringify({ name: 'mono' }),
      },
      {
        path: '/api/dashboard/font',
        method: 'GET',
        contentType: null,
        body: undefined,
      },
      {
        path: '/api/dashboard/font',
        method: 'PUT',
        contentType: 'application/json',
        body: JSON.stringify({ font: 'inter' }),
      },
    ],
  );
});

test('identical in-flight GETs share one network request and settle together', async () => {
  const calls: FetchCall[] = [];
  let releaseFirst: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const client = new HermesApiClient(
    'https://hermes.test',
    'mobile-secret',
    async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      const sequence = calls.length;
      await gate;
      return jsonResponse(String(input), { sequence });
    },
  );

  const first = client.request<{ sequence: number }>('/api/status', { query: { limit: 2 } });
  const second = client.request<{ sequence: number }>('/api/status', { query: { limit: 2 } });
  const other = client.request<{ sequence: number }>('/api/status', { query: { limit: 3 } });
  releaseFirst?.();
  const [firstResult, secondResult, otherResult] = await Promise.all([first, second, other]);

  // Two identical concurrent GETs rode one fetch; the different query did not.
  assert.equal(calls.filter(({ url }) => url.includes('limit=2')).length, 1);
  assert.equal(calls.filter(({ url }) => url.includes('limit=3')).length, 1);
  assert.deepEqual(firstResult, secondResult);
  assert.notDeepEqual(firstResult, otherResult);

  // The in-flight entry is evicted on settle: the same GET afterwards is a
  // fresh network request, not a cached reply.
  await client.request('/api/status', { query: { limit: 2 } });
  assert.equal(calls.filter(({ url }) => url.includes('limit=2')).length, 2);
});

test('GET coalescing skips requests that differ by method, headers, or abort signal', async () => {
  const calls: FetchCall[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = new HermesApiClient(
    'https://hermes.test',
    'mobile-secret',
    async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      await gate;
      return jsonResponse(String(input), { ok: true });
    },
  );

  const plain = client.request('/api/cron/jobs');
  // A caller-supplied header set must not ride the plain flight: replies can
  // legitimately differ (content negotiation), and sharing would hand one
  // caller a response negotiated for the other.
  const negotiated = client.request('/api/cron/jobs', {
    headers: { Accept: 'text/plain' },
  });
  // POST bodies are mutations; two concurrent POSTs must both reach the server.
  const firstPost = client.request('/api/cron/jobs', { method: 'POST', body: '{}' });
  const secondPost = client.request('/api/cron/jobs', { method: 'POST', body: '{}' });
  release?.();
  await Promise.all([plain, negotiated, firstPost, secondPost]);

  assert.equal(calls.length, 4);
});

test('aborting one caller never cancels a lookalike GET from another surface', async () => {
  const calls: FetchCall[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = new HermesApiClient(
    'https://hermes.test',
    'mobile-secret',
    async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      await gate;
      if (init?.signal?.aborted) throw abortLikeError();
      return jsonResponse(String(input), { ok: true });
    },
  );

  const controller = new AbortController();
  const shared = client.request<{ ok: boolean }>('/api/sessions');
  const abortable = client.request<{ ok: boolean }>('/api/sessions', {
    signal: controller.signal,
  });
  controller.abort();
  release?.();

  // The signal-carrying request kept its own connection and died alone; the
  // plain polling GET (and both were "identical" URLs) still resolved.
  await assert.rejects(abortable, /abort/i);
  assert.deepEqual(await shared, { ok: true });
  assert.equal(calls.length, 2);
});

test('a failed shared GET is not replayed to later callers from the dedup map', async () => {
  const calls: FetchCall[] = [];
  const client = new HermesApiClient(
    'https://hermes.test',
    'mobile-secret',
    async (input) => {
      calls.push({ url: String(input), init: {} });
      if (calls.length === 1) {
        return jsonResponse(String(input), { detail: 'boom' }, { status: 503 });
      }
      return jsonResponse(String(input), { ok: true });
    },
  );

  const first = client.request('/api/system/stats');
  const second = client.request('/api/system/stats');
  // Concurrent callers legitimately share the failure they raced...
  await assert.rejects(first, (error: unknown) => {
    assert.ok(error instanceof HermesApiError);
    assert.equal(error.status, 503);
    return true;
  });
  await assert.rejects(second, HermesApiError);
  assert.equal(calls.length, 1);

  // ...but the settled rejection is evicted, so a later caller gets a fresh
  // request instead of the stale error.
  assert.deepEqual(await client.request('/api/system/stats'), { ok: true });
  assert.equal(calls.length, 2);
});

function abortLikeError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}
