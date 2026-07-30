const writeChains = new Map<string, Promise<void>>();
const synchronizationGenerations = new Map<string, number>();
const synchronizationEpochs = new Map<string, Map<number, number>>();
const lifecycleEpochs = new Map<string, number>();
const blockedOwners = new Set<string>();

export class ConversationStorageLifecycleChangedError extends Error {
  constructor() {
    super('Conversation owner lifecycle changed');
    this.name = 'ConversationStorageLifecycleChangedError';
  }
}

async function enqueueOwnerOperation(
  owner: string,
  operation: () => Promise<void>,
  allowBlocked: boolean,
  expectedEpoch?: number,
): Promise<void> {
  const previous = writeChains.get(owner) || Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    if (!allowBlocked && blockedOwners.has(owner)) return;
    if (
      expectedEpoch !== undefined
      && !isConversationStorageEpochCurrent(owner, expectedEpoch)
    ) return;
    await operation();
  });
  writeChains.set(owner, next);
  try {
    await next;
  } finally {
    if (writeChains.get(owner) === next) writeChains.delete(owner);
  }
}

/** Serialize every local conversation mutation for one account across facades. */
export async function enqueueConversationStorageWrite(
  owner: string,
  operation: () => Promise<void>,
  expectedEpoch = captureConversationStorageEpoch(owner),
): Promise<void> {
  await enqueueOwnerOperation(owner, operation, false, expectedEpoch);
}

/** Serialize account lifecycle work even while ordinary writes are fenced. */
export async function enqueueConversationStorageMaintenance(
  owner: string,
  operation: () => Promise<void>,
): Promise<void> {
  await enqueueOwnerOperation(owner, operation, true);
}

function advanceLifecycleEpoch(owner: string): number {
  const next = captureConversationStorageEpoch(owner) + 1;
  lifecycleEpochs.set(owner, next);
  return next;
}

/** Capture the authenticated account lifecycle that owns an async operation. */
export function captureConversationStorageEpoch(owner: string): number {
  return lifecycleEpochs.get(owner) || 0;
}

/** Final CAS used before an old async response mutates UI or durable state. */
export function isConversationStorageEpochCurrent(
  owner: string,
  epoch: number,
): boolean {
  return captureConversationStorageEpoch(owner) === epoch
    && !blockedOwners.has(owner);
}

/** Fail before an obsolete async continuation can mutate a newer account generation. */
export function assertConversationStorageEpochCurrent(owner: string, epoch: number): void {
  if (!isConversationStorageEpochCurrent(owner, epoch)) {
    throw new ConversationStorageLifecycleChangedError();
  }
}

/**
 * Start destructive account cleanup synchronously, before it waits behind any
 * already-running storage operation. Late writes from the old account then
 * carry an obsolete epoch even if the same owner identifier is activated again.
 */
export function beginConversationStorageOwnerPurge(owner: string): number {
  const epoch = advanceLifecycleEpoch(owner);
  blockedOwners.add(owner);
  return epoch;
}

/** Reserve a distinct epoch for a newly authenticated account generation. */
export function beginConversationStorageOwnerActivation(owner: string): number {
  const epoch = advanceLifecycleEpoch(owner);
  blockedOwners.add(owner);
  return epoch;
}

/** Unblock only the activation that still owns the current lifecycle. */
export function completeConversationStorageOwnerActivation(
  owner: string,
  epoch: number,
): boolean {
  if (captureConversationStorageEpoch(owner) !== epoch) return false;
  blockedOwners.delete(owner);
  return true;
}

export function isConversationStorageOwnerBlocked(owner: string): boolean {
  return blockedOwners.has(owner);
}

/** Wait until every write already queued for one storage key has settled. */
export async function awaitConversationStorageWrites(owner: string): Promise<void> {
  while (true) {
    const pending = writeChains.get(owner);
    if (!pending) return;
    await pending.catch(() => undefined);
  }
}

export function hasPendingConversationStorageWrite(owner: string): boolean {
  return writeChains.has(owner);
}

export function advanceConversationSynchronization(owner: string): number {
  const next = (synchronizationGenerations.get(owner) || 0) + 1;
  synchronizationGenerations.set(owner, next);
  const epochs = synchronizationEpochs.get(owner) || new Map<number, number>();
  epochs.set(next, captureConversationStorageEpoch(owner));
  for (const generation of epochs.keys()) {
    if (generation < next - 2) epochs.delete(generation);
  }
  synchronizationEpochs.set(owner, epochs);
  return next;
}

export function isConversationSynchronizationCurrent(
  owner: string,
  generation: number,
): boolean {
  return synchronizationGenerations.get(owner) === generation
    && synchronizationEpochs.get(owner)?.get(generation) === captureConversationStorageEpoch(owner)
    && !blockedOwners.has(owner);
}
