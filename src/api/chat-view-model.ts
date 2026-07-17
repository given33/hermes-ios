import type {
  CollaborationMessage,
  SingleConversation,
} from './HermesCloudApi';

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
  | 'pc-worker'
  | 'reporter'
  | 'reviewer'
  | 'user';

export type HermesChatRoleStage =
  | 'chat'
  | 'dispatcher'
  | 'reporter'
  | 'reviewer'
  | 'worker';

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
}

export interface HermesChatViewMessage {
  activities?: HermesChatActivity[];
  attachments?: HermesChatAttachment[];
  avatarRole?: HermesChatAvatarRole;
  avatarSymbol?: string;
  avatarUrl?: string;
  completedAt?: number;
  content: string;
  createdAt?: number;
  durationMs?: number;
  handoffTarget?: string;
  id: string;
  model?: string;
  name: string;
  profile?: string;
  provider?: string;
  role: 'assistant' | 'user';
  roleLabel?: string;
  roleStage?: HermesChatRoleStage;
  senderId?: string;
  startedAt?: number;
  status?: string;
  updatedAt?: number;
}

export interface HermesChatAttachment {
  downloadUrl: string;
  id: string;
  mimeType?: string;
  name: string;
  size?: number;
}

const TERMINAL_TURN_STATES = new Set([
  'cancelled',
  'completed',
  'failed',
  'stopped',
]);

export function conversationMessagesToView(
  conversation: SingleConversation,
  chinese = true,
): HermesChatViewMessage[] {
  const converted = (conversation.messages ?? []).flatMap((message) => {
    const converted = collaborationMessageToView(message, chinese);
    return converted ? [converted] : [];
  });
  return deduplicateMessages(converted);
}

export function chatModelConfigurationError(
  source: { custom?: unknown; info: unknown; options: unknown },
  chinese = true,
): string | null {
  const info = isRecord(source.info) ? source.info : {};
  const options = isRecord(source.options) ? source.options : {};
  const custom = isRecord(source.custom) ? source.custom : {};
  const model = stringValue(custom.model) || stringValue(info.model) || stringValue(options.model);
  const provider = stringValue(info.provider) || stringValue(options.provider);
  const customBaseUrl = stringValue(custom.baseUrl);
  const customKeyConfigured = custom.apiKeyConfigured === true;
  if (!model || (Object.keys(custom).length > 0 && (!customBaseUrl || !customKeyConfigured))) {
    return chinese
      ? '尚未配置可用模型。请先在“模型与工具”中填写 Base URL、API 密钥并选择模型。'
      : 'No usable model is configured. Add a Base URL and API key, then select a model in Model & tools.';
  }
  const providers = Array.isArray(options.providers) ? options.providers : [];
  const currentProvider = providers.find((entry) => {
    if (!isRecord(entry)) return false;
    const slug = stringValue(entry.slug) || stringValue(entry.name);
    return Boolean(provider) && slug.toLowerCase() === provider.toLowerCase();
  });
  if (isRecord(currentProvider) && currentProvider.authenticated === false) {
    return chinese
      ? '当前模型没有可用的连接凭据。请在“模型与工具”中检查 Base URL 和 API 密钥后重试。'
      : 'The current model has no usable credentials. Check its Base URL and API key in Model & tools.';
  }
  return null;
}

export function shouldRenderPendingMessage(
  messages: HermesChatViewMessage[],
  sending: boolean,
): boolean {
  return sending && messages[messages.length - 1]?.role !== 'assistant';
}

export function upsertChatMessage(
  messages: HermesChatViewMessage[],
  message: HermesChatViewMessage,
): HermesChatViewMessage[] {
  const index = messages.findIndex(({ id }) => id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((current, currentIndex) => (
    currentIndex === index ? { ...current, ...message } : current
  ));
}

export function collaborationMessageToView(
  message: CollaborationMessage,
  chinese = true,
): HermesChatViewMessage | null {
  const kind = message.kind ?? '';
  if (kind === 'route') return null;
  const isUser = message.role === 'user';
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const meta = {
    ...metadata,
    ...(isRecord(message.meta) ? message.meta : {}),
  };
  const logicalRole = stringValue(message.sender_role)
    || stringValue(message.collaboration_role)
    || stringValue(meta.role_stage)
    || message.role;
  const logicalRoleBase = logicalRole.toLowerCase().split(/[.:/]/, 1)[0];
  const isVisibleSystemEvent = message.role === 'system'
    && (kind === 'workflow' || Boolean(stringValue(message.sender_role) || stringValue(message.collaboration_role)));
  const isAssistantRole = [
    'assistant',
    'chat',
    'dbb3-worker',
    'dbb3_worker',
    'dispatch',
    'dispatcher',
    'manager',
    'hermes',
    'pc-worker',
    'pc_worker',
    'pc-wsl-worker',
    'pc_wsl_worker',
    'reporter',
    'reviewer',
    'worker',
  ].includes(logicalRoleBase);
  if (!isUser && !isAssistantRole && !isVisibleSystemEvent) return null;
  const roleStage = normalizeRoleStage(logicalRole, isUser);
  const profile = stringValue(message.profile)
    || stringValue(meta.profile)
    || stringValue(message.name);
  const senderName = stringValue(message.sender_name)
    || stringValue(message.sender)
    || stringValue(meta.sender_name)
    || stringValue(message.name);
  const name = isUser
    ? chinese ? '你' : 'You'
    : profileDisplayName(senderName || profile, roleStage, chinese);
  const roleLabel = stringValue(message.role_label)
    || stringValue(meta.role_label)
    || roleStageLabel(roleStage || 'chat', chinese);
  const provider = stringValue(message.provider)
    || stringValue(meta.actual_provider)
    || stringValue(meta.provider);
  const model = stringValue(message.model)
    || stringValue(meta.actual_model)
    || stringValue(meta.model);
  const activities = mapActivities(message, meta);
  const createdAt = timestampValue(message.created_at)
    || timestampValue(message.timestamp)
    || timestampValue(meta.created_at);
  const startedAt = timestampValue(message.started_at)
    || timestampValue(meta.started_at)
    || createdAt
    || firstActivityTimestamp(activities);
  const status = normalizeMessageStatus(
    message.status
      || meta.status
      || (activities?.some(({ status }) => status === 'running') ? 'running' : 'completed'),
  );
  const terminal = isTerminalStatus(status);
  const serverUpdatedAt = timestampValue(message.updated_at)
    || timestampValue(meta.updated_at);
  const completedAt = timestampValue(message.completed_at)
    || timestampValue(meta.completed_at)
    || (terminal ? serverUpdatedAt : 0)
    || (terminal ? lastActivityTimestamp(activities) : 0);
  const updatedAt = serverUpdatedAt
    || completedAt
    || createdAt;
  const explicitDuration = numberValue(meta.duration_ms);
  const durationMs = explicitDuration > 0
    ? explicitDuration
    : calculateDurationMs(startedAt, completedAt || updatedAt, activities);
  return {
    activities,
    attachments: mapMessageAttachments([
      ...(Array.isArray(message.attachments) ? message.attachments : []),
      ...(Array.isArray(meta.attachments) ? meta.attachments : []),
    ]),
    avatarRole: avatarRoleFor(profile, roleStage, isUser),
    avatarSymbol: stringValue(message.avatar_symbol)
      || stringValue(meta.avatar_symbol)
      || undefined,
    avatarUrl: stringValue(message.avatar)
      || stringValue(meta.avatar)
      || stringValue(meta.avatar_url)
      || undefined,
    completedAt: completedAt || undefined,
    content: message.content || '',
    createdAt: createdAt || undefined,
    durationMs,
    handoffTarget: stringListValue(message.handoff_to)
      || stringListValue(meta.handoff_to)
      || stringListValue(meta.handoff_target)
      || undefined,
    id: message.id,
    model: [provider, model].filter(Boolean).join(' · ') || undefined,
    name,
    profile: profile || undefined,
    provider: provider || undefined,
    role: isUser ? 'user' : 'assistant',
    roleLabel,
    roleStage,
    senderId: stringValue(message.sender_id)
      || stringValue(meta.sender_id)
      || undefined,
    startedAt: startedAt || undefined,
    status,
    updatedAt: updatedAt || undefined,
  };
}

function mapMessageAttachments(value: unknown): HermesChatAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments = value.flatMap((entry): HermesChatAttachment[] => {
    if (!isRecord(entry)) return [];
    const downloadUrl = stringValue(entry.download_url);
    const name = stringValue(entry.name);
    if (!downloadUrl || !name) return [];
    const size = numberValue(entry.size);
    return [{
      downloadUrl,
      id: stringValue(entry.id) || downloadUrl,
      mimeType: stringValue(entry.mime_type) || undefined,
      name,
      size: size > 0 ? size : undefined,
    }];
  });
  return [...new Map(attachments.map((attachment) => [attachment.id, attachment])).values()];
}

export function conversationHasRunningWork(conversation: SingleConversation): boolean {
  return hasRunningRecord(conversation.hosted_turns)
    || hasRunningRecord(conversation.runtime_runs);
}

export function conversationRunningHostedTurnId(conversation: SingleConversation): string {
  const running = Object.entries(conversation.hosted_turns || {}).flatMap(([key, record]) => {
    if (!isRecord(record)) return [];
    const status = stringValue(record.status).toLowerCase();
    if (status && TERMINAL_TURN_STATES.has(status)) return [];
    const id = stringValue(record.turn_id) || stringValue(record.id) || key;
    if (!id) return [];
    return [{
      id,
      timestamp: timestampValue(record.updated_at)
        || timestampValue(record.created_at)
        || timestampValue(record.started_at),
    }];
  });
  running.sort((left, right) => right.timestamp - left.timestamp);
  return running[0]?.id || '';
}

export function attachmentContext(
  attachments: Array<{ name?: unknown; path?: unknown; relative_path?: unknown }>,
): string {
  const lines = attachments.flatMap((attachment) => {
    const name = stringValue(attachment.name);
    const path = stringValue(attachment.path) || stringValue(attachment.relative_path);
    return name || path ? [`- ${name || path}${path && path !== name ? `: ${path}` : ''}`] : [];
  });
  return lines.length ? `用户为本轮上传的附件：\n${lines.join('\n')}` : '';
}

export function streamEventToActivity(
  eventType: string,
  payload: Record<string, unknown>,
  now = Date.now(),
): HermesChatActivity | null {
  if (eventType === 'reasoning.delta' || eventType === 'reasoning.available') {
    const text = structuredText(payload.text);
    if (!text) return null;
    return {
      category: 'reasoning',
      completedAt: eventType === 'reasoning.available' ? now : undefined,
      duration: '',
      durationMs: 0,
      id: stringValue(payload.id) || `reasoning-${now}`,
      name: '模型思考',
      output: text,
      preview: text.slice(0, 80),
      startedAt: timestampValue(payload.started_at) || now,
      status: eventType === 'reasoning.delta' ? 'running' : 'completed',
    };
  }
  if (!eventType.startsWith('tool.')) return null;
  const name = stringValue(payload.name) || '工具调用';
  const status = eventType === 'tool.error'
    ? 'failed'
    : eventType === 'tool.end' || eventType === 'tool.complete'
      ? 'completed'
      : 'running';
  const durationMs = numberValue(payload.duration_ms)
    || numberValue(payload.duration_s) * 1_000;
  const startedAt = timestampValue(payload.started_at);
  const completedAt = timestampValue(payload.completed_at ?? payload.ended_at);
  return {
    category: activityCategory(name),
    completedAt: completedAt || undefined,
    detail: structuredText(payload.detail) || undefined,
    duration: formatDuration(durationMs),
    durationMs,
    error: structuredText(payload.error) || undefined,
    id: stringValue(payload.tool_id) || `tool-${now}`,
    input: structuredText(
      payload.args_text ?? payload.args ?? payload.input ?? payload.context,
    ) || undefined,
    model: stringValue(payload.model) || undefined,
    name,
    output: structuredText(
      payload.output ?? payload.result_text ?? payload.result,
    ) || undefined,
    preview: structuredText(payload.preview ?? payload.summary) || name,
    provider: stringValue(payload.provider) || undefined,
    startedAt: startedAt || undefined,
    status,
    toolName: stringValue(payload.tool_name) || name,
  };
}

function mapActivities(
  message: CollaborationMessage,
  meta: Record<string, unknown>,
): HermesChatActivity[] | undefined {
  const sources: Array<[unknown, string]> = [
    [message.activities, ''],
    [meta.activities, ''],
    [meta.activity_events, ''],
    [meta.tool_calls, 'tool'],
    [meta.reasoning, 'reasoning'],
    [meta.reasoning_events, 'reasoning'],
    [meta.searches, 'search'],
    [meta.search_events, 'search'],
    [meta.files, 'file'],
    [meta.file_events, 'file'],
    [meta.commands, 'command'],
    [meta.command_events, 'command'],
  ];
  const mapped = sources.flatMap(([value, fallbackCategory]) => (
    activityItems(value).map(({ item, sourceIndex }) => (
      activityFromRecord(item, sourceIndex, fallbackCategory)
    ))
  ));
  const byId = new Map<string, HermesChatActivity>();
  for (const activity of mapped) {
    const existing = byId.get(activity.id);
    byId.set(activity.id, existing ? mergeActivity(existing, activity) : activity);
  }
  const activities = [...byId.values()].sort((left, right) => (
    (left.startedAt || 0) - (right.startedAt || 0)
  ));
  return activities.length ? activities : undefined;
}

function activityItems(value: unknown): Array<{
  item: Record<string, unknown>;
  sourceIndex: number;
}> {
  if (Array.isArray(value)) {
    return value.flatMap((item, sourceIndex) => (
      isRecord(item) ? [{ item, sourceIndex }] : []
    ));
  }
  return isRecord(value) ? [{ item: value, sourceIndex: 0 }] : [];
}

function activityFromRecord(
  item: Record<string, unknown>,
  sourceIndex: number,
  fallbackCategory: string,
): HermesChatActivity {
  const toolName = stringValue(item.tool_name);
  const kind = stringValue(item.kind) || fallbackCategory;
  const name = stringValue(item.name)
    || stringValue(item.label)
    || toolName
    || stringValue(item.title)
    || stringValue(item.event_type)
    || activityFallbackName(kind);
  const category = normalizedActivityCategory(
    stringValue(item.category) || fallbackCategory || kind,
    name,
  );
  const startedAt = timestampValue(
    item.started_at ?? item.created_at ?? item.timestamp,
  );
  const completedAt = timestampValue(
    item.completed_at ?? item.ended_at ?? item.updated_at,
  );
  const explicitDuration = numberValue(item.duration_ms)
    || numberValue(item.duration_seconds) * 1_000
    || numberValue(item.duration_s) * 1_000
    || numberValue(item.duration) * 1_000;
  const durationMs = explicitDuration > 0
    ? explicitDuration
    : startedAt && completedAt
      ? Math.max(0, completedAt - startedAt)
      : 0;
  const detail = structuredText(item.detail ?? item.metadata);
  const error = structuredText(item.error);
  const output = structuredText(
    item.output ?? item.output_text ?? item.result_text ?? item.result ?? item.response,
  );
  const input = structuredText(
    item.input ?? item.input_text ?? item.args_text ?? item.args ?? item.command ?? item.query ?? item.request,
  );
  const preview = structuredText(item.preview ?? item.summary)
    || detail.slice(0, 160)
    || output.slice(0, 160)
    || name;
  const rawId = stringValue(item.id)
    || stringValue(item.activity_id)
    || stringValue(item.tool_id)
    || stringValue(item.seq);
  return {
    category,
    completedAt: completedAt || undefined,
    detail: detail || undefined,
    duration: stringValue(item.duration) || formatDuration(durationMs),
    durationMs,
    error: error || undefined,
    id: rawId || `${category}-${sourceIndex}-${startedAt || name}`,
    input: input || undefined,
    model: stringValue(item.model) || undefined,
    name,
    output: output || undefined,
    preview,
    provider: stringValue(item.provider) || undefined,
    startedAt: startedAt || undefined,
    status: normalizeStatus(item.status),
    toolName: toolName || undefined,
  };
}

function mergeActivity(
  current: HermesChatActivity,
  next: HermesChatActivity,
): HermesChatActivity {
  return {
    ...current,
    ...next,
    completedAt: next.completedAt || current.completedAt,
    detail: next.detail || current.detail,
    duration: next.duration || current.duration,
    durationMs: next.durationMs || current.durationMs,
    error: next.error || current.error,
    input: next.input || current.input,
    model: next.model || current.model,
    output: next.output || current.output,
    preview: next.preview || current.preview,
    provider: next.provider || current.provider,
    startedAt: next.startedAt || current.startedAt,
    toolName: next.toolName || current.toolName,
  };
}

function deduplicateMessages(messages: HermesChatViewMessage[]): HermesChatViewMessage[] {
  const indices = new Map<string, number>();
  const result: HermesChatViewMessage[] = [];
  for (const message of messages) {
    const existingIndex = indices.get(message.id);
    if (existingIndex === undefined) {
      indices.set(message.id, result.length);
      result.push(message);
    } else {
      result[existingIndex] = message;
    }
  }
  return result;
}

function hasRunningRecord(records: SingleConversation['hosted_turns'] | undefined): boolean {
  if (!records) return false;
  return Object.values(records).some((record) => {
    if (!isRecord(record)) return false;
    const status = stringValue(record.status).toLowerCase();
    return !status || !TERMINAL_TURN_STATES.has(status);
  });
}

function normalizeRoleStage(
  value: unknown,
  isUser: boolean,
): HermesChatViewMessage['roleStage'] {
  if (isUser) return 'chat';
  const normalized = stringValue(value).toLowerCase();
  if (/dispatch|manager|workflow/.test(normalized)) {
    return 'dispatcher';
  }
  if (/review/.test(normalized)) return 'reviewer';
  if (/report/.test(normalized)) return 'reporter';
  if (/worker|executor/.test(normalized)) return 'worker';
  return 'chat';
}

function normalizeStatus(value: unknown): HermesChatActivityStatus {
  const normalized = stringValue(value).toLowerCase();
  if (normalized === 'failed' || normalized === 'error') return 'failed';
  if (normalized === 'running' || normalized === 'streaming') return 'running';
  if (normalized === 'queued' || normalized === 'pending' || normalized === 'starting') {
    return 'queued';
  }
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'stopped') {
    return 'cancelled';
  }
  return 'completed';
}

function normalizeMessageStatus(value: unknown): string {
  return normalizeStatus(value);
}

function profileDisplayName(
  profile: string,
  stage: HermesChatViewMessage['roleStage'],
  chinese: boolean,
): string {
  if (stage === 'dispatcher') return chinese ? 'Hermes 调度员' : 'Hermes Dispatcher';
  if (stage === 'reporter') return chinese ? 'Hermes 汇报员' : 'Hermes Reporter';
  if (stage === 'reviewer' && !profile) return chinese ? 'Hermes 审阅员' : 'Hermes Reviewer';
  if (!chinese) {
    const names: Record<string, string> = {
      default: 'Hermes',
      'dbb3-worker': 'DBB3 Worker',
      'pc-worker': 'PC/WSL Worker',
      reviewer: 'Hermes Reviewer',
    };
    return names[profile.toLowerCase()] || profile || 'Hermes Agent';
  }
  const names: Record<string, string> = {
    default: 'Hermes',
    'dbb3-worker': 'DBB3 执行员',
    'pc-worker': 'PC/WSL 执行员',
    reviewer: 'Hermes 审阅员',
  };
  return names[profile.toLowerCase()] || profile || 'Hermes Agent';
}

function roleStageLabel(
  stage: NonNullable<HermesChatViewMessage['roleStage']>,
  chinese: boolean,
): string {
  if (!chinese) {
    return {
      chat: 'Hermes Agent',
      dispatcher: 'Task dispatch',
      reporter: 'Final report',
      reviewer: 'Review',
      worker: 'Execution',
    }[stage];
  }
  return {
    chat: 'Hermes Agent',
    dispatcher: '任务调度',
    reporter: '最终汇报',
    reviewer: '结果审阅',
    worker: '任务执行',
  }[stage];
}

function activityCategory(name: string): string {
  const lowered = name.toLowerCase();
  if (/file|read|write|patch|文件/.test(lowered)) return 'file';
  if (/browser|search|web|浏览|搜索/.test(lowered)) return 'browser';
  if (/mcp/.test(lowered)) return 'mcp';
  if (/skill|技能/.test(lowered)) return 'skill';
  return 'command';
}

function normalizedActivityCategory(category: string, name: string): string {
  const normalized = category.toLowerCase();
  if (/reason|think|思考|推理/.test(normalized)) return 'reasoning';
  if (/search|browser|web|搜索|浏览/.test(normalized)) return 'search';
  if (/file|文件/.test(normalized)) return 'file';
  if (/command|terminal|shell|命令/.test(normalized)) return 'command';
  if (/model|模型/.test(normalized)) return 'model';
  if (/mcp/.test(normalized)) return 'mcp';
  if (/skill|技能/.test(normalized)) return 'skill';
  if (/subagent|agent|子任务/.test(normalized)) return 'subagent';
  if (/handoff|dispatch|交接|调度/.test(normalized)) return 'handoff';
  if (/status|retry|状态|重试/.test(normalized)) return 'status';
  return activityCategory(name);
}

function activityFallbackName(category: string): string {
  return {
    command: '命令行',
    file: '文件操作',
    handoff: '任务交接',
    model: '模型调用',
    reasoning: '模型思考',
    search: '搜索',
    status: '运行状态',
    subagent: '子 Agent',
    tool: '工具调用',
  }[normalizedActivityCategory(category, category)] || '工具调用';
}

export function avatarRoleFor(
  profile: string,
  stage: HermesChatViewMessage['roleStage'],
  isUser = false,
): HermesChatAvatarRole {
  if (isUser) return 'user';
  if (stage === 'dispatcher') return 'dispatcher';
  if (stage === 'reporter') return 'reporter';
  if (stage === 'reviewer') return 'reviewer';
  const normalized = profile.toLowerCase();
  if (/dbb3/.test(normalized)) return 'dbb3-worker';
  if (/pc|wsl|windows|local/.test(normalized)) return 'pc-worker';
  if (/review/.test(normalized)) return 'reviewer';
  return 'hermes';
}

export function activityCategoryLabel(category: string, chinese = true): string {
  const normalized = normalizedActivityCategory(category, category);
  const labels = chinese
    ? {
        command: '命令',
        file: '文件',
        handoff: '交接',
        mcp: 'MCP',
        model: '模型',
        reasoning: '思考',
        search: '搜索',
        skill: '技能',
        status: '状态',
        subagent: '子任务',
      }
    : {
        command: 'Command',
        file: 'File',
        handoff: 'Handoff',
        mcp: 'MCP',
        model: 'Model',
        reasoning: 'Reasoning',
        search: 'Search',
        skill: 'Skill',
        status: 'Status',
        subagent: 'Subtask',
      };
  return labels[normalized as keyof typeof labels] || (chinese ? '工具' : 'Tool');
}

export function formatActivitySummary(
  message: Pick<
    HermesChatViewMessage,
    'activities' | 'completedAt' | 'durationMs' | 'startedAt' | 'status' | 'updatedAt'
  >,
  chinese = true,
  now = Date.now(),
): string {
  const running = ['pending', 'queued', 'running', 'starting', 'streaming'].includes(
    (message.status || '').toLowerCase(),
  ) || Boolean(message.activities?.some(({ status }) => status === 'running'));
  const durationMs = messageDurationMs(message, now);
  const prefix = running
    ? chinese ? '处理中' : 'Processing'
    : chinese ? '已处理' : 'Processed';
  return `${prefix} ${formatCompactDuration(durationMs)}`;
}

export function messageDurationMs(
  message: Pick<
    HermesChatViewMessage,
    'activities' | 'completedAt' | 'durationMs' | 'startedAt' | 'status' | 'updatedAt'
  >,
  now = Date.now(),
): number {
  const running = ['pending', 'queued', 'running', 'starting', 'streaming'].includes(
    (message.status || '').toLowerCase(),
  ) || Boolean(message.activities?.some(({ status }) => status === 'running'));
  if (running && message.startedAt) return Math.max(0, now - message.startedAt);
  if ((message.durationMs || 0) > 0) return message.durationMs || 0;
  if (message.startedAt) {
    return Math.max(0, (message.completedAt || message.updatedAt || now) - message.startedAt);
  }
  return 0;
}

export function formatMessageLocalTime(
  timestamp: number | undefined,
  chinese = true,
  now = Date.now(),
): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const current = new Date(now);
  const time = `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
  const sameDay = date.getFullYear() === current.getFullYear()
    && date.getMonth() === current.getMonth()
    && date.getDate() === current.getDate();
  if (sameDay) return time;
  if (date.getFullYear() === current.getFullYear()) {
    return chinese
      ? `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
      : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

export function messageStatusLabel(status: string | undefined, chinese = true): string {
  const normalized = normalizeMessageStatus(status);
  const labels = chinese
    ? {
        cancelled: '已取消',
        completed: '已完成',
        failed: '失败',
        queued: '排队中',
        running: '执行中',
      }
    : {
        cancelled: 'Cancelled',
        completed: 'Completed',
        failed: 'Failed',
        queued: 'Queued',
        running: 'Running',
      };
  return labels[normalized as keyof typeof labels];
}

function formatCompactDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function padTime(value: number): string {
  return String(value).padStart(2, '0');
}

function isTerminalStatus(status: string): boolean {
  return TERMINAL_TURN_STATES.has(status) || status === 'cancelled';
}

function firstActivityTimestamp(activities?: HermesChatActivity[]): number {
  const timestamps = (activities || [])
    .map(({ startedAt }) => startedAt)
    .filter((value): value is number => Boolean(value));
  return timestamps.length ? Math.min(...timestamps) : 0;
}

function lastActivityTimestamp(activities?: HermesChatActivity[]): number {
  return Math.max(
    0,
    ...((activities || []).map(({ completedAt, startedAt }) => (
      completedAt || startedAt || 0
    ))),
  );
}

function calculateDurationMs(
  startedAt: number,
  endedAt: number,
  activities?: HermesChatActivity[],
): number {
  if (startedAt && endedAt) return Math.max(0, endedAt - startedAt);
  const first = firstActivityTimestamp(activities);
  const last = lastActivityTimestamp(activities);
  if (first && last) return Math.max(0, last - first);
  return Math.max(0, ...(activities || []).map(({ durationMs }) => durationMs || 0));
}

function formatDuration(milliseconds: number): string {
  if (milliseconds <= 0) return '';
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  return 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringListValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(stringValue).filter(Boolean).join('、');
  }
  return stringValue(value);
}

function structuredText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(structuredText).filter(Boolean).join('\n');
  if (isRecord(value)) {
    const primary = structuredText(value.text ?? value.content);
    if (primary) return primary;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return '';
}

function timestampValue(value: unknown): number {
  const numeric = numberValue(value);
  if (numeric > 0) return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
