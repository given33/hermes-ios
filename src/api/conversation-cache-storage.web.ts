import type { ConversationStorageAdapter } from './conversation-store-types';
import { IndexedConversationCacheStorage } from './indexed-conversation-cache-storage';

const adapters = new WeakMap<object, ConversationStorageAdapter>();

export function conversationCacheStorage(storage: ConversationStorageAdapter): ConversationStorageAdapter {
  if (!globalThis.indexedDB) return storage;
  let adapter = adapters.get(storage);
  if (!adapter) {
    adapter = new IndexedConversationCacheStorage(storage, globalThis.indexedDB);
    adapters.set(storage, adapter);
  }
  return adapter;
}
