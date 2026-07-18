import assert from 'node:assert/strict';
import test from 'node:test';

import { predictedDepartureTimestamp } from '../src/context/ios-command-contract';
import { IOSIntelligenceApi } from '../src/context/IOSIntelligenceApi';
import type { HermesApiClient } from '../src/api/HermesApiClient';

test('predicted departure accepts the server timestamp and legacy field', () => {
  assert.equal(predictedDepartureTimestamp({ timestamp: 1_800_000_000 }), 1_800_000_000_000);
  assert.equal(predictedDepartureTimestamp({ departureAt: 1_800_000_001 }), 1_800_000_001_000);
  assert.equal(predictedDepartureTimestamp({ timestamp: null, departureAt: 1 }), null);
  assert.throws(() => predictedDepartureTimestamp({}), /timestamp is required/);
});

test('account deletion calls the linked server cleanup endpoint with confirmation', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const client = {
    async request(path: string, init?: RequestInit) {
      calls.push({ path, init });
      return { owner_id: 'owner' };
    },
  } as HermesApiClient;

  await new IOSIntelligenceApi(client).deleteAccount('https://hermes.example|owner');

  assert.equal(calls[0]?.path, '/api/plugins/ios-intelligence/account/delete');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    confirm: true,
    owner_scope: 'https://hermes.example|owner',
  });
});
