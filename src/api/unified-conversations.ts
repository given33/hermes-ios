import { mergeUnifiedConversationIndex } from './conversation-index';
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
  const officialPromise = sessionsApi.getAllProfileSessions(100, signal)
    .then(({ sessions }) => sessions)
    .catch((error: unknown) => {
      if (error instanceof HermesApiError && error.status === 404) {
        return [] as SessionSummary[];
      }
      throw error;
    });
  const [cloud, officialSessions] = await Promise.all([cloudPromise, officialPromise]);
  return {
    conversations: mergeUnifiedConversationIndex(cloud.conversations, officialSessions, profile),
    deleted: cloud.deleted,
  };
}
