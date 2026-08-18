import type { SingleConversation } from './HermesCloudApi';
import { readConversationDeleteIds } from './conversation-delete-outbox';
import type {
  ConversationCacheSnapshot,
  ConversationStorageAdapter,
} from './conversation-store-types';
import {
  conversationStorageKey,
  isRecord,
  legacyOwnerHash,
  normalizeOwner,
  numberValue,
  ownerStorageKey,
  stringValue,
} from './conversation-storage-primitives';
import {
  advanceConversationSynchronization,
  awaitConversationStorageWrites,
  captureConversationStorageEpoch,
  captureConversationDeletionRevision,
  enqueueConversationStorageMaintenance,
  enqueueConversationStorageWrite,
  hasPendingConversationStorageWrite,
  isConversationStorageEpochCurrent,
  isConversationSynchronizationCurrent,
} from './conversation-storage-coordinator';

export const CONVERSATION_CACHE_VERSION = 4 as const;
const CACHE_PREFIX = 'hermes.native.conversations.v4';
const BLOB_CACHE_VERSION = 3 as const;
const BLOB_CACHE_PREFIX = 'hermes.native.conversations.v3';
const PREVIOUS_CACHE_PREFIX = 'hermes.native.conversations.v2';
const LEGACY_CACHE_PREFIX = 'hermes.native.conversations.v1';

interface ConversationCacheIndex {
  activeConversationId: string;
  conversationIds: string[];
  syncedAt: number;
}

interface ConversationCacheState {
  rowStamps: Map<string, Map<string, string>>;
  stampEpochs: Map<string, number>;
  retiredBlobOwners: Set<string>;
}

const statesByStorage = new WeakMap<object, ConversationCacheState>();

function stateFor(storage: ConversationStorageAdapter): ConversationCacheState {
  const storageObject = storage as object;
  const existing = statesByStorage.get(storageObject);
  if (existing) return existing;
  const created: ConversationCacheState = {
    rowStamps: new Map(),
    stampEpochs: new Map(),
    retiredBlobOwners: new Set(),
  };
  statesByStorage.set(storageObject, created);
  return created;
}

/** Sharded account conversation cache with cross-facade write coordination. */
export class ConversationCacheRepository {
  private readonly state: ConversationCacheState;
  private readonly observedRowStamps = new Map<string, Map<string, string>>();
  private readonly observedRows = new Map<string, Map<string, SingleConversation>>();

  constructor(private readonly storage: ConversationStorageAdapter) {
    this.state = stateFor(storage);
  }

  async read(owner: string): Promise<ConversationCacheSnapshot | null> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return null;
    // A cold-start reader must not capture the pre-write index while another
    // facade is still persisting a newer transcript for this owner.
    await awaitConversationStorageWrites(normalizedOwner);
    // v1/v2 were account-keyed snapshots before the v4 sharded layout. Read
    // and validate them before touching the old keys. A successful v4 write
    // is the commit point; cleanup is best-effort and therefore cannot make
    // an otherwise usable offline history disappear.
    const legacyFallback = await this.migrateLegacySnapshot(normalizedOwner);
    const epoch = this.state.stampEpochs.get(normalizedOwner) || 0;
    const index = parseCacheIndex(
      await this.storage.getItem(cacheKey(normalizedOwner)),
      normalizedOwner,
    );
    if (index) {
      const rows = await Promise.all(index.conversationIds.map(async (id) => parseCacheRow(
        await this.storage.getItem(rowKey(normalizedOwner, id)),
        normalizedOwner,
        id,
      )));
      const conversations = rows.filter(
        (conversation): conversation is SingleConversation => conversation !== null,
      );
      if (
        (this.state.stampEpochs.get(normalizedOwner) || 0) === epoch
        && !hasPendingConversationStorageWrite(normalizedOwner)
      ) {
        const stamps = this.sharedRowStamps(normalizedOwner);
        const observed = this.ownerObservedRowStamps(normalizedOwner);
        const observedRows = this.ownerObservedRows(normalizedOwner);
        observed.clear();
        observedRows.clear();
        for (const conversation of conversations) {
          const stamp = conversationRevisionStamp(conversation);
          stamps.set(conversation.id, stamp);
          observed.set(conversation.id, stamp);
          observedRows.set(conversation.id, cloneCachedConversation(conversation));
        }
      }
      return {
        version: CONVERSATION_CACHE_VERSION,
        owner: normalizedOwner,
        activeConversationId: index.activeConversationId,
        conversations,
        syncedAt: index.syncedAt,
      };
    }
    return parseBlobSnapshot(
      await this.storage.getItem(blobCacheKey(normalizedOwner)),
      normalizedOwner,
    ) || legacyFallback;
  }

  /**
   * Migrate the account-scoped v1/v2 snapshots exactly once. Legacy v1 had
   * both an encoded-owner key and a hash key; the payload owner is mandatory
   * for both so a hash collision can never make one account consume another's
   * transcript. Old keys are removed only after the v4 index write succeeds.
   */
  private async migrateLegacySnapshot(owner: string): Promise<ConversationCacheSnapshot | null> {
    let fallback: ConversationCacheSnapshot | null = null;
    await enqueueConversationStorageMaintenance(owner, async () => {
      const currentIndex = parseCacheIndex(
        await this.storage.getItem(cacheKey(owner)),
        owner,
      );
      const legacyKeys = [
        previousCacheKey(owner),
        legacyEncodedCacheKey(owner),
        legacyHashedCacheKey(owner),
      ];
      const entries = await Promise.all(legacyKeys.map(async (key) => ({
        key,
        raw: await this.storage.getItem(key),
      })));
      const valid = entries.flatMap(({ key, raw }) => {
        const version = key.startsWith(`${PREVIOUS_CACHE_PREFIX}.`) ? 2 : 1;
        const snapshot = parseLegacySnapshot(raw, owner, version);
        return snapshot ? [{ key, snapshot }] : [];
      });

      // A valid v4 index is already authoritative. We can discard only
      // validated legacy records for this owner; a colliding hash key with a
      // different/malformed payload is intentionally left for its owner.
      if (currentIndex) {
        await Promise.allSettled(valid.map(({ key }) => this.storage.removeItem(key)));
        return;
      }
      if (!valid.length) return;

      fallback = mergeLegacySnapshots(valid.map(({ snapshot }) => snapshot), owner);
      try {
        await this.persistSnapshot(
          owner,
          fallback.conversations,
          fallback.activeConversationId,
        );
      } catch {
        // Keep the validated legacy snapshot readable while a storage write
        // is temporarily unavailable. Crucially, no old key is removed here.
        return;
      }

      const migratedIndex = parseCacheIndex(
        await this.storage.getItem(cacheKey(owner)),
        owner,
      );
      if (!migratedIndex) return;
      await Promise.allSettled(valid.map(({ key }) => this.storage.removeItem(key)));
    });
    return fallback;
  }

  async write(
    owner: string,
    conversations: readonly SingleConversation[],
    activeConversationId: string,
    expectedEpoch?: number,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return;
    const epoch = expectedEpoch ?? captureConversationStorageEpoch(normalizedOwner);
    if (!isConversationStorageEpochCurrent(normalizedOwner, epoch)) return;
    advanceConversationSynchronization(normalizedOwner);
    const cloned = conversations.map(cloneCachedConversation);
    await enqueueConversationStorageWrite(normalizedOwner, () => this.persistSnapshot(
      normalizedOwner,
      cloned,
      activeConversationId,
    ), epoch);
  }

  /** Update one row inside the owner queue without replacing a stale index. */
  async upsert(
    owner: string,
    conversation: SingleConversation,
    activeConversationId = '',
    expectedEpoch?: number,
    expectedDeletionRevision?: number,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return;
    const epoch = expectedEpoch ?? captureConversationStorageEpoch(normalizedOwner);
    if (
      !isConversationStorageEpochCurrent(normalizedOwner, epoch)
      || (
        expectedDeletionRevision !== undefined
        && captureConversationDeletionRevision(normalizedOwner) !== expectedDeletionRevision
      )
    ) return;
    advanceConversationSynchronization(normalizedOwner);
    await enqueueConversationStorageWrite(normalizedOwner, async () => {
      if (
        expectedDeletionRevision !== undefined
        && captureConversationDeletionRevision(normalizedOwner) !== expectedDeletionRevision
      ) return;
      const current = await this.readSnapshotForMutation(normalizedOwner);
      const existing = current?.conversations.find(({ id }) => id === conversation.id);
      const nextConversation = existing
        ? mergeConcurrentConversation(existing, conversation)
        : cloneCachedConversation(conversation);
      const conversations = [
        nextConversation,
        ...(current?.conversations || []).filter(({ id }) => id !== conversation.id),
      ];
      await this.persistSnapshot(
        normalizedOwner,
        conversations,
        current?.activeConversationId || activeConversationId,
      );
    }, epoch);
  }

  /**
   * Remove conversations from the device cache without waiting for the cloud.
   * The mutation is serialized with ordinary cache writes, so an in-flight
   * refresh cannot reinsert a row after the local delete has committed.
   */
  async remove(
    owner: string,
    conversationIds: readonly string[],
    activeConversationId = '',
    expectedEpoch?: number,
  ): Promise<ConversationCacheSnapshot | null> {
    const normalizedOwner = normalizeOwner(owner);
    const ids = new Set(conversationIds.map(stringValue).filter(Boolean));
    if (!normalizedOwner || !ids.size) return this.read(normalizedOwner);
    const epoch = expectedEpoch ?? captureConversationStorageEpoch(normalizedOwner);
    if (!isConversationStorageEpochCurrent(normalizedOwner, epoch)) return null;
    advanceConversationSynchronization(normalizedOwner);
    let removed: ConversationCacheSnapshot | null = null;
    await enqueueConversationStorageWrite(normalizedOwner, async () => {
      const current = await this.readSnapshotForMutation(normalizedOwner);
      if (!current) return;
      const existingIds = current.conversations.map(({ id }) => id);
      const conversations = current.conversations.filter(({ id }) => !ids.has(id));
      const requestedActive = stringValue(activeConversationId);
      const nextActive = ids.has(current.activeConversationId)
        ? (conversations.some(({ id }) => id === requestedActive)
          ? requestedActive
          : conversations[0]?.id || '')
        : current.activeConversationId;
      await this.persistSnapshot(normalizedOwner, conversations, nextActive);
      // `persistSnapshot` can only remove rows observed by its stamp map. A
      // cold process may not have observed the index yet, so explicitly clean
      // every row that was present in the mutation snapshot as well.
      const remainingIds = new Set(conversations.map(({ id }) => id));
      await Promise.all(existingIds
        .filter((id) => !remainingIds.has(id))
        .map((id) => this.storage.removeItem(rowKey(normalizedOwner, id))));
      removed = {
        version: CONVERSATION_CACHE_VERSION,
        owner: normalizedOwner,
        activeConversationId: nextActive,
        conversations: conversations.map(cloneCachedConversation),
        syncedAt: Date.now(),
      };
    }, epoch);
    return removed;
  }

  beginSynchronization(owner: string): number {
    const normalizedOwner = normalizeOwner(owner);
    return normalizedOwner ? advanceConversationSynchronization(normalizedOwner) : 0;
  }

  async writeSynchronized(
    owner: string,
    generation: number,
    conversations: readonly SingleConversation[],
    activeConversationId: string,
  ): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    if (
      !normalizedOwner
      || !isConversationSynchronizationCurrent(normalizedOwner, generation)
    ) return false;
    const cloned = conversations.map(cloneCachedConversation);
    let wrote = false;
    await enqueueConversationStorageWrite(normalizedOwner, async () => {
      if (!isConversationSynchronizationCurrent(normalizedOwner, generation)) return;
      await this.persistSnapshot(normalizedOwner, cloned, activeConversationId);
      wrote = true;
    });
    return wrote;
  }

  async purge(
    owner: string,
    additionalKeys: readonly string[],
    beforeRemove?: () => Promise<void>,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return;
    advanceConversationSynchronization(normalizedOwner);
    await enqueueConversationStorageMaintenance(normalizedOwner, async () => {
      await beforeRemove?.();
      const index = parseCacheIndex(
        await this.storage.getItem(cacheKey(normalizedOwner)),
        normalizedOwner,
      );
      const rowIds = new Set([
        ...(index?.conversationIds || []),
        ...(this.state.rowStamps.get(normalizedOwner)?.keys() || []),
      ]);
      this.bumpStampEpoch(normalizedOwner);
      this.state.rowStamps.delete(normalizedOwner);
      this.observedRowStamps.delete(normalizedOwner);
      this.observedRows.delete(normalizedOwner);
      this.state.retiredBlobOwners.delete(normalizedOwner);
      await Promise.all([
        cacheKey(normalizedOwner),
        ...[...rowIds].map((id) => rowKey(normalizedOwner, id)),
        blobCacheKey(normalizedOwner),
        previousCacheKey(normalizedOwner),
        legacyEncodedCacheKey(normalizedOwner),
        legacyHashedCacheKey(normalizedOwner),
        ...additionalKeys,
      ].map((key) => this.storage.removeItem(key)));
    });
  }

  private sharedRowStamps(owner: string): Map<string, string> {
    const existing = this.state.rowStamps.get(owner);
    if (existing) return existing;
    const created = new Map<string, string>();
    this.state.rowStamps.set(owner, created);
    return created;
  }

  private ownerObservedRowStamps(owner: string): Map<string, string> {
    const existing = this.observedRowStamps.get(owner);
    if (existing) return existing;
    const created = new Map<string, string>();
    this.observedRowStamps.set(owner, created);
    return created;
  }

  private ownerObservedRows(owner: string): Map<string, SingleConversation> {
    const existing = this.observedRows.get(owner);
    if (existing) return existing;
    const created = new Map<string, SingleConversation>();
    this.observedRows.set(owner, created);
    return created;
  }

  private bumpStampEpoch(owner: string): void {
    this.state.stampEpochs.set(owner, (this.state.stampEpochs.get(owner) || 0) + 1);
  }

  private async persistSnapshot(
    owner: string,
    conversations: readonly SingleConversation[],
    activeConversationId: string,
  ): Promise<void> {
    const pendingIds = await readConversationDeleteIds(this.storage, owner);
    const visibleConversations = conversations.filter(({ id }) => !pendingIds.has(id));
    const visibleActiveId = pendingIds.has(activeConversationId)
      ? visibleConversations[0]?.id || ''
      : activeConversationId;
    this.bumpStampEpoch(owner);
    const stamps = this.sharedRowStamps(owner);
    const observed = this.ownerObservedRowStamps(owner);
    const observedRows = this.ownerObservedRows(owner);
    const currentIds = new Set<string>();
    let rowsChanged = false;
    for (const requestedConversation of visibleConversations) {
      currentIds.add(requestedConversation.id);
      const sharedStamp = stamps.get(requestedConversation.id);
      const observedStamp = observed.get(requestedConversation.id);
      let conversation = requestedConversation;
      if (sharedStamp && observedStamp && sharedStamp !== observedStamp) {
        const persisted = parseCacheRow(
          await this.storage.getItem(rowKey(owner, requestedConversation.id)),
          owner,
          requestedConversation.id,
        );
        if (persisted) {
          conversation = mergeConcurrentConversation(
            persisted,
            requestedConversation,
            observedRows.get(requestedConversation.id),
          );
        }
      }
      const stamp = conversationRevisionStamp(conversation);
      if (sharedStamp === stamp) {
        observed.set(conversation.id, stamp);
        observedRows.set(conversation.id, cloneCachedConversation(conversation));
        continue;
      }
      await this.storage.setItem(rowKey(owner, conversation.id), JSON.stringify({
        version: CONVERSATION_CACHE_VERSION,
        owner,
        conversation,
      }));
      rowsChanged = true;
      stamps.set(conversation.id, stamp);
      observed.set(conversation.id, stamp);
      observedRows.set(conversation.id, cloneCachedConversation(conversation));
    }
    const requestedIds = visibleConversations.map(({ id }) => id);
    const currentIndex = parseCacheIndex(
      await this.storage.getItem(cacheKey(owner)),
      owner,
    );
    const indexChanged = !currentIndex
      || currentIndex.activeConversationId !== visibleActiveId
      || currentIndex.conversationIds.length !== requestedIds.length
      || currentIndex.conversationIds.some((id, index) => id !== requestedIds[index]);
    if (rowsChanged || indexChanged) {
      await this.storage.setItem(cacheKey(owner), JSON.stringify({
        version: CONVERSATION_CACHE_VERSION,
        owner,
        activeConversationId: visibleActiveId,
        conversationIds: requestedIds,
        syncedAt: Date.now(),
      }));
    }
    for (const id of [...stamps.keys()]) {
      if (currentIds.has(id)) continue;
      stamps.delete(id);
      observed.delete(id);
      observedRows.delete(id);
      await this.storage.removeItem(rowKey(owner, id));
    }
    if (!this.state.retiredBlobOwners.has(owner)) {
      this.state.retiredBlobOwners.add(owner);
      try {
        await this.storage.removeItem(blobCacheKey(owner));
      } catch {
        // v4 reads never consult the blob once the index exists.
      }
    }
  }

  /** Read the current v4/blob snapshot while already inside the owner queue. */
  private async readSnapshotForMutation(owner: string): Promise<ConversationCacheSnapshot | null> {
    const index = parseCacheIndex(
      await this.storage.getItem(cacheKey(owner)),
      owner,
    );
    if (index) {
      const rows = await Promise.all(index.conversationIds.map(async (id) => parseCacheRow(
        await this.storage.getItem(rowKey(owner, id)),
        owner,
        id,
      )));
      return {
        version: CONVERSATION_CACHE_VERSION,
        owner,
        activeConversationId: index.activeConversationId,
        conversations: rows.filter(
          (conversation): conversation is SingleConversation => conversation !== null,
        ),
        syncedAt: index.syncedAt,
      };
    }
    return parseBlobSnapshot(
      await this.storage.getItem(blobCacheKey(owner)),
      owner,
    );
  }
}

function mergeConcurrentConversation(
  persisted: SingleConversation,
  incoming: SingleConversation,
  observed?: SingleConversation,
): SingleConversation {
  const persistedRevision = timestampNumber(persisted.updated_at);
  const incomingRevision = timestampNumber(incoming.updated_at);
  const newest = incomingRevision >= persistedRevision ? incoming : persisted;
  const messages = new Map(incoming.messages.map((message) => [message.id, message]));
  const observedMessages = new Map(observed?.messages.map((message) => [message.id, message]));
  for (const message of persisted.messages) {
    const incomingMessage = messages.get(message.id);
    if (incomingMessage) {
      if (messageRevision(message) > messageRevision(incomingMessage)) {
        messages.set(message.id, message);
      }
      continue;
    }
    const observedMessage = observedMessages.get(message.id);
    if (!observedMessage || messageRevision(message) > messageRevision(observedMessage)) {
      messages.set(message.id, message);
    }
  }
  return cloneCachedConversation({
    ...persisted,
    ...incoming,
    ...newest,
    messages: [...messages.values()].sort(
      (left, right) => messageRevision(left) - messageRevision(right),
    ),
    message_count: Math.max(numberValue(newest.message_count), messages.size),
    runtime_sessions: {
      ...(persisted.runtime_sessions || {}),
      ...(incoming.runtime_sessions || {}),
    },
    runtime_runs: {
      ...(persisted.runtime_runs || {}),
      ...(incoming.runtime_runs || {}),
    },
    hosted_turns: {
      ...(persisted.hosted_turns || {}),
      ...(incoming.hosted_turns || {}),
    },
  });
}

function messageRevision(message: SingleConversation['messages'][number]): number {
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

export function cloneCachedConversation(conversation: SingleConversation): SingleConversation {
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
    ...(conversation.participants
      ? { participants: conversation.participants.map((participant) => ({ ...participant })) }
      : {}),
    ...(conversation.room_agents
      ? { room_agents: conversation.room_agents.map((agent) => ({ ...agent })) }
      : {}),
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

function parseCacheIndex(raw: string | null, owner: string): ConversationCacheIndex | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== CONVERSATION_CACHE_VERSION) return null;
    if (normalizeOwner(value.owner) !== owner || !Array.isArray(value.conversationIds)) return null;
    return {
      activeConversationId: stringValue(value.activeConversationId),
      conversationIds: value.conversationIds.map(stringValue).filter(Boolean),
      syncedAt: numberValue(value.syncedAt),
    };
  } catch {
    return null;
  }
}

function parseCacheRow(
  raw: string | null,
  owner: string,
  conversationId: string,
): SingleConversation | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== CONVERSATION_CACHE_VERSION) return null;
    if (normalizeOwner(value.owner) !== owner) return null;
    const [conversation] = normalizeConversation(value.conversation);
    return conversation?.id === conversationId ? conversation : null;
  } catch {
    return null;
  }
}

function parseBlobSnapshot(raw: string | null, owner: string): ConversationCacheSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== BLOB_CACHE_VERSION) return null;
    if (normalizeOwner(value.owner) !== owner || !Array.isArray(value.conversations)) return null;
    return {
      version: CONVERSATION_CACHE_VERSION,
      owner,
      activeConversationId: stringValue(value.activeConversationId),
      conversations: value.conversations.flatMap(normalizeConversation),
      syncedAt: numberValue(value.syncedAt),
    };
  } catch {
    return null;
  }
}

function parseLegacySnapshot(
  raw: string | null,
  owner: string,
  version: 1 | 2,
): ConversationCacheSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== version) return null;
    if (normalizeOwner(value.owner) !== owner || !Array.isArray(value.conversations)) return null;
    const conversations = value.conversations.flatMap(normalizeConversation);
    // A non-empty legacy array that normalizes to no rows is corruption, not
    // an empty account. Keeping the source key lets a later build retry a
    // safer migration instead of silently deleting the only copy.
    if (value.conversations.length > 0 && conversations.length === 0) return null;
    return {
      version: CONVERSATION_CACHE_VERSION,
      owner,
      activeConversationId: stringValue(value.activeConversationId),
      conversations,
      syncedAt: numberValue(value.syncedAt),
    };
  } catch {
    return null;
  }
}

function mergeLegacySnapshots(
  snapshots: readonly ConversationCacheSnapshot[],
  owner: string,
): ConversationCacheSnapshot {
  // Newer schema/revision wins ties, while distinct rows from the encoded and
  // hashed v1 keys are retained instead of silently dropping local history.
  const ordered = [...snapshots].sort((left, right) => (
    left.version - right.version || left.syncedAt - right.syncedAt
  ));
  const conversationsById = new Map<string, SingleConversation>();
  for (const snapshot of ordered) {
    for (const conversation of snapshot.conversations) {
      const existing = conversationsById.get(conversation.id);
      conversationsById.set(
        conversation.id,
        existing ? mergeConcurrentConversation(existing, conversation) : cloneCachedConversation(conversation),
      );
    }
  }
  const conversations = [...conversationsById.values()].sort(
    (left, right) => timestampNumber(right.updated_at) - timestampNumber(left.updated_at),
  );
  const newest = [...ordered].reverse().find((snapshot) => (
    snapshot.activeConversationId && conversationsById.has(snapshot.activeConversationId)
  ));
  return {
    version: CONVERSATION_CACHE_VERSION,
    owner,
    activeConversationId: newest?.activeConversationId || conversations[0]?.id || '',
    conversations,
    syncedAt: Math.max(0, ...snapshots.map((snapshot) => snapshot.syncedAt)),
  };
}

function conversationRevisionStamp(conversation: SingleConversation): string {
  const serialized = JSON.stringify(conversation);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${serialized.length}:${(hash >>> 0).toString(16)}`;
}

function cacheKey(owner: string): string {
  return `${CACHE_PREFIX}.${ownerStorageKey(owner)}`;
}

function rowKey(owner: string, conversationId: string): string {
  return `${CACHE_PREFIX}.${ownerStorageKey(owner)}.row.${conversationStorageKey(conversationId)}`;
}

function blobCacheKey(owner: string): string {
  return `${BLOB_CACHE_PREFIX}.${ownerStorageKey(owner)}`;
}

function previousCacheKey(owner: string): string {
  return `${PREVIOUS_CACHE_PREFIX}.${ownerStorageKey(owner)}`;
}

function legacyEncodedCacheKey(owner: string): string {
  return `${LEGACY_CACHE_PREFIX}.${ownerStorageKey(owner)}`;
}

function legacyHashedCacheKey(owner: string): string {
  return `${LEGACY_CACHE_PREFIX}.${legacyOwnerHash(owner)}`;
}
