import assert from 'node:assert/strict';
import test from 'node:test';

import type { HostedLifecycleEvent } from '../src/api/hosted-conversation-events';
import {
  reduceHostedRuntimeEvents,
} from '../src/api/hosted-runtime-reducer';

function event(
  cursor: number,
  eventType: string,
  runtime?: HostedLifecycleEvent['runtime'],
  payload: Record<string, unknown> = {},
): HostedLifecycleEvent {
  return {
    account_generation: 'generation-1',
    conversation_id: 'conversation-1',
    cursor,
    event_id: `event-${cursor}`,
    event_type: eventType,
    idempotency_key: `key-${cursor}`,
    occurred_at: cursor,
    payload,
    role_stage: 'worker',
    runtime,
    schema_version: 'hermes.hosted-event.v1',
    sequence: cursor,
    turn_id: 'turn-1',
  };
}

test('runtime reducer prefers structured component lifecycle and provider identity', () => {
  const active = event(2, 'component.active', {
    component_id: 'fiber:worker',
    parent_component_id: 'fiber:turn',
    provider_refs: ['connector:primary'],
    dependency_state: { 'mcp:search': 'satisfied' },
    lifecycle_state: 'active',
    effect_scope_id: 'scope:worker',
    plan_node_id: 'node:worker',
    artifact_refs: ['artifact:report'],
    contract_revision: 'plan:2',
    policy_snapshot_hash: 'policy:1',
  });
  const provider = event(3, 'provider.draining', active.runtime, {
    provider_id: 'connector:primary',
    status: 'draining',
    generation: 4,
  });
  const state = reduceHostedRuntimeEvents(undefined, [active, provider]);
  assert.equal(state.components['fiber:worker']?.lifecycle, 'active');
  assert.deepEqual(state.components['fiber:worker']?.providerRefs, ['connector:primary']);
  assert.equal(state.providers['connector:primary']?.status, 'draining');
  assert.equal(state.providers['connector:primary']?.generation, 4);
});

test('runtime reducer is idempotent for duplicate and stale events', () => {
  const initial = reduceHostedRuntimeEvents(undefined, [
    event(2, 'component.active', {
      component_id: 'fiber:worker',
      provider_refs: [],
      dependency_state: {},
      lifecycle_state: 'active',
      artifact_refs: [],
    }),
  ]);
  const next = reduceHostedRuntimeEvents(initial, [
    event(2, 'component.active', {
      component_id: 'fiber:worker',
      provider_refs: [],
      dependency_state: {},
      lifecycle_state: 'active',
      artifact_refs: [],
    }),
    event(1, 'component.failed', {
      component_id: 'fiber:worker',
      provider_refs: [],
      dependency_state: {},
      lifecycle_state: 'failed',
      artifact_refs: [],
    }),
  ]);
  assert.equal(next.components['fiber:worker']?.lifecycle, 'active');
  assert.equal(next.seenEventIds.length, 2);
  assert.equal(next.lastCursor, 2);
});

test('legacy role stage is only a marked compatibility component', () => {
  const state = reduceHostedRuntimeEvents(undefined, [event(1, 'message.delta')]);
  const component = state.components['legacy:turn-1:worker'];
  assert.equal(component?.legacy, true);
  assert.equal(component?.componentId, 'legacy:turn-1:worker');
});

test('runtime reducer resets stale projection when account generation changes', () => {
  const initial = reduceHostedRuntimeEvents(undefined, [event(1, 'component.active', {
    component_id: 'fiber:old',
    provider_refs: ['provider:old'],
    dependency_state: {},
    lifecycle_state: 'active',
    artifact_refs: [],
  })]);
  const next = reduceHostedRuntimeEvents(initial, [
    { ...event(1, 'component.active', {
      component_id: 'fiber:new',
      provider_refs: [],
      dependency_state: {},
      lifecycle_state: 'active',
      artifact_refs: [],
    }), account_generation: 'generation-2', event_id: 'new-event' },
  ], { accountGeneration: 'generation-2', reset: true });
  assert.equal(next.components['fiber:old'], undefined);
  assert.equal(next.components['fiber:new']?.lifecycle, 'active');
  assert.equal(next.resetRequired, true);
});

test('generation reset clears old event ids before applying the new generation', () => {
  const initial = reduceHostedRuntimeEvents(undefined, [event(1, 'component.active', {
    component_id: 'fiber:old',
    provider_refs: [],
    dependency_state: {},
    lifecycle_state: 'active',
    artifact_refs: [],
  })]);
  const next = reduceHostedRuntimeEvents(initial, [{
    ...event(1, 'component.active', {
      component_id: 'fiber:new',
      provider_refs: [],
      dependency_state: {},
      lifecycle_state: 'active',
      artifact_refs: [],
    }),
    account_generation: 'generation-2',
  }], { accountGeneration: 'generation-2', reset: true });
  assert.equal(next.components['fiber:new']?.lifecycle, 'active');
  assert.deepEqual(next.seenEventIds, ['event-1']);
});

test('runtime reducer records gap without fabricating lifecycle state', () => {
  const state = reduceHostedRuntimeEvents(undefined, [], { hasGap: true });
  const blocked = reduceHostedRuntimeEvents(state, [event(2, 'component.active', {
    component_id: 'fiber:blocked',
    provider_refs: [],
    dependency_state: {},
    lifecycle_state: 'active',
    artifact_refs: [],
  })]);
  assert.equal(blocked.hasGap, true);
  assert.equal(Object.keys(blocked.components).length, 0);
  const reset = reduceHostedRuntimeEvents(blocked, [event(3, 'component.active', {
    component_id: 'fiber:reset',
    provider_refs: [],
    dependency_state: {},
    lifecycle_state: 'active',
    artifact_refs: [],
  })], { reset: true });
  assert.equal(reset.components['fiber:reset']?.lifecycle, 'active');
});

test('runtime reducer ignores an illegal lifecycle regression', () => {
  const state = reduceHostedRuntimeEvents(undefined, [event(1, 'component.active', {
    component_id: 'fiber:worker',
    provider_refs: [],
    dependency_state: {},
    lifecycle_state: 'active',
    artifact_refs: [],
  })]);
  const next = reduceHostedRuntimeEvents(state, [event(2, 'component.activating', {
    component_id: 'fiber:worker',
    provider_refs: [],
    dependency_state: {},
    lifecycle_state: 'activating',
    artifact_refs: [],
  })]);
  assert.equal(next.components['fiber:worker']?.lifecycle, 'active');
  assert.equal(next.lastCursor, 2);
});

test('runtime reducer projects live subagent transcript and partial result', () => {
  const state = reduceHostedRuntimeEvents(undefined, [
    event(1, 'subagent.started', undefined, {
      subagent_id: 'worker-1',
      parent_id: 'turn-1',
      name: 'researcher',
      goal: 'Inspect the repository',
      model: 'deepseek-v4-flash',
      accepting_steer: true,
    }),
    event(2, 'subagent.progress', undefined, {
      subagent_id: 'worker-1',
      text: 'Reading the latest task log',
      running_seconds: 4,
    }),
    event(3, 'subagent.progress', undefined, {
      subagent_id: 'worker-1',
      partial_summary: 'Found two relevant modules',
    }),
  ]);
  const worker = state.subagents['worker-1'];
  assert.equal(worker?.status, 'running');
  assert.equal(worker?.goal, 'Inspect the repository');
  assert.equal(worker?.acceptingSteer, true);
  assert.equal(worker?.runningSeconds, 4);
  assert.deepEqual(worker?.transcript.map((entry) => entry.text), [
    'Reading the latest task log',
    'Found two relevant modules',
  ]);
  assert.equal(worker?.partialResult, 'Found two relevant modules');
  assert.equal(worker?.terminal, false);
});

test('runtime reducer keeps subagent controls visible until the worker settles', () => {
  const controlled = reduceHostedRuntimeEvents(undefined, [
    event(1, 'subagent.started', undefined, {
      subagent_id: 'worker-1',
      accepting_steer: true,
    }),
    event(2, 'subagent.progress', undefined, {
      subagent_id: 'worker-1',
      control_action: 'steer',
      control_status: 'queued',
      text: 'Steer queued for the next tool boundary',
    }),
    event(3, 'subagent.progress', undefined, {
      subagent_id: 'worker-1',
      control_action: 'stop',
      text: 'Stop requested',
    }),
  ]);
  const stopping = controlled.subagents['worker-1'];
  assert.equal(stopping?.status, 'stopping');
  assert.equal(stopping?.controlStatus, 'stop_requested');
  assert.equal(stopping?.terminal, false);

  const settled = reduceHostedRuntimeEvents(controlled, [
    event(4, 'subagent.completed', undefined, {
      subagent_id: 'worker-1',
      status: 'cancelled',
      partial_result: 'Recovered partial output',
      accepting_steer: false,
    }),
  ]);
  const worker = settled.subagents['worker-1'];
  assert.equal(worker?.status, 'cancelled');
  assert.equal(worker?.partialResult, 'Recovered partial output');
  assert.equal(worker?.acceptingSteer, false);
  assert.equal(worker?.terminal, true);
});

test('runtime reducer ignores stale subagent events and bounds transcript memory', () => {
  const events = [
    event(5, 'subagent.progress', undefined, {
      subagent_id: 'worker-1',
      text: 'newer',
    }),
    event(4, 'subagent.started', undefined, {
      subagent_id: 'worker-1',
      text: 'stale',
    }),
    ...Array.from({ length: 85 }, (_, index) => event(
      6 + index,
      'subagent.progress',
      undefined,
      { subagent_id: 'worker-1', text: `line-${index}` },
    )),
  ];
  const state = reduceHostedRuntimeEvents(undefined, events);
  const worker = state.subagents['worker-1'];
  assert.equal(worker?.transcript.length, 80);
  assert.equal(worker?.transcript[0]?.text, 'line-5');
  assert.equal(worker?.transcript.at(-1)?.text, 'line-84');
  assert.equal(worker?.lastCursor, 90);
  assert.equal(worker?.status, 'running');
});

test('generation reset clears subagent projections along with runtime state', () => {
  const initial = reduceHostedRuntimeEvents(undefined, [event(1, 'subagent.started', undefined, {
    subagent_id: 'worker-old',
  })]);
  const next = reduceHostedRuntimeEvents(initial, [{
    ...event(1, 'subagent.started', undefined, { subagent_id: 'worker-new' }),
    account_generation: 'generation-2',
    event_id: 'new-generation-event',
  }], { accountGeneration: 'generation-2', reset: true });
  assert.equal(next.subagents['worker-old'], undefined);
  assert.equal(next.subagents['worker-new']?.status, 'running');
  assert.equal(next.resetRequired, true);
});

test('runtime reducer exposes a bounded trajectory for the user-facing viewer', () => {
  const runtime = {
    component_id: 'fiber:worker',
    provider_refs: [{ provider: 'connector:primary', apiKey: 'nested-secret' }],
    dependency_state: {},
    lifecycle_state: 'active',
    artifact_refs: [],
  } as unknown as HostedLifecycleEvent['runtime'];
  const state = reduceHostedRuntimeEvents(undefined, [
    event(1, 'turn.started', undefined, { model: 'deepseek-v4-flash' }),
    event(2, 'tool.started', runtime, { tool_name: 'shell', text: 'apiKey=nested-secret' }),
    event(3, 'tool.completed', undefined, { tool_name: 'shell', duration_ms: 12 }),
    event(4, 'subagent.started', undefined, { subagent_id: 'worker-1', summary: 'worker started' }),
    event(5, 'turn.completed'),
  ]);
  assert.equal(state.trajectory.schemaVersion, 1);
  assert.equal(state.trajectory.stats.toolCalls, 1);
  assert.equal(state.trajectory.stats.subagents, 1);
  assert.equal(state.trajectory.turns[0]?.status, 'complete');
  assert.equal(state.trajectory.records[1]?.summary, '[REDACTED]');
  assert.equal(state.trajectory.records[1]?.metadata.tool_name, 'shell');
  assert.equal(JSON.stringify(state.trajectory.records[1]?.metadata).includes('nested-secret'), false);
});
