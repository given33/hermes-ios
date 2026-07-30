import { useEffect, type MutableRefObject } from 'react';
import { AppState } from 'react-native';

interface ConversationIndexLifecycleOptions {
  activeConversationIdRef: MutableRefObject<string>;
  notificationConversationId?: string;
  notificationIdentity?: string;
  onError(error: unknown): void;
  openNotificationConversation(conversationId: string): Promise<unknown>;
  onPreferredConversationConsumed?(conversationId: string): void;
  preferredConversationId?: string;
  refreshConversationIndex(preferredId?: string): Promise<unknown>;
  replayDurableOutboxes(): Promise<unknown>;
  refreshIntervalMs?: number;
}

/** Own initial hydration, foreground refresh and the low-frequency index timer. */
export function useConversationIndexLifecycle({
  activeConversationIdRef,
  notificationConversationId = '',
  notificationIdentity = '',
  onError,
  openNotificationConversation,
  onPreferredConversationConsumed,
  preferredConversationId = '',
  refreshConversationIndex,
  replayDurableOutboxes,
  refreshIntervalMs = 15_000,
}: ConversationIndexLifecycleOptions): void {
  useEffect(() => {
    let disposed = false;
    const reportError = (error: unknown) => {
      if (!disposed) onError(error);
    };
    void replayDurableOutboxes()
      .catch(reportError)
      .then(() => refreshConversationIndex(preferredConversationId))
      .then(() => {
        if (!disposed && preferredConversationId) {
          onPreferredConversationConsumed?.(preferredConversationId);
        }
      })
      .catch((error) => {
        if (!disposed) onError(error);
      });

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void replayDurableOutboxes()
        .catch(reportError)
        .then(() => refreshConversationIndex(activeConversationIdRef.current))
        .catch((error) => {
          if (!disposed) onError(error);
        });
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const refresh = async () => {
      if (stopped) return;
      if (AppState.currentState === 'active') {
        await replayDurableOutboxes().catch(reportError);
        await refreshConversationIndex(activeConversationIdRef.current).catch(reportError);
      }
      if (!stopped) timer = setTimeout(() => void refresh(), refreshIntervalMs);
    };
    timer = setTimeout(() => void refresh(), refreshIntervalMs);

    return () => {
      disposed = true;
      stopped = true;
      appStateSubscription.remove();
      if (timer) clearTimeout(timer);
    };
  }, [
    activeConversationIdRef,
    onError,
    onPreferredConversationConsumed,
    preferredConversationId,
    refreshConversationIndex,
    refreshIntervalMs,
    replayDurableOutboxes,
  ]);

  useEffect(() => {
    if (!notificationIdentity || !notificationConversationId) return undefined;
    let disposed = false;
    void openNotificationConversation(notificationConversationId).catch((error) => {
      if (!disposed) onError(error);
    });
    return () => { disposed = true; };
  }, [
    notificationConversationId,
    notificationIdentity,
    onError,
    openNotificationConversation,
  ]);
}
