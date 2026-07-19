export function dayKey(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`;
}

export function timestampOverlapsLocalDay(
  arrivedAt: number,
  departedAt: number | null | undefined,
  dayKey: string,
): boolean {
  const [year, month, day] = dayKey.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return false;
  const start = new Date(year, month - 1, day).getTime();
  const end = new Date(year, month - 1, day + 1).getTime();
  const arrived = normalizeTimestamp(arrivedAt);
  const departed = departedAt === null || departedAt === undefined
    ? Number.POSITIVE_INFINITY
    : normalizeTimestamp(departedAt);
  return arrived < end && departed >= start;
}

export function normalizeTimestamp(value: number): number {
  return value < 10_000_000_000 ? value * 1000 : value;
}
