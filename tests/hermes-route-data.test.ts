import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesCloudApi } from '../src/api/HermesCloudApi';
import { loadCloudRoute } from '../src/api/cloud/routes';
import {
  decodeModelSelection,
  encodeModelSelection,
  createHermesSwiftUISessionsSnapshotFromConversations,
  loadHermesSwiftUIRouteSnapshot,
  performHermesSwiftUIRouteAction,
} from '../src/app/hermes-route-data';

test('cached session projection filters local tombstones and Studio room transcripts', () => {
  const conversation = (id: string, source?: 'collaboration_room') => ({
    id,
    messages: [{ id: `${id}-message`, role: 'assistant' as const, name: 'Hermes', content: id }],
    message_count: 1,
    profile: 'default',
    source,
    title: id,
    updated_at: 100,
  });
  const snapshot = createHermesSwiftUISessionsSnapshotFromConversations([
    conversation('ordinary'),
    conversation('pending-delete'),
    conversation('studio-source', 'collaboration_room'),
    conversation('chat_room_legacy'),
  ], new Set(['pending-delete']), 'en');

  assert.deepEqual(snapshot.sessions?.map(({ id }) => id), ['ordinary']);
  assert.equal(snapshot.sessions?.[0]?.title, 'ordinary');
  assert.equal(snapshot.sessions?.[0]?.detail, '1 messages · 0 tool calls');
});

test('session snapshots expose the real branch boundaries to native SwiftUI', () => {
  const snapshot = createHermesSwiftUISessionsSnapshotFromConversations(
    [],
    new Set(),
    'en',
    {
      branchable_messages: [{
        message_id: 'message-7',
        role: 'user',
        runtime_message_id: 17,
        runtime_session_id: 'runtime-1',
      }],
      context: {
        active_messages: 3,
        archived_messages: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        compression_count: 0,
        compression_in_progress: false,
        compression_lineage: [],
        input_tokens: 100,
        message_tokens: 120,
        output_tokens: 20,
        profile: 'default',
        reasoning_tokens: 0,
        session_id: 'runtime-1',
      },
      conversation_id: 'conversation-1',
      lineage: {
        current_session_id: 'runtime-1',
        edges: [],
        roots: ['runtime-1'],
        sessions: [{ id: 'runtime-1', message_count: 3, tool_call_count: 0 }],
      },
      profile: 'default',
      session_id: 'runtime-1',
    },
  );

  assert.deepEqual(snapshot.sessionContext?.branchableMessages, [{
    messageId: 'message-7',
    role: 'user',
    runtimeMessageId: 17,
    runtimeSessionId: 'runtime-1',
  }]);
});

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

test('official session sidebars/projects/PRs/stats are bridged and bulk actions call upstream APIs', async () => {
  const calls: unknown[] = [];
  const api = {
    loadRoute: async () => ({ sessions: [{ id: 's1', title: 'one', model: 'm', is_active: false, message_count: 1, tool_call_count: 0, last_active: 1 }] }),
    getProfileSessionsSidebar: async (options: unknown) => { calls.push(['sidebar', options]); return { recent: ['s1'] }; },
    getProfileProjectsTree: async () => { calls.push('projects'); return { projects: [] }; },
    scanProfileSessionPullRequests: async (ids: unknown) => { calls.push(['prs', ids]); return { s1: [] }; },
    getSessionStats: async (profile: unknown) => { calls.push(['stats', profile]); return { total: 1 }; },
    bulkDeleteSessions: async (ids: unknown, profile: unknown) => { calls.push(['bulk', ids, profile]); return {}; },
    importSessions: async (sessions: unknown, profile: unknown) => { calls.push(['import', sessions, profile]); return {}; },
  } as unknown as HermesCloudApi;
  const snapshot = await loadHermesSwiftUIRouteSnapshot(api, 'sessions', 'hk-worker');
  assert.match(snapshot.sessionSidebarJSON || '', /s1/);
  assert.match(snapshot.sessionProjectsJSON || '', /projects/);
  assert.match(snapshot.sessionPullRequestsJSON || '', /s1/);
  assert.match(snapshot.sessionStatsJSON || '', /total/);
  await performHermesSwiftUIRouteAction(api, { action: 'session.bulk-delete', payload: { route: 'sessions', detail: '["s1"]', fields: { profile: 'hk-worker' } } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'session.import', payload: { route: 'sessions', detail: '[{"id":"s2"}]' } }, 'default');
  assert.deepEqual(calls.slice(-2), [['bulk', ['s1'], 'hk-worker'], ['import', [{ id: 's2' }], 'default']]);
});

test('system backup import and hook actions use official operations endpoints', async () => {
  const calls: unknown[] = [];
  const api = {
    uploadImport: async (upload: unknown, force: unknown) => { calls.push(['import', upload, force]); return {}; },
    createHook: async (payload: unknown) => { calls.push(['create', payload]); return {}; },
    deleteHook: async (payload: unknown) => { calls.push(['delete', payload]); return {}; },
  } as unknown as HermesCloudApi;
  await performHermesSwiftUIRouteAction(api, { action: 'system.backup.import', payload: { route: 'system', name: 'b.zip', uris: ['file:///tmp/b.zip'], fields: { force: 'true' } } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'system.hook.create', payload: { route: 'system', detail: '{"name":"h"}' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'system.hook.delete', payload: { route: 'system', fields: { event: 'on_session_end', command: 'echo hi' } } }, 'default');
  assert.deepEqual(calls, [
    ['import', { uri: 'file:///tmp/b.zip', name: 'b.zip', mimeType: 'application/zip' }, true],
    ['create', { name: 'h' }],
    ['delete', { event: 'on_session_end', command: 'echo hi' }],
  ]);
});

test('managed workspace files are hydrated and mutate through official file endpoints', async () => {
  const calls: unknown[] = [];
  const api = {
    loadRoute: async () => ({ files: [] }),
    listFiles: async (path = '') => {
      calls.push(['list', path]);
      return {
        root: '/srv/hermes',
        path: path || '/srv/hermes',
        parent: null,
        locked_root: '/srv/hermes',
        can_change_path: true,
        entries: [{ name: 'results', path: '/srv/hermes/results', is_directory: true, size: null, mtime: 1, mime_type: null }],
      };
    },
    deleteFile: async (...args: unknown[]) => { calls.push(['delete', ...args]); return { ok: true }; },
    uploadManagedFile: async (...args: unknown[]) => { calls.push(['upload', ...args]); return {}; },
  } as unknown as HermesCloudApi;
  const snapshot = await loadHermesSwiftUIRouteSnapshot(api, 'files', 'default');
  assert.match(snapshot.managedFilesJSON || '', /results/);
  await performHermesSwiftUIRouteAction(api, {
    action: 'files.managed.open',
    payload: { route: 'files', value: '/srv/hermes/results' },
  }, 'default');
  await performHermesSwiftUIRouteAction(api, {
    action: 'files.managed.delete',
    payload: { route: 'files', id: '/srv/hermes/results/out.txt', value: '/srv/hermes/results/out.txt' },
  }, 'default');
  await performHermesSwiftUIRouteAction(api, {
    action: 'files.managed.import',
    payload: { route: 'files', value: '/srv/hermes/results', uris: ['file:///tmp/report.txt'] },
  }, 'default');
  assert.deepEqual(calls.slice(-3), [
    ['list', '/srv/hermes/results'],
    ['delete', '/srv/hermes/results/out.txt', false],
    ['upload', '/srv/hermes/results/report.txt', { name: 'report.txt', uri: 'file:///tmp/report.txt' }, true],
  ]);
});

test('Git route exposes every official review read surface and selected diffs', async () => {
  const calls: unknown[] = [];
  const api = {
    getDefaultCwd: async () => ({ cwd: '/srv/hermes' }),
    getGitRoot: async (path: string) => { calls.push(['root', path]); return { root: '/srv/hermes/repo' }; },
    getGitStatus: async (path: string) => { calls.push(['status', path]); return { branch: 'main', files: [] }; },
    getGitBranches: async () => ({ branches: ['main', 'feature'] }),
    getGitBaseBranches: async () => ({ branches: ['main'] }),
    getGitWorktrees: async () => ({ worktrees: [] }),
    getGitReviewList: async () => ({ files: [{ path: 'README.md', status: 'M' }] }),
    getGitShipInfo: async () => ({ ready: false }),
    getGitGhAuth: async () => ({ authenticated: true, login: 'hermes' }),
    getGitCommitContext: async () => ({ staged: 1 }),
    getGitRevParse: async () => ({ sha: 'abc123' }),
    listGitPullRequests: async () => ({ pull_requests: [{ number: 7 }] }),
    getGitReviewDiff: async (path: string, file: string) => { calls.push(['review-diff', path, file]); return { patch: '@@' }; },
    getGitFileDiff: async (path: string, file: string) => { calls.push(['file-diff', path, file]); return { patch: 'diff' }; },
  } as unknown as HermesCloudApi;
  const result = await loadCloudRoute(api, 'git', 'default', 'README.md') as Record<string, unknown>;
  assert.equal(result.root, '/srv/hermes/repo');
  assert.equal(result.branch, 'main');
  assert.deepEqual(result.ghAuth, { authenticated: true, login: 'hermes' });
  assert.deepEqual(result.pullRequests, { pull_requests: [{ number: 7 }] });
  assert.deepEqual(calls, [
    ['root', '/srv/hermes'],
    ['status', '/srv/hermes/repo'],
    ['review-diff', '/srv/hermes/repo', 'README.md'],
    ['file-diff', '/srv/hermes/repo', 'README.md'],
  ]);
});

test('Git native actions call confirmed upstream operations with the resolved repository path', async () => {
  const calls: unknown[] = [];
  const api = {
    getDefaultCwd: async () => ({ cwd: '/srv/hermes' }),
    getGitRoot: async () => ({ root: '/srv/hermes/repo' }),
    stageGitFile: async (...args: unknown[]) => { calls.push(['stage', ...args]); return {}; },
    commitGit: async (...args: unknown[]) => { calls.push(['commit', ...args]); return {}; },
    createGitPullRequest: async (...args: unknown[]) => { calls.push(['pr', ...args]); return { url: 'https://example/pr/1' }; },
    addGitWorktree: async (...args: unknown[]) => { calls.push(['worktree-add', ...args]); return {}; },
  } as unknown as HermesCloudApi;
  await performHermesSwiftUIRouteAction(api, { action: 'git.stage', payload: { route: 'git', id: 'README.md' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'git.commit', payload: { route: 'git', detail: 'test commit' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'git.create-pr', payload: { route: 'git' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'git.worktree.add', payload: { route: 'git', detail: '{"branch":"feature"}' } }, 'default');
  assert.deepEqual(calls, [
    ['stage', '/srv/hermes/repo', 'README.md'],
    ['commit', '/srv/hermes/repo', 'test commit', false],
    ['pr', '/srv/hermes/repo'],
    ['worktree-add', '/srv/hermes/repo', { branch: 'feature' }],
  ]);
});

test('native skills and cron snapshots hydrate official desktop metadata', async () => {
  const api = {
    loadRoute: async (route: string) => route === 'skills'
      ? { skills: [], toolsets: [{ name: 'web', description: 'Search', enabled: true, configured: true, tools: ['web.search'] }] }
      : { jobs: [] },
    getToolsetConfig: async () => ({ providers: [{ name: 'ddgs', env_vars: [] }] }),
    getToolsetModels: async () => ({ has_models: false }),
    getToolsetProviders: async () => ({ providers: ['ddgs'] }),
    getTerminalBackends: async () => ({ backends: [{ id: 'local' }] }),
    getComputerUseStatus: async () => ({ granted: false }),
    getSkillHubSources: async () => ({ sources: [{ id: 'official' }] }),
    getLearningGraph: async () => ({ nodes: [{ id: 'n1' }] }),
    getCronBlueprints: async () => ({ blueprints: [{ key: 'daily_digest' }] }),
    getDeliveryTargets: async () => ({ targets: [{ id: 'ios' }] }),
  } as unknown as HermesCloudApi;

  const skills = await loadHermesSwiftUIRouteSnapshot(api, 'skills', 'default');
  assert.match(skills.toolsets?.[0]?.configJSON || '', /ddgs/);
  assert.match(skills.terminalBackendsJSON || '', /local/);
  assert.match(skills.computerUseJSON || '', /granted/);
  assert.match(skills.skillHubSourcesJSON || '', /official/);
  assert.match(skills.learningGraphJSON || '', /n1/);

  const cron = await loadHermesSwiftUIRouteSnapshot(api, 'cron', 'default');
  assert.match(cron.cronBlueprintsJSON || '', /daily_digest/);
  assert.match(cron.cronDeliveryTargetsJSON || '', /ios/);
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
    forkConversationFromMessage: async (...args: unknown[]) => {
      calls.push(['fork', ...args]);
      return { conversation: {}, created: true, replayed: false, session: {} };
    },
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
  const forked = await performHermesSwiftUIRouteAction(api, {
    action: 'session.fork',
    payload: {
      detail: 'message-7',
      fields: { profile: 'reviewer' },
      id: 'conversation-1',
      requestId: 'ios-fork-request',
      route: 'sessions',
      value: 'Branch title',
    },
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
  assert.equal(forked, 'reload');
  assert.equal(selected, 'reload');
  assert.deepEqual(saved, { message: '模型配置已保存', reload: true });
  assert.deepEqual(tested, { message: '连接成功（HTTP 200，84 ms）' });
  assert.deepEqual(discovered, {
    detectedModels: ['model-a', 'model-b'],
    message: '检测到 2 个可用模型（84 ms）',
  });
  const custom = {
    apiKey: 'secret',
    apiKeyAction: 'replace',
    apiMode: 'chat_completions',
    baseUrl: 'https://model.example/v1',
    contextLength: 131072,
    model: 'model-a',
    reasoningEffort: 'high',
  };
  assert.deepEqual(calls, [
    ['delete', 'session-1'],
    ['fork', 'conversation-1', 'message-7', {
      idempotencyKey: 'ios-fork-request',
      profile: 'reviewer',
      title: 'Branch title',
    }],
    ['model', 'provider-a', 'model-a', 'reviewer', false],
    ['model-save', custom, 'reviewer'],
    ['model-test', custom, 'reviewer'],
    ['model-discover', 'https://model.example/v1', 'secret', 'reviewer'],
  ]);
});

test('native session, SkillHub, and provider controls complete official action flows', async () => {
  const calls: unknown[][] = [];
  const api = {
    setSessionArchived: async (...args: unknown[]) => { calls.push(['archive', ...args]); },
    setSessionPinned: async (...args: unknown[]) => { calls.push(['pin', ...args]); },
    setSessionUnread: async (...args: unknown[]) => { calls.push(['unread', ...args]); },
    searchSkillHub: async (...args: unknown[]) => { calls.push(['search', ...args]); return { results: ['skill'] }; },
    previewSkillHub: async (...args: unknown[]) => { calls.push(['preview', ...args]); return { id: args[0] }; },
    scanSkillHub: async (...args: unknown[]) => { calls.push(['scan', ...args]); return { safe: true }; },
    installSkillHub: async (...args: unknown[]) => { calls.push(['install', ...args]); },
    uninstallSkillHub: async (...args: unknown[]) => { calls.push(['uninstall', ...args]); },
    startProviderOauth: async (...args: unknown[]) => { calls.push(['oauth-start', ...args]); return { authorization_url: 'https://auth.example', session_id: 'oauth-1' }; },
    submitProviderOauth: async (...args: unknown[]) => { calls.push(['oauth-submit', ...args]); },
    validateCustomProviderEndpoint: async (...args: unknown[]) => { calls.push(['endpoint-validate', ...args]); return { ok: true }; },
    saveCustomProviderEndpoint: async (...args: unknown[]) => { calls.push(['endpoint-save', ...args]); },
  } as unknown as HermesCloudApi;
  await performHermesSwiftUIRouteAction(api, { action: 'session.archive', payload: { route: 'sessions', id: 's1', enabled: true, fields: { profile: 'hk-worker' } } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'session.pin', payload: { route: 'sessions', id: 's1', enabled: true } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'session.unread', payload: { route: 'sessions', id: 's1', enabled: false } }, 'default');
  const search = await performHermesSwiftUIRouteAction(api, { action: 'skillhub.search', payload: { route: 'skills', value: 'browser' } }, 'default');
  assert.equal(typeof search, 'object');
  await performHermesSwiftUIRouteAction(api, { action: 'skillhub.preview', payload: { route: 'skills', value: 'owner/skill' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'skillhub.scan', payload: { route: 'skills', value: 'owner/skill' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'skillhub.install', payload: { route: 'skills', value: 'owner/skill' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'skillhub.uninstall', payload: { route: 'skills', value: 'browser' } }, 'default');
  const oauth = await performHermesSwiftUIRouteAction(api, { action: 'provider.oauth.start', payload: { route: 'models', id: 'openai' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'provider.oauth.submit', payload: { route: 'models', id: 'openai', fields: { code: '1234' } } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'provider.custom.validate', payload: { route: 'models', value: '{"id":"edge"}' } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'provider.custom.save', payload: { route: 'models', value: '{"id":"edge"}' } }, 'hk-worker');
  assert.equal((oauth as { oauthSessionId?: string }).oauthSessionId, 'oauth-1');
  assert.deepEqual(calls, [
    ['archive', 's1', true, 'hk-worker'], ['pin', 's1', true, 'default'], ['unread', 's1', false, 'default'],
    ['search', 'browser', 'all', 20, 'default'], ['preview', 'owner/skill', 'default'], ['scan', 'owner/skill', 'default'],
    ['install', 'owner/skill', 'default'], ['uninstall', 'browser', 'default'],
    ['oauth-start', 'openai', {}], ['oauth-submit', 'openai', { code: '1234' }],
    ['endpoint-validate', { id: 'edge' }], ['endpoint-save', { id: 'edge' }, 'hk-worker'],
  ]);
});

test('native plugin actions use the authenticated plugin management endpoints', async () => {
  const calls: unknown[][] = [];
  const api = {
    installPlugin: async (...args: unknown[]) => { calls.push(['install', ...args]); },
    removePlugin: async (...args: unknown[]) => { calls.push(['remove', ...args]); },
    rescanPlugins: async (...args: unknown[]) => { calls.push(['rescan', ...args]); },
    setPluginVisibility: async (...args: unknown[]) => { calls.push(['visibility', ...args]); },
    updatePlugin: async (...args: unknown[]) => { calls.push(['update', ...args]); },
  } as unknown as HermesCloudApi;

  for (const event of [
    { action: 'plugin.rescan', payload: { route: 'plugins' } },
    { action: 'plugin.install', payload: { name: 'owner/repo', route: 'plugins' } },
    { action: 'plugin.update', payload: { id: 'owner/repo', route: 'plugins' } },
    { action: 'plugin.delete', payload: { id: 'owner/repo', route: 'plugins' } },
    { action: 'plugin.visibility', payload: { enabled: true, id: 'owner/repo', route: 'plugins' } },
  ] as const) {
    assert.equal(await performHermesSwiftUIRouteAction(api, event, 'default'), 'reload');
  }

  assert.deepEqual(calls, [
    ['rescan'],
    ['install', 'owner/repo', { enable: true, force: false }],
    ['update', 'owner/repo'],
    ['remove', 'owner/repo'],
    ['visibility', 'owner/repo', false],
  ]);
});

test('native channel onboarding uses the official Telegram and WhatsApp contracts', async () => {
  const calls: unknown[][] = [];
  const api = {
    startTelegramOnboarding: async (...args: unknown[]) => {
      calls.push(['telegram-start', ...args]);
      return { pairing_id: 'tg-1', qr_payload: 'tg-qr', status: 'waiting' };
    },
    getTelegramOnboarding: async (...args: unknown[]) => {
      calls.push(['telegram-status', ...args]);
      return { status: 'ready', bot_username: 'hermes_bot' };
    },
    applyTelegramOnboarding: async (...args: unknown[]) => {
      calls.push(['telegram-apply', ...args]);
      return { restart_started: true, status: 'connected' };
    },
    cancelTelegramOnboarding: async (...args: unknown[]) => { calls.push(['telegram-cancel', ...args]); },
    startWhatsappOnboarding: async (...args: unknown[]) => {
      calls.push(['whatsapp-start', ...args]);
      return { pairing_id: 'wa-1', qr_payload: 'wa-qr', status: 'starting' };
    },
    getWhatsappOnboarding: async (...args: unknown[]) => {
      calls.push(['whatsapp-status', ...args]);
      return { status: 'connected' };
    },
    applyWhatsappOnboarding: async (...args: unknown[]) => {
      calls.push(['whatsapp-apply', ...args]);
      return { restart_started: true };
    },
    cancelWhatsappOnboarding: async (...args: unknown[]) => { calls.push(['whatsapp-cancel', ...args]); },
  } as unknown as HermesCloudApi;

  const telegramStart = await performHermesSwiftUIRouteAction(api, {
    action: 'channel.onboarding.start',
    payload: { route: 'channels', id: 'telegram', value: 'Hermes iOS Bot' },
  }, 'hk-worker');
  const telegramRefresh = await performHermesSwiftUIRouteAction(api, {
    action: 'channel.onboarding.refresh',
    payload: { route: 'channels', id: 'telegram', value: 'tg-1' },
  }, 'hk-worker');
  const telegramApply = await performHermesSwiftUIRouteAction(api, {
    action: 'channel.onboarding.apply',
    payload: { route: 'channels', id: 'telegram', value: 'tg-1', detail: '{"allowed_user_ids":["42","43"]}' },
  }, 'hk-worker');
  await performHermesSwiftUIRouteAction(api, {
    action: 'channel.onboarding.cancel',
    payload: { route: 'channels', id: 'telegram', value: 'tg-1' },
  }, 'hk-worker');
  const whatsappStart = await performHermesSwiftUIRouteAction(api, {
    action: 'channel.onboarding.start',
    payload: { route: 'channels', id: 'whatsapp', fields: { mode: 'self-chat', allowedUsers: '15551234567' } },
  }, 'default');
  const whatsappRefresh = await performHermesSwiftUIRouteAction(api, {
    action: 'channel.onboarding.refresh',
    payload: { route: 'channels', id: 'whatsapp', value: 'wa-1' },
  }, 'default');
  const whatsappApply = await performHermesSwiftUIRouteAction(api, {
    action: 'channel.onboarding.apply',
    payload: { route: 'channels', id: 'whatsapp', value: 'wa-1', detail: '{"mode":"self-chat","allowed_users":"15551234567"}' },
  }, 'default');
  await performHermesSwiftUIRouteAction(api, {
    action: 'channel.onboarding.cancel',
    payload: { route: 'channels', id: 'whatsapp', value: 'wa-1' },
  }, 'default');

  assert.match(String((telegramStart as { channelOnboardingJSON?: string }).channelOnboardingJSON), /tg-1/);
  assert.match(String((telegramRefresh as { channelOnboardingJSON?: string }).channelOnboardingJSON), /hermes_bot/);
  assert.deepEqual(telegramApply, {
    channelOnboardingJSON: '{"channel":"telegram","pairing_id":"tg-1","restart_started":true,"status":"connected"}',
    message: 'Telegram 配置已保存',
    reload: true,
  });
  assert.match(String((whatsappStart as { channelOnboardingJSON?: string }).channelOnboardingJSON), /wa-1/);
  assert.match(String((whatsappRefresh as { channelOnboardingJSON?: string }).channelOnboardingJSON), /connected/);
  assert.equal((whatsappApply as { reload?: boolean }).reload, true);
  assert.deepEqual(calls, [
    ['telegram-start', 'Hermes iOS Bot', 'hk-worker'],
    ['telegram-status', 'tg-1'],
    ['telegram-apply', 'tg-1', ['42', '43'], 'hk-worker'],
    ['telegram-cancel', 'tg-1'],
    ['whatsapp-start', 'self-chat', '15551234567', 'default'],
    ['whatsapp-status', 'wa-1'],
    ['whatsapp-apply', 'wa-1', { mode: 'self-chat', allowed_users: '15551234567' }, 'default'],
    ['whatsapp-cancel', 'wa-1'],
  ]);
});

test('native MCP actions test configured servers and install catalog entries', async () => {
  const calls: unknown[][] = [];
  const api = {
    testMcpServer: async (...args: unknown[]) => {
      calls.push(['test', ...args]);
      return { ok: true, tools: [{ name: 'search', description: 'Search' }] };
    },
    installMcpCatalogEntry: async (...args: unknown[]) => {
      calls.push(['install', ...args]);
      return { background: false, name: 'github', ok: true };
    },
  } as unknown as HermesCloudApi;

  const tested = await performHermesSwiftUIRouteAction(api, {
    action: 'mcp.test',
    payload: { route: 'mcp', id: 'github' },
  }, 'ops');
  const installed = await performHermesSwiftUIRouteAction(api, {
    action: 'integration.create',
    payload: {
      route: 'mcp',
      fields: { catalogName: 'github', enable: 'true', env: '{"GITHUB_TOKEN":"secret"}' },
    },
  }, 'ops');
  const legacyInstalled = await performHermesSwiftUIRouteAction(api, {
    action: 'mcp.catalog.install',
    payload: {
      route: 'mcp',
      id: 'github',
      fields: { enable: 'true', env: '{"GITHUB_TOKEN":"secret"}' },
    },
  }, 'ops');

  assert.deepEqual(tested, { message: '连接成功：1 个工具' });
  assert.deepEqual(installed, { message: 'MCP 已安装', reload: true });
  assert.deepEqual(legacyInstalled, { message: 'MCP 已安装', reload: true });
  assert.deepEqual(calls, [
    ['test', 'github', 'ops'],
    ['install', 'github', { GITHUB_TOKEN: 'secret' }, true, 'ops'],
    ['install', 'github', { GITHUB_TOKEN: 'secret' }, true, 'ops'],
  ]);
});

test('approval decisions echo the digest rendered by the native snapshot', async () => {
  const calls: unknown[][] = [];
  const api = {
    loadRoute: async () => ({
      approval: {
        id: 'approval-1',
        action: 'create',
        created_at: 1_752_643_200,
        expires_at: 1_752_646_800,
        origin: 'foreground',
        payload: { name: 'reviewed-skill' },
        payload_digest: 'a'.repeat(64),
        profile: 'reviewer',
        revision: 7,
        state: 'pending',
        subsystem: 'skills',
        summary: 'Install reviewed skill',
      },
      approvals: [],
    }),
    decideWriteApproval: async (...args: unknown[]) => { calls.push(args); },
  } as unknown as HermesCloudApi;

  const snapshot = await loadHermesSwiftUIRouteSnapshot(
    api,
    'approvals',
    'reviewer',
    'approval-1',
  );
  assert.equal(snapshot.approvals?.selected?.payloadDigest, 'a'.repeat(64));

  const result = await performHermesSwiftUIRouteAction(api, {
    action: 'approval.approve',
    payload: {
      fields: {
        payloadDigest: snapshot.approvals?.selected?.payloadDigest ?? '',
        revision: '7',
      },
      id: 'approval-1',
      requestId: 'approval-request-1',
      route: 'approvals',
    },
  }, 'reviewer');

  assert.equal(result, 'reload');
  assert.deepEqual(calls, [[
    'approval-1',
    'approve',
    7,
    'approval-request-1',
    'reviewer',
    'a'.repeat(64),
  ]]);
});

test('all native management routes render the current cloud workspace response', async () => {
  const responses: Record<string, unknown> = {
    cron: [{ id: 'cron-1', name: '每日总结', schedule: '0 9 * * *', prompt: '总结会话', enabled: true }],
    skills: {
      skills: [{ name: 'browser', description: '浏览网页', bundled: true, enabled: true }],
      installations: {
        operations: [{
          id: 'mi-skill',
          kind: 'skill',
          identifier: 'official/browser',
          state: 'running',
          error: '',
          targets: [
            { node_id: 'server', state: 'completed', error: '' },
            { node_id: 'dbb3', state: 'running', error: '' },
          ],
        }],
      },
    },
    plugins: { manifests: [{ name: 'collaboration', description: '多 Agent 协作', enabled: true }] },
    mcp: {
      servers: { servers: [{ name: 'filesystem', command: 'npx', args: ['server-filesystem'], enabled: true }] },
      catalog: {
        entries: [{
          name: 'github',
          description: 'GitHub tools',
          needs_install: false,
          required_env: [{ name: 'GITHUB_TOKEN', required: true }],
          url: 'https://github.example/mcp',
        }],
      },
      installations: {
        operations: [{
          id: 'mi-mcp',
          kind: 'mcp',
          identifier: 'github',
          state: 'completed',
          error: '',
          targets: [{ node_id: 'wsl', state: 'completed', error: '' }],
        }],
      },
      resourceCatalog: {
        resources: [{
          install_operation_id: 'mi-mcp',
          operation_id: 'mi-mcp',
          aggregate_state: 'verified',
          health: 'healthy',
          resolved_commit_or_version: '2.0.0',
          tools: ['issues.list'],
          permissions: ['network', 'credentials'],
          last_verified_at: '2026-07-30T08:00:00Z',
          rollback_available: true,
        }],
      },
    },
    channels: { platforms: [{ id: 'telegram', name: 'Telegram', description: 'Telegram messaging', enabled: true, env_vars: [{ key: 'TELEGRAM_BOT_TOKEN', is_set: true, redacted_value: '123•••456' }] }] },
    webhooks: { enabled: true, subscriptions: [{ name: 'deploy', description: '部署回调', enabled: true }] },
    pairing: {
      pending: [{ platform: 'telegram', user_id: '42', user_name: 'Alice', request_id: 'pair-42', age_minutes: 3 }],
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
  assert.equal(skills.installations?.[0].identifier, 'official/browser');
  assert.deepEqual(skills.installations?.[0].targets.map(({ nodeId, state }) => [nodeId, state]), [
    ['server', 'completed'],
    ['dbb3', 'running'],
  ]);
  assert.equal(plugins.integrations?.[0].detail, '多 Agent 协作');
  assert.equal(mcp.integrations?.[0].name, '文件系统');
  assert.equal(mcp.integrations?.[0].detail, 'npx server-filesystem');
  assert.equal(mcp.integrations?.[1].id, 'github');
  assert.equal(mcp.integrations?.[1].catalogEntry, true);
  assert.deepEqual(mcp.integrations?.[1].catalogRequiredEnv, ['GITHUB_TOKEN']);
  assert.equal(mcp.installations?.[0].state, 'verified');
  assert.equal(mcp.installations?.[0].version, '2.0.0');
  assert.deepEqual(mcp.installations?.[0].tools, ['issues.list']);
  assert.deepEqual(mcp.installations?.[0].permissions, ['network', 'credentials']);
  assert.equal(mcp.installations?.[0].rollbackAvailable, true);
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
  assert.equal(pairing.pairing?.pending[0].requestId, 'pair-42');
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
  assert.deepEqual(legacyEnvironment.environment, [{
    id: 'OPENAI_API_KEY',
    key: 'OPENAI_API_KEY',
    maskedValue: 'sk-legacy',
  }]);
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
    triggerCronJob: async (...args: unknown[]) => { calls.push(['cron-run', ...args]); },
    toggleSkill: async (...args: unknown[]) => { calls.push(['skill-toggle', ...args]); },
    updateChannel: async (...args: unknown[]) => { calls.push(['channel-update', ...args]); },
    setPluginEnabled: async (...args: unknown[]) => { calls.push(['plugin-toggle', ...args]); },
    setActiveProfile: async (...args: unknown[]) => { calls.push(['profile-active', ...args]); },
    deleteEnvironmentVariable: async (...args: unknown[]) => { calls.push(['environment-delete', ...args]); },
    updateKanbanTask: async (...args: unknown[]) => { calls.push(['kanban-update', ...args]); },
    updateSkillContent: async (...args: unknown[]) => { calls.push(['skill-update', ...args]); },
    restartGateway: async (...args: unknown[]) => { calls.push(['restart', ...args]); },
    recoverManagedNodes: async (...args: unknown[]) => { calls.push(['recover', ...args]); },
  } as unknown as HermesCloudApi;

  await performHermesSwiftUIRouteAction(api, { action: 'cron.toggle', payload: { route: 'cron', id: 'cron-1', enabled: false } }, 'default');
  await performHermesSwiftUIRouteAction(api, { action: 'cron.run', payload: { route: 'bots', id: 'routine-1', fields: { profile: 'hk-worker' } } }, 'default');
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
    ['cron-run', 'routine-1', 'hk-worker'],
    ['skill-toggle', 'browser', true, 'reviewer'],
    ['plugin-toggle', 'kanban', false],
    ['profile-active', 'worker'],
    ['environment-delete', 'custom-main', 'default'],
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

test('snapshot labels and action messages follow the caller locale', async () => {
  // Chinese remains the default (the pins above run without the flag); an
  // English client threads chinese=false through the SwiftUI route hook and
  // must not receive hardcoded Chinese labels or action feedback.
  const responses: Record<string, unknown> = {
    sessions: { sessions: [{ id: 'session-1', message_count: 8, tool_call_count: 3 }] },
    files: {
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
    },
    pairing: {
      pending: [{ platform: 'telegram', user_id: '42', user_name: 'Alice', request_id: 'pair-42', age_minutes: 3 }],
      approved: [],
    },
    system: {
      status: { gateway_running: true, active_sessions: 2 },
      stats: { uptime_seconds: 1_213_200 },
    },
  };
  const api = {
    loadRoute: async (route: string) => responses[route],
    saveCustomModel: async () => {},
    testCustomModel: async () => (
      { latency_ms: 84, message: 'ok', ok: true, reachable: true, status: 200 }
    ),
  } as unknown as HermesCloudApi;

  const sessions = await loadHermesSwiftUIRouteSnapshot(api, 'sessions', 'default', '', false);
  const files = await loadHermesSwiftUIRouteSnapshot(api, 'files', 'default', '', false);
  const pairing = await loadHermesSwiftUIRouteSnapshot(api, 'pairing', 'default', '', false);
  const system = await loadHermesSwiftUIRouteSnapshot(api, 'system', 'default', '', false);

  assert.equal(sessions.sessions?.[0].title, 'Untitled session');
  assert.equal(sessions.sessions?.[0].detail, '8 messages · 3 tool calls');
  assert.equal(files.files?.[0].detail, 'Model output · 2 KB · Available');
  assert.equal(pairing.pairing?.pending[0].detail, 'Alice · 3 min ago');
  assert.equal(pairing.pairing?.pending[0].requestId, 'pair-42');
  assert.equal(system.system?.uptimeLabel, '14d 1h');

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
  }, 'default', false);
  const tested = await performHermesSwiftUIRouteAction(api, {
    action: 'model.test',
    payload: { fields, route: 'models' },
  }, 'default', false);

  assert.deepEqual(saved, { message: 'Model configuration saved', reload: true });
  assert.deepEqual(tested, { message: 'Connection succeeded (HTTP 200, 84 ms)' });
});

test('Bot Mode route projects the upstream profile roster', async () => {
  const snapshot = await loadHermesSwiftUIRouteSnapshot({
    loadRoute: async (routeId: string) => {
      assert.equal(routeId, 'bots');
      return {
        bot_mode: true,
        canonical_chat_title: 'Bot Chat',
        profiles: [{
          name: 'hk-worker',
          display_name: 'HK Worker',
          model: 'gpt-5.6-sol',
          bot_meta: { title: 'HK Worker', hidden: true, pinned: true, groups: ['ops', 'hk'] },
          canonical_session: { id: 'bot-chat', resolved_id: 'bot-chat' },
        }],
        bot_relay: { agents: [{ handle: 'worker', connection_id: 'hk-primary' }] },
        bot_pet_gallery: { pets: [{ slug: 'otter', displayName: 'Otter' }] },
        bot_routines: { 'hk-worker': [{ id: 'routine-1', name: 'HK heartbeat', schedule: '*/5 * * * *', prompt: 'check worker', enabled: true }] },
      };
    },
  } as unknown as HermesCloudApi, 'bots', 'default');
  assert.deepEqual(snapshot.profiles?.map((entry) => ({ id: entry.id, name: entry.name })), [
    { id: 'hk-worker', name: 'HK Worker' },
  ]);
  assert.equal(snapshot.profiles?.[0]?.detail, 'Bot Chat 已就绪 · 分组: ops, hk');
  assert.equal(snapshot.profiles?.[0]?.name, 'HK Worker');
  assert.equal(snapshot.profiles?.[0]?.botHidden, true);
  assert.equal(snapshot.profiles?.[0]?.botPinned, true);
  assert.deepEqual(snapshot.profiles?.[0]?.botGroups, ['ops', 'hk']);
  assert.match(snapshot.profiles?.[0]?.botSessionId || '', /^official:v3:/);
  assert.match(snapshot.botRelayJSON || '', /hk-primary/);
  assert.match(snapshot.botPetJSON || '', /otter/);
  assert.match(snapshot.botRoutinesJSON || '', /HK heartbeat/);
});

test('Bot Mode route bounds the large Petdex catalog in native snapshots', async () => {
  const pets = Array.from({ length: 150 }, (_, index) => ({ slug: `pet-${index}`, displayName: `Pet ${index}` }));
  const source = await loadCloudRoute({
    getBots: async () => ({ bot_mode: true, profiles: [] }),
    getBotRelayRoster: async () => ({}),
    getBotPetGallery: async () => ({ pets }),
  } as unknown as HermesCloudApi, 'bots', 'default');
  const gallery = source as { bot_pet_gallery?: { pets?: unknown[] } };
  assert.equal(gallery.bot_pet_gallery?.pets?.length, 96);
});

test('Bot Mode route hydrates per-profile Routines from the official cron store', async () => {
  const source = await loadCloudRoute({
    getBots: async () => ({ bot_mode: true, profiles: [{ name: 'hk-worker' }] }),
    getCronJobs: async (profile: string) => profile === 'hk-worker'
      ? [{ id: 'routine-1', name: 'HK heartbeat', schedule: '*/5 * * * *', prompt: 'check worker', enabled: true }]
      : [],
    getBotRelayRoster: async () => ({}),
    getBotPetGallery: async () => ({ pets: [] }),
  } as unknown as HermesCloudApi, 'bots', 'default');
  assert.deepEqual((source as { bot_routines?: Record<string, unknown[]> }).bot_routines, {
    'hk-worker': [{ id: 'routine-1', name: 'HK heartbeat', schedule: '*/5 * * * *', prompt: 'check worker', enabled: true }],
  });
});

test('Bot Mode metadata action uses the dedicated REST endpoint', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    updateBotMeta: async (name: string, patch: Record<string, unknown>) => {
      calls.push([name, patch]);
      return { ok: true, applied: { ui_meta: true } };
    },
  } as unknown as HermesCloudApi;
  const result = await performHermesSwiftUIRouteAction(api, {
    action: 'bot.meta.update',
    payload: {
      route: 'bots',
      id: 'hk-worker',
      detail: JSON.stringify({ hidden: true, pinned: true, groups: ['ops'] }),
    },
  }, 'default');
  assert.equal(result, 'reload');
  assert.deepEqual(calls, [['hk-worker', { hidden: true, pinned: true, groups: ['ops'] }]]);
});

test('Bot Mode capability actions call official configure and avatar contracts', async () => {
  const calls: Array<[string, string, Record<string, unknown> | string]> = [];
  const api = {
    describeBotProfile: async (name: string) => { calls.push(['describe', name, {}]); return { skills: [{ name: 'coding' }], toolsets: [], mcp_servers: [] }; },
    configureBotProfile: async (name: string, patch: Record<string, unknown>) => { calls.push(['configure', name, patch]); return { ok: true, applied: { soul: true } }; },
    setBotAsset: async (name: string, data: string) => { calls.push(['avatar', name, data]); return { ok: true }; },
    generateBotAvatar: async (name: string, prompt: string) => { calls.push(['generate', name, prompt]); return { ok: true }; },
  } as unknown as HermesCloudApi;
  const described = await performHermesSwiftUIRouteAction(api, { action: 'bot.profile.describe', payload: { route: 'bots', id: 'coder' } }, 'default', 'en');
  const configured = await performHermesSwiftUIRouteAction(api, { action: 'bot.profile.configure', payload: { route: 'bots', id: 'coder', detail: '{"soul":"# coder"}' } }, 'default');
  const uploaded = await performHermesSwiftUIRouteAction(api, { action: 'bot.avatar.upload', payload: { route: 'bots', id: 'coder', detail: 'data:image/png;base64,AA==' } }, 'default');
  const generated = await performHermesSwiftUIRouteAction(api, { action: 'bot.avatar.generate', payload: { route: 'bots', id: 'coder' } }, 'default');
  assert.match(typeof described === 'object' ? described.message : '', /1 skills/);
  assert.equal(configured, 'reload');
  assert.equal(uploaded, 'reload');
  assert.match(typeof generated === 'object' ? generated.message : '', /生成|generated/);
  assert.deepEqual(calls[1], ['configure', 'coder', { soul: '# coder' }]);
  assert.equal(calls[2][0], 'avatar');
});

test('Bot Mode relay action queues through the official cross-connection endpoint', async () => {
  const calls: Array<[string, string, string]> = [];
  const api = {
    sendBotRelayMessage: async (target: string, message: string, profile: string) => {
      calls.push([target, message, profile]);
      return { ok: true, envelope_id: 'abcdef0123456789' };
    },
  } as unknown as HermesCloudApi;
  const result = await performHermesSwiftUIRouteAction(api, {
    action: 'bot.relay.send',
    payload: {
      route: 'bots',
      targetId: 'worker@hk-primary',
      detail: '继续执行',
      fields: { profile: 'default' },
    },
  }, 'default');
  assert.match(typeof result === 'object' ? result.message : '', /排队/);
  assert.deepEqual(calls, [['worker@hk-primary', '继续执行', 'default']]);
});

test('Bot Mode Petdex action stores the selected first-frame avatar', async () => {
  const calls: Array<[string, string, string]> = [];
  const api = {
    setBotPetAvatar: async (name: string, slug: string, url: string) => {
      calls.push([name, slug, url]);
      return { ok: true };
    },
  } as unknown as HermesCloudApi;
  const result = await performHermesSwiftUIRouteAction(api, {
    action: 'bot.pet.select',
    payload: { route: 'bots', id: 'coder', targetId: 'otter', detail: 'https://petdex/otter.webp' },
  }, 'default', 'en');
  assert.match(typeof result === 'object' ? result.message : '', /Petdex|avatar/);
  assert.deepEqual(calls, [['coder', 'otter', 'https://petdex/otter.webp']]);
});

test('system snapshots share managed-node aliases with the sidebar status', async () => {
  const checkedAt = Math.floor((Date.now() - 1_000) / 1_000);
  const api = {
    loadRoute: async () => ({
      managedNodes: {
        configured: 'true',
        items: [{
          nodeId: 'DBB3',
          displayName: 'DBB3 Relay',
          online: 'true',
          gatewayState: 'healthy',
          checkedAt,
          metricsAvailable: 'true',
          gatewayVersion: 'v2.0.0',
          telemetry: {
            cpuPercent: '18',
            memoryPercent: '42',
            diskPercent: '27',
          },
        }],
      },
      status: {},
      stats: {},
    }),
  } as unknown as HermesCloudApi;

  const snapshot = await loadHermesSwiftUIRouteSnapshot(api, 'system', 'default');

  assert.equal(snapshot.system?.gatewayOnline, true);
  assert.equal(snapshot.system?.nodes[0]?.id, 'dbb3');
  assert.equal(snapshot.system?.nodes[0]?.label, 'DBB3 Relay');
  assert.equal(snapshot.system?.nodes[0]?.cpu, 18);
  assert.equal(snapshot.system?.nodes[0]?.version, 'v2.0.0');
});

test('native managed-resource rollback submits one idempotent server intent', async () => {
  const calls: unknown[] = [];
  const api = {
    async rollbackManagedInstallation(operationId: string, requestId: string) {
      calls.push([operationId, requestId]);
      return { accepted: true };
    },
  } as unknown as HermesCloudApi;

  const result = await performHermesSwiftUIRouteAction(api, {
    action: 'installation.rollback',
    payload: {
      route: 'skills',
      id: 'mi-install-1',
      requestId: 'ios-rollback-1',
    },
  }, 'default');

  assert.equal(result, 'reload');
  assert.deepEqual(calls, [['mi-install-1', 'ios-rollback-1']]);
});
