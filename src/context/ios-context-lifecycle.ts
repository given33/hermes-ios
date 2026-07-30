export interface IOSContextLifecycleCapture {
  readonly accountGeneration: string;
  readonly epoch: number;
  readonly ownerScope: string;
  readonly signal: AbortSignal;
}

interface ActiveIOSContextLifecycle extends IOSContextLifecycleCapture {
  readonly controller: AbortController;
}

export class StaleIOSContextLifecycleError extends Error {
  readonly name = 'StaleIOSContextLifecycleError';

  constructor() {
    super('Hermes iOS context lifecycle is no longer current');
    Object.setPrototypeOf(this, StaleIOSContextLifecycleError.prototype);
  }
}

export class IOSContextLifecycleCoordinator {
  private active: ActiveIOSContextLifecycle | null = null;
  private epoch = 0;

  activate(ownerScope: string, accountGeneration: string): IOSContextLifecycleCapture {
    this.active?.controller.abort();
    const controller = new AbortController();
    const capture = {
      accountGeneration,
      controller,
      epoch: ++this.epoch,
      ownerScope,
      signal: controller.signal,
    };
    this.active = capture;
    return capture;
  }

  invalidate(capture: IOSContextLifecycleCapture): void {
    if (this.active !== capture) return;
    this.active.controller.abort();
    this.active = null;
    this.epoch += 1;
  }

  isCurrent(capture: IOSContextLifecycleCapture): boolean {
    return this.active === capture
      && !capture.signal.aborted
      && capture.epoch === this.epoch;
  }
}

export async function awaitCurrentIOSContext<T>(
  coordinator: IOSContextLifecycleCoordinator,
  capture: IOSContextLifecycleCapture,
  operation: () => Promise<T>,
): Promise<T> {
  if (!coordinator.isCurrent(capture)) throw new StaleIOSContextLifecycleError();
  const result = await operation();
  if (!coordinator.isCurrent(capture)) throw new StaleIOSContextLifecycleError();
  return result;
}
