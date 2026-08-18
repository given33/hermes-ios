import type { ConversationDeleteOutboxItem } from './conversation-store-types';
import {
  assertConversationStorageEpochCurrent,
  captureConversationStorageEpoch,
} from './conversation-storage-coordinator';

export interface ConversationDeleteReplayPort {
  claimReadyConversationDeletions(
    owner: string,
    workerId: string,
    now: number,
    leaseMs: number,
    limit: number,
    expectedOwnerEpoch: number,
    kinds?: readonly ConversationDeleteOutboxItem['kind'][],
  ): Promise<ConversationDeleteOutboxItem[]>;
  removeConversationsLocally(
    owner: string,
    conversationIds: readonly string[],
    activeConversationId: string,
    expectedOwnerEpoch: number,
  ): Promise<unknown>;
  retryConversationDeletion(
    owner: string,
    item: ConversationDeleteOutboxItem,
    error: string,
    nextAttemptAt: number,
    expectedOwnerEpoch: number,
  ): Promise<boolean>;
  removeCompletedConversationDeletion(
    owner: string,
    item: ConversationDeleteOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<boolean>;
  releaseConversationDeletionLease(
    owner: string,
    item: ConversationDeleteOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<boolean>;
}

export interface ConversationDeleteReplayOptions {
  activeConversationId?: string | (() => string);
  cacheOwner: string;
  describeError?(error: unknown): string;
  isAlreadyDeleted?(error: unknown): boolean;
  isRetryable?(error: unknown): boolean;
  leaseMs?: number;
  limit?: number;
  now?: () => number;
  onPermanentFailure?(
    item: ConversationDeleteOutboxItem,
    message: string,
    expectedOwnerEpoch: number,
  ): Promise<void> | void;
  outbox: ConversationDeleteReplayPort;
  retryDelayMs?: number;
  workerId: string;
  kinds?: readonly ConversationDeleteOutboxItem['kind'][];
  deleteRemote(
    item: ConversationDeleteOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<void>;
}

export interface ConversationDeleteReplayService {
  replay(expectedOwnerEpoch?: number): Promise<ConversationDeleteReplayResult>;
}

export interface ConversationDeleteReplayResult {
  completed: number;
  failed: number;
  retried: number;
}

/**
 * Replays local-first delete intents with the same ordering on every launch.
 * A lease only protects the network phase; local pruning is idempotent and is
 * deliberately repeated immediately before each remote request.
 */
export function createConversationDeleteReplayService({
  activeConversationId = '',
  cacheOwner,
  describeError = defaultDescribeError,
  isAlreadyDeleted = () => false,
  isRetryable = () => true,
  leaseMs = 60_000,
  limit = 8,
  now = Date.now,
  onPermanentFailure,
  outbox,
  retryDelayMs = 60_000,
  workerId,
  kinds,
  deleteRemote,
}: ConversationDeleteReplayOptions): ConversationDeleteReplayService {
  let activeReplay: { epoch: number; promise: Promise<ConversationDeleteReplayResult> } | null = null;

  const resolveActiveConversationId = () => (
    typeof activeConversationId === 'function' ? activeConversationId() : activeConversationId
  );

  const replayOnce = async (expectedOwnerEpoch: number): Promise<ConversationDeleteReplayResult> => {
    assertConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch);
    const result: ConversationDeleteReplayResult = { completed: 0, failed: 0, retried: 0 };
    let batches = 0;
    while (batches++ < 32) {
      const pending = await outbox.claimReadyConversationDeletions(
        cacheOwner,
        workerId,
        now(),
        leaseMs,
        limit,
        expectedOwnerEpoch,
        kinds,
      );
      if (!pending.length) break;
      for (const item of pending) {
        assertConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch);
        try {
          // This is intentionally before deleteRemote on every replay. If the
          // process died after enqueueing but before cache pruning, the cloud
          // can never be deleted while the stale row remains locally visible.
          await outbox.removeConversationsLocally(
            cacheOwner,
            [item.conversationId],
            resolveActiveConversationId(),
            expectedOwnerEpoch,
          );
          assertConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch);
          await deleteRemote(item, expectedOwnerEpoch);
          assertConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch);
          if (await outbox.removeCompletedConversationDeletion(
            cacheOwner,
            item,
            expectedOwnerEpoch,
          )) result.completed += 1;
        } catch (error) {
          assertConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch);
          if (isAlreadyDeleted(error)) {
            if (await outbox.removeCompletedConversationDeletion(
              cacheOwner,
              item,
              expectedOwnerEpoch,
            )) result.completed += 1;
            continue;
          }
          const message = describeError(error);
          if (isRetryable(error)) {
            await outbox.retryConversationDeletion(
              cacheOwner,
              item,
              message,
              now() + retryDelayMs,
              expectedOwnerEpoch,
            );
            result.retried += 1;
            continue;
          }
          await outbox.removeCompletedConversationDeletion(
            cacheOwner,
            item,
            expectedOwnerEpoch,
          );
          await onPermanentFailure?.(item, message, expectedOwnerEpoch);
          result.failed += 1;
        } finally {
          // A successful remove/retry clears the lease. This is harmless and
          // also releases a row if a custom port chose to leave it in place.
          await outbox.releaseConversationDeletionLease(
            cacheOwner,
            item,
            expectedOwnerEpoch,
          ).catch(() => undefined);
        }
      }
    }
    return result;
  };

  return {
    replay(expectedOwnerEpoch = captureConversationStorageEpoch(cacheOwner)) {
      assertConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch);
      if (activeReplay?.epoch === expectedOwnerEpoch) return activeReplay.promise;
      const replay = replayOnce(expectedOwnerEpoch);
      activeReplay = { epoch: expectedOwnerEpoch, promise: replay };
      return replay.finally(() => {
        if (activeReplay?.promise === replay) activeReplay = null;
      });
    },
  };
}

function defaultDescribeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Conversation deletion failed.';
}
