import assert from 'node:assert/strict';
import test from 'node:test';

import { HermesApiClient } from '../src/api/HermesApiClient';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  test(`${method} refresh does not reuse a snapshot from before the mutation`, async () => {
    const oldResponse = deferred<Response>();
    const readStarted = deferred<void>();
    let reads = 0;
    const client = new HermesApiClient('https://hermes.test', 'test-secret', async (_, init) => {
      if (init?.method === method) return Response.json({ ok: true });
      reads += 1;
      if (reads === 1) {
        readStarted.resolve();
        return oldResponse.promise;
      }
      return Response.json({ revision: 2 });
    });

    const polling = client.request('/api/cron/jobs');
    await readStarted.promise;
    await client.request('/api/cron/jobs/job-id', { method });
    const refresh = client.request('/api/cron/jobs');
    oldResponse.resolve(Response.json({ revision: 1 }));

    assert.deepEqual(await refresh, { revision: 2 });
    assert.deepEqual(await polling, { revision: 1 });
    assert.equal(reads, 2);
  });
}

for (const succeeds of [true, false]) {
  test(`a ${succeeds ? 'successful' : 'failed'} mutation retires reads started while it was pending`, async () => {
    const writeResponse = deferred<Response>();
    const writeStarted = deferred<void>();
    const oldResponse = deferred<Response>();
    const readStarted = deferred<void>();
    let reads = 0;
    const client = new HermesApiClient('https://hermes.test', 'test-secret', async (_, init) => {
      if (init?.method === 'PATCH') {
        writeStarted.resolve();
        return writeResponse.promise;
      }
      reads += 1;
      if (reads === 1) {
        readStarted.resolve();
        return oldResponse.promise;
      }
      return Response.json({ revision: 2 });
    });

    const mutation = client.request('/api/config', { method: 'PATCH' });
    const settled = mutation.then(() => 'ok', () => 'error');
    await writeStarted.promise;
    const polling = client.request('/api/config');
    await readStarted.promise;
    writeResponse.resolve(Response.json({ ok: succeeds }, { status: succeeds ? 200 : 500 }));
    assert.equal(await settled, succeeds ? 'ok' : 'error');
    const refresh = client.request('/api/config');
    oldResponse.resolve(Response.json({ revision: 1 }));

    assert.deepEqual(await refresh, { revision: 2 });
    assert.deepEqual(await polling, { revision: 1 });
    assert.equal(reads, 2);
  });
}
