import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { HermesApiClient } from '../src/api/HermesApiClient';
import { HermesStudioGroupChatApi } from '../src/api/hermes-studio/group-chat';
import { HermesStudioWorkflowsApi } from '../src/api/hermes-studio/workflows';
import {
  applyAgentGroupEvent,
  attachWorkspaceDiffs,
  emptyRoomSnapshot,
  roomRuntimeProjection,
  roomActivityTimestamp,
  sortRoomInfosByActivity,
  snapshotFromDetail,
  mergeCachedRoomSnapshot,
  mergeRoomHistoryMessages,
  upsertGroupMessage,
} from '../src/studio/agent-group/agent-group-model';

function readSource(path: string): string {
  return readFileSync(
    fileURLToPath(new NodeURL(`../${path}`, import.meta.url)),
    'utf8',
  );
}

test('Hermes Studio group chat uses the collaboration room contract', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = testClient(calls, () => calls.length === 1
    ? { rooms: [{ id: 'room-1', name: 'Research', profiles: ['default'] }] }
    : { room: { id: 'room-1', name: 'Research', profiles: ['default'], messages: [] } });
  const api = new HermesStudioGroupChatApi(client);

  const rooms = await api.listRooms();
  assert.equal(rooms[0]?.id, 'room-1');
  assert.equal(calls[0]?.url, 'https://hermes.test/api/plugins/collaboration/rooms');

  await api.createRoom({
    name: 'New room',
    inviteCode: 'ABC123',
    agents: [{ profile: 'default', agent: 'hermes' }],
    summary: {
      profile: 'default',
      provider: 'openai',
      model: 'gpt-5',
      apiMode: 'chat_completions',
      everyTurns: 20,
    },
    workspace: 'C:/workspace',
  });
  assert.equal(calls[1]?.url, 'https://hermes.test/api/plugins/collaboration/rooms');
  // The completed collaboration contract carries the room configuration the
  // Studio settings modal collects at creation time.
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    name: 'New room',
    profiles: ['default'],
    invite_code: 'ABC123',
    workspace: 'C:/workspace',
    summary: {
      profile: 'default',
      provider: 'openai',
      model: 'gpt-5',
      apiMode: 'chat_completions',
      everyTurns: 20,
    },
  });
});

test('Hermes Studio room detail normalizes collaboration messages and sends hosted turns', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = testClient(calls, (url) => url.endsWith('/messages')
    ? { request_id: 'mobile-1', message: { id: 'mobile-1' } }
    : url.endsWith('/room-1')
      ? {
          room: {
            id: 'room-1',
            name: 'Research',
            profiles: ['default', 'reviewer'],
            conversation_id: 'chat-1',
            message_count: 1,
            messages: [{ id: 'm-1', role: 'assistant', name: 'reviewer', content: 'done', created_at: 123 }],
            hosted_turns: { 'turn-1': { status: 'completed', profiles: ['default'] } },
          },
        }
      : { ok: true });
  const api = new HermesStudioGroupChatApi(client);

  const detail = await api.getRoomDetail('room-1');
  assert.equal(detail.room.conversationId, 'chat-1');
  assert.deepEqual(detail.agents.map((agent) => agent.profile), ['default', 'reviewer']);
  assert.equal(detail.messages[0]?.senderName, 'reviewer');
  assert.equal(detail.messages[0]?.timestamp, 123);
  await api.sendRoomMessage('room-1', 'mobile-1', 'ship it', ['default']);
  assert.equal(calls[1]?.url, 'https://hermes.test/api/plugins/collaboration/rooms/room-1/messages');
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    content: 'ship it',
    profiles: ['default'],
    request_id: 'mobile-1',
    turn_id: 'room-turn-mobile-1',
  });

  const callCount = calls.length;
  const compatibilityHandle = await api.connectRealtime({ userId: 'mobile', userName: 'Mobile' });
  assert.equal(compatibilityHandle.connected, true);
  assert.equal(calls.length, callCount, 'REST compatibility handle must not open a websocket or issue a request');
  compatibilityHandle.disconnect();
  assert.equal(compatibilityHandle.connected, false);
});

test('Hermes Studio room detail forwards bounded pagination parameters', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const api = new HermesStudioGroupChatApi(testClient(calls, () => ({ room: { id: 'room-page', name: 'Paged', messages: [] } })));
  await api.getRoomDetail('room-page', { offset: 150, limit: 150 });
  assert.equal(
    calls[0]?.url,
    'https://hermes.test/api/plugins/collaboration/rooms/room-page?offset=150&limit=150',
  );
});

test('Agent group controller polls room detail and sends without a socket transport', () => {
  const source = readFileSync(
    fileURLToPath(new NodeURL('../src/studio/agent-group/useAgentGroupChatController.ts', import.meta.url)),
    'utf8',
  );
  // Mention-aware sends route server-side; broadcast sends keep the roster.
  assert.match(source, /sendRoomMessage\(roomId, id, content, profiles, undefined, resolvedMentions\)/);
  assert.match(source, /setInterval\(\(\) =>/);
  assert.match(source, /2_500/);
  assert.match(source, /roomActivityTimestamp\(room, existing\.messages\)/);
  assert.doesNotMatch(source, /setSnapshot\(room\.id, \{ \.\.\.existing, room, updatedAt: Date\.now\(\) \}\)/);
  assert.doesNotMatch(source, /new URL\('\/group-chat'|socket\.io-client/);
});

test('Agent room deletion is local-first and duplicate room transcripts stay out of chat history', () => {
  const controller = readSource('src/studio/agent-group/useAgentGroupChatController.ts');
  const conversationIndex = readSource('src/studio/chat/useConversationIndexController.ts');
  const chatModes = readSource('src/studio/chat/useChatFeatureModes.ts');
  const chatView = readSource('src/studio/agent-group/AgentGroupChatView.tsx');
  const stage = controller.indexOf('localStore.stageConversationDeletion(');
  // The replay callback also calls the same API after its local prune. Check
  // the legacy direct-delete branch (the final occurrence), not that callback.
  const remoteDelete = controller.lastIndexOf('studioApi.groupChat.deleteRoom(roomId)');

  assert.ok(stage >= 0);
  assert.ok(remoteDelete < 0 || stage < remoteDelete);
  assert.match(controller, /conversationDeleteReplayService\?\.replay\(ownerEpoch\)/);
  assert.match(controller, /removeRoomFromState\(roomId\)/);
  assert.match(controller, /readPendingConversationDeletionIds\(cacheOwner\)/);
  assert.match(controller, /pendingRoomConversationIdsRef\.current\.has\(conversationId\)/);
  assert.match(controller, /conversation\.source === 'collaboration_room'/);
  assert.match(controller, /cachedRoomProjection/);
  assert.match(controller, /snapshotFromDetail\(\{/);
  assert.match(controller, /queueRoomSnapshotPersistence\(nextSnapshot\)/);
  assert.match(controller, /roomTranscriptFingerprint\(\s*snapshot,\s*roomHistoryCompleteRef\.current\.has\(snapshot\.room\.id\)/s);
  assert.match(controller, /source: 'collaboration_room'/);
  assert.match(conversationIndex, /isOrdinaryChatConversation/);
  assert.match(chatModes, /conversation\.source !== 'collaboration_room'/);
  assert.match(chatModes, /conversation\.id\.startsWith\('chat_room_'/);
  assert.match(chatModes, /sortRoomInfosByActivity\(agentGroupController\.rooms, roomSnapshots\)/);
  assert.doesNotMatch(chatView, /clearRoom\(activeRoom\.room\.id\)/);
  assert.doesNotMatch(chatView, /AgentGroupRoomSettingsModal/);
  assert.doesNotMatch(chatView, /Invite code \(optional\)|Summary provider|Workspace path/);
});

test('Hermes Studio group and workflow clients include upstream membership and schedule contracts', async () => {
  const groupSource = readFileSync(
    fileURLToPath(new NodeURL('../src/api/hermes-studio/group-chat.ts', import.meta.url)),
    'utf8',
  );
  assert.match(groupSource, /api\/plugins\/collaboration/);
  assert.match(groupSource, /RestPollingSocket/);
  assert.doesNotMatch(groupSource, /socket\.io-client|\/api\/hermes\/group-chat/);

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const schedule = { id: 'schedule-1', workflow_id: 'wf-1', schedule: '@daily', timezone: 'UTC', enabled: true, input: null, start_node_ids: [], timeout_ms: null, concurrency_policy: 'skip', misfire_policy: 'skip', last_scheduled_at: null, next_run_at: null, last_run_id: null, last_error: null, created_at: 1, updated_at: 1 };
  const api = new HermesStudioWorkflowsApi(testClient(calls, () => ({ schedules: [schedule], schedule })));
  const schedules = await api.listSchedules('wf-1');
  assert.equal(schedules[0]?.schedule, '@daily');
  await api.createSchedule('wf-1', { schedule: '@daily', timezone: 'Asia/Shanghai', enabled: true });
  await api.updateSchedule('wf-1', 'schedule-1', { enabled: false });
  await api.deleteSchedule('wf-1', 'schedule-1');
  assert.equal(calls[0]?.url, 'https://hermes.test/api/hermes/workflows/wf-1/schedules');
  assert.equal(calls[1]?.init?.method, 'POST');
  assert.equal(calls[2]?.init?.method, 'PATCH');
  assert.equal(calls[3]?.init?.method, 'DELETE');
});

test('Hermes Studio workflow wrapper preserves latest update, run, approval, import, export, and stop routes', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = testClient(calls, (url) => url.includes('/approval') || url.includes('/import/cancel')
    ? { ok: true }
    : url.endsWith('/export')
      ? { format: 'hermes-studio.workflow', version: 1, definition: { name: 'Release', nodes: [], edges: [], viewport: null } }
      : url.endsWith('/import/preview')
        ? { ok: true, preview: { token: 'import-1', digest: 'digest', expiresAt: 1, summary: { name: 'Imported', nodes: 1, edges: 0 } } }
        : url.endsWith('/import/confirm')
          ? { ok: true, workflow: { id: 'wf-imported', name: 'Imported', profile: 'default', nodes: [], edges: [], created_at: 1, updated_at: 1 } }
          : url.includes('/runs/')
    ? { run: { id: 'run-1', workflow_id: 'wf-1', status: 'running', created_at: 1, started_at: 1, finished_at: null, error: null } }
      : url.endsWith('/run')
        ? { ok: true, status: 'accepted' }
        : url.endsWith('/workflows/wf-1') && calls.some((call) => call.init?.method === 'PATCH')
          ? { workflow: { id: 'wf-1', name: 'Release v2', profile: 'default', nodes: [], edges: [], created_at: 1, updated_at: 2 } }
          : { workflows: [{ id: 'wf-1', name: 'Release', profile: 'default', nodes: [], edges: [], created_at: 1, updated_at: 1 }] });
  const api = new HermesStudioWorkflowsApi(client);

  const workflows = await api.list('default');
  assert.equal(workflows[0]?.id, 'wf-1');
  assert.equal(calls[0]?.url, 'https://hermes.test/api/hermes/workflows?profile=default');
  await api.update('wf-1', { name: 'Release v2' });
  assert.equal(calls[1]?.init?.method, 'PATCH');
  await api.run('wf-1', { start_node_ids: ['node-1'], input: 'ship it', timeout_ms: 60_000 });
  assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), { start_node_ids: ['node-1'], input: 'ship it', timeout_ms: 60_000 });
  await api.approveNode('wf-1', 'run-1', 'node-1', true, 'execution-1');
  assert.match(calls[3]?.url || '', /runs\/run-1\/nodes\/node-1\/approval$/);
  await api.export('wf-1');
  const preview = await api.previewImport('{"name":"Imported"}', 'default');
  assert.equal(preview.token, 'import-1');
  await api.confirmImport(preview.token, 'default');
  await api.cancelImport(preview.token, 'default');
  await api.stopRun('wf-1', 'run-1');
  assert.equal(calls.at(-1)?.url, 'https://hermes.test/api/hermes/workflows/wf-1/runs/run-1/stop');
});

test('optional Hermes Studio workflow capability reports a missing companion service', async () => {
  const client = new HermesApiClient('https://hermes.test', 'token', async () => new Response(
    JSON.stringify({ detail: 'Not Found' }),
    { headers: { 'Content-Type': 'application/json' }, status: 404 },
  ));
  const api = new HermesStudioWorkflowsApi(client);

  assert.deepEqual(await api.probe('default'), { available: false, workflows: [] });
});

test('Hermes Studio workflow socket replays subscriptions after Socket.IO reconnects', () => {
  const source = readFileSync(
    fileURLToPath(new NodeURL('../src/api/hermes-studio/workflow-socket.ts', import.meta.url)),
    'utf8',
  );
  assert.match(source, /socket\.on\('connect'/);
  assert.match(source, /replaySubscriptions\(socket\)/);
  assert.match(source, /desiredSubscriptions/);
  assert.match(source, /workflow\.status\.subscribe/);
  assert.match(source, /auth: \(callback\)/);
  assert.doesNotMatch(source, /socket\.io\.on\('reconnect_attempt'/);
  assert.match(source, /response\?\.ok/);
});

test('Agent group event updates are room-scoped and stream deltas are idempotent', () => {
  const roomA = emptyRoomSnapshot({ id: 'a', name: 'A', inviteCode: null });
  const roomB = emptyRoomSnapshot({ id: 'b', name: 'B', inviteCode: null });
  const message = {
    id: 'stream-1',
    roomId: 'a',
    senderId: 'agent-1',
    senderName: 'Planner',
    content: '',
    timestamp: 1,
    isStreaming: true,
  };

  const afterStart = applyAgentGroupEvent(roomA, { type: 'stream-start', message });
  const afterDelta = applyAgentGroupEvent(afterStart, { type: 'stream-delta', roomId: 'a', id: 'stream-1', delta: 'hello' });
  const afterDuplicate = applyAgentGroupEvent(afterDelta, { type: 'message', message: { ...message, content: 'hello' } });
  const untouched = applyAgentGroupEvent(roomB, { type: 'stream-delta', roomId: 'a', id: 'stream-1', delta: 'wrong room' });

  assert.equal(afterDuplicate.messages.length, 1);
  assert.equal(afterDuplicate.messages[0]?.content, 'hello');
  assert.equal(afterDuplicate.runningAgents[0], 'Planner');
  assert.equal(untouched.messages.length, 0);
});

test('room snapshots merge REST history without dropping optimistic messages', () => {
  const base = snapshotFromDetail({
    room: { id: 'room', name: 'Room', inviteCode: null },
    agents: [],
    members: [],
    messages: [{ id: 'one', roomId: 'room', senderId: 'u', senderName: 'U', content: 'old', timestamp: 1 }],
  });
  const optimistic = upsertGroupMessage(base.messages, {
    id: 'two', roomId: 'room', senderId: 'u', senderName: 'U', content: 'new', timestamp: 2,
  });
  const merged = upsertGroupMessage(optimistic, base.messages[0]!);
  assert.deepEqual(merged.map((message) => message.id), ['one', 'two']);
  assert.equal(merged[1]?.content, 'new');
});

test('cached Studio hydration upgrades a summary while preserving live messages', () => {
  const cached = snapshotFromDetail({
    room: { id: 'room-cache', name: 'Cached', inviteCode: null },
    agents: [],
    members: [],
    messages: [
      { id: 'm-1', roomId: 'room-cache', senderId: 'agent', senderName: 'Agent', content: 'full transcript reply', timestamp: 10 },
      { id: 'm-2', roomId: 'room-cache', senderId: 'agent', senderName: 'Agent', content: 'second reply', timestamp: 11 },
    ],
  });
  const live = {
    ...snapshotFromDetail({
      room: { id: 'room-cache', name: 'Cached', inviteCode: null },
      agents: [],
      members: [],
      messages: [{ id: 'm-1', roomId: 'room-cache', senderId: 'agent', senderName: 'Agent', content: 'full', timestamp: 10 }],
    }),
    connected: true,
    messages: [
      { id: 'm-1', roomId: 'room-cache', senderId: 'agent', senderName: 'Agent', content: 'full', timestamp: 10 },
      { id: 'local-pending', roomId: 'room-cache', senderId: 'user', senderName: 'You', content: 'send me', timestamp: 12, deliveryStatus: 'pending' as const },
    ],
  };
  const mergedMessages = mergeRoomHistoryMessages(cached.messages, live.messages);
  assert.deepEqual(mergedMessages.map(({ id }) => id), ['m-1', 'm-2', 'local-pending']);
  assert.equal(mergedMessages[0]?.content, 'full transcript reply');
  assert.equal(mergedMessages[2]?.deliveryStatus, 'pending');
  const merged = mergeCachedRoomSnapshot(cached, live);
  assert.equal(merged.connected, true);
  assert.deepEqual(merged.messages.map(({ id }) => id), ['m-1', 'm-2', 'local-pending']);
});

test('REST terminal status clears a stale local streaming flag', () => {
  const authoritative = [{
    id: 'reply', roomId: 'room', senderId: 'agent', senderName: 'Agent',
    content: 'complete answer', timestamp: 20, persistedAt: 20,
    role: 'assistant', isStreaming: false, finish_reason: 'stop' as const,
  }];
  const staleLive = [{
    id: 'reply', roomId: 'room', senderId: 'agent', senderName: 'Agent',
    content: 'complete', timestamp: 20, persistedAt: 19,
    role: 'assistant', isStreaming: true,
  }];
  const merged = mergeRoomHistoryMessages(authoritative, staleLive);
  assert.equal(merged[0]?.isStreaming, false);
  assert.equal(merged[0]?.finish_reason, 'stop');
});

test('REST terminal status wins over an old optimistic pending copy', () => {
  const authoritative = [{
    id: 'reply-pending', roomId: 'room', senderId: 'agent', senderName: 'Agent',
    content: 'complete answer', timestamp: 20, persistedAt: 20,
    role: 'assistant', isStreaming: false, finish_reason: 'stop' as const,
  }];
  const stalePending = [{
    id: 'reply-pending', roomId: 'room', senderId: 'user', senderName: 'You',
    content: 'complete answer', timestamp: 20, persistedAt: 19,
    role: 'user', deliveryStatus: 'pending' as const, isStreaming: true,
  }];
  const merged = mergeRoomHistoryMessages(authoritative, stalePending);
  assert.equal(merged[0]?.isStreaming, false);
  assert.equal(merged[0]?.deliveryStatus, undefined);
});

test('REST terminal status wins even when the stale local stream has a newer timestamp', () => {
  const authoritative = [{
    id: 'reply-newer-local', roomId: 'room', senderId: 'agent', senderName: 'Agent',
    content: 'complete answer', timestamp: 20, persistedAt: 20,
    role: 'assistant', isStreaming: false, finish_reason: 'stop' as const,
  }];
  const staleNewerLive = [{
    id: 'reply-newer-local', roomId: 'room', senderId: 'agent', senderName: 'Agent',
    content: 'complete answer', timestamp: 30, persistedAt: 30,
    role: 'assistant', deliveryStatus: 'pending' as const, isStreaming: true,
  }];

  const merged = mergeRoomHistoryMessages(authoritative, staleNewerLive);
  assert.equal(merged[0]?.timestamp, 30);
  assert.equal(merged[0]?.isStreaming, false);
  assert.equal(merged[0]?.deliveryStatus, undefined);
  assert.equal(merged[0]?.finish_reason, 'stop');
});

test('REST room snapshots retain hosted-turn runtime status after polling', () => {
  const room = {
    id: 'room-runtime',
    name: 'Runtime room',
    inviteCode: null,
    hostedTurns: {
      'turn-1': {
        status: 'running',
        profiles: ['default', 'reviewer'],
        updated_at: 100,
        active_roles: {
          worker: { profile: 'default', status: 'running' },
        },
      },
    },
  };
  assert.deepEqual(roomRuntimeProjection(room), {
    contextStatuses: { default: 'running' },
    runningAgents: ['default'],
  });
  const snapshot = snapshotFromDetail({
    room,
    agents: [],
    members: [],
    messages: [],
    connected: true,
  });
  assert.deepEqual(snapshot.runningAgents, ['default']);
  assert.equal(snapshot.contextStatuses.default, 'running');

  const settled = snapshotFromDetail({
    room: {
      ...room,
      hostedTurns: {
        'turn-1': { status: 'completed', profiles: ['default'], updated_at: 200 },
      },
    },
    agents: [],
    members: [],
    messages: [],
    connected: true,
  });
  assert.deepEqual(settled.runningAgents, []);
});

test('room recency uses durable activity and keeps synthetic room order stable', () => {
  const rooms = [
    { id: 'old', name: 'Old', inviteCode: null, createdAt: 100, lastActiveAt: 200 },
    { id: 'new', name: 'New', inviteCode: null, createdAt: 100, lastActiveAt: 300 },
    { id: 'unknown', name: 'Unknown', inviteCode: null },
  ];
  assert.equal(roomActivityTimestamp(rooms[0]!, [{ timestamp: 250 }]), 250);
  assert.equal(roomActivityTimestamp(rooms[1]!, [{ timestamp: 250 }]), 300);
  assert.deepEqual(sortRoomInfosByActivity(rooms).map((room) => room.id), ['new', 'old', 'unknown']);

  const snapshot = snapshotFromDetail({
    room: rooms[0]!,
    agents: [],
    members: [],
    messages: [{
      id: 'message-1',
      roomId: 'old',
      senderId: 'agent',
      senderName: 'Agent',
      content: 'cached reply',
      timestamp: 250,
    }],
  });
  assert.equal(snapshot.updatedAt, 250);
});

test('Agent group workspace diff tool rows attach to their assistant parent', () => {
  const attached = attachWorkspaceDiffs([
    { id: 'assistant-1', roomId: 'room', senderId: 'agent', senderName: 'Builder', content: 'Done', timestamp: 1, role: 'assistant' },
    { id: 'tool-1', roomId: 'room', senderId: 'agent', senderName: 'Builder', content: JSON.stringify({ kind: 'workspace_diff', run_id: 'run-1', parent_message_id: 'assistant-1', files: [{ id: 1, path: 'README.md', additions: 2, deletions: 1 }] }), timestamp: 2, role: 'tool', tool_name: 'workspace_diff' },
  ]);
  assert.equal(attached.length, 1);
  assert.equal(attached[0]?.workspaceChanges?.[0]?.files[0]?.path, 'README.md');
});

test('Agent group renderer stays separate from ordinary chat presentation', () => {
  const source = readFileSync(fileURLToPath(new NodeURL('../src/studio/agent-group/AgentGroupMessageStream.tsx', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /ChatMessageStream/);
  assert.match(source, /groupAgentRunMessages/);
  assert.match(source, /toolDetails/);
  assert.match(source, /SummaryAnchorDivider/);
});

function testClient(
  calls: Array<{ url: string; init?: RequestInit }>,
  responseFor: (url: string) => unknown,
): HermesApiClient {
  return new HermesApiClient(
    'https://hermes.test',
    'test-token',
    async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      return new Response(JSON.stringify(responseFor(url)), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    },
  );
}

test('Agent group send routes structured mentions and omits the broadcast roster', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = testClient(calls, () => ({ request_id: 'm-1', message: { id: 'm-1' } }));
  const api = new HermesStudioGroupChatApi(client);

  await api.sendRoomMessage('room-1', 'm-1', '@pc-worker 请检查部署', [], undefined, [
    { type: 'agent', participantId: 'pc-worker', displayName: 'PC Worker' },
  ]);
  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(body.profiles, undefined);
  assert.deepEqual(body.mentions, [
    { type: 'agent', participantId: 'pc-worker', displayName: 'PC Worker' },
  ]);

  await api.sendRoomMessage('room-1', 'm-2', '广播一条', ['default']);
  const broadcast = JSON.parse(String(calls[1]?.init?.body));
  assert.deepEqual(broadcast.profiles, ['default']);
  assert.equal(broadcast.mentions, undefined);
});

test('Agent group retraction, typing, join, and roster calls hit the completed room API', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = testClient(calls, (url) => url.endsWith('/rooms/room-1/agents')
    ? { agent: { id: 'a-1', profile: 'reviewer', name: '评审员' } }
    : { success: true, ok: true, room: { id: 'room-1', name: 'R', profiles: ['default'] }, agents: [], members: [] });
  const api = new HermesStudioGroupChatApi(client);

  await api.retractMessage('room-1', 'msg-9');
  assert.equal(calls[0]?.url, 'https://hermes.test/api/plugins/collaboration/rooms/room-1/messages/msg-9');
  assert.equal(calls[0]?.init?.method, 'DELETE');

  const socket = await api.connectRealtime({ userId: 'u1', userName: 'Given' });
  api.emitTyping(socket, 'room-1');
  await new Promise((resolve) => setTimeout(resolve, 10));
  const typingCall = calls.find((call) => call.url.endsWith('/rooms/room-1/typing'));
  assert.ok(typingCall, 'typing POST recorded');
  assert.equal(JSON.parse(String(typingCall?.init?.body)).state, 'start');
  socket.disconnect();

  await api.joinRoomByCode('JOIN123');
  const joinCall = calls.find((call) => call.url.endsWith('/rooms/join'));
  assert.deepEqual(JSON.parse(String(joinCall?.init?.body)), { invite_code: 'JOIN123' });

  await api.addAgent('room-1', { profile: 'reviewer', name: '评审员' });
  const addCall = calls.find((call) => call.url.endsWith('/rooms/room-1/agents') && call.init?.method === 'POST');
  assert.deepEqual(JSON.parse(String(addCall?.init?.body)), { profile: 'reviewer', name: '评审员', description: '' });

  await api.updateInviteCode('room-1', 'NEWCODE1');
  const codeCall = calls.find((call) => call.url.endsWith('/rooms/room-1/invite-code'));
  assert.deepEqual(JSON.parse(String(codeCall?.init?.body)), { invite_code: 'NEWCODE1' });
});

test('Agent group socket streams hosted-event frames as message events', async () => {
  const envelope = {
    account_generation: 'gen-1',
    conversation: {
      id: 'chat_room_1',
      profile: 'default',
      title: 'R',
      account_generation: 'gen-1',
      messages: [
        { id: 'm-1', role: 'user', name: 'User', content: 'hello', created_at: 1 },
        { id: 'm-2', role: 'assistant', name: 'default', content: 'done', created_at: 2 },
      ],
    },
    cursor: 5,
    events: [],
    has_gap: false,
    min_cursor: 1,
    reset_cursor: false,
    snapshot_cursor: 5,
  };
  const frame = `id: 5\nevent: conversation\ndata: ${JSON.stringify(envelope)}\n\n`;
  const sseResponse = () => new Response(frame, {
    headers: { 'Content-Type': 'text/event-stream' },
    status: 200,
  });
  const sseClient = new HermesApiClient(
    'https://hermes.test',
    'test-token',
    async () => sseResponse(),
    sseResponse as unknown as typeof fetch,
  );
  const api = new HermesStudioGroupChatApi(sseClient);
  const socket = await api.connectRealtime({ userId: 'u1', userName: 'Given' });

  const delivered: Array<Record<string, unknown>> = [];
  const wakes: string[] = [];
  socket.on('message', (payload: Record<string, unknown>) => delivered.push(payload));
  socket.on('room_updated', (payload: { roomId?: string }) => wakes.push(String(payload?.roomId)));
  socket.attachRoomStream?.({
    id: 'room-1',
    conversationId: 'chat_room_1',
    accountGeneration: 'gen-1',
  });

  await new Promise((resolve) => setTimeout(resolve, 120));
  socket.disconnect();

  assert.ok(delivered.length >= 2, `expected streamed messages, got ${delivered.length}`);
  assert.deepEqual(delivered.map((message) => message.id).slice(0, 2), ['m-1', 'm-2']);
  assert.ok(delivered.every((message) => message.roomId === 'room-1'));
  assert.ok(wakes.includes('room-1'));
});

test('remote deletion tombstones drop cached conversations instead of preserving them', async () => {
  const { synchronizeConversationCache } = await import('../src/api/conversation-cache-sync');
  const { HermesApiClient } = await import('../src/api/HermesApiClient');
  const calls: string[] = [];
  const summary = (id: string) => ({
    id,
    title: id,
    profile: 'default',
    message_count: 0,
    messages: [],
    updated_at: 1,
  });
  const client = new HermesApiClient(
    'https://hermes.test',
    'test-token',
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/single/conversations/' + encodeURIComponent('kept-1'))) {
        return new Response(JSON.stringify({ conversation: {
          ...summary('kept-1'),
          messages: [{ id: 'm1', role: 'user', content: 'hi', created_at: 1 }],
          message_count: 1,
        } }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
      }
      if (url.endsWith('/single/conversations')) {
        return new Response(JSON.stringify({
          conversations: [summary('kept-1')],
          deleted: ['deleted-elsewhere'],
        }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
      }
      return new Response(JSON.stringify({ conversation: {
        ...summary('kept-1'),
        messages: [{ id: 'm1', role: 'user', content: 'hi', created_at: 1 }],
        message_count: 1,
      } }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
    },
  );
  const written: unknown[] = [];
  const store = {
    beginSynchronization: () => 1,
    read: async () => ({
      version: 1,
      owner: 'owner',
      activeConversationId: 'deleted-elsewhere',
      conversations: [
        { ...summary('deleted-elsewhere'), messages: [{ id: 'old', role: 'user', content: 'x', created_at: 1 }] },
        { ...summary('kept-1') },
      ],
      syncedAt: 0,
    }),
    readPendingConversationDeletionIds: async () => new Set<string>(),
    writeSynchronized: async (_owner: string, _generation: number, conversations: unknown) => {
      written.push(conversations);
      return true;
    },
  };
  // Minimal API stand-in: importing the real facade pulls react-native into
  // the node test runtime. The sync contract only needs these two calls.
  const api = {
    getUnifiedConversations: async () => {
      const response = await client.request<{ conversations: unknown[]; deleted?: string[] }>(
        '/api/plugins/collaboration/single/conversations',
      );
      return {
        conversations: response.conversations as never[],
        deleted: response.deleted || [],
      };
    },
    getConversation: async (id: string) => {
      const response = await client.request<{ conversation: unknown }>(
        `/api/plugins/collaboration/single/conversations/${encodeURIComponent(id)}`,
      );
      return { conversation: response.conversation };
    },
  };
  const snapshot = await synchronizeConversationCache(
    api as unknown as Parameters<typeof synchronizeConversationCache>[0],
    store as unknown as Parameters<typeof synchronizeConversationCache>[1],
    'owner',
  );
  const ids = snapshot.conversations.map((conversation: { id: string }) => conversation.id);
  assert.ok(!ids.includes('deleted-elsewhere'), 'remotely deleted conversation must be dropped');
  assert.ok(ids.includes('kept-1'), 'live conversation must survive');
  assert.equal(snapshot.activeConversationId, 'kept-1', 'active falls back after deletion');
},);

test('session entries paginate to the leaf on full pages', async () => {
  const { fetchSessionEntriesToLeaf, SESSION_ENTRIES_PAGE_SIZE } = await import('../src/studio/chat/fetchSessionEntriesToLeaf');
  const requestedCursors: number[] = [];
  let page = 0;
  const pages = [
    { cursor: 2000, entries: Array.from({ length: SESSION_ENTRIES_PAGE_SIZE }, (_, i) => ({ cursor: i + 1 })) },
    { cursor: 3000, entries: Array.from({ length: SESSION_ENTRIES_PAGE_SIZE }, (_, i) => ({ cursor: 2001 + i })) },
    { cursor: 3050, entries: Array.from({ length: 50 }, (_, i) => ({ cursor: 4001 + i })) },
  ];
  const cloudApi = {
    getConversationSessionEntries: async (_id: string, cursor: number) => {
      requestedCursors.push(cursor);
      const response = pages[page] ?? pages[pages.length - 1];
      page += 1;
      return {
        schema_version: 'hermes.session-entry.v1',
        account_generation: 'gen',
        cursor: response.cursor,
        reset_cursor: false,
        reset_reason: '',
        leaf_entry_id: '',
        entries: response.entries,
      };
    },
  };
  const result = await fetchSessionEntriesToLeaf(cloudApi as never, 'chat-1', 0);
  assert.deepEqual(requestedCursors, [0, 2000, 3000]);
  assert.equal(result?.entries.length, SESSION_ENTRIES_PAGE_SIZE * 2 + 50);
  assert.equal(result?.cursor, 3050);
});
