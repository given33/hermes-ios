import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { withAbortableDeadline } from '../../api/async-deadline';
import type { ConversationLocalStore } from '../../api/conversation-local-store';
import type {
  HostedTurnOutboxItem,
  OptimisticPendingTurn,
} from '../../api/conversation-store-types';
import type { HermesCloudApi, SingleConversation } from '../../api/HermesCloudApi';
import {
  decideHostedTurnCancellationFailure,
  decideHostedTurnDeliveryFailure,
  hostedTurnDeliveryClaimKey,
  type HostedTurnDeliveryFailure,
} from '../../api/hosted-turn-delivery-state';
import {
  upsertChatMessage,
  type HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import {
  cleanupPendingAttachments,
  pendingChatSendFromOutbox,
} from './chat-attachments';
import {
  chatMessageToCollaborationMessage,
  serverFailure,
} from './chat-domain';
import type {
  PendingCancellationDeliveryResult,
  PendingChatSend,
} from './chat-types';

interface HostedCancellationControllerOptions {
  activeConversationIdRef: MutableRefObject<string>;
  activeHostedTurnIdRef: MutableRefObject<string>;
  applyConversation(conversation: SingleConversation): void;
  cacheOwner: string;
  cancelTimeoutMs: number;
  cancelledKeysRef: MutableRefObject<Set<string>>;
  cloudApi: HermesCloudApi | null;
  isChinese: boolean;
  localStore: ConversationLocalStore | null;
  maxReconnectAttempts: number;
  mountedRef: MutableRefObject<boolean>;
  notify(message: string): void;
  optimisticMessagesByConversationRef: MutableRefObject<Map<string, ChatMessage[]>>;
  optimisticMessagesRef: MutableRefObject<ChatMessage[]>;
  optimisticPendingByConversationRef: MutableRefObject<Map<string, OptimisticPendingTurn>>;
  pendingChatSendRef: MutableRefObject<PendingChatSend | null>;
  pendingTurnActiveRef: MutableRefObject<boolean>;
  replaceOptimisticMessages(
    conversationId: string,
    nextMessages: readonly ChatMessage[],
    pendingTurn?: OptimisticPendingTurn | null,
  ): Promise<void>;
  resetPendingStateMachine(): void;
  sendOperationGenerationRef: MutableRefObject<number>;
  setActiveHostedTurnId: Dispatch<SetStateAction<string>>;
  setHostedRunning: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setReconnectAttempt(attempt: number): void;
  setSending: Dispatch<SetStateAction<boolean>>;
  updatePendingPhase(phase: 'thinking' | 'reconnecting' | 'executing', startedAt?: number): void;
}

export interface HostedCancellationController {
  cancelPendingSend(): Promise<boolean>;
  deliverAndReconcilePendingCancellation(
    item: HostedTurnOutboxItem,
  ): Promise<PendingCancellationDeliveryResult>;
  finalizePendingSend(
    pending: PendingChatSend,
    content: string,
    status: 'cancelled' | 'failed',
    idPrefix: string,
    roleLabel: string,
    terminalOutbox?: HostedTurnOutboxItem,
  ): Promise<boolean>;
  handleOutboxFailure(
    source: HostedTurnOutboxItem,
    failure: HostedTurnDeliveryFailure,
  ): Promise<'retry' | 'retry-background' | 'terminal'>;
}

export function useHostedCancellationController({
  activeConversationIdRef,
  activeHostedTurnIdRef,
  applyConversation,
  cacheOwner,
  cancelTimeoutMs,
  cancelledKeysRef,
  cloudApi,
  isChinese,
  localStore,
  maxReconnectAttempts,
  mountedRef,
  notify,
  optimisticMessagesByConversationRef,
  optimisticMessagesRef,
  optimisticPendingByConversationRef,
  pendingChatSendRef,
  pendingTurnActiveRef,
  replaceOptimisticMessages,
  resetPendingStateMachine,
  sendOperationGenerationRef,
  setActiveHostedTurnId,
  setHostedRunning,
  setMessages,
  setReconnectAttempt,
  setSending,
  updatePendingPhase,
}: HostedCancellationControllerOptions): HostedCancellationController {
  const finalizePendingSend = useCallback(async (
    pending: PendingChatSend,
    content: string,
    status: 'cancelled' | 'failed',
    idPrefix: string,
    roleLabel: string,
    terminalOutbox?: HostedTurnOutboxItem,
  ): Promise<boolean> => {
    const completedAt = Date.now();
    const terminalMessage: ChatMessage = {
      avatarRole: 'hermes',
      completedAt,
      content,
      createdAt: completedAt,
      durationMs: 0,
      id: `${idPrefix}-${pending.userMessage.id}`,
      name: 'Hermes Agent',
      role: 'assistant',
      roleLabel,
      roleStage: 'chat',
      runtimeTurnId: pending.queuedItem?.input.turnId,
      status,
      updatedAt: completedAt,
    };
    const current = optimisticMessagesByConversationRef.current.get(pending.conversationId) || [];
    const finalMessages = upsertChatMessage(
      upsertChatMessage(current, pending.userMessage),
      terminalMessage,
    );
    if (localStore && cacheOwner) {
      const terminalMessages = [pending.userMessage, terminalMessage]
        .map(chatMessageToCollaborationMessage);
      if (status === 'cancelled') {
        const cancelled = await localStore.cancelPendingEnqueueAndFinalize(
          cacheOwner,
          pending.userMessage.id,
          pending.queuedItem,
          terminalMessages,
        );
        if (!cancelled?.cancelledAt) return false;
        pending.queuedItem = cancelled;
      } else if (terminalOutbox) {
        const transition = terminalOutbox.deliveryTerminalAt
          ? await localStore.transitionPendingEnqueueTerminal(
              cacheOwner,
              terminalOutbox,
              terminalMessages,
            )
          : await localStore.transitionPendingEnqueueForegroundFailure(
              cacheOwner,
              terminalOutbox,
              terminalMessages,
            );
        if (!transition.updated) return false;
      } else {
        await localStore.finalizeOptimisticTurn(
          cacheOwner,
          pending.conversationId,
          terminalMessages,
        );
      }
    } else {
      await replaceOptimisticMessages(pending.conversationId, finalMessages, null);
    }
    optimisticMessagesByConversationRef.current.set(pending.conversationId, finalMessages);
    optimisticPendingByConversationRef.current.delete(pending.conversationId);
    if (mountedRef.current && activeConversationIdRef.current === pending.conversationId) {
      optimisticMessagesRef.current = finalMessages;
      setMessages((messages) => upsertChatMessage(
        upsertChatMessage(messages, pending.userMessage),
        terminalMessage,
      ));
      resetPendingStateMachine();
      setHostedRunning(false);
      setSending(false);
    }
    if (pendingChatSendRef.current?.key === pending.key) {
      pendingChatSendRef.current = null;
    }
    return true;
  }, [
    activeConversationIdRef,
    cacheOwner,
    localStore,
    mountedRef,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    pendingChatSendRef,
    replaceOptimisticMessages,
    resetPendingStateMachine,
    setHostedRunning,
    setMessages,
    setSending,
  ]);

  const handleOutboxFailure = useCallback(async (
    source: HostedTurnOutboxItem,
    failure: HostedTurnDeliveryFailure,
  ): Promise<'retry' | 'retry-background' | 'terminal'> => {
    if (!localStore || !cacheOwner) return 'terminal';
    const decision = decideHostedTurnDeliveryFailure(source, failure);
    const pending = pendingChatSendFromOutbox(decision.item, cacheOwner);
    if (decision.terminal) {
      const terminalItem = { ...decision.item, deliveryTerminalAt: Date.now() };
      const finalized = await finalizePendingSend(
        pending,
        decision.failure.message,
        'failed',
        'send-failed',
        isChinese ? '模型连接错误' : 'Model connection error',
        terminalItem,
      );
      if (!finalized) return 'terminal';
      try {
        cleanupPendingAttachments(terminalItem);
        await localStore.removePendingEnqueueIfActive(cacheOwner, source.input.requestId);
      } catch {
        // The terminal row remains a cleanup intent and is never redelivered.
      }
      return 'terminal';
    }
    const foregroundFailed = failure.certainty === 'uncertain'
      && (decision.item.attempts || 0) >= maxReconnectAttempts;
    const retryItem = {
      ...decision.item,
      ...(foregroundFailed && !decision.item.foregroundFailedAt
        ? { foregroundFailedAt: Date.now() }
        : {}),
    };
    if (foregroundFailed) {
      const finalized = await finalizePendingSend(
        pendingChatSendFromOutbox(retryItem, cacheOwner),
        decision.failure.message,
        'failed',
        'send-failed',
        isChinese ? '连接错误' : 'Connection error',
        retryItem,
      );
      return finalized ? 'retry-background' : 'terminal';
    }
    const reconnecting: OptimisticPendingTurn = {
      attempt: retryItem.attempts || 1,
      lastError: decision.failure.message,
      phase: 'reconnecting',
      phaseStartedAt: Date.now(),
      updatedAt: Date.now(),
      userMessageId: retryItem.input.message.id,
    };
    const transition = await localStore.transitionPendingEnqueueRetry(
      cacheOwner,
      retryItem,
      reconnecting,
    );
    if (!transition.updated || !transition.item) return 'terminal';
    const claimKey = hostedTurnDeliveryClaimKey(cacheOwner, source.input.requestId);
    if (cancelledKeysRef.current.has(claimKey)) return 'terminal';
    optimisticPendingByConversationRef.current.set(transition.item.conversationId, reconnecting);
    if (mountedRef.current && activeConversationIdRef.current === transition.item.conversationId) {
      pendingTurnActiveRef.current = true;
      setReconnectAttempt(reconnecting.attempt);
      updatePendingPhase('reconnecting', reconnecting.phaseStartedAt);
      setHostedRunning(false);
      setSending(true);
    }
    return 'retry';
  }, [
    activeConversationIdRef,
    cacheOwner,
    cancelledKeysRef,
    finalizePendingSend,
    isChinese,
    localStore,
    maxReconnectAttempts,
    mountedRef,
    optimisticPendingByConversationRef,
    pendingTurnActiveRef,
    setHostedRunning,
    setReconnectAttempt,
    setSending,
    updatePendingPhase,
  ]);

  const deliverPendingCancellation = useCallback(async (
    item: HostedTurnOutboxItem,
  ): Promise<PendingCancellationDeliveryResult> => {
    if (!localStore || !cacheOwner || !cloudApi || !item.cancelledAt) {
      return {
        error: isChinese ? '取消队列不可用。' : 'Cancellation queue unavailable.',
        outcome: 'failed',
      };
    }
    if (item.deliveryTerminalAt) {
      try {
        cleanupPendingAttachments(item);
        await localStore.removePendingEnqueue(cacheOwner, item.input.requestId);
        return { outcome: 'settled' };
      } catch {
        return { outcome: 'cleanup-pending' };
      }
    }
    let settledItem = item;
    if (!item.deliveryAcceptedAt) {
      try {
        await withAbortableDeadline(
          (signal) => cloudApi.cancelHostedTurn(
            item.conversationId,
            item.input.turnId,
            'Cancelled before hosted-turn delivery completed',
            signal,
          ),
          cancelTimeoutMs,
          'Hermes hosted-turn cancellation timed out',
        );
        settledItem = { ...item, deliveryAcceptedAt: Date.now(), lastError: '', nextAttemptAt: 0 };
      } catch (error) {
        const decision = decideHostedTurnCancellationFailure(error, item.attempts || 0);
        if (decision.outcome === 'retry') {
          try {
            await localStore.upsertPendingEnqueue(cacheOwner, {
              ...item,
              attempts: decision.attempts,
              cancelledAt: item.cancelledAt || Date.now(),
              lastError: serverFailure(error, isChinese),
              nextAttemptAt: decision.nextAttemptAt,
            });
          } catch (persistenceError) {
            return { error: serverFailure(persistenceError, isChinese), outcome: 'failed' };
          }
          return { outcome: 'retry-scheduled' };
        }
        if (decision.outcome === 'failed') {
          const terminalItem = {
            ...item,
            attempts: decision.attempts,
            deliveryTerminalAt: Date.now(),
            lastError: serverFailure(error, isChinese),
            nextAttemptAt: 0,
          };
          try {
            await localStore.upsertPendingEnqueue(cacheOwner, terminalItem);
          } catch (persistenceError) {
            return { error: serverFailure(persistenceError, isChinese), outcome: 'failed' };
          }
          try {
            cleanupPendingAttachments(terminalItem);
            await localStore.removePendingEnqueue(cacheOwner, item.input.requestId);
          } catch {
            // The marker keeps failed cancellation cleanup idempotent.
          }
          return { error: serverFailure(error, isChinese), outcome: 'failed' };
        }
        settledItem = {
          ...item,
          attempts: decision.attempts,
          deliveryAcceptedAt: Date.now(),
          lastError: '',
          nextAttemptAt: 0,
        };
      }
      try {
        await localStore.upsertPendingEnqueue(cacheOwner, settledItem);
      } catch {
        return { outcome: 'cleanup-pending' };
      }
    }
    try {
      cleanupPendingAttachments(settledItem);
      await localStore.removePendingEnqueue(cacheOwner, settledItem.input.requestId);
      return { outcome: 'settled' };
    } catch {
      return { outcome: 'cleanup-pending' };
    }
  }, [cacheOwner, cancelTimeoutMs, cloudApi, isChinese, localStore]);

  const deliverAndReconcilePendingCancellation = useCallback(async (
    item: HostedTurnOutboxItem,
  ): Promise<PendingCancellationDeliveryResult> => {
    const result = await deliverPendingCancellation(item);
    if (result.outcome !== 'failed') return result;
    notify(result.error);
    if (!cloudApi) return result;
    const cancellationStillCurrent = () => {
      const pendingTurn = optimisticPendingByConversationRef.current
        .get(item.conversationId)?.turnId;
      const activeTurn = activeHostedTurnIdRef.current;
      return !(
        (pendingTurn && pendingTurn !== item.input.turnId)
        || (activeTurn && activeTurn !== item.input.turnId)
      );
    };
    if (!cancellationStillCurrent()) return result;
    try {
      const refreshed = await withAbortableDeadline(
        (signal) => cloudApi.getConversation(item.conversationId, signal),
        cancelTimeoutMs,
        'Hermes hosted-turn cancellation reconciliation timed out',
      );
      if (activeConversationIdRef.current === item.conversationId && cancellationStillCurrent()) {
        await replaceOptimisticMessages(item.conversationId, [], null);
        optimisticPendingByConversationRef.current.delete(item.conversationId);
        applyConversation(refreshed.conversation);
      }
    } catch {
      if (activeConversationIdRef.current === item.conversationId && cancellationStillCurrent()) {
        activeHostedTurnIdRef.current = item.input.turnId;
        setActiveHostedTurnId(item.input.turnId);
        setHostedRunning(true);
        setSending(true);
      }
    }
    return result;
  }, [
    activeConversationIdRef,
    activeHostedTurnIdRef,
    applyConversation,
    cancelTimeoutMs,
    cloudApi,
    deliverPendingCancellation,
    notify,
    optimisticPendingByConversationRef,
    replaceOptimisticMessages,
    setActiveHostedTurnId,
    setHostedRunning,
    setSending,
  ]);

  const cancelPendingSend = useCallback(async (): Promise<boolean> => {
    const conversationId = activeConversationIdRef.current;
    const persistedPending = optimisticPendingByConversationRef.current.get(conversationId);
    const userMessageId = pendingChatSendRef.current?.userMessage.id
      || persistedPending?.userMessageId
      || '';
    const userMessage = pendingChatSendRef.current?.userMessage
      || (optimisticMessagesByConversationRef.current.get(conversationId) || [])
        .find(({ id, role }) => id === userMessageId && role === 'user');
    if (!conversationId || !userMessageId || !userMessage) return false;
    const key = pendingChatSendRef.current?.key
      || hostedTurnDeliveryClaimKey(cacheOwner, userMessageId);
    cancelledKeysRef.current.add(key);
    let queuedItem = pendingChatSendRef.current?.queuedItem;
    const pending = { conversationId, key, queuedItem, userMessage };
    const finalized = await finalizePendingSend(
      pending,
      isChinese ? '任务已取消。' : 'Task cancelled.',
      'cancelled',
      'cancelled',
      isChinese ? '已取消' : 'Cancelled',
    );
    if (!finalized) {
      cancelledKeysRef.current.delete(key);
      return false;
    }
    queuedItem = pending.queuedItem;
    sendOperationGenerationRef.current += 1;
    resetPendingStateMachine();
    if (mountedRef.current && activeConversationIdRef.current === conversationId) {
      setSending(false);
      setHostedRunning(false);
    }
    if (queuedItem?.cancelledAt) {
      await deliverAndReconcilePendingCancellation(queuedItem);
    }
    return true;
  }, [
    activeConversationIdRef,
    cacheOwner,
    cancelledKeysRef,
    deliverAndReconcilePendingCancellation,
    finalizePendingSend,
    isChinese,
    mountedRef,
    optimisticMessagesByConversationRef,
    optimisticPendingByConversationRef,
    pendingChatSendRef,
    resetPendingStateMachine,
    sendOperationGenerationRef,
    setHostedRunning,
    setSending,
  ]);

  return {
    cancelPendingSend,
    deliverAndReconcilePendingCancellation,
    finalizePendingSend,
    handleOutboxFailure,
  };
}
