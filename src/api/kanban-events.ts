export interface KanbanEventWebSocketSource {
  openKanbanEventsWebSocket(
    cursor?: number,
    board?: string,
    deadlineMs?: number,
    signal?: AbortSignal,
  ): Promise<WebSocket>;
}

export interface KanbanEventFrame {
  cursor: number;
  events: readonly Record<string, unknown>[];
}

/**
 * Read the cursor returned with a board snapshot. Opening the live stream at
 * this cursor avoids replaying the board's complete event history on mount.
 */
export function kanbanEventCursorFromBoard(board: unknown, fallback = 0): number {
  const normalizedFallback = nonNegativeIntegerOr(fallback, 0);
  if (!isRecord(board)) return normalizedFallback;
  return nonNegativeIntegerOr(board.latest_event_id, normalizedFallback);
}

/** Resolve the active board emitted inside the native route metadata envelope. */
export function kanbanEventBoardFromRouteData(dataJson: string, fallback = ''): string {
  const normalizedFallback = fallback.trim();
  try {
    const snapshot: unknown = JSON.parse(dataJson);
    if (!isRecord(snapshot) || typeof snapshot.kanbanMetaJSON !== 'string') return normalizedFallback;
    const metadata: unknown = JSON.parse(snapshot.kanbanMetaJSON);
    if (!isRecord(metadata)) return normalizedFallback;
    const catalog = metadata.boards;
    if (isRecord(catalog)) {
      for (const key of ['current', 'current_board', 'active', 'selected']) {
        const slug = boardSlug(catalog[key]);
        if (slug) return slug;
      }
      if (Array.isArray(catalog.boards)) {
        const selected = catalog.boards.find((entry) => (
          isRecord(entry) && (entry.current === true || entry.active === true || entry.selected === true)
        ));
        const slug = boardSlug(selected);
        if (slug) return slug;
      }
    }
    return normalizedFallback;
  } catch {
    return normalizedFallback;
  }
}

/** Consume the official Kanban event socket until it closes or is aborted. */
export async function consumeKanbanEventsWebSocket(
  api: KanbanEventWebSocketSource,
  cursor: number,
  board: string,
  signal: AbortSignal,
  onFrame: (frame: KanbanEventFrame) => void | Promise<void>,
  connectionTimeoutMs = 5_000,
): Promise<number> {
  const initialCursor = nonNegativeIntegerOr(cursor, 0);
  if (signal.aborted) throw new Error('Hermes Kanban event WebSocket aborted');
  const socket = await api.openKanbanEventsWebSocket(
    initialCursor,
    board.trim(),
    connectionTimeoutMs,
    signal,
  );
  if (signal.aborted) {
    try { socket.close(); } catch { /* best effort */ }
    throw new Error('Hermes Kanban event WebSocket aborted');
  }

  let latestCursor = initialCursor;
  let settled = false;
  let eventChain = Promise.resolve();

  return new Promise<number>((resolve, reject) => {
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(); } catch { /* best effort */ }
      if (error) reject(error);
      else resolve(latestCursor);
    };
    const abort = () => finish(new Error('Hermes Kanban event WebSocket aborted'));
    signal.addEventListener('abort', abort, { once: true });
    socket.onmessage = (message) => {
      eventChain = eventChain.then(async () => {
        if (settled) return;
        const raw = await websocketMessageText(message.data);
        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          throw new Error('Hermes Kanban event WebSocket returned invalid JSON');
        }
        const frame = parseKanbanEventFrame(payload, latestCursor);
        if (!frame) return;
        await onFrame(frame);
        latestCursor = frame.cursor;
      }).catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
    };
    socket.onerror = () => finish(new Error('Hermes Kanban event WebSocket failed'));
    socket.onclose = (event) => {
      finish(new Error(
        event.reason || `Hermes Kanban event WebSocket closed (${event.code || 'unknown'})`,
      ));
    };
  });
}

function parseKanbanEventFrame(
  payload: unknown,
  cursor: number,
): KanbanEventFrame | null {
  if (isRecord(payload) && payload.type === 'keepalive') return null;
  if (!isRecord(payload) || !Array.isArray(payload.events)) {
    throw new Error('Hermes Kanban event WebSocket returned an invalid frame');
  }
  const nextCursor = requiredNonNegativeInteger(payload.cursor, 'frame cursor');
  if (nextCursor < cursor) {
    throw new Error('Hermes Kanban event cursor regressed');
  }
  // A duplicated frame can be delivered around a native network transition.
  // It has already invalidated the snapshot and must not cause another fetch.
  if (nextCursor === cursor) return null;
  if (!payload.events.length) {
    throw new Error('Hermes Kanban event cursor advanced without events');
  }

  let previousEventId = cursor;
  const events = payload.events.map((event) => {
    if (!isRecord(event)) {
      throw new Error('Hermes Kanban event WebSocket returned an invalid event');
    }
    const eventId = requiredNonNegativeInteger(event.id, 'event cursor');
    if (eventId <= previousEventId || eventId > nextCursor) {
      throw new Error('Hermes Kanban events are not strictly ordered');
    }
    previousEventId = eventId;
    return event;
  });
  if (previousEventId !== nextCursor) {
    throw new Error('Hermes Kanban event frame cursor does not match its events');
  }
  return { cursor: nextCursor, events };
}

async function websocketMessageText(value: unknown): Promise<string> {
  if (typeof value === 'string') return value;
  if (value && typeof (value as { text?: unknown }).text === 'function') {
    return String(await (value as Blob).text());
  }
  return String(value ?? '');
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Hermes Kanban ${label} is invalid`);
  }
  return parsed;
}

function nonNegativeIntegerOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function boardSlug(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!isRecord(value)) return '';
  for (const key of ['slug', 'id', 'name']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
