import type {
  IOSActiveForecast,
  IOSIntelligenceSnapshot,
} from './IOSIntelligenceApi';
import { normalizeTimestamp } from './smart-weather-day';

export const SMART_WEATHER_SNAPSHOT_SCHEMA = 'hermes.ios-intelligence.snapshot.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Invalid Smart Weather ${field}`);
  }
  return value;
}

export function normalizeForecast(value: unknown): IOSActiveForecast {
  if (!isRecord(value)) throw new TypeError('Invalid Smart Weather forecast');
  const nested = isRecord(value.data) ? value.data : {};
  const startsAt = value.starts_at ?? value.valid_from ?? nested.starts_at;
  const expiresAt = value.expires_at ?? value.valid_until ?? nested.expires_at;
  return {
    ...value,
    ...nested,
    data: nested,
    summary: typeof (nested.summary ?? nested.body ?? value.summary) === 'string'
      ? String(nested.summary ?? nested.body ?? value.summary)
      : undefined,
    starts_at: typeof startsAt === 'number' && Number.isFinite(startsAt)
      ? startsAt
      : undefined,
    expires_at: typeof expiresAt === 'number' && Number.isFinite(expiresAt)
      ? expiresAt
      : undefined,
  } as IOSActiveForecast;
}

export function isForecastActive(
  value: IOSActiveForecast,
  now = Date.now(),
): boolean {
  if (value.is_active === false) return false;
  if (
    typeof value.starts_at !== 'number'
    || !Number.isFinite(value.starts_at)
    || typeof value.expires_at !== 'number'
    || !Number.isFinite(value.expires_at)
  ) return false;
  const startsAt = normalizeTimestamp(value.starts_at);
  const expiresAt = normalizeTimestamp(value.expires_at);
  return startsAt <= now && now < expiresAt;
}

export function normalizeSnapshot(value: unknown): IOSIntelligenceSnapshot {
  if (!isRecord(value)) throw new TypeError('Invalid Smart Weather snapshot');
  if (value.schema_version !== SMART_WEATHER_SNAPSHOT_SCHEMA) {
    throw new TypeError('Unsupported Smart Weather snapshot schema');
  }
  if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
    throw new TypeError('Invalid Smart Weather date');
  }
  if (typeof value.timezone !== 'string' || !value.timezone.trim()) {
    throw new TypeError('Invalid Smart Weather timezone');
  }
  if (!Array.isArray(value.trajectory) || !Array.isArray(value.places)) {
    throw new TypeError('Invalid Smart Weather collections');
  }

  const trajectory = value.trajectory.map((entry, index) => {
    if (!isRecord(entry)) throw new TypeError(`Invalid trajectory entry ${index}`);
    const latitude = finiteNumber(entry.latitude, `trajectory[${index}].latitude`);
    const longitude = finiteNumber(entry.longitude, `trajectory[${index}].longitude`);
    const observedAt = finiteNumber(entry.observed_at, `trajectory[${index}].observed_at`);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new TypeError(`Invalid trajectory entry ${index}`);
    }
    return { ...entry, latitude, longitude, observed_at: observedAt };
  });

  const places = value.places.map((entry, index) => {
    if (!isRecord(entry)) throw new TypeError(`Invalid place entry ${index}`);
    const placeId = typeof entry.place_id === 'string' ? entry.place_id.trim() : '';
    const arrivedAt = finiteNumber(entry.arrived_at, `places[${index}].arrived_at`);
    if (!placeId) throw new TypeError(`Invalid place entry ${index}`);
    const latitude = entry.latitude == null
      ? null
      : finiteNumber(entry.latitude, `places[${index}].latitude`);
    const longitude = entry.longitude == null
      ? null
      : finiteNumber(entry.longitude, `places[${index}].longitude`);
    if (
      (latitude !== null && Math.abs(latitude) > 90)
      || (longitude !== null && Math.abs(longitude) > 180)
    ) throw new TypeError(`Invalid place entry ${index}`);
    return {
      ...entry,
      arrived_at: arrivedAt,
      latitude,
      longitude,
      name: typeof entry.name === 'string' ? entry.name : '',
      place_id: placeId,
    };
  });

  const rawForecasts = value.active_forecasts ?? value.active_forecast ?? [];
  if (!Array.isArray(rawForecasts)) {
    throw new TypeError('Invalid Smart Weather forecasts');
  }
  const forecasts = rawForecasts.map(normalizeForecast);
  return {
    ...value,
    active_forecast: forecasts,
    active_forecasts: forecasts,
    date: value.date,
    places,
    timezone: value.timezone,
    trajectory,
  } as IOSIntelligenceSnapshot;
}
