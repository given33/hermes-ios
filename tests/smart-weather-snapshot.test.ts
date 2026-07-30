import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isForecastActive,
  normalizeSnapshot,
  SMART_WEATHER_SNAPSHOT_SCHEMA,
} from '../src/context/smart-weather-snapshot';

const snapshot = {
  schema_version: SMART_WEATHER_SNAPSHOT_SCHEMA,
  date: '2026-07-30',
  timezone: 'Asia/Shanghai',
  trajectory: [],
  places: [],
  active_forecasts: [],
};

test('smart weather rejects malformed successful snapshots', () => {
  assert.throws(() => normalizeSnapshot('<html>ok</html>'), /Invalid Smart Weather snapshot/);
  assert.throws(
    () => normalizeSnapshot({ ...snapshot, schema_version: 'legacy' }),
    /Unsupported Smart Weather snapshot schema/,
  );
  assert.throws(
    () => normalizeSnapshot({ ...snapshot, trajectory: 'not-an-array' }),
    /Invalid Smart Weather collections/,
  );
  assert.throws(
    () => normalizeSnapshot({
      ...snapshot,
      trajectory: [{ latitude: '31.2', longitude: 121.4, observed_at: 1 }],
    }),
    /trajectory\[0\]\.latitude/,
  );
});

test('smart weather forecast activity uses a complete half-open window', () => {
  const now = 2_000_000_000_000;
  assert.equal(isForecastActive({ starts_at: now, expires_at: now + 1 }, now), true);
  assert.equal(isForecastActive({ starts_at: now + 1, expires_at: now + 2 }, now), false);
  assert.equal(isForecastActive({ starts_at: now - 1, expires_at: now }, now), false);
  assert.equal(isForecastActive({ starts_at: now - 1 }, now), false);
  assert.equal(isForecastActive({ expires_at: now + 1 }, now), false);
  assert.equal(
    isForecastActive({ starts_at: now - 1, expires_at: now + 1, is_active: false }, now),
    false,
  );
});

test('smart weather normalizes valid forecasts without coercing bad field types', () => {
  const normalized = normalizeSnapshot({
    ...snapshot,
    active_forecasts: [{
      id: 'rain',
      valid_from: 100,
      valid_until: 200,
      data: { summary: 'Rain' },
    }],
  });
  assert.equal(normalized.active_forecasts?.[0]?.starts_at, 100);
  assert.equal(normalized.active_forecasts?.[0]?.expires_at, 200);
  assert.equal(normalized.active_forecasts?.[0]?.summary, 'Rain');
});
