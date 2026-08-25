import assert from 'node:assert/strict';
import test from 'node:test';

import { subscribeHermesDeepLinks } from '../src/app/hermes-deep-link-coordinator';
import {
  parseHermesDeepLink,
  reconcileHermesDeepLinkAccount,
} from '../src/app/hermes-deep-link';

test('registered app deep links resolve routes and conversation identity', () => {
  assert.deepEqual(parseHermesDeepLink('hermes-agent://chat/conversation-1'), {
    conversationId: 'conversation-1',
    routePath: '/chat',
  });
  assert.deepEqual(parseHermesDeepLink('hermes-agent://conversation/conversation-2?turn=turn-7'), {
    conversationId: 'conversation-2',
    routePath: '/chat',
  });
  assert.deepEqual(parseHermesDeepLink('hermes-agent://skills'), {
    routePath: '/skills',
  });
  assert.deepEqual(parseHermesDeepLink('hermes-agent://task/runtime-1?action=pause'), {
    routePath: '/chat',
    taskAction: 'pause',
    taskId: 'runtime-1',
  });
  assert.deepEqual(parseHermesDeepLink('hermes-agent://task/runtime-1?action=speak-toggle'), {
    routePath: '/chat',
    taskAction: 'speak-toggle',
    taskId: 'runtime-1',
  });
  assert.deepEqual(parseHermesDeepLink('hermes-agent://task/runtime-1?action=unknown-action'), {
    routePath: '/chat',
  });
  assert.deepEqual(parseHermesDeepLink('hermes-agent://task/runtime-1'), {
    routePath: '/chat',
  });
  assert.equal(parseHermesDeepLink('https://example.com/chat/conversation-1'), null);
  assert.equal(parseHermesDeepLink('https://user:pass@daxueshenmai.top/chat'), null);
  assert.equal(parseHermesDeepLink('hermes-agent://chat/%E0%A4%A'), null);
  assert.equal(parseHermesDeepLink('hermes-agent:///chat/%2E%2E/config'), null);
});

test('runtime deep links win over a delayed cold-start URL', async () => {
  const initial = deferred<string | null>();
  const runtime = linkingRuntime(initial.promise);
  const accepted: string[] = [];
  const cleanup = subscribeHermesDeepLinks(runtime.linking, (url) => accepted.push(url));

  runtime.emit('hermes-agent://conversation/runtime');
  initial.resolve('hermes-agent://conversation/initial');
  await initial.promise;
  await Promise.resolve();

  assert.deepEqual(accepted, ['hermes-agent://conversation/runtime']);
  cleanup();
  assert.equal(runtime.removed(), true);
});

test('deep-link cleanup removes the listener and ignores late initial resolution', async () => {
  const initial = deferred<string | null>();
  const runtime = linkingRuntime(initial.promise);
  const accepted: string[] = [];
  const cleanup = subscribeHermesDeepLinks(runtime.linking, (url) => accepted.push(url));

  cleanup();
  runtime.emit('hermes-agent://conversation/runtime');
  initial.resolve('hermes-agent://conversation/initial');
  await initial.promise;
  await Promise.resolve();

  assert.deepEqual(accepted, []);
  assert.equal(runtime.removed(), true);
});

test('cold-start deep links bind once and clear across logout or account replacement', () => {
  const pending = {
    accountKey: null,
    target: { conversationId: 'conversation-1', requestId: 1, routePath: '/chat' },
  };
  const accountA = reconcileHermesDeepLinkAccount(pending, 'account-a');
  assert.deepEqual(accountA, { ...pending, accountKey: 'account-a' });
  assert.equal(reconcileHermesDeepLinkAccount(accountA, 'account-a'), accountA);
  assert.equal(reconcileHermesDeepLinkAccount(accountA, null), null);
  assert.equal(reconcileHermesDeepLinkAccount(accountA, 'account-b'), null);
});

test('unauthenticated deep-link task controls do not arm after login', () => {
  const pending = {
    accountKey: null,
    target: { requestId: 2, routePath: '/chat', taskId: 'runtime-1', taskAction: 'cancel' },
  } as const;
  assert.equal(reconcileHermesDeepLinkAccount(pending, 'account-a'), null);
});

test('unauthenticated speak-toggle deep links do not arm after login either', () => {
  const pending = {
    accountKey: null,
    target: { requestId: 3, routePath: '/chat', taskId: 'runtime-1', taskAction: 'speak-toggle' },
  } as const;
  assert.equal(reconcileHermesDeepLinkAccount(pending, 'account-a'), null);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function linkingRuntime(initialURL: Promise<string | null>) {
  let listener: ((event: { url: string }) => void) | null = null;
  let listenerRemoved = false;
  return {
    linking: {
      addEventListener(_type: 'url', next: (event: { url: string }) => void) {
        listener = next;
        return {
          remove() {
            listenerRemoved = true;
            listener = null;
          },
        };
      },
      getInitialURL: () => initialURL,
    },
    emit(url: string) { listener?.({ url }); },
    removed: () => listenerRemoved,
  };
}
