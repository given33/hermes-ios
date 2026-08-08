import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  CollaborationMessage,
  SingleConversation,
} from './HermesCloudApi';
import type {
  CollaborationRoomOutboxItem,
  ConversationCacheSnapshot,
  ConversationStorageAdapter,
  HostedInterventionOutboxItem,
  HostedTurnOutboxItem,
  HostedTurnPendingAttachment,
  OptimisticConversationLedgerItem,
  OptimisticPendingTurn,
  PendingEnqueueInitializationResult,
  PendingEnqueueMutationResult,
  PendingInterventionMutationResult,
} from './conversation-store-types';
import {
  CollaborationRoomOutboxRepository,
  legacyRoomOutboxKey,
  roomOutboxKey,
} from './conversation-room-outbox';
import {
  OptimisticConversationLedgerRepository,
  optimisticLedgerKey,
} from './conversation-optimistic-ledger';
import {
  HostedInterventionOutboxRepository,
  interventionOutboxKey,
} from './conversation-intervention-outbox';
import {
  HostedTurnOutboxRepository,
  hostedTurnOutboxKey,
  legacyHostedTurnOutboxKey,
} from './conversation-hosted-turn-outbox';
import {
  normalizeOwner,
} from './conversation-storage-primitives';
import {
  ConversationCacheRepository,
} from './conversation-cache-repository';
import {
  beginConversationStorageOwnerActivation,
  beginConversationStorageOwnerPurge,
  completeConversationStorageOwnerActivation,
  enqueueConversationStorageMaintenance,
  enqueueConversationStorageWrite,
} from './conversation-storage-coordinator';
import {
  ConversationDraftRepository,
  conversationDraftsKey,
  conversationOwnerDeletionKey,
  type ConversationDraft,
  type ConversationDraftAttachment,
} from './conversation-draft-repository';

export type {
  CollaborationRoomOutboxItem,
  ConversationCacheReconciliation,
  ConversationCacheSnapshot,
  ConversationStorageAdapter,
  HostedInterventionOutboxItem,
  HostedTurnOutboxItem,
  HostedTurnPendingAttachment,
  OptimisticConversationLedgerItem,
  OptimisticPendingTurn,
  PendingEnqueueInitializationResult,
  PendingEnqueueMutationResult,
  PendingInterventionMutationResult,
} from './conversation-store-types';
export {
  isCompleteConversation,
  mergeDownloadedConversations,
  mergeCachedConversationUpdate,
  mergeOptimisticConversationLedgers,
  reconcileConversationCache,
  replaceCachedConversationSnapshot,
  synchronizeConversationCache,
} from './conversation-cache-sync';

export class ConversationLocalStore {
  private readonly cache: ConversationCacheRepository;
  private readonly roomOutbox: CollaborationRoomOutboxRepository;
  private readonly optimisticLedger: OptimisticConversationLedgerRepository;
  private readonly interventionOutbox: HostedInterventionOutboxRepository;
  private readonly hostedTurnOutbox: HostedTurnOutboxRepository;
  private readonly drafts: ConversationDraftRepository;

  constructor(private readonly storage: ConversationStorageAdapter = AsyncStorage) {
    this.cache = new ConversationCacheRepository(storage);
    this.roomOutbox = new CollaborationRoomOutboxRepository(
      storage,
      enqueueConversationStorageWrite,
    );
    this.optimisticLedger = new OptimisticConversationLedgerRepository(
      storage,
      enqueueConversationStorageWrite,
    );
    this.interventionOutbox = new HostedInterventionOutboxRepository(
      storage,
      enqueueConversationStorageWrite,
      this.optimisticLedger,
    );
    this.drafts = new ConversationDraftRepository(storage);
    this.hostedTurnOutbox = new HostedTurnOutboxRepository(
      storage,
      enqueueConversationStorageWrite,
      this.optimisticLedger,
      this.drafts,
    );
  }

  async read(owner: string): Promise<ConversationCacheSnapshot | null> {
    return this.cache.read(owner);
  }

  async write(
    owner: string,
    conversations: readonly SingleConversation[],
    activeConversationId: string,
    expectedEpoch?: number,
  ): Promise<void> {
    return this.cache.write(owner, conversations, activeConversationId, expectedEpoch);
  }

  beginSynchronization(owner: string): number {
    return this.cache.beginSynchronization(owner);
  }

  async writeSynchronized(
    owner: string,
    generation: number,
    conversations: readonly SingleConversation[],
    activeConversationId: string,
  ): Promise<boolean> {
    return this.cache.writeSynchronized(
      owner,
      generation,
      conversations,
      activeConversationId,
    );
  }

  async readPendingEnqueues(owner: string): Promise<HostedTurnOutboxItem[]> {
    return this.hostedTurnOutbox.read(owner);
  }

  async claimReadyPendingEnqueues(
    owner: string,
    workerId: string,
    now = Date.now(),
    leaseMs = 5 * 60_000,
    limit = 4,
    expectedOwnerEpoch?: number,
  ): Promise<HostedTurnOutboxItem[]> {
    return this.hostedTurnOutbox.claimReady(
      owner,
      workerId,
      now,
      leaseMs,
      limit,
      expectedOwnerEpoch,
    );
  }

  async claimPendingEnqueueByRequest(
    owner: string,
    requestId: string,
    workerId: string,
    now = Date.now(),
    leaseMs = 5 * 60_000,
    expectedOwnerEpoch?: number,
  ): Promise<HostedTurnOutboxItem | null> {
    return this.hostedTurnOutbox.claimByRequest(
      owner,
      requestId,
      workerId,
      now,
      leaseMs,
      expectedOwnerEpoch,
    );
  }

  async releasePendingEnqueueLease(
    owner: string,
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<boolean> {
    return this.hostedTurnOutbox.releaseLease(owner, item, expectedOwnerEpoch);
  }

  readDraft(
    owner: string,
    conversationId: string,
    expectedOwnerEpoch?: number,
  ): Promise<ConversationDraft | null> {
    return this.hostedTurnOutbox.readDraft(owner, conversationId, expectedOwnerEpoch);
  }

  writeDraft(
    owner: string,
    conversationId: string,
    content: string,
    attachments: readonly ConversationDraftAttachment[] = [],
    expectedEpoch?: number,
  ): Promise<void> {
    return this.drafts.write(owner, conversationId, content, attachments, expectedEpoch);
  }

  clearDraftClaim(
    owner: string,
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    return this.hostedTurnOutbox.clearDraftClaim(owner, item, expectedOwnerEpoch);
  }

  async upsertPendingEnqueue(
    owner: string,
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    return this.hostedTurnOutbox.upsert(owner, item, expectedOwnerEpoch);
  }

  async readPendingInterventions(owner: string): Promise<HostedInterventionOutboxItem[]> {
    return this.interventionOutbox.read(owner);
  }

  async initializePendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<PendingInterventionMutationResult> {
    return this.interventionOutbox.initialize(owner, item, expectedOwnerEpoch);
  }

  async upsertPendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    return this.interventionOutbox.upsert(owner, item, expectedOwnerEpoch);
  }

  async removePendingIntervention(
    owner: string,
    messageId: string,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    return this.interventionOutbox.remove(owner, messageId, expectedOwnerEpoch);
  }

  async failPendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
    error: string,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    return this.interventionOutbox.fail(owner, item, error, expectedOwnerEpoch);
  }

  async initializePendingEnqueue(
    owner: string,
    item: HostedTurnOutboxItem,
    messages: readonly CollaborationMessage[],
    pendingTurn: OptimisticPendingTurn,
    expectedOwnerEpoch?: number,
  ): Promise<PendingEnqueueInitializationResult> {
    return this.hostedTurnOutbox.initialize(
      owner,
      item,
      messages,
      pendingTurn,
      expectedOwnerEpoch,
    );
  }

  async upsertPendingEnqueueIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<PendingEnqueueMutationResult> {
    return this.hostedTurnOutbox.upsertIfActive(owner, item, expectedOwnerEpoch);
  }

  async transitionPendingEnqueueRetry(
    owner: string,
    item: HostedTurnOutboxItem,
    pendingTurn: OptimisticPendingTurn,
    expectedOwnerEpoch?: number,
  ): Promise<PendingEnqueueMutationResult> {
    return this.hostedTurnOutbox.transitionRetry(owner, item, pendingTurn, expectedOwnerEpoch);
  }

  async transitionPendingEnqueueTerminal(
    owner: string,
    item: HostedTurnOutboxItem,
    terminalMessages: readonly CollaborationMessage[],
    expectedOwnerEpoch?: number,
  ): Promise<PendingEnqueueMutationResult> {
    return this.hostedTurnOutbox.transitionTerminal(
      owner,
      item,
      terminalMessages,
      expectedOwnerEpoch,
    );
  }

  async transitionPendingEnqueueForegroundFailure(
    owner: string,
    item: HostedTurnOutboxItem,
    terminalMessages: readonly CollaborationMessage[],
    expectedOwnerEpoch?: number,
  ): Promise<PendingEnqueueMutationResult> {
    return this.hostedTurnOutbox.transitionForegroundFailure(
      owner,
      item,
      terminalMessages,
      expectedOwnerEpoch,
    );
  }

  async acceptPendingEnqueueIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
    pendingTurn: OptimisticPendingTurn,
    expectedOwnerEpoch?: number,
  ): Promise<PendingEnqueueMutationResult> {
    return this.hostedTurnOutbox.acceptIfActive(owner, item, pendingTurn, expectedOwnerEpoch);
  }

  async cancelPendingEnqueue(
    owner: string,
    requestId: string,
    fallback?: HostedTurnOutboxItem,
    now = Date.now(),
    expectedOwnerEpoch?: number,
  ): Promise<HostedTurnOutboxItem | null> {
    return this.hostedTurnOutbox.cancel(owner, requestId, fallback, now, expectedOwnerEpoch);
  }

  async cancelPendingEnqueueAndFinalize(
    owner: string,
    requestId: string,
    fallback: HostedTurnOutboxItem | undefined,
    terminalMessages: readonly CollaborationMessage[],
    now = Date.now(),
    expectedOwnerEpoch?: number,
  ): Promise<HostedTurnOutboxItem | null> {
    return this.hostedTurnOutbox.cancelAndFinalize(
      owner,
      requestId,
      fallback,
      terminalMessages,
      now,
      expectedOwnerEpoch,
    );
  }

  async removePendingEnqueueIfActive(
    owner: string,
    requestId: string,
    expectedOwnerEpoch?: number,
  ): Promise<boolean> {
    return this.hostedTurnOutbox.removeIfActive(owner, requestId, expectedOwnerEpoch);
  }

  async removePendingEnqueueIfLeaseOwned(
    owner: string,
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<boolean> {
    return this.hostedTurnOutbox.removeIfLeaseOwned(owner, item, expectedOwnerEpoch);
  }

  async removePendingEnqueue(
    owner: string,
    requestId: string,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    return this.hostedTurnOutbox.remove(owner, requestId, expectedOwnerEpoch);
  }

  async readPendingRoomMessages(owner: string): Promise<CollaborationRoomOutboxItem[]> {
    return this.roomOutbox.read(owner);
  }

  async upsertPendingRoomMessage(
    owner: string,
    item: CollaborationRoomOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    return this.roomOutbox.upsert(owner, item, expectedOwnerEpoch);
  }

  async removePendingRoomMessage(
    owner: string,
    requestId: string,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    return this.roomOutbox.remove(owner, requestId, expectedOwnerEpoch);
  }

  async readOptimisticConversations(
    owner: string,
  ): Promise<OptimisticConversationLedgerItem[]> {
    return this.optimisticLedger.read(owner);
  }

  async replaceOptimisticMessages(
    owner: string,
    conversationId: string,
    messages: readonly CollaborationMessage[],
    pendingTurn?: OptimisticPendingTurn | null,
    expectedMessageIds?: readonly string[],
    expectedOwnerEpoch?: number,
  ): Promise<boolean> {
    return this.optimisticLedger.replaceMessages(
      owner,
      conversationId,
      messages,
      pendingTurn,
      expectedMessageIds,
      expectedOwnerEpoch,
    );
  }

  async updateOptimisticPendingTurn(
    owner: string,
    conversationId: string,
    pendingTurn: OptimisticPendingTurn,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    return this.optimisticLedger.updatePendingTurn(
      owner,
      conversationId,
      pendingTurn,
      expectedOwnerEpoch,
    );
  }

  async finalizeOptimisticTurn(
    owner: string,
    conversationId: string,
    terminalMessages: readonly CollaborationMessage[],
    expectedOwnerEpoch?: number,
  ): Promise<OptimisticConversationLedgerItem | null> {
    return this.optimisticLedger.finalizeTurn(
      owner,
      conversationId,
      terminalMessages,
      expectedOwnerEpoch,
    );
  }

  async purge(
    owner: string,
    beforeRemove?: (pending: HostedTurnOutboxItem[]) => Promise<void>,
  ): Promise<HostedTurnOutboxItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return [];
    beginConversationStorageOwnerPurge(normalizedOwner);
    let pendingAttachments: HostedTurnOutboxItem[] = [];
    await this.cache.purge(normalizedOwner, [
      hostedTurnOutboxKey(normalizedOwner),
      legacyHostedTurnOutboxKey(normalizedOwner),
      roomOutboxKey(normalizedOwner),
      legacyRoomOutboxKey(normalizedOwner),
      interventionOutboxKey(normalizedOwner),
      optimisticLedgerKey(normalizedOwner),
      conversationDraftsKey(normalizedOwner),
      conversationOwnerDeletionKey(normalizedOwner),
    ], async () => {
      await this.storage.setItem(
        conversationOwnerDeletionKey(normalizedOwner),
        JSON.stringify({ deletedAt: Date.now(), version: 1 }),
      );
      pendingAttachments = await this.hostedTurnOutbox.read(normalizedOwner);
      await beforeRemove?.(pendingAttachments);
    });
    return pendingAttachments;
  }

  /** Open a fresh authenticated lifecycle after any prior account deletion. */
  async activate(owner: string): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return;
    const epoch = beginConversationStorageOwnerActivation(normalizedOwner);
    try {
      await enqueueConversationStorageMaintenance(normalizedOwner, async () => {
        await this.storage.removeItem(conversationOwnerDeletionKey(normalizedOwner));
        completeConversationStorageOwnerActivation(normalizedOwner, epoch);
      });
    } catch (error) {
      // A broken local storage adapter must not leave the account permanently
      // fenced. Remote authentication is still valid; the next activation
      // can retry removing the tombstone. Releasing this epoch also prevents
      // every later local read/write from being silently blocked.
      completeConversationStorageOwnerActivation(normalizedOwner, epoch);
      throw error;
    }
  }
}
