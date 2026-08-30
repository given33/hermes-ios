import type {
  HermesSwiftUIRouteActionEvent,
  HermesSwiftUIRouteSnapshot,
} from './swiftui-route-contract';
import {
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
} from './swiftui-route-contract';
import { HermesCloudApi, parseOfficialConversationPlaceholderId } from '../api/HermesCloudApi';
import {
  isRecord,
  isStringRecord,
  parseJsonRecord,
  positiveRevision,
  routeLocalizer,
  stringValue,
  type HermesRouteLocaleInput,
} from './route-snapshots/support';
import {
  createHermesSwiftUISessionsSnapshot,
  createHermesSwiftUISessionsSnapshotFromConversations,
  sessionsSnapshot,
} from './route-snapshots/sessions-files';
import {
  analyticsSnapshot,
  approvalsSnapshot,
  runtimeSnapshot,
  workflowsSnapshot,
} from './route-snapshots/workflows';
import {
  achievementsSnapshot,
  collaborationSnapshot,
  configSnapshot,
  cronSnapshot,
  environmentSnapshot,
  integrationsSnapshot,
  kanbanSnapshot,
  logsSnapshot,
  managedInstallationsSnapshot,
  pairingSnapshot,
  profilesSnapshot,
  skillsSnapshot,
  toolsetsSnapshot,
} from './route-snapshots/management';
import { decodeModelSelection, encodeModelSelection } from './route-snapshots/model-selection';
import { customModelConfiguration, customModelOperationError, modelsSnapshot } from './route-snapshots/models';
import { systemSnapshot } from './route-snapshots/system';
import { memorySnapshot } from './route-snapshots/memory';
import { gitSnapshot } from './route-snapshots/git';
import { fileImportUploadId, fileNameFromUri, operationShareUrls, presentAccountFile, presentBackup, presentConversationExport, presentProfileExport, presentSessionExport, presentSkillContent, removeStagedFileImport } from './route-actions/presentation';
import { performManagedFilesAction } from './route-actions/managed-files';
import { loadAccountFilesPage, loadAccountFilesRouteFields } from './route-actions/account-files-page';
import { resolveGitPath } from './route-actions/git';
import { deleteUnifiedSessionSelection, loadSessionSurfaceMetadata, parseSessionIDs, parseSessionImport, resolveSessionActionTarget, updateUnifiedSessionFlag } from './route-actions/session-surfaces';
import { configureBot, describeBot, generateBotAvatar, selectBotPet, sendBotRelay, uploadBotAvatar } from './route-actions/bot-mode';
import { performChannelOnboardingAction } from './route-actions/channel-onboarding';
import { performKanbanAction } from './route-actions/kanban';
import { mcpServersDocument, replaceMcpServers } from './route-actions/mcp-editor';
import { performModelAdminAction } from './route-actions/model-admin';
import { hydrateToolsetConfigs, loadCronMetadata, loadLearningMetadata, loadModelProviderMetadata, loadSkillHubMetadata, loadToolRuntimeMetadata } from './route-loaders/remote-metadata'; // Account previews use temporaryPlaintextFile(name, 'account-file') and consumeAccountFile(... writeBoundedDownload) through presentation.ts.
export type { HermesRouteLocale, HermesRouteLocaleInput } from './route-snapshots/support';
export {
  createHermesSwiftUISessionsSnapshot,
  createHermesSwiftUISessionsSnapshotFromConversations,
} from './route-snapshots/sessions-files';
export { decodeModelSelection, encodeModelSelection } from './route-snapshots/model-selection';
export async function loadHermesSwiftUIRouteSnapshot(
  api: HermesCloudApi,
  routeId: string,
  profile: string,
  selectedId = '',
  locale: HermesRouteLocaleInput = 'zh',
): Promise<HermesSwiftUIRouteSnapshot> {
  const localizer = routeLocalizer(locale);
  const source = await api.loadRoute(routeId, profile, selectedId);
  const base = {
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: routeId,
  } as const;
  switch (routeId) {
    case 'sessions': {
      const sessions = sessionsSnapshot(source, localizer);
      const selected = sessions.find(({ id }) => id === selectedId);
      const sessionState = selected && !selectedId.startsWith('official:')
        ? await api.getConversationSessionState(selectedId, selected?.profile || profile)
        : undefined;
      // Keep the native session page on the same official data surfaces as
      // desktop. These are optional so older gateways remain decodable.
      const sessionIds = sessions.map(({ id }) => id).filter((id) => id && !id.startsWith('official:'));
      const metadata = await loadSessionSurfaceMetadata(api, profile, sessionIds);
      return createHermesSwiftUISessionsSnapshot({
        sessions: isRecord(source) ? source.sessions : [],
        sessionState,
      }, locale, metadata);
    }
    case 'files': return { ...base, ...await loadAccountFilesRouteFields(api, source, locale) };
    case 'git': {
      const root = isRecord(source) ? source : {};
      return {
        ...base,
        git: gitSnapshot(
          root,
          stringValue(root.cwd),
          stringValue(root.root) || stringValue(root.cwd),
          stringValue(root.branch),
          selectedId,
        ),
      };
    }
    case 'workflows':
      return { ...base, workflows: workflowsSnapshot(source, selectedId) };
    case 'approvals':
      return { ...base, approvals: approvalsSnapshot(source, selectedId) };
    case 'runtime-center':
      return { ...base, runtime: runtimeSnapshot(source, selectedId) };
    case 'analytics':
      return { ...base, analytics: analyticsSnapshot(source) };
    case 'models': {
      const root = isRecord(source) ? source : {};
      const auxiliary = isRecord(root.auxiliary) ? root.auxiliary : {};
      const moa = isRecord(root.moa) ? root.moa : {};
      const presets = isRecord(moa.presets) ? moa.presets : {};
      const tasks = Array.isArray(auxiliary.tasks) ? auxiliary.tasks : [];
      return {
        ...base,
        models: modelsSnapshot(source),
        modelAuxiliary: {
          active: isRecord(auxiliary.main) ? stringValue(auxiliary.main.model) : '',
          tasks: tasks.filter(isRecord).map((task) => ({
            task: stringValue(task.task), provider: stringValue(task.provider), model: stringValue(task.model),
          })),
        },
        modelMoa: {
          enabled: moa.enabled === true || (isRecord(moa.active_preset) && moa.active_preset.enabled === true),
          activePreset: stringValue(moa.active_preset) || stringValue(moa.activePreset) || stringValue(moa.default_preset),
          presetCount: Object.keys(presets).length,
        },
        modelMoaJSON: JSON.stringify(moa),
        ...await loadModelProviderMetadata(api, profile),
      };
    }
    case 'logs':
      return { ...base, logs: logsSnapshot(source, localizer) };
    case 'cron': return { ...base, cron: cronSnapshot(source, localizer), ...await loadCronMetadata(api, profile, source) };
    case 'skills': {
      const hydratedToolsets = await hydrateToolsetConfigs(api, toolsetsSnapshot(source, localizer), profile); const runtimeMetadata = await loadToolRuntimeMetadata(api, profile); const skillHubMetadata = await loadSkillHubMetadata(api, profile); const learningMetadata = await loadLearningMetadata(api, profile);
      return {
        ...base,
        skills: skillsSnapshot(source, localizer),
        toolsets: hydratedToolsets,
        ...runtimeMetadata,
        ...skillHubMetadata,
        ...learningMetadata,
        installations: managedInstallationsSnapshot(source, 'skill'),
      };
    }
    case 'plugins':
      return { ...base, integrations: integrationsSnapshot(source, 'plugins', localizer) };
    case 'mcp': {
      const config = typeof api.getConfig === 'function'
        ? await api.getConfig(profile).catch(() => undefined)
        : undefined;
      return {
        ...base,
        integrations: integrationsSnapshot(source, 'mcp', localizer),
        installations: managedInstallationsSnapshot(source, 'mcp'),
        ...(config !== undefined ? { mcpServersJSON: mcpServersDocument(config) } : {}),
      };
    }
    case 'channels':
      return { ...base, integrations: integrationsSnapshot(source, 'channels', localizer) };
    case 'webhooks':
      return { ...base, integrations: integrationsSnapshot(source, 'webhooks', localizer) };
    case 'pairing':
      return { ...base, pairing: pairingSnapshot(source, localizer) };
    case 'achievements':
      return { ...base, achievements: achievementsSnapshot(source, localizer) };
    case 'collaboration':
      return { ...base, collaboration: collaborationSnapshot(source) };
    case 'kanban': return { ...base, kanban: kanbanSnapshot(source, localizer), kanbanMetaJSON: isRecord(source) ? JSON.stringify({ boards: source.boards, stats: source.stats, assignees_catalog: source.assignees_catalog, workers: source.workers, diagnostics: source.diagnostics, config: source.config, model_options: source.model_options, profile_catalog: source.profile_catalog, orchestration: source.orchestration }) : undefined };
    case 'profiles':
    case 'profile-new':
      return { ...base, profiles: profilesSnapshot(source, localizer) };
    case 'bots': { const relay = isRecord(source) && isRecord(source.bot_relay) ? source.bot_relay : undefined; const pets = isRecord(source) && isRecord(source.bot_pet_gallery) ? source.bot_pet_gallery : undefined; const routines = isRecord(source) && isRecord(source.bot_routines) ? source.bot_routines : undefined; const normalizedRoutines = routines ? Object.fromEntries(Object.entries(routines).map(([owner, jobs]) => [owner, cronSnapshot(jobs, localizer)])) : undefined; return { ...base, profiles: profilesSnapshot(source, localizer), ...(relay ? { botRelayJSON: JSON.stringify(relay) } : {}), ...(pets ? { botPetJSON: JSON.stringify(pets) } : {}), ...(normalizedRoutines ? { botRoutinesJSON: JSON.stringify(normalizedRoutines) } : {}) }; }
    case 'config':
      return { ...base, config: configSnapshot(source) };
    case 'env':
      return { ...base, environment: environmentSnapshot(source) };
    case 'system': {
      const curator = typeof api.getCurator === 'function'
        ? await api.getCurator().catch(() => undefined)
        : undefined;
      const hooks = typeof api.getHooks === 'function'
        ? await api.getHooks().catch(() => undefined)
        : undefined;
      return { ...base, systemHooksJSON: hooks ? JSON.stringify(hooks) : undefined, system: systemSnapshot(
        isRecord(source) && curator !== undefined ? { ...source, curator } : source,
        localizer,
      ) };
    }
    case 'memory': {
      const providers = isRecord(source) && Array.isArray(source.providers) ? source.providers : [];
      const providerRows = providers.filter(isRecord);
      const [oauthStatuses, providerConfigs] = await Promise.all([
        Promise.all(providerRows.map((provider) => (
          typeof api.getMemoryProviderOAuthStatus === 'function'
            ? api.getMemoryProviderOAuthStatus(stringValue(provider.name), profile).catch(() => undefined)
            : Promise.resolve(undefined)
        ))),
        Promise.all(providerRows.map((provider) => (
          typeof api.getMemoryProviderConfig === 'function'
            ? api.getMemoryProviderConfig(stringValue(provider.name), profile, 'declared').catch(() => undefined)
            : Promise.resolve(undefined)
        ))),
      ]);
      return { ...base, memory: memorySnapshot(source, oauthStatuses, providerConfigs) };
    }
    default:
      return base;
  }
}

export async function performHermesSwiftUIRouteAction(
  api: HermesCloudApi,
  event: HermesSwiftUIRouteActionEvent,
  profile: string,
  locale: HermesRouteLocaleInput = 'zh',
): Promise<'reload' | 'none' | {
  confirmMessage?: string;
  confirmRequired?: boolean;
  detectedModels?: readonly string[];
  message: string;
  model?: string;
  provider?: string;
  reload?: boolean;
  channelOnboardingJSON?: string;
  skillHubResultJSON?: string;
  url?: string;
  flowId?: string;
  oauthProvider?: string;
  oauthSessionId?: string;
  accountFilesJSON?: string;
  managedFilesJSON?: string;
  kanbanDetailJSON?: string;
}> {
  const localizer = routeLocalizer(locale);
  const chinese = localizer.isChinese;
  const { action, payload } = event;
  const value = payload.value?.trim() || payload.name?.trim() || '';
  const modelAdminResult = await performModelAdminAction(api, action, payload, profile, chinese);
  if (modelAdminResult !== undefined) return modelAdminResult;
  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.fileQuery) {
    if (payload.route !== 'files') return 'none';
    const page = await loadAccountFilesPage(api, payload, locale);
    return { accountFilesJSON: JSON.stringify(page), message: '' };
  }
  const managedFilesResult = await performManagedFilesAction(api, event);
  if (managedFilesResult !== undefined) return managedFilesResult;
  const kanbanResult = await performKanbanAction(api, action, payload, profile, chinese);
  if (kanbanResult !== undefined) return kanbanResult;
  switch (action) {
    case HERMES_SWIFTUI_ROUTE_ACTIONS.refresh:
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionDelete:
      if (!payload.id) return 'none';
      if (payload.id.startsWith('official:')) {
        const placeholder = parseOfficialConversationPlaceholderId(payload.id);
        await api.deleteSession(
          placeholder?.sessionId || payload.id.slice('official:'.length),
          placeholder?.profile || payload.fields?.profile || profile,
        );
      } else {
        await api.deleteConversation(payload.id);
      }
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionRename:
      if (!payload.id || !value) return 'none';
      if (payload.id.startsWith('official:')) {
        const placeholder = parseOfficialConversationPlaceholderId(payload.id);
      await api.renameSession(
          placeholder?.sessionId || payload.id.slice('official:'.length),
          value,
          placeholder?.profile || payload.fields?.profile || profile,
        );
      } else {
        await api.renameConversation(payload.id, value);
      }
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionCompress:
      if (!payload.id || payload.id.startsWith('official:')) return 'none';
      await api.compressConversation(payload.id, {
        focusTopic: payload.detail || '',
        idempotencyKey: payload.requestId || `ios-compress-${Date.now().toString(36)}-${payload.id}`,
        profile: payload.fields?.profile || profile,
      });
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionFork:
      // Branching from the account conversation endpoint creates both the
      // runtime child session and its visible iOS conversation record. The
      // low-level /mobile/sessions/{id}/fork API remains available on the
      // facade for callers that already own a runtime session, but this UI
      // action must preserve the conversation list invariant.
      if (!payload.id || !payload.detail || payload.id.startsWith('official:')) return 'none';
      await api.forkConversationFromMessage(payload.id, payload.detail, {
        idempotencyKey: payload.requestId
          || `ios-fork-${Date.now().toString(36)}-${payload.detail}`,
        profile: payload.fields?.profile || profile,
        title: payload.value || payload.name || '',
      });
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.fileDelete:
      if (!payload.id) return 'none';
      await api.deleteAccountFile(payload.id);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.fileImport:
      for (const [index, uri] of (payload.uris || []).entries()) {
        const name = fileNameFromUri(uri);
        try {
          await api.uploadAccountFile(
            { name, uri },
            fileImportUploadId(payload.requestId, uri, index),
          );
        } finally {
          if (payload.fields?.stagedImport === 'true') {
            await removeStagedFileImport(uri);
          }
        }
      }
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.fileDownload:
      if (!payload.id) return 'none';
      await presentAccountFile(
        api,
        payload.id,
        payload.name || fileNameFromUri(payload.id),
        false,
      );
      return 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.fileShare:
      if (!payload.id) return 'none';
      await presentAccountFile(
        api,
        payload.id,
        payload.name || fileNameFromUri(payload.id),
        true,
      );
      return 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.fileSelect:
      return 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitRefresh:
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitSelect:
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitStage: {
      if (!payload.id) return 'none';
      await api.stageGitFile(await resolveGitPath(api, payload.fields?.path), payload.id);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitUnstage: {
      if (!payload.id) return 'none';
      await api.unstageGitFile(await resolveGitPath(api, payload.fields?.path), payload.id);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitRevert: {
      if (!payload.id) return 'none';
      await api.revertGitFile(await resolveGitPath(api, payload.fields?.path), payload.id);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitCommit: {
      const message = payload.detail?.trim() || value;
      if (!message) return 'none';
      await api.commitGit(await resolveGitPath(api, payload.fields?.path), message, false);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitPush:
      await api.pushGit(await resolveGitPath(api, payload.fields?.path));
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitSwitchBranch:
      if (!value) return 'none';
      await api.switchGitBranch(await resolveGitPath(api, payload.fields?.path), value);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitGhAuth: {
      const result = await api.getGitGhAuth(true);
      return { message: JSON.stringify(result) };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitFileDiff: {
      if (!payload.id) return 'none';
      const result = await api.getGitFileDiff(await resolveGitPath(api, payload.fields?.path), payload.id);
      return { message: JSON.stringify(result) };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitCommitContext: {
      const result = await api.getGitCommitContext(await resolveGitPath(api, payload.fields?.path));
      return { message: JSON.stringify(result) };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitRevParse: {
      const result = await api.getGitRevParse(await resolveGitPath(api, payload.fields?.path), value);
      return { message: JSON.stringify(result) };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitPullRequests: {
      const result = await api.listGitPullRequests(await resolveGitPath(api, payload.fields?.path));
      return { message: JSON.stringify(result) };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitCreatePR: {
      const result = await api.createGitPullRequest(await resolveGitPath(api, payload.fields?.path));
      return { message: JSON.stringify(result) };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitAddWorktree: {
      const options = payload.detail ? parseJsonRecord(payload.detail) : payload.fields;
      const result = await api.addGitWorktree(await resolveGitPath(api, payload.fields?.path), options || {});
      return { message: JSON.stringify(result), reload: true };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.gitRemoveWorktree: {
      if (!payload.id) return 'none';
      const result = await api.removeGitWorktree(
        await resolveGitPath(api, payload.fields?.path),
        payload.id,
        payload.enabled === true,
      );
      return { message: JSON.stringify(result), reload: true };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.folderCreate:
      if (!value) return 'none';
      await api.createDirectory(value);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.modelSelect: {
      const selection = decodeModelSelection(payload.id || payload.value || '');
      if (!selection) return 'none';
      const result = await api.setModel(
        selection.provider,
        selection.model,
        profile,
        payload.fields?.confirmExpensiveModel === 'true',
      );
      if (result?.confirmRequired) {
        return {
          confirmMessage: result.confirmMessage || 'This model has unusually high known pricing.',
          confirmRequired: true,
          message: '',
          model: result.model,
          provider: result.provider,
        };
      }
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.modelSelectCancel:
      return 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.modelDiscover: {
      const fields = payload.fields || {};
      const result = await api.discoverCustomModels(
        fields.baseUrl || '',
        fields.apiKey || '',
        profile,
      );
      if (!result.ok) {
        throw new Error(customModelOperationError(
          chinese ? '模型检测' : 'Model detection',
          result,
          localizer,
        ));
      }
      return {
        detectedModels: result.models,
        message: chinese
          ? `检测到 ${result.models.length} 个可用模型（${result.latency_ms} ms）`
          : `Detected ${result.models.length} available models (${result.latency_ms} ms)`,
      };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.modelSave:
      await api.saveCustomModel(customModelConfiguration(payload.fields), profile);
      return { message: chinese ? '模型配置已保存' : 'Model configuration saved', reload: true };
    case HERMES_SWIFTUI_ROUTE_ACTIONS.modelTest: {
      const result = await api.testCustomModel(customModelConfiguration(payload.fields), profile);
      if (!result.ok || !result.reachable) {
        throw new Error(customModelOperationError(
          chinese ? '连接测试' : 'Connection test',
          result,
          localizer,
        ));
      }
      return {
        message: chinese
          ? `连接成功（HTTP ${result.status}，${result.latency_ms} ms）`
          : `Connection succeeded (HTTP ${result.status}, ${result.latency_ms} ms)`,
      };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.cronCreate:
      await api.createCronJob({
        name: payload.name || 'Hermes job',
        prompt: payload.detail || payload.value || '',
        schedule: payload.fields?.schedule || payload.value || '0 * * * *',
        enabled: payload.enabled ?? true,
      }, payload.fields?.profile || profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.cronUpdate: { if (!payload.id) return 'none'; const updates = payload.detail ? parseJsonRecord(payload.detail) : payload.fields; if (!updates || Object.keys(updates).length === 0) return 'none'; await api.updateCronJob(payload.id, updates, payload.fields?.profile || profile); return 'reload'; }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.cronToggle:
      if (!payload.id || payload.enabled === undefined) return 'none';
      await api.setCronJobPaused(payload.id, !payload.enabled, payload.fields?.profile || profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.cronRun:
      if (!payload.id) return 'none';
      await api.triggerCronJob(payload.id, payload.fields?.profile || profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionArchive:
      if (!payload.id || payload.enabled === undefined) return 'none'; await updateUnifiedSessionFlag(api, payload.id, 'archived', payload.enabled, payload.fields?.profile || profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionPin:
      if (!payload.id || payload.enabled === undefined) return 'none'; await updateUnifiedSessionFlag(api, payload.id, 'pinned', payload.enabled, payload.fields?.profile || profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionUnread:
      if (!payload.id || payload.enabled === undefined) return 'none'; await updateUnifiedSessionFlag(api, payload.id, 'unread', payload.enabled, payload.fields?.profile || profile); return 'reload';
    // The helper dispatches to api.bulkDeleteSessions/api.deleteConversation by store.
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionBulkDelete: { const ids = parseSessionIDs(payload.fields?.ids || payload.detail || payload.value || ''); if (!ids.length) return 'none'; await deleteUnifiedSessionSelection(api, ids, payload.fields?.profile || profile); return 'reload'; }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionImport: { const parsed = payload.detail || payload.value || payload.fields?.sessions || ''; if (!parsed) return 'none'; const records = parseSessionImport(parsed); if (!records.length) return 'none'; await api.importSessions(records, payload.fields?.profile || profile); return 'reload'; }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionProjects:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionPullRequests:
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.cronBlueprintCreate:
      if (!payload.id) return 'none'; { const values = payload.fields?.values ? parseJsonRecord(payload.fields.values) || {} : payload.fields || {}; await api.instantiateCronBlueprint(payload.id, values, payload.fields?.profile || profile); return 'reload'; }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.cronDelete:
      if (!payload.id) return 'none';
      await api.deleteCronJob(payload.id, payload.fields?.profile || profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.skillCreate:
      if (!payload.name || !payload.detail) return 'none';
      await api.createSkill(
        payload.name,
        payload.detail,
        payload.value || '',
        profile,
      );
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.skillToggle:
      if (!payload.id || payload.enabled === undefined) return 'none';
      await api.toggleSkill(payload.id, payload.enabled, profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.skillView:
      if (!payload.id) return 'none';
      await presentSkillContent(api, payload.id, profile);
      return 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.skillUpdate:
      if (!payload.id) return 'none';
      await api.updateSkillContent(payload.id, payload.detail || '', profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.skillHubUpdate:
      await api.updateSkillsHub(profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.skillHubSearch: { const result = await api.searchSkillHub(value, payload.fields?.source || 'all', Number(payload.fields?.limit || 20), profile); return { message: chinese ? 'SkillHub 搜索完成' : 'SkillHub search complete', skillHubResultJSON: JSON.stringify(result) }; }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.skillHubPreview: { if (!value) return 'none'; const result = await api.previewSkillHub(value, profile); return { message: chinese ? 'SkillHub 预览已加载' : 'SkillHub preview loaded', skillHubResultJSON: JSON.stringify(result) }; }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.skillHubScan: { if (!value) return 'none'; const result = await api.scanSkillHub(value, profile); return { message: chinese ? 'SkillHub 安全扫描完成' : 'SkillHub security scan complete', skillHubResultJSON: JSON.stringify(result) }; }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.skillHubInstall:
      if (!value) return 'none'; await api.installSkillHub(value, profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.skillHubUninstall:
      if (!value) return 'none'; await api.uninstallSkillHub(value, profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.learningGraphRefresh:
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.installationRollback:
      if (!payload.id) return 'none';
      await api.rollbackManagedInstallation(
        payload.id,
        payload.requestId || `ios-rollback-${payload.id}-${Date.now().toString(36)}`,
      );
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.pluginRescan:
      await api.rescanPlugins();
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.pluginInstall:
      if (!payload.name && !payload.id) return 'none';
      await api.installPlugin(payload.name || payload.id || '', {
        force: payload.fields?.force === 'true',
        enable: payload.fields?.enable !== 'false',
      });
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.pluginUpdate:
      if (!payload.id) return 'none';
      await api.updatePlugin(payload.id);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.pluginDelete:
      if (!payload.id) return 'none';
      await api.removePlugin(payload.id);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.pluginVisibility:
      if (!payload.id || payload.enabled === undefined) return 'none';
      await api.setPluginVisibility(payload.id, !payload.enabled);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.achievementsRescan:
      await api.rescanAchievements();
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.integrationToggle:
      if (!payload.id || payload.enabled === undefined) return 'none';
      if (payload.route === 'plugins') {
        await api.setPluginEnabled(payload.id, payload.enabled);
      } else if (payload.route === 'mcp') {
        await api.setMcpServerEnabled(payload.id, payload.enabled, profile);
      } else if (payload.route === 'webhooks') {
        await api.setWebhookEnabled(payload.id, payload.enabled);
      } else {
        await api.updateChannel(payload.id, { enabled: payload.enabled }, profile);
      }
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.integrationDelete:
      if (!payload.id) return 'none';
      if (payload.route === 'mcp') await api.removeMcpServer(payload.id, profile);
      else if (payload.route === 'webhooks') await api.deleteWebhook(payload.id);
      return payload.route === 'mcp' || payload.route === 'webhooks' ? 'reload' : 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.mcpTest: {
      if (!payload.id || payload.route !== 'mcp') return 'none';
      const result = await api.testMcpServer(payload.id, profile);
      if (!result.ok) throw new Error(result.error || (chinese ? 'MCP 连接测试失败' : 'MCP connection test failed'));
      return { message: chinese ? `连接成功：${result.tools.length} 个工具` : `Connection succeeded: ${result.tools.length} tools` };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.mcpAuth: {
      if (!payload.id || payload.route !== 'mcp') return 'none'; const flow = await api.authMcpServer(payload.id, profile);
      const url = stringValue(flow.authorization_url) || stringValue(flow.url);
      const flowId = stringValue(flow.flow_id) || stringValue(flow.flowId);
      return { message: url ? `${chinese ? '请在浏览器完成 MCP OAuth：' : 'Complete MCP OAuth in your browser: '} ${url}` : (chinese ? 'MCP OAuth 已启动' : 'MCP OAuth started'), url, flowId };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.mcpReplace:
      if (payload.route !== 'mcp') return 'none';
      await replaceMcpServers(api, payload.detail || payload.value || '', profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.integrationUpdate:
      if (!payload.id || payload.route !== 'channels') return 'none';
      {
        const update = payload.value ? parseJsonRecord(payload.value) : payload.fields;
        if (!update) return 'none';
        await api.updateChannel(payload.id, update, profile);
      }
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.channelOnboardingStart:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.channelOnboardingRefresh:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.channelOnboardingApply:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.channelOnboardingCancel:
      return performChannelOnboardingAction(api, action, payload, profile, chinese);
    case HERMES_SWIFTUI_ROUTE_ACTIONS.integrationCreate:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.mcpCatalogInstall:
      if (payload.route === 'mcp') {
        const catalogName = payload.fields?.catalogName?.trim()
          || (action === HERMES_SWIFTUI_ROUTE_ACTIONS.mcpCatalogInstall
            ? payload.id?.trim() || payload.name?.trim() || value
            : '');
        if (catalogName) {
          const env = parseJsonRecord(payload.fields?.env || '{}');
          const result = await api.installMcpCatalogEntry(catalogName, env && isStringRecord(env) ? env : {}, payload.fields?.enable !== 'false', profile);
          return { message: result.background ? (chinese ? 'MCP 正在后台安装' : 'MCP installation started in the background') : (chinese ? 'MCP 已安装' : 'MCP installed'), reload: true };
        }
        await api.addMcpServer({ name: payload.name || 'mcp-server', ...(payload.fields || {}) }, profile);
        return 'reload';
      }
      if (payload.route === 'webhooks') {
        await api.createWebhook({ name: payload.name || 'webhook', ...(payload.fields || {}) });
        return 'reload';
      }
      return 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.pairingApprove:
      if (!payload.id || !value) return 'none';
      await api.approvePairing(payload.id, value);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.pairingRevoke:
      if (!payload.id || !value) return 'none';
      await api.revokePairing(payload.id, value);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.pairingClearPending:
      await api.clearPendingPairing();
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileActivate:
      if (!payload.id && !value) return 'none';
      await api.setActiveProfile(payload.id || value);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileCreate:
      await api.createProfile(
        { name: payload.name || value || 'profile', ...(payload.fields || {}) },
        payload.route === 'bots',
      );
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileDelete:
      if (!payload.id) return 'none';
      await api.deleteProfile(payload.id, payload.route === 'bots');
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.botMetaUpdate: { if (payload.route !== 'bots' || !payload.id || typeof api.updateBotMeta !== 'function') return 'none'; const patch = parseJsonRecord(payload.detail || payload.value || payload.fields?.meta || '{}'); if (!patch) return 'none'; await api.updateBotMeta(payload.id, patch); return 'reload'; }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.botProfileDescribe: return payload.route === 'bots' && payload.id ? describeBot(api, payload.id, chinese) : 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.botProfileConfigure: return payload.route === 'bots' && payload.id ? configureBot(api, payload.id, payload.detail || payload.value || '{}', chinese) : 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.botAvatarUpload: return payload.route === 'bots' && payload.id ? uploadBotAvatar(api, payload.id, payload.detail || payload.value || '') : 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.botAvatarGenerate: return payload.route === 'bots' && payload.id ? generateBotAvatar(api, payload.id, payload.detail || payload.value || '', chinese) : 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.botAvatarClear:
      if (payload.route !== 'bots' || !payload.id) return 'none';
      await api.clearBotAsset(payload.id, 'avatar');
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.botPetSelect: return payload.route === 'bots' && payload.id ? selectBotPet(api, payload.id, payload.targetId || payload.value || '', payload.detail || '', chinese) : 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.botRelaySend: return payload.route === 'bots' ? sendBotRelay(api, payload.targetId || payload.fields?.target || payload.id || '', payload.detail || payload.value || payload.fields?.message || '', payload.fields?.profile || profile, chinese) : 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileUpdate:
      if (!payload.id) return 'none';
      if (payload.detail !== undefined) await api.updateProfileSoul(payload.id, payload.detail);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileRename:
      if (!payload.id || !payload.name?.trim()) return 'none';
      if (payload.route === 'bots' && typeof api.renameBot === 'function') {
        await api.renameBot(payload.id, payload.name.trim());
      } else {
        await api.renameProfile(payload.id, payload.name.trim());
      }
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileDescription:
      if (!payload.id || payload.detail === undefined) return 'none';
      await api.updateProfileDescription(payload.id, payload.detail);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileModel: {
      if (!payload.id || !value) return 'none';
      const explicitProvider = payload.fields?.provider?.trim() || '';
      const separator = value.indexOf('/');
      const provider = explicitProvider || (separator > 0 ? value.slice(0, separator) : '');
      const model = separator > 0 ? value.slice(separator + 1) : value;
      if (!provider || !model) {
        throw new Error(chinese ? '模型格式应为 provider/model' : 'Model must use provider/model format');
      }
      await api.updateProfileModel(payload.id, provider, model);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileAutoDescribe:
      if (!payload.id) return 'none';
      await api.autoDescribeProfile(payload.id);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileSetup: {
      if (!payload.id) return 'none'; const result = await api.getProfileSetupCommand(payload.id); return { message: stringValue(result.command) || stringValue(result.message) || payload.id };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileExport:
      if (!payload.id) return 'none'; await presentProfileExport(api, payload.id, locale); return 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.configUpdate:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.configImport: {
      const config = payload.value ? parseJsonRecord(payload.value) : payload.fields;
      if (!config) return 'none';
      await api.saveConfig({ ...config }, profile);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.environmentDelete:
      if (!payload.id) return 'none';
      await api.deleteEnvironmentVariable(payload.id, profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.environmentSet: {
      const key = payload.id || payload.name || '';
      if (!key || payload.detail === undefined) return 'none';
      await api.setEnvironmentVariable(key, payload.detail, profile);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.environmentReveal: {
      if (!payload.id) return 'none';
      const result = await api.revealEnvironmentVariable(payload.id, profile);
      return {
        message: stringValue(result.value) || stringValue(result.revealed_value)
          || (chinese ? '当前变量没有可显示的值' : 'No value is available for this variable.'),
      };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.providerOauthStart: {
      if (!payload.id) return 'none';
      const result = await api.startProviderOauth(payload.id, payload.fields ? { ...payload.fields } : {}, profile);
      const url = stringValue(result.authorization_url) || stringValue(result.url);
      const sessionId = stringValue(result.session_id) || stringValue(result.sessionId);
      return { message: url ? (chinese ? 'Provider OAuth 页面已打开' : 'Provider OAuth page opened') : (chinese ? 'Provider OAuth 已启动' : 'Provider OAuth started'), url, oauthProvider: payload.id, oauthSessionId: sessionId };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.providerOauthSubmit:
      if (!payload.id) return 'none'; await api.submitProviderOauth(payload.id, payload.fields || {}, profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.providerOauthCancel:
      if (!value) return 'none'; await api.cancelProviderOauth(value, profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.customEndpointValidate: {
      const config = parseJsonRecord(value); if (!config) return 'none'; const result = await api.validateCustomProviderEndpoint(config); return { message: stringValue(result.message) || (result.ok === false ? (chinese ? '自定义端点验证失败' : 'Custom endpoint validation failed') : (chinese ? '自定义端点验证通过' : 'Custom endpoint validated')) };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.customEndpointSave: {
      const config = parseJsonRecord(value); if (!config) return 'none'; await api.saveCustomProviderEndpoint(config, profile); return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.customEndpointActivate:
      if (!payload.id) return 'none'; await api.activateCustomProviderEndpoint(payload.id, profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.customEndpointDelete:
      if (!payload.id) return 'none'; await api.deleteCustomProviderEndpoint(payload.id, profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.memoryProvider:
      if (!payload.id && !value) return 'none';
      await api.setMemoryProvider(payload.id || value, profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.toolsetToggle:
      if (!payload.id || payload.enabled === undefined) return 'none';
      await api.setToolsetEnabled(payload.id, payload.enabled, profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.toolsetProvider:
      if (!payload.id || !value) return 'none'; await api.setToolsetProvider(payload.id, value, payload.fields?.capability as 'search' | 'extract' | undefined, profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.toolsetModel:
      if (!payload.id || !value) return 'none'; await api.setToolsetModel(payload.id, value, payload.fields?.provider, profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.toolsetEnvironment: {
      if (!payload.id) return 'none'; const env = payload.detail ? parseJsonRecord(payload.detail) : payload.fields;
      if (!env || !isStringRecord(env)) return 'none'; await api.saveToolsetEnvironment(payload.id, env, profile); return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.toolsetPostSetup:
      if (!payload.id) return 'none'; await api.runToolsetPostSetup(payload.id, value || payload.fields?.key || payload.id, profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.terminalBackend:
      if (!value) return 'none'; await api.setTerminalBackend(value, profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.computerUseGrant:
      await api.grantComputerUsePermissions(profile); return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.integrationTest: {
      if (!payload.id || payload.route !== 'channels') return 'none';
      const result = await api.testChannel(payload.id, profile);
      if (result.ok === false) {
        throw new Error(stringValue(result.error) || (chinese ? '渠道测试失败' : 'Channel test failed'));
      }
      return {
        message: stringValue(result.message)
          || (chinese ? '渠道连接正常' : 'Channel connection succeeded'),
      };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.webhooksEnable:
      await api.enableWebhooks();
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.memoryOAuthStart: {
      const provider = payload.id || value; if (!provider) return 'none'; const result = await api.startMemoryProviderOAuth(provider, profile); const state = stringValue(result.state);
      return { message: state === 'pending' ? (chinese ? 'OAuth 浏览器授权已启动，请完成授权。' : 'OAuth browser authorization started. Complete the authorization in your browser.') : (chinese ? 'OAuth 连接请求已提交。' : 'OAuth connection request submitted.'), reload: true };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.memoryConfigUpdate: {
      const provider = payload.id || value;
      const values = payload.detail ? parseJsonRecord(payload.detail) : payload.fields;
      if (!provider || !values) return 'none';
      const configValues = isRecord(values.values)
        ? values.values
        : Array.isArray(values.fields)
          ? Object.fromEntries(values.fields.flatMap((field) => (
            isRecord(field) && stringValue(field.key)
              ? [[stringValue(field.key), field.value]] as const
              : []
          )))
          : values;
      await api.updateMemoryProviderConfig(provider, configValues, profile, 'declared');
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.memoryReset:
      await api.resetMemory((payload.value || 'all') as 'all' | 'memory' | 'user', profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionExport:
      if (!payload.id) return 'none';
      { const target = resolveSessionActionTarget(payload.id, payload.fields?.profile || profile); if (target.official) await presentSessionExport(api, target.id, target.profile, locale); else await presentConversationExport(api, payload.id, locale); }
      return 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionDeleteEmpty: {
      const result = await api.deleteEmptySessions(profile);
      return {
        message: stringValue(result.deleted) || stringValue(result.message)
          || (chinese ? '空会话已清理' : 'Empty sessions cleaned up'),
        reload: true,
      };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemRestart:
      await api.restartGateway();
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemStart:
      await api.startGateway(profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemStop:
      await api.stopGateway(profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemDrain:
      await api.drainGateway(profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemUpdateCheck: {
      const result = await api.checkHermesUpdate();
      const version = stringValue(result.version) || stringValue(result.latest_version);
      return { message: version ? `${chinese ? '最新版本' : 'Latest version'}: ${version}` : (chinese ? '已检查更新' : 'Update check completed') };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemDoctor: {
      const result = await api.runDoctor({});
      return { message: stringValue(result.message) || (chinese ? 'Doctor 已启动' : 'Doctor started') };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemSecurityAudit: {
      const result = await api.runSecurityAudit({});
      return { message: stringValue(result.message) || (chinese ? '安全审计已启动' : 'Security audit started') };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemBackup: {
      const result = await api.createBackup({});
      const archive = stringValue(result.archive);
      if (!archive) throw new Error(chinese ? '服务器没有返回备份文件' : 'The server did not return a backup archive');
      const pid = typeof result.pid === 'number' && Number.isSafeInteger(result.pid) ? result.pid : undefined;
      await presentBackup(api, archive, locale, pid);
      return { message: chinese ? '备份已创建并可供保存或分享' : 'Backup created and ready to save or share' };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemBackupImport: { const uri = payload.uris?.[0] || payload.value || ''; if (!uri) return 'none'; const name = payload.name || fileNameFromUri(uri) || 'hermes-backup.zip'; try { await api.uploadImport({ uri, name, mimeType: payload.fields?.mimeType || 'application/zip' }, payload.fields?.force === 'true'); } finally { if (payload.fields?.stagedImport === 'true') await removeStagedFileImport(uri); } return 'reload'; }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemHookCreate: { const values = payload.detail ? parseJsonRecord(payload.detail) : payload.fields; if (!values) return 'none'; await api.createHook(values); return 'reload'; }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemHookDelete: { const values = payload.detail ? parseJsonRecord(payload.detail) : payload.fields; if (!values && !payload.id) return 'none'; await api.deleteHook(values || { id: payload.id }); return 'reload'; }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemDebugShare: {
      const result = await api.createDebugShare({});
      const urls = operationShareUrls(result);
      return { message: urls.join('\n') || stringValue(result.message) || (chinese ? '调试报告已生成' : 'Debug report created'), ...(urls[0] ? { url: urls[0] } : {}) };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemDiagnostics: {
      const result = await api.dumpDiagnostics({});
      return { message: stringValue(result.url) || stringValue(result.message) || (chinese ? '诊断报告已生成' : 'Diagnostics report created') };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemCheckpoints: {
      const result = await api.getCheckpoints();
      return { message: JSON.stringify(result) };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemCheckpointPrune:
      await api.pruneCheckpoints({});
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemCuratorRun: {
      const result = await api.runCurator();
      return { message: stringValue(result.message) || (chinese ? 'Curator 已启动' : 'Curator started') };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemCuratorPause:
      await api.setCuratorPaused(payload.enabled === true);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemRecover:
      await api.recoverManagedNodes(payload.id || '');
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemUpdate:
      await api.updateHermes();
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationSelect:
      return 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationCreate: {
      const profiles = (payload.fields?.profiles || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (!value || !profiles.length) return 'none';
      await api.createCollaborationRoom(value, profiles);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationDelete:
      if (!payload.id) return 'none';
      await api.deleteCollaborationRoom(payload.id);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationSend:
      if (!payload.id || !value) return 'none';
      await api.sendCollaborationRoomMessage(payload.id, value, [], payload.requestId);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.workflowStart:
      if (!payload.id) return 'none';
      await api.startWorkflow(payload.id, profile, payload.requestId);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.workflowCancel: {
      const revision = positiveRevision(payload.fields?.revision);
      if (!payload.id || !revision) return 'none';
      await api.cancelWorkflowRun(payload.id, revision, profile, payload.requestId);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.workflowRetry: {
      const revision = positiveRevision(payload.fields?.revision);
      if (!payload.id || !payload.targetId || !revision) return 'none';
      await api.retryWorkflowNode(payload.id, payload.targetId, revision, profile, payload.requestId);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.workflowApprove: {
      const revision = positiveRevision(payload.fields?.revision);
      if (!payload.id || !payload.targetId || !revision) return 'none';
      await api.approveWorkflowNode(payload.id, payload.targetId, revision, profile, payload.requestId);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.approvalApprove:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.approvalReject: {
      const revision = positiveRevision(payload.fields?.revision);
      if (!payload.id || !revision) return 'none';
      const approve = action === HERMES_SWIFTUI_ROUTE_ACTIONS.approvalApprove;
      // Echo the digest that accompanied the payload we rendered, so the
      // server can prove the human approved the bytes it is about to run.
      // A mismatch comes back as 409 and the caller reloads rather than
      // applying something the user never saw.
      await api.decideWriteApproval(
        payload.id,
        approve ? 'approve' : 'reject',
        revision,
        payload.requestId,
        profile,
        payload.fields?.payloadDigest,
      );
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.runtimeCancel:
      if (!payload.fields?.actionUrl) return 'none';
      await api.cancelRuntimeRun(payload.fields.actionUrl, payload.requestId);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.runtimeRetry:
      if (!payload.fields?.actionUrl) return 'none';
      await api.retryRuntimeRun(payload.fields.actionUrl, payload.requestId);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.workflowSelect:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.approvalSelect:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.runtimeSelect:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionSelect:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.logsFilter:
      return 'none';
    default:
      return 'none';
  }
}
