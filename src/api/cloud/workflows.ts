import type {
  WorkflowWorkspaceChangeSetDetail,
  WorkflowWorkspaceChangesResponse,
} from '../HermesCloudApi';
import type { HermesCloudTransport, JsonRecord } from './transport';

const COLLABORATION = '/api/plugins/collaboration';
const WORKFLOWS = '/api/plugins/workflows';
const WRITE_APPROVALS = `${COLLABORATION}/mobile/write-approvals`;
const RUNTIME_RUNS = `${COLLABORATION}/mobile/runtime-runs`;

/** Durable workflow, write-approval, and hosted runtime control endpoints. */
export class HermesWorkflowsCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  getWorkflows(profile = 'default') {
    return this.transport.request<JsonRecord>(`${WORKFLOWS}/definitions`, {
      query: { profile_id: profile },
    });
  }

  getWorkflow(id: string, profile = 'default') {
    return this.transport.request<JsonRecord>(
      `${WORKFLOWS}/definitions/${encodeURIComponent(id)}`,
      { query: { profile_id: profile } },
    );
  }

  getWorkflowRuns(profile = 'default') {
    return this.transport.request<JsonRecord>(`${WORKFLOWS}/runs`, {
      query: { limit: 100, profile_id: profile },
    });
  }

  getWorkflowWorkspaceChanges(runId: string, profile = 'default', limit = 100) {
    return this.transport.request<WorkflowWorkspaceChangesResponse>(
      `${WORKFLOWS}/runs/${encodeURIComponent(runId)}/workspace-changes`,
      { query: { limit, profile_id: profile } },
    );
  }

  getWorkflowWorkspaceChange(runId: string, changeSetId: string, profile = 'default') {
    return this.transport.request<{ change_set: WorkflowWorkspaceChangeSetDetail }>(
      `${WORKFLOWS}/runs/${encodeURIComponent(runId)}`
      + `/workspace-changes/${encodeURIComponent(changeSetId)}`,
      { query: { profile_id: profile } },
    );
  }

  startWorkflow(id: string, profile: string, requestId: string) {
    return this.transport.json<JsonRecord>(
      `${WORKFLOWS}/definitions/${encodeURIComponent(id)}/runs`,
      'POST',
      { inputs: {}, profile_id: profile },
      { headers: { 'Idempotency-Key': requestId } },
    );
  }

  cancelWorkflowRun(
    runId: string,
    expectedRevision: number,
    profile: string,
    requestId: string,
  ) {
    return this.transport.json<JsonRecord>(
      `${WORKFLOWS}/runs/${encodeURIComponent(runId)}/cancel`,
      'POST',
      { expected_revision: expectedRevision, profile_id: profile, reason: 'mobile_user' },
      { headers: { 'Idempotency-Key': requestId } },
    );
  }

  retryWorkflowNode(
    runId: string,
    nodeId: string,
    expectedRevision: number,
    profile: string,
    requestId: string,
  ) {
    return this.transport.json<JsonRecord>(
      `${WORKFLOWS}/runs/${encodeURIComponent(runId)}`
      + `/nodes/${encodeURIComponent(nodeId)}/retry`,
      'POST',
      { expected_revision: expectedRevision, profile_id: profile },
      { headers: { 'Idempotency-Key': requestId } },
    );
  }

  approveWorkflowNode(
    runId: string,
    nodeId: string,
    expectedRevision: number,
    profile: string,
    requestId: string,
  ) {
    return this.transport.json<JsonRecord>(
      `${WORKFLOWS}/runs/${encodeURIComponent(runId)}`
      + `/nodes/${encodeURIComponent(nodeId)}/approval`,
      'POST',
      {
        decision: 'approve',
        expected_revision: expectedRevision,
        profile_id: profile,
        request_id: requestId,
      },
      { headers: { 'Idempotency-Key': requestId } },
    );
  }

  getWriteApprovals(profile = 'default') {
    return this.transport.request<JsonRecord>(WRITE_APPROVALS, {
      query: { profile, state: 'pending' },
    });
  }

  getWriteApproval(id: string, profile = 'default') {
    return this.transport.request<JsonRecord>(`${WRITE_APPROVALS}/${encodeURIComponent(id)}`, {
      query: { profile },
    });
  }

  decideWriteApproval(
    id: string,
    decision: 'approve' | 'reject',
    revision: number,
    requestId: string,
    profile: string,
    payloadDigest?: string,
  ) {
    return this.transport.json<JsonRecord>(
      `${WRITE_APPROVALS}/${encodeURIComponent(id)}/decision`,
      'POST',
      {
        decision,
        expected_revision: revision,
        profile,
        ...(payloadDigest ? { payload_digest: payloadDigest } : {}),
      },
      { headers: { 'Idempotency-Key': requestId } },
    );
  }

  getRuntimeRuns(profile = 'default') {
    return this.transport.request<JsonRecord>(RUNTIME_RUNS, {
      query: { limit: 200, profile },
    });
  }

  getRuntimeRun(id: string, profile = 'default') {
    return this.transport.request<JsonRecord>(`${RUNTIME_RUNS}/${encodeURIComponent(id)}`, {
      query: { profile },
    });
  }

  cancelRuntimeRun(actionUrl: string, requestId: string) {
    return this.transport.json<JsonRecord>(runtimeActionPath(actionUrl), 'POST', {
      reason: 'mobile_user',
      request_id: requestId,
    }, { headers: { 'Idempotency-Key': requestId } });
  }

  retryRuntimeRun(actionUrl: string, requestId: string) {
    return this.transport.json<JsonRecord>(runtimeActionPath(actionUrl), 'POST', {
      request_id: requestId,
    }, { headers: { 'Idempotency-Key': requestId } });
  }
}

function runtimeActionPath(value: string): string {
  const path = value.trim();
  const escapedPrefix = COLLABORATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const actionPattern = new RegExp(
    `^${escapedPrefix}/single/conversations/[^/?#]+/hosted-turns/[^/?#]+/(cancel|retry)$`,
  );
  if (!actionPattern.test(path)) {
    throw new Error('Runtime action is not available for this run');
  }
  return path;
}
