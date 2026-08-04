import {
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import { hasNativeIOSContext } from '../../../modules/hermes-ios-context';
import type { ConversationLocalStore } from '../../api/conversation-local-store';
import type {
  HostedInterventionOutboxItem,
  HostedTurnOutboxItem,
  OptimisticPendingTurn,
} from '../../api/conversation-store-types';
import { ConversationSyncGeneration } from '../../api/conversation-sync-generation';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';
import type { HermesCloudApi } from '../../api/HermesCloudApi';
import {
  HOSTED_TURN_RETRY_DELAY_MS,
  HostedTurnDeliveryClaimRegistry,
  hostedTurnDeliveryClaimKey,
  hostedTurnResponseFailure,
  hostedTurnTransportFailure,
  type HostedTurnDeliveryFailure,
} from '../../api/hosted-turn-delivery-state';
import {
  conversationMessagesToView,
  upsertChatMessage,
  type ConversationCollaborationState,
  type HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import {
  cleanupPendingAttachments,
  pendingChatSendFromOutbox,
} from './chat-attachments';
import { serverFailure } from './chat-domain';
import {
  HostedTurnCancelledDuringDelivery,
  type ChatAttachment,
  type HostedTurnDelivery,
  type PendingPhase,
} from './chat-types';
import type { HostedTurnDeliveryService } from './hosted-turn-delivery-service';
import {
  createHostedInterventionReplayService,
  type HostedInterventionReplayService,
} from './hosted-intervention-replay-service';

interface HostedOutboxReplayControllerOptions {
  acceptFailureCleanupDelayMs: number;
  activeConversationIdRef: MutableRefObject<string>;
  activeHostedTurnIdRef: MutableRefObject<string>;
  attachmentsRef: MutableRefObject<ChatAttachment[]>;
  beginOptimisticHostedTurn(conversationId: string, turnId: string): void;
  cacheOwner: string;
  cloudApi: HermesCloudApi | null;
  conversationSyncGenerationRef: MutableRefObject<ConversationSyncGeneration>;
  deliverAndReconcilePendingCancellation(
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<unknown>;
  handleOutboxFailure(
    source: HostedTurnOutboxItem,
    failure: HostedTurnDeliveryFailure,
    expectedOwnerEpoch: number,
  ): Promise<'retry' | 'retry-background' | 'terminal'>;
  hostedTurnDeliveryClaimsRef: MutableRefObject<HostedTurnDeliveryClaimRegistry>;
  hostedTurnDeliveryService: HostedTurnDeliveryService | null;
  isChinese: boolean;
  loadConversation(
    conversationId: string,
    expectedGeneration?: number,
    signal?: AbortSignal,
  ): Promise<unknown>;
  localStore: ConversationLocalStore | null;
  maxReconnectAttempts: number;
  mountedRef: MutableRefObject<boolean>;
  optimisticMessagesByConversationRef: MutableRefObject<Map<string, ChatMessage[]>>;
  optimisticMessagesRef: MutableRefObject<ChatMessage[]>;
  optimisticPendingByConversationRef: MutableRefObject<Map<string, OptimisticPendingTurn>>;
  pendingTurnActiveRef: MutableRefObject<boolean>;
  profile: string;
  setActiveConversationId: Dispatch<SetStateAction<string>>;
  setActiveHostedTurnId: Dispatch<SetStateAction<string>>;
  setHostedRunning: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setReconnectAttempt(attempt: number): void;
  setSending: Dispatch<SetStateAction<boolean>>;
  updateConversationCollaborationState(
    conversationId: string,
    state: ConversationCollaborationState,
  ): void;
  updatePendingPhase(phase: PendingPhase, startedAt?: number): void;
  finalizePendingSend: import('./useHostedCancellationController').HostedCancellationController['finalizePendingSend'];
}

export interface HostedOutboxReplayController {
  acceptPendingOutboxItem(item: HostedTurnOutboxItem, expectedOwnerEpoch: number): Promise<{
    item: HostedTurnOutboxItem | null;
    updated: boolean;
  }>;
  deliverPendingEnqueue(
    source: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<HostedTurnDelivery>;
  deliverPendingIntervention(
    item: HostedInterventionOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<void>;
  interventionReplayService: HostedInterventionReplayService | null;
  replayDurableOutboxes(): Promise<void>;
  replayPendingEnqueues(expectedOwnerEpoch?: number): Promise<void>;
  settleAcceptedOutboxItem(
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<'cancelled' | 'cleanup-pending' | 'settled'>;
}

export function useHostedOutboxReplayController({
  acceptFailureCleanupDelayMs,
  activeConversationIdRef,
  activeHostedTurnIdRef,
  attachmentsRef,
  beginOptimisticHostedTurn,
  cacheOwner,
  cloudApi,
  conversationSyncGenerationRef,
  deliverAndReconcilePendingCancellation,
  finalizePendingSend,
  handleOutboxFailure,
  hostedTurnDeliveryClaimsRef,
  hostedTurnDeliveryService,
  isChinese,
  loadConversation,
  localStore,
  maxReconnectAttempts,
  mountedRef,
  optimisticMessagesByConversationRef,
  optimisticMessagesRef,
  optimisticPendingByConversationRef,
  pendingTurnActiveRef,
  profile,
  setActiveConversationId,
  setActiveHostedTurnId,
  setHostedRunning,
  setMessages,
  setReconnectAttempt,
  setSending,
  updateConversationCollaborationState,
  updatePendingPhase,
}: HostedOutboxReplayControllerOptions): HostedOutboxReplayController {
  const outboxReplayRef = useRef<{ epoch: number; promise: Promise<void> } | null>(null);
  const replayWorkerIdRef = useRef(
    `ios-hosted-outbox:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  );

  const deliverPendingEnqueue = useCallback(async (
    source: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<HostedTurnDelivery> => {
    if (!hostedTurnDeliveryService) throw new Error('Durable outbox is unavailable');
    return hostedTurnDeliveryService.deliverPendingEnqueue(source, expectedOwnerEpoch);
  }, [hostedTurnDeliveryService]);

  const acceptPendingOutboxItem = useCallback(async (
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ) => {
    if (!localStore || !cacheOwner) return { item: null, updated: false };
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) {
      return { item: null, updated: false };
    }
    const acceptedAt = item.deliveryAcceptedAt || Date.now();
    const pendingTurn: OptimisticPendingTurn = {
      attempt: 0,
      phase: 'connecting',
      phaseStartedAt: acceptedAt,
      turnId: item.input.turnId,
      updatedAt: acceptedAt,
      userMessageId: item.input.message.id,
    };
    const transition = await localStore.acceptPendingEnqueueIfActive(
      cacheOwner,
      { ...item, deliveryAcceptedAt: acceptedAt },
      pendingTurn,
      expectedOwnerEpoch,
    );
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) {
      return { item: null, updated: false };
    }
    if (!transition.updated || !transition.item) return transition;
    const failureIds = new Set([
      `send-failed-${item.input.message.id}`,
      `connection-unavailable-${item.input.message.id}`,
    ]);
    const optimistic = (optimisticMessagesByConversationRef.current.get(item.conversationId) || [])
      .filter(({ id }) => !failureIds.has(id));
    optimisticMessagesByConversationRef.current.set(item.conversationId, optimistic);
    optimisticPendingByConversationRef.current.set(item.conversationId, pendingTurn);
    if (mountedRef.current && activeConversationIdRef.current === item.conversationId) {
      optimisticMessagesRef.current = optimistic;
      setMessages((current) => current.filter(({ id }) => !failureIds.has(id)));
      pendingTurnActiveRef.current = true;
      updatePendingPhase('connecting', acceptedAt);
      setReconnectAttempt(0);
    }
    return transition;
  }, [
    activeConversationIdRef,
    cacheOwner,
    localStore,
    mountedRef,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    pendingTurnActiveRef,
    setMessages,
    setReconnectAttempt,
    updatePendingPhase,
  ]);

  const settleAcceptedOutboxItem = useCallback(async (
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<'cancelled' | 'cleanup-pending' | 'settled'> => {
    if (!localStore || !cacheOwner) return 'cleanup-pending';
    const lifecycleCurrent = () => isConversationStorageEpochCurrent(
      cacheOwner,
      expectedOwnerEpoch,
    );
    if (!lifecycleCurrent()) return 'cleanup-pending';
    try {
      cleanupPendingAttachments(item);
    } catch (error) {
      await localStore.upsertPendingEnqueueIfActive(
        cacheOwner,
        {
          ...item,
          lastError: serverFailure(error, isChinese),
          nextAttemptAt: Date.now() + acceptFailureCleanupDelayMs,
        },
        expectedOwnerEpoch,
      );
      return 'cleanup-pending';
    }
    if (await localStore.removePendingEnqueueIfLeaseOwned(
      cacheOwner,
      item,
      expectedOwnerEpoch,
    )) {
      if (!lifecycleCurrent()) return 'cleanup-pending';
      return 'settled';
    }
    if (!lifecycleCurrent()) return 'cleanup-pending';
    const cancelled = (await localStore.readPendingEnqueues(cacheOwner)).find(
      ({ input }) => input.requestId === item.input.requestId,
    );
    if (!lifecycleCurrent()) return 'cleanup-pending';
    if (cancelled?.cancelledAt) {
      void deliverAndReconcilePendingCancellation(cancelled, expectedOwnerEpoch);
      return 'cancelled';
    }
    return 'settled';
  }, [
    acceptFailureCleanupDelayMs,
    cacheOwner,
    deliverAndReconcilePendingCancellation,
    isChinese,
    localStore,
  ]);

  const replayPendingEnqueues = useCallback(async (
    expectedOwnerEpoch = captureConversationStorageEpoch(cacheOwner),
  ) => {
    if (!cloudApi || !localStore || !cacheOwner) return;
    if (outboxReplayRef.current?.epoch === expectedOwnerEpoch) {
      return outboxReplayRef.current.promise;
    }
    const lifecycleCurrent = () => isConversationStorageEpochCurrent(
      cacheOwner,
      expectedOwnerEpoch,
    );
    if (!lifecycleCurrent()) return;
    const replay = (async () => {
      const pending = await localStore.claimReadyPendingEnqueues(
        cacheOwner,
        replayWorkerIdRef.current,
        Date.now(),
        5 * 60_000,
        4,
        expectedOwnerEpoch,
      );
      if (!lifecycleCurrent()) return;
      try {
        for (const pendingItem of pending) {
          if (!lifecycleCurrent()) return;
          if (pendingItem.cancelledAt) {
            const cancelRequested: OptimisticPendingTurn = {
              attempt: pendingItem.attempts || 0,
              phase: 'cancel_requested',
              phaseStartedAt: pendingItem.cancelledAt,
              turnId: pendingItem.input.turnId,
              updatedAt: Date.now(),
              userMessageId: pendingItem.input.message.id,
            };
            optimisticPendingByConversationRef.current.set(
              pendingItem.conversationId,
              cancelRequested,
            );
            if (activeConversationIdRef.current === pendingItem.conversationId) {
              updatePendingPhase('cancel_requested', pendingItem.cancelledAt);
              setHostedRunning(true);
              setSending(true);
            }
            await deliverAndReconcilePendingCancellation(pendingItem, expectedOwnerEpoch);
            if (!lifecycleCurrent()) return;
            continue;
          }
          if (pendingItem.deliveryTerminalAt) {
            await finalizePendingSend(
              pendingChatSendFromOutbox(pendingItem, cacheOwner),
              pendingItem.lastError || (isChinese ? '消息发送失败。' : 'Message delivery failed.'),
              'failed',
              'send-failed',
              isChinese ? '连接错误' : 'Connection error',
              pendingItem,
            );
            if (!lifecycleCurrent()) return;
            const settled = await settleAcceptedOutboxItem(pendingItem, expectedOwnerEpoch);
            if (!lifecycleCurrent()) return;
            if (settled === 'cleanup-pending') continue;
            continue;
          }
          if (pendingItem.deliveryAcceptedAt) {
            const acceptedMutation = await acceptPendingOutboxItem(
              pendingItem,
              expectedOwnerEpoch,
            );
            if (!lifecycleCurrent()) return;
            if (!acceptedMutation.updated || !acceptedMutation.item) {
              if (acceptedMutation.item?.cancelledAt) {
                await deliverAndReconcilePendingCancellation(
                  acceptedMutation.item,
                  expectedOwnerEpoch,
                );
              }
              continue;
            }
            activeHostedTurnIdRef.current = acceptedMutation.item.input.turnId;
            beginOptimisticHostedTurn(
              acceptedMutation.item.conversationId,
              acceptedMutation.item.input.turnId,
            );
            setActiveHostedTurnId(acceptedMutation.item.input.turnId);
            setHostedRunning(true);
            setSending(true);
            const settled = await settleAcceptedOutboxItem(
              acceptedMutation.item,
              expectedOwnerEpoch,
            );
            if (!lifecycleCurrent()) return;
            if (settled === 'cleanup-pending') continue;
            continue;
          }
          if (pendingItem.pendingAttachments?.length && !hasNativeIOSContext) {
            // Attachments are encrypted by the iOS vault. An old outbox row
            // can survive a platform upgrade, so terminate it explicitly
            // instead of retrying a permanently unavailable native call.
            await handleOutboxFailure(
              pendingItem,
              {
                certainty: 'definitive',
                code: 'HERMES_NATIVE_ATTACHMENTS_UNAVAILABLE',
                message: 'Queued attachments require the Hermes iOS app build.',
                retryable: false,
              },
              expectedOwnerEpoch,
            );
            if (!lifecycleCurrent()) return;
            continue;
          }
          const claimKey = hostedTurnDeliveryClaimKey(cacheOwner, pendingItem.input.requestId);
          const claim = hostedTurnDeliveryClaimsRef.current.tryAcquire(claimKey);
          if (!claim) continue;
          try {
            const { item, response } = await deliverPendingEnqueue(
              pendingItem,
              expectedOwnerEpoch,
            );
            if (!lifecycleCurrent()) return;
            const responseFailure = hostedTurnResponseFailure(response);
            if (responseFailure) {
              const outcome = await handleOutboxFailure(
                item,
                responseFailure,
                expectedOwnerEpoch,
              );
              if (!lifecycleCurrent()) return;
              if (outcome === 'retry' || outcome === 'retry-background') continue;
              continue;
            }
            const acceptedItem = {
              ...item,
              deliveryAcceptedAt: Date.now(),
              lastError: '',
              nextAttemptAt: 0,
            };
            const acceptedMutation = await acceptPendingOutboxItem(
              acceptedItem,
              expectedOwnerEpoch,
            );
            if (!lifecycleCurrent()) return;
            if (!acceptedMutation.updated || !acceptedMutation.item) {
              if (acceptedMutation.item?.cancelledAt) {
                await deliverAndReconcilePendingCancellation(
                  acceptedMutation.item,
                  expectedOwnerEpoch,
                );
              }
              continue;
            }
            if (!activeConversationIdRef.current) {
              activeConversationIdRef.current = item.conversationId;
              setActiveConversationId(item.conversationId);
            }
            if (activeConversationIdRef.current === item.conversationId) {
              activeHostedTurnIdRef.current = item.input.turnId;
              beginOptimisticHostedTurn(item.conversationId, item.input.turnId);
              setActiveHostedTurnId(item.input.turnId);
              setHostedRunning(true);
              setSending(true);
              const generation = conversationSyncGenerationRef.current.advanceActive();
              await loadConversation(item.conversationId, generation);
              if (!lifecycleCurrent()) return;
            }
            const settled = await settleAcceptedOutboxItem(
              acceptedMutation.item,
              expectedOwnerEpoch,
            );
            if (!lifecycleCurrent()) return;
            if (settled === 'cleanup-pending') continue;
          } catch (error) {
            if (!lifecycleCurrent()) return;
            if (error instanceof HostedTurnCancelledDuringDelivery) {
              const cancelled = (await localStore.readPendingEnqueues(cacheOwner)).find(
                ({ input }) => input.requestId === pendingItem.input.requestId,
              );
              if (!lifecycleCurrent()) return;
              if (cancelled?.cancelledAt) {
                await deliverAndReconcilePendingCancellation(cancelled, expectedOwnerEpoch);
              }
              continue;
            }
            const failure = hostedTurnTransportFailure(error);
            const outcome = await handleOutboxFailure(
              pendingItem,
              {
                ...failure,
                message: serverFailure(error, isChinese),
              },
              expectedOwnerEpoch,
            );
            if (!lifecycleCurrent()) return;
            if (outcome === 'retry' || outcome === 'retry-background') continue;
          } finally {
            hostedTurnDeliveryClaimsRef.current.release(claimKey, claim);
          }
        }
      } finally {
        await Promise.allSettled(pending.map((item) => (
          localStore.releasePendingEnqueueLease(cacheOwner, item, expectedOwnerEpoch)
        )));
      }
    })();
    outboxReplayRef.current = { epoch: expectedOwnerEpoch, promise: replay };
    try {
      await replay;
    } finally {
      if (outboxReplayRef.current?.promise === replay) outboxReplayRef.current = null;
    }
  }, [
    acceptPendingOutboxItem,
    activeConversationIdRef,
    activeHostedTurnIdRef,
    attachmentsRef,
    beginOptimisticHostedTurn,
    cacheOwner,
    cloudApi,
    conversationSyncGenerationRef,
    deliverAndReconcilePendingCancellation,
    deliverPendingEnqueue,
    finalizePendingSend,
    handleOutboxFailure,
    hostedTurnDeliveryClaimsRef,
    isChinese,
    loadConversation,
    localStore,
    setActiveConversationId,
    setActiveHostedTurnId,
    setHostedRunning,
    setSending,
    settleAcceptedOutboxItem,
    updateConversationCollaborationState,
  ]);

  const deliverPendingIntervention = useCallback(async (
    item: HostedInterventionOutboxItem,
    expectedOwnerEpoch: number,
  ) => {
    if (!hostedTurnDeliveryService) {
      throw new Error('Durable hosted intervention outbox is unavailable');
    }
    await hostedTurnDeliveryService.deliverPendingIntervention(item, expectedOwnerEpoch);
  }, [hostedTurnDeliveryService]);

  const interventionReplayService = useMemo(() => (
    localStore && cacheOwner && hostedTurnDeliveryService
      ? createHostedInterventionReplayService({
          cacheOwner,
          deliver: deliverPendingIntervention,
          describeError: (error) => serverFailure(error, isChinese),
          isRetryable: (error) => hostedTurnTransportFailure(error).retryable,
          maxAttempts: maxReconnectAttempts,
          onDelivered: async (item, expectedOwnerEpoch) => {
            if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return;
            if (activeConversationIdRef.current !== item.conversationId) return;
            await loadConversation(
              item.conversationId,
              conversationSyncGenerationRef.current.active(),
            ).catch(() => undefined);
            if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return;
          },
          onPermanentFailure: (item, _message, expectedOwnerEpoch) => {
            if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return;
            if (activeConversationIdRef.current !== item.conversationId) return;
            const failedMessage = conversationMessagesToView({
              id: item.conversationId,
              message_count: 1,
              messages: [{ ...item.message, status: 'failed' }],
              profile,
              runtime_sessions: {},
              title: '',
              updated_at: Date.now(),
            }, isChinese)[0];
            if (failedMessage) {
              setMessages((current) => upsertChatMessage(current, failedMessage));
            }
          },
          outbox: localStore,
          retryDelayMs: HOSTED_TURN_RETRY_DELAY_MS,
        })
      : null
  ), [
    activeConversationIdRef,
    cacheOwner,
    conversationSyncGenerationRef,
    deliverPendingIntervention,
    hostedTurnDeliveryService,
    isChinese,
    loadConversation,
    localStore,
    maxReconnectAttempts,
    profile,
    setMessages,
  ]);

  const replayDurableOutboxes = useCallback(async () => {
    const expectedOwnerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return;
    await Promise.all([
      replayPendingEnqueues(expectedOwnerEpoch),
      interventionReplayService?.replay(expectedOwnerEpoch),
    ]);
  }, [cacheOwner, interventionReplayService, replayPendingEnqueues]);

  return {
    acceptPendingOutboxItem,
    deliverPendingEnqueue,
    deliverPendingIntervention,
    interventionReplayService,
    replayDurableOutboxes,
    replayPendingEnqueues,
    settleAcceptedOutboxItem,
  };
}
