import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dayKey,
  timestampOverlapsLocalDay,
} from '../src/context/smart-weather-day';

test('smart weather includes a visit that overlaps local midnight', () => {
  const arrived = new Date(2026, 6, 17, 23, 51).getTime();
  const departed = new Date(2026, 6, 18, 0, 6).getTime();

  assert.equal(dayKey(new Date(2026, 6, 18, 12)), '2026-7-18');
  assert.equal(timestampOverlapsLocalDay(arrived, departed, '2026-7-18'), true);
  assert.equal(timestampOverlapsLocalDay(arrived / 1000, departed / 1000, '2026-7-18'), true);
  assert.equal(timestampOverlapsLocalDay(arrived, departed, '2026-7-19'), false);
});

test('smart weather includes an open visit and excludes a completed earlier visit', () => {
  const arrived = new Date(2026, 6, 17, 23, 51).getTime();
  const earlierDeparture = new Date(2026, 6, 17, 23, 59, 59).getTime();

  assert.equal(timestampOverlapsLocalDay(arrived, undefined, '2026-7-18'), true);
  assert.equal(timestampOverlapsLocalDay(arrived, earlierDeparture, '2026-7-18'), false);
});
