import { officialConversationPlaceholderId } from './conversation-identifiers';
import type { SessionSummary, SingleConversation } from './HermesCloudApi';

/** Merge account conversations with unmapped official Hermes sessions. */
export function mergeUnifiedConversationIndex(
  conversations: readonly SingleConversation[],
  officialSessions: readonly SessionSummary[],
  profile = 'default',
): SingleConversation[] {
  const mappedSessionIds = new Set<string>();
  const mappedRuntimeAliases = new Set<string>();
  for (const conversation of conversations) {
    if (conversation.id.startsWith('official:')) continue;
    if (conversation.official_session_id) {
      mappedSessionIds.add(
        `${conversation.official_profile || conversation.profile || profile}:${conversation.official_session_id}`,
      );
    }
    for (const [sessionProfile, sessionId] of Object.entries(conversation.runtime_sessions || {})) {
      if (sessionId) {
        mappedSessionIds.add(`${sessionProfile}:${sessionId}`);
      }
    }
    for (const [sessionProfile, sessionId] of Object.entries(conversation.runtime_session_aliases || {})) {
      if (sessionId) mappedRuntimeAliases.add(`${sessionProfile}:${sessionId}`);
    }
  }
  const officialConversations = officialSessions.flatMap((session): SingleConversation[] => {
    const sessionProfile = session.profile?.trim() || profile;
    if (!session.id || mappedSessionIds.has(`${sessionProfile}:${session.id}`)
      || mappedRuntimeAliases.has(`${sessionProfile}:${session.id}`)) return [];
    const runtime = ['dashboard-group', 'kanban', 'tool'].includes(session.source || '');
    if (runtime) return [];
    const wrappedTitle = /^(Planning behavior:|You are |你仍可使用该 Profile)/i.test(session.title || '');
    return [{
      id: officialConversationPlaceholderId(sessionProfile, session.id),
      profile: sessionProfile,
      title: wrappedTitle ? '成员执行记录' : session.title?.trim() || session.preview?.trim() || '历史会话',
      source: session.source || undefined,
      history_category: runtime ? 'runtime' : 'chat',
      messages: [],
      message_count: Math.max(0, numberValue(session.message_count)),
      runtime_sessions: {},
      created_at: secondsToMilliseconds(session.started_at),
      updated_at: secondsToMilliseconds(session.last_active || session.started_at),
      official_session_id: session.id,
      official_profile: sessionProfile,
      official_model: session.model || undefined,
      preview: wrappedTitle ? undefined : session.preview || undefined,
      ...(session.archived !== undefined ? { archived: session.archived === true } : {}),
      ...(session.pinned !== undefined ? { pinned: session.pinned === true } : {}),
      ...(session.unread !== undefined ? { unread: session.unread === true } : {}),
    }];
  });
  const canonical = conversations.filter((conversation) => {
    if (conversation.id.startsWith('official:') && (['dashboard-group', 'kanban', 'tool'].includes(conversation.source || '')
      || /^(Planning behavior:|You are |你仍可使用该 Profile)/i.test(conversation.title))) return false;
    if (conversation.id.startsWith('official:') && conversation.official_session_id) {
      const sessionProfile = conversation.official_profile || conversation.profile;
      return !mappedSessionIds.has(`${sessionProfile}:${conversation.official_session_id}`)
        && !mappedRuntimeAliases.has(`${sessionProfile}:${conversation.official_session_id}`);
    }
    return !conversation.profile?.startsWith('acct-') || !Object.entries(conversation.runtime_sessions || {})
      .some(([profile, id]) => mappedRuntimeAliases.has(`${profile}:${id}`));
  });
  return [...canonical, ...officialConversations].filter((item, index, all) =>
    all.findIndex((other) => other.id === item.id) === index).sort(
    (left, right) => numberValue(right.updated_at) - numberValue(left.updated_at),
  );
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function secondsToMilliseconds(value: unknown): number {
  const number = numberValue(value);
  if (!number) return 0;
  return number < 10_000_000_000 ? number * 1000 : number;
}
