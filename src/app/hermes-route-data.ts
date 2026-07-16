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
  HermesSwiftUISystemSnapshot,
} from './swiftui-route-contract';
import {
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
} from './swiftui-route-contract';
import {
  HermesCloudApi,
  type ManagedFileEntry,
  type SessionSummary,
} from '../api/HermesCloudApi';
import { localizeHermesServerText } from '../i18n/hermes-server-content-zh';

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
    case 'sessions':
      return { ...base, sessions: sessionsSnapshot(source) };
    case 'files':
      return { ...base, files: filesSnapshot(source) };
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
): Promise<'reload' | 'none'> {
  const { action, payload } = event;
  const value = payload.value?.trim() || payload.name?.trim() || '';
  switch (action) {
    case HERMES_SWIFTUI_ROUTE_ACTIONS.refresh:
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionDelete:
      if (!payload.id) return 'none';
      await api.deleteSession(payload.id, profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionRename:
      if (!payload.id || !value) return 'none';
      await api.renameSession(payload.id, value, profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.fileDelete:
      if (!payload.id) return 'none';
      await api.deleteFile(payload.id, payload.value === 'recursive');
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.fileImport:
      for (const uri of payload.uris || []) {
        const name = fileNameFromUri(uri);
        await api.uploadManagedFile('', { name, uri });
      }
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.fileDownload:
      if (!payload.id) return 'none';
      await presentManagedFile(api, payload.id, payload.name || fileNameFromUri(payload.id));
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
      await api.setModel(selection.provider, selection.model, profile);
      return 'reload';
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
    case HERMES_SWIFTUI_ROUTE_ACTIONS.integrationToggle:
      if (!payload.id || payload.enabled === undefined) return 'none';
      if (payload.route === 'plugins') {
        await api.setPluginEnabled(payload.id, payload.enabled);
      } else if (payload.route === 'mcp') {
        await api.setMcpServerEnabled(payload.id, payload.enabled);
      } else if (payload.route === 'webhooks') {
        await api.setWebhookEnabled(payload.id, payload.enabled);
      } else {
        await api.updateChannel(payload.id, { enabled: payload.enabled });
      }
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.integrationDelete:
      if (!payload.id) return 'none';
      if (payload.route === 'mcp') await api.removeMcpServer(payload.id);
      else if (payload.route === 'webhooks') await api.deleteWebhook(payload.id);
      return payload.route === 'mcp' || payload.route === 'webhooks' ? 'reload' : 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.integrationCreate:
      if (payload.route === 'mcp') {
        await api.addMcpServer({ name: payload.name || 'mcp-server', ...(payload.fields || {}) });
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
    case HERMES_SWIFTUI_ROUTE_ACTIONS.environmentUpsert:
      if (!payload.id && !payload.name) return 'none';
      await api.setEnvironmentVariable(payload.id || payload.name || '', payload.value || '');
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.environmentDelete:
      if (!payload.id) return 'none';
      await api.deleteEnvironmentVariable(payload.id);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemRestart:
      await api.restartGateway();
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.systemUpdate:
      await api.updateHermes();
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
    case HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationSend:
      if (!payload.id || !value) return 'none';
      await api.sendCollaborationRoomMessage(payload.id, value);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.sessionSelect:
    case HERMES_SWIFTUI_ROUTE_ACTIONS.logsFilter:
      return 'none';
    default:
      return 'none';
  }
}

function sessionsSnapshot(source: unknown): HermesSwiftUISessionSnapshot[] {
  if (!isRecord(source) || !Array.isArray(source.sessions)) return [];
  const selectedId = stringValue(source.selectedId);
  const selectedMessages = Array.isArray(source.selectedMessages)
    ? source.selectedMessages
    : [];
  const transcript = selectedMessages.flatMap((entry): string[] => {
    if (!isRecord(entry)) return [];
    const role = stringValue(entry.role) || 'message';
    const content = structuredContent(entry.content ?? entry.text);
    return content ? [`${role}: ${content}`] : [];
  }).join('\n\n');
  return source.sessions
    .filter(isSessionSummary)
    .map((session) => ({
      id: session.id,
      title: session.title?.trim() || session.preview?.trim() || '未命名会话',
      model: session.model?.trim() || 'Hermes',
      date: formatTimestamp(session.last_active || session.started_at),
      running: session.is_active,
      detail: session.id === selectedId && transcript
        ? transcript
        : `${session.message_count} 条消息 · ${session.tool_call_count} 次工具调用`,
    }));
}

function filesSnapshot(source: unknown): HermesSwiftUIFileSnapshot[] {
  if (!isRecord(source) || !Array.isArray(source.entries)) return [];
  const selectedId = stringValue(source.selectedId);
  const previewRoot = isRecord(source.selectedPreview) ? source.selectedPreview : {};
  const previewText = structuredContent(previewRoot.content ?? previewRoot.text);
  const children = Array.isArray(source.selectedChildren)
    ? source.selectedChildren.filter(isManagedFileEntry).map(fileSnapshot)
    : [];
  return source.entries
    .filter(isManagedFileEntry)
    .map((entry) => ({
      ...fileSnapshot(entry),
      ...(entry.path === selectedId && entry.is_directory ? { children } : {}),
      ...(entry.path === selectedId && !entry.is_directory ? { previewText } : {}),
    }));
}

function fileSnapshot(entry: ManagedFileEntry): HermesSwiftUIFileSnapshot {
  return {
    id: entry.path,
    name: entry.name,
    detail: entry.is_directory
      ? `文件夹 · ${formatTimestamp(entry.mtime)}`
      : `${formatBytes(entry.size)} · ${formatTimestamp(entry.mtime)}`,
    folder: entry.is_directory,
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
  const currentModel = stringValue(info.model) || stringValue(options.model);
  const currentProvider = stringValue(info.provider) || stringValue(options.provider);
  const providers = Array.isArray(options.providers) ? options.providers : [];
  const rows: HermesSwiftUIModelSnapshot[] = [];
  for (const providerEntry of providers) {
    if (!isRecord(providerEntry)) continue;
    const provider = stringValue(providerEntry.slug) || stringValue(providerEntry.name);
    const models = Array.isArray(providerEntry.models)
      ? providerEntry.models.filter((model): model is string => typeof model === 'string')
      : [];
    for (const model of models) {
      rows.push({
        id: encodeModelSelection(provider, model),
        provider,
        context: provider === currentProvider && model === currentModel
          ? formatContextLength(numberValue(info.effective_context_length))
          : '',
        active: provider === currentProvider && model === currentModel,
      });
    }
  }
  if (currentModel && !rows.some((row) => row.active)) {
    rows.unshift({
      id: encodeModelSelection(currentProvider, currentModel),
      provider: currentProvider,
      context: formatContextLength(numberValue(info.effective_context_length)),
      active: true,
    });
  }
  return rows;
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
  return rows.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.name) || stringValue(entry.id) || `skill-${index}`;
    return [{
      id,
      name: localizeHermesServerText(stringValue(entry.display_name) || stringValue(entry.name) || id, chinese),
      detail: localizeHermesServerText(stringValue(entry.description) || stringValue(entry.detail) || '', chinese),
      bundled: Boolean(entry.bundled || entry.source === 'bundled' || entry.provenance === 'bundled'),
      enabled: entry.enabled !== false,
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
      name: localizeHermesServerText(stringValue(entry.display_name) || stringValue(entry.name) || id, chinese),
      detail: localizeHermesServerText(
        stringValue(entry.description)
          || stringValue(entry.detail)
          || stringValue(entry.endpoint)
          || stringValue(entry.url)
          || [stringValue(entry.command), stringArray(entry.args).join(' ')].filter(Boolean).join(' '),
        chinese,
      ),
      enabled: entry.enabled !== false && entry.disabled !== true,
    }];
  });
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
  const id = stringValue(entry.id) || `column-${index}`;
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
  return Object.entries(root).flatMap(([key, value]) => {
    if (isRecord(value)) {
      return [{
        id: key,
        key,
        maskedValue: value.is_set === true
          ? stringValue(value.redacted_value) || '••••••••'
          : '未设置',
      }];
    }
    return [{
      id: key,
      key,
      maskedValue: typeof value === 'string' ? maskSecret(value) : '••••••••',
    }];
  });
}

function systemSnapshot(source: unknown): HermesSwiftUISystemSnapshot {
  const root = isRecord(source) ? source : {};
  const status = isRecord(root.status) ? root.status : {};
  const stats = isRecord(root.stats) ? root.stats : {};
  const memory = isRecord(stats.memory) ? stats.memory : {};
  const disk = isRecord(stats.disk) ? stats.disk : {};
  const gateway = isRecord(status.gateway) ? status.gateway : {};
  return {
    cpu: numberValue(stats.cpu_percent ?? stats.cpu),
    memory: numberValue(stats.memory_percent ?? memory.percent),
    disk: numberValue(stats.disk_percent ?? disk.percent),
    memoryLabel: stringValue(stats.memory_label)
      || formatBytes(numberValue(stats.memory_bytes ?? memory.used)),
    uptimeLabel: stringValue(stats.uptime)
      || formatDuration(numberValue(stats.uptime_seconds)),
    activeTasks: String(
      stats.active_tasks
        ?? status.active_tasks
        ?? status.active_sessions
        ?? '-',
    ),
    gatewayOnline: Boolean(
      status.online
        ?? status.gateway_online
        ?? status.gateway_running
        ?? gateway.running
        ?? status.running,
    ),
    operationMessage: stringValue(root.operation_message) || undefined,
  };
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 3)}${'•'.repeat(Math.min(12, value.length - 6))}${value.slice(-3)}`;
}

async function presentManagedFile(api: HermesCloudApi, path: string, name: string) {
  const blob = await api.downloadManagedFile(path);
  const [{ File, Paths }, quickLook, Sharing] = await Promise.all([
    import('expo-file-system'),
    import('../../modules/hermes-quick-look'),
    import('expo-sharing'),
  ]);
  const target = new File(Paths.cache, safeFileName(name));
  target.create({ intermediates: true, overwrite: true });
  target.write(new Uint8Array(await blob.arrayBuffer()));
  const presented = await quickLook.presentQuickLook(target.uri, name);
  if (!presented && await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(target.uri);
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
  const presented = await quickLook.presentQuickLook(target.uri, `${name}/SKILL.md`);
  if (!presented && await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(target.uri);
  }
}

function fileNameFromUri(value: string): string {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'attachment');
  } catch {
    return value.split(/[\\/]/).filter(Boolean).pop() || 'attachment';
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

function isManagedFileEntry(value: unknown): value is ManagedFileEntry {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.path === 'string'
    && typeof value.is_directory === 'boolean';
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
