import type { CollaborationMessage } from './HermesCloudApi';
import type {
  ConversationStorageAdapter,
  HostedInterventionOutboxItem,
  PendingInterventionMutationResult,
} from './conversation-store-types';
import {
  isRecord,
  normalizeOwner,
  numberValue,
  ownerStorageKey,
  stringValue,
} from './conversation-storage-primitives';
import {
  OptimisticConversationLedgerRepository,
  cloneCollaborationMessage,
  normalizeCollaborationMessage,
} from './conversation-optimistic-ledger';
import type { ConversationSerializedWrite } from './conversation-room-outbox';

const INTERVENTION_OUTBOX_VERSION = 1 as const;
const INTERVENTION_OUTBOX_PREFIX = 'hermes.native.hosted-intervention-outbox.v1';

export class HostedInterventionOutboxRepository {
  constructor(
    private readonly storage: ConversationStorageAdapter,
    private readonly runSerialized: ConversationSerializedWrite,
    private readonly optimisticLedger: OptimisticConversationLedgerRepository,
  ) {}

  async read(owner: string): Promise<HostedInterventionOutboxItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return [];
    return this.readInTransaction(normalizedOwner);
  }

  async initialize(
    owner: string,
    item: HostedInterventionOutboxItem,
  ): Promise<PendingInterventionMutationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingIntervention(item);
    if (!normalizedOwner || !normalizedItem) return { item: null, updated: false };
    let result: PendingInterventionMutationResult = { item: null, updated: false };
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = current.find(({ messageId }) => messageId === normalizedItem.messageId);
      if (previous) {
        result = { item: previous, updated: false };
        return;
      }
      await this.writeInTransaction(normalizedOwner, [...current, normalizedItem]);
      result = { item: normalizedItem, updated: true };
      try {
        await this.optimisticLedger.appendInterventionInTransaction(
          normalizedOwner,
          normalizedItem.conversationId,
          normalizedItem.message,
        );
      } catch {
        // The outbox is authoritative. Hydration reconstructs this optimistic
        // message if the best-effort ledger write is interrupted.
      }
    });
    return result;
  }

  async upsert(owner: string, item: HostedInterventionOutboxItem): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingIntervention(item);
    if (!normalizedOwner || !normalizedItem) return;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      await this.writeInTransaction(normalizedOwner, [
        ...current.filter(({ messageId }) => messageId !== normalizedItem.messageId),
        normalizedItem,
      ]);
    });
  }

  async remove(owner: string, messageId: string): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedMessageId = stringValue(messageId);
    if (!normalizedOwner || !normalizedMessageId) return;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      await this.writeInTransaction(
        normalizedOwner,
        current.filter(({ messageId: currentId }) => currentId !== normalizedMessageId),
      );
    });
  }

  async fail(
    owner: string,
    item: HostedInterventionOutboxItem,
    error: string,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingIntervention(item);
    const normalizedError = stringValue(error);
    if (!normalizedOwner || !normalizedItem) return;
    await this.runSerialized(normalizedOwner, async () => {
      await this.optimisticLedger.failInterventionInTransaction(
        normalizedOwner,
        normalizedItem.conversationId,
        normalizedItem.message,
        normalizedError,
      );
      const current = await this.readInTransaction(normalizedOwner);
      await this.writeInTransaction(
        normalizedOwner,
        current.filter(({ messageId }) => messageId !== normalizedItem.messageId),
      );
    });
  }

  private async readInTransaction(owner: string): Promise<HostedInterventionOutboxItem[]> {
    return parsePendingInterventions(
      await this.storage.getItem(interventionOutboxKey(owner)),
      owner,
    );
  }

  private async writeInTransaction(
    owner: string,
    items: readonly HostedInterventionOutboxItem[],
  ): Promise<void> {
    await this.storage.setItem(interventionOutboxKey(owner), JSON.stringify({
      version: INTERVENTION_OUTBOX_VERSION,
      owner,
      items,
    }));
  }
}

export function interventionOutboxKey(owner: string): string {
  return `${INTERVENTION_OUTBOX_PREFIX}.${ownerStorageKey(owner)}`;
}

function parsePendingInterventions(
  raw: string | null,
  owner: string,
): HostedInterventionOutboxItem[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== INTERVENTION_OUTBOX_VERSION) return [];
    if (normalizeOwner(value.owner) !== owner || !Array.isArray(value.items)) return [];
    return value.items.flatMap((item) => {
      const normalized = normalizePendingIntervention(item);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

function normalizePendingIntervention(value: unknown): HostedInterventionOutboxItem | null {
  if (!isRecord(value)) return null;
  const conversationId = stringValue(value.conversationId);
  const turnId = stringValue(value.turnId);
  const messageId = stringValue(value.messageId);
  const content = stringValue(value.content);
  const message = normalizeCollaborationMessage(value.message)[0];
  if (!conversationId || !turnId || !messageId || !content || !message) return null;
  if (message.id !== messageId || message.role !== 'user') return null;
  return {
    attempts: Math.max(0, Math.floor(numberValue(value.attempts))),
    content,
    conversationId,
    deliveryAcceptedAt: Math.max(0, numberValue(value.deliveryAcceptedAt)),
    lastError: stringValue(value.lastError),
    message: cloneCollaborationMessage(message) as CollaborationMessage,
    messageId,
    nextAttemptAt: Math.max(0, numberValue(value.nextAttemptAt)),
    queuedAt: numberValue(value.queuedAt) || Date.now(),
    turnId,
  };
}
