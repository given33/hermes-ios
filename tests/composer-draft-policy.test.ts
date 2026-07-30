import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLargePaste,
  largePasteMarker,
} from '../src/studio/chat/composer-draft-policy';

test('large paste detection distinguishes one paste from ordinary typing', () => {
  assert.equal(isLargePaste('', 'x'.repeat(8_000)), true);
  assert.equal(isLargePaste('x'.repeat(7_999), 'x'.repeat(8_000)), false);
  assert.equal(isLargePaste('', 'short text'), false);
});

test('large paste marker keeps only a bounded preview and attachment identity', () => {
  const marker = largePasteMarker('a'.repeat(10_000), 'paste.txt', false);
  assert.equal(marker.length < 400, true);
  assert.match(marker, /Full pasted text attached: paste\.txt/);
  assert.equal(marker.includes('a'.repeat(1_000)), false);
});
