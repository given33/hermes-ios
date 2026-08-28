import type { HermesCloudApi } from '../HermesCloudApi';
import { conversationSessionSummary } from '../conversation-summary';
import type { JsonRecord } from './transport';

type RouteApi = Pick<
  HermesCloudApi,
  | 'getAchievements'
  | 'getAllAccountFiles'
  | 'getAnalytics'
  | 'getChannels'
  | 'getCollaborationProfiles'
  | 'getCollaborationRoom'
  | 'getCollaborationRooms'
  | 'getConfig'
  | 'getCronJobs'
  | 'getEnvironment'
  | 'getBots'
  | 'getLogs'
  | 'getMcp'
  | 'getModelCredentials'
  | 'getModels'
  | 'getAuxiliaryModels'
  | 'getMoaModels'
  | 'getCustomProviderEndpoints'
  | 'getPairing'
  | 'getPlugins'
  | 'getProfiles'
  | 'getRuntimeRun'
  | 'getRuntimeRuns'
  | 'getSkillContent'
  | 'getSkills'
  | 'getSystem'
  | 'getHealth'
  | 'getEgressStatus'
  | 'checkHermesUpdate'
  | 'getHermesUpdateReceipt'
  | 'getUnifiedConversations'
  | 'getWebhooks'
  | 'getWorkflow'
  | 'getWorkflowHealth'
  | 'getWorkflowRuns'
  | 'getWorkflowWorkspaceChange'
  | 'getWorkflowWorkspaceChanges'
  | 'getWorkflows'
  | 'getWriteApproval'
  | 'getWriteApprovals'
  | 'getKanbanBoard'
  | 'getMemoryStatus'
>;

/** Resolve one native management route from canonical domain APIs. */
export async function loadCloudRoute(
  api: RouteApi,
  routeId: string,
  profile = 'default',
  selectedId = '',
): Promise<unknown> {
  switch (routeId) {
    case 'sessions': {
      const result = await api.getUnifiedConversations(profile);
      const sessions = result.conversations.map(conversationSessionSummary);
      return { sessions, total: sessions.length, limit: sessions.length, offset: 0 };
    }
    case 'files': return api.getAllAccountFiles();
    case 'analytics': return api.getAnalytics(30, profile);
    case 'models': {
      const [models, auxiliary, moa, customEndpoints] = await Promise.all([
        api.getModels(profile),
        api.getAuxiliaryModels(profile).catch(() => ({})),
        api.getMoaModels(profile).catch(() => ({})),
        api.getCustomProviderEndpoints(profile).catch(() => ({})),
      ]);
      return { ...models, auxiliary, moa, customEndpoints };
    }
    case 'logs': return api.getLogs();
    case 'cron': return api.getCronJobs(profile);
    case 'skills': {
      const skills = await api.getSkills(profile);
      if (!selectedId) return skills;
      const selected = await api.getSkillContent(selectedId, profile);
      return { ...skills, selectedId, selectedContent: selected };
    }
    case 'plugins': return api.getPlugins();
    case 'mcp': return api.getMcp(profile);
    case 'pairing': return api.getPairing();
    case 'channels': return api.getChannels(profile);
    case 'webhooks': return api.getWebhooks();
    case 'profiles':
    case 'profile-new': return api.getProfiles();
    case 'bots': return api.getBots();
    case 'config': return api.getConfig(profile);
    // `/api/model/credentials` was retired upstream.  Environment secrets are
    // now exposed by the canonical `/api/env` route, which also includes
    // catalog metadata and profile scoping.  Keep the route on that source of
    // truth so the native page does not render an empty/stale credential list.
    case 'env': return api.getEnvironment(profile);
    case 'system': {
      const [system, health, egress, updateCheck, updateReceipt] = await Promise.all([
        api.getSystem(),
        api.getHealth().catch(() => ({})),
        api.getEgressStatus().catch(() => ({})),
        api.checkHermesUpdate().catch(() => ({})),
        api.getHermesUpdateReceipt().catch(() => ({})),
      ]);
      return { ...system, health, egress, updateCheck, updateReceipt };
    }
    case 'memory': return api.getMemoryStatus();
    case 'achievements': return api.getAchievements();
    case 'kanban': return api.getKanbanBoard();
    case 'collaboration': {
      const [rooms, profiles] = await Promise.all([
        api.getCollaborationRooms(),
        api.getCollaborationProfiles(),
      ]);
      const fallbackId = rooms.rooms.find((room) => typeof room.id === 'string')?.id;
      const roomId = selectedId || (typeof fallbackId === 'string' ? fallbackId : '');
      const selected = roomId ? await api.getCollaborationRoom(roomId) : { room: null };
      return { ...rooms, ...profiles, ...selected };
    }
    case 'workflows': {
      const [catalog, runs] = await Promise.all([
        api.getWorkflows(profile),
        api.getWorkflowRuns(profile),
      ]);
      const health = await api.getWorkflowHealth().catch(() => undefined);
      const selected = selectedId ? await api.getWorkflow(selectedId, profile) : {};
      const runRows = Array.isArray(runs.runs) ? runs.runs : [];
      const selectedRun = runRows.find((entry) => (
        isJsonRecord(entry) && entry.definition_id === selectedId
      ));
      const runId = isJsonRecord(selectedRun) && typeof selectedRun.id === 'string'
        ? selectedRun.id
        : '';
      const workspaceChanges = runId
        ? await api.getWorkflowWorkspaceChanges(runId, profile)
        : { change_sets: [], workspace_audits: [] };
      const latestChangeSet = workspaceChanges.change_sets[0];
      const selectedChangeSet = runId && latestChangeSet?.id
        ? await api.getWorkflowWorkspaceChange(runId, latestChangeSet.id, profile)
        : {};
      return {
        ...catalog,
        ...runs,
        ...(health ? { health } : {}),
        selected_definition: selected,
        workspace_changes: workspaceChanges,
        selected_change_set: selectedChangeSet,
      };
    }
    case 'approvals': {
      const list = await api.getWriteApprovals(profile);
      const selected = selectedId ? await api.getWriteApproval(selectedId, profile) : {};
      return { ...list, ...selected };
    }
    case 'runtime-center': {
      const list = await api.getRuntimeRuns(profile);
      const selected = selectedId ? await api.getRuntimeRun(selectedId, profile) : {};
      return { ...list, selected_run: selected };
    }
    default: return {};
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
