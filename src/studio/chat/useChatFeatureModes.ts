import { useCallback, useMemo, useState } from 'react';

import type { HermesApiClient } from '../../api/HermesApiClient';
import type { SingleConversation } from '../../api/HermesCloudApi';
import {
  latestRoomPreview,
  roomHasRunningWork,
  sortRoomInfosByActivity,
} from '../agent-group/agent-group-model';
import { useAgentGroupChatController } from '../agent-group/useAgentGroupChatController';
import type { ConversationHistoryItem } from './ConversationHistory';
import type { ChatMode } from './ChatHeader';
import { useCodingPiController } from '../coding-pi/useCodingPiController';
import { useCodingPiCollabController } from '../coding-pi/useCodingPiCollabController';
import { useHermesStudioWorkflowHistory } from '../workflows/useHermesStudioWorkflowHistory';

export interface ChatFeatureModes {
  activeHistoryId: string;
  agentGroupController: ReturnType<typeof useAgentGroupChatController>;
  codingPiController: ReturnType<typeof useCodingPiController>;
  codingPiCollabController: ReturnType<typeof useCodingPiCollabController>;
  chatMode: ChatMode;
  historyConversations: ConversationHistoryItem[];
  workflowHistory: ReturnType<typeof useHermesStudioWorkflowHistory>;
  setChatMode: (mode: ChatMode) => void;
  refreshUnifiedHistory(): void;
  deleteHistoryItems(ids: readonly string[]): Promise<void>;
  selectHistoryItem(item: ConversationHistoryItem): void;
}

/** Keeps the three chat-adjacent surfaces independent while sharing one history entry point. */
export function useChatFeatureModes({
  activeConversationId,
  cacheOwner,
  client,
  conversations,
  deleteConversations,
  fixtureMode,
  isChinese,
  navigate,
  notify,
  profile,
  refreshConversationHistory,
  selectConversation,
}: {
  activeConversationId: string;
  cacheOwner: string;
  client?: HermesApiClient;
  conversations: SingleConversation[];
  deleteConversations(ids: readonly string[]): Promise<void>;
  fixtureMode: boolean;
  isChinese: boolean;
  navigate?(path: string): void;
  notify(message: string): void;
  profile: string;
  refreshConversationHistory(): void;
  selectConversation(id: string): Promise<void> | void;
}): ChatFeatureModes {
  const [chatMode, setChatMode] = useState<ChatMode>('single');
  const agentRoomCacheRevision = useMemo(() => conversations
    .filter((conversation) => (
      conversation.source === 'collaboration_room'
      || conversation.id.startsWith('chat_room_')
    ))
    .map((conversation) => [
      conversation.id,
      conversation.updated_at || 0,
      conversation.message_count || 0,
      conversation.messages.length,
    ].join(':'))
    .join('|'), [conversations]);
  const agentGroupController = useAgentGroupChatController({
    agentProfile: profile,
    cacheOwner,
    cacheRevision: agentRoomCacheRevision,
    client,
    // Do not open the group Socket.IO channel while the user is in ordinary
    // single-chat mode.  Apart from wasting radio/battery, the room joins and
    // history requests compete with the official hosted enqueue/SSE path and
    // make the click-to-thinking metric noisy.  The hook remains mounted so a
    // mode switch can enable the real controller without conditionally calling
    // React hooks.
    enabled: fixtureMode || chatMode === 'agent-group',
    fixtureMode,
    isChinese,
    notify,
  });
  const workflowHistory = useHermesStudioWorkflowHistory({
    client,
    // Workflow history is an optional index, not part of the single-chat
    // critical path.  It is explicitly refreshed from the history action;
    // fixture mode keeps the preview deterministic.
    enabled: fixtureMode,
    fixtureMode,
    profile,
  });
  const codingPiController = useCodingPiController({
    cacheOwner,
    client,
    // Pi performs config/session discovery (and may perform LAN discovery if
    // its configured origin is unavailable).  Keep that work out of the
    // normal single-chat mount and enable it only when Coding mode is active.
    enabled: fixtureMode || chatMode === 'coding',
    fixtureMode,
    notify,
    profile,
  });
  const codingPiCollabController = useCodingPiCollabController({
    currentCollab: codingPiController.activeSession?.collab,
    ownerScope: cacheOwner,
  });

  const historyConversations = useMemo<ConversationHistoryItem[]>(() => {
    const roomConversationIds = new Set(
      agentGroupController.rooms
        .map((room) => room.conversationId)
        .filter((id): id is string => Boolean(id)),
    );
    const chatItems = conversations
      .filter((conversation) => (
        conversation.source !== 'collaboration_room'
        && !roomConversationIds.has(conversation.id)
        && !conversation.id.startsWith('chat_room_')
      ))
      .map((conversation) => ({
      ...conversation,
      historyKind: 'chat' as const,
      sourceId: conversation.id,
      }));
    const roomSnapshots = new Map(
      agentGroupController.roomSnapshots.map((snapshot) => [snapshot.room.id, snapshot]),
    );
    const groupItems = sortRoomInfosByActivity(agentGroupController.rooms, roomSnapshots).map((room) => {
      const snapshot = roomSnapshots.get(room.id);
      return {
        id: `agent-group:${room.id}`,
        title: room.name,
        profile: 'Hermes Studio',
        messages: [],
        preview: snapshot ? latestRoomPreview(snapshot) : '',
        updated_at: snapshot?.updatedAt || 0,
        historyKind: 'agent-group' as const,
        historyLabel: isChinese ? 'Agent group' : 'Agent group',
        sourceId: room.id,
        active: roomHasRunningWork(snapshot),
        deletable: true,
      };
    });
    const workflowItems = workflowHistory.items.map((item) => ({
      id: item.id,
      title: item.title,
      profile: item.profile,
      messages: [],
      preview: item.preview,
      updated_at: item.updatedAt,
      historyKind: 'workflow' as const,
      historyLabel: isChinese ? 'Workflow' : 'Workflow',
      sourceId: item.workflowId,
      status: item.status,
      active: item.status === 'running' || item.status === 'queued',
      deletable: false,
    }));
    const codingItems = codingPiController.sessions.map((session) => ({
      id: `coding:${session.id}`,
      title: session.title || 'Coding session',
      profile: 'Pi',
      official_model: session.model || 'oh-my-pi',
      messages: [],
      preview: session.preview,
      updated_at: session.updated_at,
      historyKind: 'coding' as const,
      historyLabel: 'Coding · Pi',
      sourceId: session.id,
      status: session.status,
      active: session.status === 'running',
      deletable: false,
    }));
    return [...chatItems, ...groupItems, ...workflowItems, ...codingItems];
  }, [agentGroupController.roomSnapshots, agentGroupController.rooms, codingPiController.sessions, conversations, isChinese, workflowHistory.items]);

  const activeHistoryId = chatMode === 'agent-group' && agentGroupController.activeRoomId
    ? `agent-group:${agentGroupController.activeRoomId}`
    : chatMode === 'coding' && codingPiController.activeSessionId
      ? `coding:${codingPiController.activeSessionId}`
      : activeConversationId;

  const refreshUnifiedHistory = useCallback(() => {
    refreshConversationHistory();
    void agentGroupController.refresh(true);
    void workflowHistory.refresh();
    void codingPiController.refresh();
  }, [agentGroupController, codingPiController, refreshConversationHistory, workflowHistory]);

  const deleteHistoryItems = useCallback(async (ids: readonly string[]) => {
    const chatIds = ids.filter((id) => (
      !id.startsWith('agent-group:')
      && !id.startsWith('workflow-run:')
      && !id.startsWith('coding:')
    ));
    if (chatIds.length) await deleteConversations(chatIds);
    await Promise.all(ids
      .filter((id) => id.startsWith('agent-group:'))
      .map((id) => agentGroupController.deleteRoom(id.slice('agent-group:'.length))));
  }, [agentGroupController, deleteConversations]);

  const selectHistoryItem = useCallback((item: ConversationHistoryItem) => {
    if (item.historyKind === 'agent-group') {
      setChatMode('agent-group');
      agentGroupController.selectRoom(item.sourceId || item.id.replace('agent-group:', ''));
      return;
    }
    if (item.historyKind === 'workflow') {
      navigate?.('/workflows');
      return;
    }
    if (item.historyKind === 'coding') {
      setChatMode('coding');
      codingPiController.selectSession(item.sourceId || item.id.replace('coding:', ''));
      return;
    }
    setChatMode('single');
    void selectConversation(item.sourceId || item.id);
  }, [agentGroupController, codingPiController, navigate, selectConversation]);

  return {
    activeHistoryId,
    agentGroupController,
    codingPiController,
    codingPiCollabController,
    chatMode,
    historyConversations,
    workflowHistory,
    setChatMode,
    refreshUnifiedHistory,
    deleteHistoryItems,
    selectHistoryItem,
  };
}
