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
          profile: 'reviewer',
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
  assert.equal(snapshot.sessions?.[0].profile, 'reviewer');
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
      custom: {
        apiKeyConfigured: true,
        apiKeyPreview: 'sk-••••',
        apiMode: 'chat_completions',
        baseUrl: 'https://model.example/v1',
        contextLength: 200000,
        model: 'model-a',
        reasoningEffort: 'high',
      },
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
  assert.equal(models.models?.length, 3);
  assert.equal(models.models?.find((model) => model.active)?.provider, 'provider-a');
  assert.deepEqual(models.models?.[0], {
    active: true,
    apiKeyConfigured: false,
    apiKeyPreview: '',
    apiMode: 'chat_completions',
    baseUrl: '',
    context: '20万 context',
    contextLength: 200000,
    id: encodeModelSelection('provider-a', 'model-a'),
    model: 'model-a',
    provider: 'provider-a',
    reasoningEffort: 'none',
    authenticated: true,
    selectable: true,
    warning: '',
    priceInput: '',
    priceOutput: '',
    priceCache: '',
    free: false,
    freeTier: false,
    supportsFast: false,
    supportsReasoning: false,
  });
  assert.deepEqual(
    models.models?.slice(0, 2).map((model) => [model.provider, model.model]),
    [['provider-a', 'model-a'], ['provider-a', 'model-b']],
  );
  const custom = models.models?.find((model) => model.provider === 'custom');
  assert.equal(custom?.active, false);
  assert.equal(custom?.baseUrl, 'https://model.example/v1');
  assert.equal(custom?.apiKeyConfigured, true);
  assert.equal(custom?.reasoningEffort, 'high');
  assert.deepEqual(
    decodeModelSelection(models.models?.[0].id ?? ''),
    { model: 'model-a', provider: 'provider-a' },
  );
  assert.equal(decodeModelSelection('provider/model'), null);
});

test('native route actions mutate the server and request a fresh snapshot', async () => {
  const calls: unknown[][] = [];
  const api = {
    deleteConversation: async (...args: unknown[]) => { calls.push(['delete', ...args]); },
    discoverCustomModels: async (...args: unknown[]) => {
      calls.push(['model-discover', ...args]);
      return {
        baseUrl: 'https://model.example/v1',
        latency_ms: 84,
        message: 'Model catalog loaded.',
        models: ['model-a', 'model-b'],
        ok: true,
        reachable: true,
        status: 200,
      };
    },
    saveCustomModel: async (...args: unknown[]) => { calls.push(['model-save', ...args]); },
    setModel: async (...args: unknown[]) => { calls.push(['model', ...args]); },
    testCustomModel: async (...args: unknown[]) => {
      calls.push(['model-test', ...args]);
      return { latency_ms: 84, message: '连接成功', ok: true, reachable: true, status: 200 };
    },
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
  const fields = {
    apiKey: 'secret',
    apiMode: 'chat_completions',
    baseUrl: 'https://model.example/v1',
    contextLength: '131072',
    model: 'model-a',
    reasoningEffort: 'high',
  };
  const saved = await performHermesSwiftUIRouteAction(api, {
    action: 'model.save',
    payload: { fields, route: 'models' },
  }, 'reviewer');
  const tested = await performHermesSwiftUIRouteAction(api, {
    action: 'model.test',
    payload: { fields, route: 'models' },
  }, 'reviewer');
  const discovered = await performHermesSwiftUIRouteAction(api, {
    action: 'model.discover',
    payload: { fields, route: 'models' },
  }, 'reviewer');

  assert.equal(deleted, 'reload');
  assert.equal(selected, 'reload');
  assert.deepEqual(saved, { message: '模型配置已保存', reload: true });
  assert.deepEqual(tested, { message: '连接成功（HTTP 200，84 ms）' });
  assert.deepEqual(discovered, {
    detectedModels: ['model-a', 'model-b'],
    message: '检测到 2 个可用模型（84 ms）',
  });
  const custom = {
    apiKey: 'secret',
    apiMode: 'chat_completions',
    baseUrl: 'https://model.example/v1',
    contextLength: 131072,
    model: 'model-a',
    reasoningEffort: 'high',
  };
  assert.deepEqual(calls, [
    ['delete', 'session-1'],
    ['model', 'provider-a', 'model-a', 'reviewer', false],
    ['model-save', custom, 'reviewer'],
    ['model-test', custom, 'reviewer'],
    ['model-discover', 'https://model.example/v1', 'secret', 'reviewer'],
  ]);
});

test('all native management routes render the current cloud workspace response', async () => {
  const responses: Record<string, unknown> = {
    cron: [{ id: 'cron-1', name: '每日总结', schedule: '0 9 * * *', prompt: '总结会话', enabled: true }],
    skills: { skills: [{ name: 'browser', description: '浏览网页', bundled: true, enabled: true }] },
    plugins: { manifests: [{ name: 'collaboration', description: '多 Agent 协作', enabled: true }] },
    mcp: { servers: { servers: [{ name: 'filesystem', command: 'npx', args: ['server-filesystem'], enabled: true }] }, catalog: { entries: [] } },
    channels: { platforms: [{ id: 'telegram', name: 'Telegram', description: 'Telegram messaging', enabled: true, env_vars: [{ key: 'TELEGRAM_BOT_TOKEN', is_set: true, redacted_value: '123•••456' }] }] },
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
    env: {
      credentials: [{
        id: 'custom-main',
        provider: 'custom',
        model: 'model-a',
        masked_value: 'sk-••••alue',
      }],
    },
    system: { status: { gateway_running: true, active_sessions: 2 }, stats: { cpu_percent: 18, memory: { percent: 53, used: 3_400_000_000 }, disk: { percent: 31 }, uptime_seconds: 1_213_200 } },
  };
  const api = {
    loadRoute: async (route: string) => responses[route],
  } as unknown as HermesCloudApi;

  const cron = await loadHermesSwiftUIRouteSnapshot(api, 'cron', 'default');
  const skills = await loadHermesSwiftUIRouteSnapshot(api, 'skills', 'default');
  const plugins = await loadHermesSwiftUIRouteSnapshot(api, 'plugins', 'default');
  const mcp = await loadHermesSwiftUIRouteSnapshot(api, 'mcp', 'default');
  const channels = await loadHermesSwiftUIRouteSnapshot(api, 'channels', 'default');
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
  assert.equal(channels.integrations?.[0].name, 'Telegram 消息渠道');
  assert.equal(channels.integrations?.[0].detail, '通过 Telegram 消息渠道收发 Hermes 消息。');
  assert.deepEqual(JSON.parse(channels.integrations?.[0].configuration ?? ''), {
    enabled: true,
    env: { TELEGRAM_BOT_TOKEN: '' },
    clear_env: [],
  });
  assert.equal(webhooks.integrations?.[0].name, 'deploy');
  assert.equal(pairing.pairing?.pending[0].platform, 'telegram');
  assert.equal(pairing.pairing?.pending[0].detail, 'Alice · 3 分钟前');
  assert.equal(pairing.pairing?.approved[0].userId, '84');
  assert.equal(achievements.achievements?.items[0].title, '首次任务');
  assert.equal(collaboration.collaboration?.messages[0].text, '云端消息');
  assert.equal(kanban.kanban?.[0].cards[0].title, '接入后端');
  assert.equal(profiles.profiles?.[0].active, true);
  assert.equal(config.config?.maxIterations, 42);
  assert.equal(environment.environment?.[0].key, 'custom · model-a');
  assert.equal(environment.environment?.[0].maskedValue, 'sk-••••alue');
  const legacyEnvironment = await loadHermesSwiftUIRouteSnapshot({
    loadRoute: async () => ({
      OPENAI_API_KEY: { is_set: true, redacted_value: 'sk-legacy' },
    }),
  } as unknown as HermesCloudApi, 'env', 'default');
  assert.deepEqual(legacyEnvironment.environment, []);
  assert.equal(system.system?.gatewayOnline, true);
  assert.equal(system.system?.activeTasks, '2');
  assert.equal(system.system?.memory, 53);
  assert.equal(system.system?.disk, 31);
  assert.equal(system.system?.uptimeLabel, '14天 1小时');
});

test('system snapshots expose real DBB3 and WSL gateway metrics and versions', async () => {
  const freshObservedAt = new Date(Date.now() - 1_000).toISOString();
  const api = {
    loadRoute: async () => ({
      managedNodes: {
        nodes: [
          {
            id: 'dbb3',
            label: 'DBB3',
            online: true,
            gateway_state: 'active',
            version: 'v0.18.2 (2026.7.7.2)',
            active_tasks: 2,
            observed_at: freshObservedAt,
            metrics_available: true,
            recovery_state: 'idle',
            metrics_source: 'linux_procfs',
            metrics: {
              cpu_percent: 21,
              memory_percent: 63,
              disk_percent: 35,
              memory_total_bytes: 8_000,
              memory_available_bytes: 3_000,
              uptime_seconds: 3_600,
            },
          },
          {
            id: 'wsl',
            label: 'WSL',
            online: true,
            gateway_state: 'active',
            version: 'v0.18.3 (2026.7.8.1)',
            active_tasks: 0,
            observed_at: freshObservedAt,
            metrics_available: true,
            recovery_state: 'idle',
            metrics_source: 'windows_psutil_push',
            metrics: { cpu_percent: 12, memory_percent: 54, disk_percent: 42 },
          },
        ],
      },
      status: {},
      stats: {},
    }),
  } as unknown as HermesCloudApi;

  const snapshot = await loadHermesSwiftUIRouteSnapshot(api, 'system', 'default');

  assert.equal(snapshot.system?.gatewayOnline, true);
  assert.equal(snapshot.system?.cpu, 21);
  assert.equal(snapshot.system?.nodes.length, 2);
  assert.equal(snapshot.system?.nodes[0].version, 'v0.18.2 (2026.7.7.2)');
  assert.equal(snapshot.system?.nodes[1].version, 'v0.18.3 (2026.7.8.1)');
  assert.equal(snapshot.system?.nodes[1].metricsSource, 'windows_psutil_push');
});

test('system snapshots reject stale device heartbeat flags from the server', async () => {
  const api = {
    loadRoute: async () => ({
      managedNodes: {
        nodes: [{
          id: 'dbb3',
          label: 'DBB3',
          online: true,
          fresh: true,
          gateway_state: 'active',
          observed_at: '2020-01-01T00:00:00Z',
          metrics: {},
        }],
      },
      status: {},
      stats: {},
    }),
  } as unknown as HermesCloudApi;

  const snapshot = await loadHermesSwiftUIRouteSnapshot(api, 'system', 'default');

  assert.equal(snapshot.system?.gatewayOnline, false);
  assert.equal(snapshot.system?.nodes[0].gatewayOnline, false);
});

test('configured managed nodes fail closed when the live node list is empty', async () => {
  const api = {
    loadRoute: async () => ({
      managedNodes: { configured: true, nodes: [], sources: [] },
      status: { online: true, gateway_running: true },
      stats: {},
    }),
  } as unknown as HermesCloudApi;

  const snapshot = await loadHermesSwiftUIRouteSnapshot(api, 'system', 'default');

  assert.equal(snapshot.system?.gatewayOnline, false);
  assert.deepEqual(snapshot.system?.nodes, []);
});

test('native management actions write through the canonical cloud APIs', async () => {
  const calls: unknown[][] = [];
  const api = {
    createKanbanTask: async (...args: unknown[]) => {
      calls.push(['kanban-create', ...args]);
      return { task: { id: 'task-new' } };
    },
    rescanAchievements: async (...args: unknown[]) => { calls.push(['achievement-rescan', ...args]); },
    setCronJobPaused: async (...args: unknown[]) => { calls.push(['cron-toggle', ...args]); },
    toggleSkill: async (...args: unknown[]) => { calls.push(['skill-toggle', ...args]); },
    updateChannel: async (...args: unknown[]) => { calls.push(['channel-update', ...args]); },
    setPluginEnabled: async (...args: unknown[]) => { calls.push(['plugin-toggle', ...args]); },
    setActiveProfile: async (...args: unknown[]) => { calls.push(['profile-active', ...args]); },
    deleteModelCredential: async (...args: unknown[]) => { calls.push(['model-credential-delete', ...args]); },
    updateKanbanTask: async (...args: unknown[]) => { calls.push(['kanban-update', ...args]); },
    updateSkillContent: async (...args: unknown[]) => { calls.push(['skill-update', ...args]); },
    restartGateway: async (...args: unknown[]) => { calls.push(['restart', ...args]); },
    recoverManagedNodes: async (...args: unknown[]) => { calls.push(['recover', ...args]); },
  } as unknown as HermesCloudApi;

  await performHermesSwiftUIRouteAction(api, { action: 'cron.toggle', payload: { route: 'cron', id: 'cron-1', enabled: false } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'skill.toggle', payload: { route: 'skills', id: 'browser', enabled: true } }, 'reviewer');
  await performHermesSwiftUIRouteAction(api, { action: 'integration.toggle', payload: { route: 'plugins', id: 'kanban', enabled: false } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'profile.activate', payload: { route: 'profiles', id: 'worker' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'environment.delete', payload: { route: 'env', id: 'custom-main' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'system.restart', payload: { route: 'system' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'system.recover', payload: { route: 'system', id: 'wsl' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'skill.update', payload: { route: 'skills', id: 'browser', detail: '# Browser' } }, 'reviewer');
  await performHermesSwiftUIRouteAction(api, { action: 'achievements.rescan', payload: { route: 'achievements' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'kanban.create', payload: { route: 'kanban', name: '云端任务', detail: '检查同步', targetId: 'ready' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'kanban.update', payload: { route: 'kanban', id: 'task-1', name: '新标题', detail: '新内容', targetId: 'doing' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'integration.update', payload: { route: 'channels', id: 'telegram', value: '{"enabled":true,"mode":"polling"}' } }, 'default');

  assert.deepEqual(calls, [
    ['cron-toggle', 'cron-1', true, 'default'],
    ['skill-toggle', 'browser', true, 'reviewer'],
    ['plugin-toggle', 'kanban', false],
    ['profile-active', 'worker'],
    ['model-credential-delete', 'custom-main', 'default'],
    ['restart'],
    ['recover', 'wsl'],
    ['skill-update', 'browser', '# Browser', 'reviewer'],
    ['achievement-rescan'],
    ['kanban-create', { title: '云端任务', body: '检查同步' }],
    ['kanban-update', 'task-new', { status: 'ready' }],
    ['kanban-update', 'task-1', { title: '新标题', body: '新内容', status: 'doing' }],
    ['channel-update', 'telegram', { enabled: true, mode: 'polling' }, 'default'],
  ]);
});

test('custom model discovery returns bounded picker data without persisting configuration', async () => {
  const calls: unknown[][] = [];
  const api = {
    discoverCustomModels: async (...args: unknown[]) => {
      calls.push(args);
      return {
        baseUrl: 'https://models.example/v1',
        latency_ms: 84,
        message: 'Model catalog loaded.',
        models: ['model-a', 'model-b'],
        ok: true,
        reachable: true,
        status: 200,
      };
    },
  } as unknown as HermesCloudApi;

  const result = await performHermesSwiftUIRouteAction(api, {
    action: 'model.discover',
    payload: {
      route: 'models',
      fields: {
        apiKey: 'temporary-key',
        baseUrl: 'https://models.example/v1',
      },
    },
  }, 'default');

  assert.deepEqual(calls, [['https://models.example/v1', 'temporary-key', 'default']]);
  assert.deepEqual(result, {
    detectedModels: ['model-a', 'model-b'],
    message: '检测到 2 个可用模型（84 ms）',
  });
});

test('selected skills include the current server SKILL.md for native editing', async () => {
  const api = {
    loadRoute: async (_route: string, _profile: string, selectedId: string) => ({
      selectedId,
      selectedContent: { content: '# Browser\n\nUse browser tools.' },
      skills: [{ name: 'browser', description: 'Browser tools', enabled: true }],
    }),
  } as unknown as HermesCloudApi;

  const snapshot = await loadHermesSwiftUIRouteSnapshot(api, 'skills', 'reviewer', 'browser');

  assert.equal(snapshot.skills?.[0].content, '# Browser\n\nUse browser tools.');
});

test('native file imports upload every selected system URI to the account cloud library', async () => {
  const uploads: unknown[][] = [];
  const api = {
    uploadAccountFile: async (...args: unknown[]) => { uploads.push(args); },
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
  assert.deepEqual(uploads.map(([upload]) => upload), [
    { name: 'Report Final.pdf', uri: 'file:///private/var/mobile/Report%20Final.pdf' },
    { name: 'photo.jpg', uri: 'file:///private/var/mobile/photo.jpg' },
  ]);
  assert.equal(new Set(uploads.map(([, uploadId]) => uploadId)).size, 2);
  for (const [, uploadId] of uploads) assert.match(String(uploadId), /^file-import-/);
});

test('file snapshots expose durable account metadata for native filtering and grouping', async () => {
  const api = {
    loadRoute: async () => ({
      files: [{
        id: 'file-1',
        name: 'report.pdf',
        sha256: 'abc',
        mime_type: 'application/pdf',
        extension: '.pdf',
        file_type: 'document',
        size: 2048,
        source: 'model_output',
        status: 'available',
        created_at: 1_752_643_200_000,
        updated_at: 1_752_643_200_000,
        download_url: '/api/plugins/collaboration/files/file-1/download',
      }],
    }),
  } as unknown as HermesCloudApi;

  const snapshot = await loadHermesSwiftUIRouteSnapshot(api, 'files', 'default');

  assert.equal(snapshot.files?.[0].id, 'file-1');
  assert.equal(snapshot.files?.[0].source, 'model_output');
  assert.equal(snapshot.files?.[0].fileType, 'document');
  assert.equal(snapshot.files?.[0].createdAt, 1_752_643_200_000);
  assert.match(snapshot.files?.[0].detail || '', /模型生成/);
});

test('native collaboration sends messages through the modified Hermes room API', async () => {
  const calls: unknown[][] = [];
  const api = {
    sendCollaborationRoomMessage: async (...args: unknown[]) => { calls.push(args); },
  } as unknown as HermesCloudApi;

  const result = await performHermesSwiftUIRouteAction(api, {
    action: 'collaboration.send',
    payload: {
      route: 'collaboration',
      id: 'room-1',
      requestId: 'room-request-stable-1',
      value: '请并行审查并汇报',
    },
  }, 'default');

  assert.equal(result, 'reload');
  assert.deepEqual(calls, [[
    'room-1',
    '请并行审查并汇报',
    [],
    'room-request-stable-1',
  ]]);
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
