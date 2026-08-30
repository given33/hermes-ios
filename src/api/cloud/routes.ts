import type { HermesCloudApi } from '../HermesCloudApi';
import { conversationSessionSummary } from '../conversation-summary';
import type { JsonRecord } from './transport';
import { isRecord } from '../../app/route-snapshots/support';

type RouteApi = Pick<
  HermesCloudApi,
  | 'getAchievements'
  | 'getAchievementScanStatus'
  | 'getRecentAchievementUnlocks'
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
  | 'getBotAsset'
  | 'getBotRelayRoster'
  | 'getBotPetGallery'
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
  | 'getKanbanBoards'
  | 'getKanbanStats'
  | 'getKanbanAssignees'
  | 'getKanbanActiveWorkers'
  | 'getKanbanDiagnostics'
  | 'getKanbanConfig'
  | 'getKanbanModelOptions'
  | 'getKanbanProfiles'
  | 'getKanbanOrchestration'
  | 'getMemoryStatus'
  | 'getDefaultCwd'
  | 'getGitRoot'
  | 'getGitStatus'
  | 'getGitBranches'
  | 'getGitBaseBranches'
  | 'getGitWorktrees'
  | 'getGitReviewList'
  | 'getGitShipInfo'
  | 'getGitReviewDiff'
  | 'getGitGhAuth'
  | 'getGitFileDiff'
  | 'getGitCommitContext'
  | 'getGitRevParse'
  | 'listGitPullRequests'
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
    case 'files': return api.getAllAccountFiles({ limit: 50, offset: 0 });
    case 'git': {
      // The official Git API is path-based because a Hermes server may expose
      // more than one workspace.  Start at the server's canonical cwd and
      // resolve its repository root before loading the review projections.
      const cwdResult = await api.getDefaultCwd().catch(() => ({}));
      const cwd = isRecord(cwdResult) && typeof cwdResult.cwd === 'string' ? cwdResult.cwd : '';
      const rootResult = await api.getGitRoot(cwd).catch(() => ({}));
      const root = isRecord(rootResult) && typeof rootResult.root === 'string' ? rootResult.root : '';
      const path = root || cwd;
      if (!path) return { cwd, root, branch: '', status: {}, branches: {}, baseBranches: {}, worktrees: {}, review: {}, shipInfo: {} };
      const [status, branches, baseBranches, worktrees, review, shipInfo, ghAuth, commitContext, revParse, pullRequests] = await Promise.all([
        api.getGitStatus(path).catch(() => ({})),
        api.getGitBranches(path).catch(() => ({})),
        api.getGitBaseBranches(path).catch(() => ({})),
        api.getGitWorktrees(path).catch(() => ({})),
        api.getGitReviewList(path).catch(() => ({})),
        api.getGitShipInfo(path).catch(() => ({})),
        api.getGitGhAuth(false).catch(() => ({})),
        api.getGitCommitContext(path).catch(() => ({})),
        api.getGitRevParse(path).catch(() => ({})),
        api.listGitPullRequests(path).catch(() => ({})),
      ]);
      const branch = isRecord(status) && typeof status.branch === 'string'
        ? status.branch
        : isRecord(status) && typeof status.current_branch === 'string' ? status.current_branch : '';
      let diff: unknown;
      let fileDiff: unknown;
      if (selectedId) {
        [diff, fileDiff] = await Promise.all([
          api.getGitReviewDiff(path, selectedId).catch(() => undefined),
          api.getGitFileDiff(path, selectedId).catch(() => undefined),
        ]);
      }
      return { cwd, root: path, branch, status, branches, baseBranches, worktrees, review, shipInfo, ghAuth, commitContext, revParse, pullRequests, ...(diff !== undefined ? { diff, selectedFile: selectedId } : {}), ...(fileDiff !== undefined ? { fileDiff } : {}) };
    }
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
    case 'bots': {
      const [roster, relay, petGallery] = await Promise.all([
        api.getBots(),
        typeof api.getBotRelayRoster === 'function'
          ? api.getBotRelayRoster().catch(() => undefined)
          : Promise.resolve(undefined),
        typeof api.getBotPetGallery === 'function'
          ? api.getBotPetGallery().catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      // Avatar bytes are fetched through the official asset endpoint only for
      // rows that advertise an asset. Keep the route snapshot bounded so a
      // large roster cannot stall the native bridge; the dedicated asset API
      // remains available for full-resolution consumers.
      if (!isRecord(roster) || !Array.isArray(roster.profiles)) return relay || petGallery
        ? { ...roster, ...(relay ? { bot_relay: relay } : {}), ...(petGallery ? { bot_pet_gallery: petGallery } : {}) }
        : roster;
      const profiles = await Promise.all(roster.profiles.map(async (entry) => {
        if (!isRecord(entry) || entry.has_avatar !== true || typeof entry.name !== 'string') return entry;
        try {
          const asset = await api.getBotAsset(entry.name, 'avatar');
          const data = isRecord(asset) && typeof asset.data === 'string' ? asset.data : '';
          return data.length > 700_000 ? { ...entry, bot_avatar_data: '' } : { ...entry, bot_avatar_data: data };
        } catch {
          return entry;
        }
      }));
      // Petdex currently contains 4,500+ entries. Keep the native route
      // snapshot bounded; the dedicated gallery API remains available when a
      // future picker needs paging/search instead of loading the whole catalog.
      const boundedPetGallery = isRecord(petGallery) && Array.isArray(petGallery.pets)
        ? { ...petGallery, pets: petGallery.pets.slice(0, 96) }
        : petGallery;
      // Bot Mode's desktop Routines pane follows the selected bot rather than
      // the launch profile. Hydrate the same official cron store for every
      // advertised profile so iOS can present the equivalent per-bot view and
      // send mutations with an explicit profile scope. Keep both the profile
      // count and each job list bounded; the dedicated /cron route remains the
      // full-fidelity surface for large installations.
      const routineRows = typeof api.getCronJobs === 'function' ? await Promise.all(profiles
        .filter((entry): entry is JsonRecord => isRecord(entry) && typeof entry.name === 'string')
        .slice(0, 32)
        .map(async (entry) => {
          const name = String(entry.name).trim();
          if (!name) return null;
          const jobs = await api.getCronJobs(name).catch(() => []);
          return [name, Array.isArray(jobs) ? jobs.slice(0, 128) : []] as const;
        })) : [];
      const botRoutines = Object.fromEntries(routineRows.filter((row): row is readonly [string, JsonRecord[]] => row !== null));
      return {
        ...roster,
        profiles,
        ...(relay ? { bot_relay: relay } : {}),
        ...(boundedPetGallery ? { bot_pet_gallery: boundedPetGallery } : {}),
        bot_routines: botRoutines,
      };
    }
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
    case 'memory': return api.getMemoryStatus(profile);
    case 'achievements': {
      const achievements = await api.getAchievements();
      const optional = async <T>(loader: (() => Promise<T>) | undefined): Promise<T | undefined> => {
        if (typeof loader !== 'function') return undefined;
        try { return await loader(); } catch { return undefined; }
      };
      const [scanStatus, recentUnlocks] = await Promise.all([
        optional(api.getAchievementScanStatus?.bind(api)),
        optional(api.getRecentAchievementUnlocks?.bind(api)),
      ]);
      return {
        ...((isRecord(achievements) ? achievements : {}) as JsonRecord),
        ...(scanStatus ? { scan_status: scanStatus } : {}),
        ...(recentUnlocks ? { recent_unlocks: recentUnlocks } : {}),
      };
    }
    case 'kanban': {
      // Keep the board route useful on older Hermes servers while hydrating
      // every official Kanban projection that the native client can render.
      // Each auxiliary projection is best-effort: a server that predates a
      // route still returns its board instead of making the whole tab fail.
      const board = await api.getKanbanBoard();
      const optional = async <T>(loader: (() => Promise<T>) | undefined): Promise<T | undefined> => {
        if (typeof loader !== 'function') return undefined;
        try { return await loader(); } catch { return undefined; }
      };
      const [boards, stats, assignees, workers, diagnostics, config, modelOptions, profiles, orchestration] = await Promise.all([
        optional(api.getKanbanBoards?.bind(api)),
        optional(api.getKanbanStats?.bind(api)),
        optional(api.getKanbanAssignees?.bind(api)),
        optional(api.getKanbanActiveWorkers?.bind(api)),
        optional(api.getKanbanDiagnostics?.bind(api)),
        optional(api.getKanbanConfig?.bind(api)),
        optional(api.getKanbanModelOptions?.bind(api)),
        optional(api.getKanbanProfiles?.bind(api)),
        optional(api.getKanbanOrchestration?.bind(api)),
      ]);
      return {
        ...((isRecord(board) ? board : {}) as JsonRecord),
        ...(boards ? { boards } : {}),
        ...(stats ? { stats } : {}),
        ...(assignees ? { assignees_catalog: assignees } : {}),
        ...(workers ? { workers } : {}),
        ...(diagnostics ? { diagnostics } : {}),
        ...(config ? { config } : {}),
        ...(modelOptions ? { model_options: modelOptions } : {}),
        ...(profiles ? { profile_catalog: profiles } : {}),
        ...(orchestration ? { orchestration } : {}),
      };
    }
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
