import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesApiClient, HermesRequestOptions } from '../src/api/HermesApiClient';
import {
  HermesCloudApi,
  mergeUnifiedConversationIndex,
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
      '/api/sessions',
      '/api/analytics/usage',
      '/api/analytics/models',
      '/api/dashboard/plugins',
      '/api/dashboard/plugins/hub',
      '/api/messaging/platforms',
    ],
  );
  assert.equal(calls[0].options.profile, undefined);
  assert.equal(calls[1].options.profile, 'default');
  assert.deepEqual(calls[1].options.query, {
    limit: 100,
    offset: 0,
    order: 'recent',
  });
  assert.equal(calls[2].options.profile, 'reviewer');
  assert.equal(calls[3].options.profile, 'reviewer');
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
    '/api/env',
  ]);
  assert.ok(calls.every(({ options }) => options.query?.profile === 'reviewer'));
});

test('the collaboration client keeps conversation and hosted-turn state on the server', async () => {
  const { api, calls } = createApi();

  await api.createConversation('default', '跨设备会话');
  await api.saveRuntimeSession('conversation-1', 'default', 'session-1', 'turn-1', 'running');
  await api.createHostedTurn('conversation-1', {
    artifactRequired: false,
    content: '检查并部署项目',
    profiles: ['default', 'dbb3-worker', 'reviewer'],
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
    attachment_context: '',
    content: '检查并部署项目',
    delivery_context: '',
    profiles: ['default', 'dbb3-worker', 'reviewer'],
    title: '部署项目',
    turn_id: 'hosted-1',
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
    '/api/sessions',
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

  assert.deepEqual(merged.map(({ id }) => id), ['official:official-new', 'chat-1']);
  assert.equal(merged[0].title, 'Hermes 任务摘要标题');
  assert.equal(merged[0].official_model, 'model-a');
  assert.equal(merged[0].message_count, 4);
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
  assert.deepEqual(JSON.parse(String(calls[3].options.body)), {
    content: '执行任务',
    profiles: ['worker', 'reviewer'],
  });
});
