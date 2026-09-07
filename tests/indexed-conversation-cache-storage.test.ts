import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedConversationCacheStorage } from '../src/api/indexed-conversation-cache-storage';

const key = 'hermes.native.conversations.v4.owner.row.chat';
function fixture() {
  const values = new Map<string, string>();
  const legacy = {
    async getItem(key: string) { return values.get(key) ?? null; },
    async setItem(key: string, value: string) { values.set(key, value); },
    async removeItem(key: string) { values.delete(key); },
  };
  const factory = new IDBFactory();
  return { values, legacy, factory, storage: new IndexedConversationCacheStorage(legacy, factory) };
}

test('large transcripts migrate intact and free legacy space, while drafts and outboxes stay separate', async () => {
  const { values, storage } = fixture();
  const transcript = 'history'.repeat(1_000_000);
  values.set(key, transcript);
  values.set('hermes.draft.owner', 'unsent draft');
  assert.equal(await storage.getItem(key), transcript);
  assert.equal(values.has(key), false);
  assert.equal(await storage.getItem(key), transcript);
  assert.equal(await storage.getItem('hermes.draft.owner'), 'unsent draft');
  await storage.setItem('hermes.outbox.owner', 'pending');
  assert.equal(values.get('hermes.outbox.owner'), 'pending');
  await storage.removeItem(key);
  assert.equal(await storage.getItem(key), null);
  assert.equal(values.get('hermes.draft.owner'), 'unsent draft');
});

test('failed database opening never removes the legacy transcript and a retry migrates it', async () => {
  const { values, storage, factory } = fixture();
  values.set(key, 'only offline copy');
  const original = factory.open.bind(factory);
  factory.open = () => { throw new DOMException('blocked', 'SecurityError'); };
  await assert.rejects(storage.getItem(key), /blocked/);
  assert.equal(values.get(key), 'only offline copy');
  factory.open = original;
  assert.equal(await storage.getItem(key), 'only offline copy');
  assert.equal(values.has(key), false);
});

test('concurrent writes and removal cannot resurrect a migrating row within an adapter', async () => {
  const { values, storage } = fixture();
  values.set(key, 'old');
  await Promise.all([storage.getItem(key), storage.setItem(key, 'new')]);
  assert.equal(await storage.getItem(key), 'new');
  await Promise.all([storage.getItem(key), storage.removeItem(key)]);
  assert.equal(await storage.getItem(key), null);
});

test('a failed transaction leaves the legacy copy intact', async () => {
  const { values, storage, factory } = fixture();
  values.set(key, 'offline');
  const request = factory.open('hermes-conversation-cache', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('entries');
  const db = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result); });
  const prototype = Object.getPrototypeOf(db);
  const original = prototype.transaction;
  prototype.transaction = function (...args: any[]) {
    const transaction = original.apply(this, args);
    if (args[1] === 'readwrite') queueMicrotask(() => transaction.abort());
    return transaction;
  };
  try {
    await assert.rejects(storage.getItem(key));
    assert.equal(values.get(key), 'offline');
  } finally {
    prototype.transaction = original;
    db.close();
  }
  assert.equal(await storage.getItem(key), 'offline');
  assert.equal(values.has(key), false);
});
