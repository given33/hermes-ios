import type { HermesApiClient } from '../HermesApiClient';
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
 * is REST-only; this object never opens a socket and is only used to keep
 * existing callers from having to coordinate a second state machine.
 */
export interface HermesStudioGroupChatSocket {
  connected: boolean;
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener?: (...args: any[]) => void): this;
  removeAllListeners(event?: string): this;
  disconnect(): void;
}

type SocketListener = (...args: any[]) => void;

class RestPollingSocket implements HermesStudioGroupChatSocket {
  connected = true;
  private readonly listeners = new Map<string, Set<SocketListener>>();

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
    const bucket = [...(this.listeners.get('disconnect') || [])];
    for (const listener of bucket) listener('rest-polling-stopped');
  }
}

/** REST adapter for the hermes-agent collaboration plugin. */
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

  createRoom(input: HermesStudioCreateRoomInput) {
    const profiles = [...new Set((input.agents || [])
      .map((agent) => agent.profile.trim())
      .filter(Boolean))];
    return this.client.request<{ room?: unknown }>(`${COLLABORATION}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.name.trim(), profiles }),
    }).then((response) => {
      const room = requiredRoom(response.room);
      return {
        room,
        agents: agentsFromProfiles(room.id, room.profiles || profiles),
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

  joinRoomByCode(_code: string): Promise<{ room: HermesStudioRoomInfo }> {
    return Promise.reject(new Error('Room invite links are not supported by the collaboration backend'));
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.client.request(`${COLLABORATION}/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
  }

  removeRoomMember(_roomId: string, _userId: string): Promise<{ success: boolean; agents: HermesStudioRoomAgent[]; members: HermesStudioRoomMember[] }> {
    return Promise.reject(unsupported('member removal'));
  }

  clearRoomContext(_roomId: string): Promise<{ success: boolean; room: HermesStudioRoomInfo }> {
    return Promise.reject(unsupported('context clearing'));
  }

  updateInviteCode(_roomId: string, _inviteCode: string): Promise<{ success: boolean }> {
    return Promise.reject(unsupported('invite codes'));
  }

  updateRoomConfig(_roomId: string, _input: HermesStudioRoomConfigInput): Promise<{ room: HermesStudioRoomInfo }> {
    return Promise.reject(unsupported('room configuration updates'));
  }

  updateRoomWorkspace(_roomId: string, _workspace: string): Promise<{ room: HermesStudioRoomInfo }> {
    return Promise.reject(unsupported('room workspaces'));
  }

  listWorkspaceFiles(_roomId: string, _path = ''): Promise<HermesStudioWorkspaceFileListing> {
    return Promise.reject(unsupported('workspace files'));
  }

  readWorkspaceFile(_roomId: string, _path: string): Promise<HermesStudioWorkspaceFileContent> {
    return Promise.reject(unsupported('workspace files'));
  }

  downloadWorkspaceFile(_roomId: string, _path: string, _options: { signal?: AbortSignal; download?: boolean } = {}): Promise<Blob> {
    return Promise.reject(unsupported('workspace files'));
  }

  async readWorkspaceFileText(roomId: string, path: string, _signal?: AbortSignal): Promise<{ content: string; size: number }> {
    const file = await this.readWorkspaceFile(roomId, path);
    return { content: file.content, size: file.size };
  }

  writeWorkspaceFile(_roomId: string, _path: string, _content: string): Promise<void> {
    return Promise.reject(unsupported('workspace files'));
  }

  mkdirWorkspaceFile(_roomId: string, _path: string): Promise<void> {
    return Promise.reject(unsupported('workspace files'));
  }

  deleteWorkspaceFile(_roomId: string, _path: string, _recursive = false): Promise<void> {
    return Promise.reject(unsupported('workspace files'));
  }

  renameWorkspaceFile(_roomId: string, _oldPath: string, _newPath: string): Promise<void> {
    return Promise.reject(unsupported('workspace files'));
  }

  copyWorkspaceFile(_roomId: string, _srcPath: string, _destPath: string): Promise<void> {
    return Promise.reject(unsupported('workspace files'));
  }

  getRoomSummary(roomId: string): Promise<{ summary: HermesStudioRoomSummaryState; anchor: HermesStudioRoomSummaryAnchor | null }> {
    return Promise.resolve({
      summary: emptySummary(roomId),
      anchor: null,
    });
  }

  updateRoomSummary(_roomId: string, _summary: string): Promise<{ summary: HermesStudioRoomSummaryState }> {
    return Promise.reject(unsupported('room summaries'));
  }

  addAgent(_roomId: string, _input: HermesStudioRoomAgentInput): Promise<{ agent: HermesStudioRoomAgent }> {
    return Promise.reject(unsupported('room member updates'));
  }

  updateAgent(_roomId: string, _agentId: string, _input: HermesStudioRoomAgentInput): Promise<{ agent: HermesStudioRoomAgent; agents: HermesStudioRoomAgent[]; members: HermesStudioRoomMember[] }> {
    return Promise.reject(unsupported('room member updates'));
  }

  async listAgents(roomId: string): Promise<{ agents: HermesStudioRoomAgent[] }> {
    const detail = await this.getRoomDetail(roomId);
    return { agents: detail.agents };
  }

  removeAgent(_roomId: string, _agentId: string): Promise<{ success: boolean; agents: HermesStudioRoomAgent[]; members: HermesStudioRoomMember[] }> {
    return Promise.reject(unsupported('room member updates'));
  }

  /** No network connection is created; controller polling owns freshness. */
  async connectRealtime(_options: HermesStudioRealtimeOptions): Promise<HermesStudioGroupChatSocket> {
    return new RestPollingSocket();
  }

  async joinRoom(_socket: HermesStudioGroupChatSocket, roomId: string, _identity: { name: string; description?: string; inviteCode?: string }): Promise<HermesStudioGroupChatJoinResult> {
    const detail = await this.getRoomDetail(roomId);
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
      typingUsers: [],
    };
  }

  async sendRoomMessage(roomId: string, id: string, content: string, profiles: string[] = [], signal?: AbortSignal): Promise<Record<string, unknown>> {
    const requestId = id.trim() || `room-request-${Date.now().toString(36)}`;
    const turnId = `room-turn-${requestId.replace(/^room-request-/, '')}`;
    return this.client.request<Record<string, unknown>>(
      `${COLLABORATION}/rooms/${encodeURIComponent(roomId)}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          ...(profiles.length ? { profiles } : {}),
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
    _mentions?: HermesStudioGroupChatMention[],
  ): Promise<string> {
    const response = await this.sendRoomMessage(roomId, id, content);
    const message = isRecord(response.message) ? response.message : null;
    return stringValue(message?.id, stringValue(response.request_id, id));
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

  respondApproval(
    _socket: HermesStudioGroupChatSocket,
    _input: { roomId: string; approvalId: string; choice: HermesStudioPendingApproval['choices'][number] },
  ): Promise<void> {
    return Promise.reject(unsupported('approval responses'));
  }

  respondApprovalRest(
    _roomId: string,
    _approvalId: string,
    _choice: HermesStudioPendingApproval['choices'][number],
  ): Promise<void> {
    return Promise.reject(unsupported('approval responses'));
  }

  emitTyping(_socket: HermesStudioGroupChatSocket, _roomId: string): void {}

  emitStopTyping(_socket: HermesStudioGroupChatSocket, _roomId: string): void {}
}

function unsupported(feature: string): Error {
  return new Error(`Hermes collaboration backend does not expose ${feature}`);
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
  return {
    id: stringValue(value.id),
    name: stringValue(value.name, stringValue(value.id)),
    inviteCode: null,
    profiles,
    messageCount: numberValue(alias(value, 'messageCount', 'message_count'), 0),
    conversationId: stringValue(alias(value, 'conversationId', 'conversation_id')) || undefined,
    hostedTurns,
    canManage: true,
    canMentionAll: false,
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
  const timestamp = numberValue(alias(value, 'timestamp', 'created_at', 'createdAt', 'updated_at'), Date.now());
  return {
    id,
    roomId: stringValue(alias(value, 'roomId', 'room_id'), fallbackRoomId),
    senderId: stringValue(alias(value, 'senderId', 'sender_id', 'member_id'), senderName),
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
  };
}

function contextStatusesFromRoom(room: HermesStudioRoomInfo): Array<{ agentName: string; status: string }> {
  return Object.values(room.hostedTurns || {}).flatMap((turn) => {
    const status = stringValue(turn.status, stringValue(turn.state, 'idle'));
    const profiles = Array.isArray(turn.profiles) ? turn.profiles : [];
    return profiles.map((profile) => ({ agentName: String(profile), status }));
  });
}

function emptySummary(roomId: string): HermesStudioRoomSummaryState {
  return {
    roomId,
    summary: '',
    summaryThroughMessageId: '',
    summaryThroughMessageTimestamp: 0,
    summarizedTurnCount: 0,
    status: 'idle',
    version: 0,
    updatedAt: 0,
    lastError: null,
  };
}
