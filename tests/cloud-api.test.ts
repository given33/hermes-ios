import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesApiClient, HermesRequestOptions } from '../src/api/HermesApiClient';
import { HermesCloudApi } from '../src/api/HermesCloudApi';

interface Call {
  options: HermesRequestOptions;
  path: string;
}

function createApi() {
  const calls: Call[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ path, options });
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
      '/api/sessions',
      '/api/analytics/usage',
      '/api/analytics/models',
      '/api/dashboard/plugins',
      '/api/dashboard/plugins/hub',
      '/api/messaging/platforms',
    ],
  );
  assert.equal(calls[0].options.profile, 'reviewer');
  assert.equal(calls[1].options.profile, 'reviewer');
  assert.equal(calls[2].options.profile, 'reviewer');
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
