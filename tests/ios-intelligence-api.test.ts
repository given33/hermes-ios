import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesApiClient } from '../src/api/HermesApiClient';
import { IOSIntelligenceApi } from '../src/context/IOSIntelligenceApi';

test('iOS intelligence uses the device timezone for today snapshots and event batches', async () => {
  const calls: Array<{ body?: string; path: string }> = [];
  const client = {
    request: async (path: string, init?: RequestInit) => {
      calls.push({ path, body: typeof init?.body === 'string' ? init.body : undefined });
      return {};
    },
  } as HermesApiClient;
  const api = new IOSIntelligenceApi(client);

  await api.snapshot('America/Los_Angeles');
  await api.uploadEvents({
    cursor: '7',
    deviceId: 'iphone-1',
    events: [],
    timezone: 'America/Los_Angeles',
  });

  assert.equal(
    calls[0]?.path,
    '/api/plugins/ios-intelligence/snapshot?timezone=America%2FLos_Angeles',
  );
  assert.equal(
    JSON.parse(calls[1]?.body || '{}').timezone,
    'America/Los_Angeles',
  );
});
