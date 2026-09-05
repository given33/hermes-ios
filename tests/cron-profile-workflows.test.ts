import assert from 'node:assert/strict';
import test from 'node:test';
import type { HermesCloudApi } from '../src/api/HermesCloudApi';
import { performHermesSwiftUIRouteAction } from '../src/app/hermes-route-data';
import { cronSnapshot } from '../src/app/route-snapshots/management';
import { routeLocalizer } from '../src/app/route-snapshots/support';

test('official cron records preserve editable text, owner, delivery, schedule and last run', () => {
  const rows = cronSnapshot([
    { id: 'shared', profile: 'first', name: 'Daily summary', prompt: 'Search', deliver: 'telegram',
      schedule: { kind: 'cron', expr: '0 9 * * *' }, last_run_at: '2026-09-05T00:00:00Z' },
    { id: 'shared', profile: 'second', schedule: { kind: 'interval', minutes: 30 }, paused: true },
    { id: 'once', schedule: { kind: 'once', run_at: '2026-09-06T12:00:00Z' } },
  ], routeLocalizer('zh'));
  assert.equal(rows[0].name, 'Daily summary');
  assert.equal(rows[0].prompt, 'Search');
  assert.equal(rows[0].deliver, 'telegram');
  assert.equal(rows[0].profile, 'first');
  assert.notEqual(rows[0].lastRun, '-');
  assert.deepEqual(rows.map((row) => row.schedule), ['0 9 * * *', 'every 30m', '2026-09-06T12:00:00Z']);
  assert.equal(rows[1].profile, 'second');
  assert.equal(rows[1].enabled, false);
});

test('cron management sends the task profile and selected delivery through existing APIs', async () => {
  const calls: unknown[] = [];
  const api = {
    createCronJob: async (...args: unknown[]) => { calls.push(['create', ...args]); },
    updateCronJob: async (...args: unknown[]) => { calls.push(['update', ...args]); },
    setCronJobPaused: async (...args: unknown[]) => { calls.push(['pause', ...args]); },
    triggerCronJob: async (...args: unknown[]) => { calls.push(['run', ...args]); },
    deleteCronJob: async (...args: unknown[]) => { calls.push(['delete', ...args]); },
  } as unknown as HermesCloudApi;
  const payload = { route: 'cron', id: 'shared', fields: { profile: 'second' } };
  await performHermesSwiftUIRouteAction(api, { action: 'cron.create', payload: {
    route: 'cron', name: 'Digest', detail: 'Summarize', fields: { profile: 'second', schedule: 'every 30m', deliver: 'telegram' },
  } }, 'first');
  await performHermesSwiftUIRouteAction(api, { action: 'cron.update', payload: {
    ...payload, detail: JSON.stringify({ deliver: 'local', prompt: 'Keep literal prompt' }),
  } }, 'first');
  await performHermesSwiftUIRouteAction(api, { action: 'cron.toggle', payload: { ...payload, enabled: false } }, 'first');
  await performHermesSwiftUIRouteAction(api, { action: 'cron.run', payload }, 'first');
  await performHermesSwiftUIRouteAction(api, { action: 'cron.delete', payload }, 'first');
  assert.deepEqual(calls, [
    ['create', { name: 'Digest', prompt: 'Summarize', schedule: 'every 30m', enabled: true, deliver: 'telegram' }, 'second'],
    ['update', 'shared', { deliver: 'local', prompt: 'Keep literal prompt' }, 'second'],
    ['pause', 'shared', true, 'second'],
    ['run', 'shared', 'second'],
    ['delete', 'shared', 'second'],
  ]);
});
