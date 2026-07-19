import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesApiClient, HermesRequestOptions } from '../src/api/HermesApiClient';
import {
  HermesCloudApi,
  mergeUnifiedConversationIndex,
  officialConversationPlaceholderId,
  parseOfficialConversationPlaceholderId,
} from '../src/api/HermesCloudApi';

interface Call {
  options: HermesRequestOptions;
  path: string;
}

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
      '/api/profiles/sessions',
      '/api/analytics/usage',
      '/api/analytics/models',
      '/api/dashboard/plugins',
      '/api/dashboard/plugins/hub',
      '/api/messaging/platforms',
    ],
  );
  assert.equal(calls[0].options.profile, undefined);
  assert.equal(calls[1].options.profile, undefined);
  assert.deepEqual(calls[1].options.query, {
    archived: 'exclude',
    limit: 100,
    min_messages: 0,
    offset: 0,
    order: 'recent',
    profile: 'all',
  });
  assert.equal(calls[2].options.profile, 'reviewer');
  assert.equal(calls[3].options.profile, 'reviewer');
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
    limit: 200,
    offset: 0,
    q: undefined,
    source: undefined,
    status: undefined,
    type: undefined,
  });
  assert.equal(calls[1].path, '/api/plugins/collaboration/route');
  assert.deepEqual(JSON.parse(String(calls[1].options.body)), {
    attachments: [{ name: 'input.csv', mime_type: 'text/csv', source: 'user_upload' }],
    content: '继续完成并发送文件',
    mode: 'auto',
    recent_messages: [{ role: 'assistant', content: '报告已经生成。' }],
  });
  assert.equal(
    calls[2].path,
    '/api/plugins/collaboration/files/file%20%2F%20%E4%B8%AD%E6%96%87',
  );
  assert.equal(calls[2].options.method, 'DELETE');
});

test('account file route drains every server page before SwiftUI search and date filtering', async () => {
  const calls: Call[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ path, options });
      const offset = Number(options.query?.offset || 0);
      const limit = Number(options.query?.limit || 200);
      const remaining = Math.max(0, 450 - offset);
      const count = Math.min(125, limit, remaining);
      return Promise.resolve({
        files: Array.from({ length: count }, (_, index) => ({
          id: `file-${offset + index}`,
          name: `artifact-${offset + index}.txt`,
        })),
        limit,
        offset,
        total: 450,
      } as T);
    },
  } as HermesApiClient;

  const result = await new HermesCloudApi(client).loadRoute('files') as { files: unknown[] };

  assert.equal(result.files.length, 450);
  assert.deepEqual(calls.map(({ options }) => options.query?.offset), [0, 125, 250, 375]);
  assert.ok(calls.every(({ path }) => path === '/api/plugins/collaboration/files'));
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
    '/api/messaging/platforms',
    '/api/model/credentials',
  ]);
  assert.ok(calls.every(({ options }) => options.query?.profile === 'reviewer'));
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
  assert.deepEqual(JSON.parse(String(calls[1].options.body)), { reason: '用户取消' });
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
    '/api/profiles/sessions',
    '/api/plugins/collaboration/single/conversations/chat-1',
    '/api/plugins/collaboration/single/conversations/chat-1',
    '/api/plugins/collaboration/single/conversations/chat-1',
  ]);
  assert.equal(calls[3].options.method, 'PATCH');
  assert.equal(calls[4].options.method, 'DELETE');
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
    api_mode: 'codex_responses',
    base_url: 'https://model.example/v1',
    context_length: 200000,
    model: 'model-a',
    profile: 'reviewer',
    reasoning_effort: 'high',
  });
});

test('custom model discovery reads a bounded Base URL catalog without saving the key', async () => {
  const { api, calls: serverCalls } = createApi();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({
      data: [
        { id: 'model-b' },
        { id: 'model-a' },
        { id: 'model-a' },
      ],
    }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  };
  try {
    const result = await api.discoverCustomModels(
      'https://models.example/v1/',
      'private-key',
    );
    assert.deepEqual(result, {
      baseUrl: 'https://models.example/v1',
      models: ['model-b', 'model-a'],
    });
    assert.equal(calls[0].input, 'https://models.example/v1/models');
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer private-key');
    assert.deepEqual(serverCalls, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('custom model discovery rejects invalid URLs and oversized catalogs', async () => {
  const { api } = createApi();
  await assert.rejects(api.discoverCustomModels('file:///tmp/models'), /HTTP\(S\)/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('x'.repeat(1024 * 1024 + 1), { status: 200 });
  try {
    await assert.rejects(
      api.discoverCustomModels('https://models.example/v1'),
      /1 MiB/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('custom model discovery rejects a cross-origin final redirect', async () => {
  const { api } = createApi();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const response = new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    Object.defineProperty(response, 'url', {
      configurable: true,
      value: 'https://attacker.example/collect',
    });
    return response;
  };
  try {
    await assert.rejects(
      api.discoverCustomModels('https://models.example/v1', 'temporary-key'),
      /untrusted|不受信任/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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
