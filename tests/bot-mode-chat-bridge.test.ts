import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { HermesApiClient, HermesRequestOptions } from '../src/api/HermesApiClient';
import { HermesCloudApi } from '../src/api/HermesCloudApi';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(projectRoot, path), 'utf8');

test('Bot canonical chat uses the official idempotent mobile endpoint', async () => {
  const calls: Array<{ options: HermesRequestOptions; path: string }> = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ options, path });
      return Promise.resolve({
        canonical_session: { id: 'bot-root', resolved_id: 'bot-tip' },
        profile: 'hk-worker',
        session_id: 'bot-root',
      } as T);
    },
  } as HermesApiClient;

  const result = await new HermesCloudApi(client).ensureBotCanonicalChat('hk worker');

  assert.equal(result.session_id, 'bot-root');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/bots/hk%20worker/canonical-chat');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {});
});

test('native Bot actions open canonical chat and reuse Agent Rooms', () => {
  const actions = read('src/app/swiftui-route-actions.generated.ts');
  const pages = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const app = read('src/studio/FrontendPreviewApp.tsx');
  const conversationApi = read('src/api/cloud/conversations.ts');

  assert.match(actions, /botChatOpen: 'bot\.chat\.open'/);
  assert.match(actions, /botGroupsOpen: 'bot\.groups\.open'/);
  assert.match(pages, /onAction\(\s*\.botChatOpen/);
  assert.match(pages, /onAction\(\s*\.botGroupsOpen/);
  assert.match(pages, /Group chats/);
  assert.match(app, /ensureBotCanonicalChat\(botProfile\)/);
  assert.match(app, /officialConversationPlaceholderId\(ownerProfile, sessionId\)/);
  assert.match(app, /navigate\('\/chat'\)/);
  assert.match(app, /botGroupsOpen[\s\S]*?navigate\('\/agent-group'\)/);
  assert.match(conversationApi, /openHostedConversationEventsWebSocket/);
  assert.match(conversationApi, /hosted-events-ws/);
});
