import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// This is a deliberately small release-critical inventory rather than a
// mirror of every desktop-only administrator endpoint.  The test protects
// the mobile contract from upstream drift: if one of these official routes
// is renamed or removed from the iOS domain modules, the build fails before a
// user discovers a blank/non-functional Hermes screen.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

const apiSources = [
  'src/api/HermesApiClient.ts',
  'src/api/HermesCloudApi.ts',
  'src/api/HermesCloudApiSurface.ts',
  'src/api/cloud/audio.ts',
  'src/api/cloud/collaboration.ts',
  'src/api/cloud/console.ts',
  'src/api/cloud/conversations.ts',
  'src/api/cloud/cron.ts',
  'src/api/cloud/durable-group-chat.ts',
  'src/api/cloud/extensions.ts',
  'src/api/cloud/files.ts',
  'src/api/cloud/management.ts',
  'src/api/cloud/memory.ts',
  'src/api/cloud/models.ts',
  'src/api/cloud/operations.ts',
  'src/api/cloud/sessions.ts',
  'src/api/cloud/workflows.ts',
  'src/auth/mobile-auth.ts',
  'src/notifications/mobile-notifications.ts',
].map(read).join('\n');

test('iOS release-critical API surface remains connected to official backend routes', () => {
  const requiredRouteFragments = [
    // Authentication and the ticket used by every native WebSocket.
    '/api/mobile/v1/handshake',
    '/api/auth/ws-ticket',
    '/auth/mobile/register',
    '/auth/mobile/token',
    '/auth/mobile/refresh',
    '/api/mobile/v1/devices',

    // Canonical hosted chat, replay, attachment, and low-latency events.
    '/single/conversations',
    '/hosted-events-ws',
    '/single/conversations/${encodeURIComponent(conversationId)}/enqueue',
    '/single/conversations/${encodeURIComponent(conversationId)}/attachments',
    '/mobile/conversations/',
    '/mobile/runtime-runs',
    '/mobile/write-approvals',

    // Official Bot Mode and worker-room surfaces.
    '/api/bots',
    '/canonical-chat',
    '/assets/avatar',
    '/api/bot-mode/relay/send',
    '/rooms',
    '/events',

    // Owner-mobile bridge for official durable Group Chat.
    '/api/plugins/collaboration/mobile/group-chat',

    // Main user-facing capability groups.
    '/api/model/info',
    '/api/model/options',
    '/api/model/set',
    '/api/providers/custom-endpoints',
    '/api/providers/custom-endpoints/validate',
    '/api/memory',
    '/api/skills',
    '/api/mcp/servers',
    '/api/files',
    '${COLLABORATION}/files',
    '/api/cron/jobs',
    '/definitions',
    '/api/audio/transcribe',
    '/api/audio/voice-config',
    '/api/audio/elevenlabs/voices',
    '/api/audio/speak',
    '/api/audio/speak-stream',
  ];

  for (const fragment of requiredRouteFragments) {
    assert.ok(
      apiSources.includes(fragment),
      `iOS facade lost release-critical backend route fragment: ${fragment}`,
    );
  }

  assert.doesNotMatch(
    apiSources,
    /\/api\/model\/custom(?:\/|['"`])/,
    'iOS must use the canonical custom-provider endpoints exposed by Hermes',
  );
});

test('iOS chat transport keeps WebSocket first with an SSE fallback', () => {
  const stream = read('src/studio/chat/useHostedConversationStream.ts');
  assert.match(stream, /consumeHostedConversationEventsWebSocket/);
  assert.match(stream, /consumeSse/);
  assert.match(stream, /fall back to the existing SSE implementation/);
  const events = read('src/api/hosted-conversation-events.ts');
  assert.match(events, /Install all handlers before sending the subscription/);
});

test('iOS Agent Rooms keep WebSocket first with SSE and polling fallbacks', () => {
  const groupTransport = read('src/api/hermes-studio/group-chat.ts');
  assert.match(groupTransport, /consumeHostedConversationEventsWebSocket/);
  assert.match(groupTransport, /hosted-events-ws/);
  assert.match(groupTransport, /consumeHostedConversationEvents/);
  const controller = read('src/studio/agent-group/useAgentGroupChatController.ts');
  assert.match(controller, /hasHealthyRoomStream/);
  assert.match(controller, /setInterval\(\(\) =>/);
  assert.match(controller, /2_500/);
});

test('iOS does not embed privileged official API-server credentials', () => {
  // The upstream durable Group Chat API deliberately separates a gateway-wide
  // Bearer key from short-lived HermesRoom grants. Mobile account credentials
  // are neither of those capabilities, so client code must never manufacture
  // or ship either authorization form while a server-side mobile bridge is
  // still required.
  assert.doesNotMatch(
    apiSources,
    /\bAPI_SERVER_KEY\b|Authorization\s*:\s*['"`]?HermesRoom\b|['"`]\/v1\/(?:runs|room-members)/,
    'iOS must use an authenticated mobile backend bridge rather than expose API-server or room-grant authority',
  );
});
