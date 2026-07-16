import type {
  CollaborationMessage,
  SingleConversation,
} from './HermesCloudApi';

export type HermesChatActivityStatus = 'completed' | 'failed' | 'running';

export interface HermesChatActivity {
  category: string;
  duration: string;
  id: string;
  input?: string;
  name: string;
  output?: string;
  preview: string;
  status: HermesChatActivityStatus;
}

export interface HermesChatViewMessage {
  activities?: HermesChatActivity[];
  content: string;
  id: string;
  model?: string;
  name: string;
  role: 'assistant' | 'user';
  roleLabel?: string;
  roleStage?: 'chat' | 'reporter' | 'reviewer' | 'worker';
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
  return (conversation.messages ?? []).flatMap((message) => {
    const converted = collaborationMessageToView(message, chinese);
    return converted ? [converted] : [];
  });
}

export function collaborationMessageToView(
  message: CollaborationMessage,
  chinese = true,
): HermesChatViewMessage | null {
  const kind = message.kind ?? '';
  if (kind === 'route') return null;
  const isUser = message.role === 'user';
  const isVisibleSystemEvent = message.role === 'system' && kind === 'workflow';
  if (!isUser && message.role !== 'assistant' && !isVisibleSystemEvent) return null;
  const meta = isRecord(message.meta) ? message.meta : {};
  const roleStage = normalizeRoleStage(meta.role_stage, isUser);
  const name = isUser
    ? chinese ? '你' : 'You'
    : profileDisplayName(message.name, chinese);
  const roleLabel = roleStage === 'chat'
    ? chinese ? 'Hermes Agent' : 'Hermes Agent'
    : roleStageLabel(roleStage || 'chat', chinese);
  const provider = stringValue(meta.actual_provider);
  const model = stringValue(meta.actual_model);
  return {
    activities: mapActivities(meta.activities),
    content: message.content || '',
    id: message.id,
    model: [provider, model].filter(Boolean).join(' · ') || undefined,
    name,
    role: isUser ? 'user' : 'assistant',
    roleLabel,
    roleStage,
  };
}

export function conversationHasRunningWork(conversation: SingleConversation): boolean {
  return hasRunningRecord(conversation.hosted_turns)
    || hasRunningRecord(conversation.runtime_runs);
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
      duration: '',
      id: stringValue(payload.id) || `reasoning-${now}`,
      name: '模型思考',
      output: text,
      preview: text.slice(0, 80),
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
  return {
    category: activityCategory(name),
    duration: formatDuration(numberValue(payload.duration_ms)),
    id: stringValue(payload.tool_id) || `tool-${now}`,
    input: structuredText(payload.args_text ?? payload.context) || undefined,
    name,
    output: structuredText(payload.output ?? payload.result) || undefined,
    preview: structuredText(payload.preview) || name,
    status,
  };
}

function mapActivities(value: unknown): HermesChatActivity[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const activities = value.flatMap((item, index): HermesChatActivity[] => {
    if (!isRecord(item)) return [];
    const name = stringValue(item.name) || '工具调用';
    return [{
      category: stringValue(item.category) || stringValue(item.kind) || activityCategory(name),
      duration: formatDuration(numberValue(item.duration_ms)),
      id: stringValue(item.id) || `activity-${index}`,
      input: structuredText(item.input) || undefined,
      name,
      output: structuredText(item.output) || undefined,
      preview: structuredText(item.preview) || name,
      status: normalizeStatus(item.status),
    }];
  });
  return activities.length ? activities : undefined;
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
  return value === 'worker' || value === 'reviewer' || value === 'reporter'
    ? value
    : 'chat';
}

function normalizeStatus(value: unknown): HermesChatActivityStatus {
  if (value === 'failed' || value === 'error') return 'failed';
  if (value === 'running' || value === 'streaming') return 'running';
  return 'completed';
}

function profileDisplayName(profile: string, chinese: boolean): string {
  if (!chinese) return profile || 'Hermes Agent';
  const names: Record<string, string> = {
    default: 'Hermes',
    'dbb3-worker': 'DBB3 执行器',
    'pc-worker': '本地执行器',
    reviewer: 'Hermes 审阅器',
  };
  return names[profile] || profile || 'Hermes Agent';
}

function roleStageLabel(
  stage: NonNullable<HermesChatViewMessage['roleStage']>,
  chinese: boolean,
): string {
  if (!chinese) {
    return { chat: 'Hermes Agent', reporter: 'Final report', reviewer: 'Review', worker: 'Execution' }[stage];
  }
  return { chat: 'Hermes Agent', reporter: '最终汇报', reviewer: '结果审阅', worker: '任务执行' }[stage];
}

function activityCategory(name: string): string {
  const lowered = name.toLowerCase();
  if (/file|read|write|patch|文件/.test(lowered)) return 'file';
  if (/browser|search|web|浏览|搜索/.test(lowered)) return 'browser';
  if (/mcp/.test(lowered)) return 'mcp';
  if (/skill|技能/.test(lowered)) return 'skill';
  return 'command';
}

function formatDuration(milliseconds: number): string {
  if (milliseconds <= 0) return '';
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function structuredText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(structuredText).filter(Boolean).join('');
  if (isRecord(value)) return structuredText(value.text ?? value.content);
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
