import type { HermesCodingPiJson, HermesCodingPiSnapshot } from '../../api/hermes-coding-pi';

export type CodingPiMessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface CodingPiMessage {
  id: string;
  role: CodingPiMessageRole;
  text: string;
  timestamp?: number;
  streaming?: boolean;
  toolName?: string;
  toolCallId?: string;
  /** Collapsible reasoning block, matching collab-web's ThinkingBlock. */
  thinking?: string;
  error?: boolean;
}

export type CodingPiActivityStatus = 'running' | 'done' | 'error' | 'info';

export interface CodingPiActivity {
  id: string;
  title: string;
  detail: string;
  status: CodingPiActivityStatus;
  updatedAt: number;
  /** The untouched Pi tool-call name used by the official collab renderer. */
  toolName?: string;
  /** Original tool-call arguments, retained so a restored session is inspectable. */
  args?: unknown;
  /** Original tool result payload, including content/details when Pi provides it. */
  result?: unknown;
  /** Streaming tail emitted by Pi while a tool is still running. */
  partialResult?: unknown;
  intent?: string;
  callId?: string;
  parentCallId?: string;
  presentationMeta?: Record<string, unknown>;
}

export function isRecord(value: unknown): value is HermesCodingPiJson {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((item) => {
    if (typeof item === 'string') return item;
    if (!isRecord(item)) return '';
    const type = stringValue(item.type);
    if (type === 'thinking') return stringValue(item.thinking);
    if (type === 'toolResult') return contentText(item.content);
    return stringValue(item.text, stringValue(item.thinking));
  }).join('');
}

export function normalizePiMessages(value: unknown): CodingPiMessage[] {
  const rawMessages = isRecord(value) && Array.isArray(value.messages)
    ? value.messages
    : Array.isArray(value)
      ? value
      : [];
  return rawMessages.flatMap((raw, index) => {
    const message = normalizePiMessage(raw, `message-${index}`);
    return message ? [message] : [];
  });
}

export function normalizePiMessage(value: unknown, fallbackId: string): CodingPiMessage | null {
  if (!isRecord(value)) return null;
  const roleValue = stringValue(value.role, 'assistant');
  const role: CodingPiMessageRole = roleValue === 'user'
    ? 'user'
    : roleValue === 'tool' || roleValue === 'toolResult'
      ? 'tool'
      : roleValue === 'system'
        ? 'system'
        : 'assistant';
  const thinking = thinkingText(value.content)
    || stringValue(value.thinking)
    || stringValue(value.reasoning)
    || undefined;
  const text = textContent(value.content)
    || stringValue(value.text)
    || stringValue(value.error);
  // The official transcript consumes toolResult entries through their paired
  // ToolCard; rendering them as a second chat bubble would duplicate output.
  if (role === 'tool' || (!text && !thinking && role === 'assistant')) return null;
  const toolCallId = stringValue(value.toolCallId, stringValue(value.tool_call_id)) || undefined;
  return {
    id: stringValue(value.id, toolCallId || fallbackId),
    role,
    text,
    timestamp: numberValue(value.timestamp),
    streaming: false,
    toolName: stringValue(value.toolName, stringValue(value.tool_name)) || undefined,
    toolCallId,
    thinking,
    error: Boolean(value.error),
  };
}

/** Text blocks only; thinking is rendered as its own collapsible native row. */
function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((item) => {
    if (typeof item === 'string') return item;
    if (!isRecord(item)) return '';
    const type = stringValue(item.type);
    if (type === 'thinking' || type === 'redactedThinking' || type === 'toolResult') return '';
    return stringValue(item.text);
  }).join('');
}

function thinkingText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((item) => {
    if (!isRecord(item)) return '';
    const type = stringValue(item.type);
    if (type === 'thinking') return stringValue(item.thinking, stringValue(item.text));
    if (type === 'redactedThinking') return '[redacted by provider]';
    return '';
  }).filter(Boolean).join('\n\n');
}

export function snapshotMessages(snapshot: HermesCodingPiSnapshot): CodingPiMessage[] {
  return normalizePiMessages(snapshot.messages);
}

/**
 * Rebuild the native tool timeline from Pi's persisted RPC messages.
 *
 * The official collab-web client receives SessionEntry rows, while the RPC
 * surface exposes the same transcript as AgentMessage objects. Keeping this
 * conversion here means a restarted Hermes client can render the same tool
 * calls and results instead of losing the history until the next live event.
 */
export function snapshotActivities(snapshot: HermesCodingPiSnapshot): CodingPiActivity[] {
  const rawMessages = isRecord(snapshot.messages) && Array.isArray(snapshot.messages.messages)
    ? snapshot.messages.messages
    : Array.isArray(snapshot.messages)
      ? snapshot.messages
      : [];
  const calls = new Map<string, CodingPiActivity>();
  const results = new Map<string, HermesCodingPiJson>();
  const now = Date.now();

  rawMessages.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const role = stringValue(raw.role).toLowerCase();
    if (role === 'assistant') {
      const blocks = Array.isArray(raw.content) ? raw.content : [];
      blocks.forEach((block, blockIndex) => {
        if (!isRecord(block) || stringValue(block.type) !== 'toolCall') return;
        const id = stringValue(block.id, `tool-${index}-${blockIndex}`);
        const name = stringValue(block.name, 'tool');
        const args = block.arguments ?? block.args;
        calls.set(id, {
          id,
          title: name,
          detail: stringifyPiValue(args),
          status: 'running',
          updatedAt: numberValue(raw.timestamp) || now,
          toolName: name,
          args,
          intent: stringValue(block.intent) || undefined,
        });
      });
      return;
    }
    if (role !== 'toolresult' && role !== 'tool_result' && role !== 'tool') return;
    const id = stringValue(raw.toolCallId, stringValue(raw.tool_call_id, `tool-result-${index}`));
    const result = raw;
    results.set(id, result);
  });

  for (const [id, result] of results) {
    const existing = calls.get(id) || {
      id,
      title: stringValue(result.toolName, 'tool'),
      detail: '',
      status: 'done' as const,
      updatedAt: now,
      toolName: stringValue(result.toolName, 'tool'),
    };
    const failed = result.isError === true || Boolean(result.error);
    calls.set(id, {
      ...existing,
      detail: toolResultText(result) || existing.detail,
      result,
      status: failed ? 'error' : 'done',
      updatedAt: numberValue(result.timestamp) || existing.updatedAt || now,
      callId: stringValue(result.callId, stringValue(result.call_id)) || existing.callId,
      parentCallId: stringValue(result.parentCallId, stringValue(result.parent_call_id)) || existing.parentCallId,
      presentationMeta: isRecord(result.presentationMeta)
        ? result.presentationMeta
        : isRecord(result.presentation_meta)
          ? result.presentation_meta
          : existing.presentationMeta,
    });
  }

  return [...calls.values()];
}

export function toolResultText(value: unknown): string {
  if (!isRecord(value)) return stringifyPiValue(value);
  return contentText(value.content)
    || stringValue(value.text)
    || stringValue(value.output)
    || stringValue(value.error)
    || (value.details !== undefined ? stringifyPiValue(value.details) : '');
}

export function stringifyPiValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2) || '';
  } catch {
    return String(value);
  }
}
