import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { HermesApiClient } from '../src/api/HermesApiClient';
import { HermesStudioGroupChatApi } from '../src/api/hermes-studio/group-chat';
import { HermesStudioWorkflowsApi } from '../src/api/hermes-studio/workflows';
import {
  applyAgentGroupEvent,
  emptyRoomSnapshot,
  snapshotFromDetail,
  upsertGroupMessage,
} from '../src/studio/agent-group/agent-group-model';

test('Hermes Studio group-chat normalizes rooms and keeps its endpoint namespace', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = testClient(calls, () => calls.length === 1
    ? { rooms: [{ id: 'room-1', name: 'Research', inviteCode: null }] }
    : { room: { id: 'room-1', name: 'Research' }, agents: [], members: [], messages: [] });
  const api = new HermesStudioGroupChatApi(client);

  const rooms = await api.listRooms();
  assert.equal(rooms[0]?.id, 'room-1');
  assert.equal(calls[0]?.url, 'https://hermes.test/api/hermes/group-chat/rooms');

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
  assert.equal(calls[1]?.url, 'https://hermes.test/api/hermes/group-chat/rooms');
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
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
});

test('Hermes Studio room settings preserve latest config, summary, and workspace routes', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = testClient(calls, (url) => url.endsWith('/summary')
    ? { summary: { roomId: 'room-1', summary: 'context', status: 'success' }, anchor: null }
    : url.endsWith('/workspace-files/list')
      ? { entries: [], path: '' }
      : url.endsWith('/agents') || url.includes('/agents/')
        ? { agent: { id: 'agent-1', roomId: 'room-1', agentId: 'agent-1', agent: 'hermes', profile: 'default', name: 'Planner' }, agents: [], members: [] }
        : { room: { id: 'room-1', name: 'Renamed', inviteCode: 'XYZ789', workspace: 'D:/repo' } });
  const api = new HermesStudioGroupChatApi(client);

  await api.updateRoomConfig('room-1', {
    name: 'Renamed',
    summaryProfile: 'default',
    summaryProvider: 'openai',
    summaryModel: 'gpt-5',
    summaryApiMode: 'chat_completions',
    summaryEveryTurns: 30,
  });
  await api.updateInviteCode('room-1', 'XYZ789');
  await api.updateRoomWorkspace('room-1', 'D:/repo');
  await api.getRoomSummary('room-1');
  await api.addAgent('room-1', { agent: 'hermes', profile: 'default', provider: 'openai', model: 'gpt-5', avatar: 'A' });
  await api.listWorkspaceFiles('room-1');

  assert.equal(calls[0]?.init?.method, 'PUT');
  assert.match(calls[0]?.url || '', /\/config$/);
  assert.equal(calls[1]?.init?.method, 'PUT');
  assert.match(calls[1]?.url || '', /\/invite-code$/);
  assert.match(calls[3]?.url || '', /\/summary$/);
  assert.match(calls[4]?.url || '', /\/agents$/);
  assert.match(calls[5]?.url || '', /workspace-files\/list$/);
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
