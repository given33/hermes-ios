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
  gatewayState: string;
  version: string;
  observedAt: string;
  metricsSource: string;
}

export interface HermesSwiftUIRouteSnapshot {
  version: typeof HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION;
  route?: string;
  sessions?: readonly HermesSwiftUISessionSnapshot[];
  files?: readonly HermesSwiftUIFileSnapshot[];
  analytics?: HermesSwiftUIAnalyticsSnapshot;
  models?: readonly HermesSwiftUIModelSnapshot[];
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
  fileSelect: 'file.select',
  fileDelete: 'file.delete',
  fileDownload: 'file.download',
  fileShare: 'file.share',
  fileImport: 'file.import',
  folderCreate: 'folder.create',
  modelSelect: 'model.select',
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
  environmentUpsert: 'environment.upsert',
  environmentDelete: 'environment.delete',
  systemRestart: 'system.restart',
  systemUpdate: 'system.update',
  kanbanCreate: 'kanban.create',
  kanbanUpdate: 'kanban.update',
  kanbanMove: 'kanban.move',
  kanbanDelete: 'kanban.delete',
  collaborationSelect: 'collaboration.select',
  collaborationCreate: 'collaboration.create',
  collaborationDelete: 'collaboration.delete',
  collaborationSend: 'collaboration.send',
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
