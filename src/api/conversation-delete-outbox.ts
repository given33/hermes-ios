import type {
  ConversationDeleteOutboxItem,
  ConversationStorageAdapter,
} from './conversation-store-types';
import {
  isRecord,
  normalizeOwner,
  numberValue,
  ownerStorageKey,
  stringValue,
} from './conversation-storage-primitives';
import type { ConversationSerializedWrite } from './conversation-room-outbox';
import {
  advanceConversationDeletionRevision,
  isConversationStorageEpochCurrent,
} from './conversation-storage-coordinator';

const DELETE_OUTBOX_VERSION = 1 as const;
const DELETE_OUTBOX_PREFIX = 'hermes.native.conversation-delete-outbox.v1';
let deleteLeaseSequence = 0;

/**
 * Persistent local-first deletion intent.
 *
 * A row is written before the local cache is pruned.  Replay must prune again
 * before invoking the remote callback, which makes a process kill between the
 * two local writes harmless and prevents a remote delete from ever racing a
 * stale local read.
 */
export class ConversationDeleteOutboxRepository {
  constructor(
    private readonly storage: ConversationStorageAdapter,
    private readonly runSerialized: ConversationSerializedWrite,
  ) {}

  async read(owner: string): Promise<ConversationDeleteOutboxItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return [];
    return parsePendingConversationDeletes(
      await this.storage.getItem(conversationDeleteOutboxKey(normalizedOwner)),
      normalizedOwner,
    );
  }

  /** Add or replace one deletion intent without losing an existing retry. */
  async enqueue(
    owner: string,
    item: ConversationDeleteOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<ConversationDeleteOutboxItem | null> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizeConversationDelete(item);
    if (!normalizedOwner || !normalizedItem) return null;
    if (
      expectedOwnerEpoch !== undefined
      && !isConversationStorageEpochCurrent(normalizedOwner, expectedOwnerEpoch)
    ) return null;
    advanceConversationDeletionRevision(normalizedOwner);
    let queued: ConversationDeleteOutboxItem | null = null;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findDelete(current, normalizedItem);
      // A repeated local delete should not reset backoff or steal a worker's
      // lease.  New metadata (for example a profile) may still be refreshed.
      queued = previous
        ? {
            ...previous,
            ...normalizedItem,
            attempts: Math.max(previous.attempts || 0, normalizedItem.attempts || 0),
            queuedAt: Math.min(previous.queuedAt, normalizedItem.queuedAt),
            ...(previous.leaseToken && !normalizedItem.leaseToken
              ? {
                  leaseExpiresAt: previous.leaseExpiresAt,
                  leaseOwner: previous.leaseOwner,
                  leaseToken: previous.leaseToken,
                }
              : {}),
          }
        : normalizedItem;
      await this.writeInTransaction(
        normalizedOwner,
        replaceDelete(current, queued),
      );
    }, expectedOwnerEpoch);
    // The revision is bumped before the queued write so readers that start
    // during the mutation cannot trust an older response. Bump it once more
    // after the commit as well: a reader may otherwise capture the first
    // revision in the small window before AsyncStorage exposes the tombstone,
    // then pass its final CAS after replay removes the row again.
    if (queued) advanceConversationDeletionRevision(normalizedOwner);
    return queued;
  }

  /** Claim ready rows so two foreground/restart workers cannot duplicate work. */
  async claimReady(
    owner: string,
    workerId: string,
    now = Date.now(),
    leaseMs = 60_000,
    limit = 8,
    expectedOwnerEpoch?: number,
    kinds?: readonly ConversationDeleteOutboxItem['kind'][],
  ): Promise<ConversationDeleteOutboxItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedWorker = stringValue(workerId).slice(0, 256);
    if (!normalizedOwner || !normalizedWorker) return [];
    let claimed: ConversationDeleteOutboxItem[] = [];
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const ready = selectReadyConversationDeleteOutboxItems(current, now, limit, kinds);
      if (!ready.length) return;
      const readyKeys = new Set(ready.map(deleteIdentity));
      const leaseExpiresAt = Math.max(now + 1, now + Math.max(1_000, leaseMs));
      const next = current.map((item) => {
        if (!readyKeys.has(deleteIdentity(item))) return item;
        const leased = {
          ...item,
          leaseExpiresAt,
          leaseOwner: normalizedWorker,
          leaseToken: `conversation-delete:${Date.now().toString(36)}:${++deleteLeaseSequence}`,
        };
        claimed.push(leased);
        return leased;
      });
      await this.writeInTransaction(normalizedOwner, next);
    }, expectedOwnerEpoch);
    return claimed;
  }

  /** Record a retry and release the row's lease for a later replay. */
  async markRetry(
    owner: string,
    item: ConversationDeleteOutboxItem,
    error: string,
    nextAttemptAt: number,
    expectedOwnerEpoch?: number,
  ): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizeConversationDelete(item);
    if (!normalizedOwner || !normalizedItem) return false;
    let updated = false;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findDelete(current, normalizedItem);
      if (!previous || !ownsDeleteLease(previous, normalizedItem)) return;
      const retry: ConversationDeleteOutboxItem = {
        ...previous,
        attempts: Math.max(
          (previous.attempts || 0) + 1,
          normalizedItem.attempts || 0,
        ),
        lastError: stringValue(error).slice(0, 2_000),
        nextAttemptAt: Math.max(0, numberValue(nextAttemptAt)),
        leaseExpiresAt: 0,
        leaseOwner: '',
        leaseToken: '',
      };
      await this.writeInTransaction(normalizedOwner, replaceDelete(current, retry));
      updated = true;
    }, expectedOwnerEpoch);
    return updated;
  }

  /** Remove a successfully delivered row, but only for its current lease. */
  async removeIfLeaseOwned(
    owner: string,
    item: ConversationDeleteOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizeConversationDelete(item);
    if (!normalizedOwner || !normalizedItem) return false;
    let removed = false;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findDelete(current, normalizedItem);
      if (!previous || !ownsDeleteLease(previous, normalizedItem)) return;
      await this.writeInTransaction(
        normalizedOwner,
        current.filter((candidate) => deleteIdentity(candidate) !== deleteIdentity(normalizedItem)),
      );
      removed = true;
    }, expectedOwnerEpoch);
    return removed;
  }

  /** Explicit removal is useful for a permanently invalid remote identity. */
  async remove(
    owner: string,
    item: ConversationDeleteOutboxItem | string,
    kind: ConversationDeleteOutboxItem['kind'] = 'conversation',
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedStringItem = typeof item === 'string' ? stringValue(item) : '';
    const identity = typeof item === 'string'
      ? (normalizedStringItem ? deleteIdentity({ conversationId: normalizedStringItem, kind }) : '')
      : (() => {
          const normalized = normalizeConversationDelete(item);
          return normalized ? deleteIdentity(normalized) : '';
        })();
    if (!normalizedOwner || !identity) return;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      await this.writeInTransaction(
        normalizedOwner,
        current.filter((candidate) => deleteIdentity(candidate) !== identity),
      );
    }, expectedOwnerEpoch);
  }

  /** Release a lease after a cancelled worker attempt without changing retry metadata. */
  async releaseLease(
    owner: string,
    item: ConversationDeleteOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizeConversationDelete(item);
    if (!normalizedOwner || !normalizedItem) return false;
    let released = false;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findDelete(current, normalizedItem);
      if (!previous || !ownsDeleteLease(previous, normalizedItem)) return;
      await this.writeInTransaction(normalizedOwner, replaceDelete(current, {
        ...previous,
        leaseExpiresAt: 0,
        leaseOwner: '',
        leaseToken: '',
      }));
      released = true;
    }, expectedOwnerEpoch);
    return released;
  }

  private async readInTransaction(owner: string): Promise<ConversationDeleteOutboxItem[]> {
    return parsePendingConversationDeletes(
      await this.storage.getItem(conversationDeleteOutboxKey(owner)),
      owner,
    );
  }

  private async writeInTransaction(
    owner: string,
    items: readonly ConversationDeleteOutboxItem[],
  ): Promise<void> {
    if (items.length) {
      await this.storage.setItem(conversationDeleteOutboxKey(owner), JSON.stringify({
        version: DELETE_OUTBOX_VERSION,
        owner,
        items,
      }));
    } else {
      await this.storage.removeItem(conversationDeleteOutboxKey(owner));
    }
  }
}

export function conversationDeleteOutboxKey(owner: string): string {
  return `${DELETE_OUTBOX_PREFIX}.${ownerStorageKey(normalizeOwner(owner))}`;
}

/** Read tombstones without taking the mutation queue (callers may already hold it). */
export async function readConversationDeleteIds(
  storage: ConversationStorageAdapter,
  owner: string,
): Promise<ReadonlySet<string>> {
  const normalizedOwner = normalizeOwner(owner);
  if (!normalizedOwner) return new Set<string>();
  return new Set(
    parsePendingConversationDeletes(
      await storage.getItem(conversationDeleteOutboxKey(normalizedOwner)),
      normalizedOwner,
    ).map(({ conversationId }) => conversationId),
  );
}

export function selectReadyConversationDeleteOutboxItems(
  items: readonly ConversationDeleteOutboxItem[],
  now = Date.now(),
  limit = 8,
  kinds?: readonly ConversationDeleteOutboxItem['kind'][],
): ConversationDeleteOutboxItem[] {
  const allowedKinds = kinds?.length ? new Set(kinds) : null;
  return [...items]
    .filter((item) => (
      (!allowedKinds || allowedKinds.has(item.kind))
      && (!item.nextAttemptAt || item.nextAttemptAt <= now)
      && (!item.leaseExpiresAt || item.leaseExpiresAt <= now)
    ))
    .sort((left, right) => left.queuedAt - right.queuedAt)
    .slice(0, Math.max(1, Math.min(32, Math.floor(limit))));
}

/**
 * Keep local deletion tombstones out of an incoming remote index.  This is a
 * pure helper so both the chat index controller and SwiftUI route hydration
 * can apply the same rule without reaching into repository internals.
 */
export function filterConversationDeletionTombstones<T extends { id: string }>(
  conversations: readonly T[],
  pending: ReadonlySet<string> | readonly ConversationDeleteOutboxItem[],
): T[] {
  const ids: ReadonlySet<string> = Array.isArray(pending)
    ? new Set<string>(pending.map(({ conversationId }) => conversationId))
    : pending as ReadonlySet<string>;
  return conversations.filter(({ id }) => !ids.has(id));
}

function parsePendingConversationDeletes(
  raw: string | null,
  owner: string,
): ConversationDeleteOutboxItem[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== DELETE_OUTBOX_VERSION) return [];
    if (normalizeOwner(value.owner) !== owner || !Array.isArray(value.items)) return [];
    return value.items.flatMap((item) => {
      const normalized = normalizeConversationDelete(item);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

function normalizeConversationDelete(value: unknown): ConversationDeleteOutboxItem | null {
  if (!isRecord(value)) return null;
  const conversationId = stringValue(value.conversationId).slice(0, 4_096);
  if (!conversationId) return null;
  const kind = value.kind === 'session'
    ? 'session'
    : value.kind === 'room'
      ? 'room'
      : value.kind === 'conversation'
        ? 'conversation'
        : '';
  if (!kind) return null;
  const queuedAt = Math.max(0, numberValue(value.queuedAt)) || Date.now();
  const attempts = Math.max(0, Math.floor(numberValue(value.attempts)));
  const nextAttemptAt = Math.max(0, numberValue(value.nextAttemptAt));
  const leaseExpiresAt = Math.max(0, numberValue(value.leaseExpiresAt));
  const profile = stringValue(value.profile).slice(0, 256);
  const remoteId = stringValue(value.remoteId).slice(0, 4_096);
  return {
    attempts,
    conversationId,
    kind,
    ...(stringValue(value.lastError) ? { lastError: stringValue(value.lastError).slice(0, 2_000) } : {}),
    ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
    ...(stringValue(value.leaseOwner) ? { leaseOwner: stringValue(value.leaseOwner).slice(0, 256) } : {}),
    ...(stringValue(value.leaseToken) ? { leaseToken: stringValue(value.leaseToken).slice(0, 256) } : {}),
    ...(nextAttemptAt ? { nextAttemptAt } : {}),
    ...(profile ? { profile } : {}),
    ...(remoteId ? { remoteId } : {}),
    queuedAt,
  };
}

function deleteIdentity(item: Pick<ConversationDeleteOutboxItem, 'conversationId' | 'kind'>): string {
  return `${item.kind}\u0000${item.conversationId}`;
}

function findDelete(
  items: readonly ConversationDeleteOutboxItem[],
  item: Pick<ConversationDeleteOutboxItem, 'conversationId' | 'kind'>,
): ConversationDeleteOutboxItem | undefined {
  return items.find((candidate) => deleteIdentity(candidate) === deleteIdentity(item));
}

function replaceDelete(
  items: readonly ConversationDeleteOutboxItem[],
  item: ConversationDeleteOutboxItem,
): ConversationDeleteOutboxItem[] {
  const identity = deleteIdentity(item);
  return [...items.filter((candidate) => deleteIdentity(candidate) !== identity), item];
}

function ownsDeleteLease(
  previous: ConversationDeleteOutboxItem,
  incoming: ConversationDeleteOutboxItem,
): boolean {
  if (!previous.leaseToken) return true;
  return previous.leaseToken === incoming.leaseToken
    && previous.leaseOwner === incoming.leaseOwner;
}
