import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  cleanupOwnedTemporaryAttachments,
  isUriInsideDirectory,
} from '../src/preview/attachment-draft-lifecycle';

test('attachment cleanup deletes real owned cache files and preserves external originals', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'hermes-attachment-cleanup-'));
  const cache = join(sandbox, 'cache');
  const external = join(sandbox, 'external');
  mkdirSync(cache);
  mkdirSync(external);
  const cachedCopy = join(cache, 'picker-copy.jpg');
  const externalOriginal = join(external, 'original.jpg');
  writeFileSync(cachedCopy, 'cache plaintext');
  writeFileSync(externalOriginal, 'user original');

  try {
    cleanupOwnedTemporaryAttachments([
      { ownedTemporary: true, uri: pathToFileURL(cachedCopy).href },
      { ownedTemporary: true, uri: pathToFileURL(externalOriginal).href },
    ], pathToFileURL(cache).href, (uri) => unlinkSync(fileURLToPath(uri)));

    assert.equal(existsSync(cachedCopy), false);
    assert.equal(existsSync(externalOriginal), true);
  } finally {
    rmSync(sandbox, { force: true, recursive: true });
  }
});

test('attachment cleanup requires explicit ownership and rejects traversal lookalikes', () => {
  const removed: string[] = [];
  const cache = 'file:///app/cache/';
  cleanupOwnedTemporaryAttachments([
    { ownedTemporary: false, uri: 'file:///app/cache/unowned.jpg' },
    { ownedTemporary: true, uri: 'file:///app/cache/../original.jpg' },
    { ownedTemporary: true, uri: 'file:///app/cache/owned.jpg' },
    { ownedTemporary: true, uri: 'file:///app/cache/owned.jpg' },
  ], cache, (uri) => removed.push(uri));

  assert.deepEqual(removed, ['file:///app/cache/owned.jpg']);
  assert.equal(isUriInsideDirectory('file:///app/cache/../original.jpg', cache), false);
});
