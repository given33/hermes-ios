import type {
  CollaborationMessage,
  JsonRecord,
} from './HermesCloudApi';

export function normalizeOfficialSessionMessages(
  messages: readonly JsonRecord[],
  profile: string,
  sessionId: string,
): CollaborationMessage[] {
  const normalized: CollaborationMessage[] = [];
  let assistantTurn: JsonRecord[] = [];
  let sequence = 0;

  const flushAssistant = () => {
    if (!assistantTurn.length) return;
    const assistantMessages = assistantTurn.filter((message) => roleOf(message) === 'assistant');
    const source = assistantMessages[assistantMessages.length - 1]
      || assistantTurn[assistantTurn.length - 1];
    const content = [...assistantMessages]
      .reverse()
      .map((message) => structuredText(message.content))
      .find(Boolean) || '';
    const activities: JsonRecord[] = [];
    const toolsById = new Map<string, JsonRecord>();

    for (const message of assistantTurn) {
      const role = roleOf(message);
      if (role === 'assistant') {
        const reasoning = structuredText(
          message.reasoning_content ?? message.reasoning ?? message.thinking,
        );
        if (reasoning) {
          activities.push({
            category: 'reasoning',
            id: `reasoning-${++sequence}`,
            kind: 'reasoning',
            name: '模型思考',
            output: reasoning,
            status: 'completed',
          });
        }
        for (const rawCall of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
          if (!isRecord(rawCall)) continue;
          const fn = isRecord(rawCall.function) ? rawCall.function : {};
          const id = stringValue(rawCall.id) || `tool-${++sequence}`;
          const activity: JsonRecord = {
            category: activityCategory(stringValue(fn.name) || stringValue(rawCall.name)),
            id,
            input: structuredText(fn.arguments ?? rawCall.arguments),
            kind: 'tool',
            name: stringValue(fn.name) || stringValue(rawCall.name) || 'tool',
            output: '',
            status: 'running',
          };
          activities.push(activity);
          toolsById.set(id, activity);
        }
      } else if (role === 'tool') {
        const activity = toolsById.get(stringValue(message.tool_call_id) || stringValue(message.id));
        if (!activity) continue;
        activity.output = structuredText(message.content);
        activity.error = structuredText(message.error);
        activity.status = activity.error ? 'failed' : 'completed';
      }
    }

    if (content || activities.length) {
      normalized.push({
        content,
        timestamp: numberValue(source.timestamp),
        id: `${sessionId}:assistant:${normalized.length}`,
        meta: {
          activities,
          actual_model: stringValue(source.model),
          actual_provider: stringValue(source.provider),
        },
        name: profile || 'default',
        role: 'assistant',
        status: 'completed',
      });
    }
    assistantTurn = [];
  };

  for (const message of messages) {
    const role = roleOf(message);
    if (role === 'user') {
      flushAssistant();
      const content = structuredText(message.content);
      if (content) {
        normalized.push({
          content,
          timestamp: numberValue(message.timestamp),
          id: `${sessionId}:user:${normalized.length}`,
          name: 'user',
          role: 'user',
          status: 'completed',
        });
      }
    } else if (role === 'assistant' || role === 'tool') {
      assistantTurn.push(message);
    }
  }
  flushAssistant();
  return normalized;
}

function activityCategory(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes('terminal') || normalized.includes('command')) return 'command';
  if (normalized.includes('file')) return 'file';
  if (normalized.includes('browser')) return 'browser';
  if (normalized.includes('mcp')) return 'mcp';
  if (normalized.includes('skill')) return 'skill';
  if (normalized.includes('delegate') || normalized.includes('subagent')) return 'subagent';
  return 'other';
}

function structuredText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(structuredText).filter(Boolean).join('\n');
  if (!isRecord(value)) return '';
  for (const key of ['text', 'content', 'output', 'result']) {
    const text = structuredText(value[key]);
    if (text) return text;
  }
  return '';
}

function roleOf(message: JsonRecord): string {
  return stringValue(message.role).toLowerCase() || 'assistant';
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
