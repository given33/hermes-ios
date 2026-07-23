export class AsyncSingleFlight {
  private active: Promise<void> | null = null;

  run(operation: () => Promise<void>): Promise<void> {
    if (this.active) return this.active;
    const active = Promise.resolve().then(operation);
    this.active = active.finally(() => {
      if (this.active === activeWithCleanup) this.active = null;
    });
    const activeWithCleanup = this.active;
    return activeWithCleanup;
  }

  get running(): boolean {
    return this.active !== null;
  }
}
