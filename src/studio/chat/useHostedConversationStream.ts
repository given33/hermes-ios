import { useEffect, type MutableRefObject } from 'react';
import { AppState } from 'react-native';

import type { HermesCloudApi, SingleConversation } from '../../api/HermesCloudApi';
import { withAbortableDeadline } from '../../api/async-deadline';
import { reconnectDelay } from '../../api/reconnect-backoff';
import {
  consumeHostedConversationEvents,
  consumeHostedConversationEventsWebSocket,
  type HostedConversationEventFrame,
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
const EVENT_STREAM_CONNECTION_TIMEOUT_MS = 5_000;
const EVENT_STREAM_IDLE_TIMEOUT_MS = 90_000;

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
  applyLifecycleEvents(events: readonly HostedLifecycleEvent[], conversationId?: string): void | Promise<void>;
  resetLifecycleRuntime?(): void;
  cacheOwner: string;
  cloudApi: HermesCloudApi | null;
  accountGenerationRef: MutableRefObject<Map<string, string>>;
  cursorRef: MutableRefObject<Map<string, number>>;
  generation: ConversationSyncGeneration;
  hostedRunning: boolean;
  /**
   * Keep the official hosted-events stream warm for an existing conversation
   * while it is idle.  A send can then reuse the already-authenticated SSE
   * connection instead of waiting for enqueue ACK -> React effect -> TLS/SSE
   * handshake before the first lifecycle event.
   */
  primeHostedStream?: boolean;
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
  primeHostedStream = false,
  loadConversation,
  requestTimeoutMs,
  resetLifecycleRuntime,
}: HostedConversationStreamOptions): void {
  useEffect(() => {
    if (
      !cloudApi
      || !activeConversationId
      || (!hostedRunning && !primeHostedStream)
    ) return undefined;

    let disposed = false;
    let streamActive = false;
    let streamHealthy = false;
    let streamController: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let lastFailureLogAt = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
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
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
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
      const armIdleWatchdog = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          streamHealthy = false;
          streamController?.abort();
          if (!pollTimer) pollTimer = setTimeout(() => void poll(), 0);
        }, EVENT_STREAM_IDLE_TIMEOUT_MS);
      };
      armIdleWatchdog();
      const eventCursor = cursorRef.current.get(activeConversationId) || 0;
      const applyFrame = async ({
          accountGeneration: incomingAccountGeneration,
          conversation,
          cursor,
          events,
          hasGap,
          resetCursor,
        }: HostedConversationEventFrame) => {
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
              if (resetCursor || hasGap) resetLifecycleRuntime?.();
              await applyConversation({
                ...conversation,
                hosted_event_cursor: resetCursor
                  ? cursor
                  : Math.max(Number(conversation.hosted_event_cursor) || 0, cursor),
              }, ownerEpoch, resetCursor, false, true);
            } else if (hasGap) {
              throw new Error('Hermes hosted event gap could not be recovered');
            } else if (events.length) {
              await applyLifecycleEvents(events, activeConversationId);
            }
            if (!lifecycleCurrent() || !generation.isActiveCurrent(activeGeneration)) return;
            cursorRef.current.set(activeConversationId, cursor);
            streamHealthy = true;
            reconnectAttempt = 0;
          });
        };
      const consumeSse = () => consumeHostedConversationEvents(
        cloudApi,
        activeConversationId,
        cursorRef.current.get(activeConversationId) || eventCursor,
        expectedAccountGeneration,
        streamController!.signal,
        applyFrame,
        undefined,
        EVENT_STREAM_CONNECTION_TIMEOUT_MS,
        armIdleWatchdog,
      );
      // The hosted conversation contract is transport-neutral. Prefer the
      // lower-latency WebSocket mirror on native clients, but immediately
      // fall back to the existing SSE implementation when a proxy, old
      // server, or captive network does not permit the upgrade.
      const consumePreferred = consumeHostedConversationEventsWebSocket(
          cloudApi,
          activeConversationId,
          eventCursor,
          expectedAccountGeneration,
          streamController.signal,
          applyFrame,
          armIdleWatchdog,
          EVENT_STREAM_CONNECTION_TIMEOUT_MS,
        ).catch((error: unknown) => {
          if (streamController?.signal.aborted) throw error;
          return consumeSse();
        });
      void consumePreferred.catch((error: unknown) => {
        if (!streamController?.signal.aborted) {
          streamHealthy = false;
          reportRefreshFailure('stream', error);
          if (pollTimer) clearTimeout(pollTimer);
          pollTimer = setTimeout(() => void poll(), 0);
        }
      }).finally(() => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        streamActive = false;
        streamController = null;
        if (lifecycleCurrent()) scheduleStream();
      });
    };

    const poll = async () => {
      if (disposed || !lifecycleCurrent()) return;
      // A connection attempt is the authoritative live path.  Do not start
      // a competing full-snapshot GET while it is in flight: both operations
      // share the ordered reconciliation queue, so a slow snapshot could
      // hold a first-token SSE frame for the request deadline.  The stream's
      // bounded connection timeout schedules this fallback as soon as it
      // actually fails.
      if (streamActive) {
        pollTimer = setTimeout(
          () => void poll(),
          DISCONNECTED_POLL_MS,
        );
        return;
      }
      if (AppState.currentState === 'active' && !streamHealthy) {
        await reconcileInOrder(() => withAbortableDeadline(
          (signal) => loadConversation(activeConversationId, activeGeneration, signal),
          Math.min(requestTimeoutMs, EVENT_STREAM_CONNECTION_TIMEOUT_MS),
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
      if (idleTimer) clearTimeout(idleTimer);
    });

    startStream();
    return () => {
      disposed = true;
      streamController?.abort();
      if (idleTimer) clearTimeout(idleTimer);
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
    primeHostedStream,
    loadConversation,
    requestTimeoutMs,
  ]);
}
