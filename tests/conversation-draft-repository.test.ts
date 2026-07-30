import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConversationDraftRepository,
  conversationDraftsKey,
} from '../src/api/conversation-draft-repository';
import { ConversationLocalStore } from '../src/api/conversation-local-store';
import {
  canApplyHydratedDraft,
  conversationDraftScope,
  persistedDraftTarget,
} from '../src/studio/chat/conversation-draft-scope';
import type { ConversationStorageAdapter } from '../src/api/conversation-store-types';

class MemoryStorage implements ConversationStorageAdapter {
  values = new Map<string, string>();
  getItem(key: string) { return Promise.resolve(this.values.get(key) ?? null); }
  setItem(key: string, value: string) { this.values.set(key, value); return Promise.resolve(); }
  removeItem(key: string) { this.values.delete(key); return Promise.resolve(); }
}

test('conversation drafts are isolated by owner and conversation', async () => {
  const storage = new MemoryStorage();
  const repository = new ConversationDraftRepository(storage);
  await repository.write('Alice', 'one', '/config set ');
  await repository.write('alice', 'two', 'second');

  assert.equal((await repository.read('ALICE', 'one'))?.content, '/config set ');
  assert.equal((await repository.read('alice', 'two'))?.content, 'second');
  assert.equal(await repository.read('bob', 'one'), null);
});

test('clearing the last draft removes the owner storage key', async () => {
  const storage = new MemoryStorage();
  const repository = new ConversationDraftRepository(storage);
  await repository.write('alice', 'one', 'draft');
  await repository.write('alice', 'one', '');

  assert.equal(storage.values.has(conversationDraftsKey('alice')), false);
});

test('an account switch persists the previous draft under the previous owner boundary', () => {
  const previous = conversationDraftScope('alice', 'conversation-a');
  const current = conversationDraftScope('bob', 'conversation-b');

  assert.deepEqual(persistedDraftTarget(previous), {
    owner: 'alice',
    conversationId: 'conversation-a',
  });
  assert.notDeepEqual(persistedDraftTarget(previous), current);
});

test('draft attachments survive navigation without keeping unrelated temporary files', async () => {
  const storage = new MemoryStorage();
  const repository = new ConversationDraftRepository(storage);
  await repository.write('alice', 'one', '[Full pasted text attached: paste.txt]', [{
    draftPersistent: true,
    id: 'paste-1',
    kind: 'file',
    mimeType: 'text/plain',
    name: 'paste.txt',
    ownedTemporary: true,
    size: 12_345,
    uri: 'file:///cache/paste.txt',
  }]);

  assert.deepEqual((await repository.read('alice', 'one'))?.attachments, [{
    draftPersistent: true,
    id: 'paste-1',
    kind: 'file',
    mimeType: 'text/plain',
    name: 'paste.txt',
    ownedTemporary: true,
    size: 12_345,
    uri: 'file:///cache/paste.txt',
  }]);
});

test('late hydration cannot replace text entered after the read started', () => {
  const expected = conversationDraftScope('alice', 'one');
  assert.equal(canApplyHydratedDraft(2, 2, expected, expected, 7, 7), true);
  assert.equal(canApplyHydratedDraft(2, 2, expected, expected, 7, 9), false);
  assert.equal(canApplyHydratedDraft(2, 3, expected, expected, 7, 7), false);
});

test('draft reads wait for an already queued write to the same owner key', async () => {
  let releaseWrite: () => void = () => {};
  let markStarted: () => void = () => {};
  const writeStarted = new Promise<void>((resolve) => { markStarted = resolve; });
  const writeReleased = new Promise<void>((resolve) => { releaseWrite = resolve; });
  const storage = new class extends MemoryStorage {
    override async setItem(key: string, value: string) {
      markStarted();
      await writeReleased;
      return super.setItem(key, value);
    }
  }();
  const repository = new ConversationDraftRepository(storage);
  const write = repository.write('alice', 'one', 'newest');
  await writeStarted;

  let readSettled = false;
  const read = repository.read('alice', 'one').then((draft) => {
    readSettled = true;
    return draft;
  });
  await Promise.resolve();
  assert.equal(readSettled, false);

  releaseWrite();
  await write;
  assert.equal((await read)?.content, 'newest');
});

test('account purge serializes after an in-flight draft write and removes it', async () => {
  let releaseWrite: () => void = () => {};
  let markStarted: () => void = () => {};
  const writeStarted = new Promise<void>((resolve) => { markStarted = resolve; });
  const writeReleased = new Promise<void>((resolve) => { releaseWrite = resolve; });
  const owner = 'alice';
  const draftKey = conversationDraftsKey(owner);
  const storage = new class extends MemoryStorage {
    override async setItem(key: string, value: string) {
      if (key === draftKey) {
        markStarted();
        await writeReleased;
      }
      return super.setItem(key, value);
    }
  }();
  const store = new ConversationLocalStore(storage);
  const write = store.writeDraft(owner, 'one', 'secret');
  await writeStarted;

  let purgeSettled = false;
  const purge = store.purge(owner).then(() => { purgeSettled = true; });
  await Promise.resolve();
  assert.equal(purgeSettled, false);

  releaseWrite();
  await write;
  await purge;
  assert.equal(storage.values.has(draftKey), false);
  assert.equal(await store.readDraft(owner, 'one'), null);
});

test('an unmount write queued after account purge begins is fenced by its tombstone', async () => {
  let releasePurge: () => void = () => {};
  let markPurgeStarted: () => void = () => {};
  const purgeStarted = new Promise<void>((resolve) => { markPurgeStarted = resolve; });
  const purgeReleased = new Promise<void>((resolve) => { releasePurge = resolve; });
  const owner = 'alice';
  const storage = new MemoryStorage();
  const store = new ConversationLocalStore(storage);
  await store.writeDraft(owner, 'one', 'before-delete');

  const purge = store.purge(owner, async () => {
    markPurgeStarted();
    await purgeReleased;
  });
  await purgeStarted;
  const lateUnmountWrite = store.writeDraft(owner, 'one', 'late-unmount-secret');

  releasePurge();
  await Promise.all([purge, lateUnmountWrite]);
  assert.equal(await store.readDraft(owner, 'one'), null);

  await store.activate(owner);
  await store.writeDraft(owner, 'one', 'new-authenticated-lifecycle');
  assert.equal(
    (await store.readDraft(owner, 'one'))?.content,
    'new-authenticated-lifecycle',
  );
});

test('hydration revision rejects an input-send ABA even when text is empty again', () => {
  const scope = conversationDraftScope('alice', 'one');
  const hydrationRevision = 10;
  const afterInputAndSendRevision = 12;
  assert.equal(canApplyHydratedDraft(
    4,
    4,
    scope,
    scope,
    hydrationRevision,
    afterInputAndSendRevision,
  ), false);
});
