import type { HermesCloudApi, SingleConversation } from './HermesCloudApi';

export interface HostedConversationEvent {
  conversation: SingleConversation;
  cursor: number;
}

export async function consumeHostedConversationEvents(
  api: HermesCloudApi,
  conversationId: string,
  cursor: number,
  signal: AbortSignal,
  onEvent: (event: HostedConversationEvent) => void | Promise<void>,
): Promise<number> {
  const response = await api.openHostedConversationEvents(
    conversationId,
    Math.max(0, Math.floor(cursor)),
    signal,
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
      const parsed = await drainSseBuffer(buffer, latestCursor, onEvent);
      buffer = parsed.remaining;
      latestCursor = parsed.cursor;
      if (done) break;
    }
    if (buffer.trim()) {
      const parsed = await parseSseFrame(buffer, latestCursor, onEvent);
      latestCursor = parsed;
    }
  } finally {
    reader.releaseLock();
  }
  return latestCursor;
}

async function drainSseBuffer(
  input: string,
  cursor: number,
  onEvent: (event: HostedConversationEvent) => void | Promise<void>,
): Promise<{ cursor: number; remaining: string }> {
  let remaining = input;
  let latestCursor = cursor;
  while (true) {
    const boundary = /\r?\n\r?\n/.exec(remaining);
    if (!boundary || boundary.index === undefined) break;
    const frame = remaining.slice(0, boundary.index);
    remaining = remaining.slice(boundary.index + boundary[0].length);
    latestCursor = await parseSseFrame(frame, latestCursor, onEvent);
  }
  return { cursor: latestCursor, remaining };
}

async function parseSseFrame(
  frame: string,
  cursor: number,
  onEvent: (event: HostedConversationEvent) => void | Promise<void>,
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
  if (!isRecord(payload) || !isSingleConversation(payload.conversation)) {
    throw new Error('Hermes hosted event stream returned an invalid conversation');
  }
  const payloadCursor = nonNegativeInteger(payload.cursor);
  const idCursor = nonNegativeInteger(eventId);
  const nextCursor = Math.max(cursor, payloadCursor, idCursor);
  await onEvent({
    conversation: payload.conversation,
    cursor: nextCursor,
  });
  return nextCursor;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function isSingleConversation(value: unknown): value is SingleConversation {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.profile === 'string'
    && typeof value.title === 'string'
    && Array.isArray(value.messages);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
