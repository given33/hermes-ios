export function predictedDepartureTimestamp(
  payload: Record<string, unknown>,
): number | null {
  const value = Object.prototype.hasOwnProperty.call(payload, 'timestamp')
    ? payload.timestamp
    : payload.departureAt ?? payload.departure_at;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error('timestamp is required');
}
