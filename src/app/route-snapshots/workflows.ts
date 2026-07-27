import type {
  HermesSwiftUIAnalyticsPointSnapshot,
  HermesSwiftUIApprovalsSnapshot,
  HermesSwiftUIRuntimeSnapshot,
  HermesSwiftUIWorkflowSnapshot,
} from '../swiftui-route-contract';
import {
  epochMilliseconds,
  finiteNumber,
  formatCompactNumber,
  formatCurrency,
  isRecord,
  numberValue,
  positiveRevision,
  recordArray,
  shortDayLabel,
  stringValue,
} from './support';

export function workflowsSnapshot(
  source: unknown,
  selectedId: string,
): HermesSwiftUIWorkflowSnapshot {
  if (!isRecord(source)) {
    return { workflows: [], nodes: [], edges: [], changeSets: [], workspaceAudits: [] };
  }
  const definitions = recordArray(source.definitions);
  const runs = recordArray(source.runs);
  const selectedEnvelope = isRecord(source.selected_definition) ? source.selected_definition : {};
  const selectedCandidate = isRecord(selectedEnvelope.definition)
    ? selectedEnvelope.definition
    : selectedEnvelope;
  const selected = stringValue(selectedCandidate.id)
    ? selectedCandidate
    : definitions.find((entry) => stringValue(entry.id) === selectedId);
  const selectedWorkflowId = stringValue(selected?.id) || undefined;
  const selectedRuns = selectedWorkflowId
    ? runs.filter((entry) => stringValue(entry.definition_id) === selectedWorkflowId)
    : [];
  const runRecord = selectedRuns[0];
  const workspaceEnvelope = isRecord(source.workspace_changes) ? source.workspace_changes : {};
  const changeSets = recordArray(workspaceEnvelope.change_sets).map(workspaceChangeSetSnapshot);
  const workspaceAudits = recordArray(workspaceEnvelope.workspace_audits).map(workspaceAuditSnapshot);
  const detailEnvelope = isRecord(source.selected_change_set) ? source.selected_change_set : {};
  const detailRecord = isRecord(detailEnvelope.change_set)
    ? detailEnvelope.change_set
    : stringValue(detailEnvelope.id) ? detailEnvelope : undefined;
  const nodeRuns = recordArray(runRecord?.node_runs);
  const latestNodeRuns = new Map<string, Record<string, unknown>>();
  for (const nodeRun of nodeRuns) {
    const key = stringValue(nodeRun.node_key);
    if (!key) continue;
    const current = latestNodeRuns.get(key);
    if (!current || numberValue(nodeRun.attempt) >= numberValue(current.attempt)) {
      latestNodeRuns.set(key, nodeRun);
    }
  }
  const spec = isRecord(selected?.spec) ? selected.spec : {};
  const nodes = recordArray(spec.nodes).map((node) => {
    const id = stringValue(node.id);
    const nodeRun = latestNodeRuns.get(id);
    const nodeRunSpec = isRecord(nodeRun?.spec) ? nodeRun.spec : {};
    const requiresApproval = node.requires_approval === true
      || node.approval_required === true
      || nodeRunSpec.requires_approval === true;
    const state = stringValue(nodeRun?.state) || 'pending';
    return {
      id,
      runNodeId: stringValue(nodeRun?.id) || undefined,
      label: stringValue(node.label) || stringValue(node.name) || id,
      kind: stringValue(node.kind) || stringValue(node.type),
      state,
      detail: stringValue(node.description) || stringValue(nodeRun?.error),
      x: finiteNumber(node.x),
      y: finiteNumber(node.y),
      requiresApproval,
      approvalPending: requiresApproval && state === 'ready',
      revision: positiveRevision(nodeRun?.revision) || 0,
    };
  }).filter((node) => node.id);
  const edges = recordArray(spec.edges).map((edge, index) => {
    const sourceId = stringValue(edge.source);
    const targetId = stringValue(edge.target);
    return {
      id: stringValue(edge.id) || `${sourceId}:${targetId}:${index}`,
      source: sourceId,
      target: targetId,
      label: stringValue(edge.label) || stringValue(edge.condition),
      state: stringValue(edge.state),
    };
  }).filter((edge) => edge.source && edge.target);
  return {
    selectedWorkflowId,
    workflows: definitions.map((definition) => {
      const definitionId = stringValue(definition.id);
      const activeRun = runs.find((entry) => stringValue(entry.definition_id) === definitionId);
      return {
        id: definitionId,
        name: stringValue(definition.name),
        detail: stringValue(definition.description),
        revision: positiveRevision(definition.revision) || 0,
        state: stringValue(activeRun?.state),
        updatedAt: epochMilliseconds(definition.updated_at),
        activeRunId: stringValue(activeRun?.id) || undefined,
      };
    }).filter((definition) => definition.id),
    nodes,
    edges,
    run: runRecord ? workflowRunSnapshot(runRecord) : undefined,
    changeSets,
    workspaceAudits,
    selectedChangeSet: detailRecord ? workspaceChangeSetDetailSnapshot(detailRecord) : undefined,
  };
}

function workflowRunSnapshot(run: Record<string, unknown>) {
  const nodeRuns = recordArray(run.node_runs);
  const startedAt = epochMilliseconds(run.created_at);
  const completedAt = epochMilliseconds(run.finished_at);
  const current = nodeRuns.find((node) => ['ready', 'dispatched', 'running'].includes(stringValue(node.state)));
  const failed = nodeRuns.find((node) => stringValue(node.error));
  const state = stringValue(run.state);
  return {
    id: stringValue(run.id),
    workflowId: stringValue(run.definition_id),
    state,
    startedAt,
    completedAt,
    durationMs: startedAt ? Math.max(0, (completedAt || Date.now()) - startedAt) : undefined,
    currentNodeId: stringValue(current?.node_key) || undefined,
    error: stringValue(run.error) || stringValue(failed?.error) || undefined,
    canCancel: state === 'running',
    canRetry: state === 'failed',
    revision: positiveRevision(run.revision) || 0,
  };
}

function workspaceChangeSetSnapshot(entry: Record<string, unknown>) {
  const counts = isRecord(entry.change_counts) ? entry.change_counts : {};
  return {
    id: stringValue(entry.id),
    runId: stringValue(entry.run_id),
    turnId: stringValue(entry.turn_id),
    summary: stringValue(entry.summary),
    createdAt: epochMilliseconds(entry.created_at),
    fileCount: numberValue(entry.file_count),
    byteCount: numberValue(entry.byte_count),
    addedCount: numberValue(counts.added),
    modifiedCount: numberValue(counts.modified),
    deletedCount: numberValue(counts.deleted),
    renamedCount: numberValue(counts.renamed),
  };
}

function workspaceAuditSnapshot(entry: Record<string, unknown>) {
  return {
    nodeRunId: stringValue(entry.node_run_id),
    runId: stringValue(entry.run_id),
    state: stringValue(entry.state),
    reason: stringValue(entry.reason),
    fileCount: numberValue(entry.file_count),
    byteCount: numberValue(entry.byte_count),
    changeSetId: stringValue(entry.change_set_id) || undefined,
    updatedAt: epochMilliseconds(entry.updated_at),
    finalizedAt: epochMilliseconds(entry.finalized_at),
  };
}

function workspaceChangeSetDetailSnapshot(entry: Record<string, unknown>) {
  return {
    id: stringValue(entry.id),
    runId: stringValue(entry.run_id),
    turnId: stringValue(entry.turn_id),
    summary: stringValue(entry.summary),
    createdAt: epochMilliseconds(entry.created_at),
    files: recordArray(entry.files).map((file) => ({
      path: stringValue(file.path),
      changeType: stringValue(file.change_type),
      sha256: stringValue(file.sha256),
      byteCount: numberValue(file.byte_count),
      patch: stringValue(file.patch),
    })).filter(({ path }) => path),
  };
}

export function approvalsSnapshot(source: unknown, selectedId: string): HermesSwiftUIApprovalsSnapshot {
  if (!isRecord(source)) return { items: [] };
  const items = recordArray(source.approvals).map(approvalSnapshot);
  const selectedRecord = isRecord(source.approval)
    ? source.approval
    : recordArray(source.approvals).find((entry) => stringValue(entry.id) === selectedId);
  const selected = selectedRecord ? approvalSnapshot(selectedRecord) : undefined;
  return { selectedId: selected?.id || undefined, items, selected };
}

function approvalSnapshot(entry: Record<string, unknown>) {
  const payload = isRecord(entry.payload) ? entry.payload : {};
  const diff = stringValue(entry.diff);
  const digest = stringValue(entry.payload_digest);
  return {
    id: stringValue(entry.id),
    title: stringValue(entry.summary) || stringValue(entry.action),
    summary: stringValue(entry.summary),
    subsystem: stringValue(entry.subsystem),
    action: stringValue(entry.action),
    origin: stringValue(entry.origin),
    profile: stringValue(entry.profile),
    state: stringValue(entry.state),
    target: stringValue(payload.path) || stringValue(payload.name) || stringValue(payload.target),
    revision: positiveRevision(entry.revision) || 0,
    createdAt: epochMilliseconds(entry.created_at),
    expiresAt: epochMilliseconds(entry.expires_at),
    diff,
    diffAvailable: Boolean(diff),
    payloadDigest: digest || undefined,
  };
}

export function runtimeSnapshot(source: unknown, selectedId: string): HermesSwiftUIRuntimeSnapshot {
  if (!isRecord(source)) return { runs: [] };
  const runs = recordArray(source.runs).map(runtimeRunSnapshot);
  const selectedEnvelope = isRecord(source.selected_run) ? source.selected_run : {};
  const selectedRecord = isRecord(selectedEnvelope.run)
    ? selectedEnvelope.run
    : stringValue(selectedEnvelope.id)
      ? selectedEnvelope
      : recordArray(source.runs).find((entry) => stringValue(entry.id) === selectedId);
  const selected = selectedRecord ? runtimeRunSnapshot(selectedRecord) : undefined;
  return { selectedRunId: selected?.id || undefined, runs, selected };
}

function runtimeRunSnapshot(entry: Record<string, unknown>) {
  const startedAt = epochMilliseconds(entry.started_at);
  const completedAt = epochMilliseconds(entry.completed_at);
  const updatedAt = epochMilliseconds(entry.updated_at);
  const artifacts = Array.isArray(entry.artifacts) ? entry.artifacts : [];
  return {
    id: stringValue(entry.id),
    title: stringValue(entry.title) || stringValue(entry.source_run_id),
    kind: stringValue(entry.source),
    state: stringValue(entry.status),
    profile: stringValue(entry.profile),
    detail: stringValue(entry.current_node) || stringValue(entry.session_id),
    startedAt,
    completedAt,
    heartbeatAt: updatedAt,
    observedAt: updatedAt,
    durationMs: startedAt ? Math.max(0, (completedAt || updatedAt || Date.now()) - startedAt) : undefined,
    cancelable: entry.cancel_supported === true && Boolean(stringValue(entry.cancel_url)),
    retryable: entry.retry_supported === true && Boolean(stringValue(entry.retry_url)),
    conversationId: stringValue(entry.conversation_id) || undefined,
    workflowId: stringValue(entry.workflow_id) || undefined,
    error: stringValue(entry.error) || undefined,
    artifactCount: artifacts.length,
    changeSetId: stringValue(entry.change_set_id) || undefined,
    cancelUrl: stringValue(entry.cancel_url) || undefined,
    retryUrl: stringValue(entry.retry_url) || undefined,
  };
}

export function analyticsSnapshot(source: unknown) {
  const usage = isRecord(source) && isRecord(source.usage) ? source.usage : {};
  const totals = isRecord(usage.totals) ? usage.totals : {};
  const daily = Array.isArray(usage.daily) ? usage.daily : [];
  return {
    inputTokens: formatCompactNumber(numberValue(totals.total_input)),
    outputTokens: formatCompactNumber(numberValue(totals.total_output)),
    monthlyCost: formatCurrency(
      numberValue(totals.total_actual_cost) || numberValue(totals.total_estimated_cost),
    ),
    successRate: '-',
    points: daily.flatMap((entry, index): HermesSwiftUIAnalyticsPointSnapshot[] => {
      if (!isRecord(entry)) return [];
      return [{
        id: stringValue(entry.day) || `day-${index}`,
        label: shortDayLabel(stringValue(entry.day)),
        input: numberValue(entry.input_tokens),
        output: numberValue(entry.output_tokens),
      }];
    }),
  };
}
