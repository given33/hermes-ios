import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { HermesApiClient } from '../../api/HermesApiClient';
import type {
  CollaborationMessage,
  SingleConversation,
} from '../../api/HermesCloudApi';
import {
  hermesStudioApiFor,
  sharedConversationLocalStore,
} from '../../api/hermes-api-registry';
import { createConversationDeleteReplayService } from '../../api/conversation-local-store';
import {
  captureConversationDeletionRevision,
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';
import { startForegroundReplayLifecycle } from '../../api/foreground-replay-lifecycle';
import type {
  HermesStudioGroupChatMessage,
  HermesStudioGroupChatJoinResult,
  HermesStudioGroupChatMention,
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
import {
  isRecord,
  normalizeGroupMessage,
  normalizeRoomAgent,
  numberValue,
  stringValue,
  isAlreadyDeletedRemote,
} from '../../api/hermes-studio';
import {
  addUnique,
  applyAgentGroupEvent,
  emptyRoomSnapshot,
  attachWorkspaceDiffs,
  mergeCachedRoomSnapshot,
  mergeRoomHistoryMessages,
  roomActivityTimestamp,
  sortRoomInfosByActivity,
  snapshotFromDetail,
  upsertGroupMessage,
} from './agent-group-model';

const MOBILE_GROUP_USER_ID_PREFIX = 'hermes-mobile-group-user';

/**
 * Durable room-deletion tombstones for degraded shells without the
 * conversation local store. The full outbox lives in the local store; this
 * lightweight AsyncStorage set only exists so "hide locally, then DELETE"
 * cannot silently resurrect a room after a network failure in that degraded
 * mode. Values carry the owner so an account switch never filters another
 * account's pending deletions.
 */
const DEGRADED_ROOM_TOMBSTONES_KEY = 'hermes.agent-group.degraded-room-tombstones';

// Single-writer serialization for the degraded tombstone map: concurrent
// deleteRoom/refresh passes must not interleave their read-modify-write.
let degradedTombstoneWrite: Promise<unknown> = Promise.resolve();

function withDegradedTombstoneWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = degradedTombstoneWrite.then(task, task);
  degradedTombstoneWrite = next.catch(() => undefined);
  return next;
}

async function readDegradedRoomTombstones(owner: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(DEGRADED_ROOM_TOMBSTONES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return new Set();
    return new Set(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'string' && value === owner)
        .map(([roomId]) => roomId),
    );
  } catch {
    return new Set();
  }
}

async function writeDegradedRoomTombstone(roomId: string, owner: string): Promise<void> {
  return withDegradedTombstoneWrite(async () => {
  try {
    const raw = await AsyncStorage.getItem(DEGRADED_ROOM_TOMBSTONES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const next: Record<string, string> = parsed && typeof parsed === 'object'
      ? { ...(parsed as Record<string, string>) }
      : {};
    next[roomId] = owner;
    await AsyncStorage.setItem(DEGRADED_ROOM_TOMBSTONES_KEY, JSON.stringify(next));
  } catch {
    // Persistence failure keeps the in-memory hide only — never block the
    // user's delete on best-effort bookkeeping.
  }
  });
}

async function clearDegradedRoomTombstone(roomId: string, owner = ''): Promise<void> {
  return withDegradedTombstoneWrite(async () => {
  try {
    const raw = await AsyncStorage.getItem(DEGRADED_ROOM_TOMBSTONES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || !(roomId in (parsed as object))) return;
    const next = { ...(parsed as Record<string, string>) };
    // Owner-scoped removal: another account's pending tombstone must survive
    // this account's successful delete.
    if (!owner || next[roomId] === owner) delete next[roomId];
    await AsyncStorage.setItem(DEGRADED_ROOM_TOMBSTONES_KEY, JSON.stringify(next));
  } catch {
    // Best-effort cleanup.
  }
  });
}

export interface AgentGroupChatControllerProps {
  agentProfile?: string;
  cacheOwner: string;
  cacheRevision?: string;
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
  allowGuestAgents?: number;
  guestAgentApproval?: 'owner' | string;
  maxGuestAgentsPerMember?: number;
  allowRemoteWorkspaceAccess?: number;
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
  sendMessage(content?: string, attachments?: unknown[], mentions?: HermesStudioGroupChatMention[]): Promise<void>;
  createRoom(name: string, profiles: string[], options?: AgentGroupCreateRoomOptions): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  clearRoom(roomId: string): Promise<void>;
  refresh(forceNetwork?: boolean): Promise<void>;
  refreshRoom(roomId?: string): Promise<void>;
  loadEarlierMessages(roomId?: string): Promise<void>;
  loadingEarlier: ReadonlySet<string>;
  cloneRoom(roomId: string, name: string, inviteCode?: string): Promise<void>;
  joinRoomByCode(code: string): Promise<void>;
  updateRoomConfig(roomId: string, input: HermesStudioRoomConfigInput): Promise<void>;
  updateRoomWorkspace(roomId: string, workspace: string): Promise<void>;
  updateInviteCode(roomId: string, inviteCode: string): Promise<void>;
  addAgent(roomId: string, input: HermesStudioRoomAgentInput): Promise<void>;
  updateAgent(roomId: string, agentId: string, input: HermesStudioRoomAgentInput): Promise<void>;
  removeAgent(roomId: string, agentId: string): Promise<void>;
  removeRoomMember(roomId: string, userId: string): Promise<void>;
  loadRoomSummary(roomId?: string): Promise<void>;
  updateRoomSummary(roomId: string, summary: string): Promise<void>;
  interruptAgent(roomId: string, agentName: string): Promise<void>;
  respondApproval(roomId: string, approvalId: string, choice: HermesStudioPendingApproval['choices'][number]): Promise<void>;
  retractMessage(roomId: string, messageId: string): Promise<void>;
  retryFailedMessage(roomId: string, messageId: string, content: string): Promise<void>;
  emitTyping(roomId: string): void;
  emitStopTyping(roomId: string): void;
  listWorkspaceFiles(roomId: string, path?: string): Promise<HermesStudioWorkspaceFileListing>;
  readWorkspaceFile(roomId: string, path: string): Promise<HermesStudioWorkspaceFileContent>;
  writeWorkspaceFile(roomId: string, path: string, content: string): Promise<void>;
  mkdirWorkspaceFile(roomId: string, path: string): Promise<void>;
  deleteWorkspaceFile(roomId: string, path: string, recursive?: boolean): Promise<void>;
  downloadWorkspaceFile(roomId: string, path: string, download?: boolean): Promise<Blob | null>;
  readWorkspaceFileText(roomId: string, path: string): Promise<{ content: string; size: number }>;
}

/**
 * Owns all Hermes Studio group-chat state outside the single-chat state
 * machine. Room snapshots live in a map, so switching rooms only changes the
 * rendered snapshot; it never aborts a Socket.IO stream or a server run.
 */
export function useAgentGroupChatController({
  agentProfile = 'default',
  cacheOwner,
  cacheRevision = '',
  client,
  enabled,
  fixtureMode = false,
  isChinese,
  notify,
}: AgentGroupChatControllerProps): AgentGroupChatController {
  const studioApi = useMemo(() => client ? hermesStudioApiFor(client) : null, [client]);
  const localStore = useMemo(
    () => cacheOwner ? sharedConversationLocalStore() : null,
    [cacheOwner],
  );
  const [rooms, setRooms] = useState<HermesStudioRoomInfo[]>([]);
  const [activeRoomId, setActiveRoomId] = useState('');
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingEarlierIds, setLoadingEarlierIds] = useState<Set<string>>(new Set());
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
  const backgroundHydrationDoneRef = useRef(false);
  const refreshRoomRef = useRef<((roomId?: string) => Promise<void>) | null>(null);
  const joinRoomOnSocketRef = useRef<(
    roomId: string,
    socket?: HermesStudioGroupChatSocket | null,
  ) => Promise<void>>(undefined);
  const inviteCodeRef = useRef('');
  const detailFingerprintRef = useRef(new Map<string, string>());
  const detailInFlightRef = useRef(new Set<string>());
  const roomHistoryCompleteRef = useRef(new Set<string>());
  const roomHistoryCountRef = useRef(new Map<string, number>());
  const roomHistoryNextOffsetRef = useRef(new Map<string, number>());
  // A room's linked conversation is the durable local tombstone. Keep the
  // IDs in memory as well so an unrelated room-list refresh cannot resurrect
  // a room while its cloud delete is waiting for retry.
  const pendingRoomConversationIdsRef = useRef(new Set<string>());
  const pendingRoomDeletionRevisionRef = useRef(0);
  const roomLifecycleRevisionRef = useRef(new Map<string, number>());
  const hydratedRoomOwnerRef = useRef('');
  const persistedRoomFingerprintRef = useRef(new Map<string, string>());
  const roomPersistenceQueueRef = useRef(new Map<string, Promise<void>>());

  const conversationDeleteReplayService = useMemo(() => (
    studioApi && localStore && cacheOwner
      ? createConversationDeleteReplayService({
          cacheOwner,
          activeConversationId: '',
          deleteRemote: async (item) => {
            if (item.kind !== 'room') {
              // The Agent controller owns only room tombstones. Ordinary
              // conversation/session rows are replayed by the app-level
              // chat route, so this worker must never claim them.
              throw new Error('Unsupported Agent room deletion kind');
            }
            if (!studioApi) throw new Error('Agent room deletion transport is unavailable');
            const roomId = item.remoteId || (item.conversationId.startsWith('chat_room_')
              ? `room_${item.conversationId.slice('chat_room_'.length)}`
              : item.conversationId);
            await studioApi.groupChat.deleteRoom(roomId);
          },
          isAlreadyDeleted: (error) => isAlreadyDeletedRemote(error),
          isRetryable: (error) => {
              // 403 is a permission boundary (e.g. a member deleting an
              // owner's room): retrying can never succeed and used to loop
              // every 60s forever. Let it fail permanently.
              const status = Number(
                (error as unknown as { status?: unknown })?.status
                ?? (error as unknown as { statusCode?: unknown })?.statusCode,
              );
              return status !== 403 && status !== 401;
            },
          outbox: localStore,
          retryDelayMs: 60_000,
          workerId: 'agent-group:conversation-delete',
          kinds: ['room'],
        })
      : null
  ), [agentProfile, cacheOwner, localStore, studioApi]);

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
    const visibleRooms = nextRooms.filter((room) => {
      const conversationId = room.conversationId?.trim();
      const syntheticConversationId = `chat_room_${room.id.replace(/^room_/, '')}`;
      return !pendingRoomConversationIdsRef.current.has(room.id)
        && !pendingRoomConversationIdsRef.current.has(syntheticConversationId)
        && (!conversationId || !pendingRoomConversationIdsRef.current.has(conversationId));
    });
    const orderedRooms = sortRoomInfosByActivity(visibleRooms, snapshotsRef.current);
    roomsRef.current = orderedRooms;
    setRooms(orderedRooms);
    const roomIds = new Set(orderedRooms.map((room) => room.id));
    for (const room of orderedRooms) {
      const existing = snapshotsRef.current.get(room.id);
      if (existing) {
        // Room-list polling is not activity. Preserve the previous local
        // timestamp and only advance it when the server (or a loaded message)
        // reports newer durable activity.
        const activityAt = roomActivityTimestamp(room, existing.messages);
        setSnapshot(room.id, {
          ...existing,
          room,
          updatedAt: Math.max(existing.updatedAt || 0, activityAt) || Date.now(),
        });
      }
      else snapshotsRef.current.set(room.id, emptyRoomSnapshot(room));
    }
    for (const roomId of snapshotsRef.current.keys()) {
      if (!roomIds.has(roomId)) {
        snapshotsRef.current.delete(roomId);
        roomHistoryCompleteRef.current.delete(roomId);
        roomHistoryCountRef.current.delete(roomId);
        roomHistoryNextOffsetRef.current.delete(roomId);
      }
    }
    if (!activeRoomIdRef.current || !roomIds.has(activeRoomIdRef.current)) {
      const nextActive = orderedRooms[0]?.id || '';
      activeRoomIdRef.current = nextActive;
      setActiveRoomId(nextActive);
    }
    bump();
  }, [bump, setSnapshot]);

  const hydrateCachedRooms = useCallback(async () => {
    const hydrationKey = cacheOwner + ':' + cacheRevision;
    if (!localStore || !cacheOwner || hydratedRoomOwnerRef.current === hydrationKey) return;
    const readRevision = pendingRoomDeletionRevisionRef.current;
    const cached = await localStore.read(cacheOwner).catch(() => null);
    let pending: ReadonlySet<string>;
    try {
      pending = await localStore.readPendingConversationDeletionIds(cacheOwner);
    } catch {
      return;
    }
    if (!mountedRef.current || !cached) return;
    let latestPending: ReadonlySet<string>;
    try {
      latestPending = await localStore.readPendingConversationDeletionIds(cacheOwner);
    } catch {
      return;
    }
    pending = latestPending;
    pendingRoomConversationIdsRef.current = pendingRoomDeletionRevisionRef.current === readRevision
      ? new Set(pending)
      : new Set([...pendingRoomConversationIdsRef.current, ...pending]);
    hydratedRoomOwnerRef.current = hydrationKey;
    const projections = cached.conversations
      .filter((conversation) => (
        (conversation.source === 'collaboration_room' || conversation.id.startsWith('chat_room_'))
        && !pendingRoomConversationIdsRef.current.has(conversation.id)
      ))
      .map(cachedRoomProjection)
      .filter((projection): projection is CachedRoomProjection => projection !== null);
    if (!projections.length) return;
    const cachedIds = new Set(projections.map(({ room }) => room.id));
    applyRoomList([
      ...projections.map(({ room }) => room),
      ...roomsRef.current.filter((room) => !cachedIds.has(room.id)),
    ]);
    for (const projection of projections) {
      if (projection.historyComplete) {
        roomHistoryCompleteRef.current.add(projection.room.id);
        roomHistoryNextOffsetRef.current.delete(projection.room.id);
      } else if (projection.nextOffset > 0) {
        roomHistoryCompleteRef.current.delete(projection.room.id);
        roomHistoryNextOffsetRef.current.set(projection.room.id, projection.nextOffset);
      }
      const existing = snapshotsRef.current.get(projection.room.id);
      // A summary row can hydrate before the background sync downloads the
      // full room transcript. Always merge the newer cache projection so the
      // room grows from that summary instead of remaining stuck at one row;
      // mergeCachedRoomSnapshot keeps optimistic/live messages in memory.
      setSnapshot(
        projection.room.id,
        mergeCachedRoomSnapshot(projection.snapshot, existing),
      );
    }
  }, [applyRoomList, cacheOwner, cacheRevision, localStore, setSnapshot]);

  const persistRoomSnapshot = useCallback(async (snapshot: HermesStudioRoomSnapshot) => {
    const linkedConversationId = snapshot.room.conversationId?.trim() || '';
    const conversationId = linkedConversationId
      || `chat_room_${snapshot.room.id.replace(/^room_/, '')}`;
    if (!localStore || !cacheOwner) return;
    const liveRoom = roomsRef.current.find(({ id }) => id === snapshot.room.id);
    if (
      !liveRoom
      || (linkedConversationId && liveRoom.conversationId?.trim() !== linkedConversationId)
      || pendingRoomConversationIdsRef.current.has(conversationId)
    ) return;
    const fingerprint = roomTranscriptFingerprint(
      snapshot,
      roomHistoryCompleteRef.current.has(snapshot.room.id),
      roomHistoryNextOffsetRef.current.get(snapshot.room.id) || 0,
    );
    if (persistedRoomFingerprintRef.current.get(conversationId) === fingerprint) return;
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    const deletionRevision = captureConversationDeletionRevision(cacheOwner);
    let pending: ReadonlySet<string>;
    try {
      pending = await localStore.readPendingConversationDeletionIds(cacheOwner);
    } catch {
      return;
    }
    if (
      pending.has(conversationId)
      || !isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)
      || captureConversationDeletionRevision(cacheOwner) !== deletionRevision
    ) return;
    const cached = await localStore.read(cacheOwner);
    if (
      !isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)
      || captureConversationDeletionRevision(cacheOwner) !== deletionRevision
    ) return;
    const currentRoom = roomsRef.current.find(({ id }) => id === snapshot.room.id);
    if (
      !currentRoom
      || (linkedConversationId
        ? currentRoom.conversationId?.trim() !== linkedConversationId
        : currentRoom.id !== snapshot.room.id)
      || pendingRoomConversationIdsRef.current.has(conversationId)
      || captureConversationDeletionRevision(cacheOwner) !== deletionRevision
    ) return;
    const existing = cached?.conversations.find(({ id }) => id === conversationId);
    const conversation = cachedConversationFromRoomSnapshot(
      snapshot,
      existing,
      agentProfile,
      roomHistoryCompleteRef.current.has(snapshot.room.id),
      roomHistoryNextOffsetRef.current.get(snapshot.room.id),
    );
    const applied = await localStore.upsert(
      cacheOwner,
      conversation,
      cached?.activeConversationId || '',
      ownerEpoch,
      deletionRevision,
    );
    // Mark the fingerprint ONLY on a confirmed durable write: a silently
    // skipped upsert (epoch/deletion guard tripped mid-flight) must leave
    // the fingerprint unset so the next persist pass retries instead of
    // treating the skipped snapshot as durable forever.
    if (
      applied
      && isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)
      && captureConversationDeletionRevision(cacheOwner) === deletionRevision
    ) {
      persistedRoomFingerprintRef.current.set(conversationId, fingerprint);
    }
  }, [agentProfile, cacheOwner, localStore]);

  const queueRoomSnapshotPersistence = useCallback((snapshot: HermesStudioRoomSnapshot) => {
    const key = snapshot.room.conversationId?.trim()
      || `chat_room_${snapshot.room.id.replace(/^room_/, '')}`;
    const previous = roomPersistenceQueueRef.current.get(key) || Promise.resolve();
    const task = previous.catch(() => undefined).then(() => persistRoomSnapshot(snapshot));
    roomPersistenceQueueRef.current.set(key, task);
    void task.finally(() => {
      if (roomPersistenceQueueRef.current.get(key) === task) {
        roomPersistenceQueueRef.current.delete(key);
      }
    }).catch(() => undefined);
  }, [persistRoomSnapshot]);

  const persistCurrentRoom = useCallback((roomId: string) => {
    const snapshot = snapshotsRef.current.get(roomId);
    if (snapshot) queueRoomSnapshotPersistence(snapshot);
  }, [queueRoomSnapshotPersistence]);

  const applyJoin = useCallback((result: HermesStudioGroupChatJoinResult) => {
    const roomId = result.roomId;
    const current = snapshotsRef.current.get(roomId);
    if (!current) return;
    const mergedMessages = result.messages.reduce(
      (messages, message) => upsertGroupMessage(messages, message),
      current.messages,
    );
    const nextContextStatuses = result.contextStatuses?.reduce<Record<string, string>>((statuses, entry) => {
      if (entry.agentName) statuses[entry.agentName] = entry.status;
      return statuses;
    }, {}) ?? current.contextStatuses;
    const nextRunningAgents = Object.entries(nextContextStatuses)
      .filter(([, status]) => status !== 'ready' && status !== 'idle' && status !== 'error')
      .map(([name]) => name);
    const nextTypingNames = (result.typingUsers || [])
      .filter((entry) => entry.userId !== stableUserId)
      .map((entry) => entry.userName)
      .filter(Boolean);
    setSnapshot(roomId, {
      ...current,
      room: { ...current.room, name: result.roomName || current.room.name },
      ...(result.agents ? { agents: result.agents } : {}),
      members: result.members,
      messages: attachWorkspaceDiffs(mergedMessages),
      typingNames: nextTypingNames,
      runningAgents: nextRunningAgents,
      contextStatuses: nextContextStatuses,
      ...(result.pendingApprovals ? { pendingApprovals: result.pendingApprovals } : {}),
      connected: Boolean(socketRef.current?.connected),
      loading: false,
      error: null,
      updatedAt: Date.now(),
    });
  }, [setSnapshot, stableUserId]);

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
      // Socket.IO room membership is connection-scoped.  A reconnect creates
      // a new server-side socket, so every room must be joined again even if
      // the local snapshot still knows that it was previously joined.
      const joinedRoomIds = [...joinedRoomIdsRef.current];
      joinedRoomIdsRef.current.clear();
      for (const roomId of joinedRoomIds) {
        patchSnapshot(roomId, (snapshot) => ({ ...snapshot, connected: false }));
      }
    };
    const onConnectError = (reason: Error) => {
      setConnected(false);
      // engine.io surfaces raw transport messages ("websocket error", "xhr
      // poll error"). These describe the transport, not the room, and confuse
      // users; surface a stable localized hint instead while retrying.
      const raw = String(reason?.message || '').toLowerCase();
      const transportFailure = raw.includes('websocket')
        || raw.includes('poll')
        || raw.includes('transport')
        || raw.includes('xhr')
        || raw.includes('error');
      setError(transportFailure
        ? (isChinese
          ? '无法连接 Hermes Studio 实时通道，正在自动重试…'
          : 'Cannot reach the Hermes Studio realtime channel; retrying…')
        : (reason?.message || (isChinese ? 'Agent 群聊连接失败' : 'Agent group chat connection failed')));
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
      if (roomId) {
        applyEvent({
          type: 'room-updated',
          roomId,
          totalTokens: payload.totalTokens === undefined ? undefined : Number(payload.totalTokens),
          name: stringValue(payload.name) || undefined,
        });
        // The SSE wake emits room_updated for every committed revision
        // (typing, roster, hosted-turn status, summary). Drop the detail
        // fingerprint so the very next poll tick performs a network refresh
        // instead of serving the cached projection.
        detailFingerprintRef.current.delete(roomId);
      }
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
    const onAgentsUpdated = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      if (!roomId || !Array.isArray(payload.agents)) return;
      const agents = payload.agents
        .map((agent) => normalizeRoomAgent(agent))
        .filter((agent): agent is NonNullable<ReturnType<typeof normalizeRoomAgent>> => agent !== null);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, agents, updatedAt: Date.now() }));
    };
    const onMemberKicked = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomId = stringValue(payload.roomId);
      if (!roomId) return;
      joinedRoomIdsRef.current.delete(roomId);
      patchSnapshot(roomId, (snapshot) => ({
        ...snapshot,
        connected: false,
        error: isChinese ? '你已被移出此 Agent 房间' : 'You were removed from this Agent room',
        updatedAt: Date.now(),
      }));
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
    socket.on('agents_updated', onAgentsUpdated);
    socket.on('member_kicked', onMemberKicked);
    socket.on('room_summary_updated', onSummaryUpdated);
    socket.on('approval.requested', onApprovalRequested);
    socket.on('approval.resolved', onApprovalResolved);
    socket.on('room_updated', onRoomUpdated);
    socket.on('room_cleared', onRoomCleared);
    // `connectRealtime()` starts the socket before returning.  A local or
    // low-latency server can therefore emit `connect` before these listeners
    // are attached; synchronize the already-connected state explicitly.
    if (socket.connected) onConnect();
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
      inviteCode: inviteCodeRef.current || undefined,
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
      const result = await studioApi.groupChat.joinRoom(target, roomId, {
        ...identity,
        inviteCode: inviteCodeRef.current || undefined,
      });
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

  const refresh = useCallback(async (forceNetwork = false) => {
    // Surface downloaded room transcripts before the first network response;
    // the REST list is authoritative when it succeeds, while a failed list
    // leaves these local rooms available for offline switching.
    await hydrateCachedRooms();
    if (!enabled && !forceNetwork) return;
    if (!studioApi) {
      if (fixtureMode && !roomsRef.current.length) applyRoomList(fixtureRooms());
      return;
    }
    await conversationDeleteReplayService?.replay().catch(() => undefined);
    const generation = ++bootstrapGenerationRef.current;
    setLoading(true);
    try {
      const readRevision = pendingRoomDeletionRevisionRef.current;
      const [listedRooms, pendingDeletionIds] = await Promise.all([
        studioApi.groupChat.listRooms(),
        localStore && cacheOwner
          ? localStore.readPendingConversationDeletionIds(cacheOwner)
          : Promise.resolve(new Set<string>()),
      ]);
      const latestPendingDeletionIds = localStore && cacheOwner
        ? await localStore.readPendingConversationDeletionIds(cacheOwner)
        : pendingDeletionIds;
      pendingRoomConversationIdsRef.current = pendingRoomDeletionRevisionRef.current === readRevision
        ? new Set(latestPendingDeletionIds)
        : new Set([
            ...pendingRoomConversationIdsRef.current,
            ...pendingDeletionIds,
            ...latestPendingDeletionIds,
          ]);
      const degradedTombstones = localStore
        ? new Set<string>()
        : await readDegradedRoomTombstones(cacheOwner);
      const nextRooms = listedRooms.filter((room) => {
        const conversationId = room.conversationId?.trim();
        const syntheticConversationId = `chat_room_${room.id.replace(/^room_/, '')}`;
        return !pendingRoomConversationIdsRef.current.has(room.id)
          && !pendingRoomConversationIdsRef.current.has(syntheticConversationId)
          && !degradedTombstones.has(room.id)
          && (!conversationId || !pendingRoomConversationIdsRef.current.has(conversationId));
      });
      if (generation !== bootstrapGenerationRef.current || !mountedRef.current) return;
      for (const room of nextRooms) {
        const previous = roomsRef.current.find((candidate) => candidate.id === room.id);
        if (previous && roomStateFingerprint(previous) !== roomStateFingerprint(room)) {
          detailFingerprintRef.current.delete(room.id);
          if ((room.messageCount || 0) < (previous.messageCount || 0)) {
            roomHistoryCompleteRef.current.delete(room.id);
            roomHistoryCountRef.current.delete(room.id);
            roomHistoryNextOffsetRef.current.delete(room.id);
          }
        }
      }
      applyRoomList(nextRooms);
      setConnected(true);
      setError(null);
      if (studioApi && degradedTombstones.size) {
        // Opportunistic replay for the degraded path, AFTER the list renders:
        // each retry can block on a full network timeout in weak networks,
        // and rendering must never wait behind them.
        void (async () => {
          for (const tombstonedId of degradedTombstones) {
            if (!mountedRef.current) return;
            if (!roomsRef.current.some((room) => room.id === tombstonedId)) {
              await clearDegradedRoomTombstone(tombstonedId, cacheOwner);
              continue;
            }
            try {
              await studioApi.groupChat.deleteRoom(tombstonedId);
              await clearDegradedRoomTombstone(tombstonedId, cacheOwner);
            } catch {
              // Still offline; the tombstone keeps the room hidden.
            }
          }
        })();
      }
      // New-device warm-up (#15): room summaries exist after the list call,
      // but full transcripts only land when a room is opened. Drain the most
      // recent rooms once, sequentially, in the background so switching to
      // them offline (or after a failed detail request) still shows history.
      if (
        studioApi
        && !fixtureMode
        && enabled
        && !backgroundHydrationDoneRef.current
        && nextRooms.length
      ) {
        backgroundHydrationDoneRef.current = true;
        const targets = [...nextRooms]
          .sort((left, right) => (right.lastActiveAt || 0) - (left.lastActiveAt || 0))
          .slice(0, 5);
        void (async () => {
          for (const room of targets) {
            if (!mountedRef.current) return;
            if (roomHistoryCompleteRef.current.has(room.id)) continue;
            try {
              await refreshRoomRef.current?.(room.id);
            } catch {
              // Background warm-up is best-effort; opening the room retries.
            }
          }
        })();
      }
    } catch (reason) {
      if (generation === bootstrapGenerationRef.current && mountedRef.current) {
        setConnected(false);
        setError(errorMessage(reason, isChinese));
      }
    } finally {
      if (generation === bootstrapGenerationRef.current && mountedRef.current) setLoading(false);
    }
  }, [applyRoomList, cacheOwner, conversationDeleteReplayService, enabled, fixtureMode, hydrateCachedRooms, isChinese, localStore, studioApi]);

  const refreshRoom = useCallback(async (requestedRoomId?: string) => {
    const roomId = requestedRoomId || activeRoomIdRef.current;
    if (!roomId) return;
    if (!studioApi) return;
    // Account epoch: a cacheOwner switch bumps this generation and wipes the
    // snapshots, so any in-flight detail response from the previous account
    // must never apply into the new one.
    const accountEpoch = bootstrapGenerationRef.current;
    const accountEpochCurrent = () => bootstrapGenerationRef.current === accountEpoch;
    const roomRevision = roomLifecycleRevisionRef.current.get(roomId) || 0;
    const listedRoom = roomsRef.current.find((room) => room.id === roomId);
    const listedFingerprint = listedRoom ? roomStateFingerprint(listedRoom) : '';
    if (
      listedFingerprint
      && detailFingerprintRef.current.get(roomId) === listedFingerprint
      && roomHistoryCompleteRef.current.has(roomId)
    ) {
      return;
    }
    if (detailInFlightRef.current.has(roomId)) return;
    detailInFlightRef.current.add(roomId);
    patchSnapshot(roomId, (snapshot) => ({ ...snapshot, loading: snapshot.messages.length === 0, error: null }));
    try {
      const [initialDetail, summaryResult] = await Promise.all([
        studioApi.groupChat.getRoomDetail(roomId, {
          offset: (() => {
            const known = snapshotsRef.current.get(roomId)?.messages.length || 0;
            const total = listedRoom?.messageCount || 0;
            const pendingOffset = roomHistoryNextOffsetRef.current.get(roomId);
            if (!roomHistoryCompleteRef.current.has(roomId)) {
              // A one-row cache summary is the newest message, not prefix
              // offset 0. Only resume from a server offset recorded by an
              // earlier bounded drain; otherwise start at the beginning.
              return Math.max(0, pendingOffset ?? 0);
            }
            if (total === 0 || known > total) return 0;
            return Math.max(0, known - 1);
          })(),
          limit: 150,
        }),
        studioApi.groupChat.getRoomSummary(roomId).catch(() => null),
      ]);
      if (
        !mountedRef.current
        || !accountEpochCurrent()
        || (roomLifecycleRevisionRef.current.get(roomId) || 0) !== roomRevision
        || !roomsRef.current.some((room) => room.id === roomId)
      ) return;
      let detail = initialDetail;
      let pagedDetail = initialDetail;
      const initialOffset = detail.offset || 0;
      const historyWasComplete = roomHistoryCompleteRef.current.has(roomId);
      let nextOffset = initialOffset + detail.messages.length;
      let pageCount = 1;
      // Newer collaboration servers expose offset/limit/has_more. Drain the
      // older pages only on the initial load; steady-state polling requests a
      // bounded tail and merges it with the cached transcript.
      // Two bounds: per-refresh pages (100 × 150) and an absolute transcript
      // ceiling across resumed passes, so a pathological room can never make
      // the client drain unbounded history in the background forever.
      const totalKnown = roomHistoryCountRef.current.get(roomId) || 0;
      const ROOM_DRAIN_PAGE_CAP = 100;
      const ROOM_DRAIN_TOTAL_CAP = 45_000;
      const roomTotalBudget = Math.max(0, ROOM_DRAIN_TOTAL_CAP - totalKnown);
      while (
        detail.hasMore
        && pageCount < ROOM_DRAIN_PAGE_CAP
        && detail.messages.length > 0
        && nextOffset - initialOffset < roomTotalBudget
      ) {
        const page = await studioApi.groupChat.getRoomDetail(roomId, {
          offset: nextOffset,
          limit: 150,
        });
        if (
          !mountedRef.current
          || !accountEpochCurrent()
          || (roomLifecycleRevisionRef.current.get(roomId) || 0) !== roomRevision
          || !roomsRef.current.some((room) => room.id === roomId)
        ) return;
        if (!page.messages.length) break;
        pagedDetail = {
          ...page,
          room: page.room,
          agents: page.agents.length ? page.agents : pagedDetail.agents,
          members: page.members.length ? page.members : pagedDetail.members,
          messages: mergeRoomHistoryMessages(pagedDetail.messages, page.messages),
          total: Math.max(pagedDetail.total || 0, page.total || 0),
          offset: initialOffset,
          limit: page.limit || pagedDetail.limit,
          hasMore: page.hasMore,
        };
        nextOffset += page.messages.length;
        pageCount += 1;
        detail = page;
      }
      const restored = snapshotFromDetail({
        ...pagedDetail,
        // Collaboration rooms are REST + polling on the current backend. A
        // successful detail response is the authoritative liveness signal;
        // leaving this tied to the retired Socket.IO handle made a healthy
        // room render as "Reconnecting" forever.
        connected: true,
        summary: summaryResult?.summary || null,
        summaryAnchor: summaryResult?.anchor || null,
      });
      setConnected(true);
      const restoredFingerprint = roomStateFingerprint(restored.room);
      if (restoredFingerprint) detailFingerprintRef.current.set(roomId, restoredFingerprint);
      const listed = roomsRef.current.find((room) => room.id === roomId);
      if (listed && restoredFingerprint && roomStateFingerprint(listed) !== restoredFingerprint) {
        applyRoomList(roomsRef.current.map((room) => room.id === roomId ? restored.room : room));
      }
      // A realtime message (or an optimistic local send) can arrive while the
      // REST history request is in flight. Merge the live snapshot into the
      // restored history before publishing it so switching/refreshing a room
      // cannot make a just-arrived model reply disappear.
      const current = snapshotsRef.current.get(roomId);
      const messages = mergeRoomHistoryMessages(
        restored.messages,
        current?.messages || [],
      );
      const totalMessages = Math.max(
        pagedDetail.total || 0,
        restored.room.messageCount || 0,
        messages.length,
      );
      roomHistoryCountRef.current.set(roomId, totalMessages);
      if (!pagedDetail.hasMore && (historyWasComplete || initialOffset === 0 || messages.length >= totalMessages)) {
        roomHistoryCompleteRef.current.add(roomId);
        roomHistoryNextOffsetRef.current.delete(roomId);
      } else if (pagedDetail.hasMore) {
        // A bounded drain may need more than one poll for a very large room.
        // Retain the server offset so the next pass continues instead of
        // downloading the same first 15,000 messages forever.
        roomHistoryCompleteRef.current.delete(roomId);
        roomHistoryNextOffsetRef.current.set(roomId, nextOffset);
      }
      const nextSnapshot: HermesStudioRoomSnapshot = {
        ...restored,
        messages: attachWorkspaceDiffs(messages),
        // In REST mode the room projection is authoritative for runtime state.
        // Empty arrays/objects are valid values, so using `||` here would keep
        // stale state or overwrite the freshly derived hosted-turn status with
        // the empty defaults from the previous snapshot.
        typingNames: socketRef.current ? (current?.typingNames || restored.typingNames) : restored.typingNames,
        runningAgents: restored.runningAgents,
        contextStatuses: restored.contextStatuses,
        pendingApprovals: socketRef.current
          ? (current?.pendingApprovals || restored.pendingApprovals)
          : restored.pendingApprovals,
        hasEarlierHistory: Boolean(
          roomHistoryNextOffsetRef.current.has(roomId)
          && !roomHistoryCompleteRef.current.has(roomId)
          && (roomHistoryNextOffsetRef.current.get(roomId) || 0) < totalMessages,
        ),
        updatedAt: Math.max(
          restored.updatedAt || 0,
          current?.updatedAt || 0,
          roomActivityTimestamp(restored.room, messages),
        ),
      };
      setSnapshot(roomId, nextSnapshot);
      // Rendering never waits for disk. Once this REST detail is on screen,
      // persist the normalized transcript so the same room can be opened on
      // the next offline launch.
      queueRoomSnapshotPersistence(nextSnapshot);
    } catch (reason) {
      // A late failure from the previous account must not flip the new
      // account's connection state (the snapshot patch is already a no-op —
      // the maps were reset on the account boundary).
      if (mountedRef.current && accountEpochCurrent()) setConnected(false);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, loading: false, error: errorMessage(reason, isChinese) }));
    } finally {
      detailInFlightRef.current.delete(roomId);
    }
  }, [applyRoomList, isChinese, patchSnapshot, queueRoomSnapshotPersistence, setSnapshot, studioApi]);

  refreshRoomRef.current = refreshRoom;

  const loadEarlierMessages = useCallback(async (requestedRoomId?: string) => {
    const roomId = requestedRoomId || activeRoomIdRef.current;
    if (!roomId) return;
    // Re-arm the bounded drain from the recorded server offset and pull the
    // next page immediately instead of waiting for the next poll tick.
    if (!roomHistoryNextOffsetRef.current.has(roomId)) return;
    setLoadingEarlierIds((current) => new Set(current).add(roomId));
    detailFingerprintRef.current.delete(roomId);
    try {
      await refreshRoom(roomId);
    } catch {
      // The next poll retries; the offset is preserved.
    } finally {
      setLoadingEarlierIds((current) => {
        if (!current.has(roomId)) return current;
        const next = new Set(current);
        next.delete(roomId);
        return next;
      });
    }
  }, [refreshRoom]);

  const selectRoom = useCallback((roomId: string) => {
    if (!roomId || !roomsRef.current.some((room) => room.id === roomId)) return;
    activeRoomIdRef.current = roomId;
    setActiveRoomId(roomId);
    detailFingerprintRef.current.delete(roomId);
    if (fixtureMode) return;
    void refreshRoom(roomId);
    // Connect the REST+SSE wake bus on first room entry: typing presence,
    // instant message delivery, and room_updated refresh signals ride it.
    void connectSocket()
      .then((socket) => (socket ? joinRoomOnSocket(roomId, socket) : undefined))
      .catch(() => undefined);
  }, [connectSocket, fixtureMode, joinRoomOnSocket, refreshRoom]);

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

  const sendingRoomIdsRef = useRef<Set<string>>(new Set());


  const sendMessageInner = useCallback(async (
    content: string,
    attachments: unknown[] | undefined,
    mentions: HermesStudioGroupChatMention[] | undefined,
    roomId: string,
  ) => {
    emitStopTyping(roomId);
    const snapshot = snapshotsRef.current.get(roomId);
    if (!snapshot) return;
    const previousDraft = draftsRef.current[roomId] ?? '';
    const id = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: HermesStudioGroupChatMessage = {
      id,
      roomId,
      senderId: stableUserId,
      senderName: identity.name,
      content,
      timestamp: Date.now(),
      role: 'user',
      deliveryStatus: 'pending',
      ...(mentions?.length ? { mentions } : {}),
    };
    patchSnapshot(roomId, (current) => ({
      ...current,
      messages: upsertGroupMessage(current.messages, optimistic),
      error: null,
      updatedAt: Date.now(),
    }));
    persistCurrentRoom(roomId);
    setDraft(roomId, '');
    if (!studioApi) {
      patchSnapshot(roomId, (current) => ({
        ...current,
        messages: upsertGroupMessage(current.messages, { ...optimistic, deliveryStatus: 'sent' }),
      }));
      persistCurrentRoom(roomId);
      notify(isChinese ? '预览模式：已加入 Agent 群聊时间线' : 'Preview: added to the Agent group timeline');
      return;
    }
    detailFingerprintRef.current.delete(roomId);
    try {
      // Mentions own server-side routing when present; the full roster is
      // only addressed for legacy broadcast sends without a resolved chip.
      const resolvedMentions = mentions?.length ? mentions : undefined;
      const profiles = resolvedMentions
        ? []
        : snapshot.agents.map((agent) => agent.profile).filter(Boolean);
      await studioApi.groupChat.sendRoomMessage(roomId, id, content, profiles, undefined, resolvedMentions);
      patchSnapshot(roomId, (current) => ({
        ...current,
        messages: upsertGroupMessage(current.messages, { ...optimistic, deliveryStatus: 'sent' }),
      }));
      persistCurrentRoom(roomId);
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      patchSnapshot(roomId, (current) => ({
        ...current,
        messages: upsertGroupMessage(current.messages, { ...optimistic, deliveryStatus: 'failed' }),
        error: message,
      }));
      persistCurrentRoom(roomId);
      setDraft(roomId, previousDraft || content);
      notify(message);
    }
  }, [emitStopTyping, identity.name, isChinese, notify, patchSnapshot, persistCurrentRoom, setDraft, stableUserId, studioApi]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- inner body of the guarded sendMessage


  const sendMessage = useCallback(async (
    requestedContent?: string,
    attachments?: unknown[],
    mentions?: HermesStudioGroupChatMention[],
  ) => {
    const roomId = activeRoomIdRef.current;
    const content = (requestedContent ?? draftsRef.current[roomId] ?? '').trim();
    if (!roomId || (!content && !attachments?.length)) return;
    // In-flight guard: quick-reply taps bypass the draft-clearing that the
    // main composer relies on; without this a double-tap sends twice (each
    // call mints a fresh request_id, so server-side idempotency can't dedupe).
    if (sendingRoomIdsRef.current.has(roomId)) return;
    sendingRoomIdsRef.current.add(roomId);
    try {
      await sendMessageInner(content, attachments, mentions, roomId);
    } finally {
      sendingRoomIdsRef.current.delete(roomId);
    }
  }, []);

  const retryFailedMessage = useCallback(async (roomId: string, messageId: string, content: string) => {
    if (!roomId || !messageId || !content.trim()) return;
    patchSnapshot(roomId, (current) => ({
      ...current,
      messages: current.messages.filter((message) => message.id !== messageId),
      updatedAt: Date.now(),
    }));
    persistCurrentRoom(roomId);
    // Call the inner body directly: the guard would silently swallow the
    // retry if another send is in flight, losing the text we just removed.
    await sendMessageInner(content.trim(), undefined, undefined, roomId);
  }, [patchSnapshot, persistCurrentRoom, sendMessageInner]);


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
        allowGuestAgents: options.allowGuestAgents,
        guestAgentApproval: options.guestAgentApproval,
        maxGuestAgentsPerMember: options.maxGuestAgentsPerMember,
        allowRemoteWorkspaceAccess: options.allowRemoteWorkspaceAccess,
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
      // The upstream route treats `summary` as an all-or-nothing config.  The
      // mobile create form intentionally leaves provider/model blank until a
      // user opts into summaries, so omit the field instead of sending an
      // invalid `{ provider: '', model: '' }` payload (which the server rejects
      // with 400).
      const requestedSummary = options.summary;
      const summary = requestedSummary
        && requestedSummary.profile.trim()
        && requestedSummary.provider.trim()
        && requestedSummary.model.trim()
        ? {
            ...requestedSummary,
            profile: requestedSummary.profile.trim(),
            provider: requestedSummary.provider.trim(),
            model: requestedSummary.model.trim(),
          }
        : undefined;
      const result = await studioApi.groupChat.createRoom({
        name: trimmedName,
        inviteCode: options.inviteCode || generateInviteCode(),
        memberName: identity.name,
        memberDescription: identity.description,
        agents: normalizedProfiles.map((profile) => ({ agent: 'hermes', profile })),
        summary,
        workspace: options.workspace || '',
        allowGuestAgents: options.allowGuestAgents,
        guestAgentApproval: options.guestAgentApproval,
        maxGuestAgentsPerMember: options.maxGuestAgentsPerMember,
        allowRemoteWorkspaceAccess: options.allowRemoteWorkspaceAccess,
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
      inviteCodeRef.current = trimmedCode;
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

  const removeRoomMember = useCallback(async (roomId: string, userId: string) => {
    if (!studioApi) return;
    try {
      const result = await studioApi.groupChat.removeRoomMember(roomId, userId);
      patchSnapshot(roomId, (snapshot) => ({
        ...snapshot,
        agents: result.agents.length ? result.agents : snapshot.agents,
        members: result.members.length ? result.members : snapshot.members.filter((member) => member.userId !== userId),
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
    await studioApi.groupChat.interruptAgentByName(roomId, agentName);
    await refreshRoom(roomId);
  }, [refreshRoom, studioApi]);

  const retractMessage = useCallback(async (roomId: string, messageId: string) => {
    if (!studioApi || !messageId.trim()) return;
    try {
      await studioApi.groupChat.retractMessage(roomId, messageId);
      // Mirror the server tombstone locally so the bubble flips immediately;
      // the next detail refresh reconciles against the authoritative marker.
      patchSnapshot(roomId, (current) => ({
        ...current,
        messages: current.messages.map((message) => (
          message.id === messageId
            ? { ...message, content: isChinese ? '[已撤回]' : '[Retracted]', retracted: true }
            : message
        )),
        updatedAt: Date.now(),
      }));
      persistCurrentRoom(roomId);
      detailFingerprintRef.current.delete(roomId);
    } catch (reason) {
      notify(errorMessage(reason, isChinese));
    }
  }, [detailFingerprintRef, identity.name, isChinese, notify, patchSnapshot, persistCurrentRoom, stableUserId, studioApi]);

  const respondApproval = useCallback(async (
    roomId: string,
    approvalId: string,
    choice: HermesStudioPendingApproval['choices'][number],
  ) => {
    if (!studioApi) return;
    // Route through the pending record so the write-approval decision carries
    // the profile/revision/digest context the collaboration plugin validates.
    const snapshot = snapshotsRef.current.get(roomId);
    const pending = (snapshot?.pendingApprovals || []).find((item) => item.approvalId === approvalId);
    await studioApi.groupChat.respondApprovalRest(roomId, approvalId, choice, {
      profile: pending?.profile,
      expectedRevision: pending?.expectedRevision,
      payloadDigest: pending?.payloadDigest,
    });
    applyEvent({ type: 'approval-resolved', roomId, approvalId });
  }, [applyEvent, studioApi]);

  const emitTyping = useCallback((roomId: string) => {
    const previous = typingTimersRef.current.get(roomId);
    if (previous) clearTimeout(previous);
    const socket = socketRef.current;
    if (socket && studioApi) studioApi.groupChat.emitTyping(socket, roomId);
    typingTimersRef.current.set(roomId, setTimeout(() => emitStopTyping(roomId), 4_000));
  }, [emitStopTyping, studioApi]);

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

  const downloadWorkspaceFile = useCallback(async (roomId: string, path: string, download = false): Promise<Blob | null> => {
    if (!studioApi) return null;
    return studioApi.groupChat.downloadWorkspaceFile(roomId, path, { download });
  }, [studioApi]);

  const readWorkspaceFileText = useCallback(async (roomId: string, path: string): Promise<{ content: string; size: number }> => {
    if (!studioApi) return { content: '', size: 0 };
    return studioApi.groupChat.readWorkspaceFileText(roomId, path);
  }, [studioApi]);

  const removeRoomFromState = useCallback((roomId: string) => {
    roomLifecycleRevisionRef.current.set(
      roomId,
      (roomLifecycleRevisionRef.current.get(roomId) || 0) + 1,
    );
    const currentRoom = roomsRef.current.find((room) => room.id === roomId);
    const conversationId = currentRoom?.conversationId?.trim()
      || `chat_room_${roomId.replace(/^room_/, '')}`;
    persistedRoomFingerprintRef.current.delete(conversationId);
    joinedRoomIdsRef.current.delete(roomId);
    snapshotsRef.current.delete(roomId);
    detailFingerprintRef.current.delete(roomId);
    detailInFlightRef.current.delete(roomId);
    roomHistoryCompleteRef.current.delete(roomId);
    roomHistoryCountRef.current.delete(roomId);
    roomHistoryNextOffsetRef.current.delete(roomId);
    applyRoomList(roomsRef.current.filter((room) => room.id !== roomId));
  }, [applyRoomList]);

  const deleteRoom = useCallback(async (roomId: string) => {
    const room = roomsRef.current.find((candidate) => candidate.id === roomId);
    const conversationId = room?.conversationId?.trim() || '';
    if (conversationId && localStore && cacheOwner) {
      pendingRoomDeletionRevisionRef.current += 1;
      pendingRoomConversationIdsRef.current.add(conversationId);
      const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
      try {
        const queued = await localStore.stageConversationDeletion(
          cacheOwner,
          {
            conversationId,
            // DELETE /rooms/{id} also removes the linked SingleConversation
            // on the backend; keeping one room tombstone avoids ambiguity
            // with offline synthetic chat_room_* identities.
            kind: 'room',
            remoteId: roomId,
            profile: agentProfile,
            queuedAt: Date.now(),
          },
          '',
          ownerEpoch,
        );
        if (!queued) throw new Error('Local Agent room history deletion was not committed');
        // The room index and chat history disappear immediately. The replay
        // service then deletes the linked single conversation; the backend
        // removes the room index as part of that operation.
        removeRoomFromState(roomId);
        await conversationDeleteReplayService?.replay(ownerEpoch).catch(() => undefined);
      } catch (reason) {
        const message = errorMessage(reason, isChinese);
        let committed = false;
        try {
          committed = (await localStore.readPendingConversationDeletionIds(cacheOwner)).has(conversationId);
        } catch {
          // Keep the room visible when storage cannot be inspected. A later
          // refresh will reconcile the durable outbox before filtering it.
        }
        if (committed) {
          // enqueue may have committed before cache pruning failed. Continue
          // the local-first contract and let the durable replay finish it.
          removeRoomFromState(roomId);
          void conversationDeleteReplayService?.replay(ownerEpoch).catch(() => undefined);
        } else {
          // No durable intent exists, so do not leave an in-memory tombstone
          // that would make a failed delete silently hide the room forever.
          pendingRoomConversationIdsRef.current.delete(conversationId);
          pendingRoomDeletionRevisionRef.current += 1;
        }
        setError(message);
        notify(message);
      }
      return;
    }

    // Legacy rooms may not have a linked SingleConversation yet. Use a
    // synthetic cache identity in the same durable outbox, and let replay
    // issue the room DELETE after the local row has been pruned.
    if (localStore && cacheOwner) {
      const syntheticConversationId = `chat_room_${roomId.replace(/^room_/, '')}`;
      pendingRoomDeletionRevisionRef.current += 1;
      pendingRoomConversationIdsRef.current.add(syntheticConversationId);
      const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
      try {
        const queued = await localStore.stageConversationDeletion(
          cacheOwner,
          {
            conversationId: syntheticConversationId,
            kind: 'room',
            remoteId: roomId,
            profile: agentProfile,
            queuedAt: Date.now(),
          },
          '',
          ownerEpoch,
        );
        if (!queued) throw new Error('Local Agent room deletion was not committed');
        removeRoomFromState(roomId);
        await conversationDeleteReplayService?.replay(ownerEpoch).catch(() => undefined);
      } catch (reason) {
        const message = errorMessage(reason, isChinese);
        let committed = false;
        try {
          committed = (await localStore.readPendingConversationDeletionIds(cacheOwner)).has(syntheticConversationId);
        } catch {
          // Leave the visible room in place when storage cannot be inspected.
        }
        if (committed) {
          removeRoomFromState(roomId);
          void conversationDeleteReplayService?.replay(ownerEpoch).catch(() => undefined);
        } else {
          pendingRoomConversationIdsRef.current.delete(syntheticConversationId);
          pendingRoomDeletionRevisionRef.current += 1;
        }
        setError(message);
        notify(message);
      }
      return;
    }

    // Degraded shells without a local store still keep a durable tombstone:
    // hide first, then DELETE, and on failure leave the tombstone so the
    // room cannot reappear from the next refresh — the refresh pass below
    // retries the remote DELETE for tombstoned rooms opportunistically.
    removeRoomFromState(roomId);
    if (!studioApi) return;
    await writeDegradedRoomTombstone(roomId, cacheOwner);
    try {
      await studioApi.groupChat.deleteRoom(roomId);
      await clearDegradedRoomTombstone(roomId, cacheOwner);
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [agentProfile, cacheOwner, conversationDeleteReplayService, isChinese, localStore, notify, removeRoomFromState, studioApi]);

  const clearRoom = useCallback(async (roomId: string) => {
    if (!studioApi) {
      // Offline preview clear is still a durable reset: persist the emptied
      // snapshot so a restart cannot resurrect the pre-clear history.
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, messages: [], updatedAt: Date.now() }));
      persistCurrentRoom(roomId);
      roomHistoryCompleteRef.current.add(roomId);
      roomHistoryCountRef.current.set(roomId, 0);
      roomHistoryNextOffsetRef.current.delete(roomId);
      return;
    }
    try {
      await studioApi.groupChat.clearRoomContext(roomId);
      applyEvent({ type: 'room-cleared', roomId });
      // The server transcript is now authoritatively empty; persist the
      // cleared snapshot so the next offline hydration cannot resurrect the
      // pre-clear history from the local cache (union/max merge otherwise
      // keeps whatever was on disk).
      persistCurrentRoom(roomId);
      detailFingerprintRef.current.delete(roomId);
      roomHistoryCompleteRef.current.add(roomId);
      roomHistoryCountRef.current.set(roomId, 0);
      roomHistoryNextOffsetRef.current.delete(roomId);
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      patchSnapshot(roomId, (snapshot) => ({ ...snapshot, error: message }));
      notify(message);
    }
  }, [applyEvent, isChinese, notify, patchSnapshot, persistCurrentRoom, studioApi]);

  joinRoomOnSocketRef.current = joinRoomOnSocket;

  useEffect(() => {
    mountedRef.current = true;
    bootstrapGenerationRef.current += 1;
    // A new cacheOwner (or client) is a hard account boundary: every piece
    // of visible state from the previous account must go, not only the refs
    // the unmount cleanup below already resets.
    activeRoomIdRef.current = '';
    setActiveRoomId('');
    roomsRef.current = [];
    setRooms([]);
    snapshotsRef.current.clear();
    draftsRef.current = {};
    setDrafts({});
    detailFingerprintRef.current.clear();
    hydratedRoomOwnerRef.current = '';
    backgroundHydrationDoneRef.current = false;
    setConnected(false);
    setError(null);
    setLoading(false);
    setCreating(false);
    return () => {
      mountedRef.current = false;
      bootstrapGenerationRef.current += 1;
      const socket = socketRef.current;
      socketRef.current = null;
      connectPromiseRef.current = null;
      joinedRoomIdsRef.current.clear();
      joinPromisesRef.current.clear();
      hydratedRoomOwnerRef.current = '';
      pendingRoomConversationIdsRef.current.clear();
      pendingRoomDeletionRevisionRef.current = 0;
      roomLifecycleRevisionRef.current.clear();
      persistedRoomFingerprintRef.current.clear();
      roomHistoryCompleteRef.current.clear();
      roomHistoryCountRef.current.clear();
      roomHistoryNextOffsetRef.current.clear();
      roomPersistenceQueueRef.current.clear();
      for (const timer of typingTimersRef.current.values()) clearTimeout(timer);
      typingTimersRef.current.clear();
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [cacheOwner, client]);

  useEffect(() => {
    if (!enabled) {
      // Keep downloaded collaboration transcripts available in the unified
      // history even before the user switches into the Studio mode. This is
      // local-only hydration; it does not open a network channel.
      void hydrateCachedRooms();
      return;
    }
    void (async () => {
      await refresh();
      if (!mountedRef.current) return;
      if (fixtureMode && !roomsRef.current.length) applyRoomList(fixtureRooms());
      const firstRoomId = activeRoomIdRef.current || roomsRef.current[0]?.id;
      if (firstRoomId) selectRoom(firstRoomId);
      else if (roomsRef.current.length) {
        // Rooms loaded but none selected: the bus still needs connecting so
        // room_updated wakes drive the list refresh.
        void connectSocket().catch(() => undefined);
      }
    })();
  }, [applyRoomList, conversationDeleteReplayService, enabled, fixtureMode, hydrateCachedRooms, refresh, selectRoom]);

  // Room tombstones must keep retrying even when this controller stays
  // mounted behind the ordinary chat route. AppState wake-up is important on
  // iOS because background timers are suspended and may never fire again.
  useEffect(() => {
    if (!conversationDeleteReplayService || fixtureMode) return undefined;
    return startForegroundReplayLifecycle({
      getAppState: () => AppState.currentState,
      replay: () => conversationDeleteReplayService.replay(),
      subscribe: (listener) => AppState.addEventListener('change', listener),
    }).stop;
  }, [conversationDeleteReplayService, fixtureMode]);

  // The collaboration plugin exposes REST snapshots and hosted-turn state,
  // not a Socket.IO namespace. Poll the active room while Studio is visible so
  // assistant replies become visible as soon as the backend workflow appends
  // them to the linked conversation.
  useEffect(() => {
    if (!enabled || fixtureMode || !studioApi) return;
    let pollCount = 0;
    const timer = setInterval(() => {
      pollCount += 1;
      void (async () => {
        // The room list is a small projection and carries message/turn
        // revisions. Refresh it periodically; only fetch the full transcript
        // when that fingerprint changes, avoiding repeated O(n) downloads for
        // an idle room while still noticing replies and running turns.
        if (pollCount % 6 === 0) await refresh();
        const roomId = activeRoomIdRef.current;
        if (roomId) await refreshRoom(roomId);
      })();
    }, 2_500);
    return () => clearInterval(timer);
  }, [enabled, fixtureMode, refresh, refreshRoom, studioApi]);

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
    loadEarlierMessages,
    loadingEarlier: loadingEarlierIds,
    cloneRoom,
    joinRoomByCode,
    updateRoomConfig,
    updateRoomWorkspace,
    updateInviteCode,
    addAgent,
    updateAgent,
    removeAgent,
    removeRoomMember,
    loadRoomSummary,
    updateRoomSummary,
    interruptAgent,
    respondApproval,
    retractMessage,
    retryFailedMessage,
    emitTyping,
    emitStopTyping,
    listWorkspaceFiles,
    readWorkspaceFile,
    writeWorkspaceFile,
    mkdirWorkspaceFile,
    deleteWorkspaceFile,
    downloadWorkspaceFile,
    readWorkspaceFileText,
  };
}

function roomTranscriptFingerprint(
  snapshot: HermesStudioRoomSnapshot,
  historyComplete = false,
  nextOffset = 0,
): string {
  return JSON.stringify([
    snapshot.room.conversationId || '',
    roomStateFingerprint(snapshot.room),
    historyComplete,
    Math.max(0, nextOffset),
    snapshot.agents.map((agent) => [
      agent.id,
      agent.profile,
      agent.provider || '',
      agent.model || '',
      agent.name,
    ]),
    snapshot.messages.map((message) => [
      message.id,
      message.timestamp,
      message.persistedAt || 0,
      message.isStreaming === true,
      message.deliveryStatus || '',
      message.content,
    ]),
  ]);
}

function cachedConversationFromRoomSnapshot(
  snapshot: HermesStudioRoomSnapshot,
  existing: SingleConversation | undefined,
  fallbackProfile: string,
  historyComplete: boolean,
  nextOffset?: number,
): SingleConversation {
  const room = snapshot.room;
  const profile = room.profiles?.[0]?.trim()
    || existing?.profile?.trim()
    || fallbackProfile.trim()
    || 'default';
  const messages = snapshot.messages.map(cachedMessageFromGroup);
  const updatedAt = Math.max(
    snapshot.updatedAt || 0,
    roomActivityTimestamp(room, snapshot.messages),
  );
  return {
    ...existing,
    id: room.conversationId || existing?.id || `chat_room_${room.id.replace(/^room_/, '')}`,
    profile,
    title: room.name.trim() || existing?.title || 'Agent room',
    messages,
    source: 'collaboration_room',
    room_id: room.id,
    message_count: Math.max(room.messageCount || 0, messages.length),
    hosted_turns: room.hostedTurns || existing?.hosted_turns,
    room_agents: snapshot.agents.length
      ? snapshot.agents.map((agent) => ({
          id: agent.id,
          room_id: agent.roomId || room.id,
          agent_id: agent.agentId,
          agent: agent.agent,
          profile: agent.profile,
          provider: agent.provider,
          model: agent.model,
          name: agent.name,
          description: agent.description,
        }))
      : existing?.room_agents,
    room_history_complete: historyComplete,
    room_history_next_offset: historyComplete ? undefined : Math.max(0, nextOffset || 0),
    created_at: room.createdAt || existing?.created_at,
    updated_at: updatedAt || existing?.updated_at || Date.now(),
    preview: [...messages].reverse().find(({ content }) => content.trim())?.content.slice(0, 160)
      || existing?.preview,
  };
}

function cachedMessageFromGroup(message: HermesStudioGroupChatMessage): CollaborationMessage {
  const role = message.role === 'user' ? 'user' : 'assistant';
  const timestamp = numberValue(message.persistedAt, numberValue(message.timestamp, Date.now()));
  return {
    id: message.id,
    role,
    name: message.senderName,
    content: message.content,
    created_at: message.timestamp,
    updated_at: timestamp,
    sender_id: message.senderId,
    sender_name: message.senderName,
    profile: message.senderAgentProfile,
    provider: message.senderAgentProvider,
    model: message.senderAgentModel,
    status: message.deliveryStatus === 'failed'
      ? 'failed'
      : message.isStreaming
        ? 'running'
        : 'completed',
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    meta: {
      ...(message.run_id ? { runtime_turn_id: message.run_id } : {}),
      ...(message.reasoning ? { reasoning: message.reasoning } : {}),
      ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
      ...(message.toolName || message.tool_name
        ? { tool_name: message.toolName || message.tool_name }
        : {}),
      ...(message.toolCallId || message.tool_call_id
        ? { tool_call_id: message.toolCallId || message.tool_call_id }
        : {}),
      ...(message.toolArgs !== undefined ? { tool_args: message.toolArgs } : {}),
      ...(message.toolResult !== undefined ? { tool_result: message.toolResult } : {}),
      ...(message.toolStatus ? { tool_status: message.toolStatus } : {}),
      room_id: message.roomId,
    },
  };
}

interface CachedRoomProjection {
  historyComplete: boolean;
  nextOffset: number;
  room: HermesStudioRoomInfo;
  snapshot: HermesStudioRoomSnapshot;
}

function cachedRoomProjection(conversation: SingleConversation): CachedRoomProjection | null {
  const conversationId = conversation.id.trim();
  if (!conversationId) return null;
  const explicitRoomId = conversation.room_id?.trim();
  const derivedRoomId = conversationId.startsWith('chat_room_')
    ? `room_${conversationId.slice('chat_room_'.length)}`
    : '';
  const roomId = explicitRoomId || derivedRoomId;
  if (!roomId) return null;
  const messages = conversation.messages
    .map((message) => normalizeGroupMessage(message, roomId))
    .filter((message): message is HermesStudioGroupChatMessage => message !== null);
  const latestMessageAt = messages.reduce(
    (latest, message) => Math.max(latest, numberValue(message.timestamp, 0)),
    0,
  );
  const createdAt = numberValue(conversation.created_at, 0);
  const lastActiveAt = Math.max(
    numberValue(conversation.updated_at, 0),
    latestMessageAt,
    createdAt,
  );
  const profile = conversation.profile.trim();
  const room: HermesStudioRoomInfo = {
    id: roomId,
    name: conversation.title.trim() || 'Agent room',
    inviteCode: null,
    profiles: profile ? [profile] : [],
    messageCount: Math.max(numberValue(conversation.message_count, 0), messages.length),
    conversationId,
    hostedTurns: isRecord(conversation.hosted_turns)
      ? conversation.hosted_turns as Record<string, Record<string, unknown>>
      : {},
    canManage: true,
    createdAt: createdAt || undefined,
    lastActiveAt: lastActiveAt || undefined,
  };
  const agents = (conversation.room_agents || conversation.participants || [])
    .map((agent) => normalizeRoomAgent({ ...agent, roomId }))
    .filter((agent): agent is NonNullable<ReturnType<typeof normalizeRoomAgent>> => agent !== null);
  const fallbackAgents = agents.length
    ? agents
    : room.profiles?.map((profile, index) => normalizeRoomAgent({
        id: roomId + '-agent-' + index,
        roomId,
        agentId: roomId + '-agent-' + index,
        agent: 'hermes',
        profile,
        name: profile,
      })).filter((agent): agent is NonNullable<ReturnType<typeof normalizeRoomAgent>> => agent !== null) || [];
  return {
    historyComplete: conversation.room_history_complete === true,
    nextOffset: Math.max(0, numberValue(conversation.room_history_next_offset, 0)),
    room,
    snapshot: snapshotFromDetail({
      room,
      agents: fallbackAgents,
      members: [],
      messages,
      connected: false,
    }),
  };
}

function roomStateFingerprint(room: HermesStudioRoomInfo): string {
  const turns = Object.entries(room.hostedTurns || {})
    .map(([id, turn]) => [
      id,
      stringValue(turn.status, stringValue(turn.state)),
      numberValue(turn.updated_at ?? turn.updatedAt ?? turn.started_at ?? turn.created_at, 0),
    ])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  // A REST room projection normally includes message_count and hosted_turns.
  // Return an empty fingerprint for legacy fixtures with none of those
  // revision signals so they continue to refresh rather than becoming stale.
  if (room.messageCount === undefined && room.lastActiveAt === undefined && !turns.length) return '';
  return JSON.stringify([room.messageCount ?? 0, room.lastActiveAt ?? 0, turns]);
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
