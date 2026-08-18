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
  readPendingConversationDeletionIds?(owner: string): Promise<ReadonlySet<string>>;
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
  preserveLocalOnly = false,
): ConversationCacheReconciliation {
  const localById = new Map(local.map((conversation) => [conversation.id, conversation]));
  const remoteIds = new Set(remote.map(({ id }) => id));
  const downloadIds: string[] = [];
  const conversations = remote.map((summary) => {
    if (isOfficialPlaceholder(summary)) return cloneCachedConversation(summary);
    const cached = localById.get(summary.id);
    if (cached && isCompleteConversation(cached) && sameRevision(cached, summary)) {
      return cloneCachedConversation(cached);
    }
    downloadIds.push(summary.id);
    // Keep a complete device transcript attached to the lightweight summary
    // while the detail request is in flight. A transient timeout must not
    // downgrade an already-downloaded conversation to its last-message row;
    // a successful detail response still replaces this fallback authoritatively.
    if (cached && isCompleteConversation(cached)) {
      return cloneCachedConversation({
        ...summary,
        messages: cached.messages,
        // Keep the local count while the remote detail is unavailable. Using
        // the newer remote count here would make `isCompleteConversation`
        // reject the still-valid local transcript on an offline reopen.
        message_count: Math.max(numberValue(cached.message_count), cached.messages.length),
      });
    }
    return cloneCachedConversation(summary);
  });
  if (preserveLocalOnly) {
    conversations.push(
      ...local
        .filter(({ id }) => !remoteIds.has(id))
        .map(cloneCachedConversation),
    );
    conversations.sort((left, right) => (
      timestampNumber(right.updated_at) - timestampNumber(left.updated_at)
    ));
  }
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
    // Server-side transcript SHRINK (context clear, compression, bulk
    // retraction) is authoritative: when a full snapshot reports fewer
    // messages than the cache holds, replace the local transcript instead
    // of union-merging deleted history back in. The reset helper still
    // preserves optimistic in-flight messages.
    const cachedMessages = summary.messages?.length || 0;
    const serverCount = Math.max(numberValue(full.message_count), full.messages.length);
    if (full.messages.length > 0 && cachedMessages > serverCount) {
      return resetCachedConversationTranscript(index, {
        ...summary,
        ...full,
        message_count: serverCount,
      }).find(({ id }) => id === summary.id) ?? cloneCachedConversation(summary);
    }
    return cloneCachedConversation({
      ...summary,
      ...full,
      message_count: Math.max(numberValue(full.message_count), full.messages.length),
    });
  });
}

export function replaceCachedConversationSnapshot(
  conversations: readonly SingleConversation[],
  conversation: SingleConversation,
  replacedId = '',
): SingleConversation[] {
  const authoritative = {
    ...conversation,
    message_count: Math.max(
      numberValue(conversation.message_count),
      conversation.messages.length,
    ),
  };
  return [
    cloneCachedConversation(authoritative),
    ...conversations.filter((item) => (
      item.id !== conversation.id && (!replacedId || item.id !== replacedId)
    )).map(cloneCachedConversation),
  ].sort((left, right) => numberValue(right.updated_at) - numberValue(left.updated_at));
}

export function mergeCachedConversationUpdate(
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

/**
 * Authoritative transcript reset for a cached conversation.
 *
 * The ordinary merge is union/max so live optimistic messages survive a
 * concurrent download. But some server transitions legitimately SHRINK the
 * transcript — context clearing, compression, and post-retraction
 * reconciliation. Callers that just observed such a transition pass the fresh
 * server snapshot here: local messages that the snapshot no longer contains
 * are dropped instead of resurrecting at the next sync, with one exception —
 * optimistic messages still awaiting their server echo are preserved so an
 * in-flight send cannot be silently erased by a refresh.
 */
export function resetCachedConversationTranscript(
  conversations: readonly SingleConversation[],
  conversation: SingleConversation,
  replacedId = '',
): SingleConversation[] {
  const existing = conversations.find(({ id }) => id === conversation.id);
  const pendingOptimistic = (existing?.messages || [])
    .filter((message) => isOptimisticPendingMessage(message))
    .filter((message) => !conversation.messages.some((server) => server.id === message.id));
  const authoritative = {
    ...conversation,
    messages: [...conversation.messages, ...pendingOptimistic].map(cloneCollaborationMessage),
    message_count: Math.max(
      numberValue(conversation.message_count),
      conversation.messages.length,
    ),
  };
  return [
    cloneCachedConversation(authoritative),
    ...conversations.filter((item) => (
      item.id !== conversation.id && (!replacedId || item.id !== replacedId)
    )).map(cloneCachedConversation),
  ].sort((left, right) => numberValue(right.updated_at) - numberValue(left.updated_at));
}

function isOptimisticPendingMessage(message: CollaborationMessage): boolean {
  const meta = (message as unknown as { meta?: unknown }).meta;
  if (meta && typeof meta === 'object' && (meta as Record<string, unknown>).optimistic === true) {
    return true;
  }
  const delivery = (message as unknown as { deliveryStatus?: unknown }).deliveryStatus;
  return delivery === 'pending' || delivery === 'failed';
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
  const pendingDeletionIds = await store.readPendingConversationDeletionIds?.(owner)
    || new Set<string>();
  // A process can die after the durable delete intent is written but before
  // the row-level cache prune finishes. Filter both sides before reconciliation
  // so preserveLocalOnly cannot resurrect that tombstoned row on restart.
  const localConversations = (cached?.conversations || [])
    .filter(({ id }) => !pendingDeletionIds.has(id));
  const reconciliation = reconcileConversationCache(
    localConversations,
    remote.conversations.filter(({ id }) => !pendingDeletionIds.has(id)),
    true,
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
        // Keep the summary-plus-local-transcript fallback in the index. The
        // next refresh will retry this detail without destroying offline
        // history or making an otherwise usable cache appear incomplete.
        return null;
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
  return isRecord(error) && (
    error.status === 404
    || error.status === 410
    || error.statusCode === 404
    || error.statusCode === 410
  );
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
