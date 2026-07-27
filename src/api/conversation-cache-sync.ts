import type {
  CollaborationMessage,
  HermesCloudApi,
  SingleConversation,
} from './HermesCloudApi';
import type {
  ConversationCacheReconciliation,
  ConversationCacheSnapshot,
  OptimisticConversationLedgerItem,
} from './conversation-store-types';
import { CONVERSATION_CACHE_VERSION, cloneCachedConversation } from './conversation-cache-repository';
import { isRecord, normalizeOwner, numberValue } from './conversation-storage-primitives';
import {
  cloneCollaborationMessage,
  cloneOptimisticLedgerEntry,
  messageTimestamp,
  shouldReplaceOptimisticMessage,
} from './conversation-optimistic-ledger';

export interface ConversationCacheSyncPort {
  beginSynchronization(owner: string): number;
  read(owner: string): Promise<ConversationCacheSnapshot | null>;
  writeSynchronized(
    owner: string,
    generation: number,
    conversations: readonly SingleConversation[],
    activeConversationId: string,
  ): Promise<boolean>;
}

export function reconcileConversationCache(
  local: readonly SingleConversation[],
  remote: readonly SingleConversation[],
): ConversationCacheReconciliation {
  const localById = new Map(local.map((conversation) => [conversation.id, conversation]));
  const downloadIds: string[] = [];
  const conversations = remote.map((summary) => {
    if (isOfficialPlaceholder(summary)) return cloneCachedConversation(summary);
    const cached = localById.get(summary.id);
    if (cached && isCompleteConversation(cached) && sameRevision(cached, summary)) {
      return cloneCachedConversation(cached);
    }
    downloadIds.push(summary.id);
    return cloneCachedConversation(summary);
  });
  return { conversations, downloadIds };
}

export function mergeOptimisticConversationLedgers(
  persisted: readonly OptimisticConversationLedgerItem[],
  live: readonly OptimisticConversationLedgerItem[],
): OptimisticConversationLedgerItem[] {
  const merged = new Map<string, OptimisticConversationLedgerItem>();
  for (const entry of [...persisted, ...live]) {
    const current = merged.get(entry.conversationId);
    if (!current) {
      merged.set(entry.conversationId, cloneOptimisticLedgerEntry(entry));
      continue;
    }
    const newest = entry.updatedAt >= current.updatedAt ? entry : current;
    const messages = new Map(current.messages.map((message) => [message.id, message]));
    for (const message of entry.messages) {
      const previous = messages.get(message.id);
      if (!previous || shouldReplaceOptimisticMessage(previous, message)) {
        messages.set(message.id, message);
      }
    }
    merged.set(entry.conversationId, {
      conversationId: entry.conversationId,
      messages: [...messages.values()].map(cloneCollaborationMessage).sort(
        (left, right) => messageTimestamp(left) - messageTimestamp(right),
      ),
      ...(newest.pendingTurn ? { pendingTurn: { ...newest.pendingTurn } } : {}),
      updatedAt: Math.max(current.updatedAt, entry.updatedAt),
    });
  }
  return [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function mergeDownloadedConversations(
  index: readonly SingleConversation[],
  downloaded: readonly SingleConversation[],
): SingleConversation[] {
  const downloadedById = new Map(downloaded.map((conversation) => [
    conversation.id,
    conversation,
  ]));
  return index.map((summary) => {
    const full = downloadedById.get(summary.id);
    if (!full) return cloneCachedConversation(summary);
    return cloneCachedConversation({
      ...summary,
      ...full,
      message_count: full.message_count ?? summary.message_count ?? full.messages.length,
    });
  });
}

export function upsertCachedConversation(
  conversations: readonly SingleConversation[],
  conversation: SingleConversation,
  replacedId = '',
): SingleConversation[] {
  const existing = conversations.find(({ id }) => id === conversation.id);
  const merged = {
    ...existing,
    ...conversation,
    messages: mergeConversationMessages(existing?.messages || [], conversation.messages),
    message_count: Math.max(
      numberValue(conversation.message_count),
      numberValue(existing?.message_count),
      conversation.messages.length,
      existing?.messages.length || 0,
    ),
  };
  return [
    cloneCachedConversation(merged),
    ...conversations.filter((item) => (
      item.id !== conversation.id && (!replacedId || item.id !== replacedId)
    )).map(cloneCachedConversation),
  ].sort((left, right) => numberValue(right.updated_at) - numberValue(left.updated_at));
}

export function isCompleteConversation(conversation: SingleConversation): boolean {
  if (isOfficialPlaceholder(conversation)) return false;
  const expected = Math.max(0, numberValue(conversation.message_count));
  return conversation.messages.length >= expected;
}

export async function synchronizeConversationCache(
  api: HermesCloudApi,
  store: ConversationCacheSyncPort,
  owner: string,
  profile = 'default',
): Promise<ConversationCacheSnapshot> {
  const generation = store.beginSynchronization(owner);
  const cached = await store.read(owner);
  const remote = await api.getUnifiedConversations(profile);
  const reconciliation = reconcileConversationCache(
    cached?.conversations || [],
    remote.conversations,
  );
  const missingIds = new Set<string>();
  const downloaded = await mapWithConcurrency(
    reconciliation.downloadIds,
    4,
    async (id) => {
      try {
        return (await api.getConversation(id)).conversation;
      } catch (error) {
        if (isNotFoundError(error)) {
          missingIds.add(id);
          return null;
        }
        throw error;
      }
    },
  );
  const conversations = mergeDownloadedConversations(
    reconciliation.conversations.filter(({ id }) => !missingIds.has(id)),
    downloaded.filter((conversation): conversation is SingleConversation => conversation !== null),
  );
  const activeConversationId = conversations.some(
    ({ id }) => id === cached?.activeConversationId,
  )
    ? cached?.activeConversationId || ''
    : conversations[0]?.id || '';
  const wrote = await store.writeSynchronized(
    owner,
    generation,
    conversations,
    activeConversationId,
  );
  if (!wrote) {
    const latest = await store.read(owner);
    if (latest) return latest;
  }
  return {
    version: CONVERSATION_CACHE_VERSION,
    owner: normalizeOwner(owner),
    activeConversationId,
    conversations,
    syncedAt: Date.now(),
  };
}

function mergeConversationMessages(
  existing: readonly CollaborationMessage[],
  incoming: readonly CollaborationMessage[],
): CollaborationMessage[] {
  const messages = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) {
    const current = messages.get(message.id);
    if (!current || optimisticMessageRevision(message) >= optimisticMessageRevision(current)) {
      messages.set(message.id, message);
    }
  }
  return [...messages.values()].map(cloneCollaborationMessage).sort(
    (left, right) => messageTimestamp(left) - messageTimestamp(right),
  );
}

function sameRevision(left: SingleConversation, right: SingleConversation): boolean {
  return numberValue(left.updated_at) === numberValue(right.updated_at)
    && numberValue(left.message_count) === numberValue(right.message_count)
    && left.title === right.title
    && JSON.stringify(left.runtime_sessions || {}) === JSON.stringify(right.runtime_sessions || {});
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && (error.status === 404 || error.statusCode === 404);
}

function isOfficialPlaceholder(conversation: SingleConversation): boolean {
  return conversation.id.startsWith('official:');
}

function optimisticMessageRevision(message: CollaborationMessage): number {
  return Math.max(
    timestampNumber(message.created_at),
    timestampNumber(message.updated_at),
    timestampNumber(message.completed_at),
  );
}

function timestampNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!values.length) return [];
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, worker),
  );
  return results;
}
