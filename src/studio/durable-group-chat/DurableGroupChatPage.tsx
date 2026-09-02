import {
  Check,
  CircleStop,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  FlatList,
  KeyboardAvoidingView,
  type ListRenderItemInfo,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { HermesApiClient } from '../../api/HermesApiClient';
import type {
  CreateDurableGroupChatMember,
  DurableGroupChatEvent,
  DurableGroupChatExecutionNode,
  DurableGroupChatGateway,
  DurableGroupChatRoom,
  DurableGroupChatRoomState,
} from '../../api/cloud/durable-group-chat';
import { hermesCloudApiFor } from '../../api/hermes-api-registry';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { NativeButton } from '../../components/ui/NativeButton';
import { useTheme } from '../../design/ThemeProvider';
import { multiplyAlpha } from '../../design/control-contracts';
import {
  appendDurableGroupChatMember,
  durableGroupChatMemberToken,
} from './member-selection';

const ACTIVE_POLL_MS = 3_000;
const ACTIVE_CATCH_UP_MS = 50;
const MAX_VISIBLE_EVENTS = 1_000;

export interface DurableGroupChatPageProps {
  client?: HermesApiClient;
  compact: boolean;
  isChinese: boolean;
  notify(message: string): void;
  onOpenNavigation?(): void;
}

function requestKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function eventText(event: DurableGroupChatEvent): string {
  const payload = event.payload;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.name === 'string') return `Renamed to ${payload.name}`;
  if (typeof payload.message === 'string') return payload.message;
  return event.kind.replaceAll('.', ' ');
}

function eventAuthor(event: DurableGroupChatEvent): string {
  const actor = event.actor ?? {};
  return actor.id || actor.kind || 'system';
}

function actionField(action: Record<string, unknown>, key: string): string {
  return typeof action[key] === 'string' ? action[key] : '';
}

/**
 * Accept plain local profiles as before, while allowing `gateway/profile` to
 * identify a profile hosted by another gateway. The member id is kept stable
 * and globally unambiguous without changing the local wire shape.
 */
export function parseDurableGroupChatMember(value: string): CreateDurableGroupChatMember | null {
  const token = value.trim();
  if (!token) return null;
  const separator = token.indexOf('/');
  if (separator < 0) return { memberId: token, profile: token, handle: token };
  const gatewayId = token.slice(0, separator).trim();
  const profile = token.slice(separator + 1).trim();
  if (!gatewayId || !profile || profile.includes('/')) return null;
  return {
    memberId: `${gatewayId}/${profile}`,
    profile,
    handle: profile,
    gatewayId,
  };
}

function durableMemberLabel(member: DurableGroupChatRoom['members'][number]): string {
  const identity = member.display_name || member.handle || member.profile || member.member_id;
  const target = member.target;
  const isPeer = target?.kind === 'peer';
  const gateway = member.gateway_id || (isPeer ? target?.peer_id : undefined) || 'local';
  const device = member.device || (isPeer ? target?.installation_id : undefined);
  return `${identity} · ${gateway}${device ? ` / ${device}` : ''}`;
}

function durableGatewayLabel(gateway: DurableGroupChatGateway): string {
  const device = gateway.device || gateway.installation_id || 'device';
  const status = gateway.online === false ? 'offline' : gateway.online === true ? 'online' : '';
  return `${gateway.gateway_id} · ${device}${status ? ` · ${status}` : ''}`;
}

function gatewayProfileSelectable(gateway: DurableGroupChatGateway): boolean {
  return gateway.room_member_supported !== false
    && gateway.room_link_ready !== false
    && gateway.online !== false;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'status' in error
    && (error as { status?: unknown }).status === 404;
}

export function DurableGroupChatPage({
  client,
  compact,
  isChinese,
  notify,
  onOpenNavigation,
}: DurableGroupChatPageProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => (client ? hermesCloudApiFor(client) : null), [client]);
  const [rooms, setRooms] = useState<DurableGroupChatRoom[]>([]);
  const [gateways, setGateways] = useState<DurableGroupChatGateway[]>([]);
  const [executionNodes, setExecutionNodes] = useState<DurableGroupChatExecutionNode[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeState, setActiveState] = useState<DurableGroupChatRoomState | null>(null);
  const [events, setEvents] = useState<DurableGroupChatEvent[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const cursorRef = useRef(0);
  const selectedRoomRef = useRef<string | null>(null);
  const activeRequestRef = useRef(0);
  const roomsRequestRef = useRef(0);
  const gatewaysRequestRef = useRef(0);
  const roomsAbortRef = useRef<AbortController | null>(null);
  const gatewaysAbortRef = useRef<AbortController | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  const activePollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMoreRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const mountedRef = useRef(true);
  const roomListMutationRef = useRef(0);
  const [draft, setDraft] = useState('');
  const [roomName, setRoomName] = useState('');
  const [membersInput, setMembersInput] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectedMemberTokens = useMemo(() => new Set(
    membersInput.split(',').map((value) => value.trim()).filter(Boolean),
  ), [membersInput]);

  const cancelRoomsRequest = useCallback(() => {
    roomsRequestRef.current += 1;
    roomsAbortRef.current?.abort();
    roomsAbortRef.current = null;
  }, []);

  const cancelGatewaysRequest = useCallback(() => {
    gatewaysRequestRef.current += 1;
    gatewaysAbortRef.current?.abort();
    gatewaysAbortRef.current = null;
  }, []);

  const cancelActiveSync = useCallback(() => {
    activeRequestRef.current += 1;
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    if (activePollTimerRef.current !== null) {
      clearTimeout(activePollTimerRef.current);
      activePollTimerRef.current = null;
    }
  }, []);

  const markRoomListMutation = useCallback(() => {
    roomListMutationRef.current += 1;
    cancelRoomsRequest();
  }, [cancelRoomsRequest]);

  const loadRooms = useCallback(async () => {
    if (!api || !mountedRef.current || appStateRef.current !== 'active') return;
    const requestId = ++roomsRequestRef.current;
    const mutationVersion = roomListMutationRef.current;
    roomsAbortRef.current?.abort();
    const controller = new AbortController();
    roomsAbortRef.current = controller;
    try {
      const result = await api.getDurableGroupChatRooms(controller.signal);
      if (
        !mountedRef.current
        || appStateRef.current !== 'active'
        || requestId !== roomsRequestRef.current
        || mutationVersion !== roomListMutationRef.current
      ) return;
      setRooms(result.rooms);
      setActiveRoomId((current) => current && result.rooms.some((room) => room.room_id === current)
        ? current
        : result.rooms[0]?.room_id ?? null);
    } catch (error) {
      if (
        isAbortError(error)
        || !mountedRef.current
        || appStateRef.current !== 'active'
        || requestId !== roomsRequestRef.current
        || mutationVersion !== roomListMutationRef.current
      ) return;
      notify(error instanceof Error ? error.message : (isChinese ? '无法加载群聊' : 'Unable to load Group Chat'));
    } finally {
      if (roomsAbortRef.current === controller) roomsAbortRef.current = null;
    }
  }, [api, isChinese, notify]);

  const loadGateways = useCallback(async () => {
    if (!api || !mountedRef.current || appStateRef.current !== 'active') return;
    const requestId = ++gatewaysRequestRef.current;
    gatewaysAbortRef.current?.abort();
    const controller = new AbortController();
    gatewaysAbortRef.current = controller;
    try {
      const result = await api.getDurableGroupChatGateways(controller.signal);
      if (
        !mountedRef.current
        || appStateRef.current !== 'active'
        || requestId !== gatewaysRequestRef.current
      ) return;
      setGateways(Array.isArray(result.gateways) ? result.gateways : []);
      setExecutionNodes(Array.isArray(result.execution_nodes) ? result.execution_nodes : []);
    } catch (error) {
      if (isNotFoundError(error)) {
        if (mountedRef.current && requestId === gatewaysRequestRef.current) {
          setGateways([]);
          setExecutionNodes([]);
        }
        return;
      }
      if (
        isAbortError(error)
        || !mountedRef.current
        || appStateRef.current !== 'active'
        || requestId !== gatewaysRequestRef.current
      ) return;
      // Gateway discovery is optional; a catalog outage should not clear the
      // room state or interrupt an already-selected conversation.
      notify(error instanceof Error ? error.message : (isChinese ? '无法加载 Gateway 列表' : 'Unable to load gateway catalog'));
    } finally {
      if (gatewaysAbortRef.current === controller) gatewaysAbortRef.current = null;
    }
  }, [api, isChinese, notify]);

  const loadActiveRoom = useCallback(async (roomId: string, append = false) => {
    if (
      !api
      || !mountedRef.current
      || appStateRef.current !== 'active'
      || selectedRoomRef.current !== roomId
    ) return;
    const requestId = ++activeRequestRef.current;
    activeAbortRef.current?.abort();
    const controller = new AbortController();
    activeAbortRef.current = controller;
    try {
      const [state, page] = await Promise.all([
        api.getDurableGroupChatRoom(roomId, controller.signal),
        api.getDurableGroupChatEvents(roomId, {
          sinceSeq: append ? cursorRef.current : 0,
          limit: 200,
          signal: controller.signal,
        }),
      ]);
      if (
        !mountedRef.current
        || appStateRef.current !== 'active'
        || selectedRoomRef.current !== roomId
        || requestId !== activeRequestRef.current
      ) return;
      setActiveState(state);
      setEvents((current) => {
        if (!append) return page.events.slice(-MAX_VISIBLE_EVENTS);
        const known = new Set(current.map((event) => event.seq));
        return [...current, ...page.events.filter((event) => !known.has(event.seq))]
          .slice(-MAX_VISIBLE_EVENTS);
      });
      hasMoreRef.current = page.has_more;
      setHistoryHasMore(page.has_more);
      cursorRef.current = append ? Math.max(cursorRef.current, page.cursor) : page.cursor;
    } catch (error) {
      if (
        isAbortError(error)
        || !mountedRef.current
        || appStateRef.current !== 'active'
        || selectedRoomRef.current !== roomId
        || requestId !== activeRequestRef.current
      ) return;
      notify(error instanceof Error ? error.message : (isChinese ? '无法加载群聊日志' : 'Unable to load Group Chat log'));
    } finally {
      if (activeAbortRef.current === controller) activeAbortRef.current = null;
    }
  }, [api, isChinese, notify]);

  const scheduleActivePoll = useCallback((roomId: string, delayMs: number) => {
    if (activePollTimerRef.current !== null) clearTimeout(activePollTimerRef.current);
    activePollTimerRef.current = null;
    if (
      !api
      || !mountedRef.current
      || appStateRef.current !== 'active'
      || selectedRoomRef.current !== roomId
    ) return;
    activePollTimerRef.current = setTimeout(() => {
      activePollTimerRef.current = null;
      if (
        !api
        || !mountedRef.current
        || appStateRef.current !== 'active'
        || selectedRoomRef.current !== roomId
      ) return;
      void loadActiveRoom(roomId, true).finally(() => {
        if (
          mountedRef.current
          && appStateRef.current === 'active'
          && selectedRoomRef.current === roomId
        ) {
          scheduleActivePoll(
            roomId,
            hasMoreRef.current ? ACTIVE_CATCH_UP_MS : ACTIVE_POLL_MS,
          );
        }
      });
    }, Math.max(0, delayMs));
  }, [api, loadActiveRoom]);

  const refreshActiveRoom = useCallback(async (roomId: string, append = false) => {
    if (
      !api
      || !mountedRef.current
      || appStateRef.current !== 'active'
      || selectedRoomRef.current !== roomId
    ) return;
    if (activePollTimerRef.current !== null) {
      clearTimeout(activePollTimerRef.current);
      activePollTimerRef.current = null;
    }
    await loadActiveRoom(roomId, append);
    if (
      mountedRef.current
      && appStateRef.current === 'active'
      && selectedRoomRef.current === roomId
    ) {
      scheduleActivePoll(
        roomId,
        hasMoreRef.current ? ACTIVE_CATCH_UP_MS : ACTIVE_POLL_MS,
      );
    }
  }, [api, loadActiveRoom, scheduleActivePoll]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelActiveSync();
      cancelRoomsRequest();
      cancelGatewaysRequest();
      selectedRoomRef.current = null;
    };
  }, [cancelActiveSync, cancelGatewaysRequest, cancelRoomsRequest]);

  useEffect(() => {
    void loadRooms();
    void loadGateways();
    return () => {
      cancelRoomsRequest();
      cancelGatewaysRequest();
    };
  }, [cancelGatewaysRequest, cancelRoomsRequest, loadGateways, loadRooms]);

  useEffect(() => {
    selectedRoomRef.current = activeRoomId;
    cancelActiveSync();
    hasMoreRef.current = false;
    setHistoryHasMore(false);
    setActiveState(null);
    if (!activeRoomId) {
      setEvents([]);
      cursorRef.current = 0;
      return () => {
        if (selectedRoomRef.current === activeRoomId) selectedRoomRef.current = null;
      };
    }
    setEvents([]);
    cursorRef.current = 0;
    if (api && appStateRef.current === 'active') void refreshActiveRoom(activeRoomId);
    return () => {
      cancelActiveSync();
      if (selectedRoomRef.current === activeRoomId) selectedRoomRef.current = null;
    };
  }, [activeRoomId, cancelActiveSync, refreshActiveRoom]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = nextState;
      if (nextState !== 'active') {
        cancelActiveSync();
        cancelGatewaysRequest();
        return;
      }
      if (!api) return;
      const roomId = selectedRoomRef.current;
      if (!wasActive && roomId) {
        hasMoreRef.current = false;
        setHistoryHasMore(false);
        setActiveState(null);
        setEvents([]);
        cursorRef.current = 0;
        void refreshActiveRoom(roomId);
      }
      if (!wasActive) void loadGateways();
    });
    return () => subscription.remove();
  }, [api, cancelActiveSync, cancelGatewaysRequest, loadGateways, refreshActiveRoom]);

  const createRoom = async () => {
    if (!api || !roomName.trim()) return;
    const memberTokens = membersInput.split(',').map((value) => value.trim()).filter(Boolean);
    const members: CreateDurableGroupChatMember[] = [];
    const invalidMembers: string[] = [];
    for (const token of memberTokens) {
      const member = parseDurableGroupChatMember(token);
      if (member) members.push(member);
      else invalidMembers.push(token);
    }
    if (invalidMembers.length > 0) {
      notify(isChinese
        ? `成员格式无效：${invalidMembers.join(', ')}。请使用 profile 或 gateway/profile。`
        : `Invalid member format: ${invalidMembers.join(', ')}. Use profile or gateway/profile.`);
      return;
    }
    const connectorOnlyGatewayIds = new Set(executionNodes.map((node) => node.node_id));
    const blockedMember = members.find((member) => member.gatewayId && connectorOnlyGatewayIds.has(member.gatewayId));
    if (blockedMember?.gatewayId) {
      notify(isChinese
        ? `${blockedMember.gatewayId} 是 connector-only 仅执行节点，不可作为 RoomLink gateway。`
        : `${blockedMember.gatewayId} is connector-only and cannot be used as a RoomLink gateway.`);
      return;
    }
    if (members.length < 2) {
      notify(isChinese ? '至少填写两个 Profile（可用 gateway/profile）' : 'Enter at least two profiles (gateway/profile is supported)');
      return;
    }
    markRoomListMutation();
    setBusy(true);
    try {
      const result = await api.createDurableGroupChat({
        idempotencyKey: requestKey('mobile-create'),
        name: roomName.trim(),
        members,
      });
      markRoomListMutation();
      setRooms((current) => [result.room, ...current.filter((room) => room.room_id !== result.room.room_id)]);
      setActiveRoomId(result.room.room_id);
      setRoomName('');
      setMembersInput('');
      setCreateOpen(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : (isChinese ? '创建群聊失败' : 'Unable to create Group Chat'));
    } finally {
      setBusy(false);
    }
  };

  const selectGatewayProfile = useCallback((gateway: DurableGroupChatGateway, profile: string) => {
    if (!gatewayProfileSelectable(gateway)) return;
    setMembersInput((current) => appendDurableGroupChatMember(
      current,
      gateway.gateway_id,
      profile,
    ));
  }, []);

  const sendMessage = async () => {
    const roomId = activeRoomId;
    if (!api || !roomId || selectedRoomRef.current !== roomId || !draft.trim()) return;
    setBusy(true);
    try {
      await api.sendDurableGroupChatMessage(roomId, {
        idempotencyKey: requestKey('mobile-send'),
        text: draft.trim(),
        threadId: `mobile-thread-${roomId}`,
      });
      setDraft('');
      if (selectedRoomRef.current === roomId) await refreshActiveRoom(roomId, true);
    } catch (error) {
      notify(error instanceof Error ? error.message : (isChinese ? '发送失败' : 'Unable to send message'));
    } finally {
      setBusy(false);
    }
  };

  const stopRoom = async () => {
    const roomId = activeRoomId;
    if (!api || !roomId || selectedRoomRef.current !== roomId) return;
    setBusy(true);
    try {
      await api.stopDurableGroupChat(roomId, requestKey('mobile-stop'));
      if (selectedRoomRef.current === roomId) await refreshActiveRoom(roomId);
    } catch (error) {
      notify(error instanceof Error ? error.message : (isChinese ? '停止失败' : 'Unable to stop room'));
    } finally {
      setBusy(false);
    }
  };

  const renameRoom = async () => {
    const roomId = activeRoomId;
    if (!api || !roomId || selectedRoomRef.current !== roomId || !renameValue.trim()) return;
    markRoomListMutation();
    setBusy(true);
    try {
      await api.renameDurableGroupChat(roomId, {
        idempotencyKey: requestKey('mobile-rename'),
        name: renameValue.trim(),
      });
      markRoomListMutation();
      setRenameOpen(false);
      await loadRooms();
      if (selectedRoomRef.current === roomId) await refreshActiveRoom(roomId);
    } catch (error) {
      notify(error instanceof Error ? error.message : (isChinese ? '重命名失败' : 'Unable to rename room'));
    } finally {
      setBusy(false);
    }
  };

  const retryTask = async (taskId: string) => {
    const roomId = activeRoomId;
    if (!api || !roomId || selectedRoomRef.current !== roomId || !taskId) return;
    setBusy(true);
    try {
      await api.retryDurableGroupChatTask(roomId, taskId);
      if (selectedRoomRef.current === roomId) await refreshActiveRoom(roomId);
    } catch (error) {
      notify(error instanceof Error ? error.message : (isChinese ? '重试失败' : 'Unable to retry task'));
    } finally {
      setBusy(false);
    }
  };

  const approveTask = async (action: Record<string, unknown>, choice: 'once' | 'deny') => {
    const roomId = activeRoomId;
    if (!api || !roomId || selectedRoomRef.current !== roomId) return;
    const memberId = actionField(action, 'member_id');
    const taskId = actionField(action, 'task_id');
    const requestId = actionField(action, 'request_id');
    const executionGeneration = Number(action.execution_generation);
    if (!memberId || !taskId || !requestId || !Number.isInteger(executionGeneration) || executionGeneration < 1) return;
    setBusy(true);
    try {
      await api.approveDurableGroupChatTask(roomId, { memberId, taskId, executionGeneration, requestId, choice });
      if (selectedRoomRef.current === roomId) await refreshActiveRoom(roomId);
    } catch (error) {
      notify(error instanceof Error ? error.message : (isChinese ? '审批失败' : 'Unable to resolve approval'));
    } finally {
      setBusy(false);
    }
  };

  const deleteRoom = async () => {
    const roomId = activeRoomId;
    if (!api || !roomId || selectedRoomRef.current !== roomId) return;
    markRoomListMutation();
    setBusy(true);
    try {
      await api.deleteDurableGroupChat(roomId);
      markRoomListMutation();
      const deleted = roomId;
      setRooms((current) => current.filter((room) => room.room_id !== deleted));
      if (selectedRoomRef.current === deleted) {
        setActiveRoomId(null);
        setActiveState(null);
        setEvents([]);
        cursorRef.current = 0;
      }
      setDeleteConfirmOpen(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : (isChinese ? '删除失败' : 'Unable to delete room'));
    } finally {
      setBusy(false);
    }
  };

  const pendingActions = activeState?.driver_status.pending_actions ?? [];
  const renderEvent = useCallback(({ item: event }: ListRenderItemInfo<DurableGroupChatEvent>) => (
    <View style={[styles.event, { borderColor: tokens.colors.border }]}>
      <Text style={[styles.eventAuthor, { color: tokens.colors.primary }]}>{eventAuthor(event)} · {event.kind}</Text>
      <Text style={[styles.eventText, { color: tokens.colors.foreground }]}>{eventText(event)}</Text>
    </View>
  ), [tokens]);

  if (!client) {
    return <View style={[styles.empty, { backgroundColor: tokens.colors.background }]}><Text style={{ color: tokens.colors.textSecondary }}>{isChinese ? '连接 Hermes 后使用持久化群聊' : 'Connect Hermes to use durable Group Chat'}</Text></View>;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: tokens.colors.background }]}
    >
      <View style={[styles.header, { borderBottomColor: tokens.colors.border, paddingTop: compact ? insets.top + 8 : 12 }]}> 
        {compact ? <IOSPressable accessibilityLabel={isChinese ? '返回导航' : 'Open navigation'} onPress={onOpenNavigation} style={styles.headerIcon}><X color={tokens.colors.foreground} size={20} /></IOSPressable> : null}
        <Users color={tokens.colors.primary} size={18} />
        <Text style={[styles.title, { color: tokens.colors.foreground }]}>{isChinese ? '持久化群聊' : 'Durable Group Chat'}</Text>
        <View style={styles.headerActions}>
          <IOSPressable accessibilityLabel={isChinese ? '刷新群聊' : 'Refresh Group Chat'} onPress={() => { void loadRooms(); void loadGateways(); }} style={styles.headerIcon}><RefreshCw color={tokens.colors.textSecondary} size={17} /></IOSPressable>
          <IOSPressable accessibilityLabel={isChinese ? '创建群聊' : 'Create Group Chat'} onPress={() => setCreateOpen((open) => !open)} style={styles.headerIcon}><Plus color={tokens.colors.textSecondary} size={18} /></IOSPressable>
        </View>
      </View>
      {createOpen ? (
        <View style={[styles.createPanel, { borderBottomColor: tokens.colors.border }]}> 
          <TextInput accessibilityLabel={isChinese ? '群聊名称' : 'Group Chat name'} onChangeText={setRoomName} placeholder={isChinese ? '群聊名称' : 'Group name'} placeholderTextColor={tokens.colors.textTertiary} style={[styles.input, { borderColor: tokens.colors.border, color: tokens.colors.foreground }]} value={roomName} />
          <TextInput accessibilityLabel={isChinese ? '成员 Profile' : 'Member profiles'} onChangeText={setMembersInput} placeholder="default, reviewer, gateway/profile" placeholderTextColor={tokens.colors.textTertiary} style={[styles.input, { borderColor: tokens.colors.border, color: tokens.colors.foreground }]} value={membersInput} />
          <Text style={[styles.inputHint, { color: tokens.colors.textTertiary }]}>{isChinese ? '本地成员填写 profile；跨网关成员填写 gateway/profile。也可从下方已注册 Gateway 中点选。' : 'Use profile for local members or gateway/profile for a remote member. You can also select a registered gateway below.'}</Text>
          {gateways.length > 0 ? (
            <View style={styles.gatewayCatalog}>
              <Text style={[styles.catalogTitle, { color: tokens.colors.textSecondary }]}>{isChinese ? '可用 Gateway / Device' : 'Available gateways / devices'}</Text>
              <FlatList
                data={gateways}
                horizontal
                keyExtractor={(gateway) => gateway.gateway_id}
                renderItem={({ item: gateway }) => {
                  const selectable = gatewayProfileSelectable(gateway);
                  return (
                  <View style={[styles.gatewayChip, { borderColor: tokens.colors.border }]}>
                    <Text numberOfLines={1} style={[styles.gatewayText, { color: tokens.colors.foreground }]}>{durableGatewayLabel(gateway)}</Text>
                    {gateway.profiles.length > 0 ? (
                      <View style={styles.gatewayProfileList}>
                        {gateway.profiles.map((profile) => {
                          const memberToken = durableGroupChatMemberToken(gateway.gateway_id, profile);
                          const selected = memberToken ? selectedMemberTokens.has(memberToken) : false;
                          return (
                            <IOSPressable
                              accessibilityLabel={isChinese
                                ? `选择 ${gateway.gateway_id} 上的 ${profile}`
                                : `Select ${profile} on ${gateway.gateway_id}`}
                              accessibilityState={{ disabled: !selectable, selected }}
                              disabled={!selectable || !memberToken}
                              haptic="selection"
                              key={`${gateway.gateway_id}-${profile}`}
                              onPress={() => selectGatewayProfile(gateway, profile)}
                              style={[
                                styles.gatewayProfileChip,
                                {
                                  backgroundColor: selected
                                    ? multiplyAlpha(tokens.colors.primary, 0.16)
                                    : 'transparent',
                                  borderColor: selected ? tokens.colors.primary : tokens.colors.border,
                                  opacity: selectable ? 1 : 0.55,
                                },
                              ]}
                            >
                              <Text numberOfLines={1} style={[styles.gatewayProfiles, { color: selected ? tokens.colors.primary : tokens.colors.textTertiary }]}>{profile}</Text>
                            </IOSPressable>
                          );
                        })}
                      </View>
                    ) : null}
                    {!selectable && gateway.reason ? <Text numberOfLines={2} style={[styles.gatewayReason, { color: tokens.colors.warning }]}>{gateway.reason}</Text> : null}
                  </View>
                  );
                }}
                showsHorizontalScrollIndicator={false}
              />
            </View>
          ) : null}
          {executionNodes.length > 0 ? (
            <Text style={[styles.executionNodeNotice, { color: tokens.colors.textTertiary }]}>
              {isChinese
                ? `connector-only / 仅执行节点不可作为 RoomLink gateway：${executionNodes.map((node) => node.node_id).join(', ')}`
                : `connector-only / Execution-only nodes cannot be RoomLink gateways: ${executionNodes.map((node) => node.node_id).join(', ')}`}
            </Text>
          ) : null}
          <NativeButton disabled={busy || !roomName.trim()} loading={busy} onPress={() => { void createRoom(); }} prefix={<Check size={15} />} size="sm">{isChinese ? '创建' : 'Create'}</NativeButton>
        </View>
      ) : null}
      <View style={styles.body}>
        <FlatList
          contentContainerStyle={[styles.roomRail, compact && styles.roomRailCompact]}
          data={rooms}
          keyExtractor={(room) => room.room_id}
          ListEmptyComponent={<Text style={[styles.muted, { color: tokens.colors.textTertiary }]}>{isChinese ? '还没有群聊' : 'No rooms yet'}</Text>}
          renderItem={({ item: room }) => (
            <IOSPressable accessibilityLabel={`${isChinese ? '打开群聊' : 'Open Group Chat'} ${room.name}`} onPress={() => setActiveRoomId(room.room_id)} style={[styles.roomItem, { backgroundColor: room.room_id === activeRoomId ? multiplyAlpha(tokens.colors.primary, 0.14) : 'transparent', borderColor: room.room_id === activeRoomId ? multiplyAlpha(tokens.colors.primary, 0.36) : tokens.colors.border }]}> 
              <Text numberOfLines={1} style={[styles.roomName, { color: tokens.colors.foreground }]}>{room.name}</Text>
              <Text numberOfLines={1} style={[styles.roomMeta, { color: tokens.colors.textTertiary }]}>{room.members.length} {isChinese ? '成员' : 'members'} · #{room.latest_seq}</Text>
              <Text numberOfLines={2} style={[styles.roomMembers, { color: tokens.colors.textTertiary }]}>{room.members.map(durableMemberLabel).join(' · ')}</Text>
            </IOSPressable>
          )}
          showsVerticalScrollIndicator={false}
          style={[styles.roomRailList, compact && styles.roomRailCompact]}
        />
        <View style={styles.conversation}>
          {activeState ? (
            <>
              <View style={[styles.roomToolbar, { borderBottomColor: tokens.colors.border }]}> 
                <View style={styles.toolbarCopy}><Text numberOfLines={1} style={[styles.activeTitle, { color: tokens.colors.foreground }]}>{activeState.room.name}</Text><Text numberOfLines={1} style={[styles.roomMeta, { color: tokens.colors.textTertiary }]}>{activeState.driver_status.running ? (isChinese ? '运行中' : 'Running') : (isChinese ? '已停止' : 'Stopped')}</Text><Text numberOfLines={2} style={[styles.roomMembers, { color: tokens.colors.textTertiary }]}>{activeState.room.members.map(durableMemberLabel).join(' · ')}</Text></View>
                <IOSPressable accessibilityLabel={isChinese ? '重命名群聊' : 'Rename Group Chat'} disabled={busy} onPress={() => { setRenameValue(activeState.room.name); setRenameOpen(true); }} style={styles.headerIcon}><Pencil color={tokens.colors.textSecondary} size={17} /></IOSPressable>
                <IOSPressable accessibilityLabel={isChinese ? '停止群聊' : 'Stop Group Chat'} disabled={busy} onPress={() => { void stopRoom(); }} style={styles.headerIcon}><CircleStop color={tokens.colors.warning} size={18} /></IOSPressable>
                <IOSPressable accessibilityLabel={isChinese ? '删除群聊' : 'Delete Group Chat'} disabled={busy} onPress={() => setDeleteConfirmOpen(true)} style={styles.headerIcon}><Trash2 color={tokens.colors.destructive} size={18} /></IOSPressable>
              </View>
              {renameOpen ? <View style={[styles.renamePanel, { borderBottomColor: tokens.colors.border }]}><TextInput accessibilityLabel={isChinese ? '新群聊名称' : 'New Group Chat name'} onChangeText={setRenameValue} placeholder={isChinese ? '新群聊名称' : 'New room name'} placeholderTextColor={tokens.colors.textTertiary} style={[styles.renameInput, { borderColor: tokens.colors.border, color: tokens.colors.foreground }]} value={renameValue} /><NativeButton disabled={busy || !renameValue.trim()} loading={busy} onPress={() => { void renameRoom(); }} size="sm">{isChinese ? '保存' : 'Save'}</NativeButton></View> : null}
              <FlatList
                contentContainerStyle={styles.eventList}
                data={events}
                keyExtractor={(event) => `${event.room_id}-${event.seq}`}
                ListEmptyComponent={<Text style={[styles.muted, { color: tokens.colors.textTertiary }]}>{isChinese ? '暂无事件' : 'No events yet'}</Text>}
                ListHeaderComponent={(
                  <View style={styles.eventHeader}>
                    {historyHasMore ? <Text style={[styles.muted, { color: tokens.colors.textTertiary }]}>{isChinese ? '正在加载更早的事件…' : 'Loading more history…'}</Text> : null}
                    {pendingActions.map((action, index) => {
                      const taskId = actionField(action, 'task_id');
                      if (action.kind === 'retry' && taskId) return <NativeButton key={`retry-${taskId}-${index}`} disabled={busy} onPress={() => { void retryTask(taskId); }} prefix={<RotateCcw size={14} />} size="sm">{isChinese ? '重试任务' : 'Retry task'}</NativeButton>;
                      if (action.kind === 'approval' && taskId) return <View key={`approval-${taskId}-${index}`} style={styles.approvalActions}><NativeButton disabled={busy} onPress={() => { void approveTask(action, 'once'); }} prefix={<ShieldCheck size={14} />} size="sm">{isChinese ? '允许一次' : 'Allow once'}</NativeButton><NativeButton destructive disabled={busy} onPress={() => { void approveTask(action, 'deny'); }} size="sm">{isChinese ? '拒绝' : 'Deny'}</NativeButton></View>;
                      return null;
                    })}
                  </View>
                )}
                renderItem={renderEvent}
                showsVerticalScrollIndicator={false}
                style={styles.eventListView}
              />
              <View style={[styles.composer, { borderTopColor: tokens.colors.border, paddingBottom: Math.max(10, insets.bottom) }]}>
                <TextInput accessibilityLabel={isChinese ? '群聊消息' : 'Group Chat message'} multiline onChangeText={setDraft} onSubmitEditing={() => { void sendMessage(); }} placeholder={isChinese ? '发送消息...' : 'Send a message...'} placeholderTextColor={tokens.colors.textTertiary} style={[styles.composerInput, { borderColor: tokens.colors.border, color: tokens.colors.foreground }]} value={draft} />
                <IOSPressable accessibilityLabel={isChinese ? '发送消息' : 'Send message'} disabled={busy || !draft.trim()} onPress={() => { void sendMessage(); }} style={[styles.sendButton, { backgroundColor: tokens.colors.primary }]}><Send color={tokens.colors.background} size={17} /></IOSPressable>
              </View>
            </>
          ) : <View style={styles.empty}><Text style={{ color: tokens.colors.textSecondary }}>{isChinese ? '选择一个群聊' : 'Select a room'}</Text></View>}
        </View>
      </View>
      <ConfirmDialog
        cancelLabel={isChinese ? '取消' : 'Cancel'}
        confirmLabel={isChinese ? '删除' : 'Delete'}
        description={isChinese ? '此操作会停止群聊、撤销跨网关路由并永久写入删除记录。' : 'This stops the room, revokes cross-gateway routes, and writes a permanent deletion record.'}
        destructive
        loading={busy}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => { void deleteRoom(); }}
        open={deleteConfirmOpen}
        title={isChinese ? '删除持久化群聊' : 'Delete durable Group Chat'}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  headerActions: { flexDirection: 'row', gap: 4, marginLeft: 'auto' },
  headerIcon: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
  title: { fontSize: 16, fontWeight: '700' },
  createPanel: { borderBottomWidth: StyleSheet.hairlineWidth, gap: 8, padding: 12 },
  input: { borderRadius: 6, borderWidth: 1, minHeight: 38, paddingHorizontal: 10, paddingVertical: 8 },
  inputHint: { fontSize: 11, lineHeight: 16 },
  gatewayCatalog: { gap: 6 },
  catalogTitle: { fontSize: 11, fontWeight: '600' },
  gatewayChip: { borderRadius: 6, borderWidth: 1, maxWidth: 220, minWidth: 150, paddingHorizontal: 8, paddingVertical: 6 },
  gatewayText: { fontSize: 11, fontWeight: '600' },
  gatewayProfileList: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  gatewayProfileChip: { borderRadius: 6, borderWidth: 1, maxWidth: 190, minHeight: 26, paddingHorizontal: 7, paddingVertical: 4 },
  gatewayProfiles: { fontSize: 10 },
  gatewayReason: { fontSize: 9, lineHeight: 12, marginTop: 5 },
  executionNodeNotice: { fontSize: 10, lineHeight: 14 },
  body: { flex: 1, flexDirection: 'row' },
  roomRailList: { flexGrow: 0, width: 220 },
  roomRail: { gap: 8, padding: 10, width: 220 },
  roomRailCompact: { width: 132 },
  roomItem: { borderRadius: 6, borderWidth: 1, minHeight: 58, padding: 10 },
  roomName: { fontSize: 14, fontWeight: '700' },
  roomMeta: { fontSize: 11, marginTop: 4 },
  roomMembers: { fontSize: 10, lineHeight: 14, marginTop: 4 },
  muted: { fontSize: 13, padding: 10 },
  conversation: { flex: 1, minWidth: 0 },
  roomToolbar: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 2, padding: 10 },
  renamePanel: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, padding: 10 },
  renameInput: { borderRadius: 6, borderWidth: 1, flex: 1, minHeight: 38, paddingHorizontal: 10, paddingVertical: 8 },
  toolbarCopy: { flex: 1, minWidth: 0 },
  activeTitle: { fontSize: 16, fontWeight: '700' },
  eventListView: { flex: 1 },
  eventList: { gap: 8, padding: 12 },
  eventHeader: { gap: 8 },
  approvalActions: { flexDirection: 'row', gap: 8 },
  event: { borderRadius: 6, borderWidth: 1, padding: 10 },
  eventAuthor: { fontSize: 11, fontWeight: '700', marginBottom: 5 },
  eventText: { fontSize: 14, lineHeight: 20 },
  composer: { alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingTop: 10 },
  composerInput: { borderRadius: 6, borderWidth: 1, flex: 1, maxHeight: 110, minHeight: 42, paddingHorizontal: 10, paddingVertical: 9 },
  sendButton: { alignItems: 'center', borderRadius: 6, height: 42, justifyContent: 'center', width: 42 },
  empty: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
});
