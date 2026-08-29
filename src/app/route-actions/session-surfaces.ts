import type { HermesCloudApi } from '../../api/HermesCloudApi';
import { parseOfficialConversationPlaceholderId } from '../../api/conversation-identifiers';
import type { JsonRecord } from '../../api/cloud/transport';

export async function loadSessionSurfaceMetadata(
  api: HermesCloudApi,
  profile: string,
  sessionIds: readonly string[],
): Promise<{ sidebar?: JsonRecord; projects?: JsonRecord; pullRequests?: JsonRecord; stats?: JsonRecord }> {
  const optional = <T>(run: (() => Promise<T>) | undefined): Promise<T | undefined> =>
    run ? run().catch(() => undefined) : Promise.resolve(undefined);
  const [sidebar, projects, pullRequests, stats] = await Promise.all([
    optional(typeof api.getProfileSessionsSidebar === 'function' ? () => api.getProfileSessionsSidebar({ profile }) : undefined),
    optional(typeof api.getProfileProjectsTree === 'function' ? () => api.getProfileProjectsTree() : undefined),
    optional(sessionIds.length && typeof api.scanProfileSessionPullRequests === 'function' ? () => api.scanProfileSessionPullRequests([...sessionIds]) : undefined),
    optional(typeof api.getSessionStats === 'function' ? () => api.getSessionStats(profile) : undefined),
  ]);
  return { sidebar, projects, pullRequests, stats };
}

export function parseSessionIDs(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];
  if (!value.startsWith('[')) return value.split(',').map((id) => id.trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
  } catch { return []; }
}

/**
 * Convert an iOS-visible official-session placeholder into the runtime
 * session id and owning profile expected by `/api/sessions/*`.
 *
 * The unified Sessions route intentionally uses opaque `official:v3:*`
 * identifiers so a profile/session pair cannot collide in the local cache.
 * Those identifiers are a UI envelope, not a backend session id; sending one
 * verbatim makes archive/pin/unread/export return 404. Legacy `official:*`
 * ids remain readable for older cached rows.
 */
export function resolveSessionActionTarget(
  id: string,
  fallbackProfile = 'default',
): { id: string; profile: string; official: boolean } {
  const normalizedId = id.trim();
  const normalizedProfile = fallbackProfile.trim() || 'default';
  if (!normalizedId.startsWith('official:')) {
    return { id: normalizedId, profile: normalizedProfile, official: false };
  }
  const placeholder = parseOfficialConversationPlaceholderId(normalizedId);
  return {
    id: (placeholder?.sessionId || normalizedId.slice('official:'.length)).trim(),
    profile: (placeholder?.profile || normalizedProfile).trim() || normalizedProfile,
    official: true,
  };
}

/** Delete a mixed unified-index selection through its owning store. */
export async function deleteUnifiedSessionSelection(
  api: HermesCloudApi,
  ids: readonly string[],
  fallbackProfile = 'default',
): Promise<void> {
  const groups = new Map<string, string[]>();
  const conversations: string[] = [];
  for (const rawId of ids) {
    const target = resolveSessionActionTarget(rawId, fallbackProfile);
    if (!target.official) {
      conversations.push(rawId);
      continue;
    }
    const group = groups.get(target.profile) || [];
    group.push(target.id);
    groups.set(target.profile, group);
  }
  for (const [targetProfile, sessionIds] of groups) {
    await api.bulkDeleteSessions(sessionIds, targetProfile);
  }
  for (const conversationId of conversations) {
    await api.deleteConversation(conversationId);
  }
}

export async function updateUnifiedSessionFlag(
  api: HermesCloudApi,
  id: string,
  kind: 'archived' | 'pinned' | 'unread',
  enabled: boolean,
  fallbackProfile = 'default',
): Promise<void> {
  const target = resolveSessionActionTarget(id, fallbackProfile);
  if (!target.official) {
    if (kind === 'archived') await api.setConversationArchived(id, enabled);
    else if (kind === 'pinned') await api.setConversationPinned(id, enabled);
    else await api.setConversationUnread(id, enabled);
    return;
  }
  if (kind === 'archived') await api.setSessionArchived(target.id, enabled, target.profile);
  else if (kind === 'pinned') await api.setSessionPinned(target.id, enabled, target.profile);
  else await api.setSessionUnread(target.id, enabled, target.profile);
}

export function parseSessionImport(raw: string): JsonRecord[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is JsonRecord => typeof item === 'object' && item !== null && !Array.isArray(item)) : [];
  } catch { return []; }
}
