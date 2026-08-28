import type { HermesCloudApi } from '../../api/HermesCloudApi';
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

export function parseSessionImport(raw: string): JsonRecord[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is JsonRecord => typeof item === 'object' && item !== null && !Array.isArray(item)) : [];
  } catch { return []; }
}
