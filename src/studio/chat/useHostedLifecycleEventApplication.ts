import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import type { HostedLifecycleEvent } from '../../api/hosted-conversation-events';
import { applyHostedLifecycleEvents } from '../../api/hosted-lifecycle-view-model';
import type { HostedRuntimeProjection } from '../../api/hosted-runtime-reducer';
import type { HermesChatViewMessage as ChatMessage } from '../../api/chat-view-model';
import type { PendingPhase } from './chat-types';

const HOSTED_EVENT_BATCH_WINDOW_MS = 80;

interface QueuedHostedLifecycleEvent {
  conversationId: string;
  event: HostedLifecycleEvent;
}

interface HostedLifecycleEventApplicationOptions {
  activeConversationIdRef: MutableRefObject<string>;
  cacheOwner: string;
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
  activeConversationIdRef,
  cacheOwner,
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
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    eventQueueRef.current = [];
    runtimeRef.current = undefined;
    setRuntime(undefined);
  }, []);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const activeConversationId = activeConversationIdRef.current;
    const events = eventQueueRef.current
      .filter((queued) => queued.conversationId === activeConversationId)
      .map((queued) => queued.event);
    eventQueueRef.current = [];
    if (!events.length) return;

    const result = applyHostedLifecycleEvents(
      messagesRef.current,
      events,
      isChinese,
      runtimeRef.current,
    );
    runtimeRef.current = result.runtime;
    setRuntime(result.runtime);
    setMessages(result.messages);
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
      setHostedRunning(false);
      setSending(false);
    } else if (result.turnActive) {
      pendingTurnActiveRef.current = true;
      setHostedRunning(true);
    }
  }, [
    activeConversationIdRef,
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
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flush();
      return;
    }
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(flush, HOSTED_EVENT_BATCH_WINDOW_MS);
  }, [flush]);

  useEffect(() => () => reset(), [cacheOwner, reset]);

  return Object.assign(apply, { reset, runtime });
}
