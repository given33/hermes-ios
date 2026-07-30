import {
  isConversationStorageEpochCurrent,
} from './conversation-storage-coordinator';

/**
 * Resolve an asynchronous native callback only while the owner generation
 * that started it is still active. Native pickers, permission prompts, and
 * share sheets may outlive an account purge and a same-name reactivation.
 */
export async function runOwnerEpochBound<T>(
  owner: string,
  expectedEpoch: number,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  if (!isConversationStorageEpochCurrent(owner, expectedEpoch)) return undefined;
  const result = await operation();
  if (!isConversationStorageEpochCurrent(owner, expectedEpoch)) return undefined;
  return result;
}
