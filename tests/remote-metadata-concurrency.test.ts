import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesCloudApi } from '../src/api/HermesCloudApi';
import type { HermesSwiftUIToolsetSnapshot } from '../src/app/swiftui-route-contract';
import { hydrateToolsetConfigs, loadCronMetadata } from '../src/app/route-loaders/remote-metadata';

function trackedRequest() {
  let active = 0;
  let peak = 0;
  let count = 0;
  return {
    get peak() { return peak; },
    get count() { return count; },
    async run(id: string) {
      active += 1;
      count += 1;
      peak = Math.max(peak, active);
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        return { id };
      } finally {
        active -= 1;
      }
    },
  };
}

test('cron history loads every job with bounded network concurrency', async () => {
  const tracker = trackedRequest();
  const jobs = Array.from({ length: 40 }, (_, index) => ({ id: `job-${index}` }));
  const api = { getCronJobRuns: (id: string) => tracker.run(id) } as unknown as HermesCloudApi;
  const result = await loadCronMetadata(api, 'default', { jobs });
  assert.equal(tracker.count, jobs.length);
  assert.deepEqual(Object.keys(JSON.parse(result.cronRunsJSON!)), jobs.map(({ id }) => id));
  assert.ok(tracker.peak <= 4, `peak ${tracker.peak} exceeds 4`);
});

test('toolset hydration preserves order and all catalogs with bounded requests', async () => {
  const tracker = trackedRequest();
  const toolsets = Array.from({ length: 30 }, (_, index) => ({ id: `toolset-${index}` })) as HermesSwiftUIToolsetSnapshot[];
  const api = {
    getToolsetConfig: (id: string) => tracker.run(id),
    getToolsetModels: (id: string) => tracker.run(id),
    getToolsetProviders: (id: string) => tracker.run(id),
  } as unknown as HermesCloudApi;
  const result = await hydrateToolsetConfigs(api, toolsets, 'default');
  assert.equal(tracker.count, toolsets.length * 3);
  assert.deepEqual(result.map(({ id }) => id), toolsets.map(({ id }) => id));
  assert.ok(result.every((row) => 'configJSON' in row && 'modelsJSON' in row && 'providersJSON' in row));
  assert.ok(tracker.peak <= 6, `peak ${tracker.peak} exceeds 6`);
});

test('official array-shaped cron responses load history in each job profile', async () => {
  const calls: unknown[] = [];
  const api = {
    getCronJobRuns: async (id: string, profile: string) => {
      calls.push([id, profile]);
      return { runs: [{ id: `run-${id}`, profile }] };
    },
  } as unknown as HermesCloudApi;
  const result = await loadCronMetadata(api, 'all', [
    { id: 'job-a', profile: 'bot-a' },
    { id: 'job-b', profile: 'bot-b' },
  ]);
  assert.deepEqual(calls, [['job-a', 'bot-a'], ['job-b', 'bot-b']]);
  assert.equal(Object.keys(JSON.parse(result.cronRunsJSON!)).length, 2);
});
