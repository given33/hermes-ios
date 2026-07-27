import type { HostedInterventionOutboxItem } from '../../api/conversation-store-types';

export interface HostedInterventionReplayOutboxPort {
  failPendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
    error: string,
  ): Promise<void>;
  readPendingInterventions(owner: string): Promise<HostedInterventionOutboxItem[]>;
  upsertPendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
  ): Promise<void>;
}

interface HostedInterventionReplayOptions {
  cacheOwner: string;
  deliver(item: HostedInterventionOutboxItem): Promise<void>;
  describeError(error: unknown): string;
  isRetryable(error: unknown): boolean;
  maxAttempts: number;
  now?: () => number;
  onDelivered?(item: HostedInterventionOutboxItem): Promise<void> | void;
  onPermanentFailure?(
    item: HostedInterventionOutboxItem,
    message: string,
  ): Promise<void> | void;
  outbox: HostedInterventionReplayOutboxPort;
  retryDelayMs: number;
}

export interface HostedInterventionReplayService {
  handleFailure(
    item: HostedInterventionOutboxItem,
    error: unknown,
  ): Promise<'failed' | 'retry'>;
  replay(): Promise<void>;
}

export function createHostedInterventionReplayService({
  cacheOwner,
  deliver,
  describeError,
  isRetryable,
  maxAttempts,
  now = Date.now,
  onDelivered,
  onPermanentFailure,
  outbox,
  retryDelayMs,
}: HostedInterventionReplayOptions): HostedInterventionReplayService {
  let activeReplay: Promise<void> | null = null;

  const handleFailure = async (
    item: HostedInterventionOutboxItem,
    error: unknown,
  ): Promise<'failed' | 'retry'> => {
    const message = describeError(error);
    const attempts = (item.attempts || 0) + 1;
    if (isRetryable(error) && attempts < maxAttempts) {
      await outbox.upsertPendingIntervention(cacheOwner, {
        ...item,
        attempts,
        lastError: message,
        nextAttemptAt: now() + retryDelayMs,
      });
      return 'retry';
    }
    await outbox.failPendingIntervention(cacheOwner, item, message);
    await onPermanentFailure?.(item, message);
    return 'failed';
  };

  const replayOnce = async () => {
    const pending = await outbox.readPendingInterventions(cacheOwner);
    for (const item of pending.sort((left, right) => left.queuedAt - right.queuedAt)) {
      if ((item.nextAttemptAt || 0) > now()) continue;
      try {
        await deliver(item);
      } catch (error) {
        await handleFailure(item, error);
        continue;
      }
      await onDelivered?.(item);
    }
  };

  return {
    handleFailure,
    replay() {
      if (activeReplay) return activeReplay;
      const replay = replayOnce();
      activeReplay = replay;
      return replay.finally(() => {
        if (activeReplay === replay) activeReplay = null;
      });
    },
  };
}
