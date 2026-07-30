import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { cleanupOwnedTemporaryAttachments } from '../src/api/attachment-draft-lifecycle';
import type { ConversationStorageAdapter } from '../src/api/conversation-store-types';
import {
  discardedImagePickerAttachments,
  ImagePickerRecoveryMarkerStore,
  matchesImagePickerRecoveryMarker,
} from '../src/studio/chat/image-picker-recovery-marker';

class MemoryStorage implements ConversationStorageAdapter {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

test('picker recovery marker is bound to the exact owner generation and epoch', () => {
  const marker = {
    createdAt: 1_000,
    operationId: 'picker-a',
    owner: 'origin|alice|generation-a',
    ownerEpoch: 4,
  };

  assert.equal(matchesImagePickerRecoveryMarker(
    marker, 'origin|alice|generation-a', 4, 2_000,
  ), true);
  assert.equal(matchesImagePickerRecoveryMarker(
    marker, 'origin|alice|generation-b', 4, 2_000,
  ), false);
  assert.equal(matchesImagePickerRecoveryMarker(
    marker, 'origin|alice|generation-a', 5, 2_000,
  ), false);
});

test('old-owner pending picker assets are rejected and cleaned from the cache', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'hermes-picker-recovery-'));
  const cache = join(sandbox, 'cache');
  mkdirSync(cache);
  const stalePhoto = join(cache, 'stale-owner-photo.jpg');
  writeFileSync(stalePhoto, 'stale photo');
  try {
    const marker = {
      createdAt: 1_000,
      operationId: 'picker-old-owner',
      owner: 'origin|alice|generation-a',
      ownerEpoch: 1,
    };
    assert.equal(matchesImagePickerRecoveryMarker(
      marker, 'origin|bob|generation-b', 1, 2_000,
    ), false);

    const discarded = discardedImagePickerAttachments([{
      assetId: null,
      base64: null,
      duration: null,
      exif: null,
      fileName: 'stale-owner-photo.jpg',
      fileSize: 11,
      height: 1,
      mimeType: 'image/jpeg',
      pairedVideoAsset: null,
      type: 'image',
      uri: pathToFileURL(stalePhoto).href,
      width: 1,
    }]);
    cleanupOwnedTemporaryAttachments(discarded, pathToFileURL(cache).href, (uri) => {
      unlinkSync(fileURLToPath(uri));
    });
    assert.equal(existsSync(stalePhoto), false);
  } finally {
    rmSync(sandbox, { force: true, recursive: true });
  }
});

test('marker clear is operation-scoped and cannot erase a newer picker', async () => {
  const storage = new MemoryStorage();
  const store = new ImagePickerRecoveryMarkerStore(storage);
  await store.record({ createdAt: 1, operationId: 'old', owner: 'owner-a', ownerEpoch: 1 });
  await store.record({ createdAt: 2, operationId: 'new', owner: 'owner-a', ownerEpoch: 1 });

  await store.clearIfMatches('old');
  assert.equal((await store.read())?.operationId, 'new');
  await store.clearIfMatches('new');
  assert.equal(await store.read(), null);
});
