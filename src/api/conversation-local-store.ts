import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  CollaborationMessage,
  HermesCloudApi,
  HostedTurnEnqueueInput,
  JsonRecord,
  SingleConversation,
} from './HermesCloudApi';

const CACHE_VERSION = 3 as const;
const CACHE_PREFIX = 'hermes.native.conversations.v3';
const PREVIOUS_CACHE_PREFIX = 'hermes.native.conversations.v2';
const LEGACY_CACHE_PREFIX = 'hermes.native.conversations.v1';
const OUTBOX_VERSION = 1 as const;
const OUTBOX_PREFIX = 'hermes.native.hosted-turn-outbox.v1';
const ROOM_OUTBOX_VERSION = 1 as const;
const ROOM_OUTBOX_PREFIX = 'hermes.native.collaboration-room-outbox.v1';
const OPTIMISTIC_LEDGER_VERSION = 1 as const;
const OPTIMISTIC_LEDGER_PREFIX = 'hermes.native.optimistic-messages.v1';
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
  attempts?: number;
  cancelledAt?: number;
  deliveryAcceptedAt?: number;
  deliveryTerminalAt?: number;
  foregroundFailedAt?: number;
  reconciliationAttempts?: number;
  reconciliationExhaustedAt?: number;
  conversationId: string;
  conversationPending?: boolean;
  conversationProfile?: string;
  conversationTitle?: string;
  input: HostedTurnEnqueueInput;
  lastError?: string;
  nextAttemptAt?: number;
  purpose?: 'hosted-turn-cancel' | 'message';
  pendingAttachments?: HostedTurnPendingAttachment[];
  queuedAt: number;
}

export interface PendingEnqueueMutationResult {
  item: HostedTurnOutboxItem | null;
  updated: boolean;
}

export interface HostedTurnPendingAttachment {
  encryption?: 'aes-gcm-v1';
  id: string;
  kind: 'file' | 'image';
  mimeType?: string | null;
  name: string;
  ownedTemporary?: boolean;
  size?: number | null;
  sourceUri?: string;
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

export interface OptimisticConversationLedgerItem {
  conversationId: string;
  messages: CollaborationMessage[];
  pendingTurn?: OptimisticPendingTurn;
  updatedAt: number;
}

export interface OptimisticPendingTurn {
  attempt: number;
  lastError?: string;
  phase: 'executing' | 'reconnecting' | 'thinking';
  phaseStartedAt: number;
  turnId?: string;
  updatedAt: number;
  userMessageId: string;
}

export interface ConversationStorageAdapter {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

export class ConversationLocalStore {
  constructor(private readonly storage: ConversationStorageAdapter = AsyncStorage) {}

  async read(owner: string): Promise<ConversationCacheSnapshot | null> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return null;
    // Do not hydrate v1/v2 data. Both schemas were distributed while
    // development conversations could be claimed by the production account,
    // so the account-scoped cloud index must rebuild this cache from scratch.
    await Promise.allSettled([
      previousCacheKey(normalizedOwner),
      legacyEncodedCacheKey(normalizedOwner),
      legacyHashedCacheKey(normalizedOwner),
    ].map((key) => this.storage.removeItem(key)));
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
      const previous = current.find(
        ({ input }) => input.requestId === normalizedItem.input.requestId,
      );
      const durableItem = previous?.cancelledAt
        ? { ...normalizedItem, cancelledAt: previous.cancelledAt }
        : normalizedItem;
      const next = current.filter(({ input }) => input.requestId !== normalizedItem.input.requestId);
      next.push(durableItem);
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
    });
  }

  async initializePendingEnqueue(
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
    ) return { item: null, updated: false };
    let result: PendingEnqueueMutationResult = { item: null, updated: false };
    await enqueueCacheWrite(normalizedOwner, async () => {
      const currentOutbox = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const previous = currentOutbox.find(
        ({ input }) => input.requestId === normalizedItem.input.requestId,
      );
      if (previous) {
        result = { item: previous, updated: false };
        return;
      }

      const ledgerKey = optimisticLedgerKey(normalizedOwner);
      const currentLedger = parseOptimisticConversations(
        await this.storage.getItem(ledgerKey),
        normalizedOwner,
      );
      const currentEntry = currentLedger.find(
        ({ conversationId }) => conversationId === normalizedItem.conversationId,
      );
      if (
        currentEntry?.pendingTurn
        && currentEntry.pendingTurn.userMessageId !== normalizedPendingTurn.userMessageId
      ) return;

      const nextOutbox = currentOutbox.filter(
        ({ input }) => input.requestId !== normalizedItem.input.requestId,
      );
      nextOutbox.push(normalizedItem);
      // The outbox is the recovery intent. Persist it before the UI ledger so
      // a process exit can replay the same request id without losing the send.
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: nextOutbox,
      }));

      const mergedMessages = new Map(
        (currentEntry?.messages || []).map((message) => (
          [message.id, cloneCollaborationMessage(message)]
        )),
      );
      for (const message of normalizedMessages) {
        const current = mergedMessages.get(message.id);
        if (!current || shouldReplaceOptimisticMessage(current, message)) {
          mergedMessages.set(message.id, cloneCollaborationMessage(message));
        }
      }
      const nextLedger = currentLedger.filter(
        ({ conversationId }) => conversationId !== normalizedItem.conversationId,
      );
      nextLedger.push({
        conversationId: normalizedItem.conversationId,
        messages: [...mergedMessages.values()].sort(
          (left, right) => messageTimestamp(left) - messageTimestamp(right),
        ),
        pendingTurn: normalizedPendingTurn,
        updatedAt: Date.now(),
      });
      await this.storage.setItem(ledgerKey, JSON.stringify({
        version: OPTIMISTIC_LEDGER_VERSION,
        owner: normalizedOwner,
        items: nextLedger,
      }));
      result = { item: normalizedItem, updated: true };
    });
    return result;
  }

  async upsertPendingEnqueueIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
  ): Promise<PendingEnqueueMutationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    if (!normalizedOwner || !normalizedItem) return { item: null, updated: false };
    let result: PendingEnqueueMutationResult = { item: null, updated: false };
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const previous = current.find(
        ({ input }) => input.requestId === normalizedItem.input.requestId,
      );
      if (
        previous?.cancelledAt
        || (previous?.deliveryTerminalAt && !normalizedItem.deliveryTerminalAt)
        || (previous?.deliveryAcceptedAt && !normalizedItem.deliveryAcceptedAt)
      ) {
        result = { item: previous, updated: false };
        return;
      }
      const next = current.filter(
        ({ input }) => input.requestId !== normalizedItem.input.requestId,
      );
      next.push(normalizedItem);
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
      result = { item: normalizedItem, updated: true };
    });
    return result;
  }

  async transitionPendingEnqueueRetry(
    owner: string,
    item: HostedTurnOutboxItem,
    pendingTurn: OptimisticPendingTurn,
  ): Promise<PendingEnqueueMutationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    const normalizedPendingTurn = normalizeOptimisticPendingTurn(pendingTurn);
    if (!normalizedOwner || !normalizedItem || !normalizedPendingTurn) {
      return { item: null, updated: false };
    }
    let result: PendingEnqueueMutationResult = { item: null, updated: false };
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const previous = current.find(
        ({ input }) => input.requestId === normalizedItem.input.requestId,
      );
      if (
        !previous
        || previous.cancelledAt
        || previous.deliveryAcceptedAt
        || previous.deliveryTerminalAt
      ) {
        result = { item: previous || null, updated: false };
        return;
      }
      const next = current.filter(
        ({ input }) => input.requestId !== normalizedItem.input.requestId,
      );
      next.push(normalizedItem);
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
      await writeOptimisticPendingTurn(
        this.storage,
        normalizedOwner,
        normalizedItem.conversationId,
        normalizedPendingTurn,
      );
      result = { item: normalizedItem, updated: true };
    });
    return result;
  }

  async transitionPendingEnqueueTerminal(
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
    ) return { item: null, updated: false };
    let result: PendingEnqueueMutationResult = { item: null, updated: false };
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const previous = current.find(
        ({ input }) => input.requestId === normalizedItem.input.requestId,
      );
      if (
        !previous
        || previous.cancelledAt
        || previous.deliveryAcceptedAt
      ) {
        result = { item: previous || null, updated: false };
        return;
      }
      const durableTerminal = previous.deliveryTerminalAt
        ? previous
        : normalizedItem;
      const next = current.filter(
        ({ input }) => input.requestId !== normalizedItem.input.requestId,
      );
      next.push(durableTerminal);
      // Persist the terminal outbox marker first. A process exit before the
      // ledger write is repaired by terminal replay and never resubmits the
      // model request.
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
      await writeOptimisticTerminal(
        this.storage,
        normalizedOwner,
        normalizedItem.conversationId,
        normalizedTerminal,
      );
      result = { item: durableTerminal, updated: true };
    });
    return result;
  }

  async transitionPendingEnqueueForegroundFailure(
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
    ) return { item: null, updated: false };
    let result: PendingEnqueueMutationResult = { item: null, updated: false };
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const previous = current.find(
        ({ input }) => input.requestId === normalizedItem.input.requestId,
      );
      if (
        !previous
        || previous.cancelledAt
        || previous.deliveryAcceptedAt
        || previous.deliveryTerminalAt
      ) {
        result = { item: previous || null, updated: false };
        return;
      }
      const next = current.filter(
        ({ input }) => input.requestId !== normalizedItem.input.requestId,
      );
      next.push(normalizedItem);
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
      await writeOptimisticTerminal(
        this.storage,
        normalizedOwner,
        normalizedItem.conversationId,
        normalizedTerminal,
      );
      result = { item: normalizedItem, updated: true };
    });
    return result;
  }

  async acceptPendingEnqueueIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
    pendingTurn: OptimisticPendingTurn,
  ): Promise<PendingEnqueueMutationResult> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedItem = normalizePendingEnqueue(item);
    const normalizedPendingTurn = normalizeOptimisticPendingTurn(pendingTurn);
    if (!normalizedOwner || !normalizedItem || !normalizedPendingTurn) {
      return { item: null, updated: false };
    }
    let result: PendingEnqueueMutationResult = { item: null, updated: false };
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const previous = current.find(
        ({ input }) => input.requestId === normalizedItem.input.requestId,
      );
      if (!previous || previous.cancelledAt || previous.deliveryTerminalAt) {
        result = { item: previous || null, updated: false };
        return;
      }
      const accepted = {
        ...normalizedItem,
        deliveryAcceptedAt: normalizedItem.deliveryAcceptedAt || Date.now(),
        foregroundFailedAt: 0,
        lastError: '',
        nextAttemptAt: 0,
      };
      const next = current.filter(
        ({ input }) => input.requestId !== normalizedItem.input.requestId,
      );
      next.push(accepted);
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
      await reconcileAcceptedOptimisticTurn(
        this.storage,
        normalizedOwner,
        accepted.conversationId,
        accepted.input.message.id,
        normalizedPendingTurn,
      );
      result = { item: accepted, updated: true };
    });
    return result;
  }

  async cancelPendingEnqueue(
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
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const previous = current.find(
        ({ input }) => input.requestId === normalizedRequestId,
      );
      const source = previous || (
        normalizedFallback?.input.requestId === normalizedRequestId
          ? normalizedFallback
          : null
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
      const next = current.filter(
        ({ input }) => input.requestId !== normalizedRequestId,
      );
      next.push(cancelled);
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
    });
    return cancelled;
  }

  async cancelPendingEnqueueAndFinalize(
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
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const previous = current.find(
        ({ input }) => input.requestId === normalizedRequestId,
      );
      const source = previous || (
        normalizedFallback?.input.requestId === normalizedRequestId
          ? normalizedFallback
          : null
      );
      if (!source || source.deliveryTerminalAt) return;
      cancelled = {
        ...source,
        cancelledAt: source.cancelledAt || Math.max(1, now),
        nextAttemptAt: 0,
      };
      const next = current.filter(({ input }) => input.requestId !== normalizedRequestId);
      next.push(cancelled);
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
      await writeOptimisticCancellation(
        this.storage,
        normalizedOwner,
        source.conversationId,
        source.input.message.id,
        normalizedTerminal,
      );
    });
    return cancelled;
  }

  async removePendingEnqueueIfActive(owner: string, requestId: string): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRequestId = stringValue(requestId);
    if (!normalizedOwner || !normalizedRequestId) return false;
    let removed = false;
    await enqueueCacheWrite(normalizedOwner, async () => {
      const current = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      const previous = current.find(
        ({ input }) => input.requestId === normalizedRequestId,
      );
      if (!previous || previous.cancelledAt) return;
      const next = current.filter(({ input }) => input.requestId !== normalizedRequestId);
      await this.storage.setItem(outboxKey(normalizedOwner), JSON.stringify({
        version: OUTBOX_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
      removed = true;
    });
    return removed;
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

  async readOptimisticConversations(
    owner: string,
  ): Promise<OptimisticConversationLedgerItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return [];
    let snapshot: OptimisticConversationLedgerItem[] = [];
    await enqueueCacheWrite(normalizedOwner, async () => {
      snapshot = parseOptimisticConversations(
        await this.storage.getItem(optimisticLedgerKey(normalizedOwner)),
        normalizedOwner,
      );
    });
    return snapshot;
  }

  async replaceOptimisticMessages(
    owner: string,
    conversationId: string,
    messages: readonly CollaborationMessage[],
    pendingTurn?: OptimisticPendingTurn | null,
    expectedMessageIds?: readonly string[],
  ): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedConversationId = stringValue(conversationId);
    if (!normalizedOwner || !normalizedConversationId) return false;
    const normalizedMessages = messages.flatMap(normalizeCollaborationMessage);
    let committed = false;
    await enqueueCacheWrite(normalizedOwner, async () => {
      const key = optimisticLedgerKey(normalizedOwner);
      const current = parseOptimisticConversations(
        await this.storage.getItem(key),
        normalizedOwner,
      );
      const currentEntry = current.find(
        ({ conversationId: currentId }) => currentId === normalizedConversationId,
      );
      const expectedIdsMatch = !expectedMessageIds
        || sameMessageIds(currentEntry?.messages || [], expectedMessageIds);
      const completesCurrentPendingTurn = Boolean(
        !expectedIdsMatch
        && pendingTurn === null
        && currentEntry?.pendingTurn
        && normalizedMessages.some(
          ({ id, role }) => id === currentEntry.pendingTurn?.userMessageId && role === 'user',
        )
        && normalizedMessages.some(({ id, role, status }) => (
          role === 'assistant'
          && id.includes(currentEntry.pendingTurn?.userMessageId || '')
          && (status === 'failed' || status === 'completed')
        )),
      );
      if (
        expectedMessageIds
        && !expectedIdsMatch
        && !completesCurrentPendingTurn
      ) return;
      const normalizedPendingTurn = pendingTurn === undefined
        ? currentEntry?.pendingTurn
        : pendingTurn === null
          ? undefined
          : normalizeOptimisticPendingTurn(pendingTurn);
      const next = current.filter(
        ({ conversationId: currentId }) => currentId !== normalizedConversationId,
      );
      if (normalizedMessages.length || normalizedPendingTurn) {
        next.push({
          conversationId: normalizedConversationId,
          messages: normalizedMessages,
          ...(normalizedPendingTurn ? { pendingTurn: normalizedPendingTurn } : {}),
          updatedAt: Date.now(),
        });
      }
      await this.storage.setItem(key, JSON.stringify({
        version: OPTIMISTIC_LEDGER_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
      committed = true;
    });
    return committed;
  }

  async updateOptimisticPendingTurn(
    owner: string,
    conversationId: string,
    pendingTurn: OptimisticPendingTurn,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedConversationId = stringValue(conversationId);
    const normalizedPendingTurn = normalizeOptimisticPendingTurn(pendingTurn);
    if (!normalizedOwner || !normalizedConversationId || !normalizedPendingTurn) return;
    await enqueueCacheWrite(normalizedOwner, async () => {
      const key = optimisticLedgerKey(normalizedOwner);
      const current = parseOptimisticConversations(
        await this.storage.getItem(key),
        normalizedOwner,
      );
      const entry = current.find(({ conversationId: currentId }) => (
        currentId === normalizedConversationId
      ));
      if (!entry) return;
      const next = current.filter(({ conversationId: currentId }) => (
        currentId !== normalizedConversationId
      ));
      next.push({
        conversationId: normalizedConversationId,
        messages: entry.messages.map(cloneCollaborationMessage),
        pendingTurn: normalizedPendingTurn,
        updatedAt: Date.now(),
      });
      await this.storage.setItem(key, JSON.stringify({
        version: OPTIMISTIC_LEDGER_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
    });
  }

  async finalizeOptimisticTurn(
    owner: string,
    conversationId: string,
    terminalMessages: readonly CollaborationMessage[],
  ): Promise<OptimisticConversationLedgerItem | null> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedConversationId = stringValue(conversationId);
    const normalizedTerminal = terminalMessages.flatMap(normalizeCollaborationMessage);
    if (!normalizedOwner || !normalizedConversationId || !normalizedTerminal.length) return null;
    let finalized: OptimisticConversationLedgerItem | null = null;
    await enqueueCacheWrite(normalizedOwner, async () => {
      const key = optimisticLedgerKey(normalizedOwner);
      const current = parseOptimisticConversations(
        await this.storage.getItem(key),
        normalizedOwner,
      );
      const entry = current.find(({ conversationId: currentId }) => (
        currentId === normalizedConversationId
      ));
      const messages = new Map(
        (entry?.messages || []).map((message) => [message.id, cloneCollaborationMessage(message)]),
      );
      for (const message of normalizedTerminal) {
        const previous = messages.get(message.id);
        if (!previous || shouldReplaceOptimisticMessage(previous, message)) {
          messages.set(message.id, cloneCollaborationMessage(message));
        }
      }
      finalized = {
        conversationId: normalizedConversationId,
        messages: [...messages.values()].sort(
          (left, right) => messageTimestamp(left) - messageTimestamp(right),
        ),
        updatedAt: Date.now(),
      };
      const next = current.filter(({ conversationId: currentId }) => (
        currentId !== normalizedConversationId
      ));
      next.push(finalized);
      await this.storage.setItem(key, JSON.stringify({
        version: OPTIMISTIC_LEDGER_VERSION,
        owner: normalizedOwner,
        items: next,
      }));
    });
    return finalized;
  }

  async purge(
    owner: string,
    beforeRemove?: (pending: HostedTurnOutboxItem[]) => Promise<void>,
  ): Promise<HostedTurnOutboxItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return [];
    advanceSynchronization(normalizedOwner);
    let pendingAttachments: HostedTurnOutboxItem[] = [];
    await enqueueCacheWrite(normalizedOwner, async () => {
      pendingAttachments = parsePendingEnqueues(
        await readCurrentOrLegacy(
          this.storage,
          outboxKey(normalizedOwner),
          legacyOutboxKey(normalizedOwner),
        ),
        normalizedOwner,
      );
      await beforeRemove?.(pendingAttachments);
      await Promise.all([
        cacheKey(normalizedOwner),
        previousCacheKey(normalizedOwner),
        legacyEncodedCacheKey(normalizedOwner),
        legacyHashedCacheKey(normalizedOwner),
        outboxKey(normalizedOwner),
        legacyOutboxKey(normalizedOwner),
        roomOutboxKey(normalizedOwner),
        legacyRoomOutboxKey(normalizedOwner),
        optimisticLedgerKey(normalizedOwner),
      ].map((key) => this.storage.removeItem(key)));
    });
    return pendingAttachments;
  }
}

async function writeOptimisticPendingTurn(
  storage: ConversationStorageAdapter,
  owner: string,
  conversationId: string,
  pendingTurn: OptimisticPendingTurn,
): Promise<void> {
  const key = optimisticLedgerKey(owner);
  const current = parseOptimisticConversations(await storage.getItem(key), owner);
  const entry = current.find(({ conversationId: currentId }) => currentId === conversationId);
  if (!entry) return;
  const next = current.filter(({ conversationId: currentId }) => currentId !== conversationId);
  next.push({
    conversationId,
    messages: entry.messages.map(cloneCollaborationMessage),
    pendingTurn,
    updatedAt: Date.now(),
  });
  await storage.setItem(key, JSON.stringify({
    version: OPTIMISTIC_LEDGER_VERSION,
    owner,
    items: next,
  }));
}

async function writeOptimisticTerminal(
  storage: ConversationStorageAdapter,
  owner: string,
  conversationId: string,
  terminalMessages: readonly CollaborationMessage[],
): Promise<void> {
  const key = optimisticLedgerKey(owner);
  const current = parseOptimisticConversations(await storage.getItem(key), owner);
  const entry = current.find(({ conversationId: currentId }) => currentId === conversationId);
  const messages = new Map(
    (entry?.messages || []).map((message) => [message.id, cloneCollaborationMessage(message)]),
  );
  for (const message of terminalMessages) {
    const previous = messages.get(message.id);
    if (!previous || shouldReplaceOptimisticMessage(previous, message)) {
      messages.set(message.id, cloneCollaborationMessage(message));
    }
  }
  const next = current.filter(({ conversationId: currentId }) => currentId !== conversationId);
  next.push({
    conversationId,
    messages: [...messages.values()].sort(
      (left, right) => messageTimestamp(left) - messageTimestamp(right),
    ),
    updatedAt: Date.now(),
  });
  await storage.setItem(key, JSON.stringify({
    version: OPTIMISTIC_LEDGER_VERSION,
    owner,
    items: next,
  }));
}

async function reconcileAcceptedOptimisticTurn(
  storage: ConversationStorageAdapter,
  owner: string,
  conversationId: string,
  userMessageId: string,
  pendingTurn: OptimisticPendingTurn,
): Promise<void> {
  const key = optimisticLedgerKey(owner);
  const current = parseOptimisticConversations(await storage.getItem(key), owner);
  const entry = current.find(({ conversationId: currentId }) => currentId === conversationId);
  if (!entry) return;
  const localFailureIds = new Set([
    `send-failed-${userMessageId}`,
    `connection-unavailable-${userMessageId}`,
  ]);
  const next = current.filter(({ conversationId: currentId }) => currentId !== conversationId);
  next.push({
    conversationId,
    messages: entry.messages
      .filter(({ id }) => !localFailureIds.has(id))
      .map(cloneCollaborationMessage),
    pendingTurn,
    updatedAt: Date.now(),
  });
  await storage.setItem(key, JSON.stringify({
    version: OPTIMISTIC_LEDGER_VERSION,
    owner,
    items: next,
  }));
}

async function writeOptimisticCancellation(
  storage: ConversationStorageAdapter,
  owner: string,
  conversationId: string,
  userMessageId: string,
  terminalMessages: readonly CollaborationMessage[],
): Promise<void> {
  const key = optimisticLedgerKey(owner);
  const current = parseOptimisticConversations(await storage.getItem(key), owner);
  const entry = current.find(({ conversationId: currentId }) => currentId === conversationId);
  const replaceableIds = new Set([
    `send-failed-${userMessageId}`,
    `connection-unavailable-${userMessageId}`,
    `cancelled-${userMessageId}`,
  ]);
  const messages = new Map(
    (entry?.messages || [])
      .filter(({ id }) => !replaceableIds.has(id))
      .map((message) => [message.id, cloneCollaborationMessage(message)]),
  );
  for (const message of terminalMessages) {
    messages.set(message.id, cloneCollaborationMessage(message));
  }
  const next = current.filter(({ conversationId: currentId }) => currentId !== conversationId);
  next.push({
    conversationId,
    messages: [...messages.values()].sort(
      (left, right) => messageTimestamp(left) - messageTimestamp(right),
    ),
    updatedAt: Date.now(),
  });
  await storage.setItem(key, JSON.stringify({
    version: OPTIMISTIC_LEDGER_VERSION,
    owner,
    items: next,
  }));
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
    messages: mergeConversationMessages(existing?.messages || [], conversation.messages),
    message_count: Math.max(
      numberValue(conversation.message_count),
      numberValue(existing?.message_count),
      conversation.messages.length,
      existing?.messages.length || 0,
    ),
  };
  return [
    cloneConversation(merged),
    ...conversations.filter((item) => (
      item.id !== conversation.id && (!replacedId || item.id !== replacedId)
    )).map(cloneConversation),
  ].sort((left, right) => numberValue(right.updated_at) - numberValue(left.updated_at));
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
  const missingIds = new Set<string>();
  const downloaded = await mapWithConcurrency(
    reconciliation.downloadIds,
    4,
    async (id) => {
      try {
        return (await api.getConversation(id)).conversation;
      } catch (error) {
        // A summary can disappear between the index and detail requests.
        // Drop only that stale row and keep the rest of the account history.
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

function isNotFoundError(error: unknown): boolean {
  return isRecord(error)
    && (error.status === 404 || error.statusCode === 404);
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

function cloneOptimisticLedgerEntry(
  entry: OptimisticConversationLedgerItem,
): OptimisticConversationLedgerItem {
  return {
    conversationId: entry.conversationId,
    messages: entry.messages.map(cloneCollaborationMessage),
    ...(entry.pendingTurn ? { pendingTurn: { ...entry.pendingTurn } } : {}),
    updatedAt: entry.updatedAt,
  };
}

function cloneCollaborationMessage(message: CollaborationMessage): CollaborationMessage {
  return {
    ...message,
    ...(message.meta ? { meta: { ...message.meta } } : {}),
  };
}

function shouldReplaceOptimisticMessage(
  current: CollaborationMessage,
  incoming: CollaborationMessage,
): boolean {
  if (current.status === 'failed' && incoming.status !== 'failed') return false;
  if (incoming.status === 'failed' && current.status !== 'failed') return true;
  return optimisticMessageRevision(incoming) >= optimisticMessageRevision(current);
}

function optimisticMessageRevision(message: CollaborationMessage): number {
  return Math.max(
    timestampNumber(message.created_at),
    timestampNumber(message.updated_at),
    timestampNumber(message.completed_at),
  );
}

function messageTimestamp(message: CollaborationMessage): number {
  return timestampNumber(message.created_at) || timestampNumber(message.updated_at);
}

function timestampNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function previousCacheKey(owner: string): string {
  return `${PREVIOUS_CACHE_PREFIX}.${ownerStorageKey(owner)}`;
}

function outboxKey(owner: string): string {
  return `${OUTBOX_PREFIX}.${ownerStorageKey(owner)}`;
}

function roomOutboxKey(owner: string): string {
  return `${ROOM_OUTBOX_PREFIX}.${ownerStorageKey(owner)}`;
}

function optimisticLedgerKey(owner: string): string {
  return `${OPTIMISTIC_LEDGER_PREFIX}.${ownerStorageKey(owner)}`;
}

function legacyEncodedCacheKey(owner: string): string {
  return `${LEGACY_CACHE_PREFIX}.${ownerStorageKey(owner)}`;
}

function legacyHashedCacheKey(owner: string): string {
  return `${LEGACY_CACHE_PREFIX}.${legacyOwnerHash(owner)}`;
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
    purpose: value.purpose === 'hosted-turn-cancel'
      ? 'hosted-turn-cancel'
      : 'message',
    pendingAttachments: Array.isArray(value.pendingAttachments)
      ? value.pendingAttachments.flatMap((entry) => {
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

function parseOptimisticConversations(
  raw: string | null,
  owner: string,
): OptimisticConversationLedgerItem[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== OPTIMISTIC_LEDGER_VERSION) return [];
    if (normalizeOwner(value.owner) !== owner || !Array.isArray(value.items)) return [];
    return value.items.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const conversationId = stringValue(entry.conversationId);
      if (!conversationId || !Array.isArray(entry.messages)) return [];
      const messages = entry.messages.flatMap(normalizeCollaborationMessage);
      const pendingTurn = normalizeOptimisticPendingTurn(entry.pendingTurn);
      if (!messages.length && !pendingTurn) return [];
      return [{
        conversationId,
        messages,
        ...(pendingTurn ? { pendingTurn } : {}),
        updatedAt: numberValue(entry.updatedAt) || Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

function sameMessageIds(
  messages: readonly CollaborationMessage[],
  expectedMessageIds: readonly string[],
): boolean {
  const current = messages.map(({ id }) => id).sort();
  const expected = [...expectedMessageIds].map(stringValue).filter(Boolean).sort();
  return current.length === expected.length
    && current.every((id, index) => id === expected[index]);
}

function normalizeOptimisticPendingTurn(value: unknown): OptimisticPendingTurn | undefined {
  if (!isRecord(value)) return undefined;
  const userMessageId = stringValue(value.userMessageId);
  const phase = stringValue(value.phase);
  if (
    !userMessageId
    || (phase !== 'thinking' && phase !== 'reconnecting' && phase !== 'executing')
  ) return undefined;
  return {
    attempt: Math.max(0, Math.min(5, Math.floor(numberValue(value.attempt)))),
    ...(stringValue(value.lastError) ? { lastError: stringValue(value.lastError) } : {}),
    phase,
    phaseStartedAt: numberValue(value.phaseStartedAt) || Date.now(),
    ...(stringValue(value.turnId) ? { turnId: stringValue(value.turnId) } : {}),
    updatedAt: numberValue(value.updatedAt) || Date.now(),
    userMessageId,
  };
}

function normalizeCollaborationMessage(value: unknown): CollaborationMessage[] {
  if (!isRecord(value)) return [];
  const id = stringValue(value.id);
  const role = stringValue(value.role);
  if (!id || (role !== 'user' && role !== 'assistant')) return [];
  return [{
    ...value,
    id,
    role,
    name: stringValue(value.name),
    content: stringValue(value.content),
    ...(isRecord(value.meta) ? { meta: { ...value.meta } } : {}),
  } as CollaborationMessage];
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
