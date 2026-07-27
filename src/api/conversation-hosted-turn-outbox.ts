import type {
  CollaborationMessage,
  HostedTurnEnqueueInput,
} from './HermesCloudApi';
import type {
  ConversationStorageAdapter,
  HostedTurnOutboxItem,
  HostedTurnPendingAttachment,
  OptimisticPendingTurn,
  PendingEnqueueMutationResult,
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
import {
  OptimisticConversationLedgerRepository,
  normalizeCollaborationMessage,
  normalizeOptimisticPendingTurn,
} from './conversation-optimistic-ledger';
import type { ConversationSerializedWrite } from './conversation-room-outbox';

const OUTBOX_VERSION = 1 as const;
const OUTBOX_PREFIX = 'hermes.native.hosted-turn-outbox.v1';

export class HostedTurnOutboxRepository {
  constructor(
    private readonly storage: ConversationStorageAdapter,
    private readonly runSerialized: ConversationSerializedWrite,
    private readonly optimisticLedger: OptimisticConversationLedgerRepository,
  ) {}

  async read(owner: string): Promise<HostedTurnOutboxItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return [];
    return this.readInTransaction(normalizedOwner);
  }

  async upsert(owner: string, item: HostedTurnOutboxItem): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    if (!normalizedOwner || !normalizedItem) return;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedItem.input.requestId);
      const durableItem = previous?.cancelledAt
        ? { ...normalizedItem, cancelledAt: previous.cancelledAt }
        : normalizedItem;
      await this.writeInTransaction(normalizedOwner, replaceItem(current, durableItem));
    });
  }

  async initialize(
    owner: string,
    item: HostedTurnOutboxItem,
    messages: readonly CollaborationMessage[],
    pendingTurn: OptimisticPendingTurn,
  ): Promise<PendingEnqueueMutationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    const normalizedMessages = messages.flatMap(normalizeCollaborationMessage);
    const normalizedPendingTurn = normalizeOptimisticPendingTurn(pendingTurn);
    if (
      !normalizedOwner
      || !normalizedItem
      || !normalizedMessages.length
      || !normalizedPendingTurn
    ) return noMutation();
    let result = noMutation();
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedItem.input.requestId);
      if (previous) {
        result = { item: previous, updated: false };
        return;
      }
      const currentEntry = await this.optimisticLedger.findInTransaction(
        normalizedOwner,
        normalizedItem.conversationId,
      );
      if (
        currentEntry?.pendingTurn
        && currentEntry.pendingTurn.userMessageId !== normalizedPendingTurn.userMessageId
      ) return;

      // Recovery intent lands first. If the process exits before the ledger
      // update, replay retains the stable request identity and repairs the UI.
      await this.writeInTransaction(normalizedOwner, replaceItem(current, normalizedItem));
      await this.optimisticLedger.initializeTurnInTransaction(
        normalizedOwner,
        normalizedItem.conversationId,
        normalizedMessages,
        normalizedPendingTurn,
      );
      result = { item: normalizedItem, updated: true };
    });
    return result;
  }

  async upsertIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
  ): Promise<PendingEnqueueMutationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    if (!normalizedOwner || !normalizedItem) return noMutation();
    let result = noMutation();
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedItem.input.requestId);
      if (
        previous?.cancelledAt
        || (previous?.deliveryTerminalAt && !normalizedItem.deliveryTerminalAt)
        || (previous?.deliveryAcceptedAt && !normalizedItem.deliveryAcceptedAt)
      ) {
        result = { item: previous, updated: false };
        return;
      }
      await this.writeInTransaction(normalizedOwner, replaceItem(current, normalizedItem));
      result = { item: normalizedItem, updated: true };
    });
    return result;
  }

  async transitionRetry(
    owner: string,
    item: HostedTurnOutboxItem,
    pendingTurn: OptimisticPendingTurn,
  ): Promise<PendingEnqueueMutationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    const normalizedPendingTurn = normalizeOptimisticPendingTurn(pendingTurn);
    if (!normalizedOwner || !normalizedItem || !normalizedPendingTurn) return noMutation();
    let result = noMutation();
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedItem.input.requestId);
      if (
        !previous
        || previous.cancelledAt
        || previous.deliveryAcceptedAt
        || previous.deliveryTerminalAt
      ) {
        result = { item: previous || null, updated: false };
        return;
      }
      await this.writeInTransaction(normalizedOwner, replaceItem(current, normalizedItem));
      await this.optimisticLedger.writePendingTurnInTransaction(
        normalizedOwner,
        normalizedItem.conversationId,
        normalizedPendingTurn,
      );
      result = { item: normalizedItem, updated: true };
    });
    return result;
  }

  async transitionTerminal(
    owner: string,
    item: HostedTurnOutboxItem,
    terminalMessages: readonly CollaborationMessage[],
  ): Promise<PendingEnqueueMutationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    const normalizedTerminal = terminalMessages.flatMap(normalizeCollaborationMessage);
    if (
      !normalizedOwner
      || !normalizedItem
      || !normalizedItem.deliveryTerminalAt
      || !normalizedTerminal.length
    ) return noMutation();
    let result = noMutation();
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedItem.input.requestId);
      if (!previous || previous.cancelledAt || previous.deliveryAcceptedAt) {
        result = { item: previous || null, updated: false };
        return;
      }
      const durableTerminal = previous.deliveryTerminalAt ? previous : normalizedItem;
      // Persist the terminal marker first so replay can repair the ledger
      // without ever resubmitting the model request.
      await this.writeInTransaction(normalizedOwner, replaceItem(current, durableTerminal));
      await this.optimisticLedger.writeTerminalInTransaction(
        normalizedOwner,
        normalizedItem.conversationId,
        normalizedTerminal,
      );
      result = { item: durableTerminal, updated: true };
    });
    return result;
  }

  async transitionForegroundFailure(
    owner: string,
    item: HostedTurnOutboxItem,
    terminalMessages: readonly CollaborationMessage[],
  ): Promise<PendingEnqueueMutationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    const normalizedTerminal = terminalMessages.flatMap(normalizeCollaborationMessage);
    if (
      !normalizedOwner
      || !normalizedItem
      || !normalizedItem.foregroundFailedAt
      || !normalizedTerminal.length
    ) return noMutation();
    let result = noMutation();
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedItem.input.requestId);
      if (
        !previous
        || previous.cancelledAt
        || previous.deliveryAcceptedAt
        || previous.deliveryTerminalAt
      ) {
        result = { item: previous || null, updated: false };
        return;
      }
      await this.writeInTransaction(normalizedOwner, replaceItem(current, normalizedItem));
      await this.optimisticLedger.writeTerminalInTransaction(
        normalizedOwner,
        normalizedItem.conversationId,
        normalizedTerminal,
      );
      result = { item: normalizedItem, updated: true };
    });
    return result;
  }

  async acceptIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
    pendingTurn: OptimisticPendingTurn,
  ): Promise<PendingEnqueueMutationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    const normalizedPendingTurn = normalizeOptimisticPendingTurn(pendingTurn);
    if (!normalizedOwner || !normalizedItem || !normalizedPendingTurn) return noMutation();
    let result = noMutation();
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedItem.input.requestId);
      if (!previous || previous.cancelledAt || previous.deliveryTerminalAt) {
        result = { item: previous || null, updated: false };
        return;
      }
      const accepted: HostedTurnOutboxItem = {
        ...normalizedItem,
        deliveryAcceptedAt: normalizedItem.deliveryAcceptedAt || Date.now(),
        foregroundFailedAt: 0,
        lastError: '',
        nextAttemptAt: 0,
      };
      await this.writeInTransaction(normalizedOwner, replaceItem(current, accepted));
      await this.optimisticLedger.reconcileAcceptedTurnInTransaction(
        normalizedOwner,
        accepted.conversationId,
        accepted.input.message.id,
        normalizedPendingTurn,
      );
      result = { item: accepted, updated: true };
    });
    return result;
  }

  async cancel(
    owner: string,
    requestId: string,
    fallback?: HostedTurnOutboxItem,
    now = Date.now(),
  ): Promise<HostedTurnOutboxItem | null> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRequestId = stringValue(requestId);
    const normalizedFallback = fallback ? normalizePendingEnqueue(fallback) : null;
    if (!normalizedOwner || !normalizedRequestId) return null;
    let cancelled: HostedTurnOutboxItem | null = null;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedRequestId);
      const source = previous || (
        normalizedFallback?.input.requestId === normalizedRequestId ? normalizedFallback : null
      );
      if (!source) return;
      if (source.deliveryTerminalAt) {
        cancelled = null;
        return;
      }
      cancelled = {
        ...source,
        cancelledAt: source.cancelledAt || Math.max(1, now),
        nextAttemptAt: 0,
      };
      await this.writeInTransaction(normalizedOwner, replaceItem(current, cancelled));
    });
    return cancelled;
  }

  async cancelAndFinalize(
    owner: string,
    requestId: string,
    fallback: HostedTurnOutboxItem | undefined,
    terminalMessages: readonly CollaborationMessage[],
    now = Date.now(),
  ): Promise<HostedTurnOutboxItem | null> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRequestId = stringValue(requestId);
    const normalizedFallback = fallback ? normalizePendingEnqueue(fallback) : null;
    const normalizedTerminal = terminalMessages.flatMap(normalizeCollaborationMessage);
    if (!normalizedOwner || !normalizedRequestId || !normalizedTerminal.length) return null;
    let cancelled: HostedTurnOutboxItem | null = null;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedRequestId);
      const source = previous || (
        normalizedFallback?.input.requestId === normalizedRequestId ? normalizedFallback : null
      );
      if (!source || source.deliveryTerminalAt) return;
      cancelled = {
        ...source,
        cancelledAt: source.cancelledAt || Math.max(1, now),
        nextAttemptAt: 0,
      };
      await this.writeInTransaction(normalizedOwner, replaceItem(current, cancelled));
      await this.optimisticLedger.writeCancellationInTransaction(
        normalizedOwner,
        source.conversationId,
        source.input.message.id,
        normalizedTerminal,
      );
    });
    return cancelled;
  }

  async removeIfActive(owner: string, requestId: string): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRequestId = stringValue(requestId);
    if (!normalizedOwner || !normalizedRequestId) return false;
    let removed = false;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedRequestId);
      if (!previous || previous.cancelledAt) return;
      await this.writeInTransaction(normalizedOwner, removeItem(current, normalizedRequestId));
      removed = true;
    });
    return removed;
  }

  async remove(owner: string, requestId: string): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRequestId = stringValue(requestId);
    if (!normalizedOwner || !normalizedRequestId) return;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      await this.writeInTransaction(normalizedOwner, removeItem(current, normalizedRequestId));
    });
  }

  private async readInTransaction(owner: string): Promise<HostedTurnOutboxItem[]> {
    return parsePendingEnqueues(
      await readCurrentOrLegacy(
        this.storage,
        hostedTurnOutboxKey(owner),
        legacyHostedTurnOutboxKey(owner),
      ),
      owner,
    );
  }

  private async writeInTransaction(
    owner: string,
    items: readonly HostedTurnOutboxItem[],
  ): Promise<void> {
    await this.storage.setItem(hostedTurnOutboxKey(owner), JSON.stringify({
      version: OUTBOX_VERSION,
      owner,
      items,
    }));
  }
}

export function hostedTurnOutboxKey(owner: string): string {
  return `${OUTBOX_PREFIX}.${ownerStorageKey(owner)}`;
}

export function legacyHostedTurnOutboxKey(owner: string): string {
  return `${OUTBOX_PREFIX}.${legacyOwnerHash(owner)}`;
}

function noMutation(): PendingEnqueueMutationResult {
  return { item: null, updated: false };
}

function findItem(
  items: readonly HostedTurnOutboxItem[],
  requestId: string,
): HostedTurnOutboxItem | undefined {
  return items.find(({ input }) => input.requestId === requestId);
}

function removeItem(
  items: readonly HostedTurnOutboxItem[],
  requestId: string,
): HostedTurnOutboxItem[] {
  return items.filter(({ input }) => input.requestId !== requestId);
}

function replaceItem(
  items: readonly HostedTurnOutboxItem[],
  item: HostedTurnOutboxItem,
): HostedTurnOutboxItem[] {
  return [...removeItem(items, item.input.requestId), item];
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
    attempts: Math.max(0, Math.floor(numberValue(value.attempts))),
    cancelledAt: Math.max(0, numberValue(value.cancelledAt)),
    deliveryAcceptedAt: Math.max(0, numberValue(value.deliveryAcceptedAt)),
    deliveryTerminalAt: Math.max(0, numberValue(value.deliveryTerminalAt)),
    foregroundFailedAt: Math.max(0, numberValue(value.foregroundFailedAt)),
    reconciliationAttempts: Math.max(0, Math.floor(numberValue(value.reconciliationAttempts))),
    reconciliationExhaustedAt: Math.max(0, numberValue(value.reconciliationExhaustedAt)),
    conversationId,
    conversationPending: Boolean(value.conversationPending),
    conversationProfile,
    conversationTitle: stringValue(value.conversationTitle),
    input,
    lastError: stringValue(value.lastError),
    nextAttemptAt: Math.max(0, numberValue(value.nextAttemptAt)),
    purpose: value.purpose === 'hosted-turn-cancel' ? 'hosted-turn-cancel' : 'message',
    pendingAttachments: Array.isArray(value.pendingAttachments)
      ? value.pendingAttachments.flatMap(normalizePendingAttachment)
      : [],
    queuedAt: numberValue(value.queuedAt) || Date.now(),
  };
}

function normalizePendingAttachment(entry: unknown): HostedTurnPendingAttachment[] {
  if (!isRecord(entry)) return [];
  const id = stringValue(entry.id);
  const kind = entry.kind === 'image' ? 'image' : entry.kind === 'file' ? 'file' : '';
  const name = stringValue(entry.name);
  const uri = stringValue(entry.uri);
  if (!id || !kind || !name || !uri) return [];
  return [{
    ...(entry.encryption === 'aes-gcm-v1' ? { encryption: 'aes-gcm-v1' as const } : {}),
    id,
    kind,
    mimeType: stringValue(entry.mimeType) || null,
    name,
    ownedTemporary: Boolean(entry.ownedTemporary),
    size: numberValue(entry.size) || null,
    sourceUri: stringValue(entry.sourceUri),
    uri,
    ...(isRecord(entry.uploaded) ? { uploaded: { ...entry.uploaded } } : {}),
  }];
}
