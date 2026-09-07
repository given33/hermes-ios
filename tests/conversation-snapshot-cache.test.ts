import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
  beginConversationStorageOwnerActivation,
  completeConversationStorageOwnerActivation,
} from '../src/api/conversation-storage-coordinator';

// Exercise the actual hook callbacks without mounting a native renderer.
const filename = resolve('src/studio/chat/useConversationSnapshotController.ts');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const requireSource = createRequire(filename);

function harness(owner: string) {
  const timers: Array<() => void> = [];
  const notices: string[] = [];
  let failure: Error | null = Object.assign(new Error('storage full'), { name: 'QuotaExceededError' });
  let writes = 0;
  let rendered: unknown;
  const optimistic = new Map<string, any[]>();
  const ledgerWrites: any[][] = [];
  let messages: any[] = [{ id: 'old-message', content: 'Other conversation', role: 'assistant', status: 'running' }];
  const exports: Record<string, any> = {};
  runInNewContext(compiled, {
    exports,
    require: (name: string) => name === 'react' ? {
      useCallback: (callback: unknown) => callback,
      useRef: (current: unknown) => ({ current }),
    } : requireSource(name),
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
  }, { filename });
  const controller = exports.useConversationSnapshotController({
    cacheOwner: owner,
    activeConversationIdRef: { current: 'chat' },
    conversationIndexRef: { current: [] },
    activeHostedTurnIdRef: { current: '' },
    hostedEventCursorRef: { current: new Map() },
    hostedTurnVisibilityFailuresRef: { current: new Map() },
    optimisticPendingByConversationRef: { current: new Map() },
    pendingTurnActiveRef: { current: false },
    optimisticHostedTurnIdRef: { current: '' },
    optimisticMessagesByConversationRef: { current: optimistic },
    replaceOptimisticMessages: async (id: string, next: any[]) => {
      optimistic.set(id, next);
      ledgerWrites.push(next);
    },
    optimisticMessagesRef: { current: [] },
    setActiveConversationId: () => {},
    setActiveHostedTurnId: () => {},
    setHostedRunning: () => {},
    setSending: () => {},
    updateConversationCollaborationState: () => {},
    setMessages: (update: (current: any[]) => any[]) => { messages = update(messages); },
    reconnectAttempt: 0,
    isChinese: true,
    localStore: { write: async () => { writes += 1; if (failure) throw failure; } },
    setConversations: (value: unknown) => { rendered = value; },
    notify: (message: string) => notices.push(message),
  });
  return {
    controller, notices, optimistic, ledgerWrites,
    get writes() { return writes; },
    get rendered() { return rendered; },
    get messages() { return messages; },
    setFailure(value: Error | null) { failure = value; },
    async flush() {
      for (const callback of timers.splice(0)) callback();
      await new Promise<void>((done) => setImmediate(done));
    },
  };
}

const conversations = [{ id: 'chat', messages: [], title: 'Server snapshot' }];

test('server cancellation removes a stored timeout notice from both rendered and durable optimistic messages', async () => {
  const h = harness('snapshot-timeout-cleanup|acctgen_test');
  h.optimistic.set('chat', [{ id: 'hosted-sync-failed-turn', role: 'assistant', content: 'Not started', status: 'failed' }]);
  await h.controller.applyConversation({
    id: 'chat', profile: 'default', account_generation: 'acctgen_test', title: 'Task', messages: [],
    hosted_turns: { turn: { status: 'cancelled', completed_at: 1000 } },
  });
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.ledgerWrites, [[]]);
});

test('stream snapshot publishes before storage and reports background failures once until recovery', async () => {
  const h = harness('snapshot-cache-recovery');
  await h.controller.commitConversationIndex(conversations, 'chat', undefined, true);
  assert.equal(h.writes, 0);
  assert.equal((h.rendered as typeof conversations)[0], conversations[0]);
  await h.flush();
  assert.equal(h.writes, 1);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /离线副本未能保存/);
  await h.controller.commitConversationIndex(conversations, 'chat', undefined, true);
  await h.flush();
  assert.equal(h.notices.length, 1);
  h.setFailure(null);
  await h.controller.commitConversationIndex(conversations, 'chat', undefined, true);
  await h.flush();
  h.setFailure(new Error('device storage unavailable'));
  await h.controller.commitConversationIndex(conversations, 'chat', undefined, true);
  await h.flush();
  assert.equal(h.writes, 4);
  assert.equal(h.notices.length, 2);
});

test('activating an empty server conversation never carries messages from the previous chat', async () => {
  const h = harness('snapshot-cache-switch|acctgen_test');
  h.setFailure(null);
  await h.controller.applyConversation({ id: 'new-chat', profile: 'default', account_generation: 'acctgen_test', title: 'New', messages: [] }, undefined, false, true);
  assert.deepEqual(h.messages, []);
});

test('an expired account cannot perform a deferred write or display a cache warning', async () => {
  const owner = 'snapshot-cache-expired';
  const h = harness(owner);
  await h.controller.commitConversationIndex(conversations, 'chat', undefined, true);
  const epoch = beginConversationStorageOwnerActivation(owner);
  completeConversationStorageOwnerActivation(owner, epoch);
  await h.flush();
  assert.equal(h.writes, 0);
  assert.equal(h.notices.length, 0);
});

test('foreground quota leaves the server snapshot usable but unrelated errors still reject', async () => {
  const h = harness('snapshot-cache-durable');
  await h.controller.commitConversationIndex(conversations, 'chat');
  assert.equal(h.notices.length, 1);
  h.setFailure(new Error('device write failure'));
  await assert.rejects(h.controller.commitConversationIndex(conversations, 'chat'), /device write failure/);
  h.setFailure(null);
  await h.controller.commitConversationIndex(conversations, 'chat');
  assert.equal(h.writes, 3);
});
