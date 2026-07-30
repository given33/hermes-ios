import type {
  CollaborationMessage,
  ConversationSessionEntriesResponse,
  ConversationSessionEntry,
  SingleConversation,
} from './HermesCloudApi';
import type { JsonRecord } from './cloud/transport';

/**
 * Apply append-only session entries to a server snapshot. The snapshot remains
 * authoritative for workflow state; entries only restore or advance durable
 * message history that a stale snapshot omitted.
 */
export function reconcileConversationSessionEntries(
  conversation: SingleConversation,
  response: ConversationSessionEntriesResponse,
): SingleConversation {
  const messages = conversation.messages.map((message) => ({ ...message }));
  const byId = new Map(messages.map((message, index) => [message.id, index]));

  for (const entry of response.entries) {
    if (entry.entry_type !== 'message') continue;
    const message = messageFromEntry(entry);
    if (!message) continue;
    const existingIndex = byId.get(message.id);
    if (existingIndex === undefined) {
      byId.set(message.id, messages.length);
      messages.push(message);
      continue;
    }
    const existing = messages[existingIndex];
    messages[existingIndex] = {
      ...existing,
      ...message,
      created_at: existing.created_at || message.created_at,
      updated_at: Math.max(
        numericMessageTime(existing.updated_at),
        numericMessageTime(message.updated_at),
      ) || message.updated_at || existing.updated_at,
      meta: {
        ...(existing.meta || {}),
        ...(message.meta || {}),
      },
    };
  }

  messages.sort((left, right) => messageTime(left) - messageTime(right));
  return {
    ...conversation,
    messages,
    message_count: Math.max(conversation.message_count || 0, messages.length),
    session_entry_cursor: Math.max(
      conversation.session_entry_cursor || 0,
      response.cursor || 0,
    ),
    session_entry_leaf_id: response.leaf_entry_id || conversation.session_entry_leaf_id,
  };
}

function messageFromEntry(entry: ConversationSessionEntry): CollaborationMessage | null {
  const payload = entry.payload;
  const id = stringValue(payload.message_id);
  const role = stringValue(payload.role);
  if (!id || !role) return null;
  const turnId = stringValue(payload.turn_id);
  const roleStage = stringValue(payload.role_stage);
  const meta: JsonRecord = {};
  if (turnId) meta.runtime_turn_id = turnId;
  if (roleStage) meta.role_stage = roleStage;
  return {
    id,
    role,
    name: stringValue(payload.name),
    content: stringValue(payload.content, false),
    status: stringValue(payload.status) || 'completed',
    kind: stringValue(payload.kind) || 'message',
    created_at: entry.occurred_at,
    updated_at: entry.occurred_at,
    meta,
  };
}

function stringValue(value: unknown, trim = true): string {
  if (typeof value !== 'string') return '';
  return trim ? value.trim() : value;
}

function messageTime(message: CollaborationMessage): number {
  const value = message.created_at || message.timestamp || 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function numericMessageTime(value: CollaborationMessage['created_at']): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
