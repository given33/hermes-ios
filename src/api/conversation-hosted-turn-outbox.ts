import type {
  CollaborationMessage,
  HostedTurnEnqueueInput,
} from './HermesCloudApi';
import type {
  ConversationDraftClaim,
  ConversationStorageAdapter,
  HostedTurnOutboxItem,
  HostedTurnPendingAttachment,
  OptimisticPendingTurn,
  PendingEnqueueInitializationResult,
  PendingEnqueueMutationResult,
} from './conversation-store-types';
import {
  ConversationDraftRepository,
  type ConversationDraft,
} from './conversation-draft-repository';
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
let deliveryLeaseSequence = 0;

export class HostedTurnOutboxRepository {
  constructor(
    private readonly storage: ConversationStorageAdapter,
    private readonly runSerialized: ConversationSerializedWrite,
    private readonly optimisticLedger: OptimisticConversationLedgerRepository,
    private readonly drafts: ConversationDraftRepository,
  ) {}

  async read(owner: string): Promise<HostedTurnOutboxItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return [];
    return this.readInTransaction(normalizedOwner);
  }

  async claimReady(
    owner: string,
    workerId: string,
    now = Date.now(),
    leaseMs = 5 * 60_000,
    limit = 4,
    expectedOwnerEpoch?: number,
  ): Promise<HostedTurnOutboxItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedWorker = stringValue(workerId).slice(0, 256);
    if (!normalizedOwner || !normalizedWorker) return [];
    let claimed: HostedTurnOutboxItem[] = [];
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const candidates = selectReadyHostedTurnOutboxItems(current, now, limit);
      if (!candidates.length) return;
      const byRequest = new Map(current.map((item) => [item.input.requestId, item]));
      claimed = candidates.map((item) => {
        deliveryLeaseSequence += 1;
        const leased = {
          ...item,
          deliveryLeaseExpiresAt: now + Math.max(1_000, Math.floor(leaseMs)),
          deliveryLeaseOwner: normalizedWorker,
          deliveryLeaseToken: [
            normalizedWorker,
            now,
            deliveryLeaseSequence,
            item.input.requestId,
          ].join(':'),
        };
        byRequest.set(item.input.requestId, leased);
        return leased;
      });
      await this.writeInTransaction(normalizedOwner, [...byRequest.values()]);
    }, expectedOwnerEpoch);
    return claimed;
  }

  async claimByRequest(
    owner: string,
    requestId: string,
    workerId: string,
    now = Date.now(),
    leaseMs = 5 * 60_000,
    expectedOwnerEpoch?: number,
  ): Promise<HostedTurnOutboxItem | null> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRequestId = stringValue(requestId);
    const normalizedWorker = stringValue(workerId).slice(0, 256);
    if (!normalizedOwner || !normalizedRequestId || !normalizedWorker) return null;
    let claimed: HostedTurnOutboxItem | null = null;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const candidate = findItem(current, normalizedRequestId);
      if (!candidate) return;
      const conversationKey = candidate.conversationId || `pending:${candidate.input.requestId}`;
      const conversationHead = [...current]
        .filter((entry) => (
          (entry.conversationId || `pending:${entry.input.requestId}`) === conversationKey
        ))
        .sort((left, right) => left.queuedAt - right.queuedAt)[0];
      if (
        conversationHead?.input.requestId !== normalizedRequestId
        || (candidate.nextAttemptAt && candidate.nextAttemptAt > now)
        || (candidate.deliveryLeaseExpiresAt && candidate.deliveryLeaseExpiresAt > now)
      ) return;
      deliveryLeaseSequence += 1;
      claimed = {
        ...candidate,
        deliveryLeaseExpiresAt: now + Math.max(1_000, Math.floor(leaseMs)),
        deliveryLeaseOwner: normalizedWorker,
        deliveryLeaseToken: [
          normalizedWorker,
          now,
          deliveryLeaseSequence,
          candidate.input.requestId,
        ].join(':'),
      };
      await this.writeInTransaction(normalizedOwner, replaceItem(current, claimed));
    }, expectedOwnerEpoch);
    return claimed;
  }

  async releaseLease(
    owner: string,
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    if (!normalizedOwner || !normalizedItem?.deliveryLeaseToken) return false;
    let released = false;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedItem.input.requestId);
      if (!previous || !sameDeliveryLease(previous, normalizedItem)) return;
      await this.writeInTransaction(normalizedOwner, replaceItem(current, {
        ...previous,
        deliveryLeaseExpiresAt: 0,
        deliveryLeaseOwner: '',
        deliveryLeaseToken: '',
      }));
      released = true;
    }, expectedOwnerEpoch);
    return released;
  }

  async upsert(
    owner: string,
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    if (!normalizedOwner || !normalizedItem) return;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedItem.input.requestId);
      if (previous && !mutationOwnsDeliveryLease(previous, normalizedItem)) return;
      const durableItem = previous?.cancelledAt
        ? { ...normalizedItem, cancelledAt: previous.cancelledAt }
        : normalizedItem;
      await this.writeInTransaction(normalizedOwner, replaceItem(current, durableItem));
    }, expectedOwnerEpoch);
  }

  async initialize(
    owner: string,
    item: HostedTurnOutboxItem,
    messages: readonly CollaborationMessage[],
    pendingTurn: OptimisticPendingTurn,
    expectedOwnerEpoch?: number,
  ): Promise<PendingEnqueueInitializationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    const normalizedMessages = messages.flatMap(normalizeCollaborationMessage);
    const normalizedPendingTurn = normalizeOptimisticPendingTurn(pendingTurn);
    if (
      !normalizedOwner
      || !normalizedItem
      || !normalizedMessages.length
      || !normalizedPendingTurn
    ) return noInitialization();
    let result = noInitialization();
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const exposeDurableIntent = async (
        durableItem: HostedTurnOutboxItem,
        updated: boolean,
      ) => {
        result = {
          durable: true,
          item: durableItem,
          recovery: 'optimistic-ledger-replay',
          updated,
        };
        try {
          await this.optimisticLedger.initializeTurnInTransaction(
            normalizedOwner,
            durableItem.conversationId,
            normalizedMessages,
            normalizedPendingTurn,
          );
          result = { ...result, recovery: 'none' };
        } catch {
          // The outbox is authoritative. Returning its committed item prevents
          // callers from compensating a durable send as if the first write failed.
        }
      };
      const previous = findItem(current, normalizedItem.input.requestId);
      if (previous) {
        await exposeDurableIntent(previous, false);
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
      try {
        await this.writeInTransaction(normalizedOwner, replaceItem(current, normalizedItem));
      } catch (writeError) {
        // A storage adapter may report an interrupted write after committing it.
        // Re-read the authoritative key before declaring that no intent exists.
        const recovered = findItem(
          await this.readInTransaction(normalizedOwner).catch(() => []),
          normalizedItem.input.requestId,
        );
        if (!recovered) throw writeError;
        await exposeDurableIntent(recovered, true);
        return;
      }
      await exposeDurableIntent(normalizedItem, true);
    }, expectedOwnerEpoch);
    return result;
  }

  async readDraft(
    owner: string,
    conversationId: string,
    expectedOwnerEpoch?: number,
  ): Promise<ConversationDraft | null> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedConversationId = stringValue(conversationId);
    if (!normalizedOwner || !normalizedConversationId) return null;
    let draft: ConversationDraft | null = null;
    await this.runSerialized(normalizedOwner, async () => {
      const pending = await this.readInTransaction(normalizedOwner);
      draft = await this.drafts.readReconciledInTransaction(
        normalizedOwner,
        normalizedConversationId,
        pending.flatMap((item) => (
          item.conversationId === normalizedConversationId && item.draftClaim
            ? [item.draftClaim]
            : []
        )),
      );
    }, expectedOwnerEpoch);
    return draft;
  }

  async clearDraftClaim(
    owner: string,
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    if (!normalizedOwner || !normalizedItem) return;
    await this.runSerialized(normalizedOwner, () => this.drafts.clearClaimedInTransaction(
      normalizedOwner,
      normalizedItem.conversationId,
      normalizedItem.draftClaim,
    ), expectedOwnerEpoch);
  }

  async upsertIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<PendingEnqueueMutationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    if (!normalizedOwner || !normalizedItem) return noMutation();
    let result = noMutation();
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedItem.input.requestId);
      if (
        (previous && !mutationOwnsDeliveryLease(previous, normalizedItem))
        ||
        previous?.cancelledAt
        || (previous?.deliveryTerminalAt && !normalizedItem.deliveryTerminalAt)
        || (previous?.deliveryAcceptedAt && !normalizedItem.deliveryAcceptedAt)
      ) {
        result = { item: previous, updated: false };
        return;
      }
      await this.writeInTransaction(normalizedOwner, replaceItem(current, normalizedItem));
      result = { item: normalizedItem, updated: true };
    }, expectedOwnerEpoch);
    return result;
  }

  async transitionRetry(
    owner: string,
    item: HostedTurnOutboxItem,
    pendingTurn: OptimisticPendingTurn,
    expectedOwnerEpoch?: number,
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
        || !mutationOwnsDeliveryLease(previous, normalizedItem)
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
    }, expectedOwnerEpoch);
    return result;
  }

  async transitionTerminal(
    owner: string,
    item: HostedTurnOutboxItem,
    terminalMessages: readonly CollaborationMessage[],
    expectedOwnerEpoch?: number,
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
      if (
        !previous
        || !mutationOwnsDeliveryLease(previous, normalizedItem)
        || previous.cancelledAt
        || previous.deliveryAcceptedAt
      ) {
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
    }, expectedOwnerEpoch);
    return result;
  }

  async transitionForegroundFailure(
    owner: string,
    item: HostedTurnOutboxItem,
    terminalMessages: readonly CollaborationMessage[],
    expectedOwnerEpoch?: number,
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
        || !mutationOwnsDeliveryLease(previous, normalizedItem)
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
    }, expectedOwnerEpoch);
    return result;
  }

  async acceptIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
    pendingTurn: OptimisticPendingTurn,
    expectedOwnerEpoch?: number,
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
        || !mutationOwnsDeliveryLease(previous, normalizedItem)
        || previous.cancelledAt
        || previous.deliveryTerminalAt
      ) {
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
    }, expectedOwnerEpoch);
    return result;
  }

  async cancel(
    owner: string,
    requestId: string,
    fallback?: HostedTurnOutboxItem,
    now = Date.now(),
    expectedOwnerEpoch?: number,
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
        deliveryLeaseExpiresAt: 0,
        deliveryLeaseOwner: '',
        deliveryLeaseToken: '',
        nextAttemptAt: 0,
      };
      await this.writeInTransaction(normalizedOwner, replaceItem(current, cancelled));
    }, expectedOwnerEpoch);
    return cancelled;
  }

  async cancelAndFinalize(
    owner: string,
    requestId: string,
    fallback: HostedTurnOutboxItem | undefined,
    terminalMessages: readonly CollaborationMessage[],
    now = Date.now(),
    expectedOwnerEpoch?: number,
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
        deliveryLeaseExpiresAt: 0,
        deliveryLeaseOwner: '',
        deliveryLeaseToken: '',
        nextAttemptAt: 0,
      };
      await this.writeInTransaction(normalizedOwner, replaceItem(current, cancelled));
      await this.optimisticLedger.writeCancellationInTransaction(
        normalizedOwner,
        source.conversationId,
        source.input.message.id,
        normalizedTerminal,
      );
    }, expectedOwnerEpoch);
    return cancelled;
  }

  async removeIfActive(
    owner: string,
    requestId: string,
    expectedOwnerEpoch?: number,
  ): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRequestId = stringValue(requestId);
    if (!normalizedOwner || !normalizedRequestId) return false;
    let removed = false;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedRequestId);
      if (!previous || previous.cancelledAt) return;
      await this.drafts.clearClaimedInTransaction(
        normalizedOwner,
        previous.conversationId,
        previous.draftClaim,
      );
      await this.writeInTransaction(normalizedOwner, removeItem(current, normalizedRequestId));
      removed = true;
    }, expectedOwnerEpoch);
    return removed;
  }

  async removeIfLeaseOwned(
    owner: string,
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    if (!normalizedOwner || !normalizedItem) return false;
    let removed = false;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedItem.input.requestId);
      if (!previous || !mutationOwnsDeliveryLease(previous, normalizedItem)) return;
      await this.drafts.clearClaimedInTransaction(
        normalizedOwner,
        previous.conversationId,
        previous.draftClaim,
      );
      await this.writeInTransaction(
        normalizedOwner,
        removeItem(current, normalizedItem.input.requestId),
      );
      removed = true;
    }, expectedOwnerEpoch);
    return removed;
  }

  async remove(owner: string, requestId: string, expectedOwnerEpoch?: number): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRequestId = stringValue(requestId);
    if (!normalizedOwner || !normalizedRequestId) return;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const previous = findItem(current, normalizedRequestId);
      if (previous) {
        await this.drafts.clearClaimedInTransaction(
          normalizedOwner,
          previous.conversationId,
          previous.draftClaim,
        );
      }
      await this.writeInTransaction(normalizedOwner, removeItem(current, normalizedRequestId));
    }, expectedOwnerEpoch);
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

function noInitialization(): PendingEnqueueInitializationResult {
  return {
    durable: false,
    item: null,
    recovery: 'none',
    updated: false,
  };
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
  const draftClaim = normalizeDraftClaim(value.draftClaim, requestId);
  return {
    attempts: Math.max(0, Math.floor(numberValue(value.attempts))),
    cancelledAt: Math.max(0, numberValue(value.cancelledAt)),
    deliveryAcceptedAt: Math.max(0, numberValue(value.deliveryAcceptedAt)),
    deliveryLeaseExpiresAt: Math.max(0, numberValue(value.deliveryLeaseExpiresAt)),
    deliveryLeaseOwner: stringValue(value.deliveryLeaseOwner),
    deliveryLeaseToken: stringValue(value.deliveryLeaseToken),
    deliveryTerminalAt: Math.max(0, numberValue(value.deliveryTerminalAt)),
    foregroundFailedAt: Math.max(0, numberValue(value.foregroundFailedAt)),
    reconciliationAttempts: Math.max(0, Math.floor(numberValue(value.reconciliationAttempts))),
    reconciliationExhaustedAt: Math.max(0, numberValue(value.reconciliationExhaustedAt)),
    conversationId,
    conversationPending: Boolean(value.conversationPending),
    conversationProfile,
    conversationTitle: stringValue(value.conversationTitle),
    ...(draftClaim ? { draftClaim } : {}),
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

export function selectReadyHostedTurnOutboxItems(
  items: readonly HostedTurnOutboxItem[],
  now = Date.now(),
  limit = 4,
): HostedTurnOutboxItem[] {
  const firstByConversation = new Map<string, HostedTurnOutboxItem>();
  for (const item of [...items].sort((left, right) => left.queuedAt - right.queuedAt)) {
    const conversationKey = item.conversationId || `pending:${item.input.requestId}`;
    if (!firstByConversation.has(conversationKey)) firstByConversation.set(conversationKey, item);
  }
  return [...firstByConversation.values()]
    .filter((item) => (
      (!item.nextAttemptAt || item.nextAttemptAt <= now)
      && (!item.deliveryLeaseExpiresAt || item.deliveryLeaseExpiresAt <= now)
    ))
    .sort((left, right) => {
      const leftPriority = left.cancelledAt || left.purpose === 'hosted-turn-cancel' ? 0 : 1;
      const rightPriority = right.cancelledAt || right.purpose === 'hosted-turn-cancel' ? 0 : 1;
      return leftPriority - rightPriority || left.queuedAt - right.queuedAt;
    })
    .slice(0, Math.max(1, Math.min(32, Math.floor(limit))));
}

function sameDeliveryLease(
  left: HostedTurnOutboxItem,
  right: HostedTurnOutboxItem,
): boolean {
  return Boolean(left.deliveryLeaseToken)
    && left.deliveryLeaseToken === right.deliveryLeaseToken
    && left.deliveryLeaseOwner === right.deliveryLeaseOwner;
}

function mutationOwnsDeliveryLease(
  previous: HostedTurnOutboxItem,
  incoming: HostedTurnOutboxItem,
): boolean {
  return !previous.deliveryLeaseToken || sameDeliveryLease(previous, incoming);
}

function normalizeDraftClaim(
  value: unknown,
  requestId: string,
): ConversationDraftClaim | null {
  if (!isRecord(value) || value.requestId !== requestId || typeof value.content !== 'string') {
    return null;
  }
  if (!Array.isArray(value.attachments)) return null;
  const candidates = value.attachments.slice(0, 16);
  const attachments = candidates.flatMap((attachment) => {
    if (!isRecord(attachment)) return [];
    const id = stringValue(attachment.id).slice(0, 512);
    const uri = stringValue(attachment.uri).slice(0, 4_096);
    return id && uri ? [{ id, uri }] : [];
  });
  if (attachments.length !== candidates.length) return null;
  return { attachments, content: value.content, requestId };
}

function normalizePendingAttachment(entry: unknown): HostedTurnPendingAttachment[] {
  if (!isRecord(entry)) return [];
  const id = stringValue(entry.id);
  const kind = entry.kind === 'image' ? 'image' : entry.kind === 'file' ? 'file' : '';
  const name = stringValue(entry.name);
  const uri = stringValue(entry.uri);
  if (!id || !kind || !name || !uri) return [];
  return [{
    ...(entry.encryption === 'aes-gcm-v1' || entry.encryption === 'aes-gcm-chunked-v2'
      ? { encryption: entry.encryption }
      : {}),
    id,
    kind,
    mimeType: stringValue(entry.mimeType) || null,
    name,
    ownedTemporary: Boolean(entry.ownedTemporary),
    sha256: /^[a-f0-9]{64}$/i.test(stringValue(entry.sha256))
      ? stringValue(entry.sha256).toLowerCase()
      : undefined,
    size: numberValue(entry.size) || null,
    sourceUri: stringValue(entry.sourceUri),
    uri,
    ...(isRecord(entry.uploaded) ? { uploaded: { ...entry.uploaded } } : {}),
  }];
}
