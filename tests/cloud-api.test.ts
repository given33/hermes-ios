import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesApiClient, HermesRequestOptions } from '../src/api/HermesApiClient';
import {
  conversationSessionSummary,
  customApiMode,
  customModelApiKeyAction,
  customReasoningEffort,
  HermesCloudApi,
  mergeUnifiedConversationIndex,
  officialConversationPlaceholderId,
  parseOfficialConversationPlaceholderId,
} from '../src/api/HermesCloudApi';

interface Call {
  options: HermesRequestOptions;
  path: string;
}

test('custom model normalization has one implementation with a pinned fallback', () => {
  // Valid values pass through unchanged.
  assert.equal(customApiMode('anthropic_messages'), 'anthropic_messages');
  assert.equal(customApiMode('codex_responses'), 'codex_responses');
  assert.equal(customReasoningEffort('none'), 'none');
  assert.equal(customReasoningEffort('xhigh'), 'xhigh');
  // Unknown or missing input falls back to the editor defaults; the SwiftUI
  // route layer imports these same functions, so a form save can never flip a
  // server-loaded 'medium' into 'none' again.
  assert.equal(customApiMode('bogus'), 'chat_completions');
  assert.equal(customApiMode(undefined), 'chat_completions');
  assert.equal(customReasoningEffort('bogus'), 'medium');
  assert.equal(customReasoningEffort(undefined), 'medium');
  assert.equal(customReasoningEffort(''), 'medium');
});

test('conversation summaries require fresh durable run heartbeats', () => {
  const now = 1_800_000_000_000;
  const base = {
    created_at: now - 120_000,
    id: 'conversation-running-freshness',
    messages: [],
    profile: 'default',
    title: 'status',
    updated_at: now,
  };
  assert.equal(conversationSessionSummary({
    ...base,
    runtime_runs: { worker: { status: 'running', updated_at: now - 29 * 60 * 1_000 } },
  }, now).is_active, true);
  assert.equal(conversationSessionSummary({
    ...base,
    runtime_runs: { worker: { status: 'running', updated_at: now - 31 * 60 * 1_000 } },
  }, now).is_active, false);
  assert.equal(conversationSessionSummary({
    ...base,
    hosted_turns: { turn: { status: 'running', updated_at: now - 35 * 60 * 60 * 1_000 } },
  }, now).is_active, true);
  assert.equal(conversationSessionSummary({
    ...base,
    hosted_turns: { turn: { status: 'running', updated_at: now - 37 * 60 * 60 * 1_000 } },
  }, now).is_active, false);
  assert.equal(conversationSessionSummary({
    ...base,
    hosted_turns: { turn: { status: 'running' } },
  }, now).is_active, false);
});

function createApi() {
  const calls: Call[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ path, options });
      if (path.endsWith('/single/conversations')) {
        return Promise.resolve({ conversations: [] } as T);
      }
      if (path === '/api/model/custom') {
        return Promise.resolve({} as T);
      }
      if (path === '/api/model/custom/discover') {
        return Promise.resolve({
          latency_ms: 240,
          message: 'Model catalog loaded.',
          models: ['model-b', 'model-a'],
          ok: true,
          reachable: true,
          status: 200,
        } as T);
      }
      if (path === '/api/plugins/collaboration/managed-resources') {
        return Promise.resolve({
          account_generation: 'generation-contract',
          cursor: 0,
          diagnostics: [],
          events: [],
          has_more: false,
          resources: [],
        } as T);
      }
      if (path.endsWith('/tool-output-artifacts')) {
        return Promise.resolve({
          artifacts: [],
          filter_contract: 'account-files-v1',
          limit: 200,
          offset: 0,
          total: 0,
        } as T);
      }
      if (path.endsWith('/files')) {
        return Promise.resolve({
          files: [],
          filter_contract: 'account-files-v1',
          limit: 200,
          offset: 0,
          total: 0,
        } as T);
      }
      return Promise.resolve({} as T);
    },
  } as HermesApiClient;
  return { api: new HermesCloudApi(client), calls };
}

test('route snapshots read canonical server APIs instead of local fixtures', async () => {
  const { api, calls } = createApi();

  await api.loadRoute('sessions', 'reviewer');
  await api.loadRoute('analytics', 'reviewer');
  await api.loadRoute('plugins');
  await api.loadRoute('channels');

  assert.deepEqual(
    calls.map(({ path }) => path),
    [
      '/api/plugins/collaboration/single/conversations',
      '/api/analytics/usage',
      '/api/analytics/models',
      '/api/dashboard/plugins',
      '/api/dashboard/plugins/hub',
      '/api/messaging/platforms',
    ],
  );
  assert.equal(calls[0].options.profile, undefined);
  assert.equal(calls[1].options.profile, 'reviewer');
  assert.equal(calls[2].options.profile, 'reviewer');
});

test('account files and contextual routing use the collaboration cloud contract', async () => {
  const { api, calls } = createApi();

  await api.loadRoute('files');
  await api.routeMessage(
    '继续完成并发送文件',
    [{ role: 'assistant', content: '报告已经生成。' }],
    [{ name: 'input.csv', mime_type: 'text/csv', source: 'user_upload' }],
  );
  await api.deleteAccountFile('file / 中文');

  assert.equal(calls[0].path, '/api/plugins/collaboration/files');
  assert.deepEqual(calls[0].options.query, {
    date_from: undefined,
    date_to: undefined,
    filter_contract: 'account-files-v1',
    limit: 200,
    offset: 0,
    q: undefined,
    source: undefined,
    status: undefined,
    type: undefined,
  });
  assert.equal(calls[1].path, '/api/plugins/collaboration/tool-output-artifacts');
  assert.deepEqual(calls[1].options.query, {
    filter_contract: 'account-files-v1',
    limit: 200,
    offset: 0,
  });
  assert.equal(calls[2].path, '/api/plugins/collaboration/route');
  assert.deepEqual(JSON.parse(String(calls[2].options.body)), {
    attachments: [{ name: 'input.csv', mime_type: 'text/csv', source: 'user_upload' }],
    content: '继续完成并发送文件',
    mode: 'auto',
    recent_messages: [{ role: 'assistant', content: '报告已经生成。' }],
  });
  assert.equal(
    calls[3].path,
    '/api/plugins/collaboration/files/file%20%2F%20%E4%B8%AD%E6%96%87',
  );
  assert.equal(calls[3].options.method, 'DELETE');
});

test('conversation attachment downloads accept current and legacy server routes only', async () => {
  const calls: Array<{ options: HermesRequestOptions; path: string }> = [];
  const client = {
    consumeDownload<T>(
      path: string,
      consume: (response: Response, signal: AbortSignal) => Promise<T>,
      options: HermesRequestOptions = {},
    ): Promise<T> {
      calls.push({ options, path });
      return consume(
        new Response('attachment'),
        options.signal ?? new AbortController().signal,
      );
    },
  } as HermesApiClient;
  const api = new HermesCloudApi(client);
  const current = '/api/plugins/collaboration/files/file_report_123/download';
  const legacy = '/api/plugins/collaboration/single/conversations/chat-1'
    + '/attachments/outputs/reports/final%20report.pdf';

  assert.equal(
    await api.consumeConversationAttachment(current, (response) => response.text()),
    'attachment',
  );
  assert.equal(
    await api.consumeConversationAttachment(legacy, (response) => response.text()),
    'attachment',
  );

  for (const invalid of [
    'https://attacker.invalid/api/plugins/collaboration/files/file_1/download',
    '/api/plugins/collaboration/files/file_1/download/extra',
    '/api/plugins/collaboration/files/file_1/%2e%2e/status',
    '/api/plugins/collaboration/single/conversations/chat-1/attachments/uploads/../../status',
    '/api/plugins/collaboration/tool-output-artifacts/toolout_1/download',
    '/api/plugins/collaboration/files//file_1/download',
    '/api/plugins/collaboration/files/file_1/download/',
    '/api/plugins/collaboration/single/conversations/chat-1/attachments/uploads//report.pdf',
    '/api/plugins/collaboration/single/conversations/chat-1/attachments/uploads/report.pdf/',
  ]) {
    await assert.rejects(
      async () => api.consumeConversationAttachment(invalid, (response) => response.text()),
      /Invalid conversation attachment URL/,
    );
  }
  assert.deepEqual(calls.map(({ path }) => path), [current, legacy]);
});

test('account file route reads only the requested merged window prefix', async () => {
  const calls: Call[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ path, options });
      if (path.endsWith('/tool-output-artifacts')) {
        return Promise.resolve({
          artifacts: [],
          filter_contract: 'account-files-v1',
          limit: 200,
          offset: 0,
          total: 0,
        } as T);
      }
      const offset = Number(options.query?.offset || 0);
      const limit = Number(options.query?.limit || 200);
      const remaining = Math.max(0, 450 - offset);
      const count = Math.min(125, limit, remaining);
      return Promise.resolve({
        files: Array.from({ length: count }, (_, index) => ({
          id: `file-${offset + index}`,
          name: `artifact-${offset + index}.txt`,
        })),
        filter_contract: 'account-files-v1',
        limit,
        offset,
        total: 450,
      } as T);
    },
  } as HermesApiClient;

  const result = await new HermesCloudApi(client).loadRoute('files') as {
    files: unknown[];
    total: number;
  };

  assert.equal(result.files.length, 200);
  assert.equal(result.total, 450);
  assert.deepEqual(
    calls.filter(({ path }) => path.endsWith('/files')).map(({ options }) => options.query?.offset),
    [0, 125],
  );
  assert.equal(
    calls.filter(({ path }) => path.endsWith('/tool-output-artifacts')).length,
    1,
  );
});

test('account file pagination applies limit and offset after merging both sources', async () => {
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      if (path.endsWith('/tool-output-artifacts')) {
        return Promise.resolve({
          artifacts: [7, 5, 3].map((created, index) => ({
            id: `toolout_${index}`,
            account_generation: 'generation-1',
            conversation_id: 'conversation-1',
            created_at: created,
            retained_until: 99,
            sha256: `sha-${index}`,
            size_bytes: 1,
            state: 'available',
            tool_call_id: `call-${index}`,
            tool_name: 'terminal',
            turn_id: 'turn-1',
          })),
          filter_contract: 'account-files-v1',
          limit: options.query?.limit,
          offset: options.query?.offset,
          total: 3,
        } as T);
      }
      return Promise.resolve({
        files: [6, 4, 2].map((created, index) => ({
          id: `file-${index}`,
          name: `file-${index}.txt`,
          created_at: created * 1_000,
          file_type: 'text',
          source: 'user_upload',
          status: 'available',
        })),
        filter_contract: 'account-files-v1',
        limit: options.query?.limit,
        offset: options.query?.offset,
        total: 3,
      } as T);
    },
  } as HermesApiClient;

  const result = await new HermesCloudApi(client).getAllAccountFiles({ limit: 2, offset: 2 });

  assert.deepEqual(result.files.map(({ id }) => id), ['toolout_1', 'file-1']);
  assert.equal(result.total, 6);
  assert.equal(result.limit, 2);
  assert.equal(result.offset, 2);
});

test('account file pagination normalizes non-finite page bounds', async () => {
  const queries: Array<Record<string, unknown> | undefined> = [];
  const client = {
    request<T>(_path: string, options: HermesRequestOptions = {}): Promise<T> {
      queries.push(options.query);
      return Promise.resolve({
        artifacts: [],
        files: [],
        filter_contract: 'account-files-v1',
        limit: options.query?.limit,
        offset: options.query?.offset,
        total: 0,
      } as T);
    },
  } as HermesApiClient;

  const result = await new HermesCloudApi(client).getAllAccountFiles({
    limit: Number.NaN,
    offset: Number.POSITIVE_INFINITY,
  });

  assert.equal(result.limit, 200);
  assert.equal(result.offset, 0);
  assert.ok(queries.every((query) => query?.limit === 200 && query?.offset === 0));
});

test('account file pagination keeps id-ascending ties from both source prefixes', async () => {
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      if (path.endsWith('/tool-output-artifacts')) {
        return Promise.resolve({
          artifacts: ['toolout_a', 'toolout_b'].map((id) => ({
            account_generation: 'generation-1',
            conversation_id: 'conversation-1',
            created_at: 10,
            id,
            retained_until: 99,
            sha256: id,
            size_bytes: 1,
            state: 'available',
            tool_call_id: id,
            tool_name: 'terminal',
            turn_id: 'turn-1',
          })),
          filter_contract: 'account-files-v1',
          limit: options.query?.limit,
          offset: options.query?.offset,
          total: 2,
        } as T);
      }
      return Promise.resolve({
        files: ['file_a', 'file_b'].map((id) => ({
          created_at: 10_000,
          file_type: 'document',
          id,
          name: `${id}.txt`,
          source: 'user_upload',
          status: 'available',
        })),
        filter_contract: 'account-files-v1',
        limit: options.query?.limit,
        offset: options.query?.offset,
        total: 2,
      } as T);
    },
  } as HermesApiClient;

  const result = await new HermesCloudApi(client).getAllAccountFiles({ limit: 2 });

  assert.deepEqual(result.files.map(({ id }) => id), ['file_a', 'file_b']);
});

test('numeric epoch date filters are forwarded to both account-file sources', async () => {
  const queries: Array<Record<string, unknown> | undefined> = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      queries.push(options.query);
      if (path.endsWith('/tool-output-artifacts')) {
        return Promise.resolve({
          artifacts: [], filter_contract: 'account-files-v1', limit: 1, offset: 0, total: 0,
        } as T);
      }
      return Promise.resolve({
        files: [], filter_contract: 'account-files-v1', limit: 1, offset: 0, total: 0,
      } as T);
    },
  } as HermesApiClient;

  await new HermesCloudApi(client).getAllAccountFiles({
    dateFrom: '1750000000',
    dateTo: '1750000000123',
    limit: 1,
  });

  assert.ok(queries.every((query) => query?.date_from === '1750000000'));
  assert.ok(queries.every((query) => query?.date_to === '1750000000123'));
});

test('filtered artifact pagination uses the server filtered total without draining all pages', async () => {
  const calls: Call[] = [];
  const createdAt = Math.floor(Date.parse('2026-07-15T12:00:00Z') / 1_000);
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ path, options });
      if (path.endsWith('/files')) {
        return Promise.resolve({
          files: [],
          filter_contract: 'account-files-v1',
          limit: 2,
          offset: 0,
          total: 0,
        } as T);
      }
      assert.deepEqual(options.query, {
        limit: 2,
        offset: 0,
        q: 'report',
        date_from: '2026-01-01',
        date_to: '2026-12-31',
        filter_contract: 'account-files-v1',
      });
      return Promise.resolve({
        artifacts: [0, 1].map((index) => ({
          id: `toolout_report_${index}`,
          account_generation: 'generation-1',
          conversation_id: 'conversation-1',
          created_at: createdAt - index,
          retained_until: createdAt + 1_000,
          sha256: `sha-${index}`,
          size_bytes: 1,
          state: 'available',
          tool_call_id: `call-${index}`,
          tool_name: 'report',
          turn_id: 'turn-1',
        })),
        filter_contract: 'account-files-v1',
        limit: 2,
        offset: 0,
        total: 2,
      } as T);
    },
  } as HermesApiClient;

  const result = await new HermesCloudApi(client).getAllAccountFiles({
    keyword: 'report',
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
    limit: 1,
    offset: 1,
  });

  assert.deepEqual(result.files.map(({ id }) => id), ['toolout_report_1']);
  assert.equal(result.total, 2);
  assert.equal(calls.filter(({ path }) => path.endsWith('/tool-output-artifacts')).length, 1);
});

test('filtered artifact pagination fails closed when the server ignores the filter contract', async () => {
  const client = {
    request<T>(path: string): Promise<T> {
      if (path.endsWith('/files')) {
        return Promise.resolve({
          files: [],
          filter_contract: 'account-files-v1',
          limit: 1,
          offset: 0,
          total: 0,
        } as T);
      }
      return Promise.resolve({ artifacts: [], limit: 1, offset: 0, total: 500 } as T);
    },
  } as HermesApiClient;

  await assert.rejects(
    new HermesCloudApi(client).getAllAccountFiles({ keyword: 'report', limit: 1 }),
    /does not support filtered tool-output pagination/,
  );
});

test('custom model API keys require an explicit preserve, replace, or delete action', () => {
  assert.equal(customModelApiKeyAction(''), 'preserve');
  assert.equal(customModelApiKeyAction('********', { preview: '********' }), 'preserve');
  assert.equal(customModelApiKeyAction('sk-new'), 'replace');
  assert.equal(customModelApiKeyAction('', { deleteRequested: true }), 'delete');
});

test('encrypted tool outputs are real account files with working download and delete routes', async () => {
  const calls: Call[] = [];
  const downloads: string[] = [];
  const client = {
    download(path: string): Promise<Blob> {
      downloads.push(path);
      return Promise.resolve(new Blob(['full tool output'], { type: 'text/plain' }));
    },
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ path, options });
      if (path.endsWith('/files')) {
        return Promise.resolve({
          files: [],
          filter_contract: 'account-files-v1',
          limit: 200,
          offset: 0,
          total: 0,
        } as T);
      }
      if (path.endsWith('/tool-output-artifacts')) {
        return Promise.resolve({
          artifacts: [{
            account_generation: 'generation-2',
            conversation_id: 'conversation-1',
            created_at: 1_800_000_000,
            id: 'toolout_1234',
            retained_until: 1_900_000_000,
            sha256: 'abc',
            size_bytes: 16,
            state: 'available',
            tool_call_id: 'call-1',
            tool_name: 'terminal',
            turn_id: 'turn-1',
          }],
          filter_contract: 'account-files-v1',
          limit: 200,
          offset: 0,
          total: 1,
        } as T);
      }
      return Promise.resolve({ id: 'toolout_1234', ok: true } as T);
    },
  } as HermesApiClient;
  const api = new HermesCloudApi(client);

  const listing = await api.getAllAccountFiles();
  const downloaded = await api.downloadAccountFile('toolout_1234');
  await api.deleteAccountFile('toolout_1234');

  assert.equal(listing.files.length, 1);
  assert.deepEqual(listing.files[0], {
    available_at: 1_800_000_000_000,
    conversation_id: 'conversation-1',
    created_at: 1_800_000_000_000,
    download_url: '/api/plugins/collaboration/tool-output-artifacts/toolout_1234/download',
    extension: 'txt',
    file_type: 'tool_output',
    id: 'toolout_1234',
    mime_type: 'text/plain',
    name: 'terminal-call-1.txt',
    sha256: 'abc',
    size: 16,
    source: 'model_output',
    status: 'available',
    turn_id: 'turn-1',
    updated_at: 1_800_000_000_000,
  });
  assert.equal(await downloaded.text(), 'full tool output');
  assert.deepEqual(downloads, [
    '/api/plugins/collaboration/tool-output-artifacts/toolout_1234/download',
  ]);
  assert.equal(calls.at(-1)?.path, '/api/plugins/collaboration/tool-output-artifacts/toolout_1234');
  assert.equal(calls.at(-1)?.options.method, 'DELETE');
});

test('management mutations preserve the official method and body contracts', async () => {
  const { api, calls } = createApi();

  await api.renameSession('session / 中文', '新标题', 'default');
  await api.setWebhookEnabled('deployment hook', false);
  await api.setPluginEnabled('kanban', true);
  await api.updateHermes();

  assert.equal(calls[0].path, '/api/sessions/session%20%2F%20%E4%B8%AD%E6%96%87');
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {
    profile: 'default',
    title: '新标题',
  });
  assert.equal(calls[1].path, '/api/webhooks/deployment%20hook/enabled');
  assert.equal(calls[1].options.method, 'PUT');
  assert.equal(
    calls[2].path,
    '/api/dashboard/agent-plugins/kanban/enable',
  );
  assert.equal(calls[2].options.method, 'POST');
  assert.equal(calls[3].path, '/api/hermes/update');
  assert.equal(calls[3].options.method, 'POST');
});

test('profile-scoped management routes keep the active Profile on every request', async () => {
  const { api, calls } = createApi();

  await api.loadRoute('cron', 'reviewer');
  await api.loadRoute('mcp', 'reviewer');
  await api.loadRoute('channels', 'reviewer');
  await api.loadRoute('env', 'reviewer');

  assert.deepEqual(calls.map(({ path }) => path), [
    '/api/cron/jobs',
    '/api/mcp/servers',
    '/api/mcp/catalog',
    '/api/plugins/collaboration/managed-installations',
    '/api/plugins/collaboration/managed-resources',
    '/api/messaging/platforms',
    '/api/env',
  ]);
  assert.ok(calls
    .filter(({ path }) => path !== '/api/plugins/collaboration/managed-resources')
    .every(({ options }) => options.query?.profile === 'reviewer'));
  assert.deepEqual(calls[4].options.query, { cursor: '0', limit: '500' });
});

test('managed installations are submitted once to the authoritative server', async () => {
  const { api, calls } = createApi();

  await api.createManagedInstallation({
    identifier: 'official/security-review',
    kind: 'skill',
    request_id: 'mobile-install-1',
  });

  assert.equal(calls[0].path, '/api/plugins/collaboration/managed-installations');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {
    identifier: 'official/security-review',
    kind: 'skill',
    request_id: 'mobile-install-1',
  });
});

test('the collaboration client keeps conversation and hosted-turn state on the server', async () => {
  const { api, calls } = createApi();

  await api.createConversation('default', '跨设备会话');
  await api.saveRuntimeSession('conversation-1', 'default', 'session-1', 'turn-1', 'running');
  await api.createHostedTurn('conversation-1', {
    artifactRequired: false,
    attachmentIds: ['file-input'],
    content: '检查并部署项目',
    mode: 'work',
    profiles: ['default', 'dbb3-worker', 'reviewer'],
    routeMetadata: { confidence: 0.98, mode: 'work' },
    title: '部署项目',
    turnId: 'hosted-1',
  });

  assert.deepEqual(
    calls.map(({ path }) => path),
    [
      '/api/plugins/collaboration/single/conversations',
      '/api/plugins/collaboration/single/conversations/conversation-1/runtime-session',
      '/api/plugins/collaboration/single/conversations/conversation-1/hosted-turns',
    ],
  );
  assert.deepEqual(JSON.parse(String(calls[1].options.body)), {
    profile: 'default',
    session_id: 'session-1',
    status: 'running',
    turn_id: 'turn-1',
  });
  assert.deepEqual(JSON.parse(String(calls[2].options.body)), {
    artifact_required: false,
    attachment_ids: ['file-input'],
    attachment_context: '',
    content: '检查并部署项目',
    delivery_context: '',
    mode: 'work',
    profiles: ['default', 'dbb3-worker', 'reviewer'],
    route_metadata: { confidence: 0.98, mode: 'work' },
    title: '部署项目',
    turn_id: 'hosted-1',
  });
});

test('atomic hosted-turn enqueue carries one stable idempotency request and supports cancellation', async () => {
  const { api, calls } = createApi();
  const message = {
    content: '检查并部署项目',
    created_at: 1_752_700_000_000,
    id: 'user-1',
    kind: 'message',
    name: '你',
    role: 'user',
    status: 'completed',
  };

  await api.enqueueHostedTurn('conversation / 1', {
    attachmentContext: '- input.csv',
    attachmentIds: ['file-1'],
    deliveryContext: '由服务端路由决定交付。',
    message,
    profiles: ['reviewer'],
    recentMessages: [{ role: 'assistant', content: '准备完成。' }],
    requestId: 'request-stable-1',
    turnId: 'turn-stable-1',
  });
  await api.cancelHostedTurn('conversation / 1', 'turn / 1', '用户取消');

  assert.equal(
    calls[0].path,
    '/api/plugins/collaboration/single/conversations/conversation%20%2F%201/enqueue',
  );
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {
    attachment_context: '- input.csv',
    attachment_ids: ['file-1'],
    delivery_context: '由服务端路由决定交付。',
    message,
    profiles: ['reviewer'],
    recent_messages: [{ role: 'assistant', content: '准备完成。' }],
    request_id: 'request-stable-1',
    turn_id: 'turn-stable-1',
  });
  assert.equal(
    calls[1].path,
    '/api/plugins/collaboration/single/conversations/conversation%20%2F%201/hosted-turns/turn%20%2F%201/cancel',
  );
  assert.deepEqual(JSON.parse(String(calls[1].options.body)), {
    reason: '用户取消',
    request_id: 'cancel-turn / 1',
  });
});

test('collaboration room retries reuse the caller supplied request and turn identity', async () => {
  const { api, calls } = createApi();

  await api.sendCollaborationRoomMessage(
    'room / 1',
    '继续执行',
    ['dbb3-worker', 'pc-worker'],
    'room-request-stable-1',
  );

  assert.equal(
    calls[0].path,
    '/api/plugins/collaboration/rooms/room%20%2F%201/messages',
  );
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {
    content: '继续执行',
    profiles: ['dbb3-worker', 'pc-worker'],
    request_id: 'room-request-stable-1',
    turn_id: 'room-turn-stable-1',
  });
});

test('conversation attachment retries carry one stable server idempotency identity', async () => {
  const { api, calls } = createApi();

  await api.uploadConversationAttachment(
    'conversation-1',
    {
      mimeType: 'text/plain',
      name: 'input.txt',
      sha256: 'a'.repeat(64),
      uri: 'data:text/plain,hello',
    },
    {
      messageId: 'message-1',
      profile: 'reviewer',
      turnId: 'turn-1',
      uploadId: 'upload-stable-1',
    },
  );

  assert.equal(
    calls[0].path,
    '/api/plugins/collaboration/single/conversations/conversation-1/attachments',
  );
  assert.deepEqual(calls[0].options.headers, {
    'Content-Type': 'text/plain',
    'X-Filename': 'input.txt',
    'X-Content-SHA256': 'a'.repeat(64),
    'X-Message-ID': 'message-1',
    'X-Profile': 'reviewer',
    'X-Turn-ID': 'turn-1',
    'X-Upload-ID': 'upload-stable-1',
  });
});

test('conversation history reads, renames, and deletes the same server records as chat', async () => {
  const calls: Call[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ path, options });
      if (path.endsWith('/single/conversations')) {
        return Promise.resolve({
          conversations: [{
            id: 'chat-1',
            profile: 'default',
            title: '历史会话',
            messages: [{ id: 'm-1', role: 'user', name: '你', content: '继续' }],
            message_count: 1,
            created_at: 1_720_000_000_000,
            updated_at: 1_720_000_100_000,
          }],
        } as T);
      }
      if (path.endsWith('/single/conversations/chat-1')) {
        return Promise.resolve({
          conversation: {
            id: 'chat-1',
            profile: 'default',
            title: '历史会话',
            messages: [{ id: 'm-1', role: 'user', name: '你', content: '继续' }],
          },
        } as T);
      }
      return Promise.resolve({ ok: true } as T);
    },
  } as HermesApiClient;
  const api = new HermesCloudApi(client);

  const history = await api.loadRoute('sessions', 'default') as {
    sessions: Array<{ id: string; message_count: number }>;
  };
  const opened = await api.getConversation('chat-1');
  await api.renameConversation('chat-1', '继续处理');
  await api.deleteConversation('chat-1');

  assert.equal(history.sessions[0].id, 'chat-1');
  assert.equal(history.sessions[0].message_count, 1);
  assert.equal(opened.conversation.messages[0].content, '继续');
  assert.deepEqual(calls.map(({ path }) => path), [
    '/api/plugins/collaboration/single/conversations',
    '/api/plugins/collaboration/single/conversations/chat-1',
    '/api/plugins/collaboration/single/conversations/chat-1',
    '/api/plugins/collaboration/single/conversations/chat-1',
  ]);
  assert.equal(calls[2].options.method, 'PATCH');
  assert.equal(calls[3].options.method, 'DELETE');
});

test('unified history adds official task titles and suppresses mapped sessions', () => {
  const merged = mergeUnifiedConversationIndex(
    [{
      id: 'chat-1',
      profile: 'default',
      title: '已认领',
      messages: [],
      runtime_sessions: { default: 'official-mapped' },
      updated_at: 2_000,
    }],
    [
      {
        id: 'official-new',
        profile: 'reviewer',
        source: 'cli',
        model: 'model-a',
        title: 'Hermes 任务摘要标题',
        started_at: 1,
        ended_at: 2,
        last_active: 3,
        is_active: false,
        message_count: 4,
        tool_call_count: 2,
        input_tokens: 0,
        output_tokens: 0,
        preview: '摘要预览',
      },
      {
        id: 'official-mapped',
        source: 'cli',
        model: null,
        title: '不应重复',
        started_at: 1,
        ended_at: 2,
        last_active: 2,
        is_active: false,
        message_count: 1,
        tool_call_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        preview: null,
      },
    ],
  );

  assert.deepEqual(merged.map(({ id }) => id), [
    officialConversationPlaceholderId('reviewer', 'official-new'),
    'chat-1',
  ]);
  assert.equal(merged[0].title, 'Hermes 任务摘要标题');
  assert.equal(merged[0].official_model, 'model-a');
  assert.equal(merged[0].profile, 'reviewer');
  assert.equal(merged[0].official_profile, 'reviewer');
  assert.equal(merged[0].message_count, 4);
});

test('official placeholders include Profile identity and legacy ids remain readable', () => {
  const sessions = ['default', 'reviewer'].map((profile, index) => ({
    id: 'shared-session',
    profile,
    source: 'cli',
    model: null,
    title: `${profile} session`,
    started_at: 1,
    ended_at: 2,
    last_active: 3 + index,
    is_active: false,
    message_count: 1,
    tool_call_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    preview: null,
  }));

  const merged = mergeUnifiedConversationIndex([], sessions);
  assert.deepEqual(new Set(merged.map(({ id }) => id)), new Set([
    officialConversationPlaceholderId('default', 'shared-session'),
    officialConversationPlaceholderId('reviewer', 'shared-session'),
  ]));
  assert.deepEqual(
    parseOfficialConversationPlaceholderId(
      officialConversationPlaceholderId('reviewer', 'shared-session'),
    ),
    { profile: 'reviewer', sessionId: 'shared-session' },
  );
  assert.deepEqual(
    parseOfficialConversationPlaceholderId('official:v2:reviewer:abc'),
    { profile: '', sessionId: 'v2:reviewer:abc' },
  );
  assert.deepEqual(
    parseOfficialConversationPlaceholderId('official:shared-session'),
    { profile: '', sessionId: 'shared-session' },
  );
  assert.deepEqual(
    parseOfficialConversationPlaceholderId('official:agent:main:telegram:123'),
    { profile: '', sessionId: 'agent:main:telegram:123' },
  );
});

test('official session history paginates until the complete account index is loaded', async () => {
  const offsets: number[] = [];
  const all = ['one', 'two', 'three'];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      assert.equal(path, '/api/sessions');
      const offset = Number(options.query?.offset || 0);
      const limit = Number(options.query?.limit || 2);
      offsets.push(offset);
      return Promise.resolve({
        sessions: all.slice(offset, offset + limit).map((id) => ({ id })),
        total: all.length,
        limit,
        offset,
      } as T);
    },
  } as HermesApiClient;

  const result = await new HermesCloudApi(client).getAllSessions('default', 2);

  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(result.sessions.map(({ id }) => id), all);
});

test('unified official history drains the all-profile session index and keeps ownership', async () => {
  const offsets: number[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      assert.equal(path, '/api/profiles/sessions');
      const offset = Number(options.query?.offset || 0);
      offsets.push(offset);
      const sessions = offset === 0
        ? [
          { id: 'default-session', profile: 'default' },
          { id: 'review-session', profile: 'reviewer' },
        ]
        : [{ id: 'pc-session', profile: 'pc-worker' }];
      return Promise.resolve({
        sessions,
        total: 3,
        limit: 2,
        offset,
      } as T);
    },
  } as HermesApiClient;

  const result = await new HermesCloudApi(client).getAllProfileSessions(2);

  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(
    result.sessions.map(({ id, profile }) => [id, profile]),
    [
      ['default-session', 'default'],
      ['review-session', 'reviewer'],
      ['pc-session', 'pc-worker'],
    ],
  );
});

test('custom model configuration carries the full runtime contract', async () => {
  const { api, calls } = createApi();
  const configuration = {
    apiKey: 'secret',
    apiMode: 'codex_responses' as const,
    baseUrl: 'https://model.example/v1',
    contextLength: 200_000,
    model: 'model-a',
    reasoningEffort: 'high' as const,
  };

  await api.saveCustomModel(configuration, 'reviewer');
  await api.testCustomModel(configuration, 'reviewer');

  assert.deepEqual(calls.map(({ path }) => path), [
    '/api/model/custom',
    '/api/model/custom/test',
  ]);
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {
    api_key: 'secret',
    api_key_action: 'replace',
    api_mode: 'codex_responses',
    base_url: 'https://model.example/v1',
    context_length: 200000,
    model: 'model-a',
    profile: 'reviewer',
    reasoning_effort: 'high',
  });
});

test('custom model discovery runs through Hermes server with normalized input', async () => {
  const { api, calls } = createApi();
  const result = await api.discoverCustomModels(
    'https://models.example/v1/',
    'private-key',
    'reviewer',
  );

  assert.deepEqual(result, {
    baseUrl: 'https://models.example/v1',
    latency_ms: 240,
    message: 'Model catalog loaded.',
    models: ['model-b', 'model-a'],
    ok: true,
    reachable: true,
    status: 200,
  });
  assert.equal(calls[0].path, '/api/model/custom/discover');
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {
    api_key: 'private-key',
    base_url: 'https://models.example/v1',
    profile: 'reviewer',
  });
});

test('custom model discovery rejects invalid URLs before sending a key', async () => {
  const { api, calls } = createApi();
  await assert.rejects(api.discoverCustomModels('file:///tmp/models'), /HTTP\(S\)/);
  assert.equal(calls.length, 0);
});

test('custom model credentials require HTTPS except for loopback services', async () => {
  const { api, calls } = createApi();
  const insecure = {
    apiKey: 'must-not-leak',
    apiMode: 'chat_completions' as const,
    baseUrl: 'http://models.example/v1',
    contextLength: 32_000,
    model: 'model-a',
    reasoningEffort: 'medium' as const,
  };

  await assert.rejects(
    api.discoverCustomModels(insecure.baseUrl, insecure.apiKey),
    /HTTPS/,
  );
  assert.throws(() => api.saveCustomModel(insecure), /HTTPS/);
  assert.throws(() => api.testCustomModel(insecure), /HTTPS/);
  assert.equal(calls.length, 0);

  await api.saveCustomModel({ ...insecure, baseUrl: 'http://127.0.0.1:11434/v1' });
  const body = JSON.parse(String(calls[0].options.body)) as Record<string, unknown>;
  assert.equal(body.base_url, 'http://127.0.0.1:11434/v1');
});

test('Studio memory reads and writes the profile-scoped Hermes memory contract', async () => {
  const calls: Call[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ path, options });
      return Promise.resolve({
        memory: 'notes',
        memory_mtime: 1_700_000_000,
        soul: 'identity',
        soul_mtime: 'Yesterday',
        user: 'profile',
        user_mtime: 1_700_000_100_000,
      } as T);
    },
  } as HermesApiClient;
  const api = new HermesCloudApi(client);

  const loaded = await api.getStudioMemory('reviewer');
  const saved = await api.saveStudioMemory('reviewer', 'user', 'updated profile');

  assert.deepEqual(calls.map(({ path }) => path), [
    '/api/hermes/memory',
    '/api/hermes/memory',
  ]);
  assert.equal(calls[0]?.options.profile, 'reviewer');
  assert.equal(calls[1]?.options.profile, 'reviewer');
  assert.deepEqual(JSON.parse(String(calls[1]?.options.body)), {
    content: 'updated profile',
    section: 'user',
  });
  assert.equal(loaded.memory, 'notes');
  assert.equal(loaded.soulMtime, 'Yesterday');
  assert.equal(saved.user, 'profile');
});

test('group collaboration reads and writes the modified Hermes room APIs', async () => {
  const calls: Call[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ path, options });
      if (path.endsWith('/rooms')) return Promise.resolve({ rooms: [{ id: 'room-1' }] } as T);
      if (path.endsWith('/profiles')) return Promise.resolve({ profiles: [] } as T);
      if (path.endsWith('/rooms/room-2')) {
        return Promise.resolve({ room: { id: 'room-2', messages: [] } } as T);
      }
      return Promise.resolve({ ok: true } as T);
    },
  } as HermesApiClient;
  const api = new HermesCloudApi(client);

  await api.loadRoute('collaboration', 'default', 'room-2');
  await api.sendCollaborationRoomMessage('room / 中文', '执行任务', ['worker', 'reviewer']);

  assert.deepEqual(calls.slice(0, 3).map(({ path }) => path), [
    '/api/plugins/collaboration/rooms',
    '/api/plugins/collaboration/profiles',
    '/api/plugins/collaboration/rooms/room-2',
  ]);
  assert.equal(calls[3].path, '/api/plugins/collaboration/rooms/room%20%2F%20%E4%B8%AD%E6%96%87/messages');
  const roomBody = JSON.parse(String(calls[3].options.body)) as Record<string, unknown>;
  assert.deepEqual({ content: roomBody.content, profiles: roomBody.profiles }, {
    content: '执行任务',
    profiles: ['worker', 'reviewer'],
  });
  assert.match(String(roomBody.request_id), /^room-request-/);
  assert.match(String(roomBody.turn_id), /^room-turn-/);
});

test('account file consumers retain the bounded streaming transport contract', async () => {
  const calls: Array<{ path: string; options: HermesRequestOptions }> = [];
  const client = {
    async consumeDownload<T>(
      path: string,
      consume: (response: Response, signal: AbortSignal) => Promise<T>,
      options: HermesRequestOptions = {},
    ) {
      calls.push({ path, options });
      return consume(new Response('streamed account file'), new AbortController().signal);
    },
  } as HermesApiClient;
  const api = new HermesCloudApi(client);

  assert.equal(
    await api.consumeAccountFile(
      'file / one',
      true,
      (response) => response.text(),
    ),
    'streamed account file',
  );
  assert.equal(
    await api.consumeAccountFile(
      'toolout_1234',
      false,
      (response) => response.text(),
    ),
    'streamed account file',
  );
  assert.deepEqual(calls.map(({ path }) => path), [
    '/api/plugins/collaboration/files/file%20%2F%20one/download',
    '/api/plugins/collaboration/tool-output-artifacts/toolout_1234/download',
  ]);
  assert.equal(calls[0].options.query?.preview, true);
});

test('Bot Mode roster uses the canonical mobile bot endpoint', async () => {
  const { api, calls } = createApi();
  await api.getBots();
  await api.getBotMeta('hk worker');
  await api.updateBotMeta('hk worker', { hidden: true });
  assert.equal(calls[0].path, '/api/bots');
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[1].path, '/api/bots/hk%20worker/meta');
  assert.equal(calls[2].path, '/api/bots/hk%20worker/meta');
  assert.equal(calls[2].options.method, 'PATCH');
});

test('session summaries keep preview, model precedence, and tool counts after the single-pass rewrite', () => {
  const now = 1_800_000_000_000;
  const summary = conversationSessionSummary({
    created_at: now - 600_000,
    id: 'summary-parity',
    message_count: 0,
    messages: [
      {
        content: '第一条提问',
        id: 'u-1',
        name: '你',
        role: 'user',
        // Tool activities may live under meta when the top-level array is
        // absent; meta shadows metadata entirely (spread-merge precedence).
        meta: {
          activities: [
            { category: 'terminal', command: 'ls' },
            { category: 'status' },
          ],
        },
        metadata: { activities: [{ category: 'browser' }] },
      },
      {
        content: '带活动的回复',
        id: 'a-1',
        name: 'Hermes',
        role: 'assistant',
        activities: [
          { category: 'terminal' },
          { kind: 'reasoning' },
          { category: 'Model' },
          { kind: 'file-write' },
          'not-a-record',
        ] as never,
        meta: { actual_model: 'glm-5', actual_provider: 'zai' },
        metadata: { actual_model: 'shadowed', actual_provider: 'shadowed' },
      },
      { content: '', id: 's-1', name: '', role: 'system' },
      { content: '收尾的追问', id: 'u-2', name: '你', role: 'user' },
    ],
    profile: 'default',
    title: 'summary parity',
    updated_at: now,
  }, now);

  // Preview: latest user/assistant message, skipping the trailing system row.
  assert.equal(summary.preview, '收尾的追问');
  // Model: assistant meta wins over metadata when both carry the key.
  assert.equal(summary.model, 'zai/glm-5');
  // Tool count: u-1 contributes 1 (terminal; status excluded; metadata list
  // shadowed by meta), a-1 contributes 2 (terminal + file-write; reasoning,
  // Model, and the non-record entry excluded).
  assert.equal(summary.tool_call_count, 3);
  assert.equal(summary.message_count, 4);
  assert.equal(summary.is_active, false);
});
