import type { HostedLifecycleEvent, HostedRuntimeMetadata } from './hosted-conversation-events';
import type {
  HostedComponentLifecycle,
  HostedComponentProjection,
  HostedProviderProjection,
  HostedProviderStatus,
  HostedRuntimeProjection,
  HostedSubagentProjection,
  HostedSubagentStatus,
  HostedTrajectoryProjection,
  HostedTrajectoryRecordKind,
  HostedTrajectoryRecordStatus,
} from './hosted-runtime-types';

export type {
  HostedComponentLifecycle,
  HostedComponentProjection,
  HostedProviderProjection,
  HostedProviderStatus,
  HostedRuntimeProjection,
  HostedSubagentProjection,
  HostedSubagentStatus,
  HostedTrajectoryProjection,
  HostedTrajectoryRecord,
  HostedTrajectoryTurn,
} from './hosted-runtime-types';

export function emptyHostedRuntimeProjection(
  turnId = '',
  accountGeneration = '',
): HostedRuntimeProjection {
  return {
    turnId,
    accountGeneration,
    components: {},
    providers: {},
    subagents: {},
    trajectory: emptyHostedTrajectoryProjection(),
    seenEventIds: [],
    lastCursor: 0,
    terminal: false,
    hasGap: false,
    resetRequired: false,
  };
}

export function reduceHostedRuntimeEvents(
  previous: HostedRuntimeProjection | undefined,
  events: readonly HostedLifecycleEvent[],
  options: { hasGap?: boolean; reset?: boolean; accountGeneration?: string } = {},
): HostedRuntimeProjection {
  const state: HostedRuntimeProjection = previous
    ? {
      ...previous,
      components: { ...previous.components },
      providers: { ...previous.providers },
      subagents: { ...(previous.subagents || {}) },
      trajectory: cloneTrajectory(previous.trajectory),
      seenEventIds: [...previous.seenEventIds],
    }
    : emptyHostedRuntimeProjection(
      events[0]?.turn_id || '',
      events[0]?.account_generation || '',
    );
  const generationChanged = Boolean(
    options.accountGeneration
    && state.accountGeneration
    && options.accountGeneration !== state.accountGeneration,
  );
  const authoritativeReset = Boolean(options.reset || generationChanged);
  if (authoritativeReset) {
    state.components = {};
    state.providers = {};
    state.subagents = {};
    state.trajectory = emptyHostedTrajectoryProjection();
    state.seenEventIds = [];
    state.lastCursor = 0;
    state.terminal = false;
    state.hasGap = false;
    state.resetRequired = true;
    if (options.accountGeneration) state.accountGeneration = options.accountGeneration;
  } else {
    state.hasGap = Boolean(state.hasGap || options.hasGap);
    state.resetRequired = Boolean(state.resetRequired);
  }
  const seen = new Set(state.seenEventIds);
  // A gap invalidates incremental state. Do not apply subsequent deltas until
  // the caller provides an authoritative reset/snapshot.
  if (state.hasGap && !authoritativeReset) {
    return state;
  }
  const ordered = [...events].sort((left, right) => left.cursor - right.cursor);
  for (const event of ordered) {
    if (seen.has(event.event_id)) continue;
    if (state.turnId && event.turn_id !== state.turnId) continue;
    if (state.accountGeneration && event.account_generation !== state.accountGeneration) continue;
    if (!state.accountGeneration) state.accountGeneration = event.account_generation;
    const subagent = subagentProjectionFor(state, event);
    if (subagent) {
      state.subagents[subagent.subagentId] = subagent;
    } else {
      const component = componentProjectionFor(state, event);
      state.components[component.componentId] = component;
    }
    applyProviderProjection(state, event);
    applyTrajectoryProjection(state, event);
    seen.add(event.event_id);
    state.lastCursor = Math.max(state.lastCursor, event.cursor);
    if (event.event_type === 'turn.completed'
      || event.event_type === 'turn.cancelled'
      || event.event_type === 'turn.failed') {
      state.terminal = true;
    }
  }
  state.seenEventIds = [...seen].slice(-2048);
  return state;
}

function emptyHostedTrajectoryProjection(): HostedTrajectoryProjection {
  return {
    schemaVersion: 1,
    detailLevel: 'summary',
    records: [],
    turns: [],
    stats: {
      turns: 0,
      records: 0,
      toolCalls: 0,
      failedTools: 0,
      subagents: 0,
      compactions: 0,
    },
  };
}

function cloneTrajectory(
  value: HostedTrajectoryProjection | undefined,
): HostedTrajectoryProjection {
  if (!value) return emptyHostedTrajectoryProjection();
  return {
    ...value,
    records: [...value.records],
    turns: value.turns.map((turn) => ({ ...turn })),
    stats: { ...value.stats },
  };
}

function applyTrajectoryProjection(
  state: HostedRuntimeProjection,
  event: HostedLifecycleEvent,
): void {
  const eventType = event.event_type.toLowerCase();
  if (eventType === 'token_count') return;
  const payload = event.payload;
  const turnId = stringValue(event.turn_id) || 'turn-unknown';
  let turn = state.trajectory.turns.find((item) => item.id === turnId);
  if (!turn) {
    turn = {
      index: state.trajectory.turns.length + 1,
      id: turnId,
      status: 'running',
      records: 0,
      steps: 0,
      startedAt: event.occurred_at,
    };
    state.trajectory.turns.push(turn);
    state.trajectory.stats.turns = state.trajectory.turns.length;
  }
  if (eventType === 'turn.completed') {
    turn.status = 'complete';
    turn.completedAt = event.occurred_at;
  } else if (eventType === 'turn.failed') {
    turn.status = 'error';
    turn.completedAt = event.occurred_at;
  } else if (eventType === 'turn.cancelled') {
    turn.status = 'aborted';
    turn.completedAt = event.occurred_at;
  }
  const kind = trajectoryKind(eventType, payload);
  const status = trajectoryStatus(eventType, payload);
  const index = state.trajectory.stats.records + 1;
  const record = {
    index,
    eventId: event.event_id,
    cursor: event.cursor,
    turn: turn.index,
    step: eventType.endsWith('.delta') || eventType.endsWith('.progress') ? index : undefined,
    kind,
    event: eventType,
    summary: trajectorySummary(eventType, payload),
    occurredAt: event.occurred_at,
    durationMs: numberValue(payload.duration_ms) || undefined,
    status,
    callId: stringValue(payload.call_id) || stringValue(payload.tool_call_id) || undefined,
    metadata: trajectoryMetadata(event, payload),
  };
  state.trajectory.records = [...state.trajectory.records, record].slice(-500);
  state.trajectory.stats.records = index;
  turn.records += 1;
  turn.steps = Math.max(turn.steps, record.step || 0);
  if (kind === 'tool') {
    if (eventType.endsWith('.started')) state.trajectory.stats.toolCalls += 1;
    state.trajectory.stats.failedTools += status === 'error' ? 1 : 0;
  }
  if (kind === 'subagent' && (eventType === 'subagent.started' || eventType === 'subagent.queued')) {
    state.trajectory.stats.subagents += 1;
  }
  if (kind === 'compaction') state.trajectory.stats.compactions += 1;
}

function trajectoryKind(
  eventType: string,
  payload: Record<string, unknown>,
): HostedTrajectoryRecordKind {
  if (eventType.startsWith('tool.') || eventType.startsWith('command.')) return 'tool';
  if (eventType.startsWith('subagent.')) return 'subagent';
  if (eventType.startsWith('thinking.') || eventType.startsWith('reasoning.')) return 'reasoning';
  if (eventType.startsWith('compaction.') || eventType === 'context.compacted') return 'compaction';
  if (eventType.startsWith('message.') && stringValue(payload.role).toLowerCase() === 'user') return 'user';
  return 'assistant';
}

function trajectoryStatus(
  eventType: string,
  payload: Record<string, unknown>,
): HostedTrajectoryRecordStatus {
  const raw = stringValue(payload.status).toLowerCase();
  if (eventType.endsWith('.failed') || payload.error || raw === 'error' || raw === 'failed') return 'error';
  if (eventType.endsWith('.cancelled') || ['aborted', 'cancelled', 'stopped'].includes(raw)) return 'aborted';
  if (eventType.endsWith('.started') || eventType.endsWith('.progress') || eventType.endsWith('.delta')) return 'running';
  return 'complete';
}

function trajectorySummary(eventType: string, payload: Record<string, unknown>): string {
  for (const key of ['summary', 'preview', 'text', 'partial_summary', 'partial_result', 'name', 'tool_name']) {
    const value = stringValue(payload[key]);
    if (value) return redactTrajectoryText(value).slice(0, 220);
  }
  return eventType.replaceAll('.', ' / ');
}

function trajectoryMetadata(
  event: HostedLifecycleEvent,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (event.runtime) {
    for (const key of [
      'component_id', 'parent_component_id', 'provider_refs', 'dependency_state',
      'lifecycle_state', 'effect_scope_id', 'plan_node_id', 'artifact_refs',
      'contract_revision', 'policy_snapshot_hash',
    ]) {
      if (event.runtime[key as keyof typeof event.runtime] !== undefined) {
        metadata[key] = sanitizeTrajectoryValue(event.runtime[key as keyof typeof event.runtime], 0, key);
      }
    }
  }
  for (const key of ['tool_name', 'name', 'status', 'duration_ms', 'call_id', 'tool_call_id']) {
    if (payload[key] !== undefined && (typeof payload[key] === 'string' || typeof payload[key] === 'number')) {
      metadata[key] = typeof payload[key] === 'string'
        ? redactTrajectoryText(payload[key])
        : payload[key];
    }
  }
  return metadata;
}

function redactTrajectoryText(value: string): string {
  return value.replace(/\b(?:bearer\s+[A-Za-z0-9._~+/=-]+|(?:api[_-]?key|apikey|access[_-]?token|accesstoken|refresh[_-]?token|authorization|cookie|password|secret)\s*[:=]\s*[^\s,;]+)/gi, '[REDACTED]');
}

function sanitizeTrajectoryValue(value: unknown, depth: number, key: string): unknown {
  if (/(?:api[_-]?key|apikey|access[_-]?token|accesstoken|refresh[_-]?token|authorization|cookie|password|secret)/i.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') return redactTrajectoryText(value).slice(0, 1200);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 3) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 24).map((item) => sanitizeTrajectoryValue(item, depth + 1, ''));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 24).map(([childKey, childValue]) => [
        childKey.slice(0, 80),
        sanitizeTrajectoryValue(childValue, depth + 1, childKey),
      ]),
    );
  }
  return undefined;
}

function subagentProjectionFor(
  state: HostedRuntimeProjection,
  event: HostedLifecycleEvent,
): HostedSubagentProjection | undefined {
  if (!event.event_type.startsWith('subagent.')) return undefined;
  const payload = event.payload;
  const subagentId = stringValue(event.entity_id)
    || stringValue(payload.subagent_id)
    || stringValue(payload.child_session_id);
  if (!subagentId) return undefined;
  const current = state.subagents[subagentId];
  if (current && event.cursor < current.lastCursor) return current;
  const sourceType = stringValue(payload.source_event_type).toLowerCase();
  const controlAction = stringValue(payload.control_action).toLowerCase();
  const controlStatus = stringValue(payload.control_status).toLowerCase();
  const rawStatus = stringValue(payload.status).toLowerCase();
  let status: HostedSubagentStatus = current?.status || 'unknown';
  if (controlAction === 'steer' && controlStatus === 'queued') status = 'steering';
  else if (controlAction === 'stop') status = 'stopping';
  else if (event.event_type === 'subagent.queued') status = 'queued';
  else if (event.event_type === 'subagent.started') status = 'running';
  else if (event.event_type === 'subagent.failed') status = 'failed';
  else if (event.event_type === 'subagent.completed') {
    status = rawStatus === 'cancelled' || rawStatus === 'interrupted'
      ? 'cancelled'
      : rawStatus === 'failed' || rawStatus === 'error'
        ? 'failed'
        : 'completed';
  } else if (sourceType.startsWith('subagent.') || event.event_type === 'subagent.progress') {
    status = status === 'steering' || status === 'stopping' ? status : 'running';
  }
  const text = subagentEventText(payload);
  const transcript = current ? [...current.transcript] : [];
  if (text && (!current || current.lastEventId !== event.event_id)) {
    transcript.push({
      eventId: event.event_id,
      cursor: event.cursor,
      occurredAt: event.occurred_at,
      kind: sourceType || event.event_type,
      text: text.slice(0, 1600),
    });
  }
  const boundedTranscript = transcript.slice(-80);
  const partialResult = stringValue(
    payload.partial_result || payload.partial_summary || payload.summary || payload.result,
  );
  const terminal = status === 'completed' || status === 'failed' || status === 'cancelled';
  return {
    subagentId,
    parentId: stringValue(payload.parent_id) || current?.parentId,
    name: stringValue(payload.name) || current?.name,
    goal: stringValue(payload.goal) || current?.goal,
    model: stringValue(payload.model) || current?.model,
    profile: stringValue(payload.profile) || current?.profile,
    status,
    runningSeconds: numberValue(payload.running_seconds) ?? current?.runningSeconds,
    acceptingSteer: typeof payload.accepting_steer === 'boolean'
      ? payload.accepting_steer
      : current?.acceptingSteer ?? !terminal,
    transcript: boundedTranscript,
    transcriptCursor: event.cursor,
    partialResult: partialResult || current?.partialResult,
    controlStatus: controlAction === 'steer'
      ? 'steer_queued'
      : controlAction === 'stop'
        ? 'stop_requested'
        : current?.controlStatus || 'none',
    lastCursor: event.cursor,
    lastEventId: event.event_id,
    terminal,
  };
}

function subagentEventText(payload: Record<string, unknown>): string {
  for (const key of ['text', 'preview', 'summary', 'partial_result', 'partial_summary', 'result']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function componentProjectionFor(
  state: HostedRuntimeProjection,
  event: HostedLifecycleEvent,
): HostedComponentProjection {
  const runtime = event.runtime;
  const legacy = !runtime;
  const componentId = runtime?.component_id
    || `legacy:${event.turn_id}:${legacyRoleStage(event.role_stage)}`;
  const current = state.components[componentId];
  if (current && event.cursor < current.lastCursor) return current;
  const lifecycle = lifecycleFor(event, runtime, current?.lifecycle || 'unknown');
  if (current && !lifecycleTransitionAllowed(current.lifecycle, lifecycle)) {
    return current;
  }
  return {
    componentId,
    parentComponentId: runtime?.parent_component_id || current?.parentComponentId,
    roleStage: event.role_stage,
    lifecycle,
    providerRefs: runtime?.provider_refs || current?.providerRefs || [],
    dependencyState: runtime?.dependency_state || current?.dependencyState || {},
    effectScopeId: runtime?.effect_scope_id || current?.effectScopeId,
    planNodeId: runtime?.plan_node_id || current?.planNodeId,
    artifactRefs: runtime?.artifact_refs || current?.artifactRefs || [],
    contractRevision: runtime?.contract_revision || current?.contractRevision,
    policySnapshotHash: runtime?.policy_snapshot_hash || current?.policySnapshotHash,
    lastCursor: event.cursor,
    lastEventId: event.event_id,
    legacy: legacy || Boolean(current?.legacy),
    terminal: lifecycle === 'completed' || lifecycle === 'failed',
  };
}

function lifecycleFor(
  event: HostedLifecycleEvent,
  runtime: HostedRuntimeMetadata | undefined,
  fallback: HostedComponentLifecycle,
): HostedComponentLifecycle {
  const explicit = String(runtime?.lifecycle_state || '').trim().toLowerCase();
  if (isLifecycle(explicit)) return explicit;
  const eventType = event.event_type.toLowerCase();
  if (eventType === 'component.declared') return 'declared';
  if (eventType === 'component.waiting' || eventType === 'dependency.waiting') return 'waiting';
  if (eventType === 'component.activating') return 'activating';
  if (eventType === 'component.active' || eventType === 'dependency.satisfied') return 'active';
  if (eventType === 'component.quiescing') return 'quiescing';
  if (eventType === 'component.leaving') return 'leaving';
  if (eventType === 'component.unloading') return 'unloading';
  if (eventType === 'component.recovering') return 'recovering';
  if (eventType === 'component.failed' || eventType.endsWith('.failed')) return 'failed';
  if (eventType === 'component.completed' || eventType.endsWith('.completed')) return 'completed';
  if (eventType === 'provider.draining') return 'quiescing';
  return fallback;
}

function applyProviderProjection(
  state: HostedRuntimeProjection,
  event: HostedLifecycleEvent,
): void {
  const payload = event.payload;
  const runtimeRefs = event.runtime?.provider_refs || [];
  const providerId = stringValue(payload.provider_id)
    || stringValue(payload.provider_ref)
    || (runtimeRefs.length === 1 ? runtimeRefs[0] : '');
  if (!providerId) return;
  const rawStatus = stringValue(payload.status)
    || (event.event_type === 'provider.registered' ? 'active' : '')
    || (event.event_type === 'provider.draining' ? 'draining' : '')
    || (event.event_type === 'provider.removed' ? 'removed' : '');
  const status = isProviderStatus(rawStatus) ? rawStatus : 'unknown';
  const current = state.providers[providerId];
  if (current && event.cursor < current.lastCursor) return;
  state.providers[providerId] = {
    providerId,
    status,
    health: stringValue(payload.health) || current?.health,
    generation: numberValue(payload.generation) ?? current?.generation,
    lastCursor: event.cursor,
  };
}

function legacyRoleStage(value: string): string {
  return value.split(/[.:/]/, 1)[0].trim().toLowerCase() || 'chat';
}

function isLifecycle(value: string): value is HostedComponentLifecycle {
  return [
    'declared', 'waiting', 'activating', 'active', 'quiescing',
    'leaving', 'unloading', 'recovering', 'failed', 'completed', 'unknown',
  ].includes(value);
}

function lifecycleTransitionAllowed(
  previous: HostedComponentLifecycle,
  current: HostedComponentLifecycle,
): boolean {
  const transitions: Record<HostedComponentLifecycle, readonly HostedComponentLifecycle[]> = {
    unknown: ['unknown', 'declared', 'waiting', 'activating', 'active', 'quiescing', 'leaving', 'unloading', 'recovering', 'failed', 'completed'],
    declared: ['declared', 'waiting', 'activating', 'failed', 'leaving'],
    waiting: ['waiting', 'activating', 'failed', 'leaving'],
    activating: ['activating', 'active', 'waiting', 'failed', 'leaving'],
    active: ['active', 'quiescing', 'leaving', 'recovering', 'completed', 'failed'],
    quiescing: ['quiescing', 'active', 'leaving', 'unloading', 'failed'],
    leaving: ['leaving', 'unloading', 'completed', 'failed'],
    unloading: ['unloading', 'completed', 'failed'],
    recovering: ['recovering', 'activating', 'active', 'failed', 'completed'],
    failed: ['failed'],
    completed: ['completed'],
  };
  return transitions[previous].includes(current);
}

function isProviderStatus(value: string): value is HostedProviderProjection['status'] {
  return ['registering', 'active', 'draining', 'unhealthy', 'removed', 'unknown'].includes(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
