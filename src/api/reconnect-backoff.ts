const DEFAULT_BASE_MS = 1_500;
const DEFAULT_MAX_MS = 30_000;
const DEFAULT_JITTER = 0.2;

export function reconnectDelay(
  attempt: number,
  random = Math.random,
  baseMs = DEFAULT_BASE_MS,
  maxMs = DEFAULT_MAX_MS,
  jitterRatio = DEFAULT_JITTER,
): number {
  const exponent = Math.max(0, Math.min(20, Math.trunc(attempt)));
  const ceiling = Math.min(maxMs, baseMs * (2 ** exponent));
  const jitter = 1 - jitterRatio + random() * jitterRatio * 2;
  return Math.min(maxMs, Math.max(baseMs, Math.round(ceiling * jitter)));
}
