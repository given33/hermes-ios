/**
 * Keep a durable outbox moving while an authenticated surface remains
 * mounted. React Native suspends timers while an app is backgrounded, so the
 * foreground transition is the authoritative wake-up signal; the bounded
 * timer covers retry backoff while the app stays active.
 */
export interface ForegroundReplayLifecycleOptions {
  getAppState(): string | null | undefined;
  replay(): Promise<unknown>;
  subscribe(listener: (state: string) => void): { remove(): void };
  intervalMs?: number;
}

export interface ForegroundReplayLifecycle {
  stop(): void;
}

const DEFAULT_INTERVAL_MS = 15_000;

export function startForegroundReplayLifecycle({
  getAppState,
  intervalMs = DEFAULT_INTERVAL_MS,
  replay,
  subscribe,
}: ForegroundReplayLifecycleOptions): ForegroundReplayLifecycle {
  const cadence = Math.max(1_000, Math.floor(intervalMs));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<unknown> | null = null;
  // AppState can become active while a background-era replay is still
  // settling. Remember that wake-up so the completed replay cannot strand the
  // outbox until the next cadence tick.
  let pendingWake = false;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    if (stopped || getAppState() !== 'active' || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      trigger();
    }, cadence);
  };

  const trigger = () => {
    if (stopped || getAppState() !== 'active') return;
    if (inFlight !== null) {
      pendingWake = true;
      return;
    }
    pendingWake = false;
    inFlight = Promise.resolve()
      .then(() => replay())
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
        if (pendingWake && getAppState() === 'active') {
          trigger();
          return;
        }
        schedule();
      });
  };

  const subscription = subscribe((state) => {
    if (state === 'active') {
      clearTimer();
      trigger();
      return;
    }
    clearTimer();
  });

  if (getAppState() === 'active') trigger();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimer();
      subscription.remove();
    },
  };
}
