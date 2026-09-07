import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const filename = resolve('src/studio/chat/useConversationIndexController.ts');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const requireSource = createRequire(filename);

function harness(load: () => Promise<unknown>, online = true) {
  const events: string[] = [];
  const cached = { id: 'chat', profile: 'default', messages: [], message_count: 0 };
  const exports: Record<string, any> = {};
  runInNewContext(compiled, {
    exports,
    require: (name: string) => name === 'react' ? {
      useCallback: (fn: unknown) => fn, useRef: (current: unknown) => ({ current }),
    } : name.includes('chat-fixture-simulator') ? {} : requireSource(name),
  }, { filename });
  const controller = exports.useConversationIndexController({
    cacheOwner: 'open-refresh-owner',
    cloudApi: online ? {} : null,
    activeConversationIdRef: { current: 'chat' },
    conversationIndexRef: { current: [cached] },
    conversationSyncGenerationRef: { current: { isActiveCurrent: () => true } },
    applyConversation: async () => { events.push('cached'); },
    loadConversation: async () => { events.push('remote'); return load(); },
    notify: () => events.push('warning'),
    isChinese: true, requestTimeoutMs: 100,
  });
  return { controller, events, cached };
}

test('a complete cache renders first but the latest server cancellation is fetched', async () => {
  const remote = { id: 'chat', hosted_turns: { turn: { status: 'cancelled' } } };
  const h = harness(async () => remote);
  assert.equal(await h.controller.openConversation('chat', 1), remote);
  assert.deepEqual(h.events, ['cached', 'remote']);
});

test('offline refresh retains the cached transcript and reports uncertainty', async () => {
  const h = harness(async () => { throw new Error('network unavailable'); });
  assert.equal(await h.controller.openConversation('chat', 1), h.cached);
  assert.deepEqual(h.events, ['cached', 'remote', 'warning']);
});

test('a server deletion propagates to the existing deletion handler', async () => {
  const error = Object.assign(new Error('deleted'), { status: 404 });
  const h = harness(async () => { throw error; });
  await assert.rejects(h.controller.openConversation('chat', 1), /deleted/);
  assert.deepEqual(h.events, ['cached', 'remote']);
});

test('a client without a connection can still open its complete offline transcript', async () => {
  const h = harness(async () => { throw new Error('must not fetch'); }, false);
  assert.equal(await h.controller.openConversation('chat', 1), h.cached);
  assert.deepEqual(h.events, ['cached']);
});
