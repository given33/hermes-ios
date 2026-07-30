import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { HermesCloudApi, SingleConversation } from '../../api/HermesCloudApi';
import { AsyncSingleFlight } from '../../api/async-single-flight';
import { withAbortableDeadline } from '../../api/async-deadline';
import {
  isCompleteConversation,
  mergeDownloadedConversations,
  mergeOptimisticConversationLedgers,
  reconcileConversationCache,
  replaceCachedConversationSnapshot,
  type ConversationLocalStore,
  type OptimisticPendingTurn,
} from '../../api/conversation-local-store';
import type { ConversationSyncGeneration } from '../../api/conversation-sync-generation';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';
import { accountGenerationFromOwnerScope } from '../../auth/account-identity';
import {
  conversationMessagesToView,
  type ConversationCollaborationState,
  type HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import { previewConversationHistory } from '../../preview/chat-fixture-simulator';
import {
  chatMessageToCollaborationMessage,
  isConversationNotFoundError,
  mapWithConcurrency,
  mergeOptimisticConversationSummaries,
  optimisticConversationTitle,
  resolveConversationId,
  serverFailure,
} from './chat-domain';

interface ConversationIndexControllerOptions {
  activeConversationIdRef: MutableRefObject<string>;
  activeHostedTurnIdRef: MutableRefObject<string>;
  applyConversation(
    conversation: SingleConversation,
    expectedOwnerEpoch?: number,
    resetCursor?: boolean,
    activateConversation?: boolean,
  ): void;
  cacheOwner: string;
  clearOptimisticHostedTurn(): void;
  cloudApi: HermesCloudApi | null;
  commitConversationIndex(
    conversations: readonly SingleConversation[],
    activeId?: string,
    expectedOwnerEpoch?: number,
  ): void;
  conversationIndexRef: MutableRefObject<SingleConversation[]>;
  conversationSyncGenerationRef: MutableRefObject<ConversationSyncGeneration>;
  fixtureMode: boolean;
  isChinese: boolean;
  loadConversation(
    conversationId: string,
    expectedGeneration?: number,
    signal?: AbortSignal,
    activateConversation?: boolean,
  ): Promise<SingleConversation | null>;
  localStore: ConversationLocalStore | null;
  notify(message: string): void;
  optimisticMessagesByConversationRef: MutableRefObject<Map<string, ChatMessage[]>>;
  optimisticMessagesRef: MutableRefObject<ChatMessage[]>;
  optimisticPendingByConversationRef: MutableRefObject<Map<string, OptimisticPendingTurn>>;
  pendingTurnActiveRef: MutableRefObject<boolean>;
  profile: string;
  requestTimeoutMs: number;
  setActiveConversationId: Dispatch<SetStateAction<string>>;
  setActiveHostedTurnId: Dispatch<SetStateAction<string>>;
  setCollaborationState: Dispatch<SetStateAction<ConversationCollaborationState>>;
  setConversations: Dispatch<SetStateAction<SingleConversation[]>>;
  setHostedRunning: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSending: Dispatch<SetStateAction<boolean>>;
}

/** Own local-first hydration and authoritative conversation-index synchronization. */
export function useConversationIndexController({
  activeConversationIdRef,
  activeHostedTurnIdRef,
  applyConversation,
  cacheOwner,
  clearOptimisticHostedTurn,
  cloudApi,
  commitConversationIndex,
  conversationIndexRef,
  conversationSyncGenerationRef,
  fixtureMode,
  isChinese,
  loadConversation,
  localStore,
  notify,
  optimisticMessagesByConversationRef,
  optimisticMessagesRef,
  optimisticPendingByConversationRef,
  pendingTurnActiveRef,
  profile,
  requestTimeoutMs,
  setActiveConversationId,
  setActiveHostedTurnId,
  setCollaborationState,
  setConversations,
  setHostedRunning,
  setMessages,
  setSending,
}: ConversationIndexControllerOptions) {
  const hydratedCacheOwnerRef = useRef('');
  const refreshGateRef = useRef({
    epoch: -1,
    gate: new AsyncSingleFlight(),
    owner: '',
  });

  const openConversation = useCallback(async (
    conversationId: string,
    expectedGeneration = 0,
  ) => {
    if (!conversationId) return null;
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return null;
    const cached = conversationIndexRef.current.find(({ id }) => id === conversationId);
    if (!cloudApi) {
      if (!cached || !isCompleteConversation(cached)) return null;
      if (
        expectedGeneration
        && !conversationSyncGenerationRef.current.isActiveCurrent(expectedGeneration)
      ) {
        return cached;
      }
      applyConversation(cached, ownerEpoch, false, true);
      return cached;
    }
    if (conversationId.startsWith('official:')) {
      const placeholder = conversationIndexRef.current.find(({ id }) => id === conversationId);
      const result = await cloudApi.adoptOfficialConversation(
        conversationId,
        placeholder?.profile || profile,
        placeholder?.title || '',
      );
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) {
        return result.conversation;
      }
      if (
        expectedGeneration
        && !conversationSyncGenerationRef.current.isActiveCurrent(expectedGeneration)
      ) {
        return result.conversation;
      }
      conversationIndexRef.current = replaceCachedConversationSnapshot(
        conversationIndexRef.current,
        result.conversation,
        conversationId,
      );
      applyConversation(result.conversation, ownerEpoch, false, true);
      return result.conversation;
    }
    if (cached && isCompleteConversation(cached)) {
      if (
        expectedGeneration
        && !conversationSyncGenerationRef.current.isActiveCurrent(expectedGeneration)
      ) {
        return cached;
      }
      applyConversation(cached, ownerEpoch, false, true);
      return cached;
    }
    return loadConversation(conversationId, expectedGeneration, undefined, true);
  }, [
    applyConversation,
    cacheOwner,
    cloudApi,
    conversationIndexRef,
    conversationSyncGenerationRef,
    loadConversation,
    profile,
  ]);

  const loadConversationIndex = useCallback(async (
    preferredId = '',
    signal?: AbortSignal,
  ) => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    const indexGeneration = conversationSyncGenerationRef.current.advanceIndex();
    const syncGeneration = conversationSyncGenerationRef.current.active();
    let localConversations = conversationIndexRef.current;
    let rememberedId = activeConversationIdRef.current;
    const shouldHydrateCache = Boolean(
      localStore && cacheOwner && hydratedCacheOwnerRef.current !== cacheOwner,
    );
    if (localStore && cacheOwner) {
      const [cached, optimisticLedgers, pendingInterventions] = await Promise.all([
        shouldHydrateCache ? localStore.read(cacheOwner) : Promise.resolve(null),
        localStore.readOptimisticConversations(cacheOwner),
        localStore.readPendingInterventions(cacheOwner),
      ]);
      if (
        !conversationSyncGenerationRef.current.isIndexCurrent(indexGeneration)
        || !isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)
      ) return;
      if (shouldHydrateCache) hydratedCacheOwnerRef.current = cacheOwner;
      const liveOptimisticLedgers = [
        ...optimisticMessagesByConversationRef.current.entries(),
      ].map(([conversationId, liveMessages]) => {
        const pendingTurn = optimisticPendingByConversationRef.current.get(conversationId);
        return {
          conversationId,
          messages: liveMessages.map(chatMessageToCollaborationMessage),
          ...(pendingTurn ? { pendingTurn } : {}),
          updatedAt: Math.max(
            pendingTurn?.updatedAt || 0,
            ...liveMessages.map((message) => message.updatedAt || message.createdAt || 0),
          ),
        };
      });
      const interventionLedgers = pendingInterventions.map((item) => ({
        conversationId: item.conversationId,
        messages: [item.message],
        updatedAt: item.queuedAt,
      }));
      const persistedOptimisticLedgers = mergeOptimisticConversationLedgers(
        optimisticLedgers,
        interventionLedgers,
      );
      const mergedOptimisticLedgers = mergeOptimisticConversationLedgers(
        persistedOptimisticLedgers,
        liveOptimisticLedgers,
      );
      optimisticMessagesByConversationRef.current = new Map(
        mergedOptimisticLedgers.map((entry) => [
          entry.conversationId,
          conversationMessagesToView({
            id: entry.conversationId,
            messages: entry.messages,
            profile,
            title: optimisticConversationTitle(entry.messages, isChinese),
          }, isChinese),
        ]),
      );
      optimisticPendingByConversationRef.current = new Map(
        mergedOptimisticLedgers.flatMap((entry) => (
          entry.pendingTurn ? [[entry.conversationId, entry.pendingTurn] as const] : []
        )),
      );
      if (cached) {
        localConversations = mergeOptimisticConversationSummaries(
          cached.conversations,
          mergedOptimisticLedgers,
          profile,
          isChinese,
        );
        rememberedId = cached.activeConversationId;
        conversationIndexRef.current = localConversations;
        setConversations(localConversations);
        const immediateId = resolveConversationId(
          preferredId || rememberedId || localConversations[0]?.id || '',
          localConversations,
        );
        const immediate = localConversations.find(({ id }) => id === immediateId);
        if (immediate && isCompleteConversation(immediate)) {
          applyConversation(immediate, ownerEpoch, false, true);
        }
      } else if (shouldHydrateCache && mergedOptimisticLedgers.length) {
        localConversations = mergeOptimisticConversationSummaries(
          [],
          mergedOptimisticLedgers,
          profile,
          isChinese,
        );
        rememberedId = localConversations[0]?.id || '';
        conversationIndexRef.current = localConversations;
        setConversations(localConversations);
        const immediate = localConversations[0];
        if (immediate) applyConversation(immediate, ownerEpoch, false, true);
      }
    }
    if (!cloudApi) {
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
      if (fixtureMode) {
        const fixtureHistory = previewConversationHistory(
          isChinese,
          accountGenerationFromOwnerScope(cacheOwner),
        );
        const merged = new Map(
          fixtureHistory.map((conversation) => [conversation.id, conversation]),
        );
        for (const conversation of localConversations) merged.set(conversation.id, conversation);
        localConversations = [...merged.values()].sort(
          (left, right) => (right.updated_at || 0) - (left.updated_at || 0),
        );
        conversationIndexRef.current = localConversations;
        setConversations(localConversations);
      }
      const activeId = resolveConversationId(
        preferredId || rememberedId || localConversations[0]?.id || '',
        localConversations,
      );
      const active = localConversations.find(({ id }) => id === activeId);
      if (active) {
        applyConversation(active, ownerEpoch, false, true);
      } else {
        activeConversationIdRef.current = '';
        activeHostedTurnIdRef.current = '';
        setActiveConversationId('');
        setActiveHostedTurnId('');
        setMessages([]);
        setCollaborationState('single');
        setHostedRunning(false);
        setSending(false);
      }
      return;
    }
    const result = await cloudApi.getUnifiedConversations(profile, signal);
    if (
      !conversationSyncGenerationRef.current.isIndexCurrent(indexGeneration)
      || !isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)
    ) return;
    const reconciliation = reconcileConversationCache(localConversations, result.conversations);
    const optimisticSummaries = [...optimisticMessagesByConversationRef.current.entries()].map(
      ([conversationId, optimisticMessages]) => ({
        conversationId,
        messages: optimisticMessages.map(chatMessageToCollaborationMessage),
        updatedAt: Math.max(
          0,
          ...optimisticMessages.map((message) => message.updatedAt || message.createdAt || 0),
        ),
      }),
    );
    const selectableConversations = mergeOptimisticConversationSummaries(
      reconciliation.conversations,
      optimisticSummaries,
      profile,
      isChinese,
    );
    const requestedActiveId = resolveConversationId(
      preferredId
        || activeConversationIdRef.current
        || rememberedId
        || reconciliation.conversations[0]?.id
        || '',
      selectableConversations,
    );
    const missingIds = new Set<string>();
    const downloaded = await mapWithConcurrency(
      reconciliation.downloadIds.filter((id) => id === requestedActiveId),
      1,
      async (id) => {
        try {
          return (await cloudApi.getConversation(id, signal)).conversation;
        } catch (error) {
          if (isConversationNotFoundError(error)) {
            missingIds.add(id);
            return null;
          }
          throw error;
        }
      },
    );
    if (
      !conversationSyncGenerationRef.current.isIndexCurrent(indexGeneration)
      || !isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)
    ) return;
    const synchronized = mergeOptimisticConversationSummaries(
      mergeDownloadedConversations(
        reconciliation.conversations.filter(({ id }) => !missingIds.has(id)),
        downloaded.filter((conversation): conversation is SingleConversation => conversation !== null),
      ),
      optimisticSummaries,
      profile,
      isChinese,
    );
    const activeId = resolveConversationId(
      requestedActiveId || synchronized[0]?.id || '',
      synchronized,
    );
    commitConversationIndex(synchronized, activeId, ownerEpoch);
    if (!activeId) {
      activeConversationIdRef.current = '';
      activeHostedTurnIdRef.current = '';
      clearOptimisticHostedTurn();
      setActiveConversationId('');
      setActiveHostedTurnId('');
      setMessages([...optimisticMessagesRef.current]);
      setCollaborationState('single');
      setHostedRunning(false);
      if (!pendingTurnActiveRef.current) setSending(false);
      return;
    }
    await openConversation(activeId, syncGeneration);
  }, [
    activeConversationIdRef,
    activeHostedTurnIdRef,
    applyConversation,
    cacheOwner,
    clearOptimisticHostedTurn,
    cloudApi,
    commitConversationIndex,
    conversationIndexRef,
    conversationSyncGenerationRef,
    fixtureMode,
    isChinese,
    localStore,
    openConversation,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    pendingTurnActiveRef,
    profile,
    setActiveConversationId,
    setActiveHostedTurnId,
    setCollaborationState,
    setConversations,
    setHostedRunning,
    setMessages,
    setSending,
  ]);

  const refreshConversationIndex = useCallback((preferredId = '') => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return Promise.resolve();
    if (
      refreshGateRef.current.owner !== cacheOwner
      || refreshGateRef.current.epoch !== ownerEpoch
    ) {
      refreshGateRef.current = {
        epoch: ownerEpoch,
        gate: new AsyncSingleFlight(),
        owner: cacheOwner,
      };
    }
    const gate = refreshGateRef.current.gate;
    return gate.run(() => withAbortableDeadline(
      (signal) => loadConversationIndex(preferredId, signal),
      requestTimeoutMs,
      'Hermes conversation index refresh timed out',
    )).catch((error) => {
      // An index request from a deleted account lifecycle is no longer user-visible.
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return undefined;
      throw error;
    });
  }, [cacheOwner, loadConversationIndex, requestTimeoutMs]);

  const refreshConversationHistory = useCallback(() => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    void refreshConversationIndex(activeConversationIdRef.current)
      .then(() => {
        if (isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) {
          notify(isChinese ? '会话历史已刷新' : 'Conversation history refreshed');
        }
      })
      .catch((error) => {
        if (isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) {
          notify(serverFailure(error, isChinese));
        }
      });
  }, [activeConversationIdRef, cacheOwner, isChinese, notify, refreshConversationIndex]);

  const resetHydration = useCallback(() => {
    hydratedCacheOwnerRef.current = '';
    refreshGateRef.current = {
      epoch: -1,
      gate: new AsyncSingleFlight(),
      owner: '',
    };
  }, []);

  return {
    openConversation,
    refreshConversationHistory,
    refreshConversationIndex,
    resetHydration,
  };
}
