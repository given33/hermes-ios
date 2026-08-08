export type HermesStudioAgentKind = 'hermes' | 'ekko' | 'codex' | 'claude' | string;

export interface HermesStudioRoomInfo {
  id: string;
  name: string;
  inviteCode: string | null;
  canManage?: boolean;
  summaryProfile?: string;
  summaryProvider?: string;
  summaryModel?: string;
  summaryApiMode?: string;
  summaryEveryTurns?: number;
  totalTokens?: number;
  workspace?: string;
}

export interface HermesStudioRoomAgent {
  id: string;
  roomId: string;
  agentId: string;
  agent: HermesStudioAgentKind;
  profile: string;
  provider?: string;
  model?: string;
  apiMode?: string;
  reasoningEffort?: string;
  name: string;
  description?: string;
  avatar?: string;
  invited?: number | boolean;
}

export interface HermesStudioRoomSummaryConfig {
  summaryProfile: string;
  summaryProvider: string;
  summaryModel: string;
  summaryApiMode: string;
  summaryEveryTurns: number;
}

export interface HermesStudioRoomConfigInput extends Partial<HermesStudioRoomSummaryConfig> {
  name?: string;
}

export interface HermesStudioRoomSummaryState {
  roomId: string;
  summary: string;
  summaryThroughMessageId: string;
  summaryThroughMessageTimestamp: number;
  summarizedTurnCount: number;
  status: 'idle' | 'summarizing' | 'success' | 'failed' | string;
  version: number;
  updatedAt: number;
  lastError: string | null;
}

export interface HermesStudioRoomSummaryAnchor {
  id: string;
  timestamp: number;
  senderName: string;
  role?: string;
  content: string;
}

export interface HermesStudioRoomMember {
  id: string;
  userId: string;
  name: string;
  description?: string;
  joinedAt?: number;
  avatar?: string;
}

export interface HermesStudioGroupChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  run_id?: string | null;
  role?: string;
  tool_call_id?: string | null;
  tool_calls?: unknown[] | null;
  tool_name?: string | null;
  finish_reason?: string | null;
  reasoning?: string | null;
  reasoning_details?: string | null;
  reasoning_content?: string | null;
  isStreaming?: boolean;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: unknown;
  toolPreview?: string;
  toolResult?: unknown;
  toolStatus?: 'running' | 'done' | 'error';
  attachments?: Array<{ id: string; name: string; type: string; size: number; url: string }>;
  runItems?: HermesStudioGroupChatMessage[];
  firstSeenAt?: number;
}

export interface HermesStudioGroupChatJoinResult {
  roomId: string;
  roomName: string;
  members: HermesStudioRoomMember[];
  messages: HermesStudioGroupChatMessage[];
  rooms: string[];
}

export interface HermesStudioGroupChatRoomDetail {
  room: HermesStudioRoomInfo;
  messages: HermesStudioGroupChatMessage[];
  agents: HermesStudioRoomAgent[];
  members: HermesStudioRoomMember[];
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
}

export interface HermesStudioWorkspaceFileEntry {
  name: string;
  path: string;
  absolutePath?: string;
  isDir: boolean;
  size: number;
  modTime: string;
}

export interface HermesStudioWorkspaceFileListing {
  entries: HermesStudioWorkspaceFileEntry[];
  path: string;
  absolutePath?: string;
}

export interface HermesStudioWorkspaceFileContent {
  content: string;
  path: string;
  size: number;
}

export interface HermesStudioCreateRoomInput {
  name: string;
  inviteCode: string;
  memberName?: string;
  memberDescription?: string;
  agents?: HermesStudioRoomAgentInput[];
  summary?: {
    profile: string;
    provider: string;
    model: string;
    apiMode: string;
    everyTurns: number;
  };
  workspace?: string;
}

export interface HermesStudioRoomAgentInput {
  agent?: HermesStudioAgentKind;
  profile: string;
  provider?: string;
  model?: string;
  apiMode?: string;
  reasoningEffort?: string;
  name?: string;
  description?: string;
  avatar?: string;
  invited?: boolean;
}

export interface HermesStudioRoomSnapshot {
  room: HermesStudioRoomInfo;
  agents: HermesStudioRoomAgent[];
  members: HermesStudioRoomMember[];
  messages: HermesStudioGroupChatMessage[];
  typingNames: string[];
  runningAgents: string[];
  contextStatuses: Record<string, string>;
  summary: HermesStudioRoomSummaryState | null;
  summaryAnchor: HermesStudioRoomSummaryAnchor | null;
  pendingApprovals: HermesStudioPendingApproval[];
  totalTokens?: number;
  connected: boolean;
  loading: boolean;
  error: string | null;
  updatedAt: number;
}

export interface HermesStudioPendingApproval {
  roomId: string;
  agentName: string;
  approvalId: string;
  command: string;
  description: string;
  choices: Array<'once' | 'session' | 'always' | 'deny'>;
  allowPermanent: boolean;
  isMemoryWrite: boolean;
  requestedAt: number;
}

export interface HermesStudioWorkflowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface HermesStudioWorkflowRecord {
  id: string;
  name: string;
  profile: string;
  workspace: string | null;
  nodes: unknown[];
  edges: unknown[];
  viewport: HermesStudioWorkflowViewport | Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface HermesStudioWorkflowExportEnvelope {
  format: 'hermes-studio.workflow' | string;
  version: number;
  definition: {
    name: string;
    nodes: unknown[];
    edges: unknown[];
    viewport: HermesStudioWorkflowViewport | Record<string, unknown> | null;
  };
}

export interface HermesStudioWorkflowImportPreview {
  token: string;
  digest: string;
  expiresAt: number;
  summary: { name: string; nodes: number; edges: number };
}

export type HermesStudioWorkflowRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | string;
export type HermesStudioWorkflowRunNodeStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'approval_rejected'
  | 'canceled'
  | string;

export interface HermesStudioWorkflowRunNodeSession {
  id: string;
  run_id: string;
  workflow_id: string;
  node_id: string;
  execution_id: string;
  profile: string;
  agent: string;
  agent_mode: string;
  status: HermesStudioWorkflowRunNodeStatus;
  sequence: number;
  iteration_path?: unknown[];
  consumed_edge_evaluation_ids?: string[];
  session_id?: string;
  remaining_timeout_ms_at_start?: number | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
  error: string | null;
}

export interface HermesStudioWorkflowRunEdgeEvaluation {
  id: string;
  run_id: string;
  workflow_id: string;
  edge_id: string;
  source_node_id: string;
  source_execution_id: string;
  iteration_path: unknown[];
  target_node_id: string;
  source_outcome: 'success' | 'failure' | 'skipped' | string;
  status: 'taken' | 'not_taken' | 'error' | string;
  route: 'success' | 'failure' | 'always' | string;
  reason: string | null;
  sequence: number;
  orchestration: unknown;
  condition_evaluation: unknown | null;
  evaluated_at: number;
}

export interface HermesStudioWorkflowRunLoopEpoch {
  id: string;
  run_id: string;
  workflow_id: string;
  loop_id: string;
  iteration: number;
  iteration_path: unknown[];
  status: string;
  exit_reason: string | null;
  sequence: number;
  started_at: number;
  finished_at: number;
}

export interface HermesStudioWorkflowRunRecord {
  id: string;
  workflow_id: string;
  profile: string;
  workspace: string | null;
  start_node_ids: string[];
  status: HermesStudioWorkflowRunStatus;
  snapshot_nodes: unknown[];
  snapshot_edges: unknown[];
  requested_timeout_ms?: number | null;
  deadline_at?: number | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at?: number;
  error: string | null;
  node_sessions?: HermesStudioWorkflowRunNodeSession[];
  edge_evaluations?: HermesStudioWorkflowRunEdgeEvaluation[];
  loop_epochs?: HermesStudioWorkflowRunLoopEpoch[];
  compiled_loops?: unknown[];
}

export type HermesStudioWorkflowRuntimeState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'pending_approval'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'approval_rejected'
  | 'canceled'
  | string;

export interface HermesStudioWorkflowRuntimeStatus {
  workflowId: string;
  status: HermesStudioWorkflowRuntimeState;
  runId: string | null;
  startedAt: number | null;
  updatedAt: number;
  completedAt: number | null;
  error: string | null;
  nodeStatuses?: Record<string, HermesStudioWorkflowRuntimeState>;
  run?: HermesStudioWorkflowRunRecord | null;
}

export interface HermesStudioWorkflowHistoryItem {
  id: string;
  workflowId: string;
  runId: string;
  title: string;
  preview: string;
  profile: string;
  updatedAt: number;
  status: HermesStudioWorkflowRunStatus;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function numberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
