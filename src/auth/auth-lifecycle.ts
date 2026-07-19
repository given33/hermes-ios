import type { SavedConnection } from './credential-contract';

export class CredentialMutationQueue {
  private tail: Promise<void> = Promise.resolve();

  run(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.catch(() => undefined).then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export async function runOptionalAuthEffect(
  effect: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await effect();
    return true;
  } catch {
    return false;
  }
}

/**
 * Owns the generation and exclusive-operation state for one mounted auth
 * provider. Tokens make late native/network callbacks harmless after an
 * unmount, logout, or replacement operation.
 */
export class AuthLifecycleCoordinator {
  private active = false;
  private generation = 0;
  private operationToken: number | null = null;

  mount(): number {
    this.active = true;
    this.operationToken = null;
    this.generation += 1;
    return this.generation;
  }

  unmount(): void {
    this.active = false;
    this.operationToken = null;
    this.generation += 1;
  }

  beginOperation(): number | null {
    if (!this.active || this.operationToken !== null) return null;
    this.generation += 1;
    this.operationToken = this.generation;
    return this.operationToken;
  }

  finishOperation(token: number): void {
    if (this.operationToken === token) this.operationToken = null;
  }

  invalidate(): number {
    this.operationToken = null;
    this.generation += 1;
    return this.generation;
  }

  isCurrent(token: number): boolean {
    return this.active && this.generation === token;
  }

  isBusy(): boolean {
    return this.operationToken !== null;
  }

  currentGeneration(): number {
    return this.generation;
  }
}

export function isCurrentAuthLifecycle(
  currentConnection: SavedConnection | null,
  expectedConnection: SavedConnection,
  currentGeneration: number,
  expectedGeneration: number,
): boolean {
  return currentConnection === expectedConnection
    && currentGeneration === expectedGeneration;
}

export function isCurrentAuthSession(
  currentConnection: SavedConnection | null,
  expectedConnection: Pick<SavedConnection, 'baseUrl' | 'username'>,
  currentGeneration: number,
  expectedGeneration: number,
): boolean {
  return currentConnection?.baseUrl === expectedConnection.baseUrl
    && currentConnection.username === expectedConnection.username
    && currentGeneration === expectedGeneration;
}
