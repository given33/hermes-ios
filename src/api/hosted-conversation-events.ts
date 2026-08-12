import type { HermesCloudApi, SingleConversation } from './HermesCloudApi';
import {
  assertSseFrameWithinLimit,
  decodeSseTextStream,
} from './sse-stream-safety';

export const HOSTED_EVENT_SCHEMA_VERSION = 'hermes.hosted-event.v1';
const MALFORMED_FRAME_REPORT_INTERVAL_MS = 60_000;
const MAX_MALFORMED_FRAME_REPORT_KEYS = 256;
const malformedFrameReportTimes = new Map<string, number>();

class RecoverableHostedFrameError extends Error {
  readonly name = 'RecoverableHostedFrameError';
}

export interface HostedLifecycleEvent {
  event_id: string;
  cursor: number;
  account_generation: string;
  conversation_id: string;
  turn_id: string;
  role_stage: string;
  event_type: string;
  entity_id?: string;
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
  onMalformedFrame: (error: Error) => void = defaultMalformedFrameReporter,
  connectionTimeoutMs = 5_000,
  onActivity?: () => void,
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
    connectionTimeoutMs,
  );
  if (!response.body) throw new Error('Hermes hosted event stream has no response body');

  let buffer = '';
  let latestCursor = Math.max(0, Math.floor(cursor));
  const reportMalformedFrame = (error: RecoverableHostedFrameError) => {
    reportMalformedHostedFrame(
      `${expectedGeneration}\u0000${conversationId}`,
      error,
      onMalformedFrame,
    );
  };
  for await (const decoded of decodeSseTextStream(response.body, signal)) {
    // Keepalive comments are ignored by the protocol parser, but they still
    // prove that the SSE path is alive. The stream owner uses this hook to
    // distinguish a quiet long-running task from a half-open connection.
    onActivity?.();
    buffer += decoded;
    const parsed = await drainSseBuffer(
      buffer,
      latestCursor,
      conversationId,
      expectedGeneration,
      onEvent,
      reportMalformedFrame,
    );
    buffer = parsed.remaining;
    assertSseFrameWithinLimit(buffer.length, 'Hermes hosted event stream');
    latestCursor = parsed.cursor;
  }
  if (buffer.trim()) {
    try {
      latestCursor = await parseSseFrame(
        buffer,
        latestCursor,
        conversationId,
        expectedGeneration,
        onEvent,
      );
    } catch (error) {
      if (!(error instanceof RecoverableHostedFrameError)) throw error;
      reportMalformedFrame(error);
    }
  }
  return latestCursor;
}

async function drainSseBuffer(
  input: string,
  cursor: number,
  expectedConversationId: string,
  expectedAccountGeneration: string,
  onEvent: (event: HostedConversationEventFrame) => void | Promise<void>,
  reportMalformedFrame: (error: RecoverableHostedFrameError) => void,
): Promise<{ cursor: number; remaining: string }> {
  let remaining = input;
  let latestCursor = cursor;
  while (true) {
    const boundary = /\r?\n\r?\n/.exec(remaining);
    if (!boundary || boundary.index === undefined) break;
    assertSseFrameWithinLimit(boundary.index, 'Hermes hosted event stream');
    const frame = remaining.slice(0, boundary.index);
    remaining = remaining.slice(boundary.index + boundary[0].length);
    try {
      latestCursor = await parseSseFrame(
        frame,
        latestCursor,
        expectedConversationId,
        expectedAccountGeneration,
        onEvent,
      );
    } catch (error) {
      if (!(error instanceof RecoverableHostedFrameError)) throw error;
      reportMalformedFrame(error);
    }
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
    throw new RecoverableHostedFrameError('Hermes hosted event stream returned invalid JSON');
  }
  if (!isRecord(payload)) {
    throw new RecoverableHostedFrameError(
      'Hermes hosted event stream returned an invalid envelope',
    );
  }

  const hasGap = payload.has_gap === true;
  const resetCursor = payload.reset_cursor === true;
  const accountGeneration = stringValue(payload.account_generation);
  preflightFrameIntegrity(
    payload,
    eventId,
    cursor,
    expectedConversationId,
    expectedAccountGeneration,
    accountGeneration,
    hasGap,
    resetCursor,
  );

  const conversation = payload.conversation === undefined
    ? undefined
    : parseConversation(payload.conversation);
  const events = payload.events === undefined
    ? []
    : parseLifecycleEvents(payload.events);
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
    // A replay may legitimately start with the already-consumed boundary
    // event (cursor == the resume cursor). Only a regression below it is
    // disorder; equal is idempotent and skipped by the consumer's cursor
    // advance anyway.
    if (event.cursor < previousEventCursor) {
      throw new Error('Hermes hosted lifecycle events are not strictly ordered');
    }
    previousEventCursor = event.cursor;
  }
  if (hasGap && !conversation) {
    throw new Error('Hermes hosted event stream gap is missing its recovery snapshot');
  }
  if (!conversation && !events.length) {
    throw new RecoverableHostedFrameError(
      'Hermes hosted event stream returned an empty envelope',
    );
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
    throw new RecoverableHostedFrameError('Hermes hosted event stream returned invalid events');
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
      throw new RecoverableHostedFrameError(
        'Hermes hosted event stream returned an invalid lifecycle event',
      );
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
      entity_id: stringValue(event.entity_id) || undefined,
      sequence,
      occurred_at: occurredAt,
      idempotency_key: stringValue(event.idempotency_key),
      payload: event.payload,
      schema_version: HOSTED_EVENT_SCHEMA_VERSION,
    };
  });
}

function preflightFrameIntegrity(
  payload: Record<string, unknown>,
  eventId: string,
  cursor: number,
  expectedConversationId: string,
  expectedAccountGeneration: string,
  accountGeneration: string,
  hasGap: boolean,
  resetCursor: boolean,
): void {
  if (!accountGeneration || accountGeneration !== expectedAccountGeneration) {
    throw new Error('Hermes hosted event stream account generation changed');
  }
  if (isRecord(payload.conversation)) {
    const frameConversationId = stringValue(payload.conversation.id);
    const frameGeneration = stringValue(payload.conversation.account_generation);
    if (frameConversationId && frameConversationId !== expectedConversationId) {
      throw new Error('Hermes hosted event stream returned another conversation');
    }
    if (frameGeneration && frameGeneration !== accountGeneration) {
      throw new Error('Hermes hosted event snapshot account generation changed');
    }
  }
  const rawEvents = Array.isArray(payload.events) ? payload.events : [];
  const rawEventCursors: number[] = [];
  let previousEventCursor = resetCursor ? -1 : cursor;
  for (const rawEvent of rawEvents) {
    if (!isRecord(rawEvent)) continue;
    const eventConversationId = stringValue(rawEvent.conversation_id);
    const eventGeneration = stringValue(rawEvent.account_generation);
    if ((eventConversationId && eventConversationId !== expectedConversationId)
      || (eventGeneration && eventGeneration !== accountGeneration)) {
      throw new Error('Hermes hosted lifecycle event crossed its identity boundary');
    }
    const eventCursor = optionalNonNegativeInteger(rawEvent.cursor);
    if (eventCursor !== undefined) {
      if (eventCursor <= previousEventCursor) {
        throw new Error('Hermes hosted lifecycle events are not strictly ordered');
      }
      previousEventCursor = eventCursor;
      rawEventCursors.push(eventCursor);
    }
  }
  if (hasGap && !isRecord(payload.conversation)) {
    throw new Error('Hermes hosted event stream gap is missing its recovery snapshot');
  }
  if (resetCursor && !isRecord(payload.conversation)) {
    throw new Error('Hermes hosted event cursor reset is missing its snapshot');
  }
  const frameCursors = [
    optionalNonNegativeInteger(payload.cursor),
    optionalNonNegativeInteger(eventId),
    ...rawEventCursors,
  ].filter((value): value is number => value !== undefined);
  if (!resetCursor && frameCursors.length && Math.max(...frameCursors) < cursor) {
    throw new Error('Hermes hosted event stream cursor regressed');
  }
}

function parseConversation(value: unknown): SingleConversation {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.profile !== 'string'
    || typeof value.title !== 'string'
    || !Array.isArray(value.messages)) {
    throw new RecoverableHostedFrameError(
      'Hermes hosted event stream returned an invalid conversation',
    );
  }
  return value as unknown as SingleConversation;
}

function strictNonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RecoverableHostedFrameError(
      'Hermes hosted event stream returned an invalid event cursor',
    );
  }
  return parsed;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === 'string' && !value.trim()) return undefined;
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reportMalformedHostedFrame(
  identity: string,
  error: RecoverableHostedFrameError,
  reporter: (error: Error) => void,
): void {
  const now = Date.now();
  const lastReportedAt = malformedFrameReportTimes.get(identity) ?? Number.NEGATIVE_INFINITY;
  if (now - lastReportedAt < MALFORMED_FRAME_REPORT_INTERVAL_MS) return;
  if (!malformedFrameReportTimes.has(identity)
    && malformedFrameReportTimes.size >= MAX_MALFORMED_FRAME_REPORT_KEYS) {
    const oldest = malformedFrameReportTimes.keys().next().value;
    if (oldest !== undefined) malformedFrameReportTimes.delete(oldest);
  }
  malformedFrameReportTimes.delete(identity);
  malformedFrameReportTimes.set(identity, now);
  try {
    reporter(error);
  } catch {
    // Diagnostics must never turn a recoverable frame into a stream failure.
  }
}

function defaultMalformedFrameReporter(error: Error): void {
  console.warn('Hermes hosted event stream skipped a malformed frame', error.message);
}
