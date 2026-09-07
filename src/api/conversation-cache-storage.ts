import type { ConversationStorageAdapter } from './conversation-store-types';

export function conversationCacheStorage(storage: ConversationStorageAdapter): ConversationStorageAdapter {
  return storage;
}
