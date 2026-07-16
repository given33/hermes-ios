import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesApiClient, HermesRequestOptions } from '../src/api/HermesApiClient';
import { HermesCloudApi, type SingleConversation } from '../src/api/HermesCloudApi';
import {
  ConversationLocalStore,
  mergeDownloadedConversations,
  reconcileConversationCache,
  synchronizeConversationCache,
} from '../src/api/conversation-local-store';

class MemoryStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function conversation(
  id: string,
  updatedAt: number,
  messages: SingleConversation['messages'],
  messageCount = messages.length,
): SingleConversation {
  return {
    id,
    profile: 'default',
    title: id,
    messages,
    message_count: messageCount,
    runtime_sessions: {},
    updated_at: updatedAt,
  };
}

test('local conversation history is isolated by server account and restores the active chat', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const ownerA = 'https://example.test|owner-a@example.test';
  const ownerB = 'https://example.test|owner-b@example.test';
  const chatA = conversation('chat-a', 10, [
    { id: 'a-1', role: 'user', name: '你', content: 'A 的本地历史' },
  ]);
  const chatB = conversation('chat-b', 20, [
    { id: 'b-1', role: 'user', name: '你', content: 'B 的本地历史' },
  ]);

  await store.write(ownerA, [chatA], chatA.id);
  await store.write(ownerB, [chatB], chatB.id);

  const restoredA = await store.read(ownerA.toUpperCase());
  const restoredB = await store.read(ownerB);
  assert.equal(storage.values.size, 2);
  assert.equal(restoredA?.activeConversationId, 'chat-a');
  assert.equal(restoredA?.conversations[0].messages[0].content, 'A 的本地历史');
  assert.equal(restoredB?.activeConversationId, 'chat-b');
  assert.equal(restoredB?.conversations[0].messages[0].content, 'B 的本地历史');
});

test('cloud reconciliation reuses unchanged local transcripts and downloads only changed records', () => {
  const unchanged = conversation('unchanged', 100, [
    { id: 'm-1', role: 'user', name: '你', content: '完整本地正文' },
  ]);
  const changed = conversation('changed', 100, [
    { id: 'm-2', role: 'user', name: '你', content: '旧正文' },
  ]);
  const deletedElsewhere = conversation('deleted', 100, []);
  const remoteUnchanged = conversation('unchanged', 100, [
    { id: 'last', role: 'user', name: '你', content: '轻量索引末条' },
  ]);
  const remoteChanged = conversation('changed', 200, [
    { id: 'last-2', role: 'assistant', name: 'Hermes', content: '新末条' },
  ], 3);
  const official = {
    ...conversation('official:session-1', 300, [], 8),
    official_session_id: 'session-1',
    title: '官方任务摘要',
  };

  const result = reconcileConversationCache(
    [unchanged, changed, deletedElsewhere],
    [official, remoteChanged, remoteUnchanged],
  );

  assert.deepEqual(result.downloadIds, ['changed']);
  assert.equal(result.conversations.find(({ id }) => id === 'unchanged')?.messages[0].content, '完整本地正文');
  assert.equal(result.conversations.some(({ id }) => id === 'deleted'), false);
  assert.equal(result.conversations.find(({ id }) => id.startsWith('official:'))?.title, '官方任务摘要');

  const synchronized = mergeDownloadedConversations(result.conversations, [
    conversation('changed', 200, [
      { id: 'm-2', role: 'user', name: '你', content: '完整新正文' },
      { id: 'm-3', role: 'assistant', name: 'Hermes', content: '完整新回复' },
      { id: 'm-4', role: 'user', name: '你', content: '继续' },
    ]),
  ]);
  assert.equal(synchronized.find(({ id }) => id === 'changed')?.messages.length, 3);
});

test('session-page synchronization stores full changed transcripts for later local-first startup', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|owner@example.test';
  const unchanged = conversation('unchanged', 100, [
    { id: 'm-1', role: 'user', name: '你', content: '本地完整正文' },
  ]);
  const changedSummary = conversation('changed', 200, [
    { id: 'last', role: 'assistant', name: 'Hermes', content: '索引末条' },
  ], 2);
  await store.write(owner, [unchanged], unchanged.id);
  const detailCalls: string[] = [];
  const api = {
    async getUnifiedConversations() {
      return {
        conversations: [
          changedSummary,
          conversation('unchanged', 100, [
            { id: 'last-local', role: 'user', name: '你', content: '索引末条' },
          ]),
        ],
      };
    },
    async getConversation(id: string) {
      detailCalls.push(id);
      return {
        conversation: conversation('changed', 200, [
          { id: 'c-1', role: 'user', name: '你', content: '云端新消息' },
          { id: 'c-2', role: 'assistant', name: 'Hermes', content: '云端新回复' },
        ]),
      };
    },
  } as unknown as HermesCloudApi;

  const synchronized = await synchronizeConversationCache(api, store, owner);
  const restored = await store.read(owner);

  assert.deepEqual(detailCalls, ['changed']);
  assert.equal(synchronized.activeConversationId, 'unchanged');
  assert.equal(restored?.conversations.find(({ id }) => id === 'unchanged')?.messages[0].content, '本地完整正文');
  assert.equal(restored?.conversations.find(({ id }) => id === 'changed')?.messages.length, 2);
});

test('a slower stale synchronization cannot overwrite a newer device snapshot', async () => {
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  const owner = 'https://example.test|race@example.test';
  let releaseOld: (() => void) | undefined;
  let signalOldStarted: (() => void) | undefined;
  const oldStarted = new Promise<void>((resolve) => { signalOldStarted = resolve; });
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  const oldApi = {
    async getUnifiedConversations() {
      signalOldStarted?.();
      await oldGate;
      return { conversations: [conversation('chat', 100, [], 1)] };
    },
    async getConversation() {
      return { conversation: conversation('chat', 100, [
        { id: 'old', role: 'assistant', name: 'Hermes', content: '旧设备结果' },
      ]) };
    },
  } as unknown as HermesCloudApi;
  const newApi = {
    async getUnifiedConversations() {
      return { conversations: [conversation('chat', 200, [], 1)] };
    },
    async getConversation() {
      return { conversation: conversation('chat', 200, [
        { id: 'new', role: 'assistant', name: 'Hermes', content: '新设备结果' },
      ]) };
    },
  } as unknown as HermesCloudApi;

  const stale = synchronizeConversationCache(oldApi, store, owner);
  await oldStarted;
  await synchronizeConversationCache(newApi, store, owner);
  releaseOld?.();
  await stale;

  const restored = await store.read(owner);
  assert.equal(restored?.conversations[0].updated_at, 200);
  assert.equal(restored?.conversations[0].messages[0].content, '新设备结果');
});

test('official sessions are adopted through the modified Hermes flow before chat opens', async () => {
  const calls: Array<{ path: string; options: HermesRequestOptions }> = [];
  const client = {
    request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
      calls.push({ path, options });
      if (path === '/api/sessions/session-1') {
        return Promise.resolve({ title: '官方任务摘要标题' } as T);
      }
      if (path === '/api/sessions/session-1/messages') {
        return Promise.resolve({
          session_id: 'session-1',
          messages: [
            { role: 'user', content: '检查项目', timestamp: 10 },
            {
              role: 'assistant',
              reasoning_content: '先检查状态',
              tool_calls: [{ id: 'tool-1', function: { name: 'terminal', arguments: '{}' } }],
              timestamp: 11,
            },
            { role: 'tool', tool_call_id: 'tool-1', content: 'clean', timestamp: 12 },
            { role: 'assistant', content: '项目状态正常', timestamp: 13 },
          ],
        } as T);
      }
      if (path.endsWith('/profiles')) {
        return Promise.resolve({
          profiles: [{
            name: 'default',
            description: '',
            model: '',
            provider: '',
            gateway_running: true,
          }],
        } as T);
      }
      if (path.endsWith('/single/conversations/adopt')) {
        return Promise.resolve({
          conversation: conversation('adopted-1', 13_000, []),
          created: true,
        } as T);
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  } as HermesApiClient;

  const result = await new HermesCloudApi(client).adoptOfficialConversation(
    'official:session-1',
    'default',
  );
  const body = JSON.parse(String(calls[3].options.body)) as {
    title: string;
    session_id: string;
    messages: Array<Record<string, unknown>>;
  };

  assert.equal(result.conversation.id, 'adopted-1');
  assert.equal(body.session_id, 'session-1');
  assert.equal(body.title, '官方任务摘要标题');
  assert.deepEqual(body.messages.map(({ role }) => role), ['user', 'assistant']);
  assert.equal(body.messages[0].timestamp, 10);
  assert.equal(body.messages[1].content, '项目状态正常');
  assert.equal((body.messages[1].meta as { activities: unknown[] }).activities.length, 2);
});
