import { useEffect, type MutableRefObject } from 'react';
import { AppState } from 'react-native';

import type { HermesCloudApi, SingleConversation } from '../../api/HermesCloudApi';
import { withAbortableDeadline } from '../../api/async-deadline';
import { reconnectDelay } from '../../api/reconnect-backoff';
import {
  consumeHostedConversationEvents,
  type HostedLifecycleEvent,
} from '../../api/hosted-conversation-events';
import { accountGenerationFromOwnerScope } from '../../auth/account-identity';
import type { ConversationSyncGeneration } from '../../api/conversation-sync-generation';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';

const FAILURE_LOG_INTERVAL_MS = 60_000;
const HEALTHY_POLL_MS = 15_000;
const DISCONNECTED_POLL_MS = 1_000;

interface HostedConversationStreamOptions {
  activeConversationId: string;
  activeConversationIdRef: MutableRefObject<string>;
  applyConversation(
    conversation: SingleConversation,
    expectedOwnerEpoch?: number,
    resetCursor?: boolean,
    activateConversation?: boolean,
    deferCacheWrite?: boolean,
  ): void | Promise<void>;
  applyLifecycleEvents(events: readonly HostedLifecycleEvent[]): void | Promise<void>;
  cacheOwner: string;
  cloudApi: HermesCloudApi | null;
  accountGenerationRef: MutableRefObject<Map<string, string>>;
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
  accountGenerationRef,
  activeConversationId,
  activeConversationIdRef,
  applyConversation,
  applyLifecycleEvents,
  cacheOwner,
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
    let reconnectAttempt = 0;
    let lastFailureLogAt = 0;
    const expectedAccountGeneration = accountGenerationFromOwnerScope(cacheOwner);
    let reconciliationQueue = Promise.resolve();
    const activeGeneration = generation.advanceActive();
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    const lifecycleCurrent = () => isConversationStorageEpochCurrent(cacheOwner, ownerEpoch);
    if (!lifecycleCurrent()) return undefined;
    accountGenerationRef.current.set(activeConversationId, expectedAccountGeneration);

    const reconcileInOrder = <T,>(operation: () => Promise<T>): Promise<T> => {
      const result = reconciliationQueue.then(operation);
      reconciliationQueue = result.then(() => undefined, () => undefined);
      return result;
    };

    const reportRefreshFailure = (kind: 'poll' | 'stream', error: unknown) => {
      const now = Date.now();
      if (now - lastFailureLogAt < FAILURE_LOG_INTERVAL_MS) return;
      lastFailureLogAt = now;
      console.warn(
        `Hermes hosted conversation ${kind} refresh failed`,
        error instanceof Error ? error.name : 'Error',
      );
    };

    const scheduleStream = () => {
      if (
        disposed
        || !lifecycleCurrent()
        || streamActive
        || reconnectTimer
        || AppState.currentState !== 'active'
      ) {
        return;
      }
      const delay = reconnectDelay(reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startStream();
      }, delay);
    };

    const startStream = () => {
      if (disposed || !lifecycleCurrent() || streamActive || AppState.currentState !== 'active') {
        return;
      }
      streamActive = true;
      streamController = new AbortController();
      void consumeHostedConversationEvents(
        cloudApi,
        activeConversationId,
        cursorRef.current.get(activeConversationId) || 0,
        expectedAccountGeneration,
        streamController.signal,
        async ({
          accountGeneration: incomingAccountGeneration,
          conversation,
          cursor,
          events,
          hasGap,
          resetCursor,
        }) => {
          if (
            disposed
            || !lifecycleCurrent()
            || !generation.isActiveCurrent(activeGeneration)
            || activeConversationIdRef.current !== activeConversationId
          ) return;
          if (incomingAccountGeneration !== expectedAccountGeneration) {
            throw new Error('Hermes hosted stream crossed its account generation');
          }
          await reconcileInOrder(async () => {
            if (
              disposed
              || !lifecycleCurrent()
              || !generation.isActiveCurrent(activeGeneration)
              || activeConversationIdRef.current !== activeConversationId
            ) return;
            if (conversation) {
              await applyConversation({
                ...conversation,
                hosted_event_cursor: resetCursor
                  ? cursor
                  : Math.max(Number(conversation.hosted_event_cursor) || 0, cursor),
              }, ownerEpoch, resetCursor, false, true);
            } else if (hasGap) {
              throw new Error('Hermes hosted event gap could not be recovered');
            } else if (events.length) {
              await applyLifecycleEvents(events);
            }
            if (!lifecycleCurrent() || !generation.isActiveCurrent(activeGeneration)) return;
            cursorRef.current.set(activeConversationId, cursor);
            streamHealthy = true;
            reconnectAttempt = 0;
          });
        },
      ).catch((error: unknown) => {
        if (!streamController?.signal.aborted) {
          streamHealthy = false;
          reportRefreshFailure('stream', error);
          if (pollTimer) clearTimeout(pollTimer);
          pollTimer = setTimeout(() => void poll(), 0);
        }
      }).finally(() => {
        streamActive = false;
        streamController = null;
        if (lifecycleCurrent()) scheduleStream();
      });
    };

    const poll = async () => {
      if (disposed || !lifecycleCurrent()) return;
      if (AppState.currentState === 'active' && !streamHealthy) {
        await reconcileInOrder(() => withAbortableDeadline(
          (signal) => loadConversation(activeConversationId, activeGeneration, signal),
          requestTimeoutMs,
          'Hermes conversation polling timed out',
        )).catch((error: unknown) => {
          reportRefreshFailure('poll', error);
        });
      }
      if (!disposed && lifecycleCurrent()) {
        pollTimer = setTimeout(
          () => void poll(),
          streamHealthy ? HEALTHY_POLL_MS : DISCONNECTED_POLL_MS,
        );
      }
    };

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (lifecycleCurrent()) startStream();
        return;
      }
      streamHealthy = false;
      streamController?.abort();
    });

    startStream();
    pollTimer = setTimeout(() => void poll(), DISCONNECTED_POLL_MS);
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
    accountGenerationRef,
    applyConversation,
    applyLifecycleEvents,
    cacheOwner,
    cloudApi,
    cursorRef,
    generation,
    hostedRunning,
    loadConversation,
    requestTimeoutMs,
  ]);
}
