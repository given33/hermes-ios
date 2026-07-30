export class AsyncSingleFlight {
  private active: symbol | null = null;

  async run<T>(
    operation: (isCurrent: () => boolean) => Promise<T>,
    subscribeToAbandonment?: (abandon: () => void) => () => void,
  ): Promise<T | undefined> {
    if (this.active) return undefined;
    const token = Symbol('single-flight');
    this.active = token;
    const isCurrent = () => this.active === token;
    let cleanupAbandonment: () => void = () => undefined;
    try {
      const operationOutcome = operation(isCurrent).then(
        (value) => ({ kind: 'value' as const, value }),
        (error: unknown) => ({ error, kind: 'error' as const }),
      );
      if (!subscribeToAbandonment) {
        const outcome = await operationOutcome;
        if (outcome.kind === 'error') throw outcome.error;
        return outcome.value;
      }

      let abandon!: () => void;
      const abandoned = new Promise<{ kind: 'abandoned' }>((resolve) => {
        abandon = () => {
          if (this.active === token) this.active = null;
          resolve({ kind: 'abandoned' });
        };
      });
      cleanupAbandonment = subscribeToAbandonment(abandon);
      const outcome = await Promise.race([operationOutcome, abandoned]);
      if (outcome.kind === 'abandoned') return undefined;
      if (outcome.kind === 'error') throw outcome.error;
      return outcome.value;
    } finally {
      cleanupAbandonment();
      if (this.active === token) this.active = null;
    }
  }
}
