import assert from 'node:assert/strict';
import test from 'node:test';

import { isNewerVersion, normalizeVersion } from '../src/version';

test('normalizeVersion accepts tags with a leading v', () => {
  assert.deepEqual(normalizeVersion('v2.3.4'), [2, 3, 4]);
});

test('isNewerVersion compares each semantic version segment', () => {
  assert.equal(isNewerVersion('1.10.0', '1.9.9'), true);
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
  assert.equal(isNewerVersion('0.9.9', '1.0.0'), false);
});

test('normalizeVersion rejects malformed release tags', () => {
  assert.equal(normalizeVersion('release-next'), null);
});
