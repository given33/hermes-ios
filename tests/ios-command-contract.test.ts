import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasIOSNativeActionConfirmation,
  nativeActionMetadata,
  predictedDepartureTimestamp,
} from '../src/context/ios-command-contract';
import { IOSIntelligenceApi } from '../src/context/IOSIntelligenceApi';
import type { HermesApiClient } from '../src/api/HermesApiClient';

test('predicted departure accepts the server timestamp and legacy field', () => {
  assert.equal(predictedDepartureTimestamp({ timestamp: 1_800_000_000 }), 1_800_000_000_000);
  assert.equal(predictedDepartureTimestamp({ departureAt: 1_800_000_001 }), 1_800_000_001_000);
  assert.equal(predictedDepartureTimestamp({ timestamp: null, departureAt: 1 }), null);
  assert.throws(() => predictedDepartureTimestamp({}), /timestamp is required/);
});

test('native action metadata defaults writes to confirmation and bounds retries', () => {
  const command = {
    capability: 'ios-clipboard',
    action: 'write',
    payload: { text: 'secret' },
  };
  const metadata = nativeActionMetadata(command);
  assert.equal(metadata.action_id, 'ios.ios-clipboard.write');
  assert.equal(metadata.risk, 'write');
  assert.equal(metadata.confirmation, 'required');
  assert.equal(metadata.max_attempts, 3);
  assert.equal(hasIOSNativeActionConfirmation(command), false);
  assert.equal(
    hasIOSNativeActionConfirmation({ ...command, payload: { text: 'secret', confirmed: true } }),
    true,
  );
});

test('remote action metadata cannot expand retry count beyond the device bound', () => {
  const metadata = nativeActionMetadata({
    capability: 'ios-clipboard',
    action: 'read',
    action_metadata: {
      action_id: 'clipboard.read.v2',
      max_attempts: 100,
      confirmation: 'none',
    },
  });
  assert.equal(metadata.action_id, 'clipboard.read.v2');
  assert.equal(metadata.max_attempts, 10);
  assert.equal(metadata.confirmation, 'none');
});

test('remote metadata cannot downgrade a known write action confirmation', () => {
  const metadata = nativeActionMetadata({
    capability: 'ios-clipboard',
    action: 'write',
    action_metadata: { confirmation: 'none', risk: 'read' },
  });
  assert.equal(metadata.confirmation, 'required');
  assert.equal(metadata.risk, 'write');
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
