import type {
  HermesSwiftUIAchievementsSnapshot,
  HermesSwiftUICollaborationSnapshot,
  HermesSwiftUIConfigSnapshot,
  HermesSwiftUICronJobSnapshot,
  HermesSwiftUIEnvironmentSecretSnapshot,
  HermesSwiftUIIntegrationSnapshot,
  HermesSwiftUIManagedInstallationSnapshot,
  HermesSwiftUIKanbanColumnSnapshot,
  HermesSwiftUILogSnapshot,
  HermesSwiftUIProfileSnapshot,
  HermesSwiftUIPairingSnapshot,
  HermesSwiftUISkillSnapshot,
} from '../swiftui-route-contract';
import {
  localizeHermesIntegrationDescription,
  localizeHermesIntegrationName,
} from '../../i18n/hermes-server-content-zh';
import {
  formatDateValue,
  hashString,
  inferLogLevel,
  isRecord,
  numberValue,
  stringArray,
  stringValue,
  structuredContent,
  type HermesRouteLocalizer,
} from './support';
export function logsSnapshot(source: unknown, localizer: HermesRouteLocalizer): HermesSwiftUILogSnapshot[] {
  if (!isRecord(source) || !Array.isArray(source.lines)) return [];
  return source.lines.flatMap((line, index): HermesSwiftUILogSnapshot[] => {
    if (typeof line !== 'string') return [];
    const match = line.match(
      /^(?<time>\d{4}-\d{2}-\d{2}[ T][^ ]+)\s+(?:\[[^\]]+\]\s+)?(?<level>DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\s+(?<message>.*)$/i,
    );
    return [{
      id: `log-${index}-${hashString(line)}`,
      level: match?.groups?.level?.toUpperCase() || inferLogLevel(line),
      message: localizer.serverText(match?.groups?.message || line),
      time: match?.groups?.time || '',
    }];
  });
}

export function cronSnapshot(source: unknown, localizer: HermesRouteLocalizer): HermesSwiftUICronJobSnapshot[] {
  const rows = Array.isArray(source)
    ? source
    : isRecord(source) && Array.isArray(source.jobs) ? source.jobs : [];
  return rows.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id) || `cron-${index}`;
    return [{
      id,
      name: localizer.serverText(stringValue(entry.name) || stringValue(entry.title) || id),
      schedule: stringValue(entry.schedule) || stringValue(entry.cron) || '-',
      prompt: localizer.serverText(stringValue(entry.prompt) || stringValue(entry.script) || ''),
      enabled: entry.enabled !== false && entry.paused !== true,
      lastRun: formatDateValue(entry.last_run || entry.lastRun || entry.updated_at),
    }];
  });
}

export function skillsSnapshot(source: unknown, localizer: HermesRouteLocalizer): HermesSwiftUISkillSnapshot[] {
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
      name: localizer.serverText(stringValue(entry.display_name) || stringValue(entry.name) || id),
      detail: localizer.serverText(stringValue(entry.description) || stringValue(entry.detail) || ''),
      bundled: Boolean(entry.bundled || entry.source === 'bundled' || entry.provenance === 'bundled'),
      enabled: entry.enabled !== false,
      ...(id === selectedId ? { content: selectedContent } : {}),
      notes: stringValue(entry.notes),
      source: stringValue(entry.source),
    }];
  });
}

export function integrationsSnapshot(source: unknown, kind: string, localizer: HermesRouteLocalizer): HermesSwiftUIIntegrationSnapshot[] {
  const mcpPayload = isRecord(source) && isRecord(source.servers) ? source.servers : {};
  const candidates = isRecord(source)
    ? kind === 'plugins' ? source.manifests
      : kind === 'mcp' ? mcpPayload.servers
        : kind === 'webhooks' ? source.subscriptions
          : source.platforms
    : source;
  const rows = Array.isArray(candidates) ? candidates : [];
  const integrations = rows.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.name) || stringValue(entry.id) || stringValue(entry.slug) || `${kind}-${index}`;
    return [{
      id,
      name: localizeHermesIntegrationName(
        id,
        stringValue(entry.display_name) || stringValue(entry.name) || id,
        kind,
        localizer.isChinese,
      ),
      detail: localizeHermesIntegrationDescription(
        id,
        stringValue(entry.description)
          || stringValue(entry.detail)
          || stringValue(entry.endpoint)
          || stringValue(entry.url)
          || [stringValue(entry.command), stringArray(entry.args).join(' ')].filter(Boolean).join(' '),
        kind,
        localizer.isChinese,
      ),
      enabled: entry.enabled !== false && entry.disabled !== true,
      ...(kind === 'plugins' ? {
        source: stringValue(entry.source),
        canUpdate: entry.can_update_git === true,
        canRemove: entry.can_remove === true,
        userHidden: entry.user_hidden === true,
        authRequired: entry.auth_required === true,
        authCommand: stringValue(entry.auth_command),
      } : {}),
      ...(kind === 'mcp' ? { canTest: true } : {}),
      ...(kind === 'channels' ? { configuration: channelConfiguration(entry) } : {}),
    }];
  });
  if (kind !== 'mcp' || !isRecord(source) || !isRecord(source.catalog)) return integrations;
  const catalogEntries = Array.isArray(source.catalog.entries) ? source.catalog.entries : [];
  const configuredNames = new Set(integrations.map((entry) => entry.id));
  const catalogRows = catalogEntries.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const name = stringValue(entry.name);
    if (!name || configuredNames.has(name)) return [];
    const requiredEnv = Array.isArray(entry.required_env)
      ? entry.required_env.flatMap((item) => isRecord(item) && stringValue(item.name)
        ? [stringValue(item.name)]
        : [])
      : [];
    const description = localizer.serverText(
      stringValue(entry.description)
        || stringValue(entry.url)
        || stringValue(entry.command)
        || 'MCP catalog entry',
    );
    return [{
      id: name,
      name: localizer.serverText(stringValue(entry.name) || name),
      detail: requiredEnv.length
        ? `${description} · ${localizer.isChinese ? '需要凭据' : 'credentials required'}: ${requiredEnv.join(', ')}`
        : description,
      enabled: entry.enabled === true,
      source: 'catalog',
      catalogEntry: true,
      catalogNeedsInstall: entry.needs_install === true,
      catalogRequiredEnv: requiredEnv,
      canTest: false,
      canRemove: false,
      configuration: JSON.stringify({
        args: stringArray(entry.args),
        command: stringValue(entry.command),
        installRef: stringValue(entry.install_ref),
        installUrl: stringValue(entry.install_url),
        requiredEnv,
        url: stringValue(entry.url),
      }),
    }];
  });
  return [...integrations, ...catalogRows];
}

export function managedInstallationsSnapshot(
  source: unknown,
  kind: 'mcp' | 'project' | 'skill',
): HermesSwiftUIManagedInstallationSnapshot[] {
  const container = isRecord(source) && isRecord(source.installations)
    ? source.installations
    : {};
  const rows = Array.isArray(container.operations) ? container.operations : [];
  const normalizedRows = rows.filter(isRecord);
  const rollbacksByInstallation = new Map(
    normalizedRows
      .filter((entry) => stringValue(entry.action) === 'rollback')
      .map((entry) => [stringValue(entry.rollback_of), entry]),
  );
  const resourceCatalog = isRecord(source) && isRecord(source.resourceCatalog)
    ? source.resourceCatalog
    : {};
  const resources = Array.isArray(resourceCatalog.resources)
    ? resourceCatalog.resources.filter(isRecord)
    : [];
  return normalizedRows.flatMap((installation): HermesSwiftUIManagedInstallationSnapshot[] => {
    if (
      stringValue(installation.kind) !== kind
      || stringValue(installation.action) === 'rollback'
    ) return [];
    const installId = stringValue(installation.id);
    const entry = rollbacksByInstallation.get(installId) || installation;
    const id = stringValue(entry.id);
    if (!id) return [];
    const resource = resources.find((candidate) => (
      stringValue(candidate.install_operation_id) === installId
      || stringValue(candidate.operation_id) === id
    ));
    const targets = Array.isArray(entry.targets) ? entry.targets : [];
    return [{
      id,
      identifier: stringValue(installation.identifier),
      kind,
      state: stringValue(resource?.aggregate_state)
        || stringValue(entry.aggregate_state)
        || stringValue(entry.state),
      error: stringValue(entry.error),
      health: stringValue(resource?.health),
      version: stringValue(resource?.resolved_commit_or_version),
      tools: stringArray(resource?.tools),
      permissions: stringArray(resource?.permissions),
      lastVerifiedAt: stringValue(resource?.last_verified_at),
      rollbackAvailable: resource?.rollback_available === true
        && stringValue(entry.action) !== 'rollback',
      targets: targets.flatMap((target) => {
        if (!isRecord(target)) return [];
        const nodeId = stringValue(target.node_id);
        if (nodeId !== 'server' && nodeId !== 'dbb3' && nodeId !== 'wsl' && nodeId !== 'hk') return [];
        return [{
          nodeId,
          state: stringValue(target.state),
          error: stringValue(target.error),
        }];
      }),
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

export function pairingSnapshot(source: unknown, localizer: HermesRouteLocalizer): HermesSwiftUIPairingSnapshot {
  if (!isRecord(source)) return { pending: [], approved: [] };
  return {
    pending: pairingEntries(source.pending, true, localizer),
    approved: pairingEntries(source.approved, false, localizer),
  };
}

function pairingEntries(value: unknown, pending: boolean, localizer: HermesRouteLocalizer) {
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
        ? localizer.choose(
          `${userName || userId || '未知用户'} · ${age} 分钟前`,
          `${userName || userId || 'Unknown user'} · ${age} min ago`,
        )
        : userName || userId,
    }];
  });
}

export function achievementsSnapshot(source: unknown, localizer: HermesRouteLocalizer): HermesSwiftUIAchievementsSnapshot {
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
        title: localizer.serverText(stringValue(entry.title) || stringValue(entry.name) || ''),
        detail: localizer.serverText(stringValue(entry.description) || stringValue(entry.detail) || ''),
        symbol: stringValue(entry.symbol) || 'checkmark.seal',
        progress: Math.max(0, Math.min(1, numberValue(entry.progress))),
      }];
    }),
  };
}

export function collaborationSnapshot(source: unknown): HermesSwiftUICollaborationSnapshot {
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

export function kanbanSnapshot(source: unknown, localizer: HermesRouteLocalizer): HermesSwiftUIKanbanColumnSnapshot[] {
  const root = isRecord(source) ? source : {};
  const columns = Array.isArray(root.columns) ? root.columns : [];
  if (columns.length) return columns.flatMap((entry, index) => kanbanColumn(entry, index, localizer));
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
    title: localizer.serverText(id),
    cards: cards.map((entry, index) => ({
      id: stringValue(entry.id) || `${id}-${index}`,
      title: localizer.serverText(stringValue(entry.title) || stringValue(entry.name) || ''),
      detail: localizer.serverText(stringValue(entry.description) || stringValue(entry.detail) || ''),
    })),
  }));
}

function kanbanColumn(entry: unknown, index: number, localizer: HermesRouteLocalizer): HermesSwiftUIKanbanColumnSnapshot[] {
  if (!isRecord(entry)) return [];
  const id = stringValue(entry.id) || stringValue(entry.name) || `column-${index}`;
  const cards = Array.isArray(entry.cards) ? entry.cards : Array.isArray(entry.tasks) ? entry.tasks : [];
  return [{
    id,
    title: localizer.serverText(stringValue(entry.title) || stringValue(entry.name) || id),
    cards: cards.flatMap((card, cardIndex) => isRecord(card) ? [{
      id: stringValue(card.id) || `${id}-${cardIndex}`,
      title: localizer.serverText(stringValue(card.title) || stringValue(card.name) || ''),
      detail: localizer.serverText(stringValue(card.description) || stringValue(card.detail) || ''),
    }] : []),
  }];
}

export function profilesSnapshot(source: unknown, localizer: HermesRouteLocalizer): HermesSwiftUIProfileSnapshot[] {
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
      name: localizer.serverText(stringValue(entry.display_name) || stringValue(entry.name) || id),
      model: stringValue(entry.model) || '',
      detail: localizer.serverText(stringValue(entry.description) || stringValue(entry.detail) || ''),
      active: Boolean(entry.active) || id === active,
      soul: stringValue(entry.soul),
      terminalAccess: entry.terminal_access !== false,
      fileAccess: entry.file_access !== false,
      browserAccess: entry.browser_access !== false,
    }];
  });
}

export function configSnapshot(source: unknown): HermesSwiftUIConfigSnapshot {
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

export function environmentSnapshot(source: unknown): HermesSwiftUIEnvironmentSecretSnapshot[] {
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
