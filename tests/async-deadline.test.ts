import assert from 'node:assert/strict';
import test from 'node:test';

import { AsyncDeadlineError, withDeadline } from '../src/api/async-deadline';

test('withDeadline returns completed operations and rejects stalled operations', async () => {
  assert.equal(await withDeadline(Promise.resolve('ok'), 50, 'late'), 'ok');
  await assert.rejects(
    withDeadline(new Promise<string>(() => undefined), 5, 'model check timed out'),
    (error: unknown) => (
      error instanceof AsyncDeadlineError
      && error.message === 'model check timed out'
    ),
  );
});
