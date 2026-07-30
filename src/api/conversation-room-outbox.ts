import type {
  CollaborationRoomOutboxItem,
  ConversationStorageAdapter,
} from './conversation-store-types';
import {
  isRecord,
  legacyOwnerHash,
  normalizeOwner,
  numberValue,
  ownerStorageKey,
  readCurrentOrLegacy,
  stringValue,
} from './conversation-storage-primitives';

const ROOM_OUTBOX_VERSION = 1 as const;
const ROOM_OUTBOX_PREFIX = 'hermes.native.collaboration-room-outbox.v1';

export type ConversationSerializedWrite = (
  owner: string,
  operation: () => Promise<void>,
  expectedOwnerEpoch?: number,
) => Promise<void>;

export class CollaborationRoomOutboxRepository {
  constructor(
    private readonly storage: ConversationStorageAdapter,
    private readonly runSerialized: ConversationSerializedWrite,
  ) {}

  async read(owner: string): Promise<CollaborationRoomOutboxItem[]> {
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

  async upsert(
    owner: string,
    item: CollaborationRoomOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingRoomMessage(item);
    if (!normalizedOwner || !normalizedItem) return;
    await this.runSerialized(normalizedOwner, async () => {
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
    }, expectedOwnerEpoch);
  }

  async remove(owner: string, requestId: string, expectedOwnerEpoch?: number): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRequestId = stringValue(requestId);
    if (!normalizedOwner || !normalizedRequestId) return;
    await this.runSerialized(normalizedOwner, async () => {
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
    }, expectedOwnerEpoch);
  }
}

export function roomOutboxKey(owner: string): string {
  return `${ROOM_OUTBOX_PREFIX}.${ownerStorageKey(owner)}`;
}

export function legacyRoomOutboxKey(owner: string): string {
  return `${ROOM_OUTBOX_PREFIX}.${legacyOwnerHash(owner)}`;
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
