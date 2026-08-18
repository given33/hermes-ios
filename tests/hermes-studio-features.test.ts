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
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    name: 'New room',
    profiles: ['default'],
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
  assert.match(source, /sendRoomMessage\(roomId, id, content, profiles\)/);
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

test('Hermes Studio workflow socket replays subscriptions after Socket.IO reconnects', () => {
  const source = readFileSync(
    fileURLToPath(new NodeURL('../src/api/hermes-studio/workflow-socket.ts', import.meta.url)),
    'utf8',
  );
  assert.match(source, /socket\.on\('connect'/);
  assert.match(source, /replaySubscriptions\(socket\)/);
  assert.match(source, /desiredSubscriptions/);
  assert.match(source, /workflow\.status\.subscribe/);
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
