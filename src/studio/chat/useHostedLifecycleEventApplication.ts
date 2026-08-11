import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import type { HostedLifecycleEvent } from '../../api/hosted-conversation-events';
import { applyHostedLifecycleEvents } from '../../api/hosted-lifecycle-view-model';
import type { HermesChatViewMessage as ChatMessage } from '../../api/chat-view-model';
import type { PendingPhase } from './chat-types';

const HOSTED_EVENT_BATCH_WINDOW_MS = 80;

interface HostedLifecycleEventApplicationOptions {
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
  const eventQueueRef = useRef<HostedLifecycleEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const events = eventQueueRef.current;
    eventQueueRef.current = [];
    if (!events.length) return;

    const result = applyHostedLifecycleEvents(messagesRef.current, events, isChinese);
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

  const apply = useCallback((events: readonly HostedLifecycleEvent[]) => {
    if (!events.length) return;
    eventQueueRef.current.push(...events);
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

  useEffect(() => () => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    eventQueueRef.current = [];
  }, [cacheOwner]);

  return apply;
}
