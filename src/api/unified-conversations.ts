import { mergeUnifiedConversationIndex } from './conversation-index';
import { officialConversationPlaceholderId } from './conversation-identifiers';
import { HermesApiError } from './HermesApiClient';
import type { SessionSummary } from './cloud/contracts';
import type { HermesConversationsCloudApi } from './cloud/conversations';
import type { HermesSessionsCloudApi } from './cloud/sessions';

/**
 * Compose the account conversation index with Hermes' official all-profile
 * session history for the native Sessions/chat surfaces.
 */
export async function loadUnifiedConversations(
  conversationsApi: HermesConversationsCloudApi,
  sessionsApi: HermesSessionsCloudApi,
  profile = 'default',
  signal?: AbortSignal,
) {
  const cloudPromise = conversationsApi.getUnifiedConversations(profile, signal);
  const officialPromise = sessionsApi.getAllProfileSessions(100, signal, 'dashboard-group,kanban,tool')
    .then(({ sessions }) => sessions)
    .catch((error: unknown) => {
      if (error instanceof HermesApiError && error.status === 404) {
        return [] as SessionSummary[];
      }
      throw error;
    });
  const [cloud, officialSessions] = await Promise.all([cloudPromise, officialPromise]);
  const conversations = mergeUnifiedConversationIndex(cloud.conversations, officialSessions, profile);
  const visibleIds = new Set(conversations.map(item => item.id));
  return {
    conversations,
    superseded: [
      ...cloud.conversations.map(item => item.id),
      ...officialSessions.flatMap(item => [officialConversationPlaceholderId(item.profile || profile, item.id), `official:${item.id}`]),
    ].filter(id => !visibleIds.has(id)),
    deleted: cloud.deleted,
  };
}
