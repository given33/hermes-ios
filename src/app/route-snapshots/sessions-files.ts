import type {
  HermesSwiftUIFileSnapshot,
  HermesSwiftUIRouteSnapshot,
  HermesSwiftUISessionContextSnapshot,
  HermesSwiftUISessionSnapshot,
} from '../swiftui-route-contract';
import { HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION } from '../swiftui-route-contract';
import type {
  AccountFileEntry,
  ConversationSessionState,
  SingleConversation,
} from '../../api/HermesCloudApi';
import { conversationSessionSummary } from '../../api/HermesCloudApi';
import {
  formatBytes,
  formatTimestamp,
  isAccountFileEntry,
  isConversationSessionState,
  isRecord,
  isSessionSummary,
  numberValue,
  routeLocalizer,
  type HermesRouteLocaleInput,
  type HermesRouteLocalizer,
} from './support';

export function sessionsSnapshot(
  source: unknown,
  localizer: HermesRouteLocalizer,
): HermesSwiftUISessionSnapshot[] {
  if (!isRecord(source) || !Array.isArray(source.sessions)) return [];
  return source.sessions
    .filter(isSessionSummary)
    .map((session) => ({
      id: session.id,
      title: session.title?.trim() || session.preview?.trim()
        || localizer.choose('未命名会话', 'Untitled session'),
      model: session.model?.trim() || 'Hermes',
      date: formatTimestamp(session.last_active || session.started_at),
      running: session.is_active,
      profile: session.profile?.trim() || undefined,
      detail: localizer.choose(
        `${session.message_count} 条消息 · ${session.tool_call_count} 次工具调用`,
        `${session.message_count} messages · ${session.tool_call_count} tool calls`,
      ),
    }));
}

export function createHermesSwiftUISessionsSnapshot(
  source: unknown,
  locale: HermesRouteLocaleInput = 'zh',
): HermesSwiftUIRouteSnapshot {
  const localizer = routeLocalizer(locale);
  const sessionState = isRecord(source) && isConversationSessionState(source.sessionState)
    ? source.sessionState
    : undefined;
  return {
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: 'sessions',
    sessions: sessionsSnapshot(source, localizer),
    sessionContext: sessionState ? sessionContextSnapshot(sessionState) : undefined,
  };
}

/** Project the owner-scoped device cache without exposing Studio room rows. */
export function createHermesSwiftUISessionsSnapshotFromConversations(
  conversations: readonly SingleConversation[],
  pendingDeletionIds: ReadonlySet<string>,
  locale: HermesRouteLocaleInput = 'zh',
  sessionState?: ConversationSessionState,
): HermesSwiftUIRouteSnapshot {
  const sessions = conversations
    .filter((conversation) => (
      !pendingDeletionIds.has(conversation.id)
      && conversation.source !== 'collaboration_room'
      && !conversation.id.startsWith('chat_room_')
    ))
    .map(conversationSessionSummary);
  return createHermesSwiftUISessionsSnapshot({ sessions, sessionState }, locale);
}

function sessionContextSnapshot(
  state: ConversationSessionState,
): HermesSwiftUISessionContextSnapshot {
  const currentId = state.lineage.current_session_id || state.session_id;
  return {
    conversationId: state.conversation_id,
    sessionId: state.session_id,
    profile: state.profile,
    model: state.context.model?.trim() || 'Hermes',
    activeMessages: state.context.active_messages,
    archivedMessages: state.context.archived_messages,
    messageTokens: state.context.message_tokens,
    inputTokens: state.context.input_tokens,
    outputTokens: state.context.output_tokens,
    cacheReadTokens: state.context.cache_read_tokens,
    cacheWriteTokens: state.context.cache_write_tokens,
    reasoningTokens: state.context.reasoning_tokens,
    compressionLineage: state.context.compression_lineage,
    compressionCount: state.context.compression_count,
    compressionInProgress: state.context.compression_in_progress,
    parentCount: state.lineage.edges.filter(({ child_id }) => child_id === currentId).length,
    childCount: state.lineage.edges.filter(({ parent_id }) => parent_id === currentId).length,
    lineage: state.lineage.sessions.map((session) => ({
      id: session.id,
      title: session.title?.trim() || session.id,
      parentSessionId: session.parent_session_id?.trim() || undefined,
      source: session.source?.trim() || '',
      model: session.model?.trim() || 'Hermes',
      startedAt: session.started_at || undefined,
      endedAt: session.ended_at || undefined,
      messageCount: session.message_count || 0,
      toolCallCount: session.tool_call_count || 0,
      current: session.id === currentId,
    })),
    branchableMessages: state.branchable_messages.map((message) => ({
      messageId: message.message_id,
      role: message.role,
      runtimeSessionId: message.runtime_session_id,
      runtimeMessageId: message.runtime_message_id,
    })),
  };
}

export function filesSnapshot(
  source: unknown,
  localizer: HermesRouteLocalizer,
): HermesSwiftUIFileSnapshot[] {
  if (!isRecord(source) || !Array.isArray(source.files)) return [];
  return source.files
    .filter(isAccountFileEntry)
    .map((entry) => accountFileSnapshot(entry, localizer));
}

function accountFileSnapshot(
  entry: AccountFileEntry,
  localizer: HermesRouteLocalizer,
): HermesSwiftUIFileSnapshot {
  const createdAt = numberValue(entry.created_at);
  const sourceLabel = entry.source === 'model_output'
    ? localizer.choose('模型生成', 'Model output')
    : localizer.choose('用户上传', 'User upload');
  const statusLabel = {
    available: localizer.choose('可用', 'Available'),
    failed: localizer.choose('失败', 'Failed'),
    uploading: localizer.choose('上传中', 'Uploading'),
  }[entry.status];
  return {
    createdAt,
    dateLabel: formatFileDate(createdAt, localizer),
    detail: `${sourceLabel} · ${formatBytes(entry.size)} · ${statusLabel}`,
    fileType: entry.file_type,
    folder: false,
    id: entry.id,
    mimeType: entry.mime_type,
    name: entry.name,
    size: entry.size,
    source: entry.source,
    status: entry.status,
  };
}

function formatFileDate(timestamp: number, localizer: HermesRouteLocalizer): string {
  if (!timestamp) return localizer.choose('未知日期', 'Unknown date');
  return new Intl.DateTimeFormat(localizer.locale === 'zh' ? 'zh-CN' : 'en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp));
}
