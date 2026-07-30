import type { HermesCloudApi, SingleConversation } from './HermesCloudApi';

export const HOSTED_EVENT_SCHEMA_VERSION = 'hermes.hosted-event.v1';

export interface HostedLifecycleEvent {
  event_id: string;
  cursor: number;
  account_generation: string;
  conversation_id: string;
  turn_id: string;
  role_stage: string;
  event_type: string;
  sequence: number;
  occurred_at: number;
  idempotency_key: string;
  payload: Record<string, unknown>;
  schema_version: typeof HOSTED_EVENT_SCHEMA_VERSION;
}

export interface HostedConversationEventFrame {
  accountGeneration: string;
  conversation?: SingleConversation;
  cursor: number;
  events: HostedLifecycleEvent[];
  hasGap: boolean;
  minCursor: number;
  resetCursor: boolean;
  snapshotCursor: number;
}

export async function consumeHostedConversationEvents(
  api: HermesCloudApi,
  conversationId: string,
  cursor: number,
  expectedAccountGeneration: string,
  signal: AbortSignal,
  onEvent: (event: HostedConversationEventFrame) => void | Promise<void>,
): Promise<number> {
  const expectedGeneration = expectedAccountGeneration.trim();
  if (!conversationId.trim() || !expectedGeneration) {
    throw new Error('Hermes hosted event stream identity is incomplete');
  }
  const response = await api.openHostedConversationEvents(
    conversationId,
    Math.max(0, Math.floor(cursor)),
    signal,
    expectedGeneration,
  );
  if (!response.body) throw new Error('Hermes hosted event stream has no response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let latestCursor = Math.max(0, Math.floor(cursor));
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const parsed = await drainSseBuffer(
        buffer,
        latestCursor,
        conversationId,
        expectedGeneration,
        onEvent,
      );
      buffer = parsed.remaining;
      latestCursor = parsed.cursor;
      if (done) break;
    }
    if (buffer.trim()) {
      latestCursor = await parseSseFrame(
        buffer,
        latestCursor,
        conversationId,
        expectedGeneration,
        onEvent,
      );
    }
  } finally {
    reader.releaseLock();
  }
  return latestCursor;
}

async function drainSseBuffer(
  input: string,
  cursor: number,
  expectedConversationId: string,
  expectedAccountGeneration: string,
  onEvent: (event: HostedConversationEventFrame) => void | Promise<void>,
): Promise<{ cursor: number; remaining: string }> {
  let remaining = input;
  let latestCursor = cursor;
  while (true) {
    const boundary = /\r?\n\r?\n/.exec(remaining);
    if (!boundary || boundary.index === undefined) break;
    const frame = remaining.slice(0, boundary.index);
    remaining = remaining.slice(boundary.index + boundary[0].length);
    latestCursor = await parseSseFrame(
      frame,
      latestCursor,
      expectedConversationId,
      expectedAccountGeneration,
      onEvent,
    );
  }
  return { cursor: latestCursor, remaining };
}

async function parseSseFrame(
  frame: string,
  cursor: number,
  expectedConversationId: string,
  expectedAccountGeneration: string,
  onEvent: (event: HostedConversationEventFrame) => void | Promise<void>,
): Promise<number> {
  let eventType = 'message';
  let eventId = '';
  const data: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const separator = rawLine.indexOf(':');
    const field = separator >= 0 ? rawLine.slice(0, separator) : rawLine;
    const value = separator >= 0
      ? rawLine.slice(separator + 1).replace(/^ /, '')
      : '';
    if (field === 'event') eventType = value;
    else if (field === 'id') eventId = value;
    else if (field === 'data') data.push(value);
  }
  if (eventType !== 'conversation' || !data.length) return cursor;

  let payload: unknown;
  try {
    payload = JSON.parse(data.join('\n'));
  } catch {
    throw new Error('Hermes hosted event stream returned invalid JSON');
  }
  if (!isRecord(payload)) {
    throw new Error('Hermes hosted event stream returned an invalid envelope');
  }

  const conversation = payload.conversation === undefined
    ? undefined
    : parseConversation(payload.conversation);
  const events = payload.events === undefined
    ? []
    : parseLifecycleEvents(payload.events);
  const hasGap = payload.has_gap === true;
  const resetCursor = payload.reset_cursor === true;
  const accountGeneration = stringValue(payload.account_generation);
  if (!accountGeneration || accountGeneration !== expectedAccountGeneration) {
    throw new Error('Hermes hosted event stream account generation changed');
  }
  if (conversation) {
    if (conversation.id !== expectedConversationId) {
      throw new Error('Hermes hosted event stream returned another conversation');
    }
    if (String(conversation.account_generation || '').trim() !== accountGeneration) {
      throw new Error('Hermes hosted event snapshot account generation changed');
    }
  }
  let previousEventCursor = resetCursor ? -1 : cursor;
  for (const event of events) {
    if (
      event.conversation_id !== expectedConversationId
      || event.account_generation !== accountGeneration
    ) {
      throw new Error('Hermes hosted lifecycle event crossed its identity boundary');
    }
    if (event.cursor <= previousEventCursor) {
      throw new Error('Hermes hosted lifecycle events are not strictly ordered');
    }
    previousEventCursor = event.cursor;
  }
  if (hasGap && !conversation) {
    throw new Error('Hermes hosted event stream gap is missing its recovery snapshot');
  }
  if (!conversation && !events.length) {
    throw new Error('Hermes hosted event stream returned an empty envelope');
  }

  const payloadCursor = nonNegativeInteger(payload.cursor);
  const idCursor = nonNegativeInteger(eventId);
  const eventCursor = events.reduce((latest, event) => Math.max(latest, event.cursor), 0);
  const authoritativeCursor = Math.max(payloadCursor, idCursor, eventCursor);
  if (!resetCursor && authoritativeCursor < cursor) {
    throw new Error('Hermes hosted event stream cursor regressed');
  }
  if (resetCursor && !conversation) {
    throw new Error('Hermes hosted event cursor reset is missing its snapshot');
  }
  const nextCursor = resetCursor
    ? authoritativeCursor
    : Math.max(cursor, authoritativeCursor);
  await onEvent({
    accountGeneration,
    conversation,
    cursor: nextCursor,
    events,
    hasGap,
    minCursor: nonNegativeInteger(payload.min_cursor),
    resetCursor,
    snapshotCursor: nonNegativeInteger(payload.snapshot_cursor),
  });
  return nextCursor;
}

function parseLifecycleEvents(value: unknown): HostedLifecycleEvent[] {
  if (!Array.isArray(value)) {
    throw new Error('Hermes hosted event stream returned invalid events');
  }
  return value.map((event) => {
    if (!isRecord(event)
      || stringValue(event.schema_version) !== HOSTED_EVENT_SCHEMA_VERSION
      || !stringValue(event.event_id)
      || !stringValue(event.account_generation)
      || !stringValue(event.conversation_id)
      || !stringValue(event.turn_id)
      || !stringValue(event.role_stage)
      || !stringValue(event.event_type)
      || !stringValue(event.idempotency_key)
      || !isRecord(event.payload)) {
      throw new Error('Hermes hosted event stream returned an invalid lifecycle event');
    }
    const eventCursor = strictNonNegativeInteger(event.cursor);
    const sequence = strictNonNegativeInteger(event.sequence);
    const occurredAt = strictNonNegativeInteger(event.occurred_at);
    return {
      event_id: stringValue(event.event_id),
      cursor: eventCursor,
      account_generation: stringValue(event.account_generation),
      conversation_id: stringValue(event.conversation_id),
      turn_id: stringValue(event.turn_id),
      role_stage: stringValue(event.role_stage),
      event_type: stringValue(event.event_type),
      sequence,
      occurred_at: occurredAt,
      idempotency_key: stringValue(event.idempotency_key),
      payload: event.payload,
      schema_version: HOSTED_EVENT_SCHEMA_VERSION,
    };
  });
}

function parseConversation(value: unknown): SingleConversation {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.profile !== 'string'
    || typeof value.title !== 'string'
    || !Array.isArray(value.messages)) {
    throw new Error('Hermes hosted event stream returned an invalid conversation');
  }
  return value as unknown as SingleConversation;
}

function strictNonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Hermes hosted event stream returned an invalid event cursor');
  }
  return parsed;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
