import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { ConversationLocalStore } from '../../api/conversation-local-store';
import type { OptimisticPendingTurn } from '../../api/conversation-local-store';
import {
  conversationMessagesToView,
  hostedTurnVisibilityFailure,
  upsertChatMessage,
  type HermesChatViewMessage as ChatMessage,
  type HostedTurnVisibilityFailure,
} from '../../api/chat-view-model';
import {
  chatMessageToCollaborationMessage,
  optimisticConversationTitle,
} from './chat-domain';

interface OptimisticConversationStateOptions {
  activeConversationIdRef: MutableRefObject<string>;
  activeHostedTurnIdRef: MutableRefObject<string>;
  cacheOwner: string;
  isChinese: boolean;
  localStore: ConversationLocalStore | null;
  profile: string;
  setActiveHostedTurnId: Dispatch<SetStateAction<string>>;
  setHostedRunning: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  visibilityGraceMs: number;
}

/**
 * Own the durable optimistic-message ledger and hosted-turn visibility grace.
 *
 * This state is shared by send, replay, stream and cache hydration paths.  It
 * stays outside the page component so those paths cannot accidentally acquire
 * separate timers or overwrite another mounted facade's newer terminal state.
 */
export function useOptimisticConversationState({
  activeConversationIdRef,
  activeHostedTurnIdRef,
  cacheOwner,
  isChinese,
  localStore,
  profile,
  setActiveHostedTurnId,
  setHostedRunning,
  setMessages,
  setSending,
  visibilityGraceMs,
}: OptimisticConversationStateOptions) {
  const optimisticHostedTurnIdRef = useRef('');
  const optimisticHostedTurnConfirmedRef = useRef(false);
  const optimisticHostedTurnDeadlineRef = useRef(0);
  const optimisticHostedTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostedTurnVisibilityFailuresRef = useRef(
    new Map<string, HostedTurnVisibilityFailure[]>(),
  );
  const optimisticMessagesRef = useRef<ChatMessage[]>([]);
  const optimisticMessagesByConversationRef = useRef(new Map<string, ChatMessage[]>());
  const optimisticPendingByConversationRef = useRef(new Map<string, OptimisticPendingTurn>());

  const replaceOptimisticMessages = useCallback((
    conversationId: string,
    nextMessages: readonly ChatMessage[],
    pendingTurn?: OptimisticPendingTurn | null,
  ): Promise<void> => {
    if (!conversationId) return Promise.resolve();
    const previous = optimisticMessagesByConversationRef.current.get(conversationId) || [];
    const next = nextMessages.map((message) => ({ ...message }));
    if (next.length) {
      optimisticMessagesByConversationRef.current.set(conversationId, next);
    } else {
      optimisticMessagesByConversationRef.current.delete(conversationId);
    }
    if (activeConversationIdRef.current === conversationId) {
      optimisticMessagesRef.current = next;
    }
    if (pendingTurn !== undefined) {
      if (pendingTurn) {
        optimisticPendingByConversationRef.current.set(conversationId, pendingTurn);
      } else {
        optimisticPendingByConversationRef.current.delete(conversationId);
      }
    }
    if (!localStore || !cacheOwner) return Promise.resolve();
    return localStore.replaceOptimisticMessages(
      cacheOwner,
      conversationId,
      next.map(chatMessageToCollaborationMessage),
      pendingTurn,
      previous.map(({ id }) => id),
    ).then(async (committed) => {
      if (committed) return;
      const durableLedgers = await localStore.readOptimisticConversations(cacheOwner);
      const durable = durableLedgers.find(
        ({ conversationId: currentId }) => currentId === conversationId,
      );
      if (!durable) {
        optimisticMessagesByConversationRef.current.delete(conversationId);
        optimisticPendingByConversationRef.current.delete(conversationId);
        if (activeConversationIdRef.current === conversationId) {
          optimisticMessagesRef.current = [];
        }
        return;
      }
      const durableMessages = conversationMessagesToView({
        id: durable.conversationId,
        messages: durable.messages,
        profile,
        title: optimisticConversationTitle(durable.messages, isChinese),
      }, isChinese);
      optimisticMessagesByConversationRef.current.set(conversationId, durableMessages);
      if (durable.pendingTurn) {
        optimisticPendingByConversationRef.current.set(conversationId, durable.pendingTurn);
      } else {
        optimisticPendingByConversationRef.current.delete(conversationId);
      }
      if (activeConversationIdRef.current === conversationId) {
        optimisticMessagesRef.current = durableMessages;
        setMessages((current) => durableMessages.reduce(upsertChatMessage, current));
      }
    });
  }, [activeConversationIdRef, cacheOwner, isChinese, localStore, profile, setMessages]);

  const clearOptimisticPendingTurn = useCallback((conversationId: string): Promise<void> => {
    if (!conversationId) return Promise.resolve();
    optimisticPendingByConversationRef.current.delete(conversationId);
    return replaceOptimisticMessages(
      conversationId,
      optimisticMessagesByConversationRef.current.get(conversationId) || [],
      null,
    );
  }, [replaceOptimisticMessages]);

  const clearOptimisticHostedTurn = useCallback(() => {
    optimisticHostedTurnIdRef.current = '';
    optimisticHostedTurnConfirmedRef.current = false;
    optimisticHostedTurnDeadlineRef.current = 0;
    if (optimisticHostedTurnTimeoutRef.current) {
      clearTimeout(optimisticHostedTurnTimeoutRef.current);
      optimisticHostedTurnTimeoutRef.current = null;
    }
  }, []);

  const beginOptimisticHostedTurn = useCallback((conversationId: string, turnId: string) => {
    clearOptimisticHostedTurn();
    optimisticHostedTurnIdRef.current = turnId;
    optimisticHostedTurnConfirmedRef.current = false;
    optimisticHostedTurnDeadlineRef.current = Date.now() + visibilityGraceMs;
    optimisticHostedTurnTimeoutRef.current = setTimeout(() => {
      optimisticHostedTurnTimeoutRef.current = null;
      if (
        optimisticHostedTurnIdRef.current !== turnId
        || activeConversationIdRef.current !== conversationId
      ) return;
      optimisticHostedTurnIdRef.current = '';
      optimisticHostedTurnDeadlineRef.current = 0;
      const failure = hostedTurnVisibilityFailure(turnId, isChinese);
      hostedTurnVisibilityFailuresRef.current.set(
        conversationId,
        [
          ...(hostedTurnVisibilityFailuresRef.current.get(conversationId) || [])
            .filter((current) => current.turnId !== turnId),
          failure,
        ],
      );
      activeHostedTurnIdRef.current = '';
      setActiveHostedTurnId('');
      const nextMessages = upsertChatMessage(
        optimisticMessagesByConversationRef.current.get(conversationId) || [],
        failure.message,
      );
      void replaceOptimisticMessages(conversationId, nextMessages);
      void clearOptimisticPendingTurn(conversationId);
      setMessages((current) => upsertChatMessage(current, failure.message));
      setHostedRunning(false);
      setSending(false);
    }, visibilityGraceMs);
  }, [
    activeConversationIdRef,
    activeHostedTurnIdRef,
    clearOptimisticHostedTurn,
    clearOptimisticPendingTurn,
    isChinese,
    replaceOptimisticMessages,
    setActiveHostedTurnId,
    setHostedRunning,
    setMessages,
    setSending,
    visibilityGraceMs,
  ]);

  return {
    beginOptimisticHostedTurn,
    clearOptimisticHostedTurn,
    clearOptimisticPendingTurn,
    hostedTurnVisibilityFailuresRef,
    optimisticHostedTurnConfirmedRef,
    optimisticHostedTurnDeadlineRef,
    optimisticHostedTurnIdRef,
    optimisticHostedTurnTimeoutRef,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    replaceOptimisticMessages,
  };
}
