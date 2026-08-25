import type { HermesApiClient } from '../HermesApiClient';
import { consumeHostedConversationEvents } from '../hosted-conversation-events';
import {
  isRecord,
  numberValue,
  stringValue,
  type HermesStudioCreateRoomInput,
  type HermesStudioGroupChatJoinResult,
  type HermesStudioGroupChatMention,
  type HermesStudioGroupChatMessage,
  type HermesStudioGroupChatRoomDetail,
  type HermesStudioGroupWorkspaceDiffPayload,
  type HermesStudioPendingApproval,
  type HermesStudioRoomAgent,
  type HermesStudioRoomAgentInput,
  type HermesStudioRoomConfigInput,
  type HermesStudioRoomInfo,
  type HermesStudioRoomMember,
  type HermesStudioRoomSummaryAnchor,
  type HermesStudioRoomSummaryState,
  type HermesStudioWorkspaceFileContent,
  type HermesStudioWorkspaceFileListing,
} from './types';

const COLLABORATION = '/api/plugins/collaboration';

export interface HermesStudioRealtimeOptions {
  userId: string;
  userName: string;
  description?: string;
  authUserId?: number;
  inviteCode?: string;
}

/**
 * Compatibility handle for the old controller API.  The collaboration plugin
 * is REST+SSE; this bus never opens a Socket.IO connection and exists to keep
 * existing callers from having to coordinate a second state machine.
 */
export interface HermesStudioGroupChatSocket {
  connected: boolean;
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener?: (...args: any[]) => void): this;
  removeAllListeners(event?: string): this;
  disconnect(): void;
  /** REST+SSE transport only: subscribe this bus to a room's event stream. */
  attachRoomStream?(room: {
    id: string;
    conversationId?: string;
    accountGeneration?: string;
  }): void;
  /** True when the requested room has an attached live SSE cycle. */
  hasHealthyRoomStream?(roomId?: string): boolean;
  /** REST+SSE transport only: stop every attached room stream (abort in-flight
   *  SSE cycles, clear retry timers) without tearing down the event bus. The
   *  sole implementer (RestPollingSocket) always provides this; exposing it on
   *  the interface lets callers release the iOS HTTP pool on room exit. */
  detachRoomStreams(): void;
}

type SocketListener = (...args: any[]) => void;

interface RoomStreamRecord {
  roomId: string;
  /** Stream identity: same conversation under a new account generation is a
   *  different stream — attach must replace, not no-op. */
  streamKey: string;
  conversationId: string;
  accountGeneration: string;
  controller: AbortController;
  stopped: boolean;
  cursor: number;
  seen: Map<string, string>;
  healthy: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryWake: (() => void) | null;
}

const ROOM_STREAM_RETRY_BASE_MS = 1_000;
const ROOM_STREAM_RETRY_MAX_MS = 30_000;
// Upper bound of simultaneously open room SSE streams (LRU-evicted above).
const MAX_ROOM_STREAMS = 5;

function streamFingerprint(value: string): string {
  // djb2 digest: catches same-length edits that a bare length+status
  // fingerprint silently dropped.
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 33) ^ value.charCodeAt(index)) >>> 0;
  }
  return `${value.length}:${hash.toString(36)}`;
}

/**
 * Event-bus socket backed by REST polling plus the hosted-event SSE stream.
 *
 * The collaboration plugin has no Socket.IO endpoint: room freshness comes
 * from the controller's REST polling while an attached per-room SSE
 * subscription wakes the bus the moment the server commits a change.  SSE
 * frames deliver new/updated transcript messages as `message` events and
 * surface any other conversation revision as `room_updated`, so snapshot
 * merges happen immediately instead of waiting for the next poll tick.
 */
class RestPollingSocket implements HermesStudioGroupChatSocket {
  connected = true;
  private readonly listeners = new Map<string, Set<SocketListener>>();
  private readonly streams = new Map<string, RoomStreamRecord>();
  private client: HermesApiClient | null = null;

  bind(client: HermesApiClient): void {
    this.client = client;
  }

  emit(event: string, ...args: unknown[]): void {
    const bucket = [...(this.listeners.get(event) || [])];
    for (const listener of bucket) {
      try {
        listener(...args);
      } catch {
        // A listener failure must not take down the stream loop.
      }
    }
  }

  attachRoomStream(room: {
    id: string;
    conversationId?: string;
    accountGeneration?: string;
  }): void {
    const conversationId = room.conversationId?.trim();
    const accountGeneration = room.accountGeneration?.trim();
    if (!conversationId || !accountGeneration || !this.client) return;
    const streamKey = `${conversationId}\u0000${accountGeneration}`;
    if (this.streams.has(streamKey)) {
      // Refresh LRU order so the cap below always evicts the room the user
      // touched longest ago, never the one they just opened.
      const existing = this.streams.get(streamKey)!;
      this.streams.delete(streamKey);
      this.streams.set(streamKey, existing);
      return;
    }
    for (const [key, stale] of [...this.streams.entries()]) {
      if (stale.conversationId === conversationId && key !== streamKey) {
        // Same conversation under a different account fence: retire the old
        // stream so exactly one live subscription remains.
        stale.stopped = true;
        stale.controller.abort();
        stale.retryWake?.();
        this.streams.delete(key);
      }
    }
    const record: RoomStreamRecord = {
      roomId: room.id,
      streamKey,
      conversationId,
      accountGeneration,
      controller: new AbortController(),
      stopped: false,
      cursor: 0,
      seen: new Map(),
      healthy: false,
      retryTimer: null,
      retryWake: null,
    };
    this.streams.set(streamKey, record);
    // Bound concurrent room streams: one SSE per joined room forever would
    // exhaust the iOS HTTP pool and battery. Evict the least-recently-used
    // stream; selectRoom re-attaches a room on demand.
    while (this.streams.size > MAX_ROOM_STREAMS) {
      const oldestKey = this.streams.keys().next().value as string | undefined;
      if (oldestKey === undefined || oldestKey === streamKey) break;
      const evicted = this.streams.get(oldestKey);
      this.streams.delete(oldestKey);
      if (evicted) {
        evicted.stopped = true;
        evicted.controller.abort();
        evicted.retryWake?.();
        if (evicted.retryTimer) clearTimeout(evicted.retryTimer);
      }
    }
    void this.runRoomStream(record);
  }

  detachRoomStreams(): void {
    for (const record of this.streams.values()) {
      record.stopped = true;
      record.controller.abort();
      // Wake any pending backoff wait so its async frame can observe the
      // stop flag and exit instead of leaking until the timer fires.
      record.retryWake?.();
      if (record.retryTimer) clearTimeout(record.retryTimer);
    }
    this.streams.clear();
  }

  hasHealthyRoomStream(roomId?: string): boolean {
    return [...this.streams.values()].some(
      (record) => (!roomId || record.roomId === roomId)
        && record.healthy
        && !record.stopped
        && !record.controller.signal.aborted,
    );
  }

  private async runRoomStream(record: RoomStreamRecord): Promise<void> {
    let attempt = 0;
    while (!record.stopped && this.connected && this.client) {
      const client = this.client;
      const source = {
        openHostedConversationEvents: (
          conversationId: string,
          cursor: number,
          signal: AbortSignal,
          expectedAccountGeneration: string,
          deadlineMs?: number,
        ) => client.openEventStream(
          `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}/hosted-events`,
          {
            query: {
              cursor: Math.max(0, Math.floor(cursor)),
              expected_account_generation: expectedAccountGeneration,
            },
            deadlineMs,
            signal,
          },
        ),
      };
      const cursorBefore = record.cursor;
      // A stream is healthy only while its reader is still attached.  Set the
      // flag from the activity hook instead of waiting for the async generator
      // to return (which a healthy SSE connection normally never does).
      record.healthy = false;
      try {
        record.cursor = await consumeHostedConversationEvents(
          source,
          record.conversationId,
          record.cursor,
          record.accountGeneration,
          record.controller.signal,
          (frame) => this.consumeRoomFrame(record, frame, frame.resetCursor),
          undefined,
          5_000,
          () => {
            if (!record.stopped && !record.controller.signal.aborted) {
              record.healthy = true;
            }
          },
        );
        // Only real progress justifies resetting the backoff: a stream that
        // closes without advancing (server EOF at HEAD) keeps the capped
        // schedule instead of reconnecting every second.
        if (record.cursor > cursorBefore) attempt = 0;
      } catch (error) {
        record.healthy = false;
        // Access/authorization boundaries (member stream the server
        // refuses, deleted conversation, retired generation) can never
        // succeed on retry: degrade this room to REST polling instead of
        // reconnecting forever on the backoff schedule.
        const status = Number(
          (error as { status?: unknown } | null)?.status
            ?? (error as { statusCode?: unknown } | null)?.statusCode
            ?? 0,
        );
        if (status === 403 || status === 404 || status === 410) {
          record.stopped = true;
          this.streams.delete(record.streamKey);
          this.emit('room_updated', { roomId: record.roomId });
          break;
        }
        // Other failures fall through to the reconnect backoff; polling
        // stays authoritative.
      }
      if (record.stopped || !this.connected) break;
      // EOF means the live reader is gone, even if this cycle received a
      // keepalive first. REST polling remains the freshness fallback while
      // the reconnect backoff is pending.
      record.healthy = false;
      const delay = Math.min(
        ROOM_STREAM_RETRY_BASE_MS * 2 ** attempt,
        ROOM_STREAM_RETRY_MAX_MS,
      );
      attempt += 1;
      await new Promise<void>((resolve) => {
        record.retryWake = resolve;
        record.retryTimer = setTimeout(resolve, delay);
      });
      record.retryTimer = null;
      record.retryWake = null;
    }
  }

  private consumeRoomFrame(
    record: RoomStreamRecord,
    frame: {
      conversation?: { messages?: unknown[] };
      events?: unknown[];
    },
    resetCursor = false,
  ): void {
    if (resetCursor) {
      // The parser only sets this after snapshot and account checks pass.
      this.emit('low_latency_event', {
        schema_version: 'hermes.low-latency.v1',
        event_id: `sequence-reset:${record.conversationId}:${record.accountGeneration}`,
        // The controller derives the target room from the top-level roomId
        // before consulting the nested payload; without this stamp the reset
        // never reaches the room's OrderedLowLatencyReducer.
        roomId: record.roomId,
        sequence: 0,
        cursor: 0,
        request_id: '',
        turn_id: '',
        node_id: 'server',
        type: 'sequence.reset',
        payload: {},
      });
    }
    for (const rawEvent of frame.events || []) {
      if (!isRecord(rawEvent)) continue;
      const eventType = stringValue(rawEvent.type || rawEvent.event_type);
      if (!eventType) continue;
      // Preserve the server envelope so one ordered reducer can handle
      // manager/worker/tool/model events without a parallel UI state path.
      this.emit('low_latency_event', {
        schema_version: stringValue(rawEvent.schema_version, 'hermes.low-latency.v1'),
        event_id: stringValue(rawEvent.event_id || rawEvent.id),
        // Stamp the room so envelopes whose nested payload omits room_id
        // still pass the controller's roomId gate instead of being dropped.
        roomId: record.roomId,
        // ``sequence`` is scoped to ``turn_id:role_stage`` on the server.
        // The room reducer has one ordering window, so use the conversation
        // cursor for the transport sequence whenever it is present. Without
        // this, a worker event whose per-role sequence starts at 1 after a
        // manager event at 3 is silently discarded as stale.
        sequence: numberValue(rawEvent.cursor, numberValue(rawEvent.sequence, record.cursor)),
        cursor: numberValue(rawEvent.cursor, record.cursor),
        request_id: stringValue(rawEvent.request_id),
        turn_id: stringValue(rawEvent.turn_id),
        node_id: stringValue(rawEvent.node_id, 'server'),
        type: eventType,
        payload: isRecord(rawEvent.payload) ? rawEvent.payload : rawEvent,
      });
    }
    const messages = Array.isArray(frame.conversation?.messages)
      ? frame.conversation!.messages
      : [];
    for (const raw of messages) {
      if (!isRecord(raw)) continue;
      const id = stringValue(raw.id);
      if (!id) continue;
      const content = stringValue(raw.content);
      const attachments = Array.isArray(raw.attachments) ? raw.attachments.length : 0;
      const revision = `${streamFingerprint(content)}:${stringValue(raw.status)}:${stringValue(raw.name)}:${stringValue(raw.role)}:${attachments}`;
      if (record.seen.get(id) === revision) continue;
      const known = record.seen.has(id);
      record.seen.set(id, revision);
      if (known && !content && !attachments) continue;
      this.emit('message', { ...raw, roomId: record.roomId });
    }
    // Bound the dedupe map: keep the newest ~500 message revisions so a
    // long-lived room stream cannot grow memory without limit.
    if (record.seen.size > 600) {
      for (const key of record.seen.keys()) {
        record.seen.delete(key);
        if (record.seen.size <= 500) break;
      }
    }
    // Any other committed revision (typing, roster, hosted-turn status,
    // summary) wakes the controller through the generic room refresh path.
    this.emit('room_updated', { roomId: record.roomId });
  }

  on(event: string, listener: SocketListener): this {
    const bucket = this.listeners.get(event) || new Set<SocketListener>();
    bucket.add(listener);
    this.listeners.set(event, bucket);
    return this;
  }

  once(event: string, listener: SocketListener): this {
    const wrapped: SocketListener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, listener?: SocketListener): this {
    if (!listener) {
      this.listeners.delete(event);
      return this;
    }
    const bucket = this.listeners.get(event);
    bucket?.delete(listener);
    if (bucket?.size === 0) this.listeners.delete(event);
    return this;
  }

  removeAllListeners(event?: string): this {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
    return this;
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.detachRoomStreams();
    const bucket = [...(this.listeners.get('disconnect') || [])];
    for (const listener of bucket) listener('rest-polling-stopped');
  }
}

/** REST + hosted-event-SSE adapter for the hermes-agent collaboration plugin. */
export class HermesStudioGroupChatApi {
  constructor(private readonly client: HermesApiClient) {}

  async listRooms(): Promise<HermesStudioRoomInfo[]> {
    const response = await this.client.request<{ rooms?: unknown[] }>(`${COLLABORATION}/rooms`);
    return (Array.isArray(response.rooms) ? response.rooms : [])
      .map((room) => normalizeRoom(room))
      .filter((room): room is HermesStudioRoomInfo => room !== null);
  }

  getRoomDetail(roomId: string, options: { offset?: number; limit?: number } = {}) {
    const query = new URLSearchParams();
    if (Number.isFinite(options.offset) && (options.offset || 0) > 0) {
      query.set('offset', String(Math.max(0, Math.floor(options.offset || 0))));
    }
    if (Number.isFinite(options.limit) && (options.limit || 0) > 0) {
      query.set('limit', String(Math.min(500, Math.max(1, Math.floor(options.limit || 0)))));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.client.request<unknown>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}${suffix}`,
    ).then((response) => normalizeRoomDetail(response));
  }

  async createRoom(input: HermesStudioCreateRoomInput) {
    const profiles = [...new Set((input.agents || [])
      .map((agent) => agent.profile.trim())
      .filter(Boolean))];
    return this.client.request<{ room?: unknown }>(`${COLLABORATION}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name.trim(),
        profiles,
        invite_code: input.inviteCode?.trim() || '',
        ...(input.workspace?.trim() ? { workspace: input.workspace.trim() } : {}),
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.allowGuestAgents !== undefined || input.guestAgentApproval !== undefined
          || input.maxGuestAgentsPerMember !== undefined || input.allowRemoteWorkspaceAccess !== undefined
            ? {
              settings: {
                ...(input.allowGuestAgents !== undefined ? { allow_guest_agents: input.allowGuestAgents } : {}),
                ...(input.guestAgentApproval !== undefined ? { guest_agent_approval: input.guestAgentApproval } : {}),
                ...(input.maxGuestAgentsPerMember !== undefined ? { max_guest_agents_per_member: input.maxGuestAgentsPerMember } : {}),
                ...(input.allowRemoteWorkspaceAccess !== undefined ? { allow_remote_workspace_access: input.allowRemoteWorkspaceAccess } : {}),
              },
            }
            : {}),
      }),
    }).then((response) => {
      const room = requiredRoom(response.room);
      return {
        room,
        agents: agentsFromDetail(response.room, room.id, profiles),
        agentResults: [] as unknown[],
      };
    });
  }

  async cloneRoom(roomId: string, input: { name?: string; inviteCode?: string } = {}) {
    const detail = await this.getRoomDetail(roomId);
    return this.createRoom({
      name: input.name?.trim() || `${detail.room.name} copy`,
      inviteCode: '',
      agents: detail.agents.map((agent) => ({ profile: agent.profile, agent: agent.agent })),
    });
  }

  async joinRoomByCode(code: string): Promise<{ room: HermesStudioRoomInfo }> {
    const response = await this.client.request<unknown>(`${COLLABORATION}/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite_code: code.trim() }),
    });
    const detail = normalizeRoomDetail(response);
    return { room: detail.room };
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.client.request(`${COLLABORATION}/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
  }

  async removeRoomMember(roomId: string, userId: string): Promise<{ success: boolean; agents: HermesStudioRoomAgent[]; members: HermesStudioRoomMember[] }> {
    const response = await this.client.request<{ success?: boolean; agents?: unknown[]; members?: unknown[] }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
    return {
      success: response.success !== false,
      agents: normalizeAgents(response.agents),
      members: normalizeMembers(response.members),
    };
  }

  async clearRoomContext(roomId: string): Promise<{ success: boolean; room: HermesStudioRoomInfo }> {
    await this.client.request(`${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/clear`, { method: 'POST' });
    const detail = await this.getRoomDetail(roomId);
    return { success: true, room: detail.room };
  }

  async updateInviteCode(roomId: string, inviteCode: string): Promise<{ success: boolean }> {
    const response = await this.client.request<{ success?: boolean; invite_code?: string }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/invite-code`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: inviteCode.trim() }),
      },
    );
    return { success: response.success !== false };
  }

  async updateRoomConfig(roomId: string, input: HermesStudioRoomConfigInput): Promise<{ room: HermesStudioRoomInfo }> {
    const body: Record<string, unknown> = {};
    if (input.name?.trim()) body.name = input.name.trim();
    const summary: Record<string, unknown> = {};
    if (input.summaryProfile) summary.profile = input.summaryProfile;
    if (input.summaryProvider) summary.provider = input.summaryProvider;
    if (input.summaryModel) summary.model = input.summaryModel;
    if (input.summaryApiMode) summary.api_mode = input.summaryApiMode;
    if (input.summaryEveryTurns) summary.every_turns = input.summaryEveryTurns;
    if (Object.keys(summary).length) body.summary = summary;
    const response = await this.client.request<unknown>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const detail = normalizeRoomDetail(response);
    return { room: detail.room };
  }

  async updateRoomWorkspace(roomId: string, workspace: string): Promise<{ room: HermesStudioRoomInfo }> {
    const response = await this.client.request<unknown>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: workspace.trim() }),
      },
    );
    const detail = normalizeRoomDetail(response);
    return { room: detail.room };
  }

  async listWorkspaceFiles(
    roomId: string,
    path = '',
    options: { signal?: AbortSignal } = {},
  ): Promise<HermesStudioWorkspaceFileListing> {
    const response = await this.client.request<{ entries?: unknown[]; truncated?: boolean }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/workspace/files`,
      { query: path ? { path } : undefined, signal: options.signal },
    );
    const entries = (Array.isArray(response.entries) ? response.entries : [])
      .map((entry) => {
        if (!isRecord(entry)) return null;
        const name = stringValue(entry.name);
        if (!name) return null;
        const isDir = stringValue(entry.type, 'file') === 'directory';
        const modifiedMs = numberValue(alias(entry, 'modified_at', 'modifiedAt'), 0);
        return {
          name,
          path: stringValue(entry.path, name),
          isDir,
          size: numberValue(entry.size, 0),
          modTime: modifiedMs ? new Date(modifiedMs).toISOString() : new Date(0).toISOString(),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    return { entries, path, truncated: response.truncated === true };
  }

  async readWorkspaceFile(
    roomId: string,
    path: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<HermesStudioWorkspaceFileContent> {
    const response = await this.client.request<{ path?: string; name?: string; content?: string; size?: number }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/workspace/file`,
      { query: { path }, signal: options.signal },
    );
    const content = stringValue(response.content);
    return {
      path: stringValue(response.path, path),
      content,
      size: numberValue(response.size, content.length),
    };
  }

  async downloadWorkspaceFile(roomId: string, path: string, options: { signal?: AbortSignal; download?: boolean } = {}): Promise<Blob> {
    const content = await this.readWorkspaceFile(roomId, path, { signal: options.signal });
    return new Blob([content.content], { type: 'text/plain' });
  }

  async readWorkspaceFileText(roomId: string, path: string, signal?: AbortSignal): Promise<{ content: string; size: number }> {
    const file = await this.readWorkspaceFile(roomId, path, { signal });
    return { content: file.content, size: file.size };
  }

  async writeWorkspaceFile(roomId: string, path: string, content: string): Promise<void> {
    await this.client.request(`${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/workspace/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
  }

  async mkdirWorkspaceFile(roomId: string, path: string): Promise<void> {
    await this.client.request(`${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/workspace/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  }

  async deleteWorkspaceFile(roomId: string, path: string, recursive = false): Promise<void> {
    await this.client.request(`${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/workspace/file`, {
      method: 'DELETE',
      query: { path, recursive: recursive ? 'true' : 'false' },
    });
  }

  async renameWorkspaceFile(roomId: string, oldPath: string, newPath: string): Promise<void> {
    await this.client.request(`${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/workspace/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
    });
  }

  async copyWorkspaceFile(roomId: string, srcPath: string, destPath: string): Promise<void> {
    await this.client.request(`${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/workspace/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_path: srcPath, destination_path: destPath }),
    });
  }

  async getRoomSummary(roomId: string): Promise<{ summary: HermesStudioRoomSummaryState; anchor: HermesStudioRoomSummaryAnchor | null }> {
    const response = await this.client.request<{ summary?: unknown; anchor?: unknown }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/summary`,
    );
    return {
      summary: normalizeSummaryState(response.summary, roomId),
      anchor: normalizeSummaryAnchor(response.anchor),
    };
  }

  async updateRoomSummary(roomId: string, summary: string): Promise<{ summary: HermesStudioRoomSummaryState }> {
    const response = await this.client.request<{ summary?: unknown }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/summary`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      },
    );
    return { summary: normalizeSummaryState(response.summary, roomId) };
  }

  async addAgent(roomId: string, input: HermesStudioRoomAgentInput): Promise<{ agent: HermesStudioRoomAgent }> {
    const response = await this.client.request<{ agent?: unknown }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/agents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: input.profile.trim(),
          name: input.name?.trim() || '',
          description: input.description?.trim() || '',
        }),
      },
    );
    const agent = normalizeAgent(response.agent);
    if (!agent) throw new Error('Hermes collaboration returned an invalid room agent');
    return { agent };
  }

  async updateAgent(roomId: string, agentId: string, input: HermesStudioRoomAgentInput): Promise<{ agent: HermesStudioRoomAgent; agents: HermesStudioRoomAgent[]; members: HermesStudioRoomMember[] }> {
    const response = await this.client.request<{ agent?: unknown; agents?: unknown[]; members?: unknown[] }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: input.profile?.trim() || '',
          name: input.name?.trim() || '',
          description: input.description?.trim() || '',
        }),
      },
    );
    const agent = normalizeAgent(response.agent);
    if (!agent) throw new Error('Hermes collaboration returned an invalid room agent');
    return {
      agent,
      agents: normalizeAgents(response.agents),
      members: normalizeMembers(response.members),
    };
  }

  async listAgents(roomId: string): Promise<{ agents: HermesStudioRoomAgent[] }> {
    const detail = await this.getRoomDetail(roomId);
    return { agents: detail.agents };
  }

  async removeAgent(roomId: string, agentId: string): Promise<{ success: boolean; agents: HermesStudioRoomAgent[]; members: HermesStudioRoomMember[] }> {
    const response = await this.client.request<{ success?: boolean; agents?: unknown[]; members?: unknown[] }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentId)}`,
      { method: 'DELETE' },
    );
    return {
      success: response.success !== false,
      agents: normalizeAgents(response.agents),
      members: normalizeMembers(response.members),
    };
  }

  /** Opens the REST+SSE wake bus; the controller's polling owns freshness. */
  async connectRealtime(_options: HermesStudioRealtimeOptions): Promise<HermesStudioGroupChatSocket> {
    const socket = new RestPollingSocket();
    socket.bind(this.client);
    return socket;
  }

  async joinRoom(socket: HermesStudioGroupChatSocket, roomId: string, _identity: { name: string; description?: string; inviteCode?: string }): Promise<HermesStudioGroupChatJoinResult> {
    const detail = await this.getRoomDetail(roomId);
    socket.attachRoomStream?.(detail.room);
    return {
      roomId: detail.room.id,
      roomName: detail.room.name,
      members: detail.members,
      messages: detail.messages,
      agents: detail.agents,
      rooms: [detail.room.id],
      total: detail.total,
      offset: detail.offset,
      limit: detail.limit,
      hasMore: detail.hasMore,
      contextStatuses: contextStatusesFromRoom(detail.room),
      pendingApprovals: [],
      typingUsers: (detail.typingUsers || []).map((name) => ({ userId: name, userName: name })),
    };
  }

  async sendRoomMessage(
    roomId: string,
    id: string,
    content: string,
    profiles: string[] = [],
    signal?: AbortSignal,
    mentions?: HermesStudioGroupChatMention[],
    attachments?: unknown[],
  ): Promise<Record<string, unknown>> {
    const requestId = id.trim() || `room-request-${Date.now().toString(36)}`;
    const turnId = `room-turn-${requestId.replace(/^room-request-/, '')}`;
    // Mentions own routing when present; an explicit profile list is only
    // kept for legacy callers that never resolved a mention chip.
    const useProfiles = mentions?.length ? [] : profiles;
    return this.client.request<Record<string, unknown>>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          ...(useProfiles.length ? { profiles: useProfiles } : {}),
          ...(mentions?.length
            ? {
              mentions: mentions.map((mention) => ({
                type: mention.type,
                participantId: mention.participantId || mention.displayName,
                displayName: mention.displayName,
              })),
            }
            : {}),
          ...(attachments?.length ? { attachments } : {}),
          request_id: requestId,
          turn_id: turnId,
        }),
        signal,
      },
    );
  }

  async sendMessage(
    _socket: HermesStudioGroupChatSocket,
    roomId: string,
    id: string,
    content: string,
    _attachments?: unknown[],
    mentions?: HermesStudioGroupChatMention[],
  ): Promise<string> {
    const response = await this.sendRoomMessage(roomId, id, content, [], undefined, mentions, _attachments);
    const message = isRecord(response.message) ? response.message : null;
    return stringValue(message?.id, stringValue(response.request_id, id));
  }

  async retractMessage(roomId: string, messageId: string): Promise<void> {
    await this.client.request(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'DELETE' },
    );
  }

  async cancelHostedTurn(roomId: string, turnId: string, reason = 'user_cancelled'): Promise<void> {
    await this.client.request(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/hosted-turns/${encodeURIComponent(turnId)}/cancel`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, request_id: `cancel-${turnId}` }),
      },
    );
  }

  async interruptAgent(_socket: HermesStudioGroupChatSocket, roomId: string, agentName: string): Promise<void> {
    const detail = await this.getRoomDetail(roomId);
    const target = Object.entries(detail.room.hostedTurns || {}).find(([, turn]) => {
      const status = stringValue(turn.status, stringValue(turn.state)).toLowerCase();
      const profiles = Array.isArray(turn.profiles) ? turn.profiles.map((item) => String(item)) : [];
      return ['queued', 'running', 'pending', 'pending_approval'].includes(status)
        && (!agentName.trim() || profiles.includes(agentName) || stringValue(turn.profile) === agentName);
    });
    if (target) await this.cancelHostedTurn(roomId, target[0]);
  }

  async interruptAgentByName(roomId: string, agentName: string): Promise<void> {
    await this.interruptAgent(new RestPollingSocket(), roomId, agentName);
  }

  async listApprovals(roomId: string): Promise<HermesStudioPendingApproval[]> {
    const response = await this.client.request<{ approvals?: unknown[] }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/approvals`,
    );
    return (Array.isArray(response.approvals) ? response.approvals : [])
      .map((approval) => normalizeApproval(approval, roomId))
      .filter((approval): approval is HermesStudioPendingApproval => approval !== null);
  }

  respondApproval(
    _socket: HermesStudioGroupChatSocket,
    input: { roomId: string; approvalId: string; choice: HermesStudioPendingApproval['choices'][number] },
  ): Promise<void> {
    return this.respondApprovalRest(input.roomId, input.approvalId, input.choice);
  }

  async respondApprovalRest(
    roomId: string,
    approvalId: string,
    choice: HermesStudioPendingApproval['choices'][number],
    context: { profile?: string; expectedRevision?: number; payloadDigest?: string } = {},
  ): Promise<void> {
    await this.client.request(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/approvals/${encodeURIComponent(approvalId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: context.profile || 'default',
          expected_revision: context.expectedRevision || 1,
          decision: choice === 'deny' ? 'reject' : 'approve',
          payload_digest: context.payloadDigest || '',
        }),
      },
    );
  }

  emitTyping(socket: HermesStudioGroupChatSocket, roomId: string): void {
    void this.postTyping(socket, roomId, 'start');
  }

  emitStopTyping(socket: HermesStudioGroupChatSocket, roomId: string): void {
    void this.postTyping(socket, roomId, 'stop');
  }

  private async postTyping(
    _socket: HermesStudioGroupChatSocket,
    roomId: string,
    state: 'start' | 'stop',
  ): Promise<void> {
    try {
      await this.client.request(`${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
    } catch {
      // Typing presence is best-effort; never surface transport errors for it.
    }
  }
}

function agentsFromDetail(value: unknown, roomId: string, fallbackProfiles: string[]): HermesStudioRoomAgent[] {
  const agents = Array.isArray((value as Record<string, unknown>)?.agents)
    ? normalizeAgents((value as Record<string, unknown>).agents)
    : [];
  return agents.length ? agents : agentsFromProfiles(roomId, fallbackProfiles);
}

function normalizeApproval(value: unknown, roomId: string): HermesStudioPendingApproval | null {
  if (!isRecord(value)) return null;
  const approvalId = stringValue(alias(value, 'approval_id', 'id'));
  if (!approvalId) return null;
  const choices = ['once', 'session', 'deny'] as const;
  return {
    roomId,
    agentName: stringValue(alias(value, 'subsystem', 'profile')),
    approvalId,
    command: stringValue(value.command),
    description: stringValue(alias(value, 'summary', 'description')),
    choices: [...choices],
    allowPermanent: false,
    isMemoryWrite: stringValue(value.subsystem) === 'memory',
    requestedAt: numberValue(alias(value, 'created_at', 'createdAt'), Date.now()),
    profile: stringValue(value.profile, 'default'),
    expectedRevision: numberValue(alias(value, 'revision', 'expected_revision'), 1) || 1,
    payloadDigest: stringValue(alias(value, 'payload_digest', 'payloadDigest')),
  };
}

function alias(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function normalizeRoom(value: unknown): HermesStudioRoomInfo | null {
  if (!isRecord(value) || !stringValue(value.id).trim()) return null;
  const profiles = Array.isArray(value.profiles)
    ? value.profiles.filter((profile): profile is string => typeof profile === 'string' && Boolean(profile.trim())).map((profile) => profile.trim())
    : [];
  const hostedTurns = normalizeHostedTurns(alias(value, 'hosted_turns', 'hostedTurns'));
  const createdAt = numberValue(alias(value, 'createdAt', 'created_at'), 0);
  const lastActiveAt = numberValue(alias(value, 'lastActiveAt', 'updated_at', 'updatedAt'), createdAt);
  const summaryConfig = isRecord(value.summary_config) ? value.summary_config : {};
  const settings = isRecord(value.settings) ? value.settings : {};
  const inviteCodeRaw = alias(value, 'inviteCode', 'invite_code');
  return {
    id: stringValue(value.id),
    name: stringValue(value.name, stringValue(value.id)),
    inviteCode: typeof inviteCodeRaw === 'string' && inviteCodeRaw.trim() ? inviteCodeRaw : null,
    profiles,
    messageCount: numberValue(alias(value, 'messageCount', 'message_count'), 0),
    conversationId: stringValue(alias(value, 'conversationId', 'conversation_id')) || undefined,
    hostedTurns,
    canManage: value.can_manage !== false,
    canMentionAll: value.can_mention_all === true || profiles.length > 1,
    accountGeneration: stringValue(alias(value, 'account_generation', 'accountGeneration')) || undefined,
    summaryProfile: stringValue(alias(summaryConfig, 'profile')) || undefined,
    summaryProvider: stringValue(alias(summaryConfig, 'provider')) || undefined,
    summaryModel: stringValue(alias(summaryConfig, 'model')) || undefined,
    summaryApiMode: stringValue(alias(summaryConfig, 'api_mode')) || undefined,
    summaryEveryTurns: numberValue(alias(summaryConfig, 'every_turns'), 0) || undefined,
    workspace: stringValue(value.workspace) || undefined,
    allowGuestAgents: numberValue(alias(settings, 'allow_guest_agents'), 0) || undefined,
    guestAgentApproval: stringValue(alias(settings, 'guest_agent_approval')) || undefined,
    maxGuestAgentsPerMember: numberValue(alias(settings, 'max_guest_agents_per_member'), 0) || undefined,
    allowRemoteWorkspaceAccess: numberValue(alias(settings, 'allow_remote_workspace_access'), 0) || undefined,
    createdAt: createdAt || undefined,
    lastActiveAt: lastActiveAt || undefined,
  };
}

function requiredRoom(value: unknown): HermesStudioRoomInfo {
  const room = normalizeRoom(value);
  if (!room) throw new Error('Hermes collaboration returned an invalid room');
  return room;
}

function normalizeHostedTurns(value: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, turn]) => isRecord(turn)) as Array<[string, Record<string, unknown>]>);
}

function agentsFromProfiles(roomId: string, profiles: string[]): HermesStudioRoomAgent[] {
  return [...new Set(profiles.map((profile) => profile.trim()).filter(Boolean))].map((profile) => ({
    id: `${roomId}:profile:${profile}`,
    roomId,
    agentId: profile,
    agent: profile,
    profile,
    name: profile,
    connectionStatus: 'online',
  }));
}

function normalizeAgent(value: unknown): HermesStudioRoomAgent | null {
  if (typeof value === 'string') {
    const profile = value.trim();
    return profile ? {
      id: profile,
      roomId: '',
      agentId: profile,
      agent: profile,
      profile,
      name: profile,
      connectionStatus: 'online',
    } : null;
  }
  if (!isRecord(value)) return null;
  const profile = stringValue(alias(value, 'profile', 'name', 'agent'), 'default');
  const id = stringValue(value.id, profile);
  return {
    id,
    roomId: stringValue(alias(value, 'roomId', 'room_id')),
    agentId: stringValue(alias(value, 'agentId', 'agent_id'), profile),
    agent: stringValue(value.agent, profile),
    profile,
    provider: stringValue(value.provider),
    model: stringValue(value.model),
    name: stringValue(value.name, profile),
    description: stringValue(value.description),
    avatar: stringValue(value.avatar),
    connectionStatus: stringValue(alias(value, 'connectionStatus', 'connection_status'), 'online'),
  };
}

/** Normalize an agent roster carried by a legacy caller or REST projection. */
export function normalizeRoomAgent(value: unknown): HermesStudioRoomAgent | null {
  return normalizeAgent(value);
}

function normalizeAgents(values: unknown): HermesStudioRoomAgent[] {
  return (Array.isArray(values) ? values : [])
    .map(normalizeAgent)
    .filter((agent): agent is HermesStudioRoomAgent => agent !== null);
}

function normalizeMember(value: unknown): HermesStudioRoomMember | null {
  if (!isRecord(value) || !stringValue(value.id).trim()) return null;
  return {
    id: stringValue(value.id),
    userId: stringValue(alias(value, 'userId', 'user_id')),
    name: stringValue(value.name, 'Member'),
    description: stringValue(value.description),
    joinedAt: numberValue(alias(value, 'joinedAt', 'joined_at'), 0) || undefined,
    avatar: stringValue(value.avatar),
    connectionStatus: stringValue(alias(value, 'connectionStatus', 'connection_status')),
  };
}

function normalizeMembers(values: unknown): HermesStudioRoomMember[] {
  return (Array.isArray(values) ? values : [])
    .map(normalizeMember)
    .filter((member): member is HermesStudioRoomMember => member !== null);
}

export function normalizeGroupMessage(value: unknown, fallbackRoomId = ''): HermesStudioGroupChatMessage | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id).trim();
  if (!id) return null;
  const role = stringValue(value.role, stringValue(value.sender_role));
  const senderName = stringValue(alias(value, 'senderName', 'sender_name', 'name', 'profile'), role || 'Agent');
  const status = stringValue(value.status).toLowerCase();
  const meta = isRecord(value.meta) ? value.meta : isRecord(value.metadata) ? value.metadata : {};
  // Missing server timestamps must be stable across repeated projections;
  // Date.now() would make the same historical row look like a new revision.
  const timestamp = numberValue(alias(value, 'timestamp', 'created_at', 'createdAt', 'updated_at'), 0);
  return {
    id,
    roomId: stringValue(alias(value, 'roomId', 'room_id'), fallbackRoomId),
    senderId: stringValue(alias(value, 'senderId', 'sender_id', 'member_id')),
    senderName,
    senderType: role,
    senderAgentProfile: stringValue(value.profile),
    senderAgentProvider: stringValue(value.provider),
    senderAgentModel: stringValue(value.model),
    content: stringValue(value.content),
    timestamp,
    persistedAt: timestamp,
    role,
    run_id: stringValue(alias(value, 'run_id', 'turn_id')) || null,
    tool_call_id: stringValue(value.tool_call_id) || null,
    tool_calls: Array.isArray(value.tool_calls) ? value.tool_calls : null,
    tool_name: stringValue(alias(value, 'tool_name', 'toolName')) || null,
    finish_reason: stringValue(value.finish_reason) || (status === 'completed' ? 'stop' : null),
    reasoning: stringValue(value.reasoning) || stringValue(meta.reasoning) || null,
    reasoning_details: stringValue(value.reasoning_details) || null,
    reasoning_content: stringValue(value.reasoning_content) || null,
    toolName: stringValue(alias(value, 'toolName', 'tool_name')),
    toolCallId: stringValue(alias(value, 'toolCallId', 'tool_call_id')),
    toolArgs: value.toolArgs ?? value.tool_args,
    toolResult: value.toolResult ?? value.tool_result,
    toolStatus: status === 'running' ? 'running' : status === 'failed' ? 'error' : status === 'completed' ? 'done' : undefined,
    isStreaming: value.isStreaming === true || status === 'running' || status === 'streaming',
    deliveryStatus: value.deliveryStatus === 'pending' || value.deliveryStatus === 'sent' || value.deliveryStatus === 'failed'
      ? value.deliveryStatus
      : undefined,
    retracted: meta.retracted === true,
    runItems: Array.isArray(value.runItems)
      ? value.runItems.map((item) => normalizeGroupMessage(item, stringValue(alias(value, 'roomId', 'room_id'), fallbackRoomId))).filter((item): item is HermesStudioGroupChatMessage => item !== null)
      : undefined,
  };
}

function normalizeRoomDetail(value: unknown): HermesStudioGroupChatRoomDetail {
  const record = isRecord(value) ? value : {};
  const rawRoom = isRecord(record.room) ? record.room : record;
  const room = requiredRoom(rawRoom);
  const messages = Array.isArray(record.messages)
    ? record.messages
    : Array.isArray(rawRoom.messages) ? rawRoom.messages : [];
  const rawAgents = record.agents ?? rawRoom.agents;
  const agents = Array.isArray(rawAgents) && rawAgents.length
    ? normalizeAgents(rawAgents)
    : agentsFromProfiles(room.id, room.profiles || []);
  return {
    room,
    agents,
    members: normalizeMembers(record.members ?? rawRoom.members),
    messages: messages.map((message) => normalizeGroupMessage(message, room.id)).filter((message): message is HermesStudioGroupChatMessage => message !== null),
    total: numberValue(alias(record, 'total', 'message_count'), numberValue(rawRoom.message_count, room.messageCount || messages.length)),
    offset: numberValue(alias(record, 'offset', 'message_offset'), numberValue(rawRoom.offset, 0)),
    limit: numberValue(alias(record, 'limit', 'page_size'), numberValue(rawRoom.limit, messages.length || 150)),
    hasMore: record.has_more === true || record.hasMore === true
      || rawRoom.has_more === true || rawRoom.hasMore === true,
    typingUsers: (Array.isArray(record.typing_users) ? record.typing_users : [])
      .map((entry) => (isRecord(entry) ? stringValue(entry.name) : ''))
      .filter(Boolean),
  };
}

function contextStatusesFromRoom(room: HermesStudioRoomInfo): Array<{ agentName: string; status: string }> {
  return Object.values(room.hostedTurns || {}).flatMap((turn) => {
    const status = stringValue(turn.status, stringValue(turn.state, 'idle'));
    const profiles = Array.isArray(turn.profiles) ? turn.profiles : [];
    return profiles.map((profile) => ({ agentName: String(profile), status }));
  });
}

function normalizeSummaryState(value: unknown, roomId: string): HermesStudioRoomSummaryState {
  const record = isRecord(value) ? value : {};
  return {
    roomId: stringValue(record.roomId, roomId),
    summary: stringValue(record.summary),
    summaryThroughMessageId: stringValue(alias(record, 'summaryThroughMessageId', 'summary_through_message_id')),
    summaryThroughMessageTimestamp: numberValue(alias(record, 'summaryThroughMessageTimestamp', 'summary_through_message_timestamp'), 0),
    summarizedTurnCount: numberValue(alias(record, 'summarizedTurnCount', 'summarized_turn_count'), 0),
    status: stringValue(record.status, 'idle'),
    version: numberValue(record.version, 0),
    updatedAt: numberValue(alias(record, 'updatedAt', 'updated_at'), 0),
    lastError: record.lastError === null || record.lastError === undefined ? null : stringValue(record.lastError) || null,
  };
}

function normalizeSummaryAnchor(value: unknown): HermesStudioRoomSummaryAnchor | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  return {
    id,
    timestamp: numberValue(value.timestamp, 0),
    senderName: stringValue(value.senderName, 'Member'),
    role: stringValue(value.role) || undefined,
    content: stringValue(value.content),
  };
}
