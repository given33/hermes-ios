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
import { accountGenerationFromOwnerScope } from '../../auth/account-identity';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';
import {
  parseOfficialConversationPlaceholderId,
  type HermesCloudApi,
  type SingleConversation,
} from '../../api/HermesCloudApi';
import {
  conversationRunningHostedTurnId,
  type ConversationCollaborationState,
  type HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import {
  isConversationNotFoundError,
  serverFailure,
} from './chat-domain';
import type { PendingChatSend } from './chat-types';
import type { PendingPhase } from './chat-types';
import type { HostedCancellationController } from './useHostedCancellationController';

interface ConversationActionsControllerOptions {
  activeConversationIdRef: MutableRefObject<string>;
  activeHostedTurnIdRef: MutableRefObject<string>;
  applyConversation(
    conversation: SingleConversation,
    expectedOwnerEpoch?: number,
    resetCursor?: boolean,
    activateConversation?: boolean,
  ): void | Promise<void>;
  autoFollowStreamRef: MutableRefObject<boolean>;
  cacheOwner: string;
  cancelHostedTurnInFlightRef: MutableRefObject<boolean>;
  cancelTimeoutMs: number;
  cancellation: Pick<
    HostedCancellationController,
    'cancelPendingSend' | 'deliverAndReconcilePendingCancellation'
  >;
  clearOptimisticHostedTurn(): void;
  clearOptimisticPendingTurn(conversationId: string): Promise<void>;
  cloudApi: HermesCloudApi | null;
  collaborationStateByConversationRef: MutableRefObject<
    Map<string, ConversationCollaborationState>
  >;
  commitConversationIndex(
    conversations: readonly SingleConversation[],
    activeId?: string,
    expectedOwnerEpoch?: number,
  ): void | Promise<void>;
  conversationIndexRef: MutableRefObject<SingleConversation[]>;
  conversationSyncGenerationRef: MutableRefObject<ConversationSyncGeneration>;
  hostedRunning: boolean;
  isChinese: boolean;
  localStore: ConversationLocalStore | null;
  notify(message: string): void;
  openConversation(conversationId: string, generation: number): Promise<unknown>;
  replayDurableOutboxes?(): Promise<unknown>;
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
  setHostedRunning: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setSlashMenuOpen: Dispatch<SetStateAction<boolean>>;
  updatePendingPhase(phase: PendingPhase, startedAt?: number): void;
}

export interface ConversationActionsController {
  branchFromMessage(message: ChatMessage): Promise<void>;
  cancelActiveHostedTurn(): Promise<void>;
  createConversation(): Promise<void>;
  deleteConversations(conversationIds: readonly string[]): Promise<void>;
  selectConversation(conversationId: string): Promise<void>;
}

/** Owns conversation-level transitions that must reset the same state graph. */
export function useConversationActionsController({
  activeConversationIdRef,
  activeHostedTurnIdRef,
  applyConversation,
  autoFollowStreamRef,
  cacheOwner,
  cancelHostedTurnInFlightRef,
  cancelTimeoutMs,
  cancellation,
  clearOptimisticHostedTurn,
  clearOptimisticPendingTurn,
  cloudApi,
  collaborationStateByConversationRef,
  commitConversationIndex,
  conversationIndexRef,
  conversationSyncGenerationRef,
  hostedRunning,
  isChinese,
  localStore,
  notify,
  openConversation,
  replayDurableOutboxes,
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
  setHostedRunning,
  setMessages,
  setSending,
  setSlashMenuOpen,
  updatePendingPhase,
}: ConversationActionsControllerOptions): ConversationActionsController {
  const prepareComposerNavigation = () => {
    setSlashMenuOpen(false);
  };

  const settleCancelledHostedTurn = async (conversationId: string) => {
    if (activeConversationIdRef.current !== conversationId) return;
    // The cancellation endpoint is authoritative, but the stop control must
    // not remain armed while the durable reconciliation row is being cleaned
    // up. Clear only the local activity flags; the refreshed conversation has
    // already been applied by the cancellation controller and remains visible.
    pendingTurnActiveRef.current = false;
    activeHostedTurnIdRef.current = '';
    clearOptimisticHostedTurn();
    setActiveHostedTurnId('');
    setHostedRunning(false);
    setSending(false);
    resetPendingStateMachine();
    await clearOptimisticPendingTurn(conversationId);
  };

  const createConversation = async () => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    prepareComposerNavigation();
    if (cloudApi) {
      try {
        const result = await cloudApi.createConversation(
          profile,
          isChinese ? '新对话' : 'New conversation',
        );
        if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
        if (
          String(result.conversation.account_generation || '').trim()
          !== accountGenerationFromOwnerScope(cacheOwner)
        ) {
          throw new Error('New conversation crossed its account generation');
        }
        await commitConversationIndex(
          [
            result.conversation,
            ...conversationIndexRef.current.filter(
              ({ id }) => id !== result.conversation.id,
            ),
          ],
          result.conversation.id,
          ownerEpoch,
        );
        if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
        autoFollowStreamRef.current = true;
        clearOptimisticHostedTurn();
        optimisticMessagesRef.current = [];
        setCollaborationState('single');
        resetPendingStateMachine();
        await applyConversation(result.conversation, ownerEpoch, false, true);
        prepareComposerNavigation();
      } catch (error) {
        if (isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) {
          notify(serverFailure(error, isChinese));
        }
      }
      return;
    }
    autoFollowStreamRef.current = true;
    clearOptimisticHostedTurn();
    optimisticMessagesRef.current = [];
    setCollaborationState('single');
    resetPendingStateMachine();
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
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    if (cancelHostedTurnInFlightRef.current) return;
    if (
      pendingTurnActiveRef.current
      && !hostedRunning
      && !activeHostedTurnIdRef.current
    ) {
      cancelHostedTurnInFlightRef.current = true;
      setCancellingHostedTurn(true);
      try {
      await cancellation.cancelPendingSend();
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
      notify(isChinese ? '正在取消任务' : 'Cancelling task');
      } finally {
        cancelHostedTurnInFlightRef.current = false;
        if (isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) {
          setCancellingHostedTurn(false);
        }
      }
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
        if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
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
        await localStore.upsertPendingEnqueue(cacheOwner, cancellationItem, ownerEpoch);
        if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
      }
      if (activeConversationIdRef.current === conversationId) {
        const currentPending = optimisticPendingByConversationRef.current.get(conversationId);
        optimisticPendingByConversationRef.current.set(conversationId, {
          attempt: cancellationItem.attempts || 0,
          phase: 'cancel_requested',
          phaseStartedAt: cancelledAt,
          turnId,
          updatedAt: cancelledAt,
          userMessageId: currentPending?.userMessageId || cancellationItem.input.message.id,
        });
        updatePendingPhase('cancel_requested', cancelledAt);
        // Optimistic cancellation: stop the local streaming UI immediately so
        // the stop feels instant. The server reconciliation below continues in
        // the background and converges the durable state.
        pendingTurnActiveRef.current = false;
        activeHostedTurnIdRef.current = '';
        clearOptimisticHostedTurn();
        setActiveHostedTurnId('');
        setHostedRunning(false);
        setSending(false);
      }
      notify(isChinese ? '正在取消任务' : 'Cancelling task');
      const result = await cancellation.deliverAndReconcilePendingCancellation(
        cancellationItem,
        ownerEpoch,
      );
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
      if (result.outcome === 'cancel-accepted') {
        await settleCancelledHostedTurn(conversationId);
        notify(isChinese ? '任务已取消' : 'Task cancelled');
      } else if (result.outcome === 'completed-before-cancel') {
        await settleCancelledHostedTurn(conversationId);
        notify(isChinese ? '任务已在取消前结束' : 'Task finished before cancellation');
      }
    } catch (error) {
      try {
        const refreshed = await withAbortableDeadline(
          (signal) => cloudApi.getConversation(conversationId, signal),
          cancelTimeoutMs,
          'Hermes hosted-turn reconciliation timed out',
        );
        if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
        if (activeConversationIdRef.current === conversationId) {
          applyConversation(refreshed.conversation, ownerEpoch);
        }
        if (!conversationRunningHostedTurnId(refreshed.conversation)) {
          notify(isChinese ? '任务已结束' : 'Task already finished');
          return;
        }
      } catch {
        // Keep the original cancellation error when reconciliation also fails.
      }
      if (isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) {
        notify(serverFailure(error, isChinese));
      }
    } finally {
      cancelHostedTurnInFlightRef.current = false;
      if (isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) {
        setCancellingHostedTurn(false);
      }
    }
  };

  const selectConversation = async (conversationId: string) => {
    // Re-selecting the current id is meaningful when the user is switching
    // back from Studio/Coding mode: those surfaces keep their own view state,
    // while the single-chat transcript must be re-applied to the main shell.
    if (!conversationId) return;
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    if (
      pendingTurnActiveRef.current
      && !hostedRunning
      && !activeHostedTurnIdRef.current
    ) {
      // Detach the in-flight enqueue instead of cancelling it: the user's
      // message stays in the durable outbox and the background replay
      // delivers it (the server dedupes by request id). Cancelling here
      // silently dropped messages whenever the user switched conversations
      // right after sending on a slow network.
      pendingTurnActiveRef.current = false;
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
    prepareComposerNavigation();
    const generation = conversationSyncGenerationRef.current.advanceActive();
    try {
      await openConversation(conversationId, generation);
    } catch (error) {
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
      if (isConversationNotFoundError(error)) {
        const remaining = conversationIndexRef.current.filter(
          ({ id }) => id !== conversationId,
        );
        const fallbackId = remaining[0]?.id || '';
        commitConversationIndex(remaining, fallbackId, ownerEpoch);
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

  const deleteConversations = async (conversationIds: readonly string[]) => {
    const requestedIds = [...new Set(
      conversationIds.map((id) => String(id || '').trim()).filter(Boolean),
    )];
    if (!requestedIds.length) return;
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;

    // A conversation with an active turn must be cancelled before its server
    // record is removed. This keeps remote connector runs from being orphaned
    // and makes the delete action deterministic even while the stop control
    // is still reconciling.
    if (requestedIds.includes(activeConversationIdRef.current)
      && (sending || hostedRunning || pendingTurnActiveRef.current)) {
      await cancelActiveHostedTurn();
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    }
    conversationSyncGenerationRef.current.advanceIndex();
    if (requestedIds.includes(activeConversationIdRef.current)) {
      conversationSyncGenerationRef.current.advanceActive();
    }

    const stagedIds: string[] = [];
    const failedIds: string[] = [];
    if (localStore && cacheOwner) {
      for (const id of requestedIds) {
        try {
          const conversation = conversationIndexRef.current.find((item) => item.id === id);
          const staged = await localStore.stageConversationDeletion(
            cacheOwner,
            {
              conversationId: id,
              kind: id.startsWith('official:') ? 'session' : 'conversation',
              profile: conversation?.profile || profile,
              queuedAt: Date.now(),
            },
            activeConversationIdRef.current,
            ownerEpoch,
          );
          if (staged) stagedIds.push(id);
          else failedIds.push(id);
        } catch {
          // Storage can fail for one record (quota, a stale owner epoch, or a
          // native bridge interruption). Continue staging the rest so a
          // single bad row cannot leave the user's delete action half-applied.
          failedIds.push(id);
        }
      }
    } else if (cloudApi) {
      // A cloud client without a local store is only possible in a degraded
      // fixture/legacy shell. Preserve the old best-effort behavior there.
      for (const id of requestedIds) {
        try {
          const conversation = conversationIndexRef.current.find((item) => item.id === id);
          if (id.startsWith('official:')) {
            const placeholder = parseOfficialConversationPlaceholderId(id);
            const result = await cloudApi.deleteSession(
              placeholder?.sessionId || conversation?.official_session_id || id,
              conversation?.profile || profile,
            );
            if (result?.ok === false) throw new Error('Remote session deletion was not accepted');
          } else {
            const result = await cloudApi.deleteConversation(id);
            if (result?.ok === false) throw new Error('Remote conversation deletion was not accepted');
          }
          stagedIds.push(id);
        } catch {
          failedIds.push(id);
        }
      }
    }
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    if (!stagedIds.length) {
      notify(isChinese ? '本地删除失败，未修改云端数据' : 'Local delete failed; cloud data was not changed');
      return;
    }

    const deleted = new Set(stagedIds);
    const remaining = conversationIndexRef.current.filter(({ id }) => !deleted.has(id));
    const activeDeleted = deleted.has(activeConversationIdRef.current);
    const fallbackId = activeDeleted ? (remaining[0]?.id || '') : activeConversationIdRef.current;
    for (const id of stagedIds) {
      optimisticMessagesByConversationRef.current.delete(id);
      optimisticPendingByConversationRef.current.delete(id);
      collaborationStateByConversationRef.current.delete(id);
      await clearOptimisticPendingTurn(id);
    }
    await commitConversationIndex(remaining, fallbackId, ownerEpoch);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    if (activeDeleted) {
      sendOperationGenerationRef.current += 1;
      pendingChatSendRef.current = null;
      pendingTurnActiveRef.current = false;
      activeConversationIdRef.current = '';
      activeHostedTurnIdRef.current = '';
      clearOptimisticHostedTurn();
      resetPendingStateMachine();
      setActiveConversationId('');
      setActiveHostedTurnId('');
      setHostedRunning(false);
      setSending(false);
      setCollaborationState('single');
      if (fallbackId) {
        const generation = conversationSyncGenerationRef.current.advanceActive();
        await openConversation(fallbackId, generation);
      } else {
        setMessages([]);
      }
    }
    if (cloudApi && localStore && replayDurableOutboxes) {
      await replayDurableOutboxes().catch(() => undefined);
    }
    if (failedIds.length) {
      notify(isChinese
        ? `已在本地删除 ${stagedIds.length} 个会话，${failedIds.length} 个未进入云端队列`
        : `Deleted ${stagedIds.length} locally; ${failedIds.length} were not queued`);
    } else {
      notify(isChinese
        ? `已在本地删除 ${stagedIds.length} 个会话，云端删除已提交`
        : `Deleted ${stagedIds.length} locally; cloud deletion queued`);
    }
  };

  const branchFromMessage = async (message: ChatMessage) => {
    const conversationId = activeConversationIdRef.current;
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (
      !cloudApi
      || !conversationId
      || !message.runtimeMessageId
      || !message.runtimeSessionId
      || !isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)
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
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
      applyConversation(response.conversation, ownerEpoch, false, true);
      notify(isChinese ? '已从所选消息创建分支。' : 'Created a branch from this message.');
    } catch (error) {
      if (isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) {
        notify(serverFailure(error, isChinese));
      }
    }
  };

  return {
    branchFromMessage,
    cancelActiveHostedTurn,
    createConversation,
    deleteConversations,
    selectConversation,
  };
}
