import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from 'react';

import { withAbortableDeadline } from '../../api/async-deadline';
import type { ConversationLocalStore } from '../../api/conversation-local-store';
import type {
  HostedTurnOutboxItem,
  OptimisticPendingTurn,
} from '../../api/conversation-store-types';
import { ConversationSyncGeneration } from '../../api/conversation-sync-generation';
import type { HermesCloudApi, SingleConversation } from '../../api/HermesCloudApi';
import {
  conversationRunningHostedTurnId,
  type ConversationCollaborationState,
  type HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import {
  isConversationNotFoundError,
  serverFailure,
} from './chat-domain';
import type { ChatAttachment, PendingChatSend } from './chat-types';
import type { HostedCancellationController } from './useHostedCancellationController';

interface ConversationActionsControllerOptions {
  activeConversationIdRef: MutableRefObject<string>;
  activeHostedTurnIdRef: MutableRefObject<string>;
  applyConversation(conversation: SingleConversation): void;
  attachmentsRef: MutableRefObject<ChatAttachment[]>;
  autoFollowStreamRef: MutableRefObject<boolean>;
  cacheOwner: string;
  cancelHostedTurnInFlightRef: MutableRefObject<boolean>;
  cancelTimeoutMs: number;
  cancellation: Pick<
    HostedCancellationController,
    'cancelPendingSend' | 'deliverAndReconcilePendingCancellation'
  >;
  cleanupAttachmentSources(items: readonly ChatAttachment[]): void;
  clearOptimisticHostedTurn(): void;
  clearOptimisticPendingTurn(conversationId: string): Promise<void>;
  cloudApi: HermesCloudApi | null;
  collaborationStateByConversationRef: MutableRefObject<
    Map<string, ConversationCollaborationState>
  >;
  commitConversationIndex(
    conversations: readonly SingleConversation[],
    activeId?: string,
  ): void;
  contentRef: MutableRefObject<string>;
  conversationIndexRef: MutableRefObject<SingleConversation[]>;
  conversationSyncGenerationRef: MutableRefObject<ConversationSyncGeneration>;
  hostedRunning: boolean;
  isChinese: boolean;
  localStore: ConversationLocalStore | null;
  notify(message: string): void;
  openConversation(conversationId: string, generation: number): Promise<unknown>;
  optimisticMessagesByConversationRef: MutableRefObject<Map<string, ChatMessage[]>>;
  optimisticMessagesRef: MutableRefObject<ChatMessage[]>;
  optimisticPendingByConversationRef: MutableRefObject<Map<string, OptimisticPendingTurn>>;
  pendingChatSendRef: MutableRefObject<PendingChatSend | null>;
  pendingTurnActiveRef: MutableRefObject<boolean>;
  profile: string;
  resetPendingStateMachine(): void;
  sendOperationGenerationRef: MutableRefObject<number>;
  sending: boolean;
  setActiveConversationId: Dispatch<SetStateAction<string>>;
  setActiveHostedTurnId: Dispatch<SetStateAction<string>>;
  setCancellingHostedTurn: Dispatch<SetStateAction<boolean>>;
  setCollaborationState: Dispatch<SetStateAction<ConversationCollaborationState>>;
  setContent: Dispatch<SetStateAction<string>>;
  setHostedRunning: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setSlashMenuOpen: Dispatch<SetStateAction<boolean>>;
  updateAttachments(update: ChatAttachment[]): void;
}

export interface ConversationActionsController {
  branchFromMessage(message: ChatMessage): Promise<void>;
  cancelActiveHostedTurn(): Promise<void>;
  createConversation(): Promise<void>;
  selectConversation(conversationId: string): Promise<void>;
}

/** Owns conversation-level transitions that must reset the same state graph. */
export function useConversationActionsController({
  activeConversationIdRef,
  activeHostedTurnIdRef,
  applyConversation,
  attachmentsRef,
  autoFollowStreamRef,
  cacheOwner,
  cancelHostedTurnInFlightRef,
  cancelTimeoutMs,
  cancellation,
  cleanupAttachmentSources,
  clearOptimisticHostedTurn,
  clearOptimisticPendingTurn,
  cloudApi,
  collaborationStateByConversationRef,
  commitConversationIndex,
  contentRef,
  conversationIndexRef,
  conversationSyncGenerationRef,
  hostedRunning,
  isChinese,
  localStore,
  notify,
  openConversation,
  optimisticMessagesByConversationRef,
  optimisticMessagesRef,
  optimisticPendingByConversationRef,
  pendingChatSendRef,
  pendingTurnActiveRef,
  profile,
  resetPendingStateMachine,
  sendOperationGenerationRef,
  sending,
  setActiveConversationId,
  setActiveHostedTurnId,
  setCancellingHostedTurn,
  setCollaborationState,
  setContent,
  setHostedRunning,
  setMessages,
  setSending,
  setSlashMenuOpen,
  updateAttachments,
}: ConversationActionsControllerOptions): ConversationActionsController {
  const resetComposer = () => {
    contentRef.current = '';
    setContent('');
    setSlashMenuOpen(false);
    cleanupAttachmentSources(attachmentsRef.current);
    updateAttachments([]);
  };

  const createConversation = async () => {
    autoFollowStreamRef.current = true;
    clearOptimisticHostedTurn();
    optimisticMessagesRef.current = [];
    setCollaborationState('single');
    resetPendingStateMachine();
    resetComposer();
    if (cloudApi) {
      try {
        const result = await cloudApi.createConversation(
          profile,
          isChinese ? '新对话' : 'New conversation',
        );
        applyConversation(result.conversation);
        resetComposer();
      } catch (error) {
        notify(serverFailure(error, isChinese));
      }
      return;
    }
    sendOperationGenerationRef.current += 1;
    pendingChatSendRef.current = null;
    pendingTurnActiveRef.current = false;
    activeConversationIdRef.current = '';
    setActiveConversationId('');
    setActiveHostedTurnId('');
    setHostedRunning(false);
    setSending(false);
    setMessages([]);
    notify(isChinese ? '已新建会话' : 'New conversation created');
  };

  const cancelActiveHostedTurn = async () => {
    const conversationId = activeConversationIdRef.current;
    if (cancelHostedTurnInFlightRef.current) return;
    if (
      pendingTurnActiveRef.current
      && !hostedRunning
      && !activeHostedTurnIdRef.current
    ) {
      await cancellation.cancelPendingSend();
      notify(isChinese ? '已取消任务' : 'Task cancelled');
      return;
    }
    if (!cloudApi || !conversationId) return;
    cancelHostedTurnInFlightRef.current = true;
    setCancellingHostedTurn(true);
    try {
      let turnId = activeHostedTurnIdRef.current
        || optimisticPendingByConversationRef.current.get(conversationId)?.turnId
        || '';
      if (!turnId) {
        const refreshed = await withAbortableDeadline(
          (signal) => cloudApi.getConversation(conversationId, signal),
          cancelTimeoutMs,
          'Hermes hosted-turn lookup timed out',
        );
        turnId = conversationRunningHostedTurnId(refreshed.conversation);
      }
      if (!turnId) {
        notify(isChinese ? '当前任务已经结束。' : 'The current task has already ended.');
        if (activeConversationIdRef.current === conversationId) {
          activeHostedTurnIdRef.current = '';
          clearOptimisticHostedTurn();
          setActiveHostedTurnId('');
          setHostedRunning(false);
          setSending(false);
          resetPendingStateMachine();
          await clearOptimisticPendingTurn(conversationId);
        }
        return;
      }
      const cancelledAt = Date.now();
      const cancellationItem: HostedTurnOutboxItem = {
        attempts: 0,
        cancelledAt,
        conversationId,
        conversationPending: false,
        conversationProfile: profile,
        input: {
          message: {
            content: isChinese ? '取消任务' : 'Cancel task',
            created_at: cancelledAt,
            id: `cancel-${turnId}`,
            name: isChinese ? '你' : 'You',
            role: 'user',
            status: 'completed',
          },
          recentMessages: [],
          requestId: `cancel-${turnId}`,
          turnId,
        },
        purpose: 'hosted-turn-cancel',
        queuedAt: cancelledAt,
      };
      if (localStore && cacheOwner) {
        await localStore.upsertPendingEnqueue(cacheOwner, cancellationItem);
      }
      if (activeConversationIdRef.current === conversationId) {
        activeHostedTurnIdRef.current = '';
        clearOptimisticHostedTurn();
        setActiveHostedTurnId('');
        setHostedRunning(false);
        setSending(false);
        resetPendingStateMachine();
        await clearOptimisticPendingTurn(conversationId);
      }
      notify(isChinese ? '已取消任务' : 'Task cancelled');
      await cancellation.deliverAndReconcilePendingCancellation(cancellationItem);
    } catch (error) {
      try {
        const refreshed = await withAbortableDeadline(
          (signal) => cloudApi.getConversation(conversationId, signal),
          cancelTimeoutMs,
          'Hermes hosted-turn reconciliation timed out',
        );
        if (activeConversationIdRef.current === conversationId) {
          applyConversation(refreshed.conversation);
        }
        if (!conversationRunningHostedTurnId(refreshed.conversation)) {
          notify(isChinese ? '任务已结束' : 'Task already finished');
          return;
        }
      } catch {
        // Keep the original cancellation error when reconciliation also fails.
      }
      notify(serverFailure(error, isChinese));
    } finally {
      cancelHostedTurnInFlightRef.current = false;
      setCancellingHostedTurn(false);
    }
  };

  const selectConversation = async (conversationId: string) => {
    if (!conversationId || conversationId === activeConversationIdRef.current) return;
    if (
      pendingTurnActiveRef.current
      && !hostedRunning
      && !activeHostedTurnIdRef.current
    ) {
      await cancellation.cancelPendingSend();
    }
    autoFollowStreamRef.current = true;
    activeHostedTurnIdRef.current = '';
    clearOptimisticHostedTurn();
    setActiveHostedTurnId('');
    setCancellingHostedTurn(false);
    setSending(false);
    setHostedRunning(false);
    setCollaborationState(
      collaborationStateByConversationRef.current.get(conversationId) || 'single',
    );
    resetPendingStateMachine();
    optimisticMessagesRef.current = [
      ...(optimisticMessagesByConversationRef.current.get(conversationId) || []),
    ];
    resetComposer();
    const generation = conversationSyncGenerationRef.current.advanceActive();
    try {
      await openConversation(conversationId, generation);
    } catch (error) {
      if (isConversationNotFoundError(error)) {
        const remaining = conversationIndexRef.current.filter(
          ({ id }) => id !== conversationId,
        );
        const fallbackId = remaining[0]?.id || '';
        commitConversationIndex(remaining, fallbackId);
        if (fallbackId) {
          await openConversation(fallbackId, generation);
        } else {
          activeConversationIdRef.current = '';
          setActiveConversationId('');
          setMessages([]);
          setCollaborationState('single');
        }
        return;
      }
      notify(serverFailure(error, isChinese));
    }
  };

  const branchFromMessage = async (message: ChatMessage) => {
    const conversationId = activeConversationIdRef.current;
    if (
      !cloudApi
      || !conversationId
      || !message.runtimeMessageId
      || !message.runtimeSessionId
    ) return;
    if (sending || hostedRunning) {
      notify(isChinese
        ? '当前任务结束后再创建分支。'
        : 'Wait for the current run before branching.');
      return;
    }
    try {
      const response = await cloudApi.forkConversationFromMessage(
        conversationId,
        message.id,
        {
          idempotencyKey: `ios-branch-${Date.now().toString(36)}-${message.id}`,
          profile: message.profile || profile,
        },
      );
      applyConversation(response.conversation);
      notify(isChinese ? '已从所选消息创建分支。' : 'Created a branch from this message.');
    } catch (error) {
      notify(serverFailure(error, isChinese));
    }
  };

  return {
    branchFromMessage,
    cancelActiveHostedTurn,
    createConversation,
    selectConversation,
  };
}
