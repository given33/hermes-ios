const writeChains = new Map<string, Promise<void>>();
const synchronizationGenerations = new Map<string, number>();

/** Serialize every local conversation mutation for one account across facades. */
export async function enqueueConversationStorageWrite(
  owner: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = writeChains.get(owner) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  writeChains.set(owner, next);
  try {
    await next;
  } finally {
    if (writeChains.get(owner) === next) writeChains.delete(owner);
  }
}

export function hasPendingConversationStorageWrite(owner: string): boolean {
  return writeChains.has(owner);
}

export function advanceConversationSynchronization(owner: string): number {
  const next = (synchronizationGenerations.get(owner) || 0) + 1;
  synchronizationGenerations.set(owner, next);
  return next;
}

export function isConversationSynchronizationCurrent(
  owner: string,
  generation: number,
): boolean {
  return synchronizationGenerations.get(owner) === generation;
}
