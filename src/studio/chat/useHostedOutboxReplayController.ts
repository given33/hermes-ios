import {
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { ConversationLocalStore } from '../../api/conversation-local-store';
import type {
  HostedInterventionOutboxItem,
  HostedTurnOutboxItem,
  OptimisticPendingTurn,
} from '../../api/conversation-store-types';
import { ConversationSyncGeneration } from '../../api/conversation-sync-generation';
import type { HermesCloudApi } from '../../api/HermesCloudApi';
import {
  HOSTED_TURN_RETRY_DELAY_MS,
  HostedTurnDeliveryClaimRegistry,
  hostedTurnDeliveryClaimKey,
  hostedTurnOutboxReady,
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
  cleanupUnreferencedPickerCacheFiles,
  pendingChatSendFromOutbox,
} from './chat-attachments';
import { serverFailure } from './chat-domain';
import {
  HostedTurnCancelledDuringDelivery,
  type ChatAttachment,
  type HostedTurnDelivery,
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
  deliverAndReconcilePendingCancellation(item: HostedTurnOutboxItem): Promise<unknown>;
  handleOutboxFailure(
    source: HostedTurnOutboxItem,
    failure: HostedTurnDeliveryFailure,
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
  updatePendingPhase(phase: 'thinking' | 'reconnecting' | 'executing', startedAt?: number): void;
  finalizePendingSend: import('./useHostedCancellationController').HostedCancellationController['finalizePendingSend'];
}

export interface HostedOutboxReplayController {
  acceptPendingOutboxItem(item: HostedTurnOutboxItem): Promise<{
    item: HostedTurnOutboxItem | null;
    updated: boolean;
  }>;
  deliverPendingEnqueue(source: HostedTurnOutboxItem): Promise<HostedTurnDelivery>;
  deliverPendingIntervention(item: HostedInterventionOutboxItem): Promise<void>;
  interventionReplayService: HostedInterventionReplayService | null;
  replayDurableOutboxes(): Promise<void>;
  replayPendingEnqueues(): Promise<void>;
  settleAcceptedOutboxItem(
    item: HostedTurnOutboxItem,
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
  const outboxReplayRef = useRef<Promise<void> | null>(null);

  const deliverPendingEnqueue = useCallback(async (
    source: HostedTurnOutboxItem,
  ): Promise<HostedTurnDelivery> => {
    if (!hostedTurnDeliveryService) throw new Error('Durable outbox is unavailable');
    return hostedTurnDeliveryService.deliverPendingEnqueue(source);
  }, [hostedTurnDeliveryService]);

  const acceptPendingOutboxItem = useCallback(async (item: HostedTurnOutboxItem) => {
    if (!localStore || !cacheOwner) return { item: null, updated: false };
    const acceptedAt = item.deliveryAcceptedAt || Date.now();
    const pendingTurn: OptimisticPendingTurn = {
      attempt: 0,
      phase: 'thinking',
      phaseStartedAt: acceptedAt,
      turnId: item.input.turnId,
      updatedAt: acceptedAt,
      userMessageId: item.input.message.id,
    };
    const transition = await localStore.acceptPendingEnqueueIfActive(
      cacheOwner,
      { ...item, deliveryAcceptedAt: acceptedAt },
      pendingTurn,
    );
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
      updatePendingPhase('thinking', acceptedAt);
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
  ): Promise<'cancelled' | 'cleanup-pending' | 'settled'> => {
    if (!localStore || !cacheOwner) return 'cleanup-pending';
    try {
      cleanupPendingAttachments(item);
    } catch (error) {
      await localStore.upsertPendingEnqueueIfActive(cacheOwner, {
        ...item,
        lastError: serverFailure(error, isChinese),
        nextAttemptAt: Date.now() + acceptFailureCleanupDelayMs,
      });
      return 'cleanup-pending';
    }
    if (await localStore.removePendingEnqueueIfActive(cacheOwner, item.input.requestId)) {
      return 'settled';
    }
    const cancelled = (await localStore.readPendingEnqueues(cacheOwner)).find(
      ({ input }) => input.requestId === item.input.requestId,
    );
    if (cancelled?.cancelledAt) {
      void deliverAndReconcilePendingCancellation(cancelled);
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

  const replayPendingEnqueues = useCallback(async () => {
    if (!cloudApi || !localStore || !cacheOwner) return;
    if (outboxReplayRef.current) return outboxReplayRef.current;
    const replay = (async () => {
      const pending = await localStore.readPendingEnqueues(cacheOwner);
      try {
        for (const pendingItem of pending.sort((left, right) => left.queuedAt - right.queuedAt)) {
          if (pendingItem.cancelledAt) {
            if (!hostedTurnOutboxReady(pendingItem)) break;
            if (pendingItem.purpose === 'hosted-turn-cancel') {
              await deliverAndReconcilePendingCancellation(pendingItem);
              continue;
            }
            const repaired = await finalizePendingSend(
              pendingChatSendFromOutbox(pendingItem, cacheOwner),
              isChinese ? '任务已取消。' : 'Task cancelled.',
              'cancelled',
              'cancelled',
              isChinese ? '已取消' : 'Cancelled',
            );
            if (!repaired) continue;
            await deliverAndReconcilePendingCancellation(pendingItem);
            continue;
          }
          if (!hostedTurnOutboxReady(pendingItem)) break;
          if (pendingItem.deliveryTerminalAt) {
            await finalizePendingSend(
              pendingChatSendFromOutbox(pendingItem, cacheOwner),
              pendingItem.lastError || (isChinese ? '消息发送失败。' : 'Message delivery failed.'),
              'failed',
              'send-failed',
              isChinese ? '连接错误' : 'Connection error',
              pendingItem,
            );
            const settled = await settleAcceptedOutboxItem(pendingItem);
            if (settled === 'cleanup-pending') break;
            continue;
          }
          if (pendingItem.deliveryAcceptedAt) {
            const acceptedMutation = await acceptPendingOutboxItem(pendingItem);
            if (!acceptedMutation.updated || !acceptedMutation.item) {
              if (acceptedMutation.item?.cancelledAt) {
                await deliverAndReconcilePendingCancellation(acceptedMutation.item);
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
            const settled = await settleAcceptedOutboxItem(acceptedMutation.item);
            if (settled === 'cleanup-pending') break;
            continue;
          }
          const claimKey = hostedTurnDeliveryClaimKey(cacheOwner, pendingItem.input.requestId);
          const claim = hostedTurnDeliveryClaimsRef.current.tryAcquire(claimKey);
          if (!claim) break;
          try {
            const { item, response } = await deliverPendingEnqueue(pendingItem);
            const responseFailure = hostedTurnResponseFailure(response);
            if (responseFailure) {
              const outcome = await handleOutboxFailure(item, responseFailure);
              if (outcome === 'retry' || outcome === 'retry-background') break;
              continue;
            }
            if (response.route.mode === 'work') {
              updateConversationCollaborationState(item.conversationId, 'lifting');
            }
            const acceptedItem = {
              ...item,
              deliveryAcceptedAt: Date.now(),
              lastError: '',
              nextAttemptAt: 0,
            };
            const acceptedMutation = await acceptPendingOutboxItem(acceptedItem);
            if (!acceptedMutation.updated || !acceptedMutation.item) {
              if (acceptedMutation.item?.cancelledAt) {
                await deliverAndReconcilePendingCancellation(acceptedMutation.item);
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
            }
            const settled = await settleAcceptedOutboxItem(acceptedMutation.item);
            if (settled === 'cleanup-pending') break;
          } catch (error) {
            if (error instanceof HostedTurnCancelledDuringDelivery) {
              const cancelled = (await localStore.readPendingEnqueues(cacheOwner)).find(
                ({ input }) => input.requestId === pendingItem.input.requestId,
              );
              if (cancelled?.cancelledAt) {
                await deliverAndReconcilePendingCancellation(cancelled);
              }
              continue;
            }
            const failure = hostedTurnTransportFailure(error);
            const outcome = await handleOutboxFailure(pendingItem, {
              ...failure,
              message: serverFailure(error, isChinese),
            });
            if (outcome === 'retry' || outcome === 'retry-background') break;
          } finally {
            hostedTurnDeliveryClaimsRef.current.release(claimKey, claim);
          }
        }
      } finally {
        cleanupUnreferencedPickerCacheFiles([
          ...attachmentsRef.current,
          ...pending.flatMap((item) => (item.pendingAttachments || []).flatMap((attachment) => (
            attachment.sourceUri
              ? [{ ownedTemporary: attachment.ownedTemporary, uri: attachment.sourceUri }]
              : []
          ))),
        ]);
      }
    })();
    outboxReplayRef.current = replay;
    try {
      await replay;
    } finally {
      if (outboxReplayRef.current === replay) outboxReplayRef.current = null;
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
  ) => {
    if (!hostedTurnDeliveryService) {
      throw new Error('Durable hosted intervention outbox is unavailable');
    }
    await hostedTurnDeliveryService.deliverPendingIntervention(item);
  }, [hostedTurnDeliveryService]);

  const interventionReplayService = useMemo(() => (
    localStore && cacheOwner && hostedTurnDeliveryService
      ? createHostedInterventionReplayService({
          cacheOwner,
          deliver: deliverPendingIntervention,
          describeError: (error) => serverFailure(error, isChinese),
          isRetryable: (error) => hostedTurnTransportFailure(error).retryable,
          maxAttempts: maxReconnectAttempts,
          onDelivered: async (item) => {
            if (activeConversationIdRef.current !== item.conversationId) return;
            await loadConversation(
              item.conversationId,
              conversationSyncGenerationRef.current.active(),
            ).catch(() => undefined);
          },
          onPermanentFailure: (item) => {
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
    await Promise.all([
      replayPendingEnqueues(),
      interventionReplayService?.replay(),
    ]);
  }, [interventionReplayService, replayPendingEnqueues]);

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
