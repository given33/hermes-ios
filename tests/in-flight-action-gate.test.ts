import assert from 'node:assert/strict';
import test from 'node:test';

import { createInFlightActionGate } from '../src/preview/in-flight-action-gate';

test('rapid workflow submissions share one in-flight gate and one stable request', async () => {
  const gate = createInFlightActionGate();
  const posts: string[] = [];
  let finishFirst: (() => void) | undefined;
  const firstPost = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });

  const submit = (requestId: string) => {
    if (!gate.tryAcquire()) return false;
    posts.push(requestId);
    void firstPost.finally(() => gate.release());
    return true;
  };

  assert.equal(submit('request-stable'), true);
  assert.equal(submit('request-duplicate'), false);
  assert.deepEqual(posts, ['request-stable']);
  assert.equal(gate.isLocked(), true);

  finishFirst?.();
  await firstPost;
  await Promise.resolve();
  assert.equal(gate.isLocked(), false);
});

test('a failed workflow submission releases the gate for a stable-id retry', async () => {
  const gate = createInFlightActionGate();
  const posts: string[] = [];
  const submit = async (requestId: string, fail: boolean) => {
    if (!gate.tryAcquire()) return false;
    try {
      posts.push(requestId);
      if (fail) throw new Error('offline');
      return true;
    } finally {
      gate.release();
    }
  };

  await assert.rejects(submit('request-stable', true), /offline/);
  assert.equal(await submit('request-stable', false), true);
  assert.deepEqual(posts, ['request-stable', 'request-stable']);
});
