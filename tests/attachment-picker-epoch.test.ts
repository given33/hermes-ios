import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  beginConversationStorageOwnerActivation,
  beginConversationStorageOwnerPurge,
  completeConversationStorageOwnerActivation,
  captureConversationStorageEpoch,
} from '../src/api/conversation-storage-coordinator';
import { runOwnerEpochBound } from '../src/api/owner-epoch-async';

function activate(owner: string): number {
  const epoch = beginConversationStorageOwnerActivation(owner);
  assert.equal(completeConversationStorageOwnerActivation(owner, epoch), true);
  return epoch;
}

test('a delayed native picker result is discarded across purge and same-owner activation', async () => {
  const owner = `picker-${Date.now()}-${Math.random()}`;
  const oldEpoch = activate(owner);
  let release!: (value: { uri: string }) => void;
  const picker = new Promise<{ uri: string }>((resolve) => {
    release = resolve;
  });
  const pending = runOwnerEpochBound(owner, oldEpoch, () => picker);

  beginConversationStorageOwnerPurge(owner);
  activate(owner);
  release({ uri: 'file:///old-account/photo.jpg' });

  assert.equal(await pending, undefined);
  assert.equal(captureConversationStorageEpoch(owner) > oldEpoch, true);
});

test('a picker result from the current epoch is still delivered', async () => {
  const owner = `picker-current-${Date.now()}-${Math.random()}`;
  const epoch = activate(owner);
  const result = await runOwnerEpochBound(owner, epoch, async () => ({
    uri: 'file:///current-account/photo.jpg',
  }));
  assert.deepEqual(result, { uri: 'file:///current-account/photo.jpg' });
});

test('production picker handlers carry the captured epoch through native awaits', () => {
  const source = readFileSync('src/studio/chat/useChatAttachmentController.ts', 'utf8');
  assert.match(source, /runOwnerEpochBound\([\s\S]*requestCameraPermissionsAsync/);
  assert.match(source, /runOwnerEpochBound\([\s\S]*launchImageLibraryAsync/);
  assert.match(source, /runOwnerEpochBound\([\s\S]*getDocumentAsync/);
  assert.match(source, /appendPickedAttachments\([\s\S]*expectedOwnerEpoch/);
  assert.match(source, /showIOSAttachmentPicker\(ownerEpoch\)/);
});
