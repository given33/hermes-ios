import type {
  HermesStudioGroupChatMessage,
  HermesStudioRoomAgent,
  HermesStudioRoomInfo,
  HermesStudioRoomMember,
  HermesStudioRoomSnapshot,
  HermesStudioPendingApproval,
  HermesStudioRoomSummaryAnchor,
  HermesStudioRoomSummaryState,
} from '../../api/hermes-studio';

export type AgentGroupChatMode = 'single' | 'agent-group';

export type AgentGroupEvent =
  | { type: 'message'; message: HermesStudioGroupChatMessage }
  | { type: 'stream-start'; message: HermesStudioGroupChatMessage }
  | { type: 'stream-delta'; roomId: string; id: string; delta: string }
  | { type: 'reasoning-delta'; roomId: string; id: string; delta: string }
  | { type: 'stream-end'; roomId: string; id: string }
  | { type: 'typing'; roomId: string; name: string }
  | { type: 'stop-typing'; roomId: string; name: string }
  | { type: 'context-status'; roomId: string; name: string; status: string }
  | { type: 'members-updated'; roomId: string; members: HermesStudioRoomMember[] }
  | { type: 'summary-updated'; summary: HermesStudioRoomSummaryState }
  | { type: 'approval-requested'; approval: HermesStudioPendingApproval }
  | { type: 'approval-resolved'; roomId: string; approvalId: string }
  | { type: 'room-cleared'; roomId: string }
  | { type: 'room-updated'; roomId: string; totalTokens?: number; name?: string }
  | { type: 'room-summary-anchor'; roomId: string; anchor: HermesStudioRoomSummaryAnchor | null };

export interface GroupChatDrafts {
  [roomId: string]: string;
}

export function emptyRoomSnapshot(room: HermesStudioRoomInfo): HermesStudioRoomSnapshot {
  return {
    room,
    agents: [],
    members: [],
    messages: [],
    typingNames: [],
    runningAgents: [],
    contextStatuses: {},
    summary: null,
    summaryAnchor: null,
    pendingApprovals: [],
    totalTokens: room.totalTokens,
    connected: false,
    loading: false,
    error: null,
    updatedAt: Date.now(),
  };
}

export function snapshotFromDetail(input: {
  room: HermesStudioRoomInfo;
  agents: HermesStudioRoomAgent[];
  members: HermesStudioRoomMember[];
  messages: HermesStudioGroupChatMessage[];
  connected?: boolean;
  summary?: HermesStudioRoomSummaryState | null;
  summaryAnchor?: HermesStudioRoomSummaryAnchor | null;
}): HermesStudioRoomSnapshot {
  return {
    room: input.room,
    agents: input.agents,
    members: input.members,
    messages: sortMessages(input.messages),
    typingNames: [],
    runningAgents: [],
    contextStatuses: {},
    summary: input.summary ?? null,
    summaryAnchor: input.summaryAnchor ?? null,
    pendingApprovals: [],
    totalTokens: input.room.totalTokens,
    connected: input.connected ?? false,
    loading: false,
    error: null,
    updatedAt: Date.now(),
  };
}

export function applyAgentGroupEvent(
  snapshot: HermesStudioRoomSnapshot,
  event: AgentGroupEvent,
): HermesStudioRoomSnapshot {
  if (!eventBelongsToRoom(event, snapshot.room.id)) return snapshot;
  const next: HermesStudioRoomSnapshot = { ...snapshot, updatedAt: Date.now() };
  switch (event.type) {
    case 'message':
      return { ...next, messages: upsertGroupMessage(next.messages, event.message) };
    case 'stream-start':
      return {
        ...next,
        messages: upsertGroupMessage(next.messages, { ...event.message, isStreaming: true }),
        runningAgents: addUnique(next.runningAgents, event.message.senderName),
      };
    case 'stream-delta':
      return {
        ...next,
        messages: updateGroupMessage(next.messages, event.id, (message) => ({
          ...message,
          content: `${message.content}${event.delta}`,
          isStreaming: true,
          firstSeenAt: message.firstSeenAt || Date.now(),
        }), event.roomId),
      };
    case 'reasoning-delta':
      return {
        ...next,
        messages: updateGroupMessage(next.messages, event.id, (message) => ({
          ...message,
          reasoning: `${message.reasoning || ''}${event.delta}`,
          isStreaming: true,
        }), event.roomId),
      };
    case 'stream-end':
      return {
        ...next,
        messages: updateGroupMessage(next.messages, event.id, (message) => ({
          ...message,
          isStreaming: false,
          finish_reason: message.finish_reason === 'streaming' ? 'stop' : message.finish_reason,
        }), event.roomId),
        runningAgents: next.runningAgents.filter((name) => {
          const message = next.messages.find((candidate) => candidate.id === event.id);
          return !message || name !== message.senderName;
        }),
      };
    case 'typing':
      return { ...next, typingNames: addUnique(next.typingNames, event.name) };
    case 'stop-typing':
      return { ...next, typingNames: next.typingNames.filter((name) => name !== event.name) };
    case 'context-status':
      return {
        ...next,
        contextStatuses: { ...next.contextStatuses, [event.name]: event.status },
        runningAgents: event.status === 'ready' || event.status === 'idle' || event.status === 'error'
          ? next.runningAgents.filter((name) => name !== event.name)
          : addUnique(next.runningAgents, event.name),
      };
    case 'members-updated':
      return { ...next, members: event.members };
    case 'summary-updated':
      return { ...next, summary: event.summary };
    case 'room-summary-anchor':
      return { ...next, summaryAnchor: event.anchor };
    case 'approval-requested':
      return {
        ...next,
        pendingApprovals: next.pendingApprovals.some((item) => item.approvalId === event.approval.approvalId)
          ? next.pendingApprovals
          : [...next.pendingApprovals, event.approval],
      };
    case 'approval-resolved':
      return { ...next, pendingApprovals: next.pendingApprovals.filter((item) => item.approvalId !== event.approvalId) };
    case 'room-cleared':
      return {
        ...next,
        messages: [],
        typingNames: [],
        runningAgents: [],
        contextStatuses: {},
        pendingApprovals: [],
        summary: null,
        summaryAnchor: null,
      };
    case 'room-updated':
      return {
        ...next,
        room: {
          ...next.room,
          ...(event.totalTokens === undefined ? {} : { totalTokens: event.totalTokens }),
          ...(event.name ? { name: event.name } : {}),
        },
        totalTokens: event.totalTokens === undefined ? next.totalTokens : event.totalTokens,
      };
  }
}

export function upsertGroupMessage(
  messages: readonly HermesStudioGroupChatMessage[],
  incoming: HermesStudioGroupChatMessage,
): HermesStudioGroupChatMessage[] {
  const index = messages.findIndex((message) => message.id === incoming.id);
  if (index < 0) return sortMessages([...messages, incoming]);
  const current = messages[index];
  const merged: HermesStudioGroupChatMessage = {
    ...current,
    ...incoming,
    roomId: incoming.roomId || current.roomId,
    content: incoming.content || current.content,
    senderName: incoming.senderName || current.senderName,
    senderId: incoming.senderId || current.senderId,
    reasoning: incoming.reasoning || current.reasoning,
    timestamp: incoming.timestamp || current.timestamp,
  };
  const next = [...messages];
  next[index] = merged;
  return sortMessages(next);
}

export function updateGroupMessage(
  messages: readonly HermesStudioGroupChatMessage[],
  id: string,
  update: (message: HermesStudioGroupChatMessage) => HermesStudioGroupChatMessage,
  roomId: string,
): HermesStudioGroupChatMessage[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) {
    return [...messages, {
      id,
      roomId,
      senderId: '',
      senderName: 'Agent',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      firstSeenAt: Date.now(),
    }];
  }
  const next = [...messages];
  next[index] = update(messages[index]);
  return next;
}

export function roomHasRunningWork(snapshot: HermesStudioRoomSnapshot | undefined): boolean {
  if (!snapshot) return false;
  return snapshot.runningAgents.length > 0 || snapshot.messages.some((message) => message.isStreaming);
}

export function latestRoomPreview(snapshot: HermesStudioRoomSnapshot | undefined): string {
  const message = snapshot?.messages[snapshot.messages.length - 1];
  if (!message) return '';
  return message.content.trim() || (message.isStreaming ? '…' : '');
}

export function addUnique(values: readonly string[], value: string): string[] {
  const normalized = value.trim();
  return normalized && !values.includes(normalized) ? [...values, normalized] : [...values];
}

function eventBelongsToRoom(event: AgentGroupEvent, roomId: string): boolean {
  if (event.type === 'message' || event.type === 'stream-start') return event.message.roomId === roomId;
  if (event.type === 'summary-updated') return event.summary.roomId === roomId;
  if (event.type === 'approval-requested') return event.approval.roomId === roomId;
  return event.roomId === roomId;
}

function sortMessages(messages: HermesStudioGroupChatMessage[]): HermesStudioGroupChatMessage[] {
  return [...messages].sort((left, right) => {
    const timestampDelta = left.timestamp - right.timestamp;
    return timestampDelta || left.id.localeCompare(right.id);
  });
}
