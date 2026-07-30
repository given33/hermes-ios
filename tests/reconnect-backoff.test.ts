import assert from 'node:assert/strict';
import test from 'node:test';

import { reconnectDelay } from '../src/api/reconnect-backoff';

test('SSE reconnect delay backs off exponentially, jitters, and stays bounded', () => {
  assert.equal(reconnectDelay(0, () => 0.5), 1_500);
  assert.equal(reconnectDelay(1, () => 0.5), 3_000);
  assert.equal(reconnectDelay(2, () => 0.5), 6_000);
  assert.equal(reconnectDelay(20, () => 1), 30_000);
  assert.equal(reconnectDelay(0, () => 0), 1_500);
  assert.equal(reconnectDelay(3, () => 0), 9_600);
  assert.equal(reconnectDelay(3, () => 1), 14_400);
});
