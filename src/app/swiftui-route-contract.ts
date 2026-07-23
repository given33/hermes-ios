export const HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION = 1 as const;

export interface HermesSwiftUISessionSnapshot {
  id: string;
  title: string;
  model: string;
  date: string;
  running: boolean;
  profile?: string;
  detail?: string;
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

export interface HermesSwiftUIRouteSnapshot {
  version: typeof HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION;
  route?: string;
  sessions?: readonly HermesSwiftUISessionSnapshot[];
  sessionContext?: HermesSwiftUISessionContextSnapshot;
  files?: readonly HermesSwiftUIFileSnapshot[];
  workflows?: HermesSwiftUIWorkflowSnapshot;
  approvals?: HermesSwiftUIApprovalsSnapshot;
  runtime?: HermesSwiftUIRuntimeSnapshot;
  analytics?: HermesSwiftUIAnalyticsSnapshot;
  models?: readonly HermesSwiftUIModelSnapshot[];
  modelConfirmation?: HermesSwiftUIModelConfirmationSnapshot;
  detectedModels?: readonly string[];
  operation?: HermesSwiftUIRouteOperationSnapshot;
  logs?: readonly HermesSwiftUILogSnapshot[];
  cron?: readonly HermesSwiftUICronJobSnapshot[];
  skills?: readonly HermesSwiftUISkillSnapshot[];
  integrations?: readonly HermesSwiftUIIntegrationSnapshot[];
  pairing?: HermesSwiftUIPairingSnapshot;
  achievements?: HermesSwiftUIAchievementsSnapshot;
  collaboration?: HermesSwiftUICollaborationSnapshot;
  kanban?: readonly HermesSwiftUIKanbanColumnSnapshot[];
  profiles?: readonly HermesSwiftUIProfileSnapshot[];
  config?: HermesSwiftUIConfigSnapshot;
  environment?: readonly HermesSwiftUIEnvironmentSecretSnapshot[];
  system?: HermesSwiftUISystemSnapshot;
}

export const HERMES_SWIFTUI_ROUTE_ACTIONS = {
  refresh: 'route.refresh',
  sessionSelect: 'session.select',
  sessionOpen: 'session.open',
  sessionDelete: 'session.delete',
  sessionRename: 'session.rename',
  sessionCompress: 'session.compress',
  fileSelect: 'file.select',
  fileDelete: 'file.delete',
  fileDownload: 'file.download',
  fileShare: 'file.share',
  fileImport: 'file.import',
  folderCreate: 'folder.create',
  modelSelect: 'model.select',
  modelSelectCancel: 'model.select.cancel',
  modelDiscover: 'model.discover',
  modelSave: 'model.save',
  modelTest: 'model.test',
  logsFilter: 'logs.filter',
  cronCreate: 'cron.create',
  cronToggle: 'cron.toggle',
  cronRun: 'cron.run',
  cronDelete: 'cron.delete',
  skillToggle: 'skill.toggle',
  skillSelect: 'skill.select',
  skillView: 'skill.view',
  skillUpdate: 'skill.update',
  integrationCreate: 'integration.create',
  integrationUpdate: 'integration.update',
  integrationToggle: 'integration.toggle',
  integrationDelete: 'integration.delete',
  pairingApprove: 'pairing.approve',
  pairingRevoke: 'pairing.revoke',
  pairingClearPending: 'pairing.clear-pending',
  achievementsRescan: 'achievements.rescan',
  profileCreate: 'profile.create',
  profileUpdate: 'profile.update',
  profileActivate: 'profile.activate',
  profileDelete: 'profile.delete',
  configUpdate: 'config.update',
  configImport: 'config.import',
  environmentDelete: 'environment.delete',
  systemRestart: 'system.restart',
  systemRecover: 'system.recover',
  systemUpdate: 'system.update',
  kanbanCreate: 'kanban.create',
  kanbanUpdate: 'kanban.update',
  kanbanMove: 'kanban.move',
  kanbanDelete: 'kanban.delete',
  collaborationSelect: 'collaboration.select',
  collaborationCreate: 'collaboration.create',
  collaborationDelete: 'collaboration.delete',
  collaborationSend: 'collaboration.send',
  workflowSelect: 'workflow.select',
  workflowStart: 'workflow.start',
  workflowCancel: 'workflow.cancel',
  workflowRetry: 'workflow.retry',
  workflowApprove: 'workflow.approve',
  approvalSelect: 'approval.select',
  approvalApprove: 'approval.approve',
  approvalReject: 'approval.reject',
  runtimeSelect: 'runtime.select',
  runtimeCancel: 'runtime.cancel',
  runtimeRetry: 'runtime.retry',
} as const;

export type HermesSwiftUIRouteAction =
  typeof HERMES_SWIFTUI_ROUTE_ACTIONS[keyof typeof HERMES_SWIFTUI_ROUTE_ACTIONS];

export interface HermesSwiftUIRouteActionPayload {
  route: string;
  id?: string;
  name?: string;
  value?: string;
  detail?: string;
  targetId?: string;
  enabled?: boolean;
  position?: number;
  requestId?: string;
  fields?: Readonly<Record<string, string>>;
  uris?: readonly string[];
}

export interface HermesSwiftUIRouteActionEvent {
  action: HermesSwiftUIRouteAction;
  payload: HermesSwiftUIRouteActionPayload;
}

const actionNames = new Set<HermesSwiftUIRouteAction>(
  Object.values(HERMES_SWIFTUI_ROUTE_ACTIONS),
);

export function encodeHermesSwiftUIRouteSnapshot(
  snapshot: HermesSwiftUIRouteSnapshot,
): string {
  return JSON.stringify(snapshot);
}

export function decodeHermesSwiftUIRouteAction(
  action: string,
  payloadJson: string,
): HermesSwiftUIRouteActionEvent | null {
  if (!actionNames.has(action as HermesSwiftUIRouteAction)) return null;

  try {
    const payload = JSON.parse(payloadJson) as unknown;
    if (!isActionPayload(payload)) return null;
    return {
      action: action as HermesSwiftUIRouteAction,
      payload,
    };
  } catch {
    return null;
  }
}

function isActionPayload(value: unknown): value is HermesSwiftUIRouteActionPayload {
  if (!isRecord(value) || typeof value.route !== 'string') return false;
  if (value.id !== undefined && typeof value.id !== 'string') return false;
  if (value.name !== undefined && typeof value.name !== 'string') return false;
  if (value.value !== undefined && typeof value.value !== 'string') return false;
  if (value.detail !== undefined && typeof value.detail !== 'string') return false;
  if (value.targetId !== undefined && typeof value.targetId !== 'string') return false;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return false;
  if (value.position !== undefined && typeof value.position !== 'number') return false;
  if (value.requestId !== undefined && typeof value.requestId !== 'string') return false;
  if (
    value.fields !== undefined
    && (!isRecord(value.fields)
      || Object.values(value.fields).some((field) => typeof field !== 'string'))
  ) {
    return false;
  }
  if (
    value.uris !== undefined
    && (!Array.isArray(value.uris) || value.uris.some((uri) => typeof uri !== 'string'))
  ) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
