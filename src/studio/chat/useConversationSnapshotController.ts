import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type {
  HermesCloudApi,
  SingleConversation,
} from '../../api/HermesCloudApi';
import { accountGenerationFromOwnerScope } from '../../auth/account-identity';
import type {
  ConversationLocalStore,
  OptimisticPendingTurn,
} from '../../api/conversation-local-store';
import { upsertCachedConversation } from '../../api/conversation-local-store';
import { reconcileConversationSessionEntries } from '../../api/conversation-session-entries';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';
import type { ConversationSyncGeneration } from '../../api/conversation-sync-generation';
import {
  conversationCollaborationState,
  conversationHasRunningWork,
  conversationHostedTurnState,
  conversationMessagesToView,
  conversationRunningHostedTurnId,
  hostedTurnVisibilityFailure,
  reconcileHostedTurnVisibilityFailures,
  reconcileOptimisticMessages,
  type ConversationCollaborationState,
  type HermesChatViewMessage as ChatMessage,
  type HostedTurnVisibilityFailure,
} from '../../api/chat-view-model';
import type { PendingPhase } from './chat-types';
import { sameOptimisticMessages } from './chat-domain';

interface ConversationSnapshotControllerOptions {
  activeConversationIdRef: MutableRefObject<string>;
  activeHostedTurnIdRef: MutableRefObject<string>;
  cacheOwner: string;
  clearOptimisticHostedTurn(): void;
  clearOptimisticPendingTurn(conversationId: string): Promise<void>;
  cloudApi: HermesCloudApi | null;
  conversationIndexRef: MutableRefObject<SingleConversation[]>;
  conversationSyncGenerationRef: MutableRefObject<ConversationSyncGeneration>;
  firstTokenAtRef: MutableRefObject<number>;
  hostedEventCursorRef: MutableRefObject<Map<string, number>>;
  hostedTurnVisibilityFailuresRef: MutableRefObject<Map<string, HostedTurnVisibilityFailure[]>>;
  isChinese: boolean;
  localStore: ConversationLocalStore | null;
  optimisticHostedTurnConfirmedRef: MutableRefObject<boolean>;
  optimisticHostedTurnDeadlineRef: MutableRefObject<number>;
  optimisticHostedTurnIdRef: MutableRefObject<string>;
  optimisticHostedTurnTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  optimisticMessagesByConversationRef: MutableRefObject<Map<string, ChatMessage[]>>;
  optimisticMessagesRef: MutableRefObject<ChatMessage[]>;
  optimisticPendingByConversationRef: MutableRefObject<Map<string, OptimisticPendingTurn>>;
  pendingPhaseRef: MutableRefObject<PendingPhase>;
  pendingTurnActiveRef: MutableRefObject<boolean>;
  reconnectAttempt: number;
  replaceOptimisticMessages(
    conversationId: string,
    messages: readonly ChatMessage[],
    pendingTurn?: OptimisticPendingTurn | null,
  ): Promise<void>;
  setActiveConversationId: Dispatch<SetStateAction<string>>;
  setActiveHostedTurnId: Dispatch<SetStateAction<string>>;
  setConversations: Dispatch<SetStateAction<SingleConversation[]>>;
  setHostedRunning: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setReconnectAttempt(attempt: number): void;
  setSending: Dispatch<SetStateAction<boolean>>;
  updateConversationCollaborationState(
    conversationId: string,
    nextState: ConversationCollaborationState,
  ): void;
  updatePendingPhase(phase: PendingPhase, startedAt?: number): void;
}

/** Apply authoritative server snapshots without letting stale replicas erase UI state. */
export function useConversationSnapshotController({
  activeConversationIdRef,
  activeHostedTurnIdRef,
  cacheOwner,
  clearOptimisticHostedTurn,
  clearOptimisticPendingTurn,
  cloudApi,
  conversationIndexRef,
  conversationSyncGenerationRef,
  firstTokenAtRef,
  hostedEventCursorRef,
  hostedTurnVisibilityFailuresRef,
  isChinese,
  localStore,
  optimisticHostedTurnConfirmedRef,
  optimisticHostedTurnDeadlineRef,
  optimisticHostedTurnIdRef,
  optimisticHostedTurnTimeoutRef,
  optimisticMessagesByConversationRef,
  optimisticMessagesRef,
  optimisticPendingByConversationRef,
  pendingPhaseRef,
  pendingTurnActiveRef,
  reconnectAttempt,
  replaceOptimisticMessages,
  setActiveConversationId,
  setActiveHostedTurnId,
  setConversations,
  setHostedRunning,
  setMessages,
  setReconnectAttempt,
  setSending,
  updateConversationCollaborationState,
  updatePendingPhase,
}: ConversationSnapshotControllerOptions) {
  const cacheWriteRef = useRef<Promise<void>>(Promise.resolve());
  const sessionEntryStateRef = useRef(new Map<string, { cursor: number; generation: string }>());

  const persistConversationCache = useCallback((
    conversations: readonly SingleConversation[],
    activeId: string,
    expectedEpoch = captureConversationStorageEpoch(cacheOwner),
  ): Promise<void> => {
    if (
      !localStore
      || !cacheOwner
      || !isConversationStorageEpochCurrent(cacheOwner, expectedEpoch)
    ) return Promise.resolve();
    cacheWriteRef.current = cacheWriteRef.current
      .catch(() => undefined)
      .then(() => {
        if (!isConversationStorageEpochCurrent(cacheOwner, expectedEpoch)) return;
        return localStore.write(cacheOwner, conversations, activeId, expectedEpoch);
      });
    return cacheWriteRef.current;
  }, [cacheOwner, localStore]);

  const commitConversationIndex = useCallback(async (
    conversations: readonly SingleConversation[],
    activeId = activeConversationIdRef.current,
    expectedEpoch = captureConversationStorageEpoch(cacheOwner),
  ) => {
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedEpoch)) return;
    const next = [...conversations];
    conversationIndexRef.current = next;
    setConversations(next);
    await persistConversationCache(next, activeId, expectedEpoch);
  }, [activeConversationIdRef, cacheOwner, conversationIndexRef, persistConversationCache, setConversations]);

  const applyConversation = useCallback(async (
    incomingConversation: SingleConversation,
    expectedEpoch = captureConversationStorageEpoch(cacheOwner),
    resetCursor = false,
  ) => {
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedEpoch)) return;
    if (
      String(incomingConversation.account_generation || '').trim()
      !== accountGenerationFromOwnerScope(cacheOwner)
    ) return;
    const incomingCursor = Math.max(
      0,
      Number(incomingConversation.hosted_event_cursor)
        || Number(incomingConversation.event_cursor)
        || 0,
    );
    const currentCursor = hostedEventCursorRef.current.get(incomingConversation.id) || 0;
    if (!resetCursor && incomingCursor < currentCursor) return;
    const conversation = upsertCachedConversation(
      conversationIndexRef.current,
      incomingConversation,
    ).find(({ id }) => id === incomingConversation.id) || incomingConversation;
    activeConversationIdRef.current = conversation.id;
    setActiveConversationId(conversation.id);
    updateConversationCollaborationState(
      conversation.id,
      conversationCollaborationState(conversation),
    );
    const persistedPendingTurn = optimisticPendingByConversationRef.current.get(conversation.id);
    const persistedTurnState = persistedPendingTurn?.turnId
      ? conversationHostedTurnState(conversation, persistedPendingTurn.turnId)
      : 'missing';
    const activePersistedPendingTurn = persistedTurnState === 'terminal'
      ? undefined
      : persistedPendingTurn;
    if (persistedTurnState === 'terminal') {
      optimisticPendingByConversationRef.current.delete(conversation.id);
      void clearOptimisticPendingTurn(conversation.id);
    }
    if (activePersistedPendingTurn) {
      pendingTurnActiveRef.current = true;
      setReconnectAttempt(activePersistedPendingTurn.attempt);
      updatePendingPhase(
        activePersistedPendingTurn.phase,
        activePersistedPendingTurn.phaseStartedAt,
      );
    } else {
      pendingTurnActiveRef.current = false;
    }
    let nextMessages = conversationMessagesToView(conversation, isChinese);
    let running = conversationHasRunningWork(conversation);
    let runningHostedTurnId = conversationRunningHostedTurnId(conversation);
    const optimisticTurnId = optimisticHostedTurnIdRef.current;
    if (optimisticTurnId) {
      const optimisticState = conversationHostedTurnState(conversation, optimisticTurnId);
      if (optimisticState === 'terminal') {
        clearOptimisticHostedTurn();
      } else if (optimisticState === 'running') {
        optimisticHostedTurnConfirmedRef.current = true;
        optimisticHostedTurnDeadlineRef.current = 0;
        if (optimisticHostedTurnTimeoutRef.current) {
          clearTimeout(optimisticHostedTurnTimeoutRef.current);
          optimisticHostedTurnTimeoutRef.current = null;
        }
        running = true;
        runningHostedTurnId ||= optimisticTurnId;
      } else if (optimisticHostedTurnConfirmedRef.current) {
        running = true;
        runningHostedTurnId ||= optimisticTurnId;
      } else if (Date.now() <= optimisticHostedTurnDeadlineRef.current) {
        running = true;
        runningHostedTurnId ||= optimisticTurnId;
      } else {
        clearOptimisticHostedTurn();
        const failure = hostedTurnVisibilityFailure(optimisticTurnId, isChinese);
        hostedTurnVisibilityFailuresRef.current.set(
          conversation.id,
          [
            ...(hostedTurnVisibilityFailuresRef.current.get(conversation.id) || [])
              .filter(({ turnId }) => turnId !== optimisticTurnId),
            failure,
          ],
        );
      }
    }
    const visibilityFailures = reconcileHostedTurnVisibilityFailures(
      conversation,
      nextMessages,
      hostedTurnVisibilityFailuresRef.current.get(conversation.id) || [],
    );
    nextMessages = visibilityFailures.messages;
    if (visibilityFailures.failures.length) {
      hostedTurnVisibilityFailuresRef.current.set(
        conversation.id,
        visibilityFailures.failures,
      );
    } else {
      hostedTurnVisibilityFailuresRef.current.delete(conversation.id);
    }
    const trackedTurnId = activeHostedTurnIdRef.current
      || activePersistedPendingTurn?.turnId
      || runningHostedTurnId;
    if (trackedTurnId && pendingTurnActiveRef.current) {
      const trackedTurnState = conversationHostedTurnState(conversation, trackedTurnId);
      const trackedMessages = nextMessages.filter(
        (message) => message.runtimeTurnId === trackedTurnId,
      );
      if (trackedTurnState === 'terminal') {
        pendingTurnActiveRef.current = false;
        void clearOptimisticPendingTurn(conversation.id);
        const tokenStartedAt = firstTokenAtRef.current;
        if (tokenStartedAt > 0) {
          nextMessages = nextMessages.map((message) => {
            if (
              message.runtimeTurnId !== trackedTurnId
              || message.role !== 'assistant'
              || !['completed', 'failed'].includes(message.status || '')
            ) return message;
            const completedAt = message.completedAt || message.updatedAt || Date.now();
            return {
              ...message,
              durationMs: Math.max(0, completedAt - tokenStartedAt),
              startedAt: tokenStartedAt,
            };
          });
        }
      } else if (
        pendingPhaseRef.current !== 'executing'
        && pendingPhaseRef.current !== 'cancel_requested'
      ) {
        const latestRuntimeStatus = trackedMessages
          .flatMap((message) => message.activities || [])
          .filter((activity) => {
            const text = `${activity.output || ''} ${activity.preview || ''}`;
            return activity.name === '运行状态'
              || activity.name === 'Runtime status'
              || /(?:正在重连|reconnecting)\s*[（(]\d+\s*\/\s*5[）)]/i.test(text);
          })
          .sort((left, right) => (right.startedAt || 0) - (left.startedAt || 0))[0];
        const runtimeStatus = latestRuntimeStatus?.output || latestRuntimeStatus?.preview || '';
        const reconnectMatch = runtimeStatus.match(/(?:正在重连|reconnecting)\s*[（(](\d+)\s*\/\s*5[）)]/i);
        if (reconnectMatch) {
          const attempt = Number(reconnectMatch[1]);
          if (pendingPhaseRef.current !== 'reconnecting' || reconnectAttempt !== attempt) {
            setReconnectAttempt(attempt);
            updatePendingPhase('reconnecting', latestRuntimeStatus?.startedAt || Date.now());
          }
        } else if (/正在思考|thinking/i.test(runtimeStatus) && pendingPhaseRef.current !== 'thinking') {
          updatePendingPhase('thinking', latestRuntimeStatus?.startedAt || Date.now());
        }
        const hasAssistantContent = trackedMessages.some(
          (message) => message.role === 'assistant'
            && Boolean(message.content)
            && message.status !== 'failed',
        );
        const persistedFirstTokenAt = trackedMessages.reduce((earliest, message) => {
          const candidate = message.firstTokenAt || 0;
          if (candidate <= 0) return earliest;
          return earliest <= 0 ? candidate : Math.min(earliest, candidate);
        }, 0);
        if (persistedFirstTokenAt > 0 || hasAssistantContent) {
          const firstTokenAt = firstTokenAtRef.current || persistedFirstTokenAt || Date.now();
          firstTokenAtRef.current = firstTokenAt;
          updatePendingPhase('executing', firstTokenAt);
        }
      }
    }
    const currentOptimistic = optimisticMessagesByConversationRef.current.get(
      conversation.id,
    ) || [];
    const reconciledOptimistic = reconcileOptimisticMessages(
      nextMessages,
      currentOptimistic,
      Date.now(),
      activePersistedPendingTurn
        ? new Set([activePersistedPendingTurn.userMessageId])
        : new Set(),
    );
    if (!sameOptimisticMessages(currentOptimistic, reconciledOptimistic.pending)) {
      void replaceOptimisticMessages(conversation.id, reconciledOptimistic.pending);
    } else {
      optimisticMessagesRef.current = reconciledOptimistic.pending;
    }
    nextMessages = reconciledOptimistic.messages;
    setMessages(nextMessages);
    activeHostedTurnIdRef.current = runningHostedTurnId;
    setActiveHostedTurnId(runningHostedTurnId);
    setHostedRunning(running);
    setSending(running || pendingTurnActiveRef.current);
    await commitConversationIndex(
      upsertCachedConversation(conversationIndexRef.current, conversation),
      conversation.id,
      expectedEpoch,
    );
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedEpoch)) return;
    hostedEventCursorRef.current.set(
      incomingConversation.id,
      resetCursor ? incomingCursor : Math.max(currentCursor, incomingCursor),
    );
  }, [
    activeConversationIdRef,
    activeHostedTurnIdRef,
    cacheOwner,
    clearOptimisticHostedTurn,
    clearOptimisticPendingTurn,
    commitConversationIndex,
    conversationIndexRef,
    firstTokenAtRef,
    hostedEventCursorRef,
    hostedTurnVisibilityFailuresRef,
    isChinese,
    optimisticHostedTurnConfirmedRef,
    optimisticHostedTurnDeadlineRef,
    optimisticHostedTurnIdRef,
    optimisticHostedTurnTimeoutRef,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    pendingPhaseRef,
    pendingTurnActiveRef,
    reconnectAttempt,
    replaceOptimisticMessages,
    setActiveConversationId,
    setActiveHostedTurnId,
    setHostedRunning,
    setMessages,
    setReconnectAttempt,
    setSending,
    updateConversationCollaborationState,
    updatePendingPhase,
  ]);

  const loadConversation = useCallback(async (
    conversationId: string,
    expectedGeneration = 0,
    signal?: AbortSignal,
  ) => {
    if (!cloudApi || !conversationId) return null;
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return null;
    const previousEntryState = sessionEntryStateRef.current.get(conversationId) || {
      cursor: 0,
      generation: '',
    };
    const [result, initialEntries] = await Promise.all([
      cloudApi.getConversation(conversationId, signal),
      cloudApi.getConversationSessionEntries(
        conversationId,
        previousEntryState.cursor,
        2_000,
        signal,
      ).catch(() => null),
    ]);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) {
      return result.conversation;
    }
    let conversation = result.conversation;
    if (
      String(conversation.account_generation || '').trim()
      !== accountGenerationFromOwnerScope(cacheOwner)
    ) {
      throw new Error('Hermes conversation account generation changed');
    }
    let entries = initialEntries;
    if (
      entries
      && previousEntryState.cursor > 0
      && (
        entries.reset_cursor === true
        || (
          previousEntryState.generation
          && entries.account_generation
          && entries.account_generation !== previousEntryState.generation
        )
      )
    ) {
      entries = await cloudApi.getConversationSessionEntries(
        conversationId,
        0,
        2_000,
        signal,
      );
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return conversation;
    }
    if (entries) {
      conversation = reconcileConversationSessionEntries(conversation, entries);
      sessionEntryStateRef.current.set(conversationId, {
        cursor: Math.max(0, entries.cursor || 0),
        generation: entries.account_generation || previousEntryState.generation,
      });
    }
    if (
      expectedGeneration
      && !conversationSyncGenerationRef.current.isActiveCurrent(expectedGeneration)
    ) {
      return conversation;
    }
    if (activeConversationIdRef.current && activeConversationIdRef.current !== conversationId) {
      return conversation;
    }
    await applyConversation(conversation, ownerEpoch);
    return conversation;
  }, [
    activeConversationIdRef,
    applyConversation,
    cacheOwner,
    cloudApi,
    conversationSyncGenerationRef,
  ]);

  return { applyConversation, commitConversationIndex, loadConversation };
}
