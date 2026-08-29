import {
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_FIELDS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
  isHermesSwiftUIRouteActionPayload,
  type HermesSwiftUIRouteActionPayload,
} from './swiftui-route-actions.generated';

export {
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_FIELDS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
} from './swiftui-route-actions.generated';
export type { HermesSwiftUIRouteActionPayload } from './swiftui-route-actions.generated';

export interface HermesSwiftUISessionSnapshot {
  id: string;
  title: string;
  model: string;
  date: string;
  running: boolean;
  profile?: string;
  detail?: string;
  archived?: boolean;
  pinned?: boolean;
  unread?: boolean;
}

export interface HermesSwiftUISessionLineageSnapshot {
  id: string;
  title: string;
  parentSessionId?: string;
  source: string;
  model: string;
  startedAt?: number;
  endedAt?: number;
  messageCount: number;
  toolCallCount: number;
  current: boolean;
}

export interface HermesSwiftUISessionBranchableMessageSnapshot {
  messageId: string;
  role: string;
  runtimeSessionId: string;
  runtimeMessageId: number;
}

export interface HermesSwiftUISessionContextSnapshot {
  conversationId: string;
  sessionId: string;
  profile: string;
  model: string;
  activeMessages: number;
  archivedMessages: number;
  messageTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  compressionLineage: readonly string[];
  compressionCount: number;
  compressionInProgress: boolean;
  parentCount: number;
  childCount: number;
  lineage: readonly HermesSwiftUISessionLineageSnapshot[];
  branchableMessages: readonly HermesSwiftUISessionBranchableMessageSnapshot[];
}

export interface HermesSwiftUIFileSnapshot {
  id: string;
  name: string;
  detail: string;
  folder: boolean;
  createdAt?: number;
  dateLabel?: string;
  fileType?: string;
  mimeType?: string;
  size?: number;
  source?: 'model_output' | 'user_upload';
  status?: 'available' | 'failed' | 'uploading';
  previewText?: string;
  children?: readonly HermesSwiftUIFileSnapshot[];
}

export interface HermesSwiftUIWorkflowSummarySnapshot {
  id: string;
  name: string;
  detail: string;
  revision: number;
  state: string;
  updatedAt?: number;
  activeRunId?: string;
}

export interface HermesSwiftUIWorkflowNodeSnapshot {
  id: string;
  runNodeId?: string;
  label: string;
  kind: string;
  state: string;
  detail: string;
  x?: number;
  y?: number;
  requiresApproval: boolean;
  approvalPending: boolean;
  revision: number;
}

export interface HermesSwiftUIWorkflowEdgeSnapshot {
  id: string;
  source: string;
  target: string;
  label: string;
  state: string;
}

export interface HermesSwiftUIWorkflowRunSnapshot {
  id: string;
  workflowId: string;
  state: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  currentNodeId?: string;
  error?: string;
  canCancel: boolean;
  canRetry: boolean;
  revision: number;
}

export interface HermesSwiftUIWorkspaceChangeSetSnapshot {
  id: string;
  runId: string;
  turnId: string;
  summary: string;
  createdAt?: number;
  fileCount: number;
  byteCount: number;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  renamedCount: number;
}

export interface HermesSwiftUIWorkspaceAuditSnapshot {
  nodeRunId: string;
  runId: string;
  state: string;
  reason: string;
  fileCount: number;
  byteCount: number;
  changeSetId?: string;
  updatedAt?: number;
  finalizedAt?: number;
}

export interface HermesSwiftUIWorkspaceChangeFileSnapshot {
  path: string;
  changeType: string;
  sha256: string;
  byteCount: number;
  patch: string;
}

export interface HermesSwiftUIWorkspaceChangeSetDetailSnapshot {
  id: string;
  runId: string;
  turnId: string;
  summary: string;
  createdAt?: number;
  files: readonly HermesSwiftUIWorkspaceChangeFileSnapshot[];
}

export interface HermesSwiftUIWorkflowSnapshot {
  health?: {
    ok: boolean;
    schemaVersion?: number;
    recoverableRuns?: number;
  };
  selectedWorkflowId?: string;
  workflows: readonly HermesSwiftUIWorkflowSummarySnapshot[];
  nodes: readonly HermesSwiftUIWorkflowNodeSnapshot[];
  edges: readonly HermesSwiftUIWorkflowEdgeSnapshot[];
  run?: HermesSwiftUIWorkflowRunSnapshot;
  changeSets: readonly HermesSwiftUIWorkspaceChangeSetSnapshot[];
  workspaceAudits: readonly HermesSwiftUIWorkspaceAuditSnapshot[];
  selectedChangeSet?: HermesSwiftUIWorkspaceChangeSetDetailSnapshot;
}

export interface HermesSwiftUIApprovalItemSnapshot {
  id: string;
  title: string;
  summary: string;
  subsystem: string;
  action: string;
  origin: string;
  profile: string;
  state: string;
  target: string;
  revision: number;
  createdAt?: number;
  expiresAt?: number;
  diff: string;
  diffAvailable: boolean;
  payloadDigest?: string;
}

export interface HermesSwiftUIApprovalsSnapshot {
  selectedId?: string;
  items: readonly HermesSwiftUIApprovalItemSnapshot[];
  selected?: HermesSwiftUIApprovalItemSnapshot;
}

export interface HermesSwiftUIRuntimeRunSnapshot {
  id: string;
  title: string;
  kind: string;
  state: string;
  profile: string;
  detail: string;
  startedAt?: number;
  completedAt?: number;
  heartbeatAt?: number;
  observedAt?: number;
  durationMs?: number;
  cancelable: boolean;
  retryable: boolean;
  conversationId?: string;
  workflowId?: string;
  error?: string;
  artifactCount: number;
  changeSetId?: string;
  cancelUrl?: string;
  retryUrl?: string;
}

export interface HermesSwiftUIRuntimeSnapshot {
  selectedRunId?: string;
  runs: readonly HermesSwiftUIRuntimeRunSnapshot[];
  selected?: HermesSwiftUIRuntimeRunSnapshot;
}

export interface HermesSwiftUIAnalyticsPointSnapshot {
  id: string;
  label: string;
  input: number;
  output: number;
}

export interface HermesSwiftUIAnalyticsSnapshot {
  inputTokens: string;
  outputTokens: string;
  monthlyCost: string;
  successRate: string;
  points: readonly HermesSwiftUIAnalyticsPointSnapshot[];
}

export interface HermesSwiftUIModelSnapshot {
  id: string;
  model: string;
  provider: string;
  context: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
  apiMode: 'anthropic_messages' | 'chat_completions' | 'codex_responses';
  contextLength: number;
  reasoningEffort: 'high' | 'low' | 'max' | 'medium' | 'minimal' | 'none' | 'ultra' | 'xhigh';
  active: boolean;
  authenticated: boolean;
  selectable: boolean;
  warning: string;
  priceInput: string;
  priceOutput: string;
  priceCache: string;
  free: boolean;
  freeTier: boolean;
  supportsFast: boolean;
  supportsReasoning: boolean;
}

export interface HermesSwiftUIModelConfirmationSnapshot {
  id: string;
  message: string;
  model: string;
  provider: string;
}

export interface HermesSwiftUIRouteOperationSnapshot {
  action: 'model.discover' | 'model.save' | 'model.test' | 'workflow.start';
  message: string;
  requestId?: string;
  state: 'error' | 'running' | 'success';
  targetId?: string;
}

export interface HermesSwiftUILogSnapshot {
  id: string;
  level: string;
  message: string;
  time: string;
}

export interface HermesSwiftUICronJobSnapshot {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  lastRun: string;
}

export interface HermesSwiftUISkillSnapshot {
  id: string;
  name: string;
  detail: string;
  bundled: boolean;
  enabled: boolean;
  content?: string;
  notes?: string;
  source?: string;
}

export interface HermesSwiftUIIntegrationSnapshot {
  id: string;
  name: string;
  detail: string;
  enabled: boolean;
  configuration?: string;
  source?: string;
  canUpdate?: boolean;
  canRemove?: boolean;
  userHidden?: boolean;
  authRequired?: boolean;
  authCommand?: string;
  canTest?: boolean;
  catalogEntry?: boolean;
  catalogNeedsInstall?: boolean;
  catalogRequiredEnv?: readonly string[];
}

export interface HermesSwiftUIModelAuxiliarySnapshot {
  active: string;
  tasks: readonly { task: string; provider: string; model: string }[];
}

export interface HermesSwiftUIModelMoaSnapshot {
  enabled: boolean;
  activePreset: string;
  presetCount: number;
}

export interface HermesSwiftUIManagedInstallationTargetSnapshot {
  nodeId: 'dbb3' | 'server' | 'wsl' | 'hk';
  state: string;
  error: string;
}

export interface HermesSwiftUIManagedInstallationSnapshot {
  id: string;
  identifier: string;
  kind: 'mcp' | 'project' | 'skill';
  state: string;
  error: string;
  health: string;
  version: string;
  tools: readonly string[];
  permissions: readonly string[];
  lastVerifiedAt: string;
  rollbackAvailable: boolean;
  targets: readonly HermesSwiftUIManagedInstallationTargetSnapshot[];
}

export interface HermesSwiftUIPairingSnapshot {
  pending: readonly HermesSwiftUIPairingEntrySnapshot[];
  approved: readonly HermesSwiftUIPairingEntrySnapshot[];
}

export interface HermesSwiftUIPairingEntrySnapshot {
  id: string;
  platform: string;
  userId: string;
  userName: string;
  detail: string;
  /** Official pairing request id used by POST /api/pairing/approve. */
  requestId?: string;
}

export interface HermesSwiftUIAchievementItemSnapshot {
  id: string;
  title: string;
  detail: string;
  symbol: string;
  progress: number;
}

export interface HermesSwiftUIAchievementsSnapshot {
  tasksCompleted: string;
  dayStreak: string;
  shareText: string;
  items: readonly HermesSwiftUIAchievementItemSnapshot[];
}

export interface HermesSwiftUICollaborationRoomSnapshot {
  id: string;
  name: string;
}

export interface HermesSwiftUICollaborationMessageSnapshot {
  id: string;
  text: string;
}

export interface HermesSwiftUICollaborationSnapshot {
  acknowledgedRequestId?: string;
  selectedRoomId?: string;
  availableProfiles: readonly string[];
  rooms: readonly HermesSwiftUICollaborationRoomSnapshot[];
  messages: readonly HermesSwiftUICollaborationMessageSnapshot[];
}

export interface HermesSwiftUIKanbanCardSnapshot {
  id: string;
  title: string;
  detail: string;
}

export interface HermesSwiftUIKanbanColumnSnapshot {
  id: string;
  title: string;
  cards: readonly HermesSwiftUIKanbanCardSnapshot[];
}

export interface HermesSwiftUIProfileSnapshot {
  id: string;
  name: string;
  model: string;
  detail: string;
  description?: string;
  /** Signed placeholder used to adopt a Bot Mode profile's canonical chat. */
  botSessionId?: string;
  /** Upstream Bot Mode presentation metadata mirrored by `/api/bots`. */
  botHidden?: boolean;
  botPinned?: boolean;
  botGroups?: readonly string[];
  /** True when the upstream profile has a server-side avatar asset. */
  botHasAvatar?: boolean;
  /** Bounded data URL fetched from the official profile asset endpoint. */
  botAvatarData?: string;
  active: boolean;
  soul: string;
  terminalAccess: boolean;
  fileAccess: boolean;
  browserAccess: boolean;
}

export interface HermesSwiftUIConfigSnapshot {
  defaultModel: string;
  modelOptions: readonly string[];
  maxIterations: number;
  streamOutput: boolean;
  autoCompact: boolean;
  compactionThreshold: number;
  timezone: string;
  exportText: string;
}

export interface HermesSwiftUIEnvironmentSecretSnapshot {
  id: string;
  key: string;
  maskedValue: string;
}

export interface HermesSwiftUISystemSnapshot {
  cpu: number;
  memory: number;
  disk: number;
  memoryLabel: string;
  uptimeLabel: string;
  activeTasks: string;
  gatewayOnline: boolean;
  metricsAvailable: boolean;
  nodes: readonly HermesSwiftUISystemNodeSnapshot[];
  operationMessage?: string;
  healthLabel?: string;
  egressLabel?: string;
  updateAvailable?: boolean;
  updateVersion?: string;
  updateReceipt?: string;
  curatorPaused?: boolean;
}

/**
 * Official Hermes Git/review surfaces.  Payloads stay JSON encoded because
 * the upstream Git API deliberately evolves its status/branch/worktree
 * records independently of the native route contract.  The iOS page still
 * exposes the same read and confirmed mutation actions as desktop.
 */
export interface HermesSwiftUIGitSnapshot {
  cwd: string;
  root: string;
  branch: string;
  statusJSON: string;
  branchesJSON: string;
  baseBranchesJSON: string;
  worktreesJSON: string;
  reviewJSON: string;
  shipInfoJSON: string;
  ghAuthJSON?: string;
  fileDiffJSON?: string;
  commitContextJSON?: string;
  revParseJSON?: string;
  pullRequestsJSON?: string;
  selectedFile?: string;
  diffJSON?: string;
}

export interface HermesSwiftUISystemNodeSnapshot {
  id: string;
  label: string;
  cpu: number;
  memory: number;
  disk: number;
  memoryLabel: string;
  uptimeLabel: string;
  activeTasks: string;
  gatewayOnline: boolean;
  metricsAvailable: boolean;
  gatewayState: string;
  version: string;
  observedAt: string;
  metricsSource: string;
  recoveryState: string;
}

export interface HermesSwiftUIMemoryProviderSnapshot {
  id: string;
  label: string;
  status: string;
  detail: string;
  active: boolean;
  ready: boolean;
  /** Whether the provider exposes the upstream browser OAuth flow. */
  oauthAvailable?: boolean;
  oauthConnected?: boolean;
  oauthState?: string;
  /** JSON-encoded declared provider schema for the native configuration sheet. */
  configJSON?: string;
  modelsJSON?: string;
  providersJSON?: string;
  environmentJSON?: string;
  postSetupJSON?: string;
}

export interface HermesSwiftUIToolsetSnapshot {
  id: string;
  name: string;
  detail: string;
  enabled: boolean;
  configured: boolean;
  tools: readonly string[];
  /** Declared upstream provider schema/config, serialized for the native detail sheet. */
  configJSON?: string;
}

export interface HermesSwiftUIMemorySnapshot {
  active: string;
  memoryBytes: number;
  userBytes: number;
  providers: readonly HermesSwiftUIMemoryProviderSnapshot[];
}

export interface HermesSwiftUIRouteSnapshot {
  version: typeof HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION;
  route?: string;
  sessions?: readonly HermesSwiftUISessionSnapshot[];
  sessionContext?: HermesSwiftUISessionContextSnapshot;
  /** JSON encoded official session sidebar/project/PR/statistics surfaces. */
  sessionSidebarJSON?: string;
  sessionProjectsJSON?: string;
  sessionPullRequestsJSON?: string;
  sessionStatsJSON?: string;
  files?: readonly HermesSwiftUIFileSnapshot[];
  git?: HermesSwiftUIGitSnapshot;
  workflows?: HermesSwiftUIWorkflowSnapshot;
  approvals?: HermesSwiftUIApprovalsSnapshot;
  runtime?: HermesSwiftUIRuntimeSnapshot;
  analytics?: HermesSwiftUIAnalyticsSnapshot;
  models?: readonly HermesSwiftUIModelSnapshot[];
  modelConfirmation?: HermesSwiftUIModelConfirmationSnapshot;
  modelAuxiliary?: HermesSwiftUIModelAuxiliarySnapshot;
  modelMoa?: HermesSwiftUIModelMoaSnapshot;
  providerOauthJSON?: string;
  customProviderEndpointsJSON?: string;
  detectedModels?: readonly string[];
  operation?: HermesSwiftUIRouteOperationSnapshot;
  logs?: readonly HermesSwiftUILogSnapshot[];
  cron?: readonly HermesSwiftUICronJobSnapshot[];
  /** JSON-encoded official cron blueprint and delivery-target catalogs. */
  cronBlueprintsJSON?: string;
  cronDeliveryTargetsJSON?: string;
  cronRunsJSON?: string;
  skills?: readonly HermesSwiftUISkillSnapshot[];
  toolsets?: readonly HermesSwiftUIToolsetSnapshot[];
  terminalBackendsJSON?: string;
  computerUseJSON?: string;
  skillHubSourcesJSON?: string;
  learningGraphJSON?: string;
  skillHubResultJSON?: string;
  integrations?: readonly HermesSwiftUIIntegrationSnapshot[];
  installations?: readonly HermesSwiftUIManagedInstallationSnapshot[];
  pairing?: HermesSwiftUIPairingSnapshot;
  achievements?: HermesSwiftUIAchievementsSnapshot;
  collaboration?: HermesSwiftUICollaborationSnapshot;
  kanban?: readonly HermesSwiftUIKanbanColumnSnapshot[];
  profiles?: readonly HermesSwiftUIProfileSnapshot[];
  /** JSON-encoded upstream Bot Mode cross-connection roster. */
  botRelayJSON?: string;
  /** JSON-encoded upstream Petdex gallery used by Bot avatar selection. */
  botPetJSON?: string;
  /** JSON-encoded cron jobs keyed by Bot profile for the Bot Mode routines view. */
  botRoutinesJSON?: string;
  config?: HermesSwiftUIConfigSnapshot;
  environment?: readonly HermesSwiftUIEnvironmentSecretSnapshot[];
  system?: HermesSwiftUISystemSnapshot;
  /** JSON encoded /api/ops/hooks response for native hook management. */
  systemHooksJSON?: string;
  memory?: HermesSwiftUIMemorySnapshot;
}

export type HermesSwiftUIRouteAction =
  typeof HERMES_SWIFTUI_ROUTE_ACTIONS[keyof typeof HERMES_SWIFTUI_ROUTE_ACTIONS];

export interface HermesSwiftUIRouteActionEvent {
  action: HermesSwiftUIRouteAction;
  payload: HermesSwiftUIRouteActionPayload;
}

const actionNames = new Set<HermesSwiftUIRouteAction>(
  Object.values(HERMES_SWIFTUI_ROUTE_ACTIONS),
);

const snapshotRecordArrays = [
  'sessions',
  'files',
  'models',
  'logs',
  'cron',
  'skills',
  'toolsets',
  'integrations',
  'installations',
  'kanban',
  'profiles',
  'environment',
] as const;
const snapshotRecords = [
  'sessionContext',
  'git',
  'workflows',
  'approvals',
  'runtime',
  'analytics',
  'modelConfirmation',
  'operation',
  'pairing',
  'achievements',
  'collaboration',
  'config',
  'system',
  'memory',
  'modelAuxiliary',
  'modelMoa',
] as const;
const snapshotFieldNames = new Set<string>(HERMES_SWIFTUI_ROUTE_SNAPSHOT_FIELDS);

export function encodeHermesSwiftUIRouteSnapshot(
  snapshot: HermesSwiftUIRouteSnapshot,
): string {
  if (!isHermesSwiftUIRouteSnapshot(snapshot)) {
    throw new TypeError('Invalid Hermes SwiftUI route snapshot');
  }
  return JSON.stringify(snapshot);
}

export function isHermesSwiftUIRouteSnapshot(
  value: unknown,
): value is HermesSwiftUIRouteSnapshot {
  if (!isRecord(value) || value.version !== HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION) {
    return false;
  }
  if (Object.keys(value).some((field) => !snapshotFieldNames.has(field))) return false;
  if (value.route !== undefined && typeof value.route !== 'string') return false;
  for (const field of snapshotRecordArrays) {
    const candidate = value[field];
    if (
      candidate !== undefined
      && (!Array.isArray(candidate) || candidate.some((entry) => !isRecord(entry)))
    ) return false;
  }
  for (const field of snapshotRecords) {
    const candidate = value[field];
    if (candidate !== undefined && !isRecord(candidate)) return false;
  }
  if (
    value.detectedModels !== undefined
    && (!Array.isArray(value.detectedModels)
      || value.detectedModels.some((model) => typeof model !== 'string'))
  ) return false;
  return true;
}

export function decodeHermesSwiftUIRouteAction(
  action: string,
  payloadJson: string,
): HermesSwiftUIRouteActionEvent | null {
  if (!actionNames.has(action as HermesSwiftUIRouteAction)) return null;

  try {
    const payload = JSON.parse(payloadJson) as unknown;
    if (!isHermesSwiftUIRouteActionPayload(payload)) return null;
    return {
      action: action as HermesSwiftUIRouteAction,
      payload,
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
