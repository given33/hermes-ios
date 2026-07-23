import type {
  HermesSwiftUIAnalyticsPointSnapshot,
  HermesSwiftUIAchievementsSnapshot,
  HermesSwiftUICollaborationSnapshot,
  HermesSwiftUIConfigSnapshot,
  HermesSwiftUICronJobSnapshot,
  HermesSwiftUIEnvironmentSecretSnapshot,
  HermesSwiftUIFileSnapshot,
  HermesSwiftUIIntegrationSnapshot,
  HermesSwiftUIKanbanColumnSnapshot,
  HermesSwiftUILogSnapshot,
  HermesSwiftUIModelSnapshot,
  HermesSwiftUIProfileSnapshot,
  HermesSwiftUIPairingSnapshot,
  HermesSwiftUIRouteActionEvent,
  HermesSwiftUIRouteSnapshot,
  HermesSwiftUISkillSnapshot,
  HermesSwiftUISessionSnapshot,
  HermesSwiftUISessionContextSnapshot,
  HermesSwiftUISystemSnapshot,
  HermesSwiftUIWorkflowSnapshot,
  HermesSwiftUIApprovalsSnapshot,
  HermesSwiftUIRuntimeSnapshot,
} from './swiftui-route-contract';
import {
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
} from './swiftui-route-contract';
import {
  HermesCloudApi,
  parseOfficialConversationPlaceholderId,
  type AccountFileEntry,
  type CustomModelConfiguration,
  type ConversationSessionState,
  type SessionSummary,
} from '../api/HermesCloudApi';
import { isFreshObservation } from '../api/managed-node-status';
import {
  localizeHermesIntegrationDescription,
  localizeHermesIntegrationName,
  localizeHermesServerText,
} from '../i18n/hermes-server-content-zh';

export async function loadHermesSwiftUIRouteSnapshot(
  api: HermesCloudApi,
  routeId: string,
  profile: string,
  selectedId = '',
  chinese = true,
): Promise<HermesSwiftUIRouteSnapshot> {
  const source = await api.loadRoute(routeId, profile, selectedId);
  const base = {
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: routeId,
  } as const;
  switch (routeId) {
    case 'sessions': {
      const sessions = sessionsSnapshot(source);
      const selected = sessions.find(({ id }) => id === selectedId);
      const sessionState = selected && !selectedId.startsWith('official:')
        ? await api.getConversationSessionState(selectedId, selected?.profile || profile)
        : undefined;
      return createHermesSwiftUISessionsSnapshot({
        sessions: isRecord(source) ? source.sessions : [],
        sessionState,
      });
    }
    case 'files':
      return { ...base, files: filesSnapshot(source) };
    case 'workflows':
      return { ...base, workflows: workflowsSnapshot(source, selectedId) };
    case 'approvals':
      return { ...base, approvals: approvalsSnapshot(source, selectedId) };
    case 'runtime-center':
      return { ...base, runtime: runtimeSnapshot(source, selectedId) };
    case 'analytics':
      return { ...base, analytics: analyticsSnapshot(source) };
    case 'models':
      return { ...base, models: modelsSnapshot(source) };
    case 'logs':
      return { ...base, logs: logsSnapshot(source, chinese) };
    case 'cron':
      return { ...base, cron: cronSnapshot(source, chinese) };
    case 'skills':
      return { ...base, skills: skillsSnapshot(source, chinese) };
    case 'plugins':
      return { ...base, integrations: integrationsSnapshot(source, 'plugins', chinese) };
    case 'mcp':
      return { ...base, integrations: integrationsSnapshot(source, 'mcp', chinese) };
    case 'channels':
      return { ...base, integrations: integrationsSnapshot(source, 'channels', chinese) };
    case 'webhooks':
      return { ...base, integrations: integrationsSnapshot(source, 'webhooks', chinese) };
    case 'pairing':
      return { ...base, pairing: pairingSnapshot(source) };
    case 'achievements':
      return { ...base, achievements: achievementsSnapshot(source, chinese) };
    case 'collaboration':
      return { ...base, collaboration: collaborationSnapshot(source) };
    case 'kanban':
      return { ...base, kanban: kanbanSnapshot(source, chinese) };
    case 'profiles':
    case 'profile-new':
      return { ...base, profiles: profilesSnapshot(source, chinese) };
    case 'config':
      return { ...base, config: configSnapshot(source) };
    case 'env':
      return { ...base, environment: environmentSnapshot(source) };
    case 'system':
      return { ...base, system: systemSnapshot(source) };
    default:
      return base;
  }
}

export async function performHermesSwiftUIRouteAction(
  api: HermesCloudApi,
  event: HermesSwiftUIRouteActionEvent,
  profile: string,
): Promise<'reload' | 'none' | {
  confirmMessage?: string;
  confirmRequired?: boolean;
  detectedModels?: readonly string[];
  message: string;
  model?: string;
  provider?: string;
  reload?: boolean;
}> {
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
      if (!result.ok) throw new Error(customModelOperationError('模型检测', result));
      return {
        detectedModels: result.models,
        message: `检测到 ${result.models.length} 个可用模型（${result.latency_ms} ms）`,
      };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.modelSave:
      await api.saveCustomModel(customModelConfiguration(payload.fields), profile);
      return { message: '模型配置已保存', reload: true };
    case HERMES_SWIFTUI_ROUTE_ACTIONS.modelTest: {
      const result = await api.testCustomModel(customModelConfiguration(payload.fields), profile);
      if (!result.ok || !result.reachable) {
        throw new Error(customModelOperationError('连接测试', result));
      }
      return {
        message: `连接成功（HTTP ${result.status}，${result.latency_ms} ms）`,
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
      await api.createProfile({ name: payload.name || value || 'profile', ...(payload.fields || {}) });
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.profileDelete:
      if (!payload.id) return 'none';
      await api.deleteProfile(payload.id);
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
      await api.deleteModelCredential(payload.id, profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemRestart:
      await api.restartGateway();
      return 'reload';
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
          title: payload.name || payload.value || '新任务',
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
      await api.decideWriteApproval(
        payload.id,
        action === HERMES_SWIFTUI_ROUTE_ACTIONS.approvalApprove ? 'approve' : 'reject',
        revision,
        payload.requestId,
        profile,
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

function customModelOperationError(
  action: string,
  result: { message: string; reachable: boolean; status: number },
): string {
  if (result.status === 401) return `${action}失败：API 密钥被拒绝（HTTP 401）`;
  if (result.status === 403) return `${action}失败：密钥权限不足（HTTP 403）`;
  if (result.status === 404) return `${action}失败：接口路径不存在（HTTP 404）`;
  if (result.status === 429) return `${action}失败：请求过多（HTTP 429）`;
  if (result.status >= 400) return `${action}失败：模型服务返回 HTTP ${result.status}`;
  if (!result.reachable) return `${action}失败：模型服务连接超时或不可达`;
  return `${action}失败：${result.message || '模型服务没有返回有效结果'}`;
}

function sessionsSnapshot(source: unknown): HermesSwiftUISessionSnapshot[] {
  if (!isRecord(source) || !Array.isArray(source.sessions)) return [];
  return source.sessions
    .filter(isSessionSummary)
    .map((session) => ({
      id: session.id,
      title: session.title?.trim() || session.preview?.trim() || '未命名会话',
      model: session.model?.trim() || 'Hermes',
      date: formatTimestamp(session.last_active || session.started_at),
      running: session.is_active,
      profile: session.profile?.trim() || undefined,
      detail: `${session.message_count} 条消息 · ${session.tool_call_count} 次工具调用`,
    }));
}

export function createHermesSwiftUISessionsSnapshot(
  source: unknown,
): HermesSwiftUIRouteSnapshot {
  const sessionState = isRecord(source) && isConversationSessionState(source.sessionState)
    ? source.sessionState
    : undefined;
  return {
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: 'sessions',
    sessions: sessionsSnapshot(source),
    sessionContext: sessionState ? sessionContextSnapshot(sessionState) : undefined,
  };
}

function sessionContextSnapshot(
  state: ConversationSessionState,
): HermesSwiftUISessionContextSnapshot {
  const currentId = state.lineage.current_session_id || state.session_id;
  return {
    conversationId: state.conversation_id,
    sessionId: state.session_id,
    profile: state.profile,
    model: state.context.model?.trim() || 'Hermes',
    activeMessages: state.context.active_messages,
    archivedMessages: state.context.archived_messages,
    messageTokens: state.context.message_tokens,
    inputTokens: state.context.input_tokens,
    outputTokens: state.context.output_tokens,
    cacheReadTokens: state.context.cache_read_tokens,
    cacheWriteTokens: state.context.cache_write_tokens,
    reasoningTokens: state.context.reasoning_tokens,
    compressionLineage: state.context.compression_lineage,
    compressionCount: state.context.compression_count,
    compressionInProgress: state.context.compression_in_progress,
    parentCount: state.lineage.edges.filter(({ child_id }) => child_id === currentId).length,
    childCount: state.lineage.edges.filter(({ parent_id }) => parent_id === currentId).length,
    lineage: state.lineage.sessions.map((session) => ({
      id: session.id,
      title: session.title?.trim() || session.id,
      parentSessionId: session.parent_session_id?.trim() || undefined,
      source: session.source?.trim() || '',
      model: session.model?.trim() || 'Hermes',
      startedAt: session.started_at || undefined,
      endedAt: session.ended_at || undefined,
      messageCount: session.message_count || 0,
      toolCallCount: session.tool_call_count || 0,
      current: session.id === currentId,
    })),
  };
}

function filesSnapshot(source: unknown): HermesSwiftUIFileSnapshot[] {
  if (!isRecord(source) || !Array.isArray(source.files)) return [];
  return source.files.filter(isAccountFileEntry).map(accountFileSnapshot);
}

function accountFileSnapshot(entry: AccountFileEntry): HermesSwiftUIFileSnapshot {
  const createdAt = numberValue(entry.created_at);
  const sourceLabel = entry.source === 'model_output' ? '模型生成' : '用户上传';
  const statusLabel = {
    available: '可用',
    failed: '失败',
    uploading: '上传中',
  }[entry.status];
  return {
    createdAt,
    dateLabel: formatFileDate(createdAt),
    detail: `${sourceLabel} · ${formatBytes(entry.size)} · ${statusLabel}`,
    fileType: entry.file_type,
    folder: false,
    id: entry.id,
    mimeType: entry.mime_type,
    name: entry.name,
    size: entry.size,
    source: entry.source,
    status: entry.status,
  };
}

function formatFileDate(timestamp: number): string {
  if (!timestamp) return '未知日期';
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function workflowsSnapshot(source: unknown, selectedId: string): HermesSwiftUIWorkflowSnapshot {
  if (!isRecord(source)) {
    return { workflows: [], nodes: [], edges: [], changeSets: [], workspaceAudits: [] };
  }
  const definitions = recordArray(source.definitions);
  const runs = recordArray(source.runs);
  const selectedEnvelope = isRecord(source.selected_definition) ? source.selected_definition : {};
  const selectedCandidate = isRecord(selectedEnvelope.definition)
    ? selectedEnvelope.definition
    : selectedEnvelope;
  const selected = stringValue(selectedCandidate.id)
    ? selectedCandidate
    : definitions.find((entry) => stringValue(entry.id) === selectedId);
  const selectedWorkflowId = stringValue(selected?.id) || undefined;
  const selectedRuns = selectedWorkflowId
    ? runs.filter((entry) => stringValue(entry.definition_id) === selectedWorkflowId)
    : [];
  const runRecord = selectedRuns[0];
  const workspaceEnvelope = isRecord(source.workspace_changes) ? source.workspace_changes : {};
  const changeSets = recordArray(workspaceEnvelope.change_sets).map(workspaceChangeSetSnapshot);
  const workspaceAudits = recordArray(workspaceEnvelope.workspace_audits).map(workspaceAuditSnapshot);
  const detailEnvelope = isRecord(source.selected_change_set) ? source.selected_change_set : {};
  const detailRecord = isRecord(detailEnvelope.change_set)
    ? detailEnvelope.change_set
    : stringValue(detailEnvelope.id) ? detailEnvelope : undefined;
  const nodeRuns = recordArray(runRecord?.node_runs);
  const latestNodeRuns = new Map<string, Record<string, unknown>>();
  for (const nodeRun of nodeRuns) {
    const key = stringValue(nodeRun.node_key);
    if (!key) continue;
    const current = latestNodeRuns.get(key);
    if (!current || numberValue(nodeRun.attempt) >= numberValue(current.attempt)) {
      latestNodeRuns.set(key, nodeRun);
    }
  }
  const spec = isRecord(selected?.spec) ? selected.spec : {};
  const nodes = recordArray(spec.nodes).map((node) => {
    const id = stringValue(node.id);
    const nodeRun = latestNodeRuns.get(id);
    const nodeRunSpec = isRecord(nodeRun?.spec) ? nodeRun.spec : {};
    const requiresApproval = node.requires_approval === true
      || node.approval_required === true
      || nodeRunSpec.requires_approval === true;
    const state = stringValue(nodeRun?.state) || 'pending';
    return {
      id,
      runNodeId: stringValue(nodeRun?.id) || undefined,
      label: stringValue(node.label) || stringValue(node.name) || id,
      kind: stringValue(node.kind) || stringValue(node.type),
      state,
      detail: stringValue(node.description) || stringValue(nodeRun?.error),
      x: finiteNumber(node.x),
      y: finiteNumber(node.y),
      requiresApproval,
      approvalPending: requiresApproval && state === 'ready',
      revision: positiveRevision(nodeRun?.revision) || 0,
    };
  }).filter((node) => node.id);
  const edges = recordArray(spec.edges).map((edge, index) => {
    const sourceId = stringValue(edge.source);
    const targetId = stringValue(edge.target);
    return {
      id: stringValue(edge.id) || `${sourceId}:${targetId}:${index}`,
      source: sourceId,
      target: targetId,
      label: stringValue(edge.label) || stringValue(edge.condition),
      state: stringValue(edge.state),
    };
  }).filter((edge) => edge.source && edge.target);
  return {
    selectedWorkflowId,
    workflows: definitions.map((definition) => {
      const definitionId = stringValue(definition.id);
      const activeRun = runs.find((entry) => stringValue(entry.definition_id) === definitionId);
      return {
        id: definitionId,
        name: stringValue(definition.name),
        detail: stringValue(definition.description),
        revision: positiveRevision(definition.revision) || 0,
        state: stringValue(activeRun?.state),
        updatedAt: epochMilliseconds(definition.updated_at),
        activeRunId: stringValue(activeRun?.id) || undefined,
      };
    }).filter((definition) => definition.id),
    nodes,
    edges,
    run: runRecord ? workflowRunSnapshot(runRecord) : undefined,
    changeSets,
    workspaceAudits,
    selectedChangeSet: detailRecord ? workspaceChangeSetDetailSnapshot(detailRecord) : undefined,
  };
}

function workflowRunSnapshot(run: Record<string, unknown>) {
  const nodeRuns = recordArray(run.node_runs);
  const startedAt = epochMilliseconds(run.created_at);
  const completedAt = epochMilliseconds(run.finished_at);
  const current = nodeRuns.find((node) => ['ready', 'dispatched', 'running'].includes(stringValue(node.state)));
  const failed = nodeRuns.find((node) => stringValue(node.error));
  const state = stringValue(run.state);
  return {
    id: stringValue(run.id),
    workflowId: stringValue(run.definition_id),
    state,
    startedAt,
    completedAt,
    durationMs: startedAt ? Math.max(0, (completedAt || Date.now()) - startedAt) : undefined,
    currentNodeId: stringValue(current?.node_key) || undefined,
    error: stringValue(run.error) || stringValue(failed?.error) || undefined,
    canCancel: state === 'running',
    canRetry: state === 'failed',
    revision: positiveRevision(run.revision) || 0,
  };
}

function workspaceChangeSetSnapshot(entry: Record<string, unknown>) {
  const counts = isRecord(entry.change_counts) ? entry.change_counts : {};
  return {
    id: stringValue(entry.id),
    runId: stringValue(entry.run_id),
    turnId: stringValue(entry.turn_id),
    summary: stringValue(entry.summary),
    createdAt: epochMilliseconds(entry.created_at),
    fileCount: numberValue(entry.file_count),
    byteCount: numberValue(entry.byte_count),
    addedCount: numberValue(counts.added),
    modifiedCount: numberValue(counts.modified),
    deletedCount: numberValue(counts.deleted),
    renamedCount: numberValue(counts.renamed),
  };
}

function workspaceAuditSnapshot(entry: Record<string, unknown>) {
  return {
    nodeRunId: stringValue(entry.node_run_id),
    runId: stringValue(entry.run_id),
    state: stringValue(entry.state),
    reason: stringValue(entry.reason),
    fileCount: numberValue(entry.file_count),
    byteCount: numberValue(entry.byte_count),
    changeSetId: stringValue(entry.change_set_id) || undefined,
    updatedAt: epochMilliseconds(entry.updated_at),
    finalizedAt: epochMilliseconds(entry.finalized_at),
  };
}

function workspaceChangeSetDetailSnapshot(entry: Record<string, unknown>) {
  return {
    id: stringValue(entry.id),
    runId: stringValue(entry.run_id),
    turnId: stringValue(entry.turn_id),
    summary: stringValue(entry.summary),
    createdAt: epochMilliseconds(entry.created_at),
    files: recordArray(entry.files).map((file) => ({
      path: stringValue(file.path),
      changeType: stringValue(file.change_type),
      sha256: stringValue(file.sha256),
      byteCount: numberValue(file.byte_count),
      patch: stringValue(file.patch),
    })).filter(({ path }) => path),
  };
}

function approvalsSnapshot(source: unknown, selectedId: string): HermesSwiftUIApprovalsSnapshot {
  if (!isRecord(source)) return { items: [] };
  const items = recordArray(source.approvals).map((entry) => approvalSnapshot(entry));
  const selectedRecord = isRecord(source.approval)
    ? source.approval
    : recordArray(source.approvals).find((entry) => stringValue(entry.id) === selectedId);
  const selected = selectedRecord ? approvalSnapshot(selectedRecord) : undefined;
  return {
    selectedId: selected?.id || undefined,
    items,
    selected,
  };
}

function approvalSnapshot(entry: Record<string, unknown>) {
  const payload = isRecord(entry.payload) ? entry.payload : {};
  const diff = stringValue(entry.diff);
  return {
    id: stringValue(entry.id),
    title: stringValue(entry.summary) || stringValue(entry.action),
    summary: stringValue(entry.summary),
    subsystem: stringValue(entry.subsystem),
    action: stringValue(entry.action),
    origin: stringValue(entry.origin),
    profile: stringValue(entry.profile),
    state: stringValue(entry.state),
    target: stringValue(payload.path) || stringValue(payload.name) || stringValue(payload.target),
    revision: positiveRevision(entry.revision) || 0,
    createdAt: epochMilliseconds(entry.created_at),
    expiresAt: epochMilliseconds(entry.expires_at),
    diff,
    diffAvailable: Boolean(diff),
  };
}

function runtimeSnapshot(source: unknown, selectedId: string): HermesSwiftUIRuntimeSnapshot {
  if (!isRecord(source)) return { runs: [] };
  const runs = recordArray(source.runs).map((entry) => runtimeRunSnapshot(entry));
  const selectedEnvelope = isRecord(source.selected_run) ? source.selected_run : {};
  const selectedRecord = isRecord(selectedEnvelope.run)
    ? selectedEnvelope.run
    : stringValue(selectedEnvelope.id)
      ? selectedEnvelope
      : recordArray(source.runs).find((entry) => stringValue(entry.id) === selectedId);
  const selected = selectedRecord ? runtimeRunSnapshot(selectedRecord) : undefined;
  return { selectedRunId: selected?.id || undefined, runs, selected };
}

function runtimeRunSnapshot(entry: Record<string, unknown>) {
  const startedAt = epochMilliseconds(entry.started_at);
  const completedAt = epochMilliseconds(entry.completed_at);
  const updatedAt = epochMilliseconds(entry.updated_at);
  const artifacts = Array.isArray(entry.artifacts) ? entry.artifacts : [];
  return {
    id: stringValue(entry.id),
    title: stringValue(entry.title) || stringValue(entry.source_run_id),
    kind: stringValue(entry.source),
    state: stringValue(entry.status),
    profile: stringValue(entry.profile),
    detail: stringValue(entry.current_node) || stringValue(entry.session_id),
    startedAt,
    completedAt,
    heartbeatAt: updatedAt,
    observedAt: updatedAt,
    durationMs: startedAt ? Math.max(0, (completedAt || updatedAt || Date.now()) - startedAt) : undefined,
    cancelable: entry.cancel_supported === true && Boolean(stringValue(entry.cancel_url)),
    retryable: entry.retry_supported === true && Boolean(stringValue(entry.retry_url)),
    conversationId: stringValue(entry.conversation_id) || undefined,
    workflowId: stringValue(entry.workflow_id) || undefined,
    error: stringValue(entry.error) || undefined,
    artifactCount: artifacts.length,
    changeSetId: stringValue(entry.change_set_id) || undefined,
    cancelUrl: stringValue(entry.cancel_url) || undefined,
    retryUrl: stringValue(entry.retry_url) || undefined,
  };
}

function analyticsSnapshot(source: unknown) {
  const usage = isRecord(source) && isRecord(source.usage) ? source.usage : {};
  const totals = isRecord(usage.totals) ? usage.totals : {};
  const daily = Array.isArray(usage.daily) ? usage.daily : [];
  return {
    inputTokens: formatCompactNumber(numberValue(totals.total_input)),
    outputTokens: formatCompactNumber(numberValue(totals.total_output)),
    monthlyCost: formatCurrency(
      numberValue(totals.total_actual_cost) || numberValue(totals.total_estimated_cost),
    ),
    // The canonical analytics API does not expose a success-rate field.
    successRate: '-',
    points: daily.flatMap((entry, index): HermesSwiftUIAnalyticsPointSnapshot[] => {
      if (!isRecord(entry)) return [];
      return [{
        id: stringValue(entry.day) || `day-${index}`,
        label: shortDayLabel(stringValue(entry.day)),
        input: numberValue(entry.input_tokens),
        output: numberValue(entry.output_tokens),
      }];
    }),
  };
}

function modelsSnapshot(source: unknown): HermesSwiftUIModelSnapshot[] {
  if (!isRecord(source)) return [];
  const info = isRecord(source.info) ? source.info : {};
  const options = isRecord(source.options) ? source.options : {};
  const custom = isRecord(source.custom) ? source.custom : {};
  const currentProvider = stringValue(info.provider) || stringValue(options.provider);
  const currentModel = stringValue(info.model) || stringValue(options.model);
  const currentContextLength = numberValue(info.effective_context_length);
  const snapshots: HermesSwiftUIModelSnapshot[] = [];
  const indexes = new Map<string, number>();

  const add = (snapshot: HermesSwiftUIModelSnapshot) => {
    const existing = indexes.get(snapshot.id);
    if (existing === undefined) {
      indexes.set(snapshot.id, snapshots.length);
      snapshots.push(snapshot);
    } else {
      snapshots[existing] = snapshot;
    }
  };

  const providers = Array.isArray(options.providers) ? options.providers : [];
  for (const providerEntry of providers) {
    if (!isRecord(providerEntry)) continue;
    const provider = stringValue(providerEntry.slug);
    if (!provider || !Array.isArray(providerEntry.models)) continue;
    const authenticated = providerEntry.authenticated !== false;
    const warning = stringValue(providerEntry.warning);
    const freeTier = providerEntry.free_tier === true;
    const unavailableModels = new Set(
      Array.isArray(providerEntry.unavailable_models)
        ? providerEntry.unavailable_models.filter((value): value is string => typeof value === 'string')
        : [],
    );
    const pricing = isRecord(providerEntry.pricing) ? providerEntry.pricing : {};
    const capabilities = isRecord(providerEntry.capabilities) ? providerEntry.capabilities : {};
    for (const modelEntry of providerEntry.models) {
      const model = typeof modelEntry === 'string'
        ? modelEntry
        : isRecord(modelEntry)
          ? stringValue(modelEntry.id) || stringValue(modelEntry.model) || stringValue(modelEntry.name)
          : '';
      if (!model) continue;
      const active = provider === currentProvider && model === currentModel;
      const contextLength = active
        ? currentContextLength
        : isRecord(modelEntry) ? numberValue(modelEntry.context_length) : 0;
      const modelPricing = isRecord(pricing[model]) ? pricing[model] : {};
      const modelCapabilities = isRecord(capabilities[model]) ? capabilities[model] : {};
      add({
        active,
        apiKeyConfigured: false,
        apiKeyPreview: '',
        apiMode: 'chat_completions',
        baseUrl: '',
        context: formatContextLength(contextLength),
        contextLength,
        id: encodeModelSelection(provider, model),
        model,
        provider,
        reasoningEffort: 'none',
        authenticated,
        selectable: authenticated && !unavailableModels.has(model),
        warning,
        priceInput: stringValue(modelPricing.input),
        priceOutput: stringValue(modelPricing.output),
        priceCache: stringValue(modelPricing.cache),
        free: modelPricing.free === true,
        freeTier,
        supportsFast: modelCapabilities.fast === true,
        supportsReasoning: modelCapabilities.reasoning === true,
      });
    }
  }

  if (currentProvider && currentModel) {
    const currentId = encodeModelSelection(currentProvider, currentModel);
    const providerEntry = providers.find((value) => (
      isRecord(value) && stringValue(value.slug) === currentProvider
    ));
    const providerRecord = isRecord(providerEntry) ? providerEntry : {};
    const authenticated = providerEntry === undefined || providerRecord.authenticated !== false;
    const unavailable = Array.isArray(providerRecord.unavailable_models)
      && providerRecord.unavailable_models.includes(currentModel);
    const pricing = isRecord(providerRecord.pricing) && isRecord(providerRecord.pricing[currentModel])
      ? providerRecord.pricing[currentModel] : {};
    const capabilities = isRecord(providerRecord.capabilities)
      && isRecord(providerRecord.capabilities[currentModel])
      ? providerRecord.capabilities[currentModel] : {};
    if (!indexes.has(currentId)) add({
      active: true,
      apiKeyConfigured: false,
      apiKeyPreview: '',
      apiMode: 'chat_completions',
      baseUrl: '',
      context: formatContextLength(currentContextLength),
      contextLength: currentContextLength,
      id: currentId,
      model: currentModel,
      provider: currentProvider,
      reasoningEffort: 'none',
      authenticated,
      selectable: authenticated && !unavailable,
      warning: stringValue(providerRecord.warning),
      priceInput: stringValue(pricing.input),
      priceOutput: stringValue(pricing.output),
      priceCache: stringValue(pricing.cache),
      free: pricing.free === true,
      freeTier: providerRecord.free_tier === true,
      supportsFast: capabilities.fast === true,
      supportsReasoning: capabilities.reasoning === true,
    });
  }

  const customModel = stringValue(custom.model);
  if (customModel) {
    const customId = encodeModelSelection('custom', customModel);
    const existingCustomIndex = indexes.get(customId);
    const existingCustom = existingCustomIndex === undefined
      ? undefined : snapshots[existingCustomIndex];
    const contextLength = numberValue(custom.contextLength)
      || (currentProvider === 'custom' && customModel === currentModel ? currentContextLength : 0);
    add({
      active: currentProvider === 'custom' && customModel === currentModel,
      apiKeyConfigured: custom.apiKeyConfigured === true,
      apiKeyPreview: stringValue(custom.apiKeyPreview),
      apiMode: customApiMode(stringValue(custom.apiMode)),
      baseUrl: stringValue(custom.baseUrl),
      context: formatContextLength(contextLength),
      contextLength,
      id: customId,
      model: customModel,
      provider: 'custom',
      reasoningEffort: customReasoningEffort(stringValue(custom.reasoningEffort)),
      authenticated: custom.apiKeyConfigured === true || stringValue(custom.baseUrl).length > 0,
      selectable: custom.apiKeyConfigured === true || stringValue(custom.baseUrl).length > 0,
      warning: existingCustom?.warning || '',
      priceInput: existingCustom?.priceInput || '',
      priceOutput: existingCustom?.priceOutput || '',
      priceCache: existingCustom?.priceCache || '',
      free: existingCustom?.free || false,
      freeTier: existingCustom?.freeTier || false,
      supportsFast: existingCustom?.supportsFast || false,
      supportsReasoning: existingCustom?.supportsReasoning ?? true,
    });
  }

  return snapshots;
}

function customModelConfiguration(
  fields: Readonly<Record<string, string>> | undefined,
): CustomModelConfiguration {
  const source = fields || {};
  const contextLength = Number.parseInt(source.contextLength || '', 10);
  const configuration: CustomModelConfiguration = {
    apiMode: customApiMode(source.apiMode),
    baseUrl: source.baseUrl?.trim() || '',
    contextLength: Number.isFinite(contextLength) ? contextLength : 0,
    model: source.model?.trim() || '',
    reasoningEffort: customReasoningEffort(source.reasoningEffort),
  };
  if (source.apiKey?.trim()) configuration.apiKey = source.apiKey.trim();
  return configuration;
}

function customApiMode(value: string): CustomModelConfiguration['apiMode'] {
  return value === 'anthropic_messages' || value === 'codex_responses'
    ? value
    : 'chat_completions';
}

function customReasoningEffort(value: string): CustomModelConfiguration['reasoningEffort'] {
  const valid = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
  return valid.includes(value as typeof valid[number])
    ? value as CustomModelConfiguration['reasoningEffort']
    : 'none';
}

function logsSnapshot(source: unknown, chinese: boolean): HermesSwiftUILogSnapshot[] {
  if (!isRecord(source) || !Array.isArray(source.lines)) return [];
  return source.lines.flatMap((line, index): HermesSwiftUILogSnapshot[] => {
    if (typeof line !== 'string') return [];
    const match = line.match(
      /^(?<time>\d{4}-\d{2}-\d{2}[ T][^ ]+)\s+(?:\[[^\]]+\]\s+)?(?<level>DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\s+(?<message>.*)$/i,
    );
    return [{
      id: `log-${index}-${hashString(line)}`,
      level: match?.groups?.level?.toUpperCase() || inferLogLevel(line),
      message: localizeHermesServerText(match?.groups?.message || line, chinese),
      time: match?.groups?.time || '',
    }];
  });
}

function cronSnapshot(source: unknown, chinese: boolean): HermesSwiftUICronJobSnapshot[] {
  const rows = Array.isArray(source)
    ? source
    : isRecord(source) && Array.isArray(source.jobs) ? source.jobs : [];
  return rows.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id) || `cron-${index}`;
    return [{
      id,
      name: localizeHermesServerText(stringValue(entry.name) || stringValue(entry.title) || id, chinese),
      schedule: stringValue(entry.schedule) || stringValue(entry.cron) || '-',
      prompt: localizeHermesServerText(stringValue(entry.prompt) || stringValue(entry.script) || '', chinese),
      enabled: entry.enabled !== false && entry.paused !== true,
      lastRun: formatDateValue(entry.last_run || entry.lastRun || entry.updated_at),
    }];
  });
}

function skillsSnapshot(source: unknown, chinese: boolean): HermesSwiftUISkillSnapshot[] {
  const rows = isRecord(source) && Array.isArray(source.skills) ? source.skills : [];
  const selectedId = isRecord(source) ? stringValue(source.selectedId) : '';
  const selectedContent = isRecord(source) && isRecord(source.selectedContent)
    ? structuredContent(source.selectedContent.content ?? source.selectedContent.text)
    : '';
  return rows.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.name) || stringValue(entry.id) || `skill-${index}`;
    return [{
      id,
      name: localizeHermesServerText(stringValue(entry.display_name) || stringValue(entry.name) || id, chinese),
      detail: localizeHermesServerText(stringValue(entry.description) || stringValue(entry.detail) || '', chinese),
      bundled: Boolean(entry.bundled || entry.source === 'bundled' || entry.provenance === 'bundled'),
      enabled: entry.enabled !== false,
      ...(id === selectedId ? { content: selectedContent } : {}),
      notes: stringValue(entry.notes),
      source: stringValue(entry.source),
    }];
  });
}

function integrationsSnapshot(source: unknown, kind: string, chinese: boolean): HermesSwiftUIIntegrationSnapshot[] {
  const mcpPayload = isRecord(source) && isRecord(source.servers) ? source.servers : {};
  const candidates = isRecord(source)
    ? kind === 'plugins' ? source.manifests
      : kind === 'mcp' ? mcpPayload.servers
        : kind === 'webhooks' ? source.subscriptions
          : source.platforms
    : source;
  const rows = Array.isArray(candidates) ? candidates : [];
  return rows.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.name) || stringValue(entry.id) || stringValue(entry.slug) || `${kind}-${index}`;
    return [{
      id,
      name: localizeHermesIntegrationName(
        id,
        stringValue(entry.display_name) || stringValue(entry.name) || id,
        kind,
        chinese,
      ),
      detail: localizeHermesIntegrationDescription(
        id,
        stringValue(entry.description)
          || stringValue(entry.detail)
          || stringValue(entry.endpoint)
          || stringValue(entry.url)
          || [stringValue(entry.command), stringArray(entry.args).join(' ')].filter(Boolean).join(' '),
        kind,
        chinese,
      ),
      enabled: entry.enabled !== false && entry.disabled !== true,
      ...(kind === 'channels' ? { configuration: channelConfiguration(entry) } : {}),
    }];
  });
}

function channelConfiguration(entry: Record<string, unknown>): string {
  const envVars = Array.isArray(entry.env_vars) ? entry.env_vars : [];
  const env = Object.fromEntries(envVars.flatMap((field): [string, string][] => {
    if (!isRecord(field)) return [];
    const key = stringValue(field.key);
    return key ? [[key, '']] : [];
  }));
  return JSON.stringify({
    enabled: entry.enabled !== false,
    env,
    clear_env: [],
  }, null, 2);
}

function pairingSnapshot(source: unknown): HermesSwiftUIPairingSnapshot {
  if (!isRecord(source)) return { pending: [], approved: [] };
  return {
    pending: pairingEntries(source.pending, true),
    approved: pairingEntries(source.approved, false),
  };
}

function pairingEntries(value: unknown, pending: boolean) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const platform = stringValue(entry.platform);
    const userId = stringValue(entry.user_id);
    const userName = stringValue(entry.user_name);
    const age = numberValue(entry.age_minutes);
    return [{
      id: `${platform}:${userId || index}`,
      platform,
      userId,
      userName,
      detail: pending
        ? `${userName || userId || '未知用户'} · ${age} 分钟前`
        : userName || userId,
    }];
  });
}

function achievementsSnapshot(source: unknown, chinese: boolean): HermesSwiftUIAchievementsSnapshot {
  const root = isRecord(source) ? source : {};
  const rows = Array.isArray(root.achievements) ? root.achievements : [];
  return {
    tasksCompleted: String(root.tasks_completed ?? root.completed ?? root.unlocked_count ?? '-'),
    dayStreak: String(root.day_streak ?? root.streak ?? '-'),
    shareText: stringValue(root.share_text) || 'Hermes Agent achievements',
    items: rows.flatMap((entry, index) => {
      if (!isRecord(entry)) return [];
      return [{
        id: stringValue(entry.id) || `achievement-${index}`,
        title: localizeHermesServerText(stringValue(entry.title) || stringValue(entry.name) || '', chinese),
        detail: localizeHermesServerText(stringValue(entry.description) || stringValue(entry.detail) || '', chinese),
        symbol: stringValue(entry.symbol) || 'checkmark.seal',
        progress: Math.max(0, Math.min(1, numberValue(entry.progress))),
      }];
    }),
  };
}

function collaborationSnapshot(source: unknown): HermesSwiftUICollaborationSnapshot {
  const root = isRecord(source) ? source : {};
  const conversations = Array.isArray(root.rooms) ? root.rooms : [];
  const selected = isRecord(root.room) ? root.room : conversations.find(isRecord);
  const selectedId = selected ? stringValue(selected.id) : undefined;
  const messages = selected && Array.isArray(selected.messages) ? selected.messages : [];
  return {
    selectedRoomId: selectedId,
    availableProfiles: Array.isArray(root.profiles)
      ? root.profiles.flatMap((entry) => isRecord(entry) && stringValue(entry.name)
        ? [stringValue(entry.name)]
        : [])
      : [],
    rooms: conversations.flatMap((entry, index) => isRecord(entry) ? [{
      id: stringValue(entry.id) || `room-${index}`,
      name: stringValue(entry.title) || stringValue(entry.name) || `Room ${index + 1}`,
    }] : []),
    messages: messages.flatMap((entry, index) => isRecord(entry) ? [{
      id: stringValue(entry.id) || `message-${index}`,
      text: stringValue(entry.content) || stringValue(entry.text) || '',
    }] : []),
  };
}

function kanbanSnapshot(source: unknown, chinese: boolean): HermesSwiftUIKanbanColumnSnapshot[] {
  const root = isRecord(source) ? source : {};
  const columns = Array.isArray(root.columns) ? root.columns : [];
  if (columns.length) return columns.flatMap((entry, index) => kanbanColumn(entry, index, chinese));
  const tasks = Array.isArray(root.tasks) ? root.tasks : [];
  const grouped = new Map<string, Record<string, unknown>[]>();
  tasks.forEach((entry) => {
    if (!isRecord(entry)) return;
    const key = stringValue(entry.status) || 'backlog';
    const bucket = grouped.get(key) || [];
    bucket.push(entry);
    grouped.set(key, bucket);
  });
  return [...grouped.entries()].map(([id, cards]) => ({
    id,
    title: localizeHermesServerText(id, chinese),
    cards: cards.map((entry, index) => ({
      id: stringValue(entry.id) || `${id}-${index}`,
      title: localizeHermesServerText(stringValue(entry.title) || stringValue(entry.name) || '', chinese),
      detail: localizeHermesServerText(stringValue(entry.description) || stringValue(entry.detail) || '', chinese),
    })),
  }));
}

function kanbanColumn(entry: unknown, index: number, chinese: boolean): HermesSwiftUIKanbanColumnSnapshot[] {
  if (!isRecord(entry)) return [];
  const id = stringValue(entry.id) || stringValue(entry.name) || `column-${index}`;
  const cards = Array.isArray(entry.cards) ? entry.cards : Array.isArray(entry.tasks) ? entry.tasks : [];
  return [{
    id,
    title: localizeHermesServerText(stringValue(entry.title) || stringValue(entry.name) || id, chinese),
    cards: cards.flatMap((card, cardIndex) => isRecord(card) ? [{
      id: stringValue(card.id) || `${id}-${cardIndex}`,
      title: localizeHermesServerText(stringValue(card.title) || stringValue(card.name) || '', chinese),
      detail: localizeHermesServerText(stringValue(card.description) || stringValue(card.detail) || '', chinese),
    }] : []),
  }];
}

function profilesSnapshot(source: unknown, chinese: boolean): HermesSwiftUIProfileSnapshot[] {
  const root = isRecord(source) ? source : {};
  const active = isRecord(root.active)
    ? stringValue(root.active.name) || stringValue(root.active.active)
    : stringValue(root.active);
  const rows = Array.isArray(root.profiles) ? root.profiles : [];
  return rows.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.name) || stringValue(entry.id) || `profile-${index}`;
    return [{
      id,
      name: localizeHermesServerText(stringValue(entry.display_name) || stringValue(entry.name) || id, chinese),
      model: stringValue(entry.model) || '',
      detail: localizeHermesServerText(stringValue(entry.description) || stringValue(entry.detail) || '', chinese),
      active: Boolean(entry.active) || id === active,
      soul: stringValue(entry.soul),
      terminalAccess: entry.terminal_access !== false,
      fileAccess: entry.file_access !== false,
      browserAccess: entry.browser_access !== false,
    }];
  });
}

function configSnapshot(source: unknown): HermesSwiftUIConfigSnapshot {
  const root = isRecord(source) && isRecord(source.config) ? source.config : {};
  const model = isRecord(root.model) ? stringValue(root.model.default) : stringValue(root.model);
  const modelOptions = isRecord(source) && isRecord(source.schema) && Array.isArray(source.schema.models)
    ? source.schema.models.filter((value): value is string => typeof value === 'string') : [];
  return {
    defaultModel: model,
    modelOptions,
    maxIterations: numberValue(isRecord(root.agent) ? root.agent.max_turns : root.max_iterations),
    streamOutput: root.stream_output !== false,
    autoCompact: root.auto_compact !== false,
    compactionThreshold: numberValue(root.compaction_threshold),
    timezone: stringValue(root.timezone),
    exportText: JSON.stringify(root, null, 2),
  };
}

function environmentSnapshot(source: unknown): HermesSwiftUIEnvironmentSecretSnapshot[] {
  const root = isRecord(source) ? source : {};
  if (!Array.isArray(root.credentials)) return [];
  return root.credentials.flatMap((value): HermesSwiftUIEnvironmentSecretSnapshot[] => {
    if (!isRecord(value)) return [];
    const id = stringValue(value.id);
    if (!id) return [];
    const provider = stringValue(value.provider) || 'custom';
    const model = stringValue(value.model);
    return [{
      id,
      key: model ? `${provider} · ${model}` : provider,
      maskedValue: stringValue(value.masked_value) || '••••••••',
    }];
  });
}

function systemSnapshot(source: unknown): HermesSwiftUISystemSnapshot {
  const root = isRecord(source) ? source : {};
  const status = isRecord(root.status) ? root.status : {};
  const stats = isRecord(root.stats) ? root.stats : {};
  const managed = isRecord(root.managedNodes) ? root.managedNodes : {};
  const managedConfigured = managed.configured === true;
  const managedNodes = Array.isArray(managed.nodes) ? managed.nodes.filter(isRecord) : [];
  const nodeSnapshots = managedNodes.map((node) => {
    const metrics = isRecord(node.metrics) ? node.metrics : {};
    const memoryTotal = numberValue(metrics.memory_total_bytes);
    const memoryAvailable = numberValue(metrics.memory_available_bytes);
    const gatewayState = stringValue(node.gateway_state);
    const metricsAvailable = node.metrics_available === true;
    const recoveryState = stringValue(node.recovery_state);
    const gatewayOnline = isFreshObservation(node)
      && node.online === true
      && ['active', 'online', 'ready', 'running'].includes(gatewayState.toLowerCase());
    return {
      id: stringValue(node.id),
      label: stringValue(node.label) || stringValue(node.id),
      cpu: metricsAvailable ? numberValue(metrics.cpu_percent) : 0,
      memory: metricsAvailable ? numberValue(metrics.memory_percent) : 0,
      disk: metricsAvailable ? numberValue(metrics.disk_percent) : 0,
      memoryLabel: metricsAvailable
        ? formatBytes(Math.max(0, memoryTotal - memoryAvailable))
        : '-',
      uptimeLabel: metricsAvailable ? formatDuration(numberValue(metrics.uptime_seconds)) : '-',
      activeTasks: String(node.active_tasks ?? '-'),
      gatewayOnline,
      metricsAvailable,
      gatewayState,
      version: stringValue(node.version) || stringValue(node.gateway_version),
      observedAt: stringValue(node.observed_at),
      metricsSource: stringValue(node.metrics_source),
      recoveryState,
    };
  }).filter((node) => node.id);
  const primaryNode = nodeSnapshots.find((node) => node.id === 'dbb3') || nodeSnapshots[0];
  const memory = isRecord(stats.memory) ? stats.memory : {};
  const disk = isRecord(stats.disk) ? stats.disk : {};
  const gateway = isRecord(status.gateway) ? status.gateway : {};
  return {
    cpu: primaryNode?.cpu ?? numberValue(stats.cpu_percent ?? stats.cpu),
    memory: primaryNode?.memory ?? numberValue(stats.memory_percent ?? memory.percent),
    disk: primaryNode?.disk ?? numberValue(stats.disk_percent ?? disk.percent),
    memoryLabel: primaryNode?.memoryLabel || stringValue(stats.memory_label)
      || formatBytes(numberValue(stats.memory_bytes ?? memory.used)),
    uptimeLabel: primaryNode?.uptimeLabel || stringValue(stats.uptime)
      || formatDuration(numberValue(stats.uptime_seconds)),
    activeTasks: primaryNode?.activeTasks || String(
      stats.active_tasks
        ?? status.active_tasks
        ?? status.active_sessions
        ?? '-',
    ),
    // Once managed-node monitoring is configured, an empty/stale node list is
    // an unavailable observation. Never let the older aggregate status flag
    // turn a missing DBB3/WSL heartbeat back into "online".
    gatewayOnline: primaryNode?.gatewayOnline ?? (managedConfigured ? false : Boolean(
      status.online
        ?? status.gateway_online
        ?? status.gateway_running
        ?? gateway.running
        ?? status.running,
    )),
    metricsAvailable: primaryNode?.metricsAvailable ?? !managedConfigured,
    nodes: nodeSnapshots,
    operationMessage: stringValue(root.operation_message) || undefined,
  };
}

async function presentAccountFile(
  api: HermesCloudApi,
  id: string,
  name: string,
  shareOnly: boolean,
) {
  const blob = await api.downloadAccountFile(id, !shareOnly);
  const [{ File, Paths }, quickLook, Sharing] = await Promise.all([
    import('expo-file-system'),
    import('../../modules/hermes-quick-look'),
    import('expo-sharing'),
  ]);
  const target = new File(Paths.cache, safeFileName(name));
  target.create({ intermediates: true, overwrite: true });
  target.write(new Uint8Array(await blob.arrayBuffer()));
  try {
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
  const [{ File, Paths }, quickLook, Sharing] = await Promise.all([
    import('expo-file-system'),
    import('../../modules/hermes-quick-look'),
    import('expo-sharing'),
  ]);
  const target = new File(Paths.cache, safeFileName(`${name}-SKILL.md`));
  target.create({ intermediates: true, overwrite: true });
  target.write(content);
  try {
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

function safeFileName(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  return normalized.slice(0, 180) || 'Hermes-file';
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function encodeModelSelection(provider: string, model: string): string {
  return JSON.stringify([provider, model]);
}

export function decodeModelSelection(value: string): { model: string; provider: string } | null {
  try {
    const decoded = JSON.parse(value) as unknown;
    if (
      !Array.isArray(decoded)
      || decoded.length !== 2
      || decoded.some((part) => typeof part !== 'string' || !part)
    ) {
      return null;
    }
    return { provider: decoded[0], model: decoded[1] };
  } catch {
    return null;
  }
}

function isSessionSummary(value: unknown): value is SessionSummary {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.message_count === 'number'
    && typeof value.tool_call_count === 'number';
}

function isConversationSessionState(value: unknown): value is ConversationSessionState {
  if (!isRecord(value) || !isRecord(value.context) || !isRecord(value.lineage)) {
    return false;
  }
  return typeof value.conversation_id === 'string'
    && typeof value.profile === 'string'
    && typeof value.session_id === 'string'
    && typeof value.context.session_id === 'string'
    && Array.isArray(value.context.compression_lineage)
    && typeof value.lineage.current_session_id === 'string'
    && Array.isArray(value.lineage.sessions)
    && Array.isArray(value.lineage.edges);
}

function isAccountFileEntry(value: unknown): value is AccountFileEntry {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.mime_type === 'string'
    && typeof value.file_type === 'string'
    && typeof value.size === 'number'
    && (value.source === 'model_output' || value.source === 'user_upload')
    && (value.status === 'available' || value.status === 'failed' || value.status === 'uploading')
    && typeof value.created_at === 'number';
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-';
  const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(milliseconds));
}

function formatDateValue(value: unknown): string {
  if (typeof value === 'number') return formatTimestamp(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? formatTimestamp(parsed) : value;
  }
  return '-';
}

function formatBytes(value: number | null): string {
  if (!value || value < 1) return value === 0 ? '0 B' : '-';
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${Math.round(value / 1_024)} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 2,
    style: 'currency',
  }).format(value);
}

function formatContextLength(value: number): string {
  return value > 0 ? `${formatCompactNumber(value)} context` : '';
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days) return `${days}天 ${hours}小时`;
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours ? `${hours}小时 ${minutes}分钟` : `${minutes}分钟`;
}

function shortDayLabel(day: string): string {
  const match = day.match(/(\d{2})-(\d{2})$/);
  return match ? `${match[1]}/${match[2]}` : day;
}

function inferLogLevel(line: string): string {
  const upper = line.toUpperCase();
  if (upper.includes('CRITICAL')) return 'CRITICAL';
  if (upper.includes('ERROR')) return 'ERROR';
  if (upper.includes('WARN')) return 'WARNING';
  if (upper.includes('DEBUG')) return 'DEBUG';
  return 'INFO';
}

function hashString(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveRevision(value: unknown): number | undefined {
  const revision = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : undefined;
}

function epochMilliseconds(value: unknown): number | undefined {
  const timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function structuredContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(structuredContent).filter(Boolean).join('');
  if (isRecord(value)) return structuredContent(value.text ?? value.content);
  return '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
