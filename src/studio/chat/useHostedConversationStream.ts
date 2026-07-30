import { useEffect, type MutableRefObject } from 'react';
import { AppState } from 'react-native';

import type { HermesCloudApi, SingleConversation } from '../../api/HermesCloudApi';
import { withAbortableDeadline } from '../../api/async-deadline';
import {
  consumeHostedConversationEvents,
} from '../../api/hosted-conversation-events';
import { accountGenerationFromOwnerScope } from '../../auth/account-identity';
import type { ConversationSyncGeneration } from '../../api/conversation-sync-generation';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';

const STREAM_RECONNECT_MS = 1_500;
const HEALTHY_POLL_MS = 15_000;
const DISCONNECTED_POLL_MS = 1_000;

interface HostedConversationStreamOptions {
  activeConversationId: string;
  activeConversationIdRef: MutableRefObject<string>;
  applyConversation(
    conversation: SingleConversation,
    expectedOwnerEpoch?: number,
    resetCursor?: boolean,
  ): void | Promise<void>;
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
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startStream();
      }, STREAM_RECONNECT_MS);
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
              }, ownerEpoch, resetCursor);
            } else if (hasGap) {
              throw new Error('Hermes hosted event gap could not be recovered');
            } else if (events.length) {
              await withAbortableDeadline(
                (signal) => loadConversation(activeConversationId, activeGeneration, signal),
                requestTimeoutMs,
                'Hermes hosted event reconciliation timed out',
              );
            }
            if (!lifecycleCurrent() || !generation.isActiveCurrent(activeGeneration)) return;
            cursorRef.current.set(activeConversationId, cursor);
            streamHealthy = true;
          });
        },
      ).catch(() => {
        if (!streamController?.signal.aborted) streamHealthy = false;
      }).finally(() => {
        streamActive = false;
        streamController = null;
        if (lifecycleCurrent()) scheduleStream();
      });
    };

    const poll = async () => {
      if (disposed || !lifecycleCurrent()) return;
      if (AppState.currentState === 'active') {
        await reconcileInOrder(() => withAbortableDeadline(
          (signal) => loadConversation(activeConversationId, activeGeneration, signal),
          requestTimeoutMs,
          'Hermes conversation polling timed out',
        )).catch(() => undefined);
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
    accountGenerationRef,
    applyConversation,
    cacheOwner,
    cloudApi,
    cursorRef,
    generation,
    hostedRunning,
    loadConversation,
    requestTimeoutMs,
  ]);
}
