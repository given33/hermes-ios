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
import { replaceCachedConversationSnapshot } from '../../api/conversation-local-store';
import { fetchSessionEntriesToLeaf } from './fetchSessionEntriesToLeaf';
import { reconcileConversationSessionEntries } from '../../api/conversation-session-entries';
import {
  captureConversationDeletionRevision,
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
import {
  isChatRuntimeStatusActivity,
  latestChatRuntimeWaitingState,
} from '../../api/chat-runtime-state';
import type { PendingPhase } from './chat-types';
import {
  mergeLiveMessagesIntoSnapshot,
  sameChatMessages,
  sameOptimisticMessages,
} from './chat-domain';

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
  const reconnectAttemptRef = useRef(reconnectAttempt);
  reconnectAttemptRef.current = reconnectAttempt;

  const persistConversationCache = useCallback((
    conversations: readonly SingleConversation[],
    activeId: string,
    expectedEpoch = captureConversationStorageEpoch(cacheOwner),
    expectedDeletionRevision = captureConversationDeletionRevision(cacheOwner),
  ): Promise<void> => {
    if (
      !localStore
      || !cacheOwner
      || !isConversationStorageEpochCurrent(cacheOwner, expectedEpoch)
      || captureConversationDeletionRevision(cacheOwner) !== expectedDeletionRevision
    ) return Promise.resolve();
    cacheWriteRef.current = cacheWriteRef.current
      .catch(() => undefined)
      .then(() => {
        if (
          !isConversationStorageEpochCurrent(cacheOwner, expectedEpoch)
          || captureConversationDeletionRevision(cacheOwner) !== expectedDeletionRevision
        ) return;
        return localStore.write(cacheOwner, conversations, activeId, expectedEpoch);
      });
    return cacheWriteRef.current;
  }, [cacheOwner, localStore]);

  const commitConversationIndex = useCallback(async (
    conversations: readonly SingleConversation[],
    activeId = activeConversationIdRef.current,
    expectedEpoch = captureConversationStorageEpoch(cacheOwner),
    deferCacheWrite = false,
  ) => {
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedEpoch)) return;
    const deletionRevision = captureConversationDeletionRevision(cacheOwner);
    const next = [...conversations];
    conversationIndexRef.current = next;
    setConversations(next);
    if (deferCacheWrite) {
      // The first SSE snapshot must return to the stream reader immediately.
      // Serializing a long conversation into device storage on this call
      // blocks native fetch callbacks and makes the first token look slow.
      setTimeout(() => {
        void persistConversationCache(next, activeId, expectedEpoch, deletionRevision);
      }, 0);
      return;
    }
    await persistConversationCache(next, activeId, expectedEpoch, deletionRevision);
  }, [activeConversationIdRef, cacheOwner, conversationIndexRef, persistConversationCache, setConversations]);

  const applyConversation = useCallback(async (
    incomingConversation: SingleConversation,
    expectedEpoch = captureConversationStorageEpoch(cacheOwner),
    resetCursor = false,
    activateConversation = false,
    deferCacheWrite = false,
  ) => {
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedEpoch)) return;
    if (
      String(incomingConversation.account_generation || '').trim()
      !== accountGenerationFromOwnerScope(cacheOwner)
    ) return;
    if (
      !activateConversation
      && activeConversationIdRef.current !== incomingConversation.id
    ) return;
    const incomingCursor = Math.max(
      0,
      Number(incomingConversation.hosted_event_cursor)
        || Number(incomingConversation.event_cursor)
        || 0,
    );
    const currentCursor = hostedEventCursorRef.current.get(incomingConversation.id) || 0;
    if (!resetCursor && incomingCursor < currentCursor) return;
    const conversation = replaceCachedConversationSnapshot(
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
      } else if (
        pendingPhaseRef.current !== 'executing'
        && pendingPhaseRef.current !== 'cancel_requested'
      ) {
        const runtimeState = latestChatRuntimeWaitingState(
          trackedMessages.flatMap((message) => message.activities || []),
        );
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
          const executing = trackedMessages.some((message) => (
            (message.activities || []).some((activity) => (
              activity.category !== 'reasoning'
              && !isChatRuntimeStatusActivity(activity)
              && (activity.status === 'queued' || activity.status === 'running')
            ))
          ));
          setReconnectAttempt(0);
          const reasoning = trackedMessages.some((message) => (
            !message.content
            && (message.activities || []).some((activity) => (
              activity.category === 'reasoning'
              && Boolean(activity.output?.trim() || activity.preview?.trim())
            ))
          ));
          const nextPhase = executing ? 'executing' : reasoning ? 'thinking' : 'responding';
          updatePendingPhase(nextPhase, firstTokenAt);
        } else {
          if (runtimeState?.phase === 'reconnecting') {
            const attempt = runtimeState.attempt;
            if (pendingPhaseRef.current !== 'reconnecting' || reconnectAttemptRef.current !== attempt) {
              setReconnectAttempt(attempt);
              updatePendingPhase('reconnecting', runtimeState.startedAt || Date.now());
            }
          }
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
    setMessages((current) => {
      // Fold live messages into the snapshot before replacing: live-only
      // interactive cards (awaiting choice / supervisor verdict / rework)
      // survive the swap, and persisted ids are adopted so React keys stay
      // stable and messages do not remount mid-turn.
      const merged = mergeLiveMessagesIntoSnapshot(nextMessages, current);
      return sameChatMessages(current, merged) ? current : merged;
    });
    activeHostedTurnIdRef.current = runningHostedTurnId;
    setActiveHostedTurnId(runningHostedTurnId);
    // Keep the stream alive while a durable enqueue is still awaiting server
    // acknowledgement.  The local pending-turn state is authoritative for
    // this short hand-off window; dropping hostedRunning here closes the SSE
    // connection just before the gateway emits its first live event.
    setHostedRunning(running || pendingTurnActiveRef.current);
    setSending(running || pendingTurnActiveRef.current);
    await commitConversationIndex(
      replaceCachedConversationSnapshot(conversationIndexRef.current, conversation),
      conversation.id,
      expectedEpoch,
      deferCacheWrite,
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
    activateConversation = false,
  ) => {
    if (!cloudApi || !conversationId) return null;
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    const deletionRevision = captureConversationDeletionRevision(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return null;
    const previousEntryState = sessionEntryStateRef.current.get(conversationId) || {
      cursor: 0,
      generation: '',
    };
    const [result, initialEntries] = await Promise.all([
      cloudApi.getConversation(conversationId, signal),
      // Loop full pages to the leaf so a first open of a >2000-entry
      // conversation renders its complete history/Todos immediately.
      fetchSessionEntriesToLeaf(
        cloudApi,
        conversationId,
        previousEntryState.cursor,
        signal,
      ),
    ]);
    if (
      captureConversationDeletionRevision(cacheOwner) !== deletionRevision
      || !isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)
    ) {
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
      entries = await fetchSessionEntriesToLeaf(cloudApi, conversationId, 0, signal);
      if (
        captureConversationDeletionRevision(cacheOwner) !== deletionRevision
        || !isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)
      ) return conversation;
    }
    if (entries) {
      conversation = reconcileConversationSessionEntries(conversation, entries);
      sessionEntryStateRef.current.set(conversationId, {
        cursor: Math.max(0, entries.cursor || 0),
        generation: entries.account_generation || previousEntryState.generation,
      });
    }
    if (
      captureConversationDeletionRevision(cacheOwner) !== deletionRevision
      || (
        expectedGeneration
        && !conversationSyncGenerationRef.current.isActiveCurrent(expectedGeneration)
      )
    ) {
      return conversation;
    }
    if (
      !activateConversation
      && activeConversationIdRef.current !== conversationId
    ) {
      return conversation;
    }
    await applyConversation(conversation, ownerEpoch, false, activateConversation);
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
