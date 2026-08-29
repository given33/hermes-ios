import type { JsonRecord } from './transport';

export interface SessionSummary {
  id: string;
  source: string | null;
  model: string | null;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  last_active: number;
  is_active: boolean;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  preview: string | null;
  profile?: string;
  archived?: boolean;
  pinned?: boolean;
  unread?: boolean;
}

export interface PaginatedSessions {
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ManagedFileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number | null;
  mtime: number;
  mime_type: string | null;
}

export interface ManagedFilesResponse {
  root: string | null;
  path: string;
  parent: string | null;
  locked_root: string | null;
  can_change_path: boolean;
  entries: ManagedFileEntry[];
}

export interface AccountFileEntry {
  id: string;
  name: string;
  sha256: string;
  mime_type: string;
  extension: string;
  file_type: string;
  size: number;
  source: 'model_output' | 'user_upload';
  status: 'available' | 'failed' | 'uploading';
  conversation_id?: string;
  message_id?: string;
  turn_id?: string;
  profile?: string;
  error?: string;
  created_at: number;
  updated_at: number;
  available_at?: number;
  download_url: string;
}

export interface AccountFilesResponse {
  files: AccountFileEntry[];
  filter_contract?: string;
  total: number;
  limit: number;
  offset: number;
}

export interface AccountFilesQuery {
  dateFrom?: string;
  dateTo?: string;
  fileType?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
  source?: string;
  status?: string;
}

export interface ToolOutputArtifactEntry {
  id: string;
  account_generation: string;
  conversation_id: string;
  turn_id: string;
  tool_call_id: string;
  tool_name: string;
  sha256: string;
  size_bytes: number;
  state: 'available';
  created_at: number;
  retained_until: number;
}

export interface ToolOutputArtifactsResponse {
  artifacts: ToolOutputArtifactEntry[];
  filter_contract?: string;
  total: number;
  limit: number;
  offset: number;
}

export interface CollaborationProfile {
  name: string;
  description: string;
  model: string;
  provider: string;
  gateway_running: boolean;
}

export interface CollaborationMessage {
  id: string;
  role: string;
  name: string;
  content: string;
  activities?: JsonRecord[];
  activity_count?: number;
  attachments?: JsonRecord[];
  avatar?: string;
  avatar_symbol?: string;
  completed_at?: number | string;
  context_used_percent?: number;
  status?: string;
  kind?: string;
  created_at?: number | string;
  handoff_to?: string | string[];
  member_id?: string;
  metadata?: JsonRecord;
  model?: string;
  profile?: string;
  provider?: string;
  role_label?: string;
  collaboration_role?: string;
  sender?: string;
  sender_id?: string;
  sender_name?: string;
  sender_role?: string;
  started_at?: number | string;
  timestamp?: number | string;
  updated_at?: number | string;
  meta?: JsonRecord;
}

export interface SingleConversation {
  account_generation?: string;
  id: string;
  profile: string;
  title: string;
  /** Account-scoped Sessions-page state for unified conversations. */
  archived?: boolean;
  pinned?: boolean;
  unread?: boolean;
  messages: CollaborationMessage[];
  /** Origin metadata used to avoid showing Agent-room transcripts twice. */
  source?: string;
  room_id?: string;
  message_count?: number;
  runtime_sessions?: Record<string, string>;
  runtime_runs?: Record<string, JsonRecord>;
  hosted_turns?: Record<string, JsonRecord>;
  participants?: JsonRecord[];
  room_agents?: JsonRecord[];
  /** Studio transcript pagination checkpoint persisted for offline resume. */
  room_history_complete?: boolean;
  room_history_next_offset?: number;
  event_cursor?: number;
  hosted_event_cursor?: number;
  hosted_event_min_cursor?: number;
  session_entry_cursor?: number;
  session_entry_leaf_id?: string;
  created_at?: number;
  updated_at?: number;
  official_session_id?: string;
  official_profile?: string;
  official_model?: string;
  preview?: string;
}

export type ConversationSessionEntryType =
  | 'message'
  | 'model_change'
  | 'tool_visibility_change'
  | 'collaboration_lift'
  | 'role_handoff'
  | 'intervention'
  | 'compaction'
  | 'label'
  | 'attachment'
  | 'terminal_state';

export interface ConversationSessionEntry {
  entry_id: string;
  cursor: number;
  parent_entry_id: string | null;
  entry_type: ConversationSessionEntryType;
  occurred_at: number;
  idempotency_key: string;
  payload: JsonRecord;
  schema_version: 'hermes.session-entry.v1';
}

export interface ConversationSessionEntriesResponse {
  schema_version: 'hermes.session-entry.v1';
  account_generation: string;
  cursor: number;
  reset_cursor?: boolean;
  reset_reason?: string;
  leaf_entry_id: string;
  entries: ConversationSessionEntry[];
}

export interface ConversationSessionContext extends JsonRecord {
  session_id: string;
  profile: string;
  model?: string | null;
  active_messages: number;
  archived_messages: number;
  message_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  tip_message_id?: number | null;
  compression_lineage: string[];
  compression_count: number;
  compression_in_progress: boolean;
}

export interface ConversationSessionLineageEntry extends JsonRecord {
  id: string;
  title?: string | null;
  parent_session_id?: string | null;
  source?: string | null;
  model?: string | null;
  profile_name?: string | null;
  started_at?: number | null;
  ended_at?: number | null;
  end_reason?: string | null;
  message_count?: number;
  tool_call_count?: number;
}

export interface ConversationSessionState {
  conversation_id: string;
  profile: string;
  session_id: string;
  context: ConversationSessionContext;
  lineage: {
    current_session_id: string;
    roots: string[];
    sessions: ConversationSessionLineageEntry[];
    edges: Array<{ parent_id: string; child_id: string }>;
  };
  branchable_messages: Array<{
    message_id: string;
    role: string;
    runtime_session_id: string;
    runtime_message_id: number;
  }>;
}

/** Response returned by the low-level mobile session fork endpoint. */
export interface ConversationSessionForkResponse {
  session: ConversationSessionLineageEntry;
  replayed: boolean;
}

/** Public lineage tree returned by /mobile/sessions/{id}/lineage. */
export interface ConversationSessionLineageResponse {
  current_session_id: string;
  roots: string[];
  sessions: ConversationSessionLineageEntry[];
  edges: Array<{ parent_id: string; child_id: string }>;
}

export interface ConversationForkResponse {
  conversation: SingleConversation;
  created: boolean;
  session: ConversationSessionLineageEntry;
  replayed: boolean;
}

export interface ConversationCompressionResponse {
  conversation_id: string;
  profile: string;
  previous_session_id: string;
  session_id: string;
  context: ConversationSessionContext;
  result: string;
  replayed: boolean;
}

export interface WorkflowWorkspaceChangeSetSummary extends JsonRecord {
  id: string;
  run_id: string;
  turn_id: string;
  summary: string;
  created_at: number;
  file_count: number;
  byte_count: number;
  change_counts: {
    added: number;
    modified: number;
    deleted: number;
    renamed: number;
  };
}

export interface WorkflowWorkspaceAuditSummary extends JsonRecord {
  node_run_id: string;
  run_id: string;
  state: string;
  reason: string;
  file_count: number;
  byte_count: number;
  change_set_id?: string | null;
  created_at: number;
  updated_at: number;
  finalized_at?: number | null;
}

export interface WorkflowWorkspaceChangeFile extends JsonRecord {
  path: string;
  change_type: string;
  sha256: string;
  byte_count: number;
  patch: string;
}

export interface WorkflowWorkspaceChangeSetDetail extends JsonRecord {
  id: string;
  run_id: string;
  turn_id: string;
  summary: string;
  created_at: number;
  files: WorkflowWorkspaceChangeFile[];
}

export interface WorkflowWorkspaceChangesResponse {
  change_sets: WorkflowWorkspaceChangeSetSummary[];
  workspace_audits: WorkflowWorkspaceAuditSummary[];
}

export interface RouteDecision extends JsonRecord {
  mode: 'chat' | 'work';
  label: string;
  title: string;
  reason: string;
  confidence: number;
  source: string;
  profiles: string[];
  artifact_required: boolean;
}

export interface HostedTurnEnqueueInput {
  requestId: string;
  turnId: string;
  message: CollaborationMessage;
  recentMessages: Array<Pick<CollaborationMessage, 'content' | 'role'>>;
  profiles?: string[];
  attachmentIds?: string[];
  attachmentContext?: string;
  deliveryContext?: string;
  createConversationIfMissing?: boolean;
  conversationProfile?: string;
  conversationTitle?: string;
}

export interface HostedTurnEnqueueResponse {
  accepted: boolean;
  replayed: boolean;
  request_id: string;
  conversation_id: string;
  message: CollaborationMessage;
  route: RouteDecision;
  route_message?: CollaborationMessage;
  hosted_turn: JsonRecord;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
}

export interface NativeUpload {
  name: string;
  mimeType?: string | null;
  sha256?: string;
  size?: number | null;
  uri: string;
}

export interface ConversationAttachmentUploadContext {
  messageId?: string;
  profile?: string;
  turnId?: string;
  uploadId: string;
}
