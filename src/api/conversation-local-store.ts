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
import { enqueueConversationStorageWrite } from './conversation-storage-coordinator';

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
  PendingEnqueueMutationResult,
  PendingInterventionMutationResult,
} from './conversation-store-types';
export {
  isCompleteConversation,
  mergeDownloadedConversations,
  mergeOptimisticConversationLedgers,
  reconcileConversationCache,
  synchronizeConversationCache,
  upsertCachedConversation,
} from './conversation-cache-sync';

export class ConversationLocalStore {
  private readonly cache: ConversationCacheRepository;
  private readonly roomOutbox: CollaborationRoomOutboxRepository;
  private readonly optimisticLedger: OptimisticConversationLedgerRepository;
  private readonly interventionOutbox: HostedInterventionOutboxRepository;
  private readonly hostedTurnOutbox: HostedTurnOutboxRepository;

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
    this.hostedTurnOutbox = new HostedTurnOutboxRepository(
      storage,
      enqueueConversationStorageWrite,
      this.optimisticLedger,
    );
  }

  async read(owner: string): Promise<ConversationCacheSnapshot | null> {
    return this.cache.read(owner);
  }

  async write(
    owner: string,
    conversations: readonly SingleConversation[],
    activeConversationId: string,
  ): Promise<void> {
    return this.cache.write(owner, conversations, activeConversationId);
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

  async upsertPendingEnqueue(owner: string, item: HostedTurnOutboxItem): Promise<void> {
    return this.hostedTurnOutbox.upsert(owner, item);
  }

  async readPendingInterventions(owner: string): Promise<HostedInterventionOutboxItem[]> {
    return this.interventionOutbox.read(owner);
  }

  async initializePendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
  ): Promise<PendingInterventionMutationResult> {
    return this.interventionOutbox.initialize(owner, item);
  }

  async upsertPendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
  ): Promise<void> {
    return this.interventionOutbox.upsert(owner, item);
  }

  async removePendingIntervention(owner: string, messageId: string): Promise<void> {
    return this.interventionOutbox.remove(owner, messageId);
  }

  async failPendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
    error: string,
  ): Promise<void> {
    return this.interventionOutbox.fail(owner, item, error);
  }

  async initializePendingEnqueue(
    owner: string,
    item: HostedTurnOutboxItem,
    messages: readonly CollaborationMessage[],
    pendingTurn: OptimisticPendingTurn,
  ): Promise<PendingEnqueueMutationResult> {
    return this.hostedTurnOutbox.initialize(owner, item, messages, pendingTurn);
  }

  async upsertPendingEnqueueIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
  ): Promise<PendingEnqueueMutationResult> {
    return this.hostedTurnOutbox.upsertIfActive(owner, item);
  }

  async transitionPendingEnqueueRetry(
    owner: string,
    item: HostedTurnOutboxItem,
    pendingTurn: OptimisticPendingTurn,
  ): Promise<PendingEnqueueMutationResult> {
    return this.hostedTurnOutbox.transitionRetry(owner, item, pendingTurn);
  }

  async transitionPendingEnqueueTerminal(
    owner: string,
    item: HostedTurnOutboxItem,
    terminalMessages: readonly CollaborationMessage[],
  ): Promise<PendingEnqueueMutationResult> {
    return this.hostedTurnOutbox.transitionTerminal(owner, item, terminalMessages);
  }

  async transitionPendingEnqueueForegroundFailure(
    owner: string,
    item: HostedTurnOutboxItem,
    terminalMessages: readonly CollaborationMessage[],
  ): Promise<PendingEnqueueMutationResult> {
    return this.hostedTurnOutbox.transitionForegroundFailure(owner, item, terminalMessages);
  }

  async acceptPendingEnqueueIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
    pendingTurn: OptimisticPendingTurn,
  ): Promise<PendingEnqueueMutationResult> {
    return this.hostedTurnOutbox.acceptIfActive(owner, item, pendingTurn);
  }

  async cancelPendingEnqueue(
    owner: string,
    requestId: string,
    fallback?: HostedTurnOutboxItem,
    now = Date.now(),
  ): Promise<HostedTurnOutboxItem | null> {
    return this.hostedTurnOutbox.cancel(owner, requestId, fallback, now);
  }

  async cancelPendingEnqueueAndFinalize(
    owner: string,
    requestId: string,
    fallback: HostedTurnOutboxItem | undefined,
    terminalMessages: readonly CollaborationMessage[],
    now = Date.now(),
  ): Promise<HostedTurnOutboxItem | null> {
    return this.hostedTurnOutbox.cancelAndFinalize(
      owner,
      requestId,
      fallback,
      terminalMessages,
      now,
    );
  }

  async removePendingEnqueueIfActive(owner: string, requestId: string): Promise<boolean> {
    return this.hostedTurnOutbox.removeIfActive(owner, requestId);
  }

  async removePendingEnqueue(owner: string, requestId: string): Promise<void> {
    return this.hostedTurnOutbox.remove(owner, requestId);
  }

  async readPendingRoomMessages(owner: string): Promise<CollaborationRoomOutboxItem[]> {
    return this.roomOutbox.read(owner);
  }

  async upsertPendingRoomMessage(
    owner: string,
    item: CollaborationRoomOutboxItem,
  ): Promise<void> {
    return this.roomOutbox.upsert(owner, item);
  }

  async removePendingRoomMessage(owner: string, requestId: string): Promise<void> {
    return this.roomOutbox.remove(owner, requestId);
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
  ): Promise<boolean> {
    return this.optimisticLedger.replaceMessages(
      owner,
      conversationId,
      messages,
      pendingTurn,
      expectedMessageIds,
    );
  }

  async updateOptimisticPendingTurn(
    owner: string,
    conversationId: string,
    pendingTurn: OptimisticPendingTurn,
  ): Promise<void> {
    return this.optimisticLedger.updatePendingTurn(owner, conversationId, pendingTurn);
  }

  async finalizeOptimisticTurn(
    owner: string,
    conversationId: string,
    terminalMessages: readonly CollaborationMessage[],
  ): Promise<OptimisticConversationLedgerItem | null> {
    return this.optimisticLedger.finalizeTurn(owner, conversationId, terminalMessages);
  }

  async purge(
    owner: string,
    beforeRemove?: (pending: HostedTurnOutboxItem[]) => Promise<void>,
  ): Promise<HostedTurnOutboxItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return [];
    let pendingAttachments: HostedTurnOutboxItem[] = [];
    await this.cache.purge(normalizedOwner, [
      hostedTurnOutboxKey(normalizedOwner),
      legacyHostedTurnOutboxKey(normalizedOwner),
      roomOutboxKey(normalizedOwner),
      legacyRoomOutboxKey(normalizedOwner),
      interventionOutboxKey(normalizedOwner),
      optimisticLedgerKey(normalizedOwner),
    ], async () => {
      pendingAttachments = await this.hostedTurnOutbox.read(normalizedOwner);
      await beforeRemove?.(pendingAttachments);
    });
    return pendingAttachments;
  }
}
