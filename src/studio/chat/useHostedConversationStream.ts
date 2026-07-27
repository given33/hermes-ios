import { useEffect, type MutableRefObject } from 'react';
import { AppState } from 'react-native';

import type { HermesCloudApi, SingleConversation } from '../../api/HermesCloudApi';
import { withAbortableDeadline } from '../../api/async-deadline';
import { consumeHostedConversationEvents } from '../../api/hosted-conversation-events';
import type { ConversationSyncGeneration } from '../../api/conversation-sync-generation';

const STREAM_RECONNECT_MS = 1_500;
const HEALTHY_POLL_MS = 15_000;
const DISCONNECTED_POLL_MS = 1_000;

interface HostedConversationStreamOptions {
  activeConversationId: string;
  activeConversationIdRef: MutableRefObject<string>;
  applyConversation(conversation: SingleConversation): void;
  cloudApi: HermesCloudApi | null;
  cursorRef: MutableRefObject<Map<string, number>>;
  generation: ConversationSyncGeneration;
  hostedRunning: boolean;
  loadConversation(
    conversationId: string,
    expectedGeneration: number,
    signal: AbortSignal,
  ): Promise<SingleConversation | null>;
  requestTimeoutMs: number;
}

/** Own SSE reconnect, foreground suspension and incremental polling fallback. */
export function useHostedConversationStream({
  activeConversationId,
  activeConversationIdRef,
  applyConversation,
  cloudApi,
  cursorRef,
  generation,
  hostedRunning,
  loadConversation,
  requestTimeoutMs,
}: HostedConversationStreamOptions): void {
  useEffect(() => {
    if (!cloudApi || !activeConversationId || !hostedRunning) return undefined;

    let disposed = false;
    let streamActive = false;
    let streamHealthy = false;
    let streamController: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const activeGeneration = generation.advanceActive();

    const scheduleStream = () => {
      if (disposed || streamActive || reconnectTimer || AppState.currentState !== 'active') {
        return;
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startStream();
      }, STREAM_RECONNECT_MS);
    };

    const startStream = () => {
      if (disposed || streamActive || AppState.currentState !== 'active') return;
      streamActive = true;
      streamController = new AbortController();
      void consumeHostedConversationEvents(
        cloudApi,
        activeConversationId,
        cursorRef.current.get(activeConversationId) || 0,
        streamController.signal,
        ({ conversation, cursor }) => {
          if (
            disposed
            || !generation.isActiveCurrent(activeGeneration)
            || activeConversationIdRef.current !== activeConversationId
          ) return;
          streamHealthy = true;
          cursorRef.current.set(activeConversationId, cursor);
          applyConversation(conversation);
        },
      ).catch(() => {
        if (!streamController?.signal.aborted) streamHealthy = false;
      }).finally(() => {
        streamActive = false;
        streamController = null;
        scheduleStream();
      });
    };

    const poll = async () => {
      if (disposed) return;
      if (AppState.currentState === 'active') {
        await withAbortableDeadline(
          (signal) => loadConversation(activeConversationId, activeGeneration, signal),
          requestTimeoutMs,
          'Hermes conversation polling timed out',
        ).catch(() => undefined);
      }
      if (!disposed) {
        pollTimer = setTimeout(
          () => void poll(),
          streamHealthy ? HEALTHY_POLL_MS : DISCONNECTED_POLL_MS,
        );
      }
    };

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        startStream();
        return;
      }
      streamHealthy = false;
      streamController?.abort();
    });

    startStream();
    void poll();
    return () => {
      disposed = true;
      streamController?.abort();
      appStateSubscription.remove();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [
    activeConversationId,
    activeConversationIdRef,
    applyConversation,
    cloudApi,
    cursorRef,
    generation,
    hostedRunning,
    loadConversation,
    requestTimeoutMs,
  ]);
}
