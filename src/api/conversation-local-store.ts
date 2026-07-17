import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  HermesCloudApi,
  HostedTurnEnqueueInput,
  JsonRecord,
  SingleConversation,
} from './HermesCloudApi';

const CACHE_VERSION = 1 as const;
const CACHE_PREFIX = 'hermes.native.conversations.v1';
const OUTBOX_VERSION = 1 as const;
const OUTBOX_PREFIX = 'hermes.native.hosted-turn-outbox.v1';
const ROOM_OUTBOX_VERSION = 1 as const;
const ROOM_OUTBOX_PREFIX = 'hermes.native.collaboration-room-outbox.v1';
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

export interface HostedTurnOutboxItem {
  conversationId: string;
  conversationPending?: boolean;
  conversationProfile?: string;
  conversationTitle?: string;
  input: HostedTurnEnqueueInput;
  pendingAttachments?: HostedTurnPendingAttachment[];
  queuedAt: number;
}

export interface HostedTurnPendingAttachment {
  id: string;
  kind: 'file' | 'image';
  mimeType?: string | null;
  name: string;
  size?: number | null;
  uri: string;
  uploaded?: JsonRecord;
}

export interface CollaborationRoomOutboxItem {
  content: string;
  profiles: string[];
  queuedAt: number;
  requestId: string;
  roomId: string;
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
    const raw = await readCurrentOrLegacy(
      this.storage,
      cacheKey(normalizedOwner),
      legacyCacheKey(normalizedOwner),
    );
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

  async readPendingEnqueues(owner: string): Promise<HostedTurnOutboxItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return [];
    const raw = await readCurrentOrLegacy(
      this.storage,
      outboxKey(normalizedOwner),
      legacyOutboxKey(normalizedOwner),
    );
    return parsePendingEnqueues(raw, normalizedOwner);
  }

  async upsertPendingEnqueue(owner: string, item: HostedTurnOutboxItem): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    if (!normalizedOwner || !normalizedItem) return;
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const next = current.filter(({ input }) => input.requestId !== normalizedItem.input.requestId);
      next.push(normalizedItem);
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
    });
  }

  async removePendingEnqueue(owner: string, requestId: string): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRequestId = stringValue(requestId);
    if (!normalizedOwner || !normalizedRequestId) return;
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const next = current.filter(({ input }) => input.requestId !== normalizedRequestId);
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
    });
  }

  async readPendingRoomMessages(owner: string): Promise<CollaborationRoomOutboxItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return [];
    return parsePendingRoomMessages(
      await readCurrentOrLegacy(
        this.storage,
        roomOutboxKey(normalizedOwner),
        legacyRoomOutboxKey(normalizedOwner),
      ),
      normalizedOwner,
    );
  }

  async upsertPendingRoomMessage(
    owner: string,
    item: CollaborationRoomOutboxItem,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingRoomMessage(item);
    if (!normalizedOwner || !normalizedItem) return;
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingRoomMessages(
        await readCurrentOrLegacy(
          this.storage,
          roomOutboxKey(normalizedOwner),
          legacyRoomOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const next = current.filter(({ requestId }) => requestId !== normalizedItem.requestId);
      next.push(normalizedItem);
      await this.storage.setItem(roomOutboxKey(normalizedOwner), JSON.stringify({
        version: ROOM_OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
    });
  }

  async removePendingRoomMessage(owner: string, requestId: string): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRequestId = stringValue(requestId);
    if (!normalizedOwner || !normalizedRequestId) return;
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingRoomMessages(
        await readCurrentOrLegacy(
          this.storage,
          roomOutboxKey(normalizedOwner),
          legacyRoomOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      await this.storage.setItem(roomOutboxKey(normalizedOwner), JSON.stringify({
        version: ROOM_OUTBOX_VERSION,
        owner: normalizedOwner,
        items: current.filter(({ requestId: currentId }) => currentId !== normalizedRequestId),
      }));
    });
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
  return `${CACHE_PREFIX}.${ownerStorageKey(owner)}`;
}

function outboxKey(owner: string): string {
  return `${OUTBOX_PREFIX}.${ownerStorageKey(owner)}`;
}

function roomOutboxKey(owner: string): string {
  return `${ROOM_OUTBOX_PREFIX}.${ownerStorageKey(owner)}`;
}

function legacyCacheKey(owner: string): string {
  return `${CACHE_PREFIX}.${legacyOwnerHash(owner)}`;
}

function legacyOutboxKey(owner: string): string {
  return `${OUTBOX_PREFIX}.${legacyOwnerHash(owner)}`;
}

function legacyRoomOutboxKey(owner: string): string {
  return `${ROOM_OUTBOX_PREFIX}.${legacyOwnerHash(owner)}`;
}

function ownerStorageKey(owner: string): string {
  let encoded = 'u';
  for (let index = 0; index < owner.length; index += 1) {
    encoded += owner.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return encoded;
}

function legacyOwnerHash(owner: string): string {
  let hash = 0x811c9dc5;
  for (const character of owner) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

async function readCurrentOrLegacy(
  storage: ConversationStorageAdapter,
  currentKey: string,
  legacyKey: string,
): Promise<string | null> {
  return (await storage.getItem(currentKey)) ?? storage.getItem(legacyKey);
}

function parsePendingEnqueues(raw: string | null, owner: string): HostedTurnOutboxItem[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== OUTBOX_VERSION) return [];
    if (normalizeOwner(value.owner) !== owner || !Array.isArray(value.items)) return [];
    return value.items.flatMap((item) => {
      const normalized = normalizePendingEnqueue(item);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

function normalizePendingEnqueue(value: unknown): HostedTurnOutboxItem | null {
  if (!isRecord(value) || !isRecord(value.input)) return null;
  const conversationId = stringValue(value.conversationId);
  const requestId = stringValue(value.input.requestId);
  const turnId = stringValue(value.input.turnId);
  const conversationProfile = stringValue(value.conversationProfile) || 'default';
  if (!requestId || !turnId || !isRecord(value.input.message)) return null;
  const messageId = stringValue(value.input.message.id);
  const content = stringValue(value.input.message.content);
  const role = stringValue(value.input.message.role);
  if (!messageId || !content || !role || !Array.isArray(value.input.recentMessages)) return null;
  const input = {
    ...value.input,
    requestId,
    turnId,
    message: { ...value.input.message, id: messageId, content, role },
    profiles: Array.isArray(value.input.profiles)
      ? value.input.profiles.flatMap((entry) => stringValue(entry) || [])
      : [],
    recentMessages: value.input.recentMessages.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const recentContent = stringValue(entry.content);
      const recentRole = stringValue(entry.role);
      return recentContent && recentRole ? [{ content: recentContent, role: recentRole }] : [];
    }),
    attachmentIds: Array.isArray(value.input.attachmentIds)
      ? value.input.attachmentIds.flatMap((entry) => stringValue(entry) || [])
      : [],
    attachmentContext: stringValue(value.input.attachmentContext),
    deliveryContext: stringValue(value.input.deliveryContext),
  } as HostedTurnEnqueueInput;
  return {
    conversationId,
    conversationPending: Boolean(value.conversationPending),
    conversationProfile,
    conversationTitle: stringValue(value.conversationTitle),
    input,
    pendingAttachments: Array.isArray(value.pendingAttachments)
      ? value.pendingAttachments.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const id = stringValue(entry.id);
        const kind = entry.kind === 'image' ? 'image' : entry.kind === 'file' ? 'file' : '';
        const name = stringValue(entry.name);
        const uri = stringValue(entry.uri);
        if (!id || !kind || !name || !uri) return [];
        return [{
          id,
          kind,
          mimeType: stringValue(entry.mimeType) || null,
          name,
          size: numberValue(entry.size) || null,
          uri,
          ...(isRecord(entry.uploaded) ? { uploaded: { ...entry.uploaded } } : {}),
        } as HostedTurnPendingAttachment];
      })
      : [],
    queuedAt: numberValue(value.queuedAt) || Date.now(),
  };
}

function parsePendingRoomMessages(
  raw: string | null,
  owner: string,
): CollaborationRoomOutboxItem[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== ROOM_OUTBOX_VERSION) return [];
    if (normalizeOwner(value.owner) !== owner || !Array.isArray(value.items)) return [];
    return value.items.flatMap((item) => {
      const normalized = normalizePendingRoomMessage(item);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

function normalizePendingRoomMessage(value: unknown): CollaborationRoomOutboxItem | null {
  if (!isRecord(value)) return null;
  const content = stringValue(value.content);
  const requestId = stringValue(value.requestId);
  const roomId = stringValue(value.roomId);
  if (!content || !requestId || !roomId) return null;
  return {
    content,
    profiles: Array.isArray(value.profiles)
      ? value.profiles.flatMap((profile) => stringValue(profile) || [])
      : [],
    queuedAt: numberValue(value.queuedAt) || Date.now(),
    requestId,
    roomId,
  };
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
