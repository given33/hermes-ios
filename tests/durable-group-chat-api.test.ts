import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HermesDurableGroupChatCloudApi } from '../src/api/cloud/durable-group-chat';
import type { HermesCloudTransport } from '../src/api/cloud/transport';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function transportFor(calls: Array<Record<string, unknown>>): HermesCloudTransport {
  return {
    consumeDownload: async () => { throw new Error('unused'); },
    download: async () => { throw new Error('unused'); },
    openEventStream: async () => { throw new Error('unused'); },
    openWebSocket: async () => { throw new Error('unused'); },
    request: async (path, options) => {
      calls.push({ kind: 'request', path, options });
      if (path.endsWith('/gateways')) return { gateways: [], execution_nodes: [] };
      if (path.endsWith('/rooms')) return { rooms: [] };
      return { room_id: 'mobile-group-room', disbanded: true };
    },
    json: async (path, method, body) => {
      calls.push({ kind: 'json', path, method, body });
      return { room: { room_id: 'mobile-group-room' } };
    },
  } as HermesCloudTransport;
}

test('durable Group Chat cloud API maps the owner-mobile protocol without privileged credentials', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const api = new HermesDurableGroupChatCloudApi(transportFor(calls));

  await api.listRooms();
  await api.listGateways();
  await api.createRoom({
    idempotencyKey: 'create-room-001',
    name: 'Release discussion',
    members: [{ memberId: 'default', profile: 'default', handle: 'hermes', displayName: 'Hermes' }],
  });
  await api.listEvents('mobile-group-room', { sinceSeq: 4, limit: 20 });
  await api.sendMessage('mobile-group-room', {
    idempotencyKey: 'send-room-001',
    text: 'inspect the build',
    threadId: 'mobile-thread-1',
  });
  await api.deleteRoom('mobile-group-room');

  assert.deepEqual(calls[0], {
    kind: 'request',
    path: '/api/plugins/collaboration/mobile/group-chat/rooms',
    options: { signal: undefined },
  });
  assert.deepEqual(calls[1], {
    kind: 'request',
    path: '/api/plugins/collaboration/mobile/group-chat/gateways',
    options: { signal: undefined },
  });
  assert.deepEqual(calls[2], {
    kind: 'json',
    path: '/api/plugins/collaboration/mobile/group-chat/rooms',
    method: 'POST',
    body: {
      idempotency_key: 'create-room-001',
      name: 'Release discussion',
      members: [{ member_id: 'default', profile: 'default', handle: 'hermes', display_name: 'Hermes' }],
    },
  });
  assert.deepEqual(calls[3], {
    kind: 'request',
    path: '/api/plugins/collaboration/mobile/group-chat/rooms/mobile-group-room/events',
    options: { query: { since_seq: 4, limit: 20 }, signal: undefined },
  });
  assert.equal(calls.at(-1)?.path, '/api/plugins/collaboration/mobile/group-chat/rooms/mobile-group-room');
  const source = JSON.stringify(calls);
  assert.doesNotMatch(source, /API_SERVER_KEY|HermesRoom|\/v1\/runs/);
});

test('durable Group Chat gateway catalog maps remote member targets while local members stay compatible', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const api = new HermesDurableGroupChatCloudApi(transportFor(calls));

  await api.listGateways();
  await api.createRoom({
    idempotencyKey: 'create-cross-gateway-001',
    name: 'Cross gateway review',
    members: [
      { memberId: 'default', profile: 'default', handle: 'hermes' },
      { memberId: 'edge/profile', profile: 'profile', handle: 'profile', gatewayId: 'edge' },
    ],
  });

  assert.deepEqual(calls[0], {
    kind: 'request',
    path: '/api/plugins/collaboration/mobile/group-chat/gateways',
    options: { signal: undefined },
  });
  assert.deepEqual((calls[1] as { body: { members: unknown[] } }).body.members, [
    { member_id: 'default', profile: 'default', handle: 'hermes' },
    { member_id: 'edge/profile', profile: 'profile', handle: 'profile', gateway_id: 'edge' },
  ]);
});

test('durable Group Chat UI uses bounded virtualized replay and lifecycle fences', () => {
  const source = readFileSync(
    resolve(projectRoot, 'src/studio/durable-group-chat/DurableGroupChatPage.tsx'),
    'utf8',
  );
  const apiSource = readFileSync(
    resolve(projectRoot, 'src/api/cloud/durable-group-chat.ts'),
    'utf8',
  );

  assert.match(source, /const cursorRef = useRef\(0\)/);
  assert.match(source, /const activeRequestRef = useRef\(0\)/);
  assert.match(source, /sinceSeq: append \? cursorRef\.current : 0/);
  assert.match(source, /requestId !== activeRequestRef\.current/);
  assert.match(source, /new Set\(current\.map\(\(event\) => event\.seq\)\)/);
  assert.match(source, /const roomsRequestRef = useRef\(0\)/);
  assert.match(source, /getDurableGroupChatGateways/);
  assert.match(source, /parseDurableGroupChatMember/);
  assert.match(source, /gateway\/profile/);
  assert.match(source, /gatewayId/);
  assert.match(source, /gateway_id/);
  assert.match(source, /durableMemberLabel/);
  assert.match(source, /target\?\.kind === 'peer'/);
  assert.match(source, /target\?\.peer_id/);
  assert.match(source, /target\?\.installation_id/);
  assert.match(source, /Available gateways \/ devices/);
  assert.match(source, /executionNodes/);
  assert.match(source, /connector-only \/ 仅执行节点不可作为 RoomLink gateway/);
  assert.match(source, /connectorOnlyGatewayIds/);
  assert.match(apiSource, /target\?: DurableGroupChatMemberTarget/);
  assert.match(apiSource, /kind: 'local' \| 'peer'/);
  assert.match(apiSource, /peer_id\?: string/);
  assert.match(apiSource, /installation_id\?: string/);
  assert.match(apiSource, /execution_nodes: DurableGroupChatExecutionNode\[\]/);
  assert.match(apiSource, /kind: 'connector_only'/);
  assert.match(apiSource, /room_member_supported: false/);
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.match(source, /AppState\.addEventListener\('change'/);
  assert.match(source, /activePollTimerRef\.current = setTimeout/);
  assert.match(source, /page\.has_more/);
  assert.match(source, /slice\(-MAX_VISIBLE_EVENTS\)/);
  assert.match(source, /<FlatList/);
  assert.doesNotMatch(source, /<ScrollView/);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.match(source, /selectedRoomRef\.current === roomId\) await refreshActiveRoom/);
  assert.match(source, /<ConfirmDialog/);
  assert.doesNotMatch(source, /setCursor\(/);
});
