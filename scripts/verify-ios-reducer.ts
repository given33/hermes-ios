/**
 * Verify a real backend Hosted event stream through the iOS runtime reducer.
 *
 * Usage:
 *   pnpm tsx scripts/verify-ios-reducer.ts <events.json>
 *
 * The JSON file should contain:
 *   {
 *     "conversation_id": string,
 *     "turn_id": string,
 *     "status": "completed" | "failed" | "cancelled",
 *     "events": HostedLifecycleEvent[]
 *   }
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { HostedLifecycleEvent } from '../src/api/hosted-conversation-events';
import {
  reduceHostedRuntimeEvents,
} from '../src/api/hosted-runtime-reducer';

const inputPath = resolve(process.argv[2] ?? 'missing-events.json');
const payload = JSON.parse(readFileSync(inputPath, 'utf8')) as {
  conversation_id: string;
  turn_id: string;
  status: string;
  stage?: string;
  error?: string;
  event_count: number;
  events: HostedLifecycleEvent[];
};

const events = payload.events ?? [];
assert.ok(Array.isArray(events), 'events must be an array');
assert.ok(events.length > 0, 'events must not be empty');
assert.equal(payload.event_count, events.length, 'event_count mismatch');

const state = reduceHostedRuntimeEvents(undefined, events, {
  accountGeneration: events[0]?.account_generation || '',
});

const expectedTerminal = ['completed', 'failed', 'cancelled'].includes(payload.status);
assert.equal(
  state.terminal,
  expectedTerminal,
  `reducer terminal=${state.terminal} does not match backend status=${payload.status}`,
);

const finalTurn = state.trajectory.turns.find((turn) => turn.id === payload.turn_id);
assert.ok(finalTurn, `reducer did not project turn ${payload.turn_id}`);
if (payload.status === 'completed') {
  assert.equal(finalTurn.status, 'complete', 'completed backend turn must be complete in trajectory');
} else if (payload.status === 'failed') {
  assert.equal(finalTurn.status, 'error', 'failed backend turn must be error in trajectory');
} else if (payload.status === 'cancelled') {
  assert.equal(finalTurn.status, 'aborted', 'cancelled backend turn must be aborted in trajectory');
}

// Sanity: the reducer must not have left a gap unless the stream was truncated.
assert.equal(state.hasGap, false, 'reducer reports a gap for a complete event stream');

const componentEntries = Object.values(state.components);
for (const component of componentEntries) {
  assert.ok(
    ['declared', 'waiting', 'activating', 'active', 'quiescing', 'leaving', 'unloading', 'recovering', 'failed', 'completed', 'unknown'].includes(component.lifecycle),
    `invalid component lifecycle ${component.lifecycle}`,
  );
}

const secretPattern = /(api[_-]?key|apikey|access[_-]?token|authorization|bearer|password|secret)/i;
for (const record of state.trajectory.records) {
  assert.equal(
    secretPattern.test(JSON.stringify(record.metadata)),
    false,
    `trajectory metadata leaked sensitive data in event ${record.eventId}`,
  );
}

const summary = {
  conversation_id: payload.conversation_id,
  turn_id: payload.turn_id,
  backend_status: payload.status,
  backend_stage: payload.stage ?? '',
  backend_error: payload.error ?? '',
  event_count: events.length,
  reducer_terminal: state.terminal,
  last_cursor: state.lastCursor,
  has_gap: state.hasGap,
  reset_required: state.resetRequired,
  components: componentEntries.length,
  providers: Object.keys(state.providers).length,
  subagents: Object.keys(state.subagents).length,
  trajectory: {
    turns: state.trajectory.turns.length,
    records: state.trajectory.records.length,
    stats: state.trajectory.stats,
  },
};

console.log(JSON.stringify(summary, null, 2));
console.log('iOS reducer verification PASSED');
