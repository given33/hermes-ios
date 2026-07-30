import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { copyTargetWithRollback } from '../src/api/attachment-copy-rollback';

test('draft copy removes a target created before the copy operation throws', () => {
  let deleted = false;
  const target = {
    delete() {
      deleted = true;
      this.exists = false;
    },
    exists: false,
  };

  assert.throws(() => copyTargetWithRollback(target, (destination) => {
    destination.exists = true;
    throw new Error('copy failed after creating target');
  }), /copy failed after creating target/);
  assert.equal(deleted, true);
  assert.equal(target.exists, false);
});

test('draft cache copy routes the real Expo target through rollback protection', () => {
  const source = readFileSync('src/api/attachment-draft-cache.ts', 'utf8');
  assert.match(source, /copyTargetWithRollback\(target, \(destination\) => source\.copy\(destination\)\)/);
});
