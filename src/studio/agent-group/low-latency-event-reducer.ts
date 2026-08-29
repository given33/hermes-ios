import type { HermesStudioGroupChatMessage, HermesStudioRoomSnapshot } from '../../api/hermes-studio';
import { applyAgentGroupEvent, type AgentGroupEvent } from './agent-group-model';

export interface HermesLowLatencyEvent {
  schema_version?: string;
  event_id?: string;
  /** Transport-stamped routing room; the controller gates on it before reduce. */
  roomId?: string;
  sequence?: number;
  cursor?: number;
  request_id?: string;
  turn_id?: string;
  node_id?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

/** Stable suffix for the local assistant row shown before the server accepts a turn. */
export const THINKING_PLACEHOLDER_SUFFIX = ':thinking';

export function thinkingPlaceholderId(requestId: string): string {
  return `${requestId}${THINKING_PLACEHOLDER_SUFFIX}`;
}

/**
 * Remove only the optimistic assistant row once a real assistant/tool stream
 * has materialized. User messages and manager/tool rows are never removed.
 */
export function removeThinkingPlaceholders(
  messages: readonly HermesStudioGroupChatMessage[],
): HermesStudioGroupChatMessage[] {
  const newestPlaceholderAt = messages.reduce((latest, message) => (
    message.role === 'assistant' && message.id.endsWith(THINKING_PLACEHOLDER_SUFFIX)
      ? Math.max(latest, Number(message.timestamp) || 0)
      : latest
  ), 0);
  const hasRealResponse = messages.some((message) => (
    message.role !== 'user'
    && !message.id.endsWith(THINKING_PLACEHOLDER_SUFFIX)
    // A previous turn may still be streaming while the new turn is being
    // accepted. It must not remove the new turn's thinking row. Events for
    // the current turn have the same/newer timestamp and will remove it.
    && (Number(message.timestamp) || 0) >= newestPlaceholderAt
    && (
      message.content.trim().length > 0
      || Boolean(message.reasoning?.trim())
      || message.isStreaming === true
      || message.deliveryStatus === 'sent'
      || message.deliveryStatus === 'failed'
      || message.finish_reason != null
    )
  ));
  if (!hasRealResponse) return [...messages];
  return messages.filter((message) => (
    !(message.role === 'assistant' && message.id.endsWith(THINKING_PLACEHOLDER_SUFFIX))
  ));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function messageFromPayload(payload: Record<string, unknown>, roomId: string): HermesStudioGroupChatMessage | null {
  const raw = payload.message;
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as Record<string, unknown>;
  const id = text(message.id || payload.message_id);
  if (!id) return null;
  return {
    id,
    roomId,
    senderId: text(message.sender_id || payload.sender_id),
    senderName: text(message.sender_name || message.name || payload.sender_name || payload.agent_name || payload.node_id),
    role: text(message.role || 'assistant') as HermesStudioGroupChatMessage['role'],
    content: text(message.content),
    reasoning: text(message.reasoning),
    timestamp: finiteTimestamp(message.timestamp),
    ...(message.delivery_status ? { deliveryStatus: text(message.delivery_status) as HermesStudioGroupChatMessage['deliveryStatus'] } : {}),
    ...(message.attachments && Array.isArray(message.attachments) ? { attachments: message.attachments } : {}),
  };
}

function finiteTimestamp(value: unknown): number {
  const timestamp = Number(value);
  // Historical low-latency frames may omit timestamps. Do not inject the
  // wall-clock time: repeated replay of the same frame must produce the same
  // revision/fingerprint and must not reorder a room on every refresh.
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0;
}

export function lowLatencyEventToAgentGroupEvent(
  event: HermesLowLatencyEvent,
  roomId: string,
): AgentGroupEvent | null {
  const payload = event.payload || {};
  const type = text(event.type).toLowerCase();
  if (type === 'sequence.reset') return null;
  const eventRoomId = text(payload.room_id || payload.roomId || roomId) || roomId;
  const id = text(payload.message_id || payload.id);
  const delta = text(payload.delta || payload.content_delta);
  if (type === 'assistant.delta' || type === 'manager.delta' || type === 'tool.delta') {
    return id && delta ? { type: 'stream-delta', roomId: eventRoomId, id, delta } : null;
  }
  if (type === 'assistant.reasoning_delta' || type === 'reasoning.delta') {
    return id && delta ? { type: 'reasoning-delta', roomId: eventRoomId, id, delta } : null;
  }
  if (type === 'worker.started' || type === 'manager.started' || type === 'tool.started') {
    const name = text(payload.agent_name || payload.profile || payload.node_id);
    return name ? { type: 'context-status', roomId: eventRoomId, name, status: 'running' } : null;
  }
  if (type === 'worker.completed' || type === 'turn.completed' || type === 'tool.completed') {
    if (id) return { type: 'stream-end', roomId: eventRoomId, id };
    const name = text(payload.agent_name || payload.profile || payload.node_id);
    return name ? { type: 'context-status', roomId: eventRoomId, name, status: 'completed' } : null;
  }
  if (type === 'turn.failed' || type === 'worker.failed') {
    if (id) return { type: 'stream-end', roomId: eventRoomId, id };
    const name = text(payload.agent_name || payload.profile || payload.node_id);
    return name ? { type: 'context-status', roomId: eventRoomId, name, status: 'error' } : null;
  }
  if (type === 'room.cleared' || type === 'conversation.cleared') return { type: 'room-cleared', roomId: eventRoomId };
  if (type === 'room.updated' || type === 'manager.plan') {
    return {
      type: 'room-updated',
      roomId: eventRoomId,
      totalTokens: payload.total_tokens === undefined ? undefined : Number(payload.total_tokens),
      name: text(payload.name) || undefined,
    };
  }
  if (type === 'message' || type === 'assistant.message' || type === 'worker.message') {
    const message = messageFromPayload(payload, eventRoomId);
    return message ? { type: 'message', message } : null;
  }
  return null;
}

/** Ordered, idempotent reducer for the single live UI path. */
export class OrderedLowLatencyReducer {
  private lastSequence = 0;
  private readonly eventIds = new Set<string>();

  reset(): void {
    this.lastSequence = 0;
    this.eventIds.clear();
  }

  get sequence(): number { return this.lastSequence; }

  reduce(snapshot: HermesStudioRoomSnapshot, event: HermesLowLatencyEvent): HermesStudioRoomSnapshot {
    const eventId = text(event.event_id);
    if (text(event.type).toLowerCase() === 'sequence.reset') {
      // The server has already authenticated a snapshot-backed cursor reset;
      // clear dedupe state so the lower-sequence replay is accepted.
      this.reset();
      return snapshot;
    }
    const rawSequence = Number(event.sequence ?? event.cursor ?? 0);
    const sequence = Number.isFinite(rawSequence) && rawSequence >= 0 ? rawSequence : 0;
    if (eventId && this.eventIds.has(eventId)) return snapshot;
    // A transport cursor can stamp several fine-grained lifecycle frames with
    // the same durable boundary. Repeated event ids are duplicates; equal
    // cursors with distinct ids are distinct events and must preserve arrival
    // order. Only a strictly older cursor is stale.
    if (sequence > 0 && sequence < this.lastSequence) return snapshot;
    if (eventId) {
      this.eventIds.add(eventId);
      if (this.eventIds.size > 4096) this.eventIds.delete(this.eventIds.values().next().value as string);
    }
    this.lastSequence = Math.max(this.lastSequence, sequence);
    const mapped = lowLatencyEventToAgentGroupEvent(event, snapshot.room.id);
    return mapped ? applyAgentGroupEvent(snapshot, mapped) : snapshot;
  }
}
