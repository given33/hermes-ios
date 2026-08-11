import { io, type Socket } from 'socket.io-client';

import type { HermesApiClient } from '../HermesApiClient';
import {
  isRecord,
  numberValue,
  stringValue,
  type HermesStudioCreateRoomInput,
  type HermesStudioGroupChatJoinResult,
  type HermesStudioGroupChatMessage,
  type HermesStudioGroupChatRoomDetail,
  type HermesStudioRoomAgent,
  type HermesStudioRoomAgentInput,
  type HermesStudioRoomConfigInput,
  type HermesStudioRoomInfo,
  type HermesStudioRoomMember,
  type HermesStudioRoomSummaryAnchor,
  type HermesStudioRoomSummaryState,
  type HermesStudioGroupChatMention,
  type HermesStudioGroupWorkspaceDiffPayload,
  type HermesStudioWorkspaceFileContent,
  type HermesStudioWorkspaceFileListing,
} from './types';

export interface HermesStudioRealtimeOptions {
  userId: string;
  userName: string;
  description?: string;
  authUserId?: number;
  inviteCode?: string;
}

export type HermesStudioGroupChatSocket = Socket;

/**
 * Hermes Studio's group-chat transport is deliberately kept in its own API
 * object. The hosted collaboration endpoints used by the existing chat use
 * a different server contract and must not accidentally share this state.
 */
export class HermesStudioGroupChatApi {
  constructor(private readonly client: HermesApiClient) {}

  async listRooms(): Promise<HermesStudioRoomInfo[]> {
    const response = await this.client.request<{ rooms?: unknown[] }>('/api/hermes/group-chat/rooms');
    return (Array.isArray(response.rooms) ? response.rooms : [])
      .map((room) => normalizeRoom(room))
      .filter((room): room is HermesStudioRoomInfo => room !== null);
  }

  getRoomDetail(roomId: string, options: { offset?: number; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    const query = params.toString();
    return this.client.request<unknown>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}${query ? `?${query}` : ''}`,
    ).then((response) => normalizeRoomDetail(response));
  }

  createRoom(input: HermesStudioCreateRoomInput) {
    return this.client.request<{ room?: unknown; agents?: unknown[]; agentResults?: unknown[] }>(
      '/api/hermes/group-chat/rooms',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => ({
      room: requiredRoom(response.room),
      agents: normalizeAgents(response.agents),
      agentResults: Array.isArray(response.agentResults) ? response.agentResults : [],
    }));
  }

  cloneRoom(roomId: string, input: { name?: string; inviteCode?: string } = {}) {
    return this.client.request<{ room?: unknown; agents?: unknown[]; agentResults?: unknown[] }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/clone`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => ({
      room: requiredRoom(response.room),
      agents: normalizeAgents(response.agents),
      agentResults: Array.isArray(response.agentResults) ? response.agentResults : [],
    }));
  }

  joinRoomByCode(code: string) {
    return this.client.request<{ room?: unknown }>(
      `/api/hermes/group-chat/rooms/join/${encodeURIComponent(code.trim())}`,
    ).then((response) => ({ room: requiredRoom(response.room) }));
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.client.request(`/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}`, {
      method: 'DELETE',
    });
  }

  removeRoomMember(roomId: string, userId: string) {
    return this.client.request<{ success: boolean; agents?: unknown[]; members?: unknown[] }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ).then((response) => ({
      ...response,
      agents: normalizeAgents(response.agents),
      members: normalizeMembers(response.members),
    }));
  }

  clearRoomContext(roomId: string) {
    return this.client.request<{ success: boolean; room?: unknown }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/clear-context`,
      { method: 'POST' },
    ).then((response) => ({
      ...response,
      room: requiredRoom(response.room),
    }));
  }

  updateInviteCode(roomId: string, inviteCode: string) {
    return this.client.request<{ success: boolean }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/invite-code`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode }),
      },
    );
  }

  updateRoomConfig(roomId: string, input: HermesStudioRoomConfigInput) {
    return this.client.request<{ room?: unknown }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/config`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => ({ room: requiredRoom(response.room) }));
  }

  updateRoomWorkspace(roomId: string, workspace: string) {
    return this.client.request<{ room?: unknown }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/workspace`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace }),
      },
    ).then((response) => ({ room: requiredRoom(response.room) }));
  }

  listWorkspaceFiles(roomId: string, path = '') {
    const query = path.trim() ? `?path=${encodeURIComponent(path.trim())}` : '';
    return this.client.request<HermesStudioWorkspaceFileListing>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/workspace-files/list${query}`,
    );
  }

  readWorkspaceFile(roomId: string, path: string) {
    return this.client.request<HermesStudioWorkspaceFileContent>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/workspace-file/read?path=${encodeURIComponent(path)}`,
    );
  }

  downloadWorkspaceFile(roomId: string, path: string, options: { signal?: AbortSignal; download?: boolean } = {}) {
    return this.client.download(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/workspace-file/content`,
      {
        query: { path, ...(options.download ? { download: '1' } : {}) },
        signal: options.signal,
      },
    );
  }

  async readWorkspaceFileText(roomId: string, path: string, signal?: AbortSignal): Promise<{ content: string; size: number }> {
    const blob = await this.downloadWorkspaceFile(roomId, path, { signal });
    return { content: await blob.text(), size: blob.size };
  }

  writeWorkspaceFile(roomId: string, path: string, content: string): Promise<void> {
    return this.client.request(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/workspace-file/write`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      },
    ).then(() => undefined);
  }

  mkdirWorkspaceFile(roomId: string, path: string): Promise<void> {
    return this.client.request(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/workspace-file/mkdir`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      },
    ).then(() => undefined);
  }

  deleteWorkspaceFile(roomId: string, path: string, recursive = false): Promise<void> {
    return this.client.request(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/workspace-file/delete`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, recursive }),
      },
    ).then(() => undefined);
  }

  renameWorkspaceFile(roomId: string, oldPath: string, newPath: string): Promise<void> {
    return this.client.request(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/workspace-file/rename`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      },
    ).then(() => undefined);
  }

  copyWorkspaceFile(roomId: string, srcPath: string, destPath: string): Promise<void> {
    return this.client.request(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/workspace-file/copy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ srcPath, destPath }),
      },
    ).then(() => undefined);
  }

  getRoomSummary(roomId: string) {
    return this.client.request<{ summary?: unknown; anchor?: unknown }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/summary`,
    ).then((response) => ({
      summary: normalizeSummary(response.summary, roomId),
      anchor: normalizeSummaryAnchor(response.anchor),
    }));
  }

  updateRoomSummary(roomId: string, summary: string) {
    return this.client.request<{ summary?: unknown }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/summary`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      },
    ).then((response) => ({ summary: normalizeSummary(response.summary, roomId) }));
  }

  addAgent(roomId: string, input: HermesStudioRoomAgentInput) {
    return this.client.request<{ agent?: unknown }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/agents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => ({ agent: requiredAgent(response.agent) }));
  }

  updateAgent(roomId: string, agentId: string, input: HermesStudioRoomAgentInput) {
    return this.client.request<{ agent?: unknown; agents?: unknown[]; members?: unknown[] }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => ({
      agent: requiredAgent(response.agent),
      agents: normalizeAgents(response.agents),
      members: normalizeMembers(response.members),
    }));
  }

  listAgents(roomId: string) {
    return this.client.request<{ agents?: unknown[] }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/agents`,
    ).then((response) => ({ agents: normalizeAgents(response.agents) }));
  }

  removeAgent(roomId: string, agentId: string) {
    return this.client.request<{ success: boolean; agents?: unknown[]; members?: unknown[] }>(
      `/api/hermes/group-chat/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentId)}`,
      { method: 'DELETE' },
    ).then((response) => ({
      ...response,
      agents: normalizeAgents(response.agents),
      members: normalizeMembers(response.members),
    }));
  }

  async connectRealtime(options: HermesStudioRealtimeOptions): Promise<HermesStudioGroupChatSocket> {
    const token = await this.client.getAccessTokenForRealtime();
    const endpoint = new URL('/group-chat', `${this.client.baseUrl}/`).toString();
    const socket = io(endpoint, {
      autoConnect: false,
      auth: {
        token,
        userId: options.userId,
        name: options.userName,
        description: options.description || '',
        ...(options.authUserId ? { authUserId: options.authUserId } : {}),
        ...(options.inviteCode?.trim() ? { inviteCode: options.inviteCode.trim() } : {}),
      },
      // Keep bearer material in Socket.IO's handshake auth object.  Putting it
      // in `query` leaks the token into URLs and proxy/access logs; the Hermes
      // Studio official middleware reads `auth.token` directly.
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      timeout: 30_000,
    });
    socket.io.on('reconnect_attempt', () => {
      void this.client.getAccessTokenForRealtime()
        .then((nextToken) => {
          const currentAuth = isRecord(socket.auth) ? socket.auth : {};
          socket.auth = { ...currentAuth, token: nextToken };
        })
        .catch(() => undefined);
    });
    socket.connect();
    return socket;
  }

  joinRoom(
    socket: HermesStudioGroupChatSocket,
    roomId: string,
    identity: { name: string; description?: string },
  ): Promise<HermesStudioGroupChatJoinResult> {
    return new Promise((resolve, reject) => {
      if (!socket.connected) {
        reject(new Error('Hermes Studio group chat is reconnecting'));
        return;
      }
      socket.timeout(15_000).emit(
        'join',
        { roomId, name: identity.name, description: identity.description || '' },
        (error: Error | null, response: unknown) => {
          if (error) {
            reject(error);
            return;
          }
          const result = normalizeJoinResult(response, roomId);
          if (!result) {
            reject(new Error('Hermes Studio returned an invalid room response'));
            return;
          }
          resolve(result);
        },
      );
    });
  }

  sendMessage(
    socket: HermesStudioGroupChatSocket,
    roomId: string,
    id: string,
    content: string,
    attachments?: unknown[],
    mentions?: HermesStudioGroupChatMention[],
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!socket.connected) {
        reject(new Error('Hermes Studio group chat is reconnecting'));
        return;
      }
      socket.timeout(15_000).emit(
        'message',
        {
          roomId,
          id,
          content,
          ...(attachments?.length ? { attachments } : {}),
          ...(mentions?.length ? { mentions } : {}),
        },
        (error: Error | null, response: unknown) => {
          if (error) {
            reject(error);
            return;
          }
          if (isRecord(response) && typeof response.error === 'string') {
            reject(new Error(response.error));
            return;
          }
          resolve(isRecord(response) && typeof response.id === 'string' ? response.id : id);
        },
      );
    });
  }

  interruptAgent(socket: HermesStudioGroupChatSocket, roomId: string, agentName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!socket.connected) {
        reject(new Error('Hermes Studio group chat is reconnecting'));
        return;
      }
      socket.timeout(15_000).emit(
        'interrupt_agent',
        { roomId, agentName },
        (error: Error | null, response: unknown) => {
          if (error) reject(error);
          else if (isRecord(response) && typeof response.error === 'string') reject(new Error(response.error));
          else resolve();
        },
      );
    });
  }

  respondApproval(
    socket: HermesStudioGroupChatSocket,
    input: { roomId: string; approvalId: string; choice: 'once' | 'session' | 'always' | 'deny' },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!socket.connected) {
        reject(new Error('Hermes Studio group chat is reconnecting'));
        return;
      }
      socket.timeout(15_000).emit(
        'approval.respond',
        { roomId: input.roomId, approval_id: input.approvalId, choice: input.choice },
        (error: Error | null, response: unknown) => {
          if (error) reject(error);
          else if (isRecord(response) && typeof response.error === 'string') reject(new Error(response.error));
          else resolve();
        },
      );
    });
  }

  emitTyping(socket: HermesStudioGroupChatSocket, roomId: string): void {
    if (socket.connected) socket.emit('typing', { roomId });
  }

  emitStopTyping(socket: HermesStudioGroupChatSocket, roomId: string): void {
    if (socket.connected) socket.emit('stop_typing', { roomId });
  }
}

function normalizeRoom(value: unknown): HermesStudioRoomInfo | null {
  if (!isRecord(value) || !stringValue(value.id).trim()) return null;
  return {
    id: stringValue(value.id),
    name: stringValue(value.name, stringValue(value.id)),
    inviteCode: value.inviteCode === null ? null : stringValue(value.inviteCode) || null,
    canManage: typeof value.canManage === 'boolean' ? value.canManage : undefined,
    canMentionAll: typeof value.canMentionAll === 'boolean' ? value.canMentionAll : undefined,
    ownerMemberId: stringValue(value.ownerMemberId),
    summaryProfile: stringValue(value.summaryProfile),
    summaryProvider: stringValue(value.summaryProvider),
    summaryModel: stringValue(value.summaryModel),
    summaryApiMode: stringValue(value.summaryApiMode),
    summaryEveryTurns: numberValue(value.summaryEveryTurns, 20),
    totalTokens: value.totalTokens === undefined ? undefined : numberValue(value.totalTokens, 0),
    workspace: stringValue(value.workspace),
    allowGuestAgents: value.allowGuestAgents === undefined ? undefined : numberValue(value.allowGuestAgents, 0),
    guestAgentApproval: stringValue(value.guestAgentApproval),
    maxGuestAgentsPerMember: value.maxGuestAgentsPerMember === undefined
      ? undefined
      : numberValue(value.maxGuestAgentsPerMember, 0),
    allowRemoteWorkspaceAccess: value.allowRemoteWorkspaceAccess === undefined
      ? undefined
      : numberValue(value.allowRemoteWorkspaceAccess, 0),
    createdAt: value.createdAt === undefined ? undefined : numberValue(value.createdAt, 0),
    lastActiveAt: value.lastActiveAt === undefined ? undefined : numberValue(value.lastActiveAt, 0),
  };
}

function requiredRoom(value: unknown): HermesStudioRoomInfo {
  const room = normalizeRoom(value);
  if (!room) throw new Error('Hermes Studio returned an invalid room');
  return room;
}

function normalizeAgent(value: unknown): HermesStudioRoomAgent | null {
  if (!isRecord(value) || !stringValue(value.id).trim()) return null;
  return {
    id: stringValue(value.id),
    roomId: stringValue(value.roomId),
    agentId: stringValue(value.agentId),
    agent: stringValue(value.agent, 'hermes'),
    profile: stringValue(value.profile, 'default'),
    provider: stringValue(value.provider),
    model: stringValue(value.model),
    apiMode: stringValue(value.apiMode),
    reasoningEffort: stringValue(value.reasoningEffort),
    name: stringValue(value.name, stringValue(value.profile, 'Agent')),
    description: stringValue(value.description),
    avatar: stringValue(value.avatar),
    invited: typeof value.invited === 'boolean' || typeof value.invited === 'number'
      ? value.invited
      : undefined,
    executorType: stringValue(value.executorType),
    remoteOrigin: stringValue(value.remoteOrigin),
    connectionStatus: stringValue(value.connectionStatus),
    ownerMemberId: stringValue(value.ownerMemberId),
    connectorId: stringValue(value.connectorId),
    historical: typeof value.historical === 'boolean' ? value.historical : undefined,
  };
}

function requiredAgent(value: unknown): HermesStudioRoomAgent {
  const agent = normalizeAgent(value);
  if (!agent) throw new Error('Hermes Studio returned an invalid agent');
  return agent;
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
    userId: stringValue(value.userId),
    name: stringValue(value.name, 'Member'),
    description: stringValue(value.description),
    joinedAt: value.joinedAt === undefined ? undefined : numberValue(value.joinedAt, 0),
    avatar: stringValue(value.avatar),
    connectionStatus: stringValue(value.connectionStatus),
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
  return {
    id,
    roomId: stringValue(value.roomId, fallbackRoomId),
    senderId: stringValue(value.senderId),
    senderName: stringValue(value.senderName, 'Agent'),
    senderType: stringValue(value.senderType),
    senderAgentRecordId: stringValue(value.senderAgentRecordId),
    senderAvatar: stringValue(value.senderAvatar),
    senderAgentType: stringValue(value.senderAgentType),
    senderAgentProfile: stringValue(value.senderAgentProfile),
    senderAgentProvider: stringValue(value.senderAgentProvider),
    senderAgentModel: stringValue(value.senderAgentModel),
    senderAgentDescription: stringValue(value.senderAgentDescription),
    senderOwnerMemberId: stringValue(value.senderOwnerMemberId),
    content: stringValue(value.content),
    timestamp: numberValue(value.timestamp, Date.now()),
    persistedAt: value.persistedAt === undefined ? undefined : numberValue(value.persistedAt, 0),
    run_id: value.run_id === null ? null : stringValue(value.run_id) || null,
    role: stringValue(value.role),
    tool_call_id: value.tool_call_id === null ? null : stringValue(value.tool_call_id) || null,
    tool_calls: Array.isArray(value.tool_calls) ? value.tool_calls : null,
    tool_name: value.tool_name === null ? null : stringValue(value.tool_name) || null,
    finish_reason: value.finish_reason === null ? null : stringValue(value.finish_reason) || null,
    reasoning: value.reasoning === null ? null : stringValue(value.reasoning) || null,
    reasoning_details: value.reasoning_details === null ? null : stringValue(value.reasoning_details) || null,
    reasoning_content: value.reasoning_content === null ? null : stringValue(value.reasoning_content) || null,
    mentions: Array.isArray(value.mentions)
      ? value.mentions.filter((mention): mention is HermesStudioGroupChatMention => (
          isRecord(mention) && typeof mention.displayName === 'string'
        )).map((mention) => ({
          type: stringValue(mention.type, 'agent'),
          participantId: stringValue(mention.participantId),
          displayName: stringValue(mention.displayName),
        }))
      : undefined,
    isStreaming: value.isStreaming === true,
    toolName: stringValue(value.toolName),
    toolCallId: stringValue(value.toolCallId),
    toolArgs: value.toolArgs,
    toolPreview: stringValue(value.toolPreview),
    toolResult: value.toolResult,
    toolStatus: value.toolStatus === 'running' || value.toolStatus === 'done' || value.toolStatus === 'error' || value.toolStatus === 'interrupted'
      ? value.toolStatus
      : undefined,
    attachments: Array.isArray(value.attachments)
      ? value.attachments.filter((attachment): attachment is { id: string; name: string; type: string; size: number; url: string } => (
          isRecord(attachment)
          && typeof attachment.id === 'string'
          && typeof attachment.name === 'string'
          && typeof attachment.type === 'string'
          && typeof attachment.url === 'string'
      )).map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        size: numberValue(attachment.size, 0),
        url: attachment.url,
      }))
      : undefined,
    workspaceChanges: Array.isArray(value.workspaceChanges)
      ? value.workspaceChanges.filter((change): change is HermesStudioGroupWorkspaceDiffPayload => (
          isRecord(change) && typeof change.run_id === 'string' && Array.isArray(change.files)
        )).map((change) => ({
          kind: stringValue(change.kind, 'workspace_diff'),
          version: numberValue(change.version, 1),
          room_id: stringValue(change.room_id, stringValue(value.roomId, fallbackRoomId)),
          session_id: stringValue(change.session_id),
          run_id: stringValue(change.run_id),
          status: stringValue(change.status, 'completed'),
          change_id: stringValue(change.change_id),
          workspace_basename: stringValue(change.workspace_basename),
          workspace: stringValue(change.workspace),
          workspace_root: stringValue(change.workspace_root),
          files_changed: numberValue(change.files_changed, 0),
          additions: numberValue(change.additions, 0),
          deletions: numberValue(change.deletions, 0),
          truncated: change.truncated === true,
          files: (Array.isArray(change.files) ? change.files : []).flatMap((file) => {
            if (!isRecord(file) || typeof file.path !== 'string') return [];
            return [{
              id: typeof file.id === 'number' || typeof file.id === 'string' ? file.id : file.path,
              path: file.path,
              change_type: stringValue(file.change_type),
              additions: numberValue(file.additions, 0),
              deletions: numberValue(file.deletions, 0),
              patch: file.patch === null ? null : stringValue(file.patch),
              binary: file.binary === true,
              truncated: file.truncated === true,
            }];
          }),
          parent_message_id: stringValue(change.parent_message_id),
        }))
      : undefined,
    runItems: Array.isArray(value.runItems)
      ? value.runItems.map((item) => normalizeGroupMessage(item, stringValue(value.roomId, fallbackRoomId)))
        .filter((item): item is HermesStudioGroupChatMessage => item !== null)
      : undefined,
    firstSeenAt: value.firstSeenAt === undefined ? undefined : numberValue(value.firstSeenAt, Date.now()),
    deliveryStatus: value.deliveryStatus === 'pending' || value.deliveryStatus === 'sent' || value.deliveryStatus === 'failed'
      ? value.deliveryStatus
      : undefined,
  };
}

function normalizeJoinResult(value: unknown, fallbackRoomId: string): HermesStudioGroupChatJoinResult | null {
  if (!isRecord(value) || typeof value.error === 'string') return null;
  return {
    roomId: stringValue(value.roomId, fallbackRoomId),
    roomName: stringValue(value.roomName, fallbackRoomId),
    members: normalizeMembers(value.members),
    messages: (Array.isArray(value.messages) ? value.messages : [])
      .map((message) => normalizeGroupMessage(message, fallbackRoomId))
      .filter((message): message is HermesStudioGroupChatMessage => message !== null),
    rooms: Array.isArray(value.rooms)
      ? value.rooms.filter((room): room is string => typeof room === 'string')
      : [],
  };
}

function normalizeRoomDetail(value: unknown): HermesStudioGroupChatRoomDetail {
  const record = isRecord(value) ? value : {};
  const room = requiredRoom(record.room);
  return {
    room,
    agents: normalizeAgents(record.agents),
    members: normalizeMembers(record.members),
    messages: (Array.isArray(record.messages) ? record.messages : [])
      .map((message) => normalizeGroupMessage(message, room.id))
      .filter((message): message is HermesStudioGroupChatMessage => message !== null),
    total: record.total === undefined ? undefined : numberValue(record.total, 0),
    offset: record.offset === undefined ? undefined : numberValue(record.offset, 0),
    limit: record.limit === undefined ? undefined : numberValue(record.limit, 150),
    hasMore: typeof record.hasMore === 'boolean' ? record.hasMore : undefined,
  };
}

function normalizeSummary(value: unknown, fallbackRoomId: string): HermesStudioRoomSummaryState {
  const record = isRecord(value) ? value : {};
  return {
    roomId: stringValue(record.roomId, fallbackRoomId),
    summary: stringValue(record.summary),
    summaryThroughMessageId: stringValue(record.summaryThroughMessageId),
    summaryThroughMessageTimestamp: numberValue(record.summaryThroughMessageTimestamp, 0),
    summarizedTurnCount: numberValue(record.summarizedTurnCount, 0),
    status: stringValue(record.status, 'idle'),
    version: numberValue(record.version, 0),
    updatedAt: numberValue(record.updatedAt, 0),
    lastError: record.lastError === null ? null : stringValue(record.lastError),
  };
}

function normalizeSummaryAnchor(value: unknown): HermesStudioRoomSummaryAnchor | null {
  if (!isRecord(value) || !stringValue(value.id).trim()) return null;
  return {
    id: stringValue(value.id),
    timestamp: numberValue(value.timestamp, 0),
    senderName: stringValue(value.senderName, 'Agent'),
    role: stringValue(value.role),
    content: stringValue(value.content),
  };
}
