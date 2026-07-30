import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { HermesApiClient, HermesRequestOptions } from '../src/api/HermesApiClient';
import { HermesCloudApi } from '../src/api/HermesCloudApi';

// Audit finding H8: HermesCloudApi is being split into src/api/cloud/<domain>
// modules behind the unchanged facade surface. These tests pin the wire
// contract (path, verb, query, body) of every migrated method through the
// PUBLIC facade, so a move can never silently change what goes on the wire,
// and pin that the facade does not keep a drifting second copy of the bodies.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface RecordedCall {
  options: HermesRequestOptions;
  path: string;
}

function recordingApi() {
  const calls: RecordedCall[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ options, path });
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
      return Promise.resolve({} as T);
    },
  } as HermesApiClient;
  return { api: new HermesCloudApi(client), calls };
}

function parsedBody(call: RecordedCall): unknown {
  return JSON.parse(String(call.options.body));
}

test('mobile console commands stay profile-scoped and confirmation-aware', async () => {
  const { api, calls } = recordingApi();

  await api.getMobileConsoleCommands('ios-native');
  await api.getMobileConsoleCompletions('/config set model.', 'ios-native');
  await api.executeMobileConsoleCommand('/status', 'ios-native');
  await api.executeMobileConsoleCommand('/config set theme dark', 'ios-native', true);

  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET']),
    [
      [
        '/api/plugins/collaboration/mobile/console/commands?profile=ios-native',
        'GET',
      ],
      ['/api/plugins/collaboration/mobile/console/completions', 'POST'],
      ['/api/plugins/collaboration/mobile/console/execute', 'POST'],
      ['/api/plugins/collaboration/mobile/console/execute', 'POST'],
    ],
  );
  assert.deepEqual(parsedBody(calls[1]), {
    line: '/config set model.',
    limit: 30,
    profile: 'ios-native',
  });
  assert.deepEqual(parsedBody(calls[2]), {
    confirmed: false,
    line: '/status',
    profile: 'ios-native',
  });
  assert.deepEqual(parsedBody(calls[3]), {
    confirmed: true,
    line: '/config set theme dark',
    profile: 'ios-native',
  });
});

test('cron methods keep their exact wire contract through the cloud/cron split', async () => {
  const { api, calls } = recordingApi();

  await api.getCronJobs('ops');
  await api.createCronJob({ name: 'digest' }, 'ops');
  await api.updateCronJob('job one', { paused: false }, 'ops');
  await api.setCronJobPaused('job one', true, 'ops');
  await api.setCronJobPaused('job one', false, 'ops');
  await api.triggerCronJob('job one', 'ops');
  await api.deleteCronJob('job one', 'ops');

  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET', options.query?.profile]),
    [
      ['/api/cron/jobs', 'GET', 'ops'],
      ['/api/cron/jobs', 'POST', 'ops'],
      ['/api/cron/jobs/job%20one', 'PUT', 'ops'],
      ['/api/cron/jobs/job%20one/pause', 'POST', 'ops'],
      ['/api/cron/jobs/job%20one/resume', 'POST', 'ops'],
      ['/api/cron/jobs/job%20one/trigger', 'POST', 'ops'],
      ['/api/cron/jobs/job%20one', 'DELETE', 'ops'],
    ],
  );
  assert.deepEqual(parsedBody(calls[1]), { name: 'digest' });
  assert.deepEqual(parsedBody(calls[2]), { updates: { paused: false } });
});

test('memory methods keep their wire contract and normalize server mtimes', async () => {
  const calls: RecordedCall[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ options, path });
      return Promise.resolve({
        memory: 'memory text',
        memory_mtime: 1_700_000_000,
        soul: 'soul text',
        soul_mtime: 'server timestamp',
        user: 'user text',
        user_mtime: null,
      } as T);
    },
  } as HermesApiClient;
  const api = new HermesCloudApi(client);

  const loaded = await api.getStudioMemory('reviewer');
  const saved = await api.saveStudioMemory('reviewer', 'user', 'updated user');

  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET', options.profile]),
    [
      ['/api/hermes/memory', 'GET', 'reviewer'],
      ['/api/hermes/memory', 'PUT', 'reviewer'],
    ],
  );
  assert.deepEqual(parsedBody(calls[1]), { content: 'updated user', section: 'user' });
  assert.equal(loaded.memory, 'memory text');
  assert.equal(loaded.soulMtime, 'server timestamp');
  assert.equal(loaded.userMtime, '');
  assert.equal(saved.user, 'user text');
  assert.notEqual(loaded.memoryMtime, '');
});

test('model methods keep their exact wire contract through cloud/models', async () => {
  const calls: RecordedCall[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ options, path });
      if (path === '/api/model/set') {
        return Promise.resolve({
          model: 'gpt-test',
          ok: true,
          provider: 'openai',
          scope: 'main',
        } as T);
      }
      if (path === '/api/model/custom/discover') {
        return Promise.resolve({
          latency_ms: 5,
          message: 'ok',
          models: ['gpt-test'],
          ok: true,
          reachable: true,
          status: 200,
        } as T);
      }
      return Promise.resolve({} as T);
    },
  } as HermesApiClient;
  const api = new HermesCloudApi(client);
  const configuration = {
    apiKey: 'secret',
    apiMode: 'chat_completions' as const,
    baseUrl: 'https://models.example/v1/',
    contextLength: 131072,
    model: 'gpt-test',
    reasoningEffort: 'high' as const,
  };

  await api.getModels('reviewer');
  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET', options.profile]),
    [
      ['/api/model/info', 'GET', 'reviewer'],
      ['/api/model/options', 'GET', 'reviewer'],
      ['/api/model/custom', 'GET', 'reviewer'],
    ],
  );
  assert.deepEqual(calls[1].options.query, { include_unconfigured: 1 });

  calls.length = 0;
  await api.saveCustomModel(configuration, 'reviewer');
  await api.testCustomModel(configuration, 'reviewer');
  const discovered = await api.discoverCustomModels(
    configuration.baseUrl,
    configuration.apiKey,
    'reviewer',
  );
  await api.setModel('openai', 'gpt-test', 'reviewer', true);

  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET', options.profile]),
    [
      ['/api/model/custom', 'PUT', undefined],
      ['/api/model/custom/test', 'POST', undefined],
      ['/api/model/custom/discover', 'POST', undefined],
      ['/api/model/set', 'POST', 'reviewer'],
    ],
  );
  assert.deepEqual(parsedBody(calls[0]), {
    api_key: 'secret',
    api_key_action: 'replace',
    api_mode: 'chat_completions',
    base_url: 'https://models.example/v1',
    context_length: 131072,
    model: 'gpt-test',
    reasoning_effort: 'high',
    profile: 'reviewer',
  });
  assert.deepEqual(parsedBody(calls[1]), {
    api_key: 'secret',
    api_mode: 'chat_completions',
    base_url: 'https://models.example/v1',
    model: 'gpt-test',
    profile: 'reviewer',
  });
  assert.deepEqual(parsedBody(calls[2]), {
    api_key: 'secret',
    base_url: 'https://models.example/v1',
    profile: 'reviewer',
  });
  assert.deepEqual(parsedBody(calls[3]), {
    confirm_expensive_model: true,
    model: 'gpt-test',
    provider: 'openai',
    scope: 'main',
  });
  assert.equal(discovered.baseUrl, 'https://models.example/v1');
});

test('skills and managed installation methods keep their wire contract through cloud/extensions', async () => {
  const { api, calls } = recordingApi();

  await api.getSkills('ops');
  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.profile ?? options.query?.profile]),
    [
      ['/api/skills', 'ops'],
      ['/api/tools/toolsets', 'ops'],
      ['/api/plugins/collaboration/managed-installations', 'ops'],
      ['/api/plugins/collaboration/managed-resources', undefined],
    ],
  );
  assert.deepEqual(calls[2].options.query, { kind: 'skill', profile: 'ops', limit: '50' });

  calls.length = 0;
  await api.getManagedInstallations('mcp', 'ops', 5);
  assert.deepEqual(calls[0].options.query, { kind: 'mcp', profile: 'ops', limit: '5' });

  calls.length = 0;
  await api.createManagedInstallation({
    identifier: 'weather-skill',
    kind: 'skill',
    request_id: 'req-1',
  });
  assert.equal(calls[0].path, '/api/plugins/collaboration/managed-installations');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(parsedBody(calls[0]), {
    identifier: 'weather-skill',
    kind: 'skill',
    request_id: 'req-1',
  });

  calls.length = 0;
  await api.toggleSkill('weather', true, 'ops');
  await api.getSkillContent('weather', 'ops');
  await api.updateSkillContent('weather', '# skill', 'ops');
  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET']),
    [
      ['/api/skills/toggle', 'PUT'],
      ['/api/skills/content', 'GET'],
      ['/api/skills/content', 'PUT'],
    ],
  );
  assert.deepEqual(parsedBody(calls[0]), { name: 'weather', enabled: true, profile: 'ops' });
  assert.deepEqual(calls[1].options.query, { name: 'weather', profile: 'ops' });
  assert.deepEqual(parsedBody(calls[2]), { name: 'weather', content: '# skill', profile: 'ops' });
});

test('plugin and MCP methods keep their wire contract through cloud/extensions', async () => {
  const { api, calls } = recordingApi();

  await api.getPlugins();
  await api.setPluginEnabled('kan ban', true);
  await api.setPluginEnabled('kan ban', false);
  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET']),
    [
      ['/api/dashboard/plugins', 'GET'],
      ['/api/dashboard/plugins/hub', 'GET'],
      ['/api/dashboard/agent-plugins/kan%20ban/enable', 'POST'],
      ['/api/dashboard/agent-plugins/kan%20ban/disable', 'POST'],
    ],
  );

  calls.length = 0;
  await api.getMcp('ops');
  assert.deepEqual(
    calls.map(({ path }) => path),
    [
      '/api/mcp/servers',
      '/api/mcp/catalog',
      '/api/plugins/collaboration/managed-installations',
      '/api/plugins/collaboration/managed-resources',
    ],
  );
  assert.deepEqual(calls[2].options.query, { kind: 'mcp', profile: 'ops', limit: '50' });
  assert.deepEqual(calls[3].options.query, { cursor: '0', limit: '500' });

  calls.length = 0;
  await api.addMcpServer({ name: 'files' }, 'ops');
  await api.setMcpServerEnabled('files db', true, 'ops');
  await api.removeMcpServer('files db', 'ops');
  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET', options.query?.profile]),
    [
      ['/api/mcp/servers', 'POST', 'ops'],
      ['/api/mcp/servers/files%20db/enabled', 'PUT', 'ops'],
      ['/api/mcp/servers/files%20db', 'DELETE', 'ops'],
    ],
  );
  assert.deepEqual(parsedBody(calls[1]), { enabled: true });
});

test('conversation and hosted-turn methods keep their wire contract through cloud/conversations', async () => {
  const { api, calls } = recordingApi();

  await api.getConversations();
  await api.createConversation('ops', 'Deploy audit', 'device-conversation-1');
  await api.getConversation('conversation one');
  await api.getConversationSessionEntries('conversation one', 7, 250);
  await api.forkConversationFromMessage('conversation one', 'message one', {
    idempotencyKey: 'fork-1',
    profile: 'reviewer',
    title: 'Forked audit',
  });
  await api.compressConversation('conversation one', {
    focusTopic: 'release evidence',
    idempotencyKey: 'compress-1',
    profile: 'reviewer',
  });
  await api.enqueueHostedTurn('conversation one', {
    requestId: 'request-1',
    turnId: 'turn-1',
    message: { content: 'Audit deployment', id: 'message-1', name: 'Given', role: 'user' },
    profiles: ['manager'],
    recentMessages: [{ content: 'Context', role: 'user' }],
  });
  await api.interveneHostedTurn('conversation one', 'turn-1', '@reviewer recheck', 'message-2');
  await api.cancelHostedTurn('conversation one', 'turn-1', 'user_cancelled');
  await api.renameConversation('conversation one', 'Release review');
  await api.deleteConversation('conversation one');

  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET']),
    [
      ['/api/plugins/collaboration/single/conversations', 'GET'],
      ['/api/plugins/collaboration/single/conversations', 'POST'],
      ['/api/plugins/collaboration/single/conversations/conversation%20one', 'GET'],
      [
        '/api/plugins/collaboration/single/conversations/conversation%20one/session-entries',
        'GET',
      ],
      [
        '/api/plugins/collaboration/mobile/conversations/conversation%20one/messages/message%20one/fork',
        'POST',
      ],
      ['/api/plugins/collaboration/mobile/conversations/conversation%20one/compress', 'POST'],
      ['/api/plugins/collaboration/single/conversations/conversation%20one/enqueue', 'POST'],
      [
        '/api/plugins/collaboration/single/conversations/conversation%20one/hosted-turns/turn-1/interventions',
        'POST',
      ],
      [
        '/api/plugins/collaboration/single/conversations/conversation%20one/hosted-turns/turn-1/cancel',
        'POST',
      ],
      ['/api/plugins/collaboration/single/conversations/conversation%20one', 'PATCH'],
      ['/api/plugins/collaboration/single/conversations/conversation%20one', 'DELETE'],
    ],
  );
  assert.deepEqual(parsedBody(calls[1]), {
    client_id: 'device-conversation-1',
    profile: 'ops',
    title: 'Deploy audit',
  });
  assert.deepEqual(calls[3].options.query, { cursor: '7', limit: '250' });
  assert.deepEqual(parsedBody(calls[4]), {
    idempotency_key: 'fork-1',
    profile: 'reviewer',
    title: 'Forked audit',
  });
  assert.deepEqual(parsedBody(calls[5]), {
    focus_topic: 'release evidence',
    idempotency_key: 'compress-1',
    profile: 'reviewer',
  });
  assert.deepEqual(parsedBody(calls[6]), {
    attachment_context: '',
    attachment_ids: [],
    delivery_context: '',
    message: { content: 'Audit deployment', id: 'message-1', name: 'Given', role: 'user' },
    profiles: ['manager'],
    recent_messages: [{ content: 'Context', role: 'user' }],
    request_id: 'request-1',
    turn_id: 'turn-1',
  });
  assert.deepEqual(parsedBody(calls[7]), {
    content: '@reviewer recheck',
    message_id: 'message-2',
  });
  assert.deepEqual(parsedBody(calls[8]), {
    reason: 'user_cancelled',
    request_id: 'cancel-turn-1',
  });
});

test('managed and account files keep their wire contract through cloud/files', async () => {
  const { api, calls } = recordingApi();

  await api.listFiles('workspace/reports');
  await api.readFile('workspace/reports/a.md');
  await api.createDirectory('workspace/results');
  await api.deleteFile('workspace/old', true);
  await api.getAccountFiles({ keyword: 'report', limit: 25, offset: 5, status: 'available' });
  await api.getAccountFile('file one');
  await api.deleteAccountFile('file one');

  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET']),
    [
      ['/api/files', 'GET'],
      ['/api/files/read', 'GET'],
      ['/api/files/mkdir', 'POST'],
      ['/api/files', 'DELETE'],
      ['/api/plugins/collaboration/files', 'GET'],
      ['/api/plugins/collaboration/files/file%20one', 'GET'],
      ['/api/plugins/collaboration/files/file%20one', 'DELETE'],
    ],
  );
  assert.deepEqual(calls[0].options.query, { path: 'workspace/reports' });
  assert.deepEqual(calls[1].options.query, { path: 'workspace/reports/a.md' });
  assert.deepEqual(parsedBody(calls[2]), { path: 'workspace/results' });
  assert.deepEqual(parsedBody(calls[3]), { path: 'workspace/old', recursive: true });
  assert.deepEqual(calls[4].options.query, {
    date_from: undefined,
    date_to: undefined,
    limit: 25,
    offset: 5,
    q: 'report',
    source: undefined,
    status: 'available',
    type: undefined,
  });
});

test('workflow, approval, and runtime controls keep their wire contract through cloud/workflows', async () => {
  const { api, calls } = recordingApi();

  await api.getWorkflows('ops');
  await api.startWorkflow('release audit', 'ops', 'workflow-start-1');
  await api.cancelWorkflowRun('run one', 7, 'ops', 'workflow-cancel-1');
  await api.approveWorkflowNode('run one', 'review node', 8, 'ops', 'workflow-approve-1');
  await api.decideWriteApproval(
    'approval one',
    'approve',
    4,
    'write-approval-1',
    'ops',
    'sha256:digest',
  );
  await api.cancelRuntimeRun(
    '/api/plugins/collaboration/single/conversations/conversation-1/hosted-turns/turn-1/cancel',
    'runtime-cancel-1',
  );

  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET']),
    [
      ['/api/plugins/workflows/definitions', 'GET'],
      ['/api/plugins/workflows/definitions/release%20audit/runs', 'POST'],
      ['/api/plugins/workflows/runs/run%20one/cancel', 'POST'],
      ['/api/plugins/workflows/runs/run%20one/nodes/review%20node/approval', 'POST'],
      ['/api/plugins/collaboration/mobile/write-approvals/approval%20one/decision', 'POST'],
      [
        '/api/plugins/collaboration/single/conversations/conversation-1/hosted-turns/turn-1/cancel',
        'POST',
      ],
    ],
  );
  assert.deepEqual(calls[0].options.query, { profile_id: 'ops' });
  assert.deepEqual(parsedBody(calls[1]), { inputs: {}, profile_id: 'ops' });
  assert.equal(new Headers(calls[1].options.headers).get('Idempotency-Key'), 'workflow-start-1');
  assert.deepEqual(parsedBody(calls[2]), {
    expected_revision: 7,
    profile_id: 'ops',
    reason: 'mobile_user',
  });
  assert.deepEqual(parsedBody(calls[3]), {
    decision: 'approve',
    expected_revision: 8,
    profile_id: 'ops',
    request_id: 'workflow-approve-1',
  });
  assert.deepEqual(parsedBody(calls[4]), {
    decision: 'approve',
    expected_revision: 4,
    payload_digest: 'sha256:digest',
    profile: 'ops',
  });
  assert.deepEqual(parsedBody(calls[5]), {
    reason: 'mobile_user',
    request_id: 'runtime-cancel-1',
  });
  assert.throws(
    () => api.retryRuntimeRun('https://evil.example/runtime', 'runtime-retry-1'),
    /Runtime action is not available/,
  );
});

test('session, analytics, and log methods keep their wire contract through cloud/sessions', async () => {
  const calls: RecordedCall[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ options, path });
      if (path === '/api/sessions' || path === '/api/profiles/sessions') {
        return Promise.resolve({ sessions: [], total: 0, limit: 10, offset: 0 } as T);
      }
      return Promise.resolve({} as T);
    },
  } as HermesApiClient;
  const api = new HermesCloudApi(client);

  await api.getStatus();
  await api.getAllSessions('ops', 10);
  await api.getAllProfileSessions(10);
  await api.getSession('session one', 'ops');
  await api.getSessionMessages('session one', 'ops');
  await api.renameSession('session one', 'Renamed', 'ops');
  await api.deleteSession('session one', 'ops');
  await api.getAnalytics(14, 'ops');
  await api.getLogs(20, 'ERROR', 'gateway');

  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET']),
    [
      ['/api/status', 'GET'],
      ['/api/sessions', 'GET'],
      ['/api/profiles/sessions', 'GET'],
      ['/api/sessions/session%20one', 'GET'],
      ['/api/sessions/session%20one/messages', 'GET'],
      ['/api/sessions/session%20one', 'PATCH'],
      ['/api/sessions/session%20one', 'DELETE'],
      ['/api/analytics/usage', 'GET'],
      ['/api/analytics/models', 'GET'],
      ['/api/logs', 'GET'],
    ],
  );
  assert.deepEqual(parsedBody(calls[5]), { profile: 'ops', title: 'Renamed' });
  assert.deepEqual(calls[9].options.query, {
    component: 'gateway',
    level: 'ERROR',
    lines: 20,
  });
});

test('management methods keep their wire contract through cloud/management', async () => {
  const calls: RecordedCall[] = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ options, path });
      if (path === '/api/profiles') return Promise.resolve({ profiles: [] } as T);
      return Promise.resolve({} as T);
    },
  } as HermesApiClient;
  const api = new HermesCloudApi(client);

  await api.getPairing();
  await api.approvePairing('telegram', '123456');
  await api.revokePairing('telegram', 'user one');
  await api.getChannels('ops');
  await api.updateChannel('telegram one', { enabled: true }, 'ops');
  await api.getWebhooks();
  await api.setWebhookEnabled('hook one', false);
  await api.getProfiles();
  await api.getConfig('ops');
  await api.setEnvironmentVariable('KEY', 'value', 'ops');
  await api.getSystem();
  await api.recoverManagedNodes('dbb3');

  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET']),
    [
      ['/api/pairing', 'GET'],
      ['/api/pairing/approve', 'POST'],
      ['/api/pairing/revoke', 'POST'],
      ['/api/messaging/platforms', 'GET'],
      ['/api/messaging/platforms/telegram%20one', 'PUT'],
      ['/api/webhooks', 'GET'],
      ['/api/webhooks/hook%20one/enabled', 'PUT'],
      ['/api/profiles', 'GET'],
      ['/api/profiles/active', 'GET'],
      ['/api/config', 'GET'],
      ['/api/config/defaults', 'GET'],
      ['/api/config/schema', 'GET'],
      ['/api/env', 'PUT'],
      ['/api/status', 'GET'],
      ['/api/system/stats', 'GET'],
      ['/api/managed-nodes/status', 'GET'],
      ['/api/managed-nodes/recover', 'POST'],
    ],
  );
  assert.deepEqual(parsedBody(calls[4]), { enabled: true, profile: 'ops' });
  assert.deepEqual(parsedBody(calls[16]), { node_id: 'dbb3' });
});

test('kanban and collaboration methods keep their wire contract through cloud/collaboration', async () => {
  const { api, calls } = recordingApi();

  await api.getKanbanBoard();
  await api.createKanbanTask({ title: 'Audit' });
  await api.updateKanbanTask('task one', { status: 'done' });
  await api.getCollaborationProfiles();
  await api.getCollaborationRooms();
  await api.createCollaborationRoom('Room', ['worker']);
  await api.sendCollaborationRoomMessage(
    'room one',
    'Continue',
    ['worker'],
    'room-request-fixed',
  );
  await api.routeMessage('Build and review', [{ role: 'user', content: 'context' }]);

  assert.deepEqual(
    calls.map(({ path, options }) => [path, options.method ?? 'GET']),
    [
      ['/api/plugins/kanban/board', 'GET'],
      ['/api/plugins/kanban/tasks', 'POST'],
      ['/api/plugins/kanban/tasks/task%20one', 'PATCH'],
      ['/api/plugins/collaboration/profiles', 'GET'],
      ['/api/plugins/collaboration/rooms', 'GET'],
      ['/api/plugins/collaboration/rooms', 'POST'],
      ['/api/plugins/collaboration/rooms/room%20one/messages', 'POST'],
      ['/api/plugins/collaboration/route', 'POST'],
    ],
  );
  assert.deepEqual(parsedBody(calls[6]), {
    content: 'Continue',
    profiles: ['worker'],
    request_id: 'room-request-fixed',
    turn_id: 'room-turn-fixed',
  });
});

test('the facade keeps no drifting second copy of migrated endpoint bodies', () => {
  const facade = readFileSync(resolve(projectRoot, 'src/api/HermesCloudApi.ts'), 'utf8');
  const cron = readFileSync(resolve(projectRoot, 'src/api/cloud/cron.ts'), 'utf8');
  const collaboration = readFileSync(
    resolve(projectRoot, 'src/api/cloud/collaboration.ts'),
    'utf8',
  );
  const conversations = readFileSync(
    resolve(projectRoot, 'src/api/cloud/conversations.ts'),
    'utf8',
  );
  const extensions = readFileSync(resolve(projectRoot, 'src/api/cloud/extensions.ts'), 'utf8');
  const files = readFileSync(resolve(projectRoot, 'src/api/cloud/files.ts'), 'utf8');
  const memory = readFileSync(resolve(projectRoot, 'src/api/cloud/memory.ts'), 'utf8');
  const management = readFileSync(resolve(projectRoot, 'src/api/cloud/management.ts'), 'utf8');
  const models = readFileSync(resolve(projectRoot, 'src/api/cloud/models.ts'), 'utf8');
  const sessions = readFileSync(resolve(projectRoot, 'src/api/cloud/sessions.ts'), 'utf8');
  const routes = readFileSync(resolve(projectRoot, 'src/api/cloud/routes.ts'), 'utf8');
  const workflows = readFileSync(resolve(projectRoot, 'src/api/cloud/workflows.ts'), 'utf8');

  // Migrated endpoint paths exist exactly once: in their domain module.
  for (const [path, home] of [
    ['/api/cron/jobs', cron],
    ['/api/skills', extensions],
    ['/api/plugins/collaboration/managed-installations', extensions],
    ['/api/dashboard/plugins', extensions],
    ['/api/mcp/servers', extensions],
    ['/api/hermes/memory', memory],
    ['/api/model/info', models],
    ['/api/model/options', models],
    ['/api/model/custom', models],
    ['/api/model/set', models],
    ['/api/sessions', sessions],
    ['/api/analytics/usage', sessions],
    ['/api/logs', sessions],
    ['/api/pairing', management],
    ['/api/messaging/platforms', management],
    ['/api/webhooks', management],
    ['/api/config', management],
    ['/api/system/stats', management],
    ['/api/plugins/kanban', collaboration],
    ['/api/plugins/collaboration', collaboration],
  ] as const) {
    assert.ok(home.includes(path), `${path} must live in its cloud domain module`);
    assert.ok(
      !facade.includes(`'${path}`) && !facade.includes(`\`${path}`),
      `${path} endpoint body has leaked back into the HermesCloudApi facade`,
    );
  }

  // Domain modules stay behind the facade: nothing outside src/api constructs
  // them (the composition-root rule of tests/frontend-preview-source.test.ts).
  assert.match(facade, /new HermesCronCloudApi\(transport\)/);
  assert.match(facade, /new HermesCollaborationCloudApi\(transport\)/);
  assert.match(facade, /new HermesConversationsCloudApi\(transport\)/);
  assert.match(facade, /new HermesExtensionsCloudApi\(transport\)/);
  assert.match(facade, /new HermesFilesCloudApi\(transport\)/);
  assert.match(facade, /new HermesMemoryCloudApi\(transport\)/);
  assert.match(facade, /new HermesManagementCloudApi\(transport\)/);
  assert.match(facade, /new HermesModelsCloudApi\(transport\)/);
  assert.match(facade, /new HermesSessionsCloudApi\(transport\)/);
  assert.match(facade, /new HermesWorkflowsCloudApi\(transport\)/);
  assert.match(facade, /return loadCloudRoute\(this, routeId, profile, selectedId\)/);
  assert.match(routes, /case 'workflows'/);
  assert.match(routes, /case 'collaboration'/);
  assert.match(conversations, /\/single\/conversations/);
  assert.match(files, /\/api\/files/);
  assert.ok(files.includes('`${COLLABORATION}/files`'));
  assert.match(workflows, /\/api\/plugins\/workflows/);
  assert.match(workflows, /payload_digest/);
});
