import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesCloudApi } from '../src/api/HermesCloudApi';
import {
  decodeModelSelection,
  encodeModelSelection,
  loadHermesSwiftUIRouteSnapshot,
  performHermesSwiftUIRouteAction,
} from '../src/app/hermes-route-data';

test('session snapshots are derived from the current server response', async () => {
  const api = {
    loadRoute: async () => ({
      sessions: [
        {
          id: 'session-1',
          is_active: true,
          last_active: 1_720_000_000,
          message_count: 8,
          model: 'claude-sonnet',
          preview: 'fallback preview',
          started_at: 1_719_000_000,
          title: '云端会话',
          tool_call_count: 3,
        },
      ],
    }),
  } as unknown as HermesCloudApi;

  const snapshot = await loadHermesSwiftUIRouteSnapshot(api, 'sessions', 'default');

  assert.equal(snapshot.route, 'sessions');
  assert.equal(snapshot.sessions?.length, 1);
  assert.equal(snapshot.sessions?.[0].id, 'session-1');
  assert.equal(snapshot.sessions?.[0].title, '云端会话');
  assert.equal(snapshot.sessions?.[0].running, true);
  assert.equal(snapshot.sessions?.[0].detail, '8 条消息 · 3 次工具调用');
});

test('analytics and model snapshots do not invent unavailable server values', async () => {
  const responses: Record<string, unknown> = {
    analytics: {
      usage: {
        daily: [{ day: '2026-07-16', input_tokens: 1200, output_tokens: 400 }],
        totals: {
          total_actual_cost: 1.25,
          total_input: 1200,
          total_output: 400,
        },
      },
    },
    models: {
      info: {
        effective_context_length: 200000,
        model: 'model-a',
        provider: 'provider-a',
      },
      options: {
        providers: [{ models: ['model-a', 'model-b'], slug: 'provider-a' }],
      },
    },
  };
  const api = {
    loadRoute: async (route: string) => responses[route],
  } as unknown as HermesCloudApi;

  const analytics = await loadHermesSwiftUIRouteSnapshot(api, 'analytics', 'default');
  const models = await loadHermesSwiftUIRouteSnapshot(api, 'models', 'default');

  assert.equal(analytics.analytics?.successRate, '-');
  assert.equal(analytics.analytics?.monthlyCost, '$1.25');
  assert.deepEqual(analytics.analytics?.points[0], {
    id: '2026-07-16',
    input: 1200,
    label: '07/16',
    output: 400,
  });
  assert.equal(models.models?.find((model) => model.active)?.provider, 'provider-a');
  assert.deepEqual(
    decodeModelSelection(models.models?.[0].id ?? ''),
    { model: 'model-a', provider: 'provider-a' },
  );
  assert.equal(decodeModelSelection('provider/model'), null);
});

test('native route actions mutate the server and request a fresh snapshot', async () => {
  const calls: unknown[][] = [];
  const api = {
    deleteSession: async (...args: unknown[]) => { calls.push(['delete', ...args]); },
    setModel: async (...args: unknown[]) => { calls.push(['model', ...args]); },
  } as unknown as HermesCloudApi;

  const deleted = await performHermesSwiftUIRouteAction(api, {
    action: 'session.delete',
    payload: { id: 'session-1', route: 'sessions' },
  }, 'reviewer');
  const selected = await performHermesSwiftUIRouteAction(api, {
    action: 'model.select',
    payload: {
      id: encodeModelSelection('provider-a', 'model-a'),
      route: 'models',
    },
  }, 'reviewer');

  assert.equal(deleted, 'reload');
  assert.equal(selected, 'reload');
  assert.deepEqual(calls, [
    ['delete', 'session-1', 'reviewer'],
    ['model', 'provider-a', 'model-a', 'reviewer'],
  ]);
});

test('all native management routes render the current cloud workspace response', async () => {
  const responses: Record<string, unknown> = {
    cron: [{ id: 'cron-1', name: '每日总结', schedule: '0 9 * * *', prompt: '总结会话', enabled: true }],
    skills: { skills: [{ name: 'browser', description: '浏览网页', bundled: true, enabled: true }] },
    plugins: { manifests: [{ name: 'collaboration', description: '多 Agent 协作', enabled: true }] },
    mcp: { servers: { servers: [{ name: 'filesystem', command: 'npx', args: ['server-filesystem'], enabled: true }] }, catalog: { entries: [] } },
    webhooks: { enabled: true, subscriptions: [{ name: 'deploy', description: '部署回调', enabled: true }] },
    pairing: {
      pending: [{ platform: 'telegram', user_id: '42', user_name: 'Alice', age_minutes: 3 }],
      approved: [{ platform: 'discord', user_id: '84', user_name: 'Bob' }],
    },
    achievements: { tasks_completed: 7, day_streak: 3, achievements: [{ id: 'first', title: '首次任务', progress: 1 }] },
    collaboration: {
      rooms: [{ id: 'room-1', name: '原生开发' }],
      room: { id: 'room-1', name: '原生开发', messages: [{ id: 'm1', content: '云端消息' }] },
    },
    kanban: { tasks: [{ id: 'task-1', title: '接入后端', status: 'doing' }] },
    profiles: { active: { active: 'default', current: 'default' }, profiles: [{ name: 'default', model: 'model-a', description: '主 Agent' }] },
    config: { config: { model: { default: 'model-a' }, agent: { max_turns: 42 }, timezone: 'Asia/Shanghai' }, schema: {} },
    env: { OPENROUTER_API_KEY: { is_set: true, redacted_value: 'sk-••••alue' } },
    system: { status: { gateway_running: true, active_sessions: 2 }, stats: { cpu_percent: 18, memory: { percent: 53, used: 3_400_000_000 }, disk: { percent: 31 }, uptime_seconds: 1_213_200 } },
  };
  const api = {
    loadRoute: async (route: string) => responses[route],
  } as unknown as HermesCloudApi;

  const cron = await loadHermesSwiftUIRouteSnapshot(api, 'cron', 'default');
  const skills = await loadHermesSwiftUIRouteSnapshot(api, 'skills', 'default');
  const plugins = await loadHermesSwiftUIRouteSnapshot(api, 'plugins', 'default');
  const mcp = await loadHermesSwiftUIRouteSnapshot(api, 'mcp', 'default');
  const webhooks = await loadHermesSwiftUIRouteSnapshot(api, 'webhooks', 'default');
  const pairing = await loadHermesSwiftUIRouteSnapshot(api, 'pairing', 'default');
  const achievements = await loadHermesSwiftUIRouteSnapshot(api, 'achievements', 'default');
  const collaboration = await loadHermesSwiftUIRouteSnapshot(api, 'collaboration', 'default');
  const kanban = await loadHermesSwiftUIRouteSnapshot(api, 'kanban', 'default');
  const profiles = await loadHermesSwiftUIRouteSnapshot(api, 'profiles', 'default');
  const config = await loadHermesSwiftUIRouteSnapshot(api, 'config', 'default');
  const environment = await loadHermesSwiftUIRouteSnapshot(api, 'env', 'default');
  const system = await loadHermesSwiftUIRouteSnapshot(api, 'system', 'default');

  assert.equal(cron.cron?.[0].name, '每日总结');
  assert.equal(skills.skills?.[0].detail, '浏览网页');
  assert.equal(plugins.integrations?.[0].detail, '多 Agent 协作');
  assert.equal(mcp.integrations?.[0].name, '文件系统');
  assert.equal(mcp.integrations?.[0].detail, 'npx server-filesystem');
  assert.equal(webhooks.integrations?.[0].name, 'deploy');
  assert.equal(pairing.pairing?.pending[0].platform, 'telegram');
  assert.equal(pairing.pairing?.pending[0].detail, 'Alice · 3 分钟前');
  assert.equal(pairing.pairing?.approved[0].userId, '84');
  assert.equal(achievements.achievements?.items[0].title, '首次任务');
  assert.equal(collaboration.collaboration?.messages[0].text, '云端消息');
  assert.equal(kanban.kanban?.[0].cards[0].title, '接入后端');
  assert.equal(profiles.profiles?.[0].active, true);
  assert.equal(config.config?.maxIterations, 42);
  assert.equal(environment.environment?.[0].key, 'OPENROUTER_API_KEY');
  assert.equal(environment.environment?.[0].maskedValue, 'sk-••••alue');
  assert.equal(system.system?.gatewayOnline, true);
  assert.equal(system.system?.activeTasks, '2');
  assert.equal(system.system?.memory, 53);
  assert.equal(system.system?.disk, 31);
  assert.equal(system.system?.uptimeLabel, '14天 1小时');
});

test('native management actions write through the canonical cloud APIs', async () => {
  const calls: unknown[][] = [];
  const api = {
    setCronJobPaused: async (...args: unknown[]) => { calls.push(['cron-toggle', ...args]); },
    toggleSkill: async (...args: unknown[]) => { calls.push(['skill-toggle', ...args]); },
    setPluginEnabled: async (...args: unknown[]) => { calls.push(['plugin-toggle', ...args]); },
    setActiveProfile: async (...args: unknown[]) => { calls.push(['profile-active', ...args]); },
    setEnvironmentVariable: async (...args: unknown[]) => { calls.push(['env-upsert', ...args]); },
    restartGateway: async (...args: unknown[]) => { calls.push(['restart', ...args]); },
  } as unknown as HermesCloudApi;

  await performHermesSwiftUIRouteAction(api, { action: 'cron.toggle', payload: { route: 'cron', id: 'cron-1', enabled: false } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'skill.toggle', payload: { route: 'skills', id: 'browser', enabled: true } }, 'reviewer');
  await performHermesSwiftUIRouteAction(api, { action: 'integration.toggle', payload: { route: 'plugins', id: 'kanban', enabled: false } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'profile.activate', payload: { route: 'profiles', id: 'worker' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'environment.upsert', payload: { route: 'env', id: 'API_KEY', value: 'secret' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'system.restart', payload: { route: 'system' } }, 'default');

  assert.deepEqual(calls, [
    ['cron-toggle', 'cron-1', true, 'default'],
    ['skill-toggle', 'browser', true, 'reviewer'],
    ['plugin-toggle', 'kanban', false],
    ['profile-active', 'worker'],
    ['env-upsert', 'API_KEY', 'secret'],
    ['restart'],
  ]);
});

test('native file imports upload every selected system URI to the server workspace', async () => {
  const uploads: unknown[][] = [];
  const api = {
    uploadManagedFile: async (...args: unknown[]) => { uploads.push(args); },
  } as unknown as HermesCloudApi;

  const result = await performHermesSwiftUIRouteAction(api, {
    action: 'file.import',
    payload: {
      route: 'files',
      uris: [
        'file:///private/var/mobile/Report%20Final.pdf',
        'file:///private/var/mobile/photo.jpg',
      ],
    },
  }, 'default');

  assert.equal(result, 'reload');
  assert.deepEqual(uploads, [
    ['', { name: 'Report Final.pdf', uri: 'file:///private/var/mobile/Report%20Final.pdf' }],
    ['', { name: 'photo.jpg', uri: 'file:///private/var/mobile/photo.jpg' }],
  ]);
});

test('native collaboration sends messages through the modified Hermes room API', async () => {
  const calls: unknown[][] = [];
  const api = {
    sendCollaborationRoomMessage: async (...args: unknown[]) => { calls.push(args); },
  } as unknown as HermesCloudApi;

  const result = await performHermesSwiftUIRouteAction(api, {
    action: 'collaboration.send',
    payload: { route: 'collaboration', id: 'room-1', value: '请并行审查并汇报' },
  }, 'default');

  assert.equal(result, 'reload');
  assert.deepEqual(calls, [['room-1', '请并行审查并汇报']]);
});

test('native configuration editor submits the complete server document', async () => {
  const calls: unknown[][] = [];
  const api = {
    saveConfig: async (...args: unknown[]) => { calls.push(args); },
  } as unknown as HermesCloudApi;

  const result = await performHermesSwiftUIRouteAction(api, {
    action: 'config.update',
    payload: {
      route: 'config',
      value: JSON.stringify({
        model: { default: 'model-a', provider: 'openrouter' },
        agent: { max_turns: 42 },
      }),
    },
  }, 'reviewer');

  assert.equal(result, 'reload');
  assert.deepEqual(calls, [[{
    model: { default: 'model-a', provider: 'openrouter' },
    agent: { max_turns: 42 },
  }, 'reviewer']]);
});
