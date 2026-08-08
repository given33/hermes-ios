import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { HermesApiClient } from '../../api/HermesApiClient';
import { hermesStudioApiFor } from '../../api/hermes-api-registry';
import type {
  HermesStudioGroupChatMessage,
  HermesStudioGroupChatSocket,
  HermesStudioPendingApproval,
  HermesStudioRoomAgentInput,
  HermesStudioRoomConfigInput,
  HermesStudioRoomInfo,
  HermesStudioRoomMember,
  HermesStudioRoomSnapshot,
  HermesStudioRoomSummaryState,
  HermesStudioWorkspaceFileContent,
  HermesStudioWorkspaceFileListing,
} from '../../api/hermes-studio';
import { isRecord, normalizeGroupMessage, numberValue, stringValue } from '../../api/hermes-studio';
import {
  addUnique,
  applyAgentGroupEvent,
  emptyRoomSnapshot,
  snapshotFromDetail,
  upsertGroupMessage,
} from './agent-group-model';

const MOBILE_GROUP_USER_ID_PREFIX = 'hermes-mobile-group-user';

export interface AgentGroupChatControllerProps {
  agentProfile?: string;
  cacheOwner: string;
  client?: HermesApiClient;
  enabled: boolean;
  fixtureMode?: boolean;
  isChinese: boolean;
  notify(message: string): void;
}

export interface AgentGroupCreateRoomOptions {
  inviteCode?: string;
  workspace?: string;
  summary?: {
    profile: string;
    provider: string;
    model: string;
    apiMode: string;
    everyTurns: number;
  };
}

export interface AgentGroupChatController {
  userId: string;
  activeRoomId: string;
  activeRoom: HermesStudioRoomSnapshot | null;
  connected: boolean;
  creating: boolean;
  drafts: Record<string, string>;
  error: string | null;
  loading: boolean;
  rooms: HermesStudioRoomInfo[];
  roomSnapshots: HermesStudioRoomSnapshot[];
  selectRoom(roomId: string): void;
  setDraft(roomId: string, value: string): void;
  sendMessage(content?: string): Promise<void>;
  createRoom(name: string, profiles: string[], options?: AgentGroupCreateRoomOptions): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  clearRoom(roomId: string): Promise<void>;
  refresh(): Promise<void>;
  refreshRoom(roomId?: string): Promise<void>;
  cloneRoom(roomId: string, name: string, inviteCode?: string): Promise<void>;
  joinRoomByCode(code: string): Promise<void>;
  updateRoomConfig(roomId: string, input: HermesStudioRoomConfigInput): Promise<void>;
  updateRoomWorkspace(roomId: string, workspace: string): Promise<void>;
  updateInviteCode(roomId: string, inviteCode: string): Promise<void>;
  addAgent(roomId: string, input: HermesStudioRoomAgentInput): Promise<void>;
  updateAgent(roomId: string, agentId: string, input: HermesStudioRoomAgentInput): Promise<void>;
  removeAgent(roomId: string, agentId: string): Promise<void>;
  loadRoomSummary(roomId?: string): Promise<void>;
  updateRoomSummary(roomId: string, summary: string): Promise<void>;
  interruptAgent(roomId: string, agentName: string): Promise<void>;
  respondApproval(roomId: string, approvalId: string, choice: HermesStudioPendingApproval['choices'][number]): Promise<void>;
  emitTyping(roomId: string): void;
  emitStopTyping(roomId: string): void;
  listWorkspaceFiles(roomId: string, path?: string): Promise<HermesStudioWorkspaceFileListing>;
  readWorkspaceFile(roomId: string, path: string): Promise<HermesStudioWorkspaceFileContent>;
  writeWorkspaceFile(roomId: string, path: string, content: string): Promise<void>;
  mkdirWorkspaceFile(roomId: string, path: string): Promise<void>;
  deleteWorkspaceFile(roomId: string, path: string, recursive?: boolean): Promise<void>;
}

/**
 * Owns all Hermes Studio group-chat state outside the single-chat state
 * machine. Room snapshots live in a map, so switching rooms only changes the
 * rendered snapshot; it never aborts a Socket.IO stream or a server run.
 */
export function useAgentGroupChatController({
  agentProfile = 'default',
  cacheOwner,
  client,
  enabled,
  fixtureMode = false,
  isChinese,
  notify,
}: AgentGroupChatControllerProps): AgentGroupChatController {
  const studioApi = useMemo(() => client ? hermesStudioApiFor(client) : null, [client]);
  const [rooms, setRooms] = useState<HermesStudioRoomInfo[]>([]);
  const [activeRoomId, setActiveRoomId] = useState('');
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const mountedRef = useRef(true);
  const roomsRef = useRef<HermesStudioRoomInfo[]>([]);
  const activeRoomIdRef = useRef('');
  const snapshotsRef = useRef(new Map<string, HermesStudioRoomSnapshot>());
  const draftsRef = useRef<Record<string, string>>({});
  const socketRef = useRef<HermesStudioGroupChatSocket | null>(null);
  const connectPromiseRef = useRef<Promise<HermesStudioGroupChatSocket | null> | null>(null);
  const joinedRoomIdsRef = useRef(new Set<string>());
  const joinPromisesRef = useRef(new Map<string, Promise<void>>());
  const typingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const bootstrapGenerationRef = useRef(0);
  const joinRoomOnSocketRef = useRef<(
    roomId: string,
    socket?: HermesStudioGroupChatSocket | null,
  ) => Promise<void>>(undefined);

  const bump = useCallback(() => {
    if (mountedRef.current) setRevision((value) => value + 1);
  }, []);

  const setSnapshot = useCallback((roomId: string, next: HermesStudioRoomSnapshot) => {
    snapshotsRef.current.set(roomId, next);
    bump();
  }, [bump]);

  const patchSnapshot = useCallback((roomId: string, update: (snapshot: HermesStudioRoomSnapshot) => HermesStudioRoomSnapshot) => {
    const current = snapshotsRef.current.get(roomId);
    if (!current) return;
    setSnapshot(roomId, update(current));
  }, [setSnapshot]);

  const applyEvent = useCallback((event: Parameters<typeof applyAgentGroupEvent>[1]) => {
    const roomId = event.type === 'message' || event.type === 'stream-start'
      ? event.message.roomId
      : event.type === 'summary-updated'
        ? event.summary.roomId
        : event.type === 'approval-requested'
          ? event.approval.roomId
          : event.roomId;
    patchSnapshot(roomId, (snapshot) => applyAgentGroupEvent(snapshot, event));
  }, [patchSnapshot]);

  const identity = useMemo(() => ({
    name: 'Hermes Mobile',
    description: isChinese ? 'Hermes 移动端用户' : 'Hermes mobile user',
  }), [isChinese]);

  const stableUserId = useMemo(
    () => `${MOBILE_GROUP_USER_ID_PREFIX}-${stableHash(`${cacheOwner}:${agentProfile}`)}`,
    [agentProfile, cacheOwner],
  );

  const applyRoomList = useCallback((nextRooms: HermesStudioRoomInfo[]) => {
    roomsRef.current = nextRooms;
    setRooms(nextRooms);
    const roomIds = new Set(nextRooms.map((room) => room.id));
    for (const room of nextRooms) {
      const existing = snapshotsRef.current.get(room.id);
      if (existing) setSnapshot(room.id, { ...existing, room, updatedAt: Date.now() });
      else snapshotsRef.current.set(room.id, emptyRoomSnapshot(room));
    }
    for (const roomId of snapshotsRef.current.keys()) {
      if (!roomIds.has(roomId)) snapshotsRef.current.delete(roomId);
    }
    if (!activeRoomIdRef.current || !roomIds.has(activeRoomIdRef.current)) {
      const nextActive = nextRooms[0]?.id || '';
      activeRoomIdRef.current = nextActive;
      setActiveRoomId(nextActive);
    }
    bump();
  }, [bump, setSnapshot]);

  const applyJoin = useCallback((result: {
    roomId: string;
    roomName: string;
    members: HermesStudioRoomMember[];
    messages: HermesStudioGroupChatMessage[];
  }) => {
    const roomId = result.roomId;
    const current = snapshotsRef.current.get(roomId);
    if (!current) return;
    const mergedMessages = result.messages.reduce(
      (messages, message) => upsertGroupMessage(messages, message),
      current.messages,
    );
    setSnapshot(roomId, {
      ...current,
      room: { ...current.room, name: result.roomName || current.room.name },
      members: result.members.length ? result.members : current.members,
      messages: mergedMessages,
      connected: Boolean(socketRef.current?.connected),
      loading: false,
      error: null,
      updatedAt: Date.now(),
    });
  }, [setSnapshot]);

  const attachSocketListeners = useCallback((socket: HermesStudioGroupChatSocket) => {
    const onConnect = () => {
      setConnected(true);
      setError(null);
      for (const room of roomsRef.current) {
        const joinRoom = joinRoomOnSocketRef.current;
        if (joinRoom) void joinRoom(room.id, socket).catch(() => undefined);
      }
    };
    const onDisconnect = () => {
      setConnected(false);
      for (const roomId of joinedRoomIdsRef.current) {
        patchSnapshot(roomId, (snapshot) => ({ ...snapshot, connected: false }));
      }
    };
    const onConnectError = (reason: Error) => {
      setConnected(false);
      setError(reason.message || (isChinese ? 'Agent 群聊连接失败' : 'Agent group chat connection failed'));
    };
    const onMessage = (payload: unknown) => {
      const message = normalizeGroupMessage(payload);
      if (message) applyEvent({ type: 'message', message });
    };
    const onStreamStart = (payload: unknown) => {
      const message = normalizeGroupMessage(payload);
      if (message) applyEvent({ type: 'stream-start', message });
    };
    const onStreamDelta = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      const id = stringValue(payload.id);
      const delta = stringValue(payload.delta);
      if (roomId && id && delta) applyEvent({ type: 'stream-delta', roomId, id, delta });
    };
    const onReasoningDelta = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      const id = stringValue(payload.id);
      const delta = stringValue(payload.delta);
      if (roomId && id && delta) applyEvent({ type: 'reasoning-delta', roomId, id, delta });
    };
    const onStreamEnd = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      const id = stringValue(payload.id);
      if (roomId && id) applyEvent({ type: 'stream-end', roomId, id });
    };
    const onTyping = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      if (stringValue(payload.userId) === stableUserId) return;
      const name = stringValue(payload.userName, stringValue(payload.name));
      if (roomId && name) applyEvent({ type: 'typing', roomId, name });
    };
    const onStopTyping = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      const name = stringValue(payload.userName, stringValue(payload.name));
      if (roomId && name) applyEvent({ type: 'stop-typing', roomId, name });
    };
    const onContextStatus = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      const name = stringValue(payload.agentName);
      const status = stringValue(payload.status);
      if (roomId && name) applyEvent({ type: 'context-status', roomId, name, status });
    };
    const onRoomUpdated = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      if (roomId) applyEvent({
        type: 'room-updated',
        roomId,
        totalTokens: payload.totalTokens === undefined ? undefined : Number(payload.totalTokens),
        name: stringValue(payload.name) || undefined,
      });
    };
    const onRoomCleared = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      if (roomId) applyEvent({ type: 'room-cleared', roomId });
    };
    const onMembersUpdated = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      const members = normalizeMembersPayload(payload.members);
      if (roomId && Array.isArray(payload.members)) applyEvent({ type: 'members-updated', roomId, members });
    };
    const onSummaryUpdated = (payload: unknown) => {
      const summary = normalizeSummaryPayload(payload);
      if (summary) applyEvent({ type: 'summary-updated', summary });
    };
    const onApprovalRequested = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      const approvalId = stringValue(payload.approval_id);
      if (!roomId || !approvalId) return;
      const description = stringValue(payload.description);
      const normalizedDescription = description.trim().toLowerCase().replace(/\s+/g, ' ');
      const isMemoryWrite = !Boolean(payload.allow_permanent) && (
        normalizedDescription === 'save to memory'
        || normalizedDescription.startsWith('save to memory:')
        || normalizedDescription.startsWith('save to memory?')
      );
      const choices = (Array.isArray(payload.choices) ? payload.choices : ['once', 'session', 'deny'])
        .filter((choice): choice is HermesStudioPendingApproval['choices'][number] => (
          choice === 'once' || choice === 'session' || choice === 'always' || choice === 'deny'
        ));
      applyEvent({
        type: 'approval-requested',
        approval: {
          roomId,
          agentName: stringValue(payload.agentName),
          approvalId,
          command: stringValue(payload.command),
          description,
          choices: isMemoryWrite ? ['once', 'deny'] : (choices.length ? choices : ['once', 'session', 'deny']),
          allowPermanent: Boolean(payload.allow_permanent),
          isMemoryWrite,
          requestedAt: Date.now(),
        },
      });
    };
    const onApprovalResolved = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const approvalId = stringValue(payload.approval_id);
      const roomId = stringValue(payload.roomId);
      if (approvalId && roomId) applyEvent({ type: 'approval-resolved', roomId, approvalId });
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('message', onMessage);
    socket.on('message_stream_start', onStreamStart);
    socket.on('message_stream_delta', onStreamDelta);
    socket.on('message_reasoning_delta', onReasoningDelta);
    socket.on('message_stream_end', onStreamEnd);
    socket.on('typing', onTyping);
    socket.on('stop_typing', onStopTyping);
    socket.on('context_status', onContextStatus);
    socket.on('member_joined', onMembersUpdated);
    socket.on('member_left', onMembersUpdated);
    socket.on('member_updated', onMembersUpdated);
    socket.on('room_summary_updated', onSummaryUpdated);
    socket.on('approval.requested', onApprovalRequested);
    socket.on('approval.resolved', onApprovalResolved);
    socket.on('room_updated', onRoomUpdated);
    socket.on('room_cleared', onRoomCleared);
  }, [applyEvent, isChinese, patchSnapshot, stableUserId]);

  const waitForConnection = useCallback((socket: HermesStudioGroupChatSocket): Promise<void> => {
    if (socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
        callback();
      };
      const onConnect = () => finish(resolve);
      const onError = (reason: Error) => finish(() => reject(reason));
      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
    });
  }, []);

  const connectSocket = useCallback(async (): Promise<HermesStudioGroupChatSocket | null> => {
    if (!studioApi || !client) return null;
    if (socketRef.current) {
      await waitForConnection(socketRef.current);
      return socketRef.current;
    }
    if (connectPromiseRef.current) return connectPromiseRef.current;
    const promise = studioApi.groupChat.connectRealtime({
      userId: stableUserId,
      userName: identity.name,
      description: identity.description,
    }).then(async (socket) => {
      if (!mountedRef.current) {
        socket.disconnect();
        return null;
      }
      socketRef.current = socket;
      attachSocketListeners(socket);
      await waitForConnection(socket);
      return socket;
    }).finally(() => {
      connectPromiseRef.current = null;
    });
    connectPromiseRef.current = promise;
    return promise;
  }, [attachSocketListeners, client, identity.description, identity.name, stableUserId, studioApi, waitForConnection]);

  const joinRoomOnSocket = useCallback(async (roomId: string, socket?: HermesStudioGroupChatSocket | null) => {
    const target = socket || socketRef.current;
    if (!target || !studioApi) return;
    if (joinedRoomIdsRef.current.has(roomId) && target.connected) return;
    const pending = joinPromisesRef.current.get(roomId);
    if (pending) return pending;
    const promise = (async () => {
      await waitForConnection(target);
      const result = await studioApi.groupChat.joinRoom(target, roomId, identity);
      joinedRoomIdsRef.current.add(roomId);
      applyJoin(result);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, connected: true, loading: false }));
    })().catch((reason) => {
      patchSnapshot(roomId, (snapshot) => ({
        ...snapshot,
        connected: Boolean(target.connected),
        loading: false,
        error: errorMessage(reason, isChinese),
      }));
      throw reason;
    }).finally(() => {
      joinPromisesRef.current.delete(roomId);
    });
    joinPromisesRef.current.set(roomId, promise);
    return promise;
  }, [applyJoin, identity, isChinese, patchSnapshot, studioApi, waitForConnection]);

  const refresh = useCallback(async () => {
    if (!studioApi) {
      if (fixtureMode && !roomsRef.current.length) applyRoomList(fixtureRooms());
      return;
    }
    const generation = ++bootstrapGenerationRef.current;
    setLoading(true);
    try {
      const nextRooms = await studioApi.groupChat.listRooms();
      if (generation !== bootstrapGenerationRef.current || !mountedRef.current) return;
      applyRoomList(nextRooms);
      setError(null);
    } catch (reason) {
      if (generation === bootstrapGenerationRef.current && mountedRef.current) {
        setError(errorMessage(reason, isChinese));
      }
    } finally {
      if (generation === bootstrapGenerationRef.current && mountedRef.current) setLoading(false);
    }
  }, [applyRoomList, fixtureMode, isChinese, studioApi]);

  const refreshRoom = useCallback(async (requestedRoomId?: string) => {
    const roomId = requestedRoomId || activeRoomIdRef.current;
    if (!roomId) return;
    if (!studioApi) return;
    patchSnapshot(roomId, (snapshot) => ({ ...snapshot, loading: true, error: null }));
    try {
      const [detail, summaryResult] = await Promise.all([
        studioApi.groupChat.getRoomDetail(roomId, { limit: 150 }),
        studioApi.groupChat.getRoomSummary(roomId).catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setSnapshot(roomId, snapshotFromDetail({
        ...detail,
        connected: Boolean(socketRef.current?.connected),
        summary: summaryResult?.summary || null,
        summaryAnchor: summaryResult?.anchor || null,
      }));
      const socket = await connectSocket();
      await joinRoomOnSocket(roomId, socket);
    } catch (reason) {
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, loading: false, error: errorMessage(reason, isChinese) }));
    }
  }, [connectSocket, isChinese, joinRoomOnSocket, patchSnapshot, setSnapshot, studioApi]);

  const selectRoom = useCallback((roomId: string) => {
    if (!roomId || !roomsRef.current.some((room) => room.id === roomId)) return;
    activeRoomIdRef.current = roomId;
    setActiveRoomId(roomId);
    if (fixtureMode) return;
    void refreshRoom(roomId);
  }, [fixtureMode, refreshRoom]);

  const setDraft = useCallback((roomId: string, value: string) => {
    draftsRef.current = { ...draftsRef.current, [roomId]: value };
    setDrafts(draftsRef.current);
  }, []);

  const emitStopTyping = useCallback((roomId: string) => {
    const timer = typingTimersRef.current.get(roomId);
    if (timer) clearTimeout(timer);
    typingTimersRef.current.delete(roomId);
    const socket = socketRef.current;
    if (socket && studioApi) studioApi.groupChat.emitStopTyping(socket, roomId);
  }, [studioApi]);

  const sendMessage = useCallback(async (requestedContent?: string) => {
    const roomId = activeRoomIdRef.current;
    const content = (requestedContent ?? draftsRef.current[roomId] ?? '').trim();
    if (!roomId || !content) return;
    emitStopTyping(roomId);
    const snapshot = snapshotsRef.current.get(roomId);
    if (!snapshot) return;
    const id = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: HermesStudioGroupChatMessage = {
      id,
      roomId,
      senderId: stableUserId,
      senderName: identity.name,
      content,
      timestamp: Date.now(),
      role: 'user',
    };
    patchSnapshot(roomId, (current) => ({
      ...current,
      messages: upsertGroupMessage(current.messages, optimistic),
      error: null,
      updatedAt: Date.now(),
    }));
    setDraft(roomId, '');
    if (!studioApi) {
      notify(isChinese ? '预览模式：已加入 Agent 群聊时间线' : 'Preview: added to the Agent group timeline');
      return;
    }
    try {
      const socket = await connectSocket();
      await joinRoomOnSocket(roomId, socket);
      if (!socket) throw new Error('Hermes Studio group chat is unavailable');
      await studioApi.groupChat.sendMessage(socket, roomId, id, content);
    } catch (reason) {
      patchSnapshot(roomId, (current) => ({ ...current, error: errorMessage(reason, isChinese) }));
      notify(errorMessage(reason, isChinese));
    }
  }, [connectSocket, emitStopTyping, identity.name, isChinese, joinRoomOnSocket, notify, patchSnapshot, setDraft, stableUserId, studioApi]);

  const createRoom = useCallback(async (
    name: string,
    profiles: string[],
    options: AgentGroupCreateRoomOptions = {},
  ) => {
    const trimmedName = name.trim();
    const normalizedProfiles = [...new Set(profiles.map((value) => value.trim()).filter(Boolean))];
    if (!trimmedName) return;
    if (!studioApi) {
      const room: HermesStudioRoomInfo = {
        id: `preview-room-${Date.now().toString(36)}`,
        name: trimmedName,
        inviteCode: options.inviteCode || null,
        canManage: true,
        workspace: options.workspace || '',
        summaryProfile: options.summary?.profile || agentProfile,
        summaryProvider: options.summary?.provider || '',
        summaryModel: options.summary?.model || '',
        summaryApiMode: options.summary?.apiMode || 'chat_completions',
        summaryEveryTurns: options.summary?.everyTurns || 20,
      };
      const nextRooms = [...roomsRef.current, room];
      applyRoomList(nextRooms);
      snapshotsRef.current.set(room.id, {
        ...emptyRoomSnapshot(room),
        agents: normalizedProfiles.map((profile, index) => ({
          id: `${room.id}-agent-${index}`,
          roomId: room.id,
          agentId: `${room.id}-agent-${index}`,
          agent: 'hermes',
          profile,
          name: profile,
        })),
      });
      bump();
      selectRoom(room.id);
      return;
    }
    setCreating(true);
    try {
      const result = await studioApi.groupChat.createRoom({
        name: trimmedName,
        inviteCode: options.inviteCode || generateInviteCode(),
        memberName: identity.name,
        memberDescription: identity.description,
        agents: normalizedProfiles.map((profile) => ({ agent: 'hermes', profile })),
        summary: options.summary || {
          profile: agentProfile,
          provider: '',
          model: '',
          apiMode: 'chat_completions',
          everyTurns: 20,
        },
        workspace: options.workspace || '',
      });
      const nextRooms = [result.room, ...roomsRef.current.filter((room) => room.id !== result.room.id)];
      applyRoomList(nextRooms);
      setSnapshot(result.room.id, snapshotFromDetail({
        room: result.room,
        agents: result.agents,
        members: [],
        messages: [],
        connected: false,
      }));
      if (result.agentResults.some((item) => isRecord(item) && item.ok === false)) {
        notify(isChinese ? '房间已创建，但部分 Agent 连接失败' : 'Room created, but one or more agents failed to connect');
      }
      selectRoom(result.room.id);
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    } finally {
      if (mountedRef.current) setCreating(false);
    }
  }, [agentProfile, applyRoomList, bump, identity.description, identity.name, isChinese, notify, selectRoom, setSnapshot, studioApi]);

  const cloneRoom = useCallback(async (roomId: string, name: string, inviteCode?: string) => {
    if (!studioApi) {
      const source = roomsRef.current.find((room) => room.id === roomId);
      if (!source) return;
      await createRoom(name, snapshotsRef.current.get(roomId)?.agents.map((agent) => agent.profile) || [], { inviteCode });
      return;
    }
    try {
      const result = await studioApi.groupChat.cloneRoom(roomId, { name: name.trim(), inviteCode });
      applyRoomList([result.room, ...roomsRef.current.filter((room) => room.id !== result.room.id)]);
      setSnapshot(result.room.id, snapshotFromDetail({
        room: result.room,
        agents: result.agents,
        members: [],
        messages: [],
        connected: false,
      }));
      selectRoom(result.room.id);
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [applyRoomList, createRoom, isChinese, notify, selectRoom, setSnapshot, studioApi]);

  const joinRoomByCode = useCallback(async (code: string) => {
    const trimmedCode = code.trim();
    if (!trimmedCode || !studioApi) return;
    try {
      const result = await studioApi.groupChat.joinRoomByCode(trimmedCode);
      applyRoomList([result.room, ...roomsRef.current.filter((room) => room.id !== result.room.id)]);
      if (!snapshotsRef.current.has(result.room.id)) snapshotsRef.current.set(result.room.id, emptyRoomSnapshot(result.room));
      selectRoom(result.room.id);
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [applyRoomList, isChinese, notify, selectRoom, studioApi]);

  const replaceRoom = useCallback((room: HermesStudioRoomInfo) => {
    applyRoomList(roomsRef.current.map((current) => current.id === room.id ? room : current));
    patchSnapshot(room.id, (snapshot) => ({ ...snapshot, room, totalTokens: room.totalTokens, updatedAt: Date.now() }));
  }, [applyRoomList, patchSnapshot]);

  const updateRoomConfig = useCallback(async (roomId: string, input: HermesStudioRoomConfigInput) => {
    if (!studioApi) {
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, room: { ...snapshot.room, ...input }, updatedAt: Date.now() }));
      return;
    }
    try {
      replaceRoom((await studioApi.groupChat.updateRoomConfig(roomId, input)).room);
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, error: message }));
      notify(message);
    }
  }, [isChinese, notify, patchSnapshot, replaceRoom, studioApi]);

  const updateRoomWorkspace = useCallback(async (roomId: string, workspace: string) => {
    if (!studioApi) {
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, room: { ...snapshot.room, workspace }, updatedAt: Date.now() }));
      return;
    }
    try {
      replaceRoom((await studioApi.groupChat.updateRoomWorkspace(roomId, workspace)).room);
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, error: message }));
      notify(message);
    }
  }, [isChinese, notify, patchSnapshot, replaceRoom, studioApi]);

  const updateInviteCode = useCallback(async (roomId: string, inviteCode: string) => {
    if (!studioApi) {
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, room: { ...snapshot.room, inviteCode }, updatedAt: Date.now() }));
      return;
    }
    try {
      await studioApi.groupChat.updateInviteCode(roomId, inviteCode);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, room: { ...snapshot.room, inviteCode }, updatedAt: Date.now() }));
      setRooms((current) => current.map((room) => room.id === roomId ? { ...room, inviteCode } : room));
      roomsRef.current = roomsRef.current.map((room) => room.id === roomId ? { ...room, inviteCode } : room);
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, error: message }));
      notify(message);
    }
  }, [isChinese, notify, patchSnapshot, studioApi]);

  const addAgent = useCallback(async (roomId: string, input: HermesStudioRoomAgentInput) => {
    if (!studioApi) return;
    try {
      const result = await studioApi.groupChat.addAgent(roomId, input);
      patchSnapshot(roomId, (snapshot) => ({
        ...snapshot,
        agents: [...snapshot.agents.filter((agent) => agent.id !== result.agent.id), result.agent],
        updatedAt: Date.now(),
      }));
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, error: message }));
      notify(message);
    }
  }, [isChinese, notify, patchSnapshot, studioApi]);

  const updateAgent = useCallback(async (roomId: string, agentId: string, input: HermesStudioRoomAgentInput) => {
    if (!studioApi) return;
    try {
      const result = await studioApi.groupChat.updateAgent(roomId, agentId, input);
      patchSnapshot(roomId, (snapshot) => ({
        ...snapshot,
        agents: result.agents.length ? result.agents : snapshot.agents.map((agent) => agent.id === agentId ? result.agent : agent),
        members: result.members.length ? result.members : snapshot.members,
        updatedAt: Date.now(),
      }));
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, error: message }));
      notify(message);
    }
  }, [isChinese, notify, patchSnapshot, studioApi]);

  const removeAgent = useCallback(async (roomId: string, agentId: string) => {
    if (!studioApi) return;
    try {
      const result = await studioApi.groupChat.removeAgent(roomId, agentId);
      patchSnapshot(roomId, (snapshot) => ({
        ...snapshot,
        agents: result.agents.length ? result.agents : snapshot.agents.filter((agent) => agent.id !== agentId && agent.agentId !== agentId),
        members: result.members.length ? result.members : snapshot.members,
        updatedAt: Date.now(),
      }));
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, error: message }));
      notify(message);
    }
  }, [isChinese, notify, patchSnapshot, studioApi]);

  const loadRoomSummary = useCallback(async (requestedRoomId?: string) => {
    const roomId = requestedRoomId || activeRoomIdRef.current;
    if (!roomId || !studioApi) return;
    try {
      const result = await studioApi.groupChat.getRoomSummary(roomId);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, summary: result.summary, summaryAnchor: result.anchor, updatedAt: Date.now() }));
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, error: message }));
    }
  }, [isChinese, patchSnapshot, studioApi]);

  const updateRoomSummary = useCallback(async (roomId: string, summary: string) => {
    if (!studioApi) {
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, summary: snapshot.summary ? { ...snapshot.summary, summary } : snapshot.summary }));
      return;
    }
    try {
      const result = await studioApi.groupChat.updateRoomSummary(roomId, summary);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, summary: result.summary, updatedAt: Date.now() }));
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, error: message }));
      notify(message);
    }
  }, [isChinese, notify, patchSnapshot, studioApi]);

  const interruptAgent = useCallback(async (roomId: string, agentName: string) => {
    if (!studioApi) return;
    const socket = await connectSocket();
    await joinRoomOnSocket(roomId, socket);
    if (!socket) throw new Error('Hermes Studio group chat is unavailable');
    await studioApi.groupChat.interruptAgent(socket, roomId, agentName);
  }, [connectSocket, joinRoomOnSocket, studioApi]);

  const respondApproval = useCallback(async (
    roomId: string,
    approvalId: string,
    choice: HermesStudioPendingApproval['choices'][number],
  ) => {
    if (!studioApi) return;
    const socket = await connectSocket();
    await joinRoomOnSocket(roomId, socket);
    if (!socket) throw new Error('Hermes Studio group chat is unavailable');
    await studioApi.groupChat.respondApproval(socket, { roomId, approvalId, choice });
    applyEvent({ type: 'approval-resolved', roomId, approvalId });
  }, [applyEvent, connectSocket, joinRoomOnSocket, studioApi]);

  const emitTyping = useCallback((roomId: string) => {
    if (!studioApi) return;
    const previous = typingTimersRef.current.get(roomId);
    if (previous) clearTimeout(previous);
    void connectSocket().then((socket) => {
      if (!socket) return;
      studioApi.groupChat.emitTyping(socket, roomId);
      typingTimersRef.current.set(roomId, setTimeout(() => emitStopTyping(roomId), 4_000));
    }).catch(() => undefined);
  }, [connectSocket, emitStopTyping, studioApi]);

  const listWorkspaceFiles = useCallback(async (roomId: string, path = ''): Promise<HermesStudioWorkspaceFileListing> => {
    if (!studioApi) return { entries: [], path };
    return studioApi.groupChat.listWorkspaceFiles(roomId, path);
  }, [studioApi]);

  const readWorkspaceFile = useCallback(async (roomId: string, path: string): Promise<HermesStudioWorkspaceFileContent> => {
    if (!studioApi) return { content: '', path, size: 0 };
    return studioApi.groupChat.readWorkspaceFile(roomId, path);
  }, [studioApi]);

  const writeWorkspaceFile = useCallback(async (roomId: string, path: string, content: string): Promise<void> => {
    if (!studioApi) return;
    await studioApi.groupChat.writeWorkspaceFile(roomId, path, content);
  }, [studioApi]);

  const mkdirWorkspaceFile = useCallback(async (roomId: string, path: string): Promise<void> => {
    if (!studioApi) return;
    await studioApi.groupChat.mkdirWorkspaceFile(roomId, path);
  }, [studioApi]);

  const deleteWorkspaceFile = useCallback(async (roomId: string, path: string, recursive = false): Promise<void> => {
    if (!studioApi) return;
    await studioApi.groupChat.deleteWorkspaceFile(roomId, path, recursive);
  }, [studioApi]);

  const deleteRoom = useCallback(async (roomId: string) => {
    if (!studioApi) {
      applyRoomList(roomsRef.current.filter((room) => room.id !== roomId));
      return;
    }
    try {
      await studioApi.groupChat.deleteRoom(roomId);
      joinedRoomIdsRef.current.delete(roomId);
      snapshotsRef.current.delete(roomId);
      applyRoomList(roomsRef.current.filter((room) => room.id !== roomId));
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [applyRoomList, isChinese, notify, studioApi]);

  const clearRoom = useCallback(async (roomId: string) => {
    if (!studioApi) {
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, messages: [], updatedAt: Date.now() }));
      return;
    }
    try {
      await studioApi.groupChat.clearRoomContext(roomId);
      applyEvent({ type: 'room-cleared', roomId });
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, error: message }));
      notify(message);
    }
  }, [applyEvent, isChinese, notify, patchSnapshot, studioApi]);

  joinRoomOnSocketRef.current = joinRoomOnSocket;

  useEffect(() => {
    mountedRef.current = true;
    bootstrapGenerationRef.current += 1;
    return () => {
      mountedRef.current = false;
      bootstrapGenerationRef.current += 1;
      const socket = socketRef.current;
      socketRef.current = null;
      connectPromiseRef.current = null;
      joinedRoomIdsRef.current.clear();
      joinPromisesRef.current.clear();
      for (const timer of typingTimersRef.current.values()) clearTimeout(timer);
      typingTimersRef.current.clear();
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [cacheOwner, client]);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      await refresh();
      if (!mountedRef.current) return;
      if (fixtureMode && !roomsRef.current.length) applyRoomList(fixtureRooms());
      const firstRoomId = activeRoomIdRef.current || roomsRef.current[0]?.id;
      if (firstRoomId) selectRoom(firstRoomId);
      if (studioApi) {
        try {
          const socket = await connectSocket();
          for (const room of roomsRef.current) await joinRoomOnSocket(room.id, socket);
        } catch (reason) {
          if (mountedRef.current) setError(errorMessage(reason, isChinese));
        }
      }
    })();
  }, [applyRoomList, connectSocket, enabled, fixtureMode, isChinese, joinRoomOnSocket, refresh, selectRoom, studioApi]);

  const activeRoom = snapshotsRef.current.get(activeRoomId) || null;
  const roomSnapshots = rooms.map((room) => snapshotsRef.current.get(room.id)).filter(
    (snapshot): snapshot is HermesStudioRoomSnapshot => Boolean(snapshot),
  );
  void revision;
  return {
    userId: stableUserId,
    activeRoomId,
    activeRoom,
    connected,
    creating,
    drafts,
    error,
    loading,
    rooms,
    roomSnapshots,
    selectRoom,
    setDraft,
    sendMessage,
    createRoom,
    deleteRoom,
    clearRoom,
    refresh,
    refreshRoom,
    cloneRoom,
    joinRoomByCode,
    updateRoomConfig,
    updateRoomWorkspace,
    updateInviteCode,
    addAgent,
    updateAgent,
    removeAgent,
    loadRoomSummary,
    updateRoomSummary,
    interruptAgent,
    respondApproval,
    emitTyping,
    emitStopTyping,
    listWorkspaceFiles,
    readWorkspaceFile,
    writeWorkspaceFile,
    mkdirWorkspaceFile,
    deleteWorkspaceFile,
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function fixtureRooms(): HermesStudioRoomInfo[] {
  return [
    {
      id: 'preview-agent-room',
      name: 'Product Review Agents',
      inviteCode: 'PREVIEW1',
      canManage: true,
      summaryProfile: 'default',
      summaryProvider: 'preview',
      summaryModel: 'preview-model',
      summaryApiMode: 'chat_completions',
      summaryEveryTurns: 20,
      workspace: 'C:/preview/hermes-studio-workspace',
    },
  ];
}

function errorMessage(reason: unknown, isChinese: boolean): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  return isChinese ? 'Agent 群聊暂时不可用' : 'Agent group chat is temporarily unavailable';
}

function normalizeMembersPayload(value: unknown): HermesStudioRoomMember[] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!isRecord(item) || !stringValue(item.id).trim()) return [];
    return [{
      id: stringValue(item.id),
      userId: stringValue(item.userId),
      name: stringValue(item.name, 'Member'),
      description: stringValue(item.description),
      joinedAt: item.joinedAt === undefined ? undefined : numberValue(item.joinedAt, 0),
      avatar: stringValue(item.avatar),
    }];
  });
}

function normalizeSummaryPayload(value: unknown): HermesStudioRoomSummaryState | null {
  if (!isRecord(value) || !stringValue(value.roomId).trim()) return null;
  return {
    roomId: stringValue(value.roomId),
    summary: stringValue(value.summary),
    summaryThroughMessageId: stringValue(value.summaryThroughMessageId),
    summaryThroughMessageTimestamp: numberValue(value.summaryThroughMessageTimestamp, 0),
    summarizedTurnCount: numberValue(value.summarizedTurnCount, 0),
    status: stringValue(value.status, 'idle'),
    version: numberValue(value.version, 0),
    updatedAt: numberValue(value.updatedAt, Date.now()),
    lastError: value.lastError === null ? null : stringValue(value.lastError),
  };
}
