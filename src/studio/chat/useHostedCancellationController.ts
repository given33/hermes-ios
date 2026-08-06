import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import { withAbortableDeadline } from '../../api/async-deadline';
import type { ConversationLocalStore } from '../../api/conversation-local-store';
import type {
  HostedTurnOutboxItem,
  OptimisticPendingTurn,
} from '../../api/conversation-store-types';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';
import type { HermesCloudApi, SingleConversation } from '../../api/HermesCloudApi';
import {
  decideHostedTurnCancellationFailure,
  decideHostedTurnDeliveryFailure,
  hostedTurnDeliveryClaimKey,
  type HostedTurnDeliveryFailure,
} from '../../api/hosted-turn-delivery-state';
import {
  conversationHostedTurnCancellationAuthority,
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
  PendingPhase,
  PendingCancellationDeliveryResult,
  PendingChatSend,
} from './chat-types';

interface HostedCancellationControllerOptions {
  activeConversationIdRef: MutableRefObject<string>;
  activeHostedTurnIdRef: MutableRefObject<string>;
  applyConversation(conversation: SingleConversation, expectedOwnerEpoch?: number): void;
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
    expectedOwnerEpoch?: number,
  ): Promise<void>;
  resetPendingStateMachine(): void;
  sendOperationGenerationRef: MutableRefObject<number>;
  setActiveHostedTurnId: Dispatch<SetStateAction<string>>;
  setHostedRunning: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setReconnectAttempt(attempt: number): void;
  setSending: Dispatch<SetStateAction<boolean>>;
  updatePendingPhase(phase: PendingPhase, startedAt?: number): void;
}

export interface HostedCancellationController {
  cancelPendingSend(): Promise<boolean>;
  deliverAndReconcilePendingCancellation(
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<PendingCancellationDeliveryResult>;
  finalizePendingSend(
    pending: PendingChatSend,
    content: string,
    status: 'cancelled' | 'failed',
    idPrefix: string,
    roleLabel: string,
    terminalOutbox?: HostedTurnOutboxItem,
    expectedOwnerEpoch?: number,
  ): Promise<boolean>;
  handleOutboxFailure(
    source: HostedTurnOutboxItem,
    failure: HostedTurnDeliveryFailure,
    expectedOwnerEpoch: number,
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
  const cancellationWorkerIdRef = useRef(
    `ios-hosted-cancel:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  );
  const finalizePendingSend = useCallback(async (
    pending: PendingChatSend,
    content: string,
    status: 'cancelled' | 'failed',
    idPrefix: string,
    roleLabel: string,
    terminalOutbox?: HostedTurnOutboxItem,
    expectedOwnerEpoch = captureConversationStorageEpoch(cacheOwner),
  ): Promise<boolean> => {
    const lifecycleCurrent = () => isConversationStorageEpochCurrent(
      cacheOwner,
      expectedOwnerEpoch,
    );
    if (!lifecycleCurrent()) return false;
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
          expectedOwnerEpoch,
        );
        if (!lifecycleCurrent()) return false;
        if (!cancelled?.cancelledAt) return false;
        pending.queuedItem = cancelled;
      } else if (terminalOutbox) {
        const transition = terminalOutbox.deliveryTerminalAt
          ? await localStore.transitionPendingEnqueueTerminal(
              cacheOwner,
              terminalOutbox,
              terminalMessages,
              expectedOwnerEpoch,
            )
          : await localStore.transitionPendingEnqueueForegroundFailure(
              cacheOwner,
              terminalOutbox,
              terminalMessages,
              expectedOwnerEpoch,
            );
        if (!lifecycleCurrent()) return false;
        if (!transition.updated) return false;
      } else {
        await localStore.finalizeOptimisticTurn(
          cacheOwner,
          pending.conversationId,
          terminalMessages,
          expectedOwnerEpoch,
        );
        if (!lifecycleCurrent()) return false;
      }
    } else {
      await replaceOptimisticMessages(
        pending.conversationId,
        finalMessages,
        null,
        expectedOwnerEpoch,
      );
      if (!lifecycleCurrent()) return false;
    }
    if (!lifecycleCurrent()) return false;
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
    expectedOwnerEpoch: number,
  ): Promise<'retry' | 'retry-background' | 'terminal'> => {
    const lifecycleCurrent = () => isConversationStorageEpochCurrent(
      cacheOwner,
      expectedOwnerEpoch,
    );
    if (!lifecycleCurrent()) return 'terminal';
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
        expectedOwnerEpoch,
      );
      if (!lifecycleCurrent()) return 'terminal';
      if (!finalized) return 'terminal';
      try {
        cleanupPendingAttachments(terminalItem);
        await localStore.removePendingEnqueueIfActive(
          cacheOwner,
          source.input.requestId,
          expectedOwnerEpoch,
        );
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
        expectedOwnerEpoch,
      );
      if (!lifecycleCurrent()) return 'terminal';
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
      expectedOwnerEpoch,
    );
    if (!lifecycleCurrent()) return 'terminal';
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
    expectedOwnerEpoch: number,
  ): Promise<PendingCancellationDeliveryResult> => {
    const lifecycleCurrent = () => isConversationStorageEpochCurrent(
      cacheOwner,
      expectedOwnerEpoch,
    );
    if (!lifecycleCurrent()) return { outcome: 'cleanup-pending' };
    if (!localStore || !cacheOwner || !cloudApi || !item.cancelledAt) {
      return {
        error: isChinese ? '取消队列不可用。' : 'Cancellation queue unavailable.',
        outcome: 'failed',
      };
    }
    if (item.deliveryTerminalAt) {
      return {
        error: item.lastError || (isChinese ? '取消请求失败。' : 'Cancellation failed.'),
        outcome: 'failed',
      };
    }
    let settledItem = item;
    if (!item.deliveryAcceptedAt) {
      try {
        await withAbortableDeadline(
          (signal) => cloudApi.cancelHostedTurn(
            item.conversationId,
            item.input.turnId,
            isChinese ? '用户取消' : 'Cancelled by user',
            item.input.requestId,
            signal,
          ),
          cancelTimeoutMs,
          'Hermes hosted-turn cancellation timed out',
        );
        if (!lifecycleCurrent()) return { outcome: 'cleanup-pending' };
        settledItem = {
          ...item,
          deliveryAcceptedAt: Date.now(),
          lastError: '',
          nextAttemptAt: 0,
        };
      } catch (error) {
        const decision = decideHostedTurnCancellationFailure(error, item.attempts || 0);
        if (decision.outcome === 'retry') {
          try {
            await localStore.upsertPendingEnqueue(
              cacheOwner,
              {
                ...item,
                attempts: decision.attempts,
                cancelledAt: item.cancelledAt || Date.now(),
                lastError: serverFailure(error, isChinese),
                nextAttemptAt: decision.nextAttemptAt,
              },
              expectedOwnerEpoch,
            );
            if (!lifecycleCurrent()) return { outcome: 'cleanup-pending' };
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
            await localStore.upsertPendingEnqueue(
              cacheOwner,
              terminalItem,
              expectedOwnerEpoch,
            );
            if (!lifecycleCurrent()) return { outcome: 'cleanup-pending' };
          } catch (persistenceError) {
            return { error: serverFailure(persistenceError, isChinese), outcome: 'failed' };
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
        await localStore.upsertPendingEnqueue(
          cacheOwner,
          settledItem,
          expectedOwnerEpoch,
        );
        if (!lifecycleCurrent()) return { outcome: 'cleanup-pending' };
      } catch {
        return { outcome: 'cleanup-pending' };
      }
    }

    try {
      const refreshed = await withAbortableDeadline(
        (signal) => cloudApi.getConversation(settledItem.conversationId, signal),
        cancelTimeoutMs,
        'Hermes hosted-turn cancellation reconciliation timed out',
      );
      if (!lifecycleCurrent()) return { outcome: 'cleanup-pending' };
      const authority = conversationHostedTurnCancellationAuthority(
        refreshed.conversation,
        settledItem.input.turnId,
      );
      applyConversation(refreshed.conversation, expectedOwnerEpoch);
      if (!lifecycleCurrent()) return { outcome: 'cleanup-pending' };
      if (authority === 'cancelled' || authority === 'completed' || authority === 'failed') {
        cleanupPendingAttachments(settledItem);
        const removed = await localStore.removePendingEnqueueIfLeaseOwned(
          cacheOwner,
          settledItem,
          expectedOwnerEpoch,
        );
        if (!lifecycleCurrent()) return { outcome: 'cleanup-pending' };
        if (!removed) return { outcome: 'cleanup-pending' };
        return {
          outcome: authority === 'cancelled'
            ? 'cancel-accepted'
            : 'completed-before-cancel',
        };
      }
      const reconciliationAttempts = authority === 'missing'
        ? Math.max(0, settledItem.reconciliationAttempts || 0) + 1
        : 0;
      if (authority === 'missing' && reconciliationAttempts >= 5) {
        const failed = {
          ...settledItem,
          deliveryTerminalAt: Date.now(),
          lastError: isChinese
            ? '服务器无法确认要取消的任务。'
            : 'The server could not confirm the task to cancel.',
          reconciliationAttempts,
        };
        await localStore.upsertPendingEnqueue(cacheOwner, failed, expectedOwnerEpoch);
        return { error: failed.lastError, outcome: 'failed' };
      }
      const waiting = {
        ...settledItem,
        lastError: '',
        nextAttemptAt: Date.now() + 1_000,
        reconciliationAttempts,
      };
      await localStore.upsertPendingEnqueue(
        cacheOwner,
        waiting,
        expectedOwnerEpoch,
      );
      if (!lifecycleCurrent()) return { outcome: 'cleanup-pending' };
      if (activeConversationIdRef.current === waiting.conversationId) {
        optimisticPendingByConversationRef.current.set(waiting.conversationId, {
          attempt: waiting.attempts || 0,
          phase: 'cancel_requested',
          phaseStartedAt: waiting.cancelledAt || Date.now(),
          turnId: waiting.input.turnId,
          updatedAt: Date.now(),
          userMessageId: waiting.input.message.id,
        });
        updatePendingPhase('cancel_requested', waiting.cancelledAt || Date.now());
        setHostedRunning(true);
        setSending(true);
      }
      return { outcome: 'retry-scheduled' };
    } catch {
      try {
        await localStore.upsertPendingEnqueue(
          cacheOwner,
          {
            ...settledItem,
            nextAttemptAt: Date.now() + 1_000,
          },
          expectedOwnerEpoch,
        );
      } catch {
        return { outcome: 'cleanup-pending' };
      }
      return { outcome: 'retry-scheduled' };
    }
  }, [
    activeConversationIdRef,
    applyConversation,
    cacheOwner,
    cancelTimeoutMs,
    cloudApi,
    isChinese,
    localStore,
    optimisticPendingByConversationRef,
    setHostedRunning,
    setSending,
    updatePendingPhase,
  ]);

  const deliverAndReconcilePendingCancellation = useCallback(async (
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<PendingCancellationDeliveryResult> => {
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) {
      return { outcome: 'cleanup-pending' };
    }
    let deliveryItem = item;
    let leaseAcquiredHere = false;
    if (!deliveryItem.deliveryLeaseToken && localStore) {
      const claimed = await localStore.claimPendingEnqueueByRequest(
        cacheOwner,
        deliveryItem.input.requestId,
        cancellationWorkerIdRef.current,
        Date.now(),
        5 * 60_000,
        expectedOwnerEpoch,
      );
      if (!claimed) return { outcome: 'retry-scheduled' };
      deliveryItem = claimed;
      leaseAcquiredHere = true;
    }
    let result: PendingCancellationDeliveryResult;
    try {
      result = await deliverPendingCancellation(deliveryItem, expectedOwnerEpoch);
      if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return result;
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
        if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return result;
        const authority = conversationHostedTurnCancellationAuthority(
          refreshed.conversation,
          deliveryItem.input.turnId,
        );
        applyConversation(refreshed.conversation, expectedOwnerEpoch);
        if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return result;
        if (authority === 'cancel_requested') {
          const waiting = {
            ...deliveryItem,
            deliveryAcceptedAt: deliveryItem.deliveryAcceptedAt || Date.now(),
            deliveryTerminalAt: 0,
            lastError: '',
            nextAttemptAt: Date.now() + 1_000,
          };
          await localStore?.upsertPendingEnqueue(cacheOwner, waiting, expectedOwnerEpoch);
          if (
            activeConversationIdRef.current === deliveryItem.conversationId
            && cancellationStillCurrent()
          ) {
            updatePendingPhase('cancel_requested', deliveryItem.cancelledAt || Date.now());
            setHostedRunning(true);
            setSending(true);
          }
        } else {
          cleanupPendingAttachments(deliveryItem);
          const removed = await localStore?.removePendingEnqueueIfLeaseOwned(
            cacheOwner,
            deliveryItem,
            expectedOwnerEpoch,
          );
          if (removed === false) return result;
          if (
            (authority === 'running' || authority === 'missing')
            && activeConversationIdRef.current === deliveryItem.conversationId
            && cancellationStillCurrent()
          ) {
            updatePendingPhase('thinking', 0);
            setHostedRunning(true);
            setSending(true);
          }
        }
      } catch {
        if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return result;
        if (
          activeConversationIdRef.current === deliveryItem.conversationId
          && cancellationStillCurrent()
        ) {
          activeHostedTurnIdRef.current = deliveryItem.input.turnId;
          setActiveHostedTurnId(deliveryItem.input.turnId);
          setHostedRunning(true);
          setSending(true);
        }
      }
      return result;
    } finally {
      if (leaseAcquiredHere && localStore) {
        await localStore.releasePendingEnqueueLease(
          cacheOwner,
          deliveryItem,
          expectedOwnerEpoch,
        ).catch(() => false);
      }
    }
  }, [
    activeConversationIdRef,
    activeHostedTurnIdRef,
    applyConversation,
    cacheOwner,
    cancelTimeoutMs,
    cloudApi,
    deliverPendingCancellation,
    localStore,
    notify,
    optimisticPendingByConversationRef,
    replaceOptimisticMessages,
    setActiveHostedTurnId,
    setHostedRunning,
    setSending,
    updatePendingPhase,
  ]);

  const cancelPendingSend = useCallback(async (): Promise<boolean> => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return false;
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
    const queuedItem = pendingChatSendRef.current?.queuedItem;
    if (!localStore || !queuedItem) {
      cancelledKeysRef.current.delete(key);
      return false;
    }
    const cancelled = await localStore.cancelPendingEnqueue(
      cacheOwner,
      queuedItem.input.requestId,
      queuedItem,
      Date.now(),
      ownerEpoch,
    );
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return false;
    if (!cancelled?.cancelledAt) {
      cancelledKeysRef.current.delete(key);
      return false;
    }
    pendingChatSendRef.current = {
      conversationId,
      key,
      queuedItem: cancelled,
      userMessage,
    };
    sendOperationGenerationRef.current += 1;
    const cancelRequested: OptimisticPendingTurn = {
      attempt: cancelled.attempts || 0,
      phase: 'cancel_requested',
      phaseStartedAt: cancelled.cancelledAt,
      turnId: cancelled.input.turnId,
      updatedAt: Date.now(),
      userMessageId,
    };
    optimisticPendingByConversationRef.current.set(conversationId, cancelRequested);
    await replaceOptimisticMessages(
      conversationId,
      optimisticMessagesByConversationRef.current.get(conversationId) || [userMessage],
      cancelRequested,
      ownerEpoch,
    );
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return false;
    if (mountedRef.current && activeConversationIdRef.current === conversationId) {
      updatePendingPhase('cancel_requested', cancelled.cancelledAt);
      setSending(true);
      setHostedRunning(true);
    }
    const result = await deliverAndReconcilePendingCancellation(cancelled, ownerEpoch);
    if (
      (result.outcome === 'cancel-accepted' || result.outcome === 'completed-before-cancel')
      && mountedRef.current
      && activeConversationIdRef.current === conversationId
    ) {
      // The server snapshot has already been applied by reconciliation. Drop
      // the local pending flags immediately so the composer cannot continue to
      // render a stop button while the outbox cleanup finishes.
      pendingTurnActiveRef.current = false;
      activeHostedTurnIdRef.current = '';
      setActiveHostedTurnId('');
      setHostedRunning(false);
      setSending(false);
      resetPendingStateMachine();
      await replaceOptimisticMessages(
        conversationId,
        optimisticMessagesByConversationRef.current.get(conversationId) || [userMessage],
        null,
        ownerEpoch,
      );
      optimisticPendingByConversationRef.current.delete(conversationId);
      pendingChatSendRef.current = null;
    }
    return true;
  }, [
    activeConversationIdRef,
    activeHostedTurnIdRef,
    cacheOwner,
    cancelledKeysRef,
    deliverAndReconcilePendingCancellation,
    localStore,
    mountedRef,
    optimisticMessagesByConversationRef,
    optimisticPendingByConversationRef,
    pendingChatSendRef,
    replaceOptimisticMessages,
    resetPendingStateMachine,
    sendOperationGenerationRef,
    setActiveHostedTurnId,
    setHostedRunning,
    setSending,
    updatePendingPhase,
  ]);

  return {
    cancelPendingSend,
    deliverAndReconcilePendingCancellation,
    finalizePendingSend,
    handleOutboxFailure,
  };
}
