export type HermesChatActivityStatus =
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'queued'
  | 'running';

export type HermesChatAvatarRole =
  | 'dbb3-worker'
  | 'dispatcher'
  | 'hermes'
  | 'hk-worker'
  | 'pc-worker'
  | 'reporter'
  | 'reviewer'
  | 'supervisor'
  | 'user';

export type HermesChatRoleStage =
  | 'chat'
  | 'dispatcher'
  | 'reporter'
  | 'reviewer'
  | 'supervisor'
  | 'worker';

export type ConversationCollaborationState = 'active' | 'lifting' | 'single';

export interface HermesChatActivity {
  category: string;
  completedAt?: number;
  detail?: string;
  duration: string;
  durationMs?: number;
  error?: string;
  id: string;
  input?: string;
  model?: string;
  name: string;
  output?: string;
  preview: string;
  provider?: string;
  startedAt?: number;
  status: HermesChatActivityStatus;
  toolName?: string;
  /** Files this activity touched (read/write paths), for "+/- path" chips. */
  files?: string[];
  /** Awaiting-choice card: question + selectable options (A/B/C). */
  question?: string;
  options?: { id: string; label: string }[];
  /** Supervisor verdict severity: pass | corrective. */
  severity?: string;
  /** Subagent display name (model-chosen Chinese job title). */
  agentName?: string;
  /** Rework round for rework state chips. */
  reworkRound?: number;
  callId?: string;
  parentCallId?: string;
  presentationMeta?: {
    view?: string;
    title?: string;
    summary?: string;
    replayable?: boolean;
    artifactRefs?: string[];
    rendererVersion?: string;
  };
}

export type HermesChatTodoStatus = 'cancelled' | 'completed' | 'in_progress' | 'pending';

export interface HermesChatTodo {
  id: string;
  title: string;
  status: HermesChatTodoStatus;
}

export interface HermesChatViewMessage {
  activities?: HermesChatActivity[];
  executionReports?: { id: string; content: string; createdAt: number }[];
  attachments?: HermesChatAttachment[];
  avatarRole?: HermesChatAvatarRole;
  avatarSymbol?: string;
  avatarUrl?: string;
  completedAt?: number;
  content: string;
  createdAt?: number;
  durationMs?: number;
  firstTokenAt?: number;
  /** Local delivery boundaries; never replaced with provider-only latency. */
  submittedAt?: number;
  firstObservedAt?: number;
  completedObservedAt?: number;
  /** True only for a final role response or an authoritative turn terminal. */
  executionComplete?: boolean;
  renderKey?: string;
  finalReport?: boolean;
  handoffTarget?: string;
  id: string;
  /** Canonical hosted-team member id (participants[].id) that produced this event. */
  memberId?: string;
  /** Manager todolist items extracted from the server-side plan metadata. */
  planItems?: unknown;
  /** Provider request boundary used for first-token and terminal model timing. */
  modelStartedAt?: number;
  remotePhase?: string;
  dispatchedAt?: number;
  acceptedAt?: number;
  model?: string;
  name: string;
  optimisticConfirmedAt?: number;
  profile?: string;
  provider?: string;
  /** Server role_stage string before normalization, e.g. worker:pc-worker:rework:1. */
  rawRoleStage?: string;
  role: 'assistant' | 'user';
  roleLabel?: string;
  roleStage?: HermesChatRoleStage;
  runtimeMessageId?: number;
  runtimeSessionId?: string;
  runtimeTurnId?: string;
  /** Authoritative parent-turn completion, independent of individual roles. */
  turnTerminal?: boolean;
  senderId?: string;
  startedAt?: number;
  status?: string;
  timingLabel?: string;
  /** Live agent todo list from the `todo` tool, refreshed on tool.complete. */
  todos?: HermesChatTodo[];
  /** Context-window usage percent reported by the remote node (0-100+). */
  contextUsedPercent?: number;
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  updatedAt?: number;
}

export interface HermesChatAttachment {
  downloadUrl: string;
  id: string;
  mimeType?: string;
  name: string;
  sha256?: string;
  size?: number;
}

export interface HostedTurnVisibilityFailure {
  message: HermesChatViewMessage;
  turnId: string;
}
