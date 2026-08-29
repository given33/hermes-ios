import { officialConversationPlaceholderId } from './conversation-identifiers';
import type { SessionSummary, SingleConversation } from './HermesCloudApi';

/** Merge account conversations with unmapped official Hermes sessions. */
export function mergeUnifiedConversationIndex(
  conversations: readonly SingleConversation[],
  officialSessions: readonly SessionSummary[],
  profile = 'default',
): SingleConversation[] {
  const mappedSessionIds = new Set<string>();
  for (const conversation of conversations) {
    if (conversation.official_session_id) {
      mappedSessionIds.add(
        `${conversation.official_profile || conversation.profile || profile}:${conversation.official_session_id}`,
      );
    }
    for (const [sessionProfile, sessionId] of Object.entries(conversation.runtime_sessions || {})) {
      if (sessionId) mappedSessionIds.add(`${sessionProfile}:${sessionId}`);
    }
  }
  const officialConversations = officialSessions.flatMap((session): SingleConversation[] => {
    const sessionProfile = session.profile?.trim() || profile;
    if (!session.id || mappedSessionIds.has(`${sessionProfile}:${session.id}`)) return [];
    return [{
      id: officialConversationPlaceholderId(sessionProfile, session.id),
      profile: sessionProfile,
      title: session.title?.trim() || session.preview?.trim() || '官方会话',
      messages: [],
      message_count: Math.max(0, numberValue(session.message_count)),
      runtime_sessions: {},
      created_at: secondsToMilliseconds(session.started_at),
      updated_at: secondsToMilliseconds(session.last_active || session.started_at),
      official_session_id: session.id,
      official_profile: sessionProfile,
      official_model: session.model || undefined,
      preview: session.preview || undefined,
      ...(session.archived !== undefined ? { archived: session.archived === true } : {}),
      ...(session.pinned !== undefined ? { pinned: session.pinned === true } : {}),
      ...(session.unread !== undefined ? { unread: session.unread === true } : {}),
    }];
  });
  return [...conversations, ...officialConversations].sort(
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
