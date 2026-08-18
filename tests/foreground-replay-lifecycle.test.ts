import assert from 'node:assert/strict';
import test from 'node:test';

import { startForegroundReplayLifecycle } from '../src/api/foreground-replay-lifecycle';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(predicate(), true, 'replay lifecycle did not settle in time');
}

test('foreground replay wakes after background suspension and stops cleanly', async () => {
  let appState = 'active';
  let listener: (state: string) => void = () => {
    throw new Error('replay lifecycle did not subscribe');
  };
  let removeCalls = 0;
  let releaseFirstReplay!: () => void;
  const firstReplay = new Promise<void>((resolve) => {
    releaseFirstReplay = resolve;
  });
  let replayCalls = 0;

  const lifecycle = startForegroundReplayLifecycle({
    getAppState: () => appState,
    replay: async () => {
      replayCalls += 1;
      if (replayCalls === 1) await firstReplay;
    },
    subscribe: (nextListener) => {
      listener = nextListener;
      return { remove: () => { removeCalls += 1; } };
    },
  });

  await flushMicrotasks();
  assert.equal(replayCalls, 1);

  appState = 'background';
  listener('background');
  releaseFirstReplay();
  await firstReplay;
  await flushMicrotasks();
  assert.equal(replayCalls, 1);

  appState = 'active';
  listener('active');
  await flushMicrotasks();
  assert.equal(replayCalls, 2);

  lifecycle.stop();
  assert.equal(removeCalls, 1);
  listener('active');
  await flushMicrotasks();
  assert.equal(replayCalls, 2);
});

test('active transition queues a replay while a previous drain is in flight', async () => {
  let appState = 'active';
  let listener: (state: string) => void = () => {
    throw new Error('replay lifecycle did not subscribe');
  };
  let releaseFirstReplay!: () => void;
  const firstReplay = new Promise<void>((resolve) => {
    releaseFirstReplay = resolve;
  });
  let replayCalls = 0;

  const lifecycle = startForegroundReplayLifecycle({
    getAppState: () => appState,
    replay: async () => {
      replayCalls += 1;
      if (replayCalls === 1) await firstReplay;
    },
    subscribe: (nextListener) => {
      listener = nextListener;
      return { remove() {} };
    },
  });

  await flushMicrotasks();
  assert.equal(replayCalls, 1);

  // This is the race seen when iOS resumes before the background-era request
  // has settled. The active event must not be lost to the in-flight guard.
  listener('active');
  await flushMicrotasks();
  assert.equal(replayCalls, 1);

  releaseFirstReplay();
  await firstReplay;
  await waitFor(() => replayCalls === 2);
  lifecycle.stop();
});
