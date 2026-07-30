import type { ManagedResourceCatalog } from './cloud/extensions';
import {
  assertSseFrameWithinLimit,
  decodeSseTextStream,
} from './sse-stream-safety';

export interface ManagedResourceEventApi {
  openManagedResourceEvents(cursor: number, signal: AbortSignal): Promise<Response>;
}

export async function consumeManagedResourceEvents(
  api: ManagedResourceEventApi,
  cursor: number,
  signal: AbortSignal,
  onFrame: (frame: ManagedResourceCatalog) => void | Promise<void>,
): Promise<number> {
  const initialCursor = Math.max(0, Math.floor(cursor));
  const response = await api.openManagedResourceEvents(initialCursor, signal);
  if (!response.body) throw new Error('Hermes managed-resource event stream has no body');

  let buffer = '';
  let latestCursor = initialCursor;
  for await (const decoded of decodeSseTextStream(response.body, signal)) {
    buffer += decoded;
    const drained = await drainFrames(buffer, latestCursor, onFrame);
    buffer = drained.remaining;
    assertSseFrameWithinLimit(buffer.length, 'Hermes managed-resource event stream');
    latestCursor = drained.cursor;
  }
  if (buffer.trim()) {
    latestCursor = await parseFrame(buffer, latestCursor, onFrame);
  }
  return latestCursor;
}

async function drainFrames(
  input: string,
  cursor: number,
  onFrame: (frame: ManagedResourceCatalog) => void | Promise<void>,
): Promise<{ cursor: number; remaining: string }> {
  let remaining = input;
  let latestCursor = cursor;
  while (true) {
    const boundary = /\r?\n\r?\n/.exec(remaining);
    if (!boundary || boundary.index === undefined) break;
    assertSseFrameWithinLimit(boundary.index, 'Hermes managed-resource event stream');
    const frame = remaining.slice(0, boundary.index);
    remaining = remaining.slice(boundary.index + boundary[0].length);
    latestCursor = await parseFrame(frame, latestCursor, onFrame);
  }
  return { cursor: latestCursor, remaining };
}

async function parseFrame(
  frame: string,
  cursor: number,
  onFrame: (frame: ManagedResourceCatalog) => void | Promise<void>,
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
  if (eventType !== 'managed-resources' || !data.length) return cursor;

  let payload: unknown;
  try {
    payload = JSON.parse(data.join('\n'));
  } catch {
    throw new Error('Hermes managed-resource event stream returned invalid JSON');
  }
  if (!isRecord(payload)
    || !String(payload.account_generation || '').trim()
    || !Array.isArray(payload.resources)
    || !Array.isArray(payload.events)
    || !Array.isArray(payload.diagnostics)) {
    throw new Error('Hermes managed-resource event stream returned an invalid catalog');
  }
  const payloadCursor = nonNegativeInteger(payload.cursor);
  const idCursor = nonNegativeInteger(eventId);
  const reset = payload.reset_cursor === true;
  const nextCursor = Math.max(payloadCursor, idCursor);
  if (!reset && nextCursor < cursor) {
    throw new Error('Hermes managed-resource event cursor regressed');
  }
  let previous = reset ? -1 : cursor;
  for (const event of payload.events) {
    if (!isRecord(event)) {
      throw new Error('Hermes managed-resource stream returned an invalid event');
    }
    const eventCursor = nonNegativeInteger(event.cursor);
    if (eventCursor <= previous || eventCursor > nextCursor) {
      throw new Error('Hermes managed-resource events are not strictly ordered');
    }
    previous = eventCursor;
  }
  const catalog = payload as unknown as ManagedResourceCatalog;
  await onFrame(catalog);
  return reset ? nextCursor : Math.max(cursor, nextCursor);
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Hermes managed-resource event cursor is invalid');
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
