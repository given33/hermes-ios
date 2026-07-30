import assert from 'node:assert/strict';
import test from 'node:test';

import { AsyncSingleFlight } from '../src/studio/chat/AsyncSingleFlight';

test('single flight starts the picker synchronously in the originating press task', async () => {
  const gate = new AsyncSingleFlight();
  let started = false;
  const result = gate.run(async () => {
    started = true;
    return 'opened';
  });

  assert.equal(started, true);
  assert.equal(await result, 'opened');
});

test('single flight rejects reentry until the active picker operation finishes', async () => {
  const gate = new AsyncSingleFlight();
  let finish!: () => void;
  let starts = 0;
  const first = gate.run(async () => {
    starts += 1;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return 'first';
  });

  const overlapping = await gate.run(async () => {
    starts += 1;
    return 'overlapping';
  });

  assert.equal(overlapping, undefined);
  assert.equal(starts, 1);
  finish();
  assert.equal(await first, 'first');
  assert.equal(await gate.run(async () => 'next'), 'next');
});

test('single flight releases after native picker failures', async () => {
  const gate = new AsyncSingleFlight();

  await assert.rejects(
    gate.run(async () => {
      throw new Error('camera unavailable');
    }),
    /camera unavailable/,
  );
  assert.equal(await gate.run(async () => 'recovered'), 'recovered');
});

test('single flight abandons a picker that never settles and accepts the next attempt', async () => {
  const gate = new AsyncSingleFlight();
  let abandon!: () => void;
  let finishFirst!: () => void;
  let firstWasCurrentAfterRelease = true;
  const first = gate.run(
    async (isCurrent) => {
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      firstWasCurrentAfterRelease = isCurrent();
      return 'late';
    },
    (release) => {
      abandon = release;
      return () => undefined;
    },
  );

  await Promise.resolve();
  abandon();
  assert.equal(await first, undefined);
  assert.equal(await gate.run(async () => 'next'), 'next');
  finishFirst();
  await Promise.resolve();
  assert.equal(firstWasCurrentAfterRelease, false);
});
