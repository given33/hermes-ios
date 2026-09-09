import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import type { HostedLifecycleEvent } from '../../api/hosted-conversation-events';
import { applyHostedLifecycleEvents } from '../../api/hosted-lifecycle-view-model';
import { observeChatDelivery } from '../../api/chat-delivery-timing';
import type { HostedRuntimeProjection } from '../../api/hosted-runtime-reducer';
import type { HermesChatViewMessage as ChatMessage } from '../../api/chat-view-model';
import type { PendingChatSend, PendingPhase } from './chat-types';

interface QueuedHostedLifecycleEvent {
  conversationId: string;
  event: HostedLifecycleEvent;
}

interface HostedLifecycleEventApplicationOptions {
  activeConversationId: string;
  activeConversationIdRef: MutableRefObject<string>;
  activeHostedTurnIdRef: MutableRefObject<string>;
  pendingChatSendRef: MutableRefObject<PendingChatSend | null>;
  cacheOwner: string;
  clearOptimisticHostedTurn(): void;
  clearOptimisticPendingTurn(conversationId: string): Promise<void>;
  resetPendingStateMachine(): void;
  firstTokenAtRef: MutableRefObject<number>;
  isChinese: boolean;
  messagesRef: MutableRefObject<ChatMessage[]>;
  notify(message: string): void;
  pendingTurnActiveRef: MutableRefObject<boolean>;
  setHostedRunning(value: boolean): void;
  setMessages(messages: ChatMessage[]): void;
  setReconnectAttempt(value: number): void;
  setSending(value: boolean): void;
  updatePendingPhase(phase: PendingPhase, startedAt?: number): void;
}

/**
 * Applies live hosted events at a bounded UI cadence. The transport remains
 * event-by-event and cursor-ordered; only React/Markdown work is coalesced.
 * Terminal events flush synchronously so completion never waits for the batch
 * timer.
 */
export function useHostedLifecycleEventApplication({
  activeConversationId,
  activeConversationIdRef,
  activeHostedTurnIdRef,
  pendingChatSendRef,
  cacheOwner,
  clearOptimisticHostedTurn,
  clearOptimisticPendingTurn,
  resetPendingStateMachine,
  firstTokenAtRef,
  isChinese,
  messagesRef,
  notify,
  pendingTurnActiveRef,
  setHostedRunning,
  setMessages,
  setReconnectAttempt,
  setSending,
  updatePendingPhase,
}: HostedLifecycleEventApplicationOptions) {
  const eventQueueRef = useRef<QueuedHostedLifecycleEvent[]>([]);
  const runtimeRef = useRef<HostedRuntimeProjection | undefined>(undefined);
  const [runtime, setRuntime] = useState<HostedRuntimeProjection | undefined>(undefined);
  const flushTimerRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const lastFlushAtRef = useRef(0);

  const reset = useCallback(() => {
    if (flushTimerRef.current !== null) cancelAnimationFrame(flushTimerRef.current);
    flushTimerRef.current = null;
    eventQueueRef.current = [];
    lastFlushAtRef.current = 0;
    runtimeRef.current = undefined;
    setRuntime(undefined);
  }, []);

  // A queued batch belongs to the conversation that was active when its
  // stream delivered it.  Clear both the queue and the runtime projection as
  // soon as the chat selection changes; filtering at flush time alone cannot
  // remove events that were queued before the switch.
  useEffect(() => {
    reset();
  }, [activeConversationId, reset]);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const activeConversationId = activeConversationIdRef.current;
    const events = eventQueueRef.current
      .filter((queued) => queued.conversationId === activeConversationId)
      .map((queued) => queued.event);
    eventQueueRef.current = [];
    if (!events.length) return;
    lastFlushAtRef.current = performance.now();

    const result = applyHostedLifecycleEvents(
      messagesRef.current,
      events,
      isChinese,
      runtimeRef.current,
      pendingChatSendRef.current?.userMessage.runtimeTurnId || activeHostedTurnIdRef.current,
    );
    runtimeRef.current = result.runtime;
    setRuntime(result.runtime);
    const nextMessages = observeChatDelivery(result.messages, messagesRef.current);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    for (const notice of result.notices) notify(notice);
    if (result.firstTokenAt && !firstTokenAtRef.current) {
      firstTokenAtRef.current = result.firstTokenAt;
    }
    if (result.reconnectAttempt !== undefined) {
      setReconnectAttempt(result.reconnectAttempt);
    } else if (result.phase && result.phase !== 'reconnecting') {
      setReconnectAttempt(0);
    }
    if (result.phase && (result.phase === 'reconnecting' || result.phaseStartedAt !== undefined)) {
      updatePendingPhase(result.phase, result.phaseStartedAt || Date.now());
    }
    if (result.completed || result.failed || result.cancelled) {
      pendingTurnActiveRef.current = false;
      clearOptimisticHostedTurn();
      resetPendingStateMachine();
      setHostedRunning(false);
      setSending(false);
      void clearOptimisticPendingTurn(activeConversationId);
    } else if (result.turnActive) {
      pendingTurnActiveRef.current = true;
      setHostedRunning(true);
    }
  }, [
    activeConversationIdRef,
    activeHostedTurnIdRef,
    clearOptimisticHostedTurn,
    clearOptimisticPendingTurn,
    resetPendingStateMachine,
    pendingChatSendRef,
    firstTokenAtRef,
    isChinese,
    messagesRef,
    notify,
    pendingTurnActiveRef,
    setHostedRunning,
    setMessages,
    setReconnectAttempt,
    setSending,
    updatePendingPhase,
  ]);

  const apply = useCallback((
    events: readonly HostedLifecycleEvent[],
    conversationId?: string,
  ) => {
    if (!events.length) return;
    const owner = conversationId || activeConversationIdRef.current;
    // A stream from the conversation that just lost focus can finish after
    // the user switches rooms. Never enqueue those frames into the new room's
    // reducer; doing so can merge lifecycle state across conversations.
    if (!owner || owner !== activeConversationIdRef.current) return;
    eventQueueRef.current.push(...events.map((event) => ({ conversationId: owner, event })));
    const terminalEvent = events.some((event) => {
      const eventType = event.event_type.toLowerCase();
      return eventType === 'message.completed'
        || eventType === 'turn.completed'
        || eventType === 'turn.cancelled'
        || eventType === 'error'
        || eventType === 'turn.failed';
    });
    if (terminalEvent) {
      if (flushTimerRef.current !== null) cancelAnimationFrame(flushTimerRef.current);
      flush();
      return;
    }
    if (flushTimerRef.current !== null) return;
    // Keep reducer, phase building and native text shaping off most display
    // frames. The first batch is immediate; terminal events still bypass this.
    const scheduleFlush = (now: number) => {
      if (now - lastFlushAtRef.current >= 32) flush();
      else flushTimerRef.current = requestAnimationFrame(scheduleFlush);
    };
    flushTimerRef.current = requestAnimationFrame(scheduleFlush);
  }, [flush]);

  useEffect(() => () => reset(), [cacheOwner, reset]);

  return Object.assign(apply, { reset, runtime });
}
