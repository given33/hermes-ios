import type {
  CollaborationMessage,
  SessionSummary,
  SingleConversation,
} from './HermesCloudApi';
import type { JsonRecord } from './cloud/transport';

export const RUNTIME_RUN_FRESHNESS_MS = 30 * 60 * 1_000;
export const HOSTED_TURN_FRESHNESS_MS = 36 * 60 * 60 * 1_000;

const NON_TOOL_ACTIVITY_KINDS = new Set(['handoff', 'model', 'reasoning', 'status']);

/** Project one durable conversation into the official session-list shape. */
export function conversationSessionSummary(
  conversation: SingleConversation,
  now = Date.now(),
): SessionSummary {
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  let latestVisible: CollaborationMessage | undefined;
  let latestAssistant: CollaborationMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant') {
      if (!latestVisible) latestVisible = message;
      latestAssistant = message;
      break;
    }
    if (!latestVisible && message.role === 'user') latestVisible = message;
  }
  const provider = stringValue(latestAssistant?.provider)
    || stringValue(latestAssistant && mergedMetaValue(latestAssistant, 'actual_provider'));
  const model = stringValue(latestAssistant?.model)
    || stringValue(latestAssistant && mergedMetaValue(latestAssistant, 'actual_model'));
  let toolCallCount = 0;
  for (const message of messages) {
    const activities = Array.isArray(message.activities)
      ? message.activities
      : mergedMetaValue(message, 'activities');
    if (!Array.isArray(activities)) continue;
    for (const activity of activities) {
      if (
        isRecord(activity)
        && !NON_TOOL_ACTIVITY_KINDS.has(
          stringValue(activity.category || activity.kind).toLowerCase(),
        )
      ) {
        toolCallCount += 1;
      }
    }
  }
  const createdAt = numberValue(conversation.created_at);
  const updatedAt = numberValue(conversation.updated_at) || createdAt;
  const running = hasRunningConversationRecord(
    conversation.runtime_runs,
    RUNTIME_RUN_FRESHNESS_MS,
    now,
  ) || hasRunningConversationRecord(
    conversation.hosted_turns,
    HOSTED_TURN_FRESHNESS_MS,
    now,
  );
  return {
    id: conversation.id,
    profile: conversation.official_profile || conversation.profile,
    source: conversation.official_session_id ? 'official' : 'ios-unified',
    model: conversation.official_model
      || [provider, model].filter(Boolean).join('/')
      || null,
    title: conversation.title || null,
    archived: conversation.archived === true,
    pinned: conversation.pinned === true,
    unread: conversation.unread === true,
    started_at: createdAt,
    ended_at: running ? null : updatedAt,
    last_active: updatedAt,
    is_active: running,
    message_count: numberValue(conversation.message_count) || messages.length,
    tool_call_count: toolCallCount,
    input_tokens: 0,
    output_tokens: 0,
    preview: latestVisible?.content || conversation.preview || null,
  };
}

export function runningConversationRecordIsFresh(
  entry: JsonRecord,
  freshnessMs: number,
  now = Date.now(),
): boolean {
  const status = stringValue(entry.status).toLowerCase();
  if (!['pending', 'queued', 'running', 'starting', 'streaming'].includes(status)) {
    return false;
  }
  const leaseExpiresAt = recordTimestamp(entry.lease_expires_at);
  if (leaseExpiresAt > 0) return leaseExpiresAt > now;
  const latestActivity = Math.max(
    recordTimestamp(entry.heartbeat_at),
    recordTimestamp(entry.updated_at),
    recordTimestamp(entry.started_at),
    recordTimestamp(entry.created_at),
  );
  return latestActivity > 0 && now - latestActivity < freshnessMs;
}

function mergedMetaValue(message: CollaborationMessage, key: string): unknown {
  if (isRecord(message.meta) && key in message.meta) return message.meta[key];
  if (isRecord(message.metadata) && key in message.metadata) return message.metadata[key];
  return undefined;
}

function hasRunningConversationRecord(
  value?: Record<string, JsonRecord>,
  freshnessMs = RUNTIME_RUN_FRESHNESS_MS,
  now = Date.now(),
): boolean {
  return Object.values(value || {}).some(
    (entry) => runningConversationRecordIsFresh(entry, freshnessMs, now),
  );
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

function recordTimestamp(value: unknown): number {
  const numeric = numberValue(value);
  if (numeric > 0) return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
