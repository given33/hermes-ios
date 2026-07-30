import type { HostedInterventionOutboxItem } from '../../api/conversation-store-types';
import { assertConversationStorageEpochCurrent } from '../../api/conversation-storage-coordinator';

export interface HostedInterventionReplayOutboxPort {
  failPendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
    error: string,
    expectedOwnerEpoch: number,
  ): Promise<void>;
  readPendingInterventions(owner: string): Promise<HostedInterventionOutboxItem[]>;
  upsertPendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<void>;
}

interface HostedInterventionReplayOptions {
  cacheOwner: string;
  deliver(item: HostedInterventionOutboxItem, expectedOwnerEpoch: number): Promise<void>;
  describeError(error: unknown): string;
  isRetryable(error: unknown): boolean;
  maxAttempts: number;
  now?: () => number;
  onDelivered?(
    item: HostedInterventionOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<void> | void;
  onPermanentFailure?(
    item: HostedInterventionOutboxItem,
    message: string,
    expectedOwnerEpoch: number,
  ): Promise<void> | void;
  outbox: HostedInterventionReplayOutboxPort;
  retryDelayMs: number;
}

export interface HostedInterventionReplayService {
  handleFailure(
    item: HostedInterventionOutboxItem,
    error: unknown,
    expectedOwnerEpoch: number,
  ): Promise<'failed' | 'retry'>;
  replay(expectedOwnerEpoch: number): Promise<void>;
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
  let activeReplay: { epoch: number; promise: Promise<void> } | null = null;
  const assertCurrent = (expectedOwnerEpoch: number) => {
    assertConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch);
  };

  const handleFailure = async (
    item: HostedInterventionOutboxItem,
    error: unknown,
    expectedOwnerEpoch: number,
  ): Promise<'failed' | 'retry'> => {
    assertCurrent(expectedOwnerEpoch);
    const message = describeError(error);
    const attempts = (item.attempts || 0) + 1;
    if (isRetryable(error) && attempts < maxAttempts) {
      await outbox.upsertPendingIntervention(
        cacheOwner,
        {
          ...item,
          attempts,
          lastError: message,
          nextAttemptAt: now() + retryDelayMs,
        },
        expectedOwnerEpoch,
      );
      assertCurrent(expectedOwnerEpoch);
      return 'retry';
    }
    await outbox.failPendingIntervention(cacheOwner, item, message, expectedOwnerEpoch);
    assertCurrent(expectedOwnerEpoch);
    await onPermanentFailure?.(item, message, expectedOwnerEpoch);
    assertCurrent(expectedOwnerEpoch);
    return 'failed';
  };

  const replayOnce = async (expectedOwnerEpoch: number) => {
    assertCurrent(expectedOwnerEpoch);
    const pending = await outbox.readPendingInterventions(cacheOwner);
    assertCurrent(expectedOwnerEpoch);
    for (const item of pending.sort((left, right) => left.queuedAt - right.queuedAt)) {
      assertCurrent(expectedOwnerEpoch);
      if ((item.nextAttemptAt || 0) > now()) continue;
      try {
        await deliver(item, expectedOwnerEpoch);
        assertCurrent(expectedOwnerEpoch);
      } catch (error) {
        assertCurrent(expectedOwnerEpoch);
        await handleFailure(item, error, expectedOwnerEpoch);
        continue;
      }
      await onDelivered?.(item, expectedOwnerEpoch);
      assertCurrent(expectedOwnerEpoch);
    }
  };

  return {
    handleFailure,
    replay(expectedOwnerEpoch: number) {
      assertCurrent(expectedOwnerEpoch);
      if (activeReplay?.epoch === expectedOwnerEpoch) return activeReplay.promise;
      const replay = replayOnce(expectedOwnerEpoch);
      activeReplay = { epoch: expectedOwnerEpoch, promise: replay };
      return replay.finally(() => {
        if (activeReplay?.promise === replay) activeReplay = null;
      });
    },
  };
}
