import { HermesApiError, type HermesApiClient } from '../HermesApiClient';
import {
  isRecord,
  numberValue,
  stringValue,
  type HermesStudioWorkflowRecord,
  type HermesStudioWorkflowExportEnvelope,
  type HermesStudioWorkflowImportPreview,
  type HermesStudioWorkflowRunNodeSession,
  type HermesStudioWorkflowRunEdgeEvaluation,
  type HermesStudioWorkflowRunLoopEpoch,
  type HermesStudioWorkflowRunRecord,
  type HermesStudioWorkflowRunStatus,
  type HermesStudioWorkflowScheduleRecord,
  type HermesStudioWorkflowScheduleInput,
  type HermesStudioWorkflowViewport,
} from './types';

export interface HermesStudioWorkflowCreateInput {
  name: string;
  profile?: string | null;
  workspace?: string | null;
  nodes?: unknown[];
  edges?: unknown[];
  viewport?: HermesStudioWorkflowViewport;
}

export interface HermesStudioWorkflowUpdateInput {
  name?: string;
  workspace?: string | null;
  nodes?: unknown[];
  edges?: unknown[];
  viewport?: HermesStudioWorkflowViewport;
}

export type HermesStudioWorkflowCapability =
  | { available: true; workflows: HermesStudioWorkflowRecord[] }
  | { available: false; workflows: [] };

/** Native client wrapper for Hermes Studio's workflow contract. */
export class HermesStudioWorkflowsApi {
  constructor(private readonly client: HermesApiClient) {}

  /**
   * Probe the optional external Studio service without turning an expected
   * 404/405 into a generic transport failure. The bundled Hermes workflow
   * plugin uses a different contract and is surfaced by the native route.
   */
  async probe(profile?: string | null): Promise<HermesStudioWorkflowCapability> {
    try {
      return { available: true, workflows: await this.list(profile) };
    } catch (reason) {
      if (reason instanceof HermesApiError && (reason.status === 404 || reason.status === 405)) {
        return { available: false, workflows: [] };
      }
      throw reason;
    }
  }

  async list(profile?: string | null): Promise<HermesStudioWorkflowRecord[]> {
    const response = await this.client.request<{ workflows?: unknown[] }>('/api/hermes/workflows', {
      query: profile ? { profile } : undefined,
    });
    return (Array.isArray(response.workflows) ? response.workflows : [])
      .map(normalizeWorkflow)
      .filter((workflow): workflow is HermesStudioWorkflowRecord => workflow !== null);
  }

  get(id: string) {
    return this.client.request<{ workflow: unknown }>(
      `/api/hermes/workflows/${encodeURIComponent(id)}`,
    ).then((response) => requiredWorkflow(response.workflow));
  }

  create(input: HermesStudioWorkflowCreateInput) {
    return this.client.request<{ workflow: unknown }>('/api/hermes/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((response) => requiredWorkflow(response.workflow));
  }

  update(id: string, input: HermesStudioWorkflowUpdateInput) {
    return this.client.request<{ workflow: unknown }>(
      `/api/hermes/workflows/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => requiredWorkflow(response.workflow));
  }

  async delete(id: string): Promise<void> {
    await this.client.request(`/api/hermes/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  batchDelete(ids: string[]) {
    return this.client.request<{ deleted: number; failed: number; errors: Array<{ id: string; error: string }> }>(
      '/api/hermes/workflows/batch-delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      },
    );
  }

  export(id: string) {
    return this.client.request<HermesStudioWorkflowExportEnvelope>(
      `/api/hermes/workflows/${encodeURIComponent(id)}/export`,
    );
  }

  previewImport(document: string, importProfile?: string | null) {
    return this.client.request<{ ok: true; preview: HermesStudioWorkflowImportPreview }>(
      '/api/hermes/workflows/import/preview',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, profile: importProfile }),
      },
    ).then((response) => response.preview);
  }

  cancelImport(token: string, importProfile?: string | null): Promise<void> {
    return this.client.request('/api/hermes/workflows/import/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, profile: importProfile }),
    }).then(() => undefined);
  }

  confirmImport(token: string, importProfile?: string | null) {
    return this.client.request<{ ok: true; workflow: unknown }>('/api/hermes/workflows/import/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, profile: importProfile }),
    }).then((response) => requiredWorkflow(response.workflow));
  }

  async listRuns(id: string, limit = 100): Promise<HermesStudioWorkflowRunRecord[]> {
    const response = await this.client.request<{ runs?: unknown[] }>(
      `/api/hermes/workflows/${encodeURIComponent(id)}/runs?limit=${encodeURIComponent(String(limit))}`,
    );
    return (Array.isArray(response.runs) ? response.runs : [])
      .map(normalizeWorkflowRun)
      .filter((run): run is HermesStudioWorkflowRunRecord => run !== null);
  }

  getRun(id: string, runId: string) {
    return this.client.request<{ run: unknown }>(
      `/api/hermes/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
    ).then((response) => requiredWorkflowRun(response.run));
  }

  run(id: string, input: { start_node_ids?: string[]; input?: string | null; timeout_ms?: number } = {}) {
    return this.client.request<{ ok?: boolean; status?: string; run?: unknown }>(
      `/api/hermes/workflows/${encodeURIComponent(id)}/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
  }

  stopRun(id: string, runId: string) {
    return this.client.request<{ ok?: boolean; run?: unknown }>(
      `/api/hermes/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/stop`,
      { method: 'POST' },
    ).then((response) => response.run ? normalizeWorkflowRun(response.run) : null);
  }

  deleteRun(id: string, runId: string): Promise<void> {
    return this.client.request(
      `/api/hermes/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
      { method: 'DELETE' },
    ).then(() => undefined);
  }

  approveNode(id: string, runId: string, nodeId: string, approved: boolean, executionId?: string) {
    return this.client.request(
      `/api/hermes/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`
      + `/nodes/${encodeURIComponent(nodeId)}/approval`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, ...(executionId ? { executionId } : {}) }),
      },
    );
  }

  rerunFromNode(id: string, runId: string, nodeId: string, input: { preserve_start_node?: boolean; timeout_ms?: number } = {}) {
    return this.client.request<{ ok?: boolean; status?: string; run?: unknown }>(
      `/api/hermes/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/rerun-from-node`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, node_id: nodeId }),
      },
    );
  }

  async listSchedules(id: string): Promise<HermesStudioWorkflowScheduleRecord[]> {
    const response = await this.client.request<{ schedules?: unknown[] }>(
      `/api/hermes/workflows/${encodeURIComponent(id)}/schedules`,
    );
    return (Array.isArray(response.schedules) ? response.schedules : [])
      .map(normalizeWorkflowSchedule)
      .filter((schedule): schedule is HermesStudioWorkflowScheduleRecord => schedule !== null);
  }

  createSchedule(id: string, input: HermesStudioWorkflowScheduleInput) {
    return this.client.request<{ schedule: unknown }>(
      `/api/hermes/workflows/${encodeURIComponent(id)}/schedules`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => requiredWorkflowSchedule(response.schedule));
  }

  updateSchedule(id: string, scheduleId: string, input: Partial<HermesStudioWorkflowScheduleInput>) {
    return this.client.request<{ schedule: unknown }>(
      `/api/hermes/workflows/${encodeURIComponent(id)}/schedules/${encodeURIComponent(scheduleId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => requiredWorkflowSchedule(response.schedule));
  }

  async deleteSchedule(id: string, scheduleId: string): Promise<void> {
    await this.client.request(
      `/api/hermes/workflows/${encodeURIComponent(id)}/schedules/${encodeURIComponent(scheduleId)}`,
      { method: 'DELETE' },
    );
  }
}

function normalizeWorkflow(value: unknown): HermesStudioWorkflowRecord | null {
  if (!isRecord(value) || !stringValue(value.id).trim()) return null;
  return {
    id: stringValue(value.id),
    name: stringValue(value.name, 'Untitled workflow'),
    profile: stringValue(value.profile, 'default'),
    workspace: value.workspace === null ? null : stringValue(value.workspace),
    nodes: Array.isArray(value.nodes) ? value.nodes : [],
    edges: Array.isArray(value.edges) ? value.edges : [],
    viewport: isRecord(value.viewport)
      ? value.viewport as HermesStudioWorkflowViewport | Record<string, unknown>
      : null,
    created_at: numberValue(value.created_at, Date.now()),
    updated_at: numberValue(value.updated_at, numberValue(value.created_at, Date.now())),
  };
}

function requiredWorkflow(value: unknown): HermesStudioWorkflowRecord {
  const workflow = normalizeWorkflow(value);
  if (!workflow) throw new Error('Hermes Studio returned an invalid workflow');
  return workflow;
}

function normalizeNodeSession(value: unknown): HermesStudioWorkflowRunNodeSession | null {
  if (!isRecord(value) || !stringValue(value.id).trim()) return null;
  return {
    id: stringValue(value.id),
    run_id: stringValue(value.run_id),
    workflow_id: stringValue(value.workflow_id),
    node_id: stringValue(value.node_id),
    execution_id: stringValue(value.execution_id),
    profile: stringValue(value.profile, 'default'),
    agent: stringValue(value.agent, 'hermes'),
    agent_mode: stringValue(value.agent_mode),
    status: stringValue(value.status, 'queued'),
    sequence: numberValue(value.sequence, 0),
    iteration_path: Array.isArray(value.iteration_path) ? value.iteration_path : [],
    consumed_edge_evaluation_ids: Array.isArray(value.consumed_edge_evaluation_ids)
      ? value.consumed_edge_evaluation_ids.filter((id): id is string => typeof id === 'string')
      : [],
    session_id: stringValue(value.session_id),
    remaining_timeout_ms_at_start: value.remaining_timeout_ms_at_start === null
      ? null
      : numberValue(value.remaining_timeout_ms_at_start, 0),
    started_at: value.started_at === null ? null : numberValue(value.started_at, 0),
    finished_at: value.finished_at === null ? null : numberValue(value.finished_at, 0),
    created_at: numberValue(value.created_at, Date.now()),
    updated_at: numberValue(value.updated_at, Date.now()),
    error: value.error === null ? null : stringValue(value.error),
  };
}

function normalizeWorkflowSchedule(value: unknown): HermesStudioWorkflowScheduleRecord | null {
  if (!isRecord(value) || !stringValue(value.id).trim()) return null;
  return {
    id: stringValue(value.id),
    workflow_id: stringValue(value.workflow_id),
    profile: stringValue(value.profile, 'default'),
    schedule: stringValue(value.schedule),
    timezone: stringValue(value.timezone, 'UTC'),
    enabled: value.enabled !== false,
    input: value.input === null ? null : stringValue(value.input),
    start_node_ids: Array.isArray(value.start_node_ids)
      ? value.start_node_ids.filter((id): id is string => typeof id === 'string')
      : [],
    timeout_ms: value.timeout_ms === null ? null : numberValue(value.timeout_ms, 0),
    concurrency_policy: stringValue(value.concurrency_policy, 'skip'),
    misfire_policy: stringValue(value.misfire_policy, 'skip'),
    last_scheduled_at: value.last_scheduled_at === null ? null : numberValue(value.last_scheduled_at, 0),
    next_run_at: value.next_run_at === null ? null : numberValue(value.next_run_at, 0),
    last_run_id: value.last_run_id === null ? null : stringValue(value.last_run_id),
    last_error: value.last_error === null ? null : stringValue(value.last_error),
    created_at: numberValue(value.created_at, Date.now()),
    updated_at: numberValue(value.updated_at, Date.now()),
  };
}

function requiredWorkflowSchedule(value: unknown): HermesStudioWorkflowScheduleRecord {
  const schedule = normalizeWorkflowSchedule(value);
  if (!schedule) throw new Error('Hermes Studio returned an invalid workflow schedule');
  return schedule;
}

function normalizeEdgeEvaluation(value: unknown): HermesStudioWorkflowRunEdgeEvaluation | null {
  if (!isRecord(value) || !stringValue(value.id).trim()) return null;
  return {
    id: stringValue(value.id),
    run_id: stringValue(value.run_id),
    workflow_id: stringValue(value.workflow_id),
    edge_id: stringValue(value.edge_id),
    source_node_id: stringValue(value.source_node_id),
    source_execution_id: stringValue(value.source_execution_id),
    iteration_path: Array.isArray(value.iteration_path) ? value.iteration_path : [],
    target_node_id: stringValue(value.target_node_id),
    source_outcome: stringValue(value.source_outcome, 'success'),
    status: stringValue(value.status, 'not_taken'),
    route: stringValue(value.route, 'success'),
    reason: value.reason === null ? null : stringValue(value.reason),
    sequence: numberValue(value.sequence, 0),
    orchestration: value.orchestration,
    condition_evaluation: value.condition_evaluation === null ? null : value.condition_evaluation,
    evaluated_at: numberValue(value.evaluated_at, Date.now()),
  };
}

function normalizeLoopEpoch(value: unknown): HermesStudioWorkflowRunLoopEpoch | null {
  if (!isRecord(value) || !stringValue(value.id).trim()) return null;
  return {
    id: stringValue(value.id),
    run_id: stringValue(value.run_id),
    workflow_id: stringValue(value.workflow_id),
    loop_id: stringValue(value.loop_id),
    iteration: numberValue(value.iteration, 0),
    iteration_path: Array.isArray(value.iteration_path) ? value.iteration_path : [],
    status: stringValue(value.status, 'completed'),
    exit_reason: value.exit_reason === null ? null : stringValue(value.exit_reason),
    sequence: numberValue(value.sequence, 0),
    started_at: numberValue(value.started_at, 0),
    finished_at: numberValue(value.finished_at, 0),
  };
}

function normalizeWorkflowRun(value: unknown): HermesStudioWorkflowRunRecord | null {
  if (!isRecord(value) || !stringValue(value.id).trim()) return null;
  return {
    id: stringValue(value.id),
    workflow_id: stringValue(value.workflow_id),
    profile: stringValue(value.profile, 'default'),
    workspace: value.workspace === null ? null : stringValue(value.workspace),
    start_node_ids: Array.isArray(value.start_node_ids)
      ? value.start_node_ids.filter((id): id is string => typeof id === 'string')
      : [],
    status: stringValue(value.status, 'queued') as HermesStudioWorkflowRunStatus,
    snapshot_nodes: Array.isArray(value.snapshot_nodes) ? value.snapshot_nodes : [],
    snapshot_edges: Array.isArray(value.snapshot_edges) ? value.snapshot_edges : [],
    requested_timeout_ms: value.requested_timeout_ms === null
      ? null
      : numberValue(value.requested_timeout_ms, 0),
    deadline_at: value.deadline_at === null ? null : numberValue(value.deadline_at, 0),
    started_at: value.started_at === null ? null : numberValue(value.started_at, 0),
    finished_at: value.finished_at === null ? null : numberValue(value.finished_at, 0),
    created_at: numberValue(value.created_at, Date.now()),
    updated_at: value.updated_at === undefined ? undefined : numberValue(value.updated_at, Date.now()),
    error: value.error === null ? null : stringValue(value.error),
    trigger_source: stringValue(value.trigger_source),
    scheduled_at: value.scheduled_at === null ? null : numberValue(value.scheduled_at, 0),
    node_sessions: (Array.isArray(value.node_sessions) ? value.node_sessions : [])
      .map(normalizeNodeSession)
      .filter((session): session is HermesStudioWorkflowRunNodeSession => session !== null),
    edge_evaluations: (Array.isArray(value.edge_evaluations) ? value.edge_evaluations : [])
      .map(normalizeEdgeEvaluation)
      .filter((edge): edge is HermesStudioWorkflowRunEdgeEvaluation => edge !== null),
    loop_epochs: (Array.isArray(value.loop_epochs) ? value.loop_epochs : [])
      .map(normalizeLoopEpoch)
      .filter((loop): loop is HermesStudioWorkflowRunLoopEpoch => loop !== null),
    compiled_loops: Array.isArray(value.compiled_loops) ? value.compiled_loops : [],
  };
}

function requiredWorkflowRun(value: unknown): HermesStudioWorkflowRunRecord {
  const run = normalizeWorkflowRun(value);
  if (!run) throw new Error('Hermes Studio returned an invalid workflow run');
  return run;
}
