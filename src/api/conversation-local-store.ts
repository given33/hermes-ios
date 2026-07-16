import AsyncStorage from '@react-native-async-storage/async-storage';

import type { HermesCloudApi, SingleConversation } from './HermesCloudApi';

const CACHE_VERSION = 1 as const;
const CACHE_PREFIX = 'hermes.native.conversations.v1';
const cacheWriteChains = new Map<string, Promise<void>>();
const synchronizationGenerations = new Map<string, number>();

export interface ConversationCacheSnapshot {
  version: typeof CACHE_VERSION;
  owner: string;
  activeConversationId: string;
  conversations: SingleConversation[];
  syncedAt: number;
}

export interface ConversationCacheReconciliation {
  conversations: SingleConversation[];
  downloadIds: string[];
}

export interface ConversationStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export class ConversationLocalStore {
  constructor(private readonly storage: ConversationStorageAdapter = AsyncStorage) {}

  async read(owner: string): Promise<ConversationCacheSnapshot | null> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return null;
    const raw = await this.storage.getItem(cacheKey(normalizedOwner));
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as unknown;
      if (!isRecord(value) || value.version !== CACHE_VERSION) return null;
      if (normalizeOwner(value.owner) !== normalizedOwner) return null;
      if (!Array.isArray(value.conversations)) return null;
      return {
        version: CACHE_VERSION,
        owner: normalizedOwner,
        activeConversationId: stringValue(value.activeConversationId),
        conversations: value.conversations.flatMap(normalizeConversation),
        syncedAt: numberValue(value.syncedAt),
      };
    } catch {
      return null;
    }
  }

  async write(
    owner: string,
    conversations: readonly SingleConversation[],
    activeConversationId: string,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return;
    const generation = advanceSynchronization(normalizedOwner);
    const snapshot: ConversationCacheSnapshot = {
      version: CACHE_VERSION,
      owner: normalizedOwner,
      activeConversationId,
      conversations: conversations.map(cloneConversation),
      syncedAt: Date.now(),
    };
    await enqueueCacheWrite(normalizedOwner, () => this.storage.setItem(
      cacheKey(normalizedOwner),
      JSON.stringify(snapshot),
    ));
  }

  beginSynchronization(owner: string): number {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return 0;
    return advanceSynchronization(normalizedOwner);
  }

  async writeSynchronized(
    owner: string,
    generation: number,
    conversations: readonly SingleConversation[],
    activeConversationId: string,
  ): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner || synchronizationGenerations.get(normalizedOwner) !== generation) {
      return false;
    }
    const snapshot: ConversationCacheSnapshot = {
      version: CACHE_VERSION,
      owner: normalizedOwner,
      activeConversationId,
      conversations: conversations.map(cloneConversation),
      syncedAt: Date.now(),
    };
    let wrote = false;
    await enqueueCacheWrite(normalizedOwner, async () => {
      if (synchronizationGenerations.get(normalizedOwner) !== generation) return;
      await this.storage.setItem(cacheKey(normalizedOwner), JSON.stringify(snapshot));
      wrote = true;
    });
    return wrote;
  }
}

export function reconcileConversationCache(
  local: readonly SingleConversation[],
  remote: readonly SingleConversation[],
): ConversationCacheReconciliation {
  const localById = new Map(local.map((conversation) => [conversation.id, conversation]));
  const downloadIds: string[] = [];
  const conversations = remote.map((summary) => {
    if (isOfficialPlaceholder(summary)) return cloneConversation(summary);
    const cached = localById.get(summary.id);
    if (cached && isCompleteConversation(cached) && sameRevision(cached, summary)) {
      return cloneConversation(cached);
    }
    downloadIds.push(summary.id);
    return cloneConversation(summary);
  });
  return { conversations, downloadIds };
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
    if (!full) return cloneConversation(summary);
    return cloneConversation({
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
    message_count: conversation.message_count
      ?? Math.max(numberValue(existing?.message_count), conversation.messages.length),
  };
  return [
    cloneConversation(merged),
    ...conversations.filter((item) => (
      item.id !== conversation.id && (!replacedId || item.id !== replacedId)
    )).map(cloneConversation),
  ].sort((left, right) => numberValue(right.updated_at) - numberValue(left.updated_at));
}

export function isCompleteConversation(conversation: SingleConversation): boolean {
  if (isOfficialPlaceholder(conversation)) return false;
  const expected = Math.max(0, numberValue(conversation.message_count));
  return conversation.messages.length >= expected;
}

export async function synchronizeConversationCache(
  api: HermesCloudApi,
  store: ConversationLocalStore,
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
  const downloaded = await mapWithConcurrency(
    reconciliation.downloadIds,
    4,
    async (id) => (await api.getConversation(id)).conversation,
  );
  const conversations = mergeDownloadedConversations(
    reconciliation.conversations,
    downloaded,
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
    version: CACHE_VERSION,
    owner: normalizeOwner(owner),
    activeConversationId,
    conversations,
    syncedAt: Date.now(),
  };
}

function sameRevision(left: SingleConversation, right: SingleConversation): boolean {
  return numberValue(left.updated_at) === numberValue(right.updated_at)
    && numberValue(left.message_count) === numberValue(right.message_count)
    && left.title === right.title
    && JSON.stringify(left.runtime_sessions || {}) === JSON.stringify(right.runtime_sessions || {});
}

function isOfficialPlaceholder(conversation: SingleConversation): boolean {
  return conversation.id.startsWith('official:');
}

function cloneConversation(conversation: SingleConversation): SingleConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      ...(message.meta ? { meta: { ...message.meta } } : {}),
    })),
    ...(conversation.runtime_sessions
      ? { runtime_sessions: { ...conversation.runtime_sessions } }
      : {}),
    ...(conversation.runtime_runs ? { runtime_runs: { ...conversation.runtime_runs } } : {}),
    ...(conversation.hosted_turns ? { hosted_turns: { ...conversation.hosted_turns } } : {}),
  };
}

function normalizeConversation(value: unknown): SingleConversation[] {
  if (!isRecord(value)) return [];
  const id = stringValue(value.id);
  if (!id || !Array.isArray(value.messages)) return [];
  return [{
    ...value,
    id,
    profile: stringValue(value.profile) || 'default',
    title: stringValue(value.title) || '未命名会话',
    messages: value.messages.flatMap((message) => {
      if (!isRecord(message)) return [];
      const messageId = stringValue(message.id);
      const role = stringValue(message.role);
      if (!messageId || !role) return [];
      return [{
        ...message,
        id: messageId,
        role,
        name: stringValue(message.name),
        content: stringValue(message.content),
      }];
    }),
  } as SingleConversation];
}

function cacheKey(owner: string): string {
  let hash = 0x811c9dc5;
  for (const character of owner) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${CACHE_PREFIX}.${(hash >>> 0).toString(16)}`;
}

function advanceSynchronization(owner: string): number {
  const next = (synchronizationGenerations.get(owner) || 0) + 1;
  synchronizationGenerations.set(owner, next);
  return next;
}

async function enqueueCacheWrite(owner: string, operation: () => Promise<void>): Promise<void> {
  const previous = cacheWriteChains.get(owner) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  cacheWriteChains.set(owner, next);
  try {
    await next;
  } finally {
    if (cacheWriteChains.get(owner) === next) cacheWriteChains.delete(owner);
  }
}

function normalizeOwner(value: unknown): string {
  return stringValue(value).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
