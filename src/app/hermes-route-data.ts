import type {
  HermesSwiftUIRouteActionEvent,
  HermesSwiftUIRouteSnapshot,
} from './swiftui-route-contract';
import {
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
} from './swiftui-route-contract';
import {
  HermesCloudApi,
  parseOfficialConversationPlaceholderId,
} from '../api/HermesCloudApi';
import { writeBoundedDownload } from '../api/bounded-download';
import {
  isRecord,
  positiveRevision,
  routeLocalizer,
  stringValue,
  structuredContent,
  type HermesRouteLocaleInput,
} from './route-snapshots/support';
import {
  createHermesSwiftUISessionsSnapshot,
  createHermesSwiftUISessionsSnapshotFromConversations,
  filesSnapshot,
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
} from './route-snapshots/management';
import {
  decodeModelSelection,
  encodeModelSelection,
} from './route-snapshots/model-selection';
import {
  customModelConfiguration,
  customModelOperationError,
  modelsSnapshot,
} from './route-snapshots/models';
import { systemSnapshot } from './route-snapshots/system';
import { memorySnapshot } from './route-snapshots/memory';

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
      return createHermesSwiftUISessionsSnapshot({
        sessions: isRecord(source) ? source.sessions : [],
        sessionState,
      }, locale);
    }
    case 'files':
      return { ...base, files: filesSnapshot(source, localizer) };
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
      };
    }
    case 'logs':
      return { ...base, logs: logsSnapshot(source, localizer) };
    case 'cron':
      return { ...base, cron: cronSnapshot(source, localizer) };
    case 'skills':
      return {
        ...base,
        skills: skillsSnapshot(source, localizer),
        installations: managedInstallationsSnapshot(source, 'skill'),
      };
    case 'plugins':
      return { ...base, integrations: integrationsSnapshot(source, 'plugins', localizer) };
    case 'mcp':
      return {
        ...base,
        integrations: integrationsSnapshot(source, 'mcp', localizer),
        installations: managedInstallationsSnapshot(source, 'mcp'),
      };
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
    case 'kanban':
      return { ...base, kanban: kanbanSnapshot(source, localizer) };
    case 'profiles':
    case 'profile-new':
      return { ...base, profiles: profilesSnapshot(source, localizer) };
    case 'bots':
      return { ...base, profiles: profilesSnapshot(source, localizer) };
    case 'config':
      return { ...base, config: configSnapshot(source) };
    case 'env':
      return { ...base, environment: environmentSnapshot(source) };
    case 'system':
      return { ...base, system: systemSnapshot(source, localizer) };
    case 'memory':
      return { ...base, memory: memorySnapshot(source) };
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
}> {
  const localizer = routeLocalizer(locale);
  const chinese = localizer.isChinese;
  const { action, payload } = event;
  const value = payload.value?.trim() || payload.name?.trim() || '';
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
      }, profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.cronToggle:
      if (!payload.id || payload.enabled === undefined) return 'none';
      await api.setCronJobPaused(payload.id, !payload.enabled, profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.cronRun:
      if (!payload.id) return 'none';
      await api.triggerCronJob(payload.id, profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.cronDelete:
      if (!payload.id) return 'none';
      await api.deleteCronJob(payload.id, profile);
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
    case HERMES_SWIFTUI_ROUTE_ACTIONS.integrationUpdate:
      if (!payload.id || payload.route !== 'channels') return 'none';
      {
        const update = payload.value ? parseJsonRecord(payload.value) : payload.fields;
        if (!update) return 'none';
        await api.updateChannel(payload.id, update, profile);
      }
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.integrationCreate:
      if (payload.route === 'mcp') {
        const catalogName = payload.fields?.catalogName?.trim();
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
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileUpdate:
      if (!payload.id) return 'none';
      if (payload.detail !== undefined) await api.updateProfileSoul(payload.id, payload.detail);
      return 'reload';
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
    case HERMES_SWIFTUI_ROUTE_ACTIONS.memoryProvider:
      if (!payload.id && !value) return 'none';
      await api.setMemoryProvider(payload.id || value);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.memoryReset:
      await api.resetMemory((payload.value || 'all') as 'all' | 'memory' | 'user');
      return 'reload';
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
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemRecover:
      await api.recoverManagedNodes(payload.id || '');
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemUpdate:
      await api.updateHermes();
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanCreate:
      if (!payload.name && !payload.value) return 'none';
      {
        const created = await api.createKanbanTask({
          title: payload.name || payload.value || (chinese ? '新任务' : 'New task'),
          body: payload.detail || '',
        });
        const task = isRecord(created.task) ? created.task : {};
        const taskId = stringValue(task.id);
        if (taskId && payload.targetId && payload.targetId !== 'triage') {
          await api.updateKanbanTask(taskId, { status: payload.targetId });
        }
      }
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanUpdate:
      if (!payload.id) return 'none';
      await api.updateKanbanTask(payload.id, {
        ...(payload.name ? { title: payload.name } : {}),
        ...(payload.detail !== undefined ? { body: payload.detail } : {}),
        ...(payload.targetId ? { status: payload.targetId } : {}),
      });
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanMove:
      if (!payload.id) return 'none';
      await api.updateKanbanTask(payload.id, {
        status: payload.targetId || payload.value,
        position: payload.position,
      });
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanDelete:
      if (!payload.id) return 'none';
      await api.updateKanbanTask(payload.id, { archived: true });
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

async function presentAccountFile(
  api: HermesCloudApi,
  id: string,
  name: string,
  shareOnly: boolean,
) {
  const [quickLook, Sharing, { temporaryPlaintextFile }] = await Promise.all([
    import('../../modules/hermes-quick-look'),
    import('expo-sharing'),
    import('../api/temporary-plaintext-files'),
  ]);
  const target = temporaryPlaintextFile(name, 'account-file');
  try {
    await api.consumeAccountFile(
      id,
      !shareOnly,
      (response, signal) => writeBoundedDownload(response, target, { signal }),
    );
    const presented = shareOnly ? false : await quickLook.presentQuickLook(target.uri, name);
    if (!presented && await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(target.uri, { dialogTitle: name });
    }
  } finally {
    if (target.exists) target.delete();
  }
}

async function presentSkillContent(
  api: HermesCloudApi,
  name: string,
  profile: string,
) {
  const response = await api.getSkillContent(name, profile);
  const content = structuredContent(response.content ?? response.text);
  const [quickLook, Sharing, { temporaryPlaintextFile }] = await Promise.all([
    import('../../modules/hermes-quick-look'),
    import('expo-sharing'),
    import('../api/temporary-plaintext-files'),
  ]);
  const target = temporaryPlaintextFile(`${name}-SKILL.md`, 'skill-preview');
  try {
    target.write(content);
    const presented = await quickLook.presentQuickLook(target.uri, `${name}/SKILL.md`);
    if (!presented && await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(target.uri);
    }
  } finally {
    if (target.exists) target.delete();
  }
}

function fileImportUploadId(requestId: string | undefined, uri: string, index: number): string {
  const stableRequest = requestId?.trim() || `file-import-${Date.now().toString(36)}`;
  let hash = 2166136261;
  for (const char of uri) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${stableRequest}-${index}-${(hash >>> 0).toString(16)}`
    .replace(/[^A-Za-z0-9._:-]/g, '-')
    .slice(0, 256);
}

function fileNameFromUri(value: string): string {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'attachment');
  } catch {
    return value.split(/[\\/]/).filter(Boolean).pop() || 'attachment';
  }
}

async function removeStagedFileImport(uri: string): Promise<void> {
  try {
    const { File } = await import('expo-file-system');
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Native stale-batch cleanup remains the fallback after interrupted uploads.
  }
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isStringRecord(value: Record<string, unknown>): value is Record<string, string> {
  return Object.values(value).every((item) => typeof item === 'string');
}
