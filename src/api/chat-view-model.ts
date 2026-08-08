import type {
  CollaborationMessage,
  JsonRecord,
  SingleConversation,
} from './HermesCloudApi';
import {
  HOSTED_TURN_FRESHNESS_MS,
  RUNTIME_RUN_FRESHNESS_MS,
  runningConversationRecordIsFresh,
} from './HermesCloudApi';
import type {
  ConversationCollaborationState,
  HermesChatActivity,
  HermesChatActivityStatus,
  HermesChatAttachment,
  HermesChatAvatarRole,
  HermesChatTodo,
  HermesChatViewMessage,
  HostedTurnVisibilityFailure,
} from './chat-view-types';
import {
  isRecord,
  numberValue,
  stringListValue,
  stringValue,
  structuredText,
  timestampValue,
} from './chat-view-values';
import {
  TERMINAL_TURN_STATES,
  calculateDurationMs,
  firstActivityTimestamp,
  formatDuration,
  isTerminalStatus,
  lastActivityTimestamp,
  messageIsRunning,
  normalizeMessageStatus,
  normalizeStatus,
} from './chat-view-timing';
import {
  isChatRuntimeStatusActivity,
  latestChatRuntimeWaitingState,
} from './chat-runtime-state';

export type {
  ConversationCollaborationState,
  HermesChatActivity,
  HermesChatActivityStatus,
  HermesChatAttachment,
  HermesChatAvatarRole,
  HermesChatRoleStage,
  HermesChatViewMessage,
  HostedTurnVisibilityFailure,
} from './chat-view-types';

export {
  formatActivitySummary,
  formatMessageLocalTime,
  messageDurationMs,
  messageHasExecutionTiming,
  messageIsRunning,
  messageStatusLabel,
} from './chat-view-timing';

export function hostedTurnVisibilityFailure(
  turnId: string,
  chinese = true,
  failedAt = Date.now(),
): HostedTurnVisibilityFailure {
  return {
    turnId,
    message: {
      avatarRole: 'hermes',
      content: chinese
        ? '服务器没有确认任务已启动，请检查模型配置或网络后重试。'
        : 'The server did not confirm that the task started. Check the model configuration or network and try again.',
      completedAt: failedAt,
      createdAt: failedAt,
      durationMs: 0,
      id: `hosted-sync-failed-${turnId}`,
      name: 'Hermes Agent',
      role: 'assistant',
      roleLabel: chinese ? '任务未启动' : 'Task not started',
      roleStage: 'chat',
      status: 'failed',
      updatedAt: failedAt,
    },
  };
}

export function conversationMessagesToView(
  conversation: SingleConversation,
  chinese = true,
  now = Date.now(),
): HermesChatViewMessage[] {
  const sourceMessages = conversation.messages ?? [];
  const finalChatIndices = latestFinalChatMessageIndices(sourceMessages);
  const terminalTurnIds = terminalHostedTurnIds(conversation, finalChatIndices);
  const cancelledTurnIds = cancelledHostedTurnIds(conversation);
  const converted = sourceMessages.flatMap((message, index) => {
    if (shouldHideSupersededChatMessage(
      message,
      finalChatIndices,
      terminalTurnIds,
      cancelledTurnIds,
      index,
    )) return [];
    const converted = collaborationMessageToView(message, chinese, now);
    if (!converted) return [];
    const meta = messageMetadata(message);
    const turnId = messageRuntimeTurnId(message, meta);
    const terminal = hostedTurnTerminalAuthority(conversation, turnId);
    if (!terminal) return [converted];
    return [{
      ...converted,
      activities: converted.activities?.map((activity) => (
        activity.status === 'queued' || activity.status === 'running'
          ? {
              ...activity,
              completedAt: activity.completedAt || terminal.completedAt || undefined,
              status: terminal.status,
            }
          : activity
      )),
      completedAt: converted.completedAt || terminal.completedAt || undefined,
      status: ['queued', 'running'].includes(converted.status || '')
        ? terminal.status
        : converted.status,
      updatedAt: terminal.completedAt || converted.updatedAt,
    }];
  });
  const messages = deduplicateMessages(converted);
  if (conversationCollaborationState(conversation) !== 'single') return messages;
  return messages.map((message) => {
    const ordinaryMessage = message.role === 'assistant'
      && message.status === 'failed'
      && /^服务端托管任务失败[：:]/.test(message.content)
      ? {
          ...message,
          content: message.content.replace(/^服务端托管任务失败[：:]/, '对话运行失败：'),
        }
      : message;
    return ordinaryMessage.role === 'assistant'
      && ordinaryMessage.status === 'failed'
      && ordinaryMessage.roleStage
      && ordinaryMessage.roleStage !== 'chat'
      ? {
          ...ordinaryMessage,
          avatarRole: 'hermes' as const,
          name: 'Hermes Agent',
          roleLabel: chinese ? '运行失败' : 'Run failed',
          roleStage: 'chat' as const,
        }
      : ordinaryMessage;
  });
}

function cancelledHostedTurnIds(conversation: SingleConversation): Set<string> {
  const cancelled = new Set<string>();
  for (const [key, record] of Object.entries(conversation.hosted_turns || {})) {
    if (!isRecord(record) || terminalStatus(record.status) !== 'cancelled') continue;
    const turnId = stringValue(record.turn_id) || stringValue(record.id) || key;
    if (turnId) cancelled.add(turnId);
  }
  for (const message of conversation.messages || []) {
    const meta = messageMetadata(message);
    if (!meta.final_report || terminalStatus(message.status || meta.status) !== 'cancelled') {
      continue;
    }
    const turnId = messageRuntimeTurnId(message, meta);
    if (turnId) cancelled.add(turnId);
  }
  return cancelled;
}

function terminalHostedTurnIds(
  conversation: SingleConversation,
  finalChatIndices: ReadonlyMap<string, number>,
): Set<string> {
  const terminal = new Set(finalChatIndices.keys());
  for (const [key, record] of Object.entries(conversation.hosted_turns || {})) {
    if (!isRecord(record) || !terminalStatus(record.status)) continue;
    const turnId = stringValue(record.turn_id) || stringValue(record.id) || key;
    if (turnId) terminal.add(turnId);
  }
  for (const message of conversation.messages || []) {
    const meta = messageMetadata(message);
    const turnId = messageRuntimeTurnId(message, meta);
    if (!turnId || !terminalStatus(message.status || meta.status)) continue;
    if (meta.final_report || isFinalChatMessage(message, meta)) terminal.add(turnId);
  }
  return terminal;
}

function latestFinalChatMessageIndices(
  messages: readonly CollaborationMessage[],
): Map<string, number> {
  const latest = new Map<string, number>();
  messages.forEach((message, index) => {
    const meta = messageMetadata(message);
    const turnId = messageRuntimeTurnId(message, meta);
    if (turnId && isFinalChatMessage(message, meta)) latest.set(turnId, index);
  });
  return latest;
}

function shouldHideSupersededChatMessage(
  message: CollaborationMessage,
  finalChatIndices: ReadonlyMap<string, number>,
  terminalTurnIds: ReadonlySet<string>,
  cancelledTurnIds: ReadonlySet<string>,
  index: number,
): boolean {
  const meta = messageMetadata(message);
  const turnId = messageRuntimeTurnId(message, meta);
  if (!turnId) return false;
  if (cancelledTurnIds.has(turnId) && chatMessageBaseStage(meta) === 'chat') return true;
  const finalIndex = finalChatIndices.get(turnId);
  if (isFinalChatMessage(message, meta)) return finalIndex !== index;
  return terminalTurnIds.has(turnId) && isSupersededChatProgress(message, meta);
}

function messageRuntimeTurnId(
  message: CollaborationMessage,
  meta = messageMetadata(message),
): string {
  const direct = stringValue(meta.runtime_turn_id) || stringValue(meta.turn_id);
  if (direct) return direct;
  const key = stringValue(meta.message_key);
  const separator = key.indexOf(':');
  return separator > 0 ? key.slice(0, separator) : '';
}

function chatMessageBaseStage(meta: JsonRecord): string {
  return stringValue(meta.base_role_stage || meta.role_stage)
    .toLowerCase()
    .split(/[.:/]/, 1)[0];
}

function isFinalChatMessage(
  message: CollaborationMessage,
  meta: JsonRecord,
): boolean {
  if (chatMessageBaseStage(meta) !== 'chat') return false;
  const phase = stringValue(meta.phase).toLowerCase();
  const key = stringValue(meta.message_key).toLowerCase();
  const status = terminalStatus(message.status || meta.status);
  return phase === 'completed'
    || /:chat:(?:completed|failed|cancelled|canceled|stopped)$/.test(key)
    || Boolean(meta.final_report && status);
}

function isSupersededChatProgress(
  message: CollaborationMessage,
  meta: JsonRecord,
): boolean {
  if (chatMessageBaseStage(meta) !== 'chat') return false;
  const phase = stringValue(meta.phase).toLowerCase();
  const roleStage = stringValue(meta.role_stage).toLowerCase();
  const key = stringValue(meta.message_key).toLowerCase();
  return phase === 'opening'
    || phase === 'progress'
    || phase === 'milestone'
    || roleStage === 'chat.opening'
    || roleStage === 'chat.progress'
    || roleStage.startsWith('chat.milestone')
    || /:chat:(?:opening|progress|milestone(?:\.\d+)?)$/.test(key);
}

export function chatModelConfigurationError(
  source: { custom?: unknown; info: unknown; options: unknown },
  chinese = true,
): string | null {
  const info = isRecord(source.info) ? source.info : {};
  const options = isRecord(source.options) ? source.options : {};
  const custom = isRecord(source.custom) ? source.custom : {};
  const model = stringValue(info.model) || stringValue(options.model) || stringValue(custom.model);
  const customBaseUrl = stringValue(custom.baseUrl);
  const provider = stringValue(info.provider)
    || stringValue(options.provider)
    || (customBaseUrl ? 'custom' : '');
  const customActive = provider.toLowerCase() === 'custom';
  if (!model || !provider || (customActive && !customBaseUrl)) {
    return chinese
      ? '尚未配置可用模型。请先在“模型与工具”中填写 Base URL、API 密钥并选择模型。'
      : 'No usable model is configured. Add a Base URL and API key, then select a model in Model & tools.';
  }
  const providers = Array.isArray(options.providers) ? options.providers : [];
  const currentProvider = providers.find((entry) => {
    if (!isRecord(entry)) return false;
    const slug = stringValue(entry.slug) || stringValue(entry.name);
    return Boolean(provider) && slug.toLowerCase() === provider.toLowerCase();
  });
  if (
    (customActive && custom.apiKeyConfigured === false)
    || (isRecord(currentProvider) && currentProvider.authenticated === false)
  ) {
    return chinese
      ? '当前模型没有可用的连接凭据。请在“模型与工具”中检查提供商登录或密钥配置后重试。'
      : 'The current model has no usable credentials. Check the provider sign-in or key in Model & tools.';
  }
  return null;
}

export function shouldRenderPendingMessage(
  messages: HermesChatViewMessage[],
  sending: boolean,
): boolean {
  if (!sending) return false;
  const latest = messages[messages.length - 1];
  if (latest?.role !== 'assistant') return true;
  if (latest.activities?.length || latest.timingLabel) return false;
  return latest.roleStage === 'chat'
    && (!latest.status || messageIsRunning(latest))
    && !latest.content.trim()
    && !latest.attachments?.length;
}

export function upsertChatMessage(
  messages: HermesChatViewMessage[],
  message: HermesChatViewMessage,
): HermesChatViewMessage[] {
  const index = messages.findIndex(({ id }) => id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((current, currentIndex) => (
    currentIndex === index ? { ...current, ...message } : current
  ));
}

export function reconcileOptimisticMessages(
  serverMessages: HermesChatViewMessage[],
  optimisticMessages: HermesChatViewMessage[],
  now = Date.now(),
  protectedMessageIds: ReadonlySet<string> = new Set(),
): { messages: HermesChatViewMessage[]; pending: HermesChatViewMessage[] } {
  const consumedServerMessageIds = new Set<string>();
  const hiddenServerMessageIds = new Set<string>();
  const pending = optimisticMessages.flatMap((optimistic) => {
    const supersededLocalFailure = optimistic.role === 'assistant'
      && optimistic.status === 'failed'
      && Boolean(optimistic.runtimeTurnId)
      && serverMessages.some((serverMessage) => (
        serverMessage.role === 'assistant'
        && serverMessage.runtimeTurnId === optimistic.runtimeTurnId
        && ['completed', 'failed', 'cancelled'].includes(serverMessage.status || '')
    ));
    if (supersededLocalFailure) return [];
    const exactConfirmation = serverMessages.find((serverMessage) => (
      !consumedServerMessageIds.has(serverMessage.id)
      && serverMessage.id === optimistic.id
      && serverMessage.role === optimistic.role
      && (
        optimistic.role !== 'user'
        || serverMessage.content === optimistic.content
      )
      && (
        optimistic.status !== 'failed'
        || (
          serverMessage.status === 'failed'
          && serverMessage.content === optimistic.content
        )
      )
    ));
    const turnConfirmation = exactConfirmation || (
      optimistic.role === 'user' && optimistic.runtimeTurnId
        ? serverMessages.find((serverMessage) => (
            !consumedServerMessageIds.has(serverMessage.id)
            && serverMessage.role === 'user'
            && serverMessage.runtimeTurnId === optimistic.runtimeTurnId
            && serverMessage.content === optimistic.content
          ))
        : undefined
    );
    const optimisticCreatedAt = optimistic.createdAt || optimistic.updatedAt || 0;
    const contentConfirmation = turnConfirmation || (
      optimistic.role === 'user'
        ? serverMessages
          .filter((serverMessage) => {
            const serverCreatedAt = serverMessage.createdAt || serverMessage.updatedAt || 0;
            return !consumedServerMessageIds.has(serverMessage.id)
              && serverMessage.role === 'user'
              && serverMessage.content === optimistic.content
              && optimisticCreatedAt > 0
              && serverCreatedAt > 0
              && Math.abs(serverCreatedAt - optimisticCreatedAt)
                <= OPTIMISTIC_USER_CONFIRMATION_WINDOW_MS;
          })
          .sort((left, right) => (
            Math.abs((left.createdAt || left.updatedAt || 0) - optimisticCreatedAt)
            - Math.abs((right.createdAt || right.updatedAt || 0) - optimisticCreatedAt)
          ))[0]
        : undefined
    );
    if (!contentConfirmation) return [optimistic];
    consumedServerMessageIds.add(contentConfirmation.id);
    if (protectedMessageIds.has(optimistic.id)) {
      hiddenServerMessageIds.add(contentConfirmation.id);
      return [{
        ...optimistic,
        optimisticConfirmedAt: optimistic.optimisticConfirmedAt || now,
      }];
    }
    if (
      optimistic.optimisticConfirmedAt
      && now - optimistic.optimisticConfirmedAt >= OPTIMISTIC_CONFIRMATION_GRACE_MS
    ) return [];
    hiddenServerMessageIds.add(contentConfirmation.id);
    return [{
      ...optimistic,
      optimisticConfirmedAt: optimistic.optimisticConfirmedAt || now,
    }];
  });
  const pendingIds = new Set(pending.map(({ id }) => id));
  // Keep the server's own ordering for confirmed messages and append
  // optimistic entries in send order. Sorting the merged list by createdAt
  // mixes client-clock timestamps (optimistic messages) with server-clock
  // timestamps, so any clock skew reorders previous messages on every
  // snapshot — the visible "jump" when a new message is sent.
  return {
    messages: [
      ...serverMessages.filter(({ id }) => (
        !pendingIds.has(id) && !hiddenServerMessageIds.has(id)
      )),
      ...pending,
    ],
    // A server replica can confirm a message and then briefly return an older
    // snapshot. Require another confirmation after the grace period before
    // deleting the durable ledger entry.
    pending,
  };
}

const OPTIMISTIC_CONFIRMATION_GRACE_MS = 2 * 60 * 1_000;
const OPTIMISTIC_USER_CONFIRMATION_WINDOW_MS = 15_000;

export function collaborationMessageToView(
  message: CollaborationMessage,
  chinese = true,
  now = Date.now(),
): HermesChatViewMessage | null {
  const kind = message.kind ?? '';
  if (kind === 'route') return null;
  const isUser = message.role === 'user';
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const meta = {
    ...metadata,
    ...(isRecord(message.meta) ? message.meta : {}),
  };
  const logicalRole = stringValue(message.sender_role)
    || stringValue(message.collaboration_role)
    || stringValue(meta.role_stage)
    || message.role;
  const logicalRoleBase = logicalRole.toLowerCase().split(/[.:/]/, 1)[0];
  const isVisibleSystemEvent = message.role === 'system'
    && (kind === 'workflow' || Boolean(stringValue(message.sender_role) || stringValue(message.collaboration_role)));
  const isAssistantRole = message.role === 'assistant' || [
    'assistant',
    'chat',
    'dbb3-worker',
    'dbb3_worker',
    'dispatch',
    'dispatcher',
    'manager',
    'hermes',
    'pc-worker',
    'pc_worker',
    'pc-wsl-worker',
    'pc_wsl_worker',
    'reporter',
    'reviewer',
    'supervisor',
    'worker',
  ].includes(logicalRoleBase);
  if (!isUser && !isAssistantRole && !isVisibleSystemEvent) return null;
  const roleStage = normalizeRoleStage(logicalRole, isUser);
  const profile = stringValue(message.profile)
    || stringValue(meta.profile)
    || stringValue(message.name);
  const senderName = stringValue(message.sender_name)
    || stringValue(message.sender)
    || stringValue(meta.sender_name)
    || stringValue(message.name);
  const name = isUser
    ? chinese ? '你' : 'You'
    : profileDisplayName(senderName || profile, roleStage, chinese);
  const roleLabel = stringValue(message.role_label)
    || stringValue(meta.role_label)
    || roleStageLabel(roleStage || 'chat', chinese);
  const provider = stringValue(message.provider)
    || stringValue(meta.actual_provider)
    || stringValue(meta.provider);
  const model = stringValue(message.model)
    || stringValue(meta.actual_model)
    || stringValue(meta.model);
  const runtimeTurnId = messageRuntimeTurnId(message, meta);
  const runtimeSessionId = stringValue(meta.runtime_session_id);
  const runtimeMessageId = numberValue(meta.runtime_message_id);
  const mappedActivities = mapActivities(message, meta);
  const createdAt = timestampValue(message.created_at)
    || timestampValue(message.timestamp)
    || timestampValue(meta.created_at);
  const modelStartedAt = timestampValue(meta.model_started_at);
  let startedAt = timestampValue(message.started_at)
    || timestampValue(meta.started_at)
    || createdAt
    || firstActivityTimestamp(mappedActivities);
  const rawStatus = normalizeMessageStatus(
    message.status
      || meta.status
      || (mappedActivities?.some(({ status }) => status === 'running') ? 'running' : 'completed'),
  );
  const statusIsRunning = ['queued', 'running'].includes(rawStatus);
  const messageFreshnessMs = (
    stringValue(meta.runtime_turn_id)
    || stringValue(meta.message_key).includes(':')
  )
    ? HOSTED_TURN_FRESHNESS_MS
    : RUNTIME_RUN_FRESHNESS_MS;
  const staleRunning = statusIsRunning && !runningConversationRecordIsFresh(
    { ...meta, ...message, status: rawStatus },
    messageFreshnessMs,
    now,
  );
  const status = staleRunning ? 'failed' : rawStatus;
  const terminal = isTerminalStatus(status);
  const serverUpdatedAt = timestampValue(message.updated_at)
    || timestampValue(meta.updated_at);
  const activities = staleRunning
    ? mappedActivities?.map((activity) => (
        activity.status === 'running' || activity.status === 'queued'
          ? {
              ...activity,
              completedAt: activity.completedAt
                || serverUpdatedAt
                || activity.startedAt
                || createdAt
                || undefined,
              status: 'failed' as const,
            }
          : activity
      ))
    : mappedActivities;
  let timingLabel = '';
  if (!terminal && roleStage === 'chat') {
    const firstTokenAt = timestampValue(meta.first_token_at);
    if (firstTokenAt || message.content) {
      const executing = (activities || []).some((activity) => (
        activity.category !== 'reasoning'
        && !isChatRuntimeStatusActivity(activity)
        && (activity.status === 'queued' || activity.status === 'running')
      ));
      const reasoning = !message.content && (activities || []).some((activity) => (
        activity.category === 'reasoning'
        && Boolean(activity.output?.trim() || activity.preview?.trim())
      ));
      timingLabel = executing
        ? (chinese ? '正在执行' : 'Executing')
        : reasoning
          ? (chinese ? '正在思考' : 'Thinking')
          : (chinese ? '正在回复' : 'Responding');
      startedAt = firstTokenAt || startedAt;
    } else {
      const runtimeState = latestChatRuntimeWaitingState(activities || []);
      if (runtimeState?.phase === 'reconnecting') {
        timingLabel = chinese
          ? `正在重新连接 (${runtimeState.attempt}/${runtimeState.maxAttempts})`
          : `Reconnecting (${runtimeState.attempt}/${runtimeState.maxAttempts})`;
        startedAt = runtimeState.startedAt || startedAt;
      } else if (runtimeState?.phase === 'thinking') {
        timingLabel = '';
        startedAt = 0;
      } else {
        timingLabel = '';
        startedAt = 0;
      }
    }
  }
  const completedAt = timestampValue(message.completed_at)
    || timestampValue(meta.completed_at)
    || (terminal ? serverUpdatedAt : 0)
    || (terminal ? lastActivityTimestamp(activities) : 0);
  const updatedAt = serverUpdatedAt
    || completedAt
    || createdAt;
  const explicitDuration = numberValue(meta.duration_ms);
  const durationMs = explicitDuration > 0
    ? explicitDuration
    : calculateDurationMs(startedAt, completedAt || updatedAt, activities);
  return {
    activities,
    attachments: mapMessageAttachments([
      ...(Array.isArray(message.attachments) ? message.attachments : []),
      ...(Array.isArray(meta.attachments) ? meta.attachments : []),
    ]),
    avatarRole: avatarRoleFor(profile, roleStage, isUser),
    avatarSymbol: stringValue(message.avatar_symbol)
      || stringValue(meta.avatar_symbol)
      || undefined,
    avatarUrl: stringValue(message.avatar)
      || stringValue(meta.avatar)
      || stringValue(meta.avatar_url)
      || undefined,
    completedAt: completedAt || undefined,
    content: message.content || '',
    createdAt: createdAt || undefined,
    durationMs,
    firstTokenAt: timestampValue(meta.first_token_at) || undefined,
    handoffTarget: stringListValue(message.handoff_to)
      || stringListValue(meta.handoff_to)
      || stringListValue(meta.handoff_target)
      || undefined,
    id: message.id,
    memberId: stringValue(message.member_id)
      || stringValue(meta.member_id)
      || undefined,
    modelStartedAt: modelStartedAt || undefined,
    model: [provider, model].filter(Boolean).join(' · ') || undefined,
    name,
    optimisticConfirmedAt: timestampValue(meta.optimistic_confirmed_at) || undefined,
    profile: profile || undefined,
    provider: provider || undefined,
    rawRoleStage: stringValue(meta.role_stage) || undefined,
    role: isUser ? 'user' : 'assistant',
    roleLabel,
    roleStage,
    runtimeMessageId: runtimeMessageId > 0 ? runtimeMessageId : undefined,
    runtimeSessionId: runtimeSessionId || undefined,
    runtimeTurnId: runtimeTurnId || undefined,
    senderId: stringValue(message.sender_id)
      || stringValue(meta.sender_id)
      || undefined,
    startedAt: startedAt || undefined,
    status,
    timingLabel: timingLabel || undefined,
    updatedAt: updatedAt || undefined,
  };
}

function mapMessageAttachments(value: unknown): HermesChatAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments = value.flatMap((entry): HermesChatAttachment[] => {
    if (!isRecord(entry)) return [];
    const downloadUrl = stringValue(entry.download_url);
    const name = stringValue(entry.name);
    if (!downloadUrl || !name) return [];
    const size = numberValue(entry.size);
    const sha256 = stringValue(entry.sha256);
    return [{
      downloadUrl,
      id: stringValue(entry.id) || downloadUrl,
      mimeType: stringValue(entry.mime_type) || undefined,
      name,
      ...(/^[a-f0-9]{64}$/i.test(sha256) ? { sha256: sha256.toLowerCase() } : {}),
      size: size > 0 ? size : undefined,
    }];
  });
  return [...new Map(attachments.map((attachment) => [attachment.id, attachment])).values()];
}

export function conversationHasRunningWork(
  conversation: SingleConversation,
  now = Date.now(),
): boolean {
  const hostedRunning = Object.entries(conversation.hosted_turns || {}).some(([key, record]) => {
    if (!isRecord(record)) return false;
    const turnId = stringValue(record.turn_id) || stringValue(record.id) || key;
    return !hostedTurnHasTerminalMessage(conversation, turnId)
      && runningConversationRecordIsFresh(record, HOSTED_TURN_FRESHNESS_MS, now);
  });
  return hostedRunning || hasRunningRecord(
    conversation.runtime_runs,
    RUNTIME_RUN_FRESHNESS_MS,
    now,
  );
}

const ACTIVE_COLLABORATION_STAGES = new Set([
  'cancel_requested',
  'dispatching',
  'manager_handoff',
  'manager_planning',
  'reporting',
  'reviewing',
  'rework',
  'running',
  'worker_running',
]);

const COLLABORATION_ROLE_PATTERN = /(?:^|[.:/_-])(dispatch|manager|reporter|reviewer|supervisor|worker)(?:$|[.:/_-])/i;
const ACTIVE_COLLABORATION_MESSAGE_STATUSES = new Set([
  'accepted',
  'pending',
  'queued',
  'running',
  'starting',
  'streaming',
]);

/**
 * Resolves the collaboration surface from the authoritative conversation.
 * A routed work turn starts in `lifting`; only persisted workflow progress (or
 * a collaboration role message) promotes the same conversation to `active`.
 */
export function conversationCollaborationState(
  conversation: SingleConversation,
): ConversationCollaborationState {
  let routedWorkFound = false;
  for (const record of Object.values(conversation.hosted_turns || {})) {
    if (!isRecord(record)) continue;
    const routeMetadata = isRecord(record.route_metadata) ? record.route_metadata : {};
    const mode = (stringValue(record.mode) || stringValue(routeMetadata.mode)).toLowerCase();
    if (mode !== 'work') continue;
    const stage = stringValue(record.stage).toLowerCase();
    const status = stringValue(record.status).toLowerCase();
    if (TERMINAL_TURN_STATES.has(status)) continue;
    routedWorkFound = true;
    if (ACTIVE_COLLABORATION_STAGES.has(stage)) {
      return 'active';
    }
  }
  for (const message of conversation.messages || []) {
    const meta = messageMetadata(message);
    const role = stringValue(meta.base_role_stage)
      || stringValue(meta.role_stage)
      || stringValue(message.sender_role)
      || stringValue(message.collaboration_role);
    const match = role.match(COLLABORATION_ROLE_PATTERN);
    if (!match) continue;
    const status = stringValue(message.status || meta.status).toLowerCase();
    if (ACTIVE_COLLABORATION_MESSAGE_STATUSES.has(status)) return 'active';
  }
  return routedWorkFound ? 'lifting' : 'single';
}

export function conversationRunningHostedTurnId(
  conversation: SingleConversation,
  now = Date.now(),
): string {
  const running = Object.entries(conversation.hosted_turns || {}).flatMap(([key, record]) => {
    if (!isRecord(record)) return [];
    if (!runningConversationRecordIsFresh(record, HOSTED_TURN_FRESHNESS_MS, now)) return [];
    const id = stringValue(record.turn_id) || stringValue(record.id) || key;
    if (!id) return [];
    if (hostedTurnHasTerminalMessage(conversation, id)) return [];
    return [{
      id,
      timestamp: timestampValue(record.updated_at)
        || timestampValue(record.created_at)
        || timestampValue(record.started_at),
    }];
  });
  running.sort((left, right) => right.timestamp - left.timestamp);
  return running[0]?.id || '';
}

export function conversationHostedTurnState(
  conversation: SingleConversation,
  turnId: string,
  now = Date.now(),
): 'missing' | 'running' | 'terminal' {
  const normalizedTurnId = turnId.trim();
  if (!normalizedTurnId) return 'missing';
  if (hostedTurnHasTerminalMessage(conversation, normalizedTurnId)) return 'terminal';
  for (const [key, record] of Object.entries(conversation.hosted_turns || {})) {
    if (!isRecord(record)) continue;
    const id = stringValue(record.turn_id) || stringValue(record.id) || key;
    if (id !== normalizedTurnId) continue;
    return runningConversationRecordIsFresh(
      record,
      HOSTED_TURN_FRESHNESS_MS,
      now,
    ) ? 'running' : 'terminal';
  }
  return 'missing';
}

export type HostedTurnCancellationAuthority =
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'missing'
  | 'running';

export function conversationHostedTurnCancellationAuthority(
  conversation: SingleConversation,
  turnId: string,
): HostedTurnCancellationAuthority {
  const normalizedTurnId = turnId.trim();
  if (!normalizedTurnId) return 'missing';
  const terminal = hostedTurnTerminalAuthority(conversation, normalizedTurnId);
  if (terminal) return terminal.status;
  for (const [key, record] of Object.entries(conversation.hosted_turns || {})) {
    if (!isRecord(record)) continue;
    const id = stringValue(record.turn_id) || stringValue(record.id) || key;
    if (id !== normalizedTurnId) continue;
    const stage = stringValue(record.stage).toLowerCase();
    return record.cancel_requested === true || stage === 'cancel_requested'
      ? 'cancel_requested'
      : 'running';
  }
  return 'missing';
}

const RETRYABLE_TURN_ERROR_CODES = new Set([
  'http_500',
  'http_502',
  'http_503',
  'http_504',
  'http_520',
  'http_522',
  'http_524',
  'model_timeout',
  'model_empty_response',
  'model_request_failed',
  'model_not_configured',
  'hosted_turn_failed',
]);

export function turnErrorCodeRetryable(code: string, message: string): boolean {
  const normalized = code.trim().toLowerCase();
  if (normalized && RETRYABLE_TURN_ERROR_CODES.has(normalized)) return true;
  return /50\d|empty stream|timed out|timeout|bad gateway|connection|not configured|未配置|繁忙/i.test(message);
}

export function hostedTurnFailedRetryably(
  conversation: SingleConversation,
  turnId: string,
): boolean {
  const normalizedTurnId = turnId.trim();
  if (!normalizedTurnId) return false;
  for (const [key, record] of Object.entries(conversation.hosted_turns || {})) {
    if (!isRecord(record)) continue;
    const id = stringValue(record.turn_id) || stringValue(record.id) || key;
    if (id !== normalizedTurnId) continue;
    if (stringValue(record.status).toLowerCase() !== 'failed') return false;
    return turnErrorCodeRetryable(stringValue(record.error_code), stringValue(record.error));
  }
  return false;
}

function hostedTurnHasTerminalMessage(
  conversation: SingleConversation,
  turnId: string,
): boolean {
  return hostedTurnTerminalAuthority(conversation, turnId) !== null;
}

function hostedTurnTerminalAuthority(
  conversation: SingleConversation,
  turnId: string,
): { completedAt: number; status: 'cancelled' | 'completed' | 'failed' } | null {
  if (!turnId) return null;
  for (const [key, record] of Object.entries(conversation.hosted_turns || {})) {
    if (!isRecord(record)) continue;
    const recordTurnId = stringValue(record.turn_id) || stringValue(record.id) || key;
    if (recordTurnId !== turnId) continue;
    const status = terminalStatus(record.status);
    if (!status) break;
    return {
      completedAt: timestampValue(record.completed_at) || timestampValue(record.updated_at),
      status,
    };
  }
  for (const message of [...(conversation.messages || [])].reverse()) {
    if (message.role !== 'assistant' || stringValue(message.kind).toLowerCase() === 'route') {
      continue;
    }
    const meta = messageMetadata(message);
    const runtimeTurnId = stringValue(meta.runtime_turn_id) || stringValue(meta.turn_id);
    const messageKey = stringValue(meta.message_key);
    if (runtimeTurnId !== turnId && !messageKey.startsWith(`${turnId}:`)) continue;
    const status = terminalStatus(message.status);
    if (!status) continue;
    const phase = stringValue(meta.phase).toLowerCase();
    const baseStage = stringValue(meta.base_role_stage || meta.role_stage)
      .toLowerCase()
      .split(/[.:/]/, 1)[0];
    const isFinal = status === 'failed'
      || status === 'cancelled'
      || Boolean(meta.final_report)
      || (baseStage === 'chat' && phase === 'completed');
    if (!isFinal) continue;
    return {
      completedAt: timestampValue(message.completed_at)
        || timestampValue(meta.completed_at)
        || timestampValue(message.updated_at)
        || timestampValue(message.created_at),
      status,
    };
  }
  return null;
}

function messageMetadata(message: CollaborationMessage): JsonRecord {
  return {
    ...(isRecord(message.metadata) ? message.metadata : {}),
    ...(isRecord(message.meta) ? message.meta : {}),
  };
}

function terminalStatus(value: unknown): 'cancelled' | 'completed' | 'failed' | null {
  const status = stringValue(value).toLowerCase();
  if (status === 'cancelled' || status === 'canceled' || status === 'stopped') {
    return 'cancelled';
  }
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'error') return 'failed';
  return null;
}

export function reconcileHostedTurnVisibilityFailures(
  conversation: SingleConversation,
  messages: HermesChatViewMessage[],
  failures: readonly HostedTurnVisibilityFailure[],
): { failures: HostedTurnVisibilityFailure[]; messages: HermesChatViewMessage[] } {
  let nextMessages = messages;
  const remaining: HostedTurnVisibilityFailure[] = [];
  for (const failure of failures) {
    if (conversationHostedTurnState(conversation, failure.turnId) !== 'missing') continue;
    remaining.push(failure);
    nextMessages = upsertChatMessage(nextMessages, failure.message);
  }
  return { failures: remaining, messages: nextMessages };
}

export function attachmentContext(
  attachments: Array<{ name?: unknown; path?: unknown; relative_path?: unknown }>,
): string {
  const lines = attachments.flatMap((attachment) => {
    const name = stringValue(attachment.name);
    const path = stringValue(attachment.path) || stringValue(attachment.relative_path);
    return name || path ? [`- ${name || path}${path && path !== name ? `: ${path}` : ''}`] : [];
  });
  return lines.length ? `用户为本轮上传的附件：\n${lines.join('\n')}` : '';
}

export function streamEventToActivity(
  eventType: string,
  payload: Record<string, unknown>,
  now = Date.now(),
): HermesChatActivity | null {
  if (
    eventType === 'reasoning.delta'
    || eventType === 'reasoning.available'
    || eventType === 'thinking.started'
    || eventType === 'thinking.delta'
    || eventType === 'thinking.completed'
  ) {
    const text = structuredText(
      payload.text
        ?? payload.delta
        ?? payload.output
        ?? payload.reasoning
        ?? payload.content
        ?? payload.message,
    );
    if (!text) return null;
    return {
      category: 'reasoning',
      completedAt: ['reasoning.available', 'thinking.completed'].includes(eventType)
        ? now
        : undefined,
      duration: '',
      durationMs: 0,
      id: stringValue(payload.id)
        || stringValue(payload.entity_id)
        || `reasoning-${now}`,
      name: '模型思考',
      output: text,
      preview: text.slice(0, 80),
      startedAt: timestampValue(payload.started_at) || now,
      status: ['reasoning.available', 'thinking.completed'].includes(eventType)
        ? 'completed'
        : 'running',
    };
  }
  const isTool = eventType.startsWith('tool.');
  const isSubagent = eventType.startsWith('subagent.');
  const isCommand = eventType.startsWith('command.');
  const isBrowser = eventType === 'browser.progress';
  const isMoa = eventType.startsWith('moa.');
  const isInteraction = [
    'approval.request',
    'clarify.request',
    'secret.request',
    'sudo.request',
    'secret.expire',
    'sudo.expire',
  ].includes(eventType);
  const isBackground = eventType === 'background.complete' || eventType === 'review.summary';
  if (
    !isTool
    && !isSubagent
    && !isCommand
    && !isBrowser
    && !isMoa
    && !isInteraction
    && !isBackground
  ) return null;
  const toolName = stringValue(payload.tool_name)
    || stringValue(payload.tool)
    || stringValue(payload.name)
    || (isCommand ? stringValue(payload.command) : '')
    || (isBrowser ? 'browser' : '')
    || (isMoa ? 'moa' : '');
  const name = isSubagent
    ? stringValue(payload.profile)
      || stringValue(payload.agent_name)
      || stringValue(payload.name)
      || '子 Agent'
    : isCommand
      ? stringValue(payload.name) || '命令'
      : isBrowser
        ? '网页浏览'
        : isMoa
          ? '多模型协作'
          : isInteraction
            ? interactionActivityName(eventType)
            : isBackground
              ? eventType === 'review.summary' ? '审查摘要' : '后台任务'
              : toolName || '工具调用';
  const status = eventType === 'tool.error' || eventType === 'tool.failed'
      || eventType === 'subagent.failed'
      || eventType === 'command.failed'
    ? 'failed'
    : eventType === 'subagent.queued'
      ? 'queued'
    : eventType === 'tool.end'
        || eventType === 'tool.complete'
        || eventType === 'tool.completed'
        || eventType === 'subagent.completed'
        || eventType === 'command.completed'
        || eventType === 'background.complete'
        || eventType === 'review.summary'
        || eventType === 'secret.expire'
        || eventType === 'sudo.expire'
      ? 'completed'
      : 'running';
  const durationMs = numberValue(payload.duration_ms)
    || numberValue(payload.duration_s) * 1_000;
  const startedAt = timestampValue(payload.started_at);
  const completedAt = timestampValue(payload.completed_at ?? payload.ended_at);
  return {
    category: isSubagent || isMoa
      ? 'subagent'
      : isBrowser
        ? 'browser'
        : isInteraction || isBackground
          ? 'status'
      : isCommand
        ? 'command'
        : normalizedActivityCategory(
          stringValue(payload.category) || stringValue(payload.kind),
          toolName || name,
        ),
    completedAt: completedAt || undefined,
    detail: structuredText(payload.detail) || undefined,
    duration: formatDuration(durationMs),
    durationMs,
    error: structuredText(payload.error) || undefined,
    id: stringValue(payload.tool_id)
      || stringValue(payload.command_id)
      || stringValue(payload.child_session_id)
      || stringValue(payload.subagent_id)
      || stringValue(payload.task_id)
      || stringValue(payload.request_id)
      || (isBrowser ? 'browser-progress' : '')
      || (isMoa ? 'moa-progress' : '')
      || (isBackground ? eventType : '')
      || stringValue(payload.entity_id)
      || `tool-${now}`,
    input: structuredText(
      payload.command
        ?? payload.question
        ?? payload.prompt
        ?? payload.args_text
        ?? payload.args
        ?? payload.input
        ?? payload.context,
    ) || undefined,
    model: stringValue(payload.model) || undefined,
    name,
    output: structuredText(
      payload.output
        ?? payload.result_text
        ?? payload.result
        ?? payload.summary
        ?? payload.text
        ?? payload.message
        ?? payload.description
        ?? moaProgressText(payload),
    ) || undefined,
    preview: structuredText(payload.preview ?? payload.summary) || name,
    provider: stringValue(payload.provider) || undefined,
    startedAt: startedAt || undefined,
    status,
    toolName: toolName || name,
  };
}

function interactionActivityName(eventType: string): string {
  return {
    'approval.request': '需要审批',
    'clarify.request': '需要补充信息',
    'secret.expire': '密钥请求已过期',
    'secret.request': '需要密钥',
    'sudo.expire': '授权请求已过期',
    'sudo.request': '需要管理员授权',
  }[eventType] || '需要用户操作';
}

function moaProgressText(payload: Record<string, unknown>): string {
  const completed = numberValue(payload.refs_done);
  const total = numberValue(payload.refs_total);
  const phase = stringValue(payload.phase);
  const label = stringValue(payload.label) || stringValue(payload.aggregator);
  if (completed || total) return `MoA ${completed}/${total}${label ? ` · ${label}` : ''}`;
  if (phase) return `MoA · ${phase}`;
  return label;
}

export function activityDisplayContent(activity: HermesChatActivity): string {
  const category = activity.category.toLowerCase();
  const tool = `${activity.toolName || ''} ${activity.name}`.toLowerCase();
  if (category === 'reasoning') {
    return firstText(activity.output, activity.detail, activity.preview, activity.input);
  }
  if (category === 'command' || /(?:terminal|shell|exec|command)/.test(tool)) {
    const input = firstText(activity.input, activity.detail, activity.preview);
    const command = commandFromStructuredInput(input);
    return command || input;
  }
  return firstText(
    activity.error,
    activity.output,
    activity.input,
    activity.detail,
    activity.preview === activity.name ? '' : activity.preview,
  );
}

function firstText(...values: Array<string | undefined>): string {
  return values.map((value) => value?.trim() || '').find(Boolean) || '';
}

function commandFromStructuredInput(value: string): string {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return '';
    return firstText(
      stringValue(parsed.command),
      stringValue(parsed.cmd),
      stringValue(parsed.script),
    );
  } catch {
    return '';
  }
}

function mapActivities(
  message: CollaborationMessage,
  meta: Record<string, unknown>,
): HermesChatActivity[] | undefined {
  const sources: Array<[unknown, string]> = [
    [message.activities, ''],
    [meta.activities, ''],
    [meta.activity_events, ''],
    [meta.tool_calls, 'tool'],
    [meta.reasoning, 'reasoning'],
    [meta.reasoning_events, 'reasoning'],
    [meta.searches, 'search'],
    [meta.search_events, 'search'],
    [meta.files, 'file'],
    [meta.file_events, 'file'],
    [meta.commands, 'command'],
    [meta.command_events, 'command'],
  ];
  const mapped = sources.flatMap(([value, fallbackCategory]) => (
    activityItems(value).map(({ item, sourceIndex }) => (
      activityFromRecord(item, sourceIndex, fallbackCategory)
    ))
  ));
  const byId = new Map<string, HermesChatActivity>();
  for (const activity of mapped) {
    const existing = byId.get(activity.id);
    byId.set(activity.id, existing ? mergeActivity(existing, activity) : activity);
  }
  const activities = [...byId.values()].sort((left, right) => (
    (left.startedAt || 0) - (right.startedAt || 0)
  ));
  return activities.length ? activities : undefined;
}

function activityItems(value: unknown): Array<{
  item: Record<string, unknown>;
  sourceIndex: number;
}> {
  if (Array.isArray(value)) {
    return value.flatMap((item, sourceIndex) => (
      isRecord(item) ? [{ item, sourceIndex }] : []
    ));
  }
  return isRecord(value) ? [{ item: value, sourceIndex: 0 }] : [];
}

function activityFromRecord(
  item: Record<string, unknown>,
  sourceIndex: number,
  fallbackCategory: string,
): HermesChatActivity {
  const toolName = stringValue(item.tool_name);
  const kind = stringValue(item.kind) || fallbackCategory;
  const name = stringValue(item.name)
    || stringValue(item.label)
    || toolName
    || stringValue(item.title)
    || stringValue(item.event_type)
    || activityFallbackName(kind);
  const category = normalizedActivityCategory(
    stringValue(item.category) || fallbackCategory || kind,
    name,
  );
  const startedAt = timestampValue(
    item.started_at ?? item.created_at ?? item.timestamp,
  );
  const completedAt = timestampValue(
    item.completed_at ?? item.ended_at ?? item.updated_at,
  );
  const explicitDuration = numberValue(item.duration_ms)
    || numberValue(item.duration_seconds) * 1_000
    || numberValue(item.duration_s) * 1_000
    || numberValue(item.duration) * 1_000;
  const durationMs = explicitDuration > 0
    ? explicitDuration
    : startedAt && completedAt
      ? Math.max(0, completedAt - startedAt)
      : 0;
  const detail = structuredText(item.detail ?? item.metadata);
  const error = structuredText(item.error);
  const output = structuredText(
    item.output ?? item.output_text ?? item.result_text ?? item.result ?? item.response,
  );
  const input = structuredText(
    item.input ?? item.input_text ?? item.args_text ?? item.args ?? item.command ?? item.query ?? item.request,
  );
  const preview = structuredText(item.preview ?? item.summary)
    || detail.slice(0, 160)
    || output.slice(0, 160)
    || name;
  const rawId = stringValue(item.id)
    || stringValue(item.activity_id)
    || stringValue(item.tool_id)
    || stringValue(item.seq);
  return {
    category,
    completedAt: completedAt || undefined,
    detail: detail || undefined,
    duration: stringValue(item.duration) || formatDuration(durationMs),
    durationMs,
    error: error || undefined,
    id: rawId || `${category}-${sourceIndex}-${startedAt || name}`,
    input: input || undefined,
    model: stringValue(item.model) || undefined,
    name,
    output: output || undefined,
    preview,
    provider: stringValue(item.provider) || undefined,
    startedAt: startedAt || undefined,
    status: normalizeStatus(item.status),
    toolName: toolName || undefined,
  };
}

function mergeActivity(
  current: HermesChatActivity,
  next: HermesChatActivity,
): HermesChatActivity {
  return {
    ...current,
    ...next,
    completedAt: next.completedAt || current.completedAt,
    detail: next.detail || current.detail,
    duration: next.duration || current.duration,
    durationMs: next.durationMs || current.durationMs,
    error: next.error || current.error,
    input: next.input || current.input,
    model: next.model || current.model,
    output: next.output || current.output,
    preview: next.preview || current.preview,
    provider: next.provider || current.provider,
    startedAt: next.startedAt || current.startedAt,
    toolName: next.toolName || current.toolName,
  };
}

function deduplicateMessages(messages: HermesChatViewMessage[]): HermesChatViewMessage[] {
  const indices = new Map<string, number>();
  const result: HermesChatViewMessage[] = [];
  for (const message of messages) {
    const existingIndex = indices.get(message.id);
    if (existingIndex === undefined) {
      indices.set(message.id, result.length);
      result.push(message);
    } else {
      result[existingIndex] = message;
    }
  }
  return deduplicateByContent(result);
}

const CONTENT_DEDUP_WINDOW_MS = 60_000;

function deduplicateByContent(messages: HermesChatViewMessage[]): HermesChatViewMessage[] {
  const result: HermesChatViewMessage[] = [];
  for (const message of messages) {
    if (message.content) {
      const duplicateIndex = result.findIndex(
        (existing) => {
          if (existing.role !== message.role || existing.content !== message.content) return false;
          const sameRuntimeTurn = Boolean(existing.runtimeTurnId)
            && existing.runtimeTurnId === message.runtimeTurnId;
          if (sameRuntimeTurn) return true;
          const existingTimestamp = existing.createdAt || existing.updatedAt || 0;
          const messageTimestamp = message.createdAt || message.updatedAt || 0;
          // A durable enqueue can be projected once from the conversation
          // snapshot and once from the append-only session journal. Those
          // records may carry different runtime ids, but the server assigns
          // the same millisecond timestamp to both copies. Collapse only that
          // exact user echo; two real, rapid sends still have distinct times.
          if (
            message.role === 'user'
            && existingTimestamp > 0
            && existingTimestamp === messageTimestamp
          ) return true;
          return false;
        },
      );
      if (duplicateIndex >= 0) {
        const existing = result[duplicateIndex];
        if (
          message.role === 'assistant'
          && Math.abs(
            (existing.completedAt || existing.updatedAt || existing.createdAt || 0)
            - (message.completedAt || message.updatedAt || message.createdAt || 0),
          ) >= CONTENT_DEDUP_WINDOW_MS
        ) {
          result.push(message);
          continue;
        }
        result[duplicateIndex] = message;
        continue;
      }
    }
    result.push(message);
  }
  return result;
}

function hasRunningRecord(
  records: SingleConversation['hosted_turns'] | undefined,
  freshnessMs: number,
  now: number,
): boolean {
  if (!records) return false;
  return Object.values(records).some((record) => {
    if (!isRecord(record)) return false;
    return runningConversationRecordIsFresh(record, freshnessMs, now);
  });
}

function normalizeRoleStage(
  value: unknown,
  isUser: boolean,
): HermesChatViewMessage['roleStage'] {
  if (isUser) return 'chat';
  const normalized = stringValue(value).toLowerCase();
  if (/dispatch|manager|workflow/.test(normalized)) {
    return 'dispatcher';
  }
  if (/review/.test(normalized)) return 'reviewer';
  if (/supervis|监督/.test(normalized)) return 'supervisor';
  if (/report/.test(normalized)) return 'reporter';
  if (/worker|executor/.test(normalized)) return 'worker';
  return 'chat';
}

function profileDisplayName(
  profile: string,
  stage: HermesChatViewMessage['roleStage'],
  chinese: boolean,
): string {
  const normalizedProfile = profile.toLowerCase();
  if (normalizedProfile === 'dbb3-manager') {
    return chinese ? 'Hermes 调度员' : 'Hermes Manager';
  }
  if (stage === 'dispatcher') return chinese ? 'Hermes 调度员' : 'Hermes Dispatcher';
  if (stage === 'reporter') return chinese ? 'Hermes 汇报员' : 'Hermes Reporter';
  if (stage === 'reviewer' && !profile) return chinese ? 'Hermes 审阅员' : 'Hermes Reviewer';
  if (stage === 'supervisor') return chinese ? 'Hermes 监督者' : 'Hermes Supervisor';
  if (!chinese) {
    const names: Record<string, string> = {
      default: 'Hermes',
      'dbb3-worker': 'DBB3 Worker',
      'pc-worker': 'PC/WSL Worker',
      reviewer: 'Hermes Reviewer',
    };
    return names[normalizedProfile] || profile || 'Hermes Agent';
  }
  const names: Record<string, string> = {
    default: 'Hermes',
    'dbb3-worker': 'DBB3 执行员',
    'pc-worker': 'PC/WSL 执行员',
    reviewer: 'Hermes 审阅员',
  };
  return names[normalizedProfile] || profile || 'Hermes Agent';
}

function roleStageLabel(
  stage: NonNullable<HermesChatViewMessage['roleStage']>,
  chinese: boolean,
): string {
  if (!chinese) {
    return {
      chat: 'Hermes Agent',
      dispatcher: 'Task dispatch',
      reporter: 'Final report',
      reviewer: 'Review',
      supervisor: 'Workflow supervision',
      worker: 'Execution',
    }[stage];
  }
  return {
    chat: 'Hermes Agent',
    dispatcher: '任务调度',
    reporter: '最终汇报',
    reviewer: '结果审阅',
    supervisor: '流程监督',
    worker: '任务执行',
  }[stage];
}

function activityCategory(name: string): string {
  const lowered = name.toLowerCase();
  if (/file|read|write|patch|文件/.test(lowered)) return 'file';
  if (/browser|search|web|浏览|搜索/.test(lowered)) return 'browser';
  if (/mcp/.test(lowered)) return 'mcp';
  if (/skill|技能/.test(lowered)) return 'skill';
  return 'command';
}

function normalizedActivityCategory(category: string, name: string): string {
  const normalized = category.toLowerCase();
  if (/reason|think|思考|推理/.test(normalized)) return 'reasoning';
  if (/search|browser|web|搜索|浏览/.test(normalized)) return 'search';
  if (/file|文件/.test(normalized)) return 'file';
  if (/command|terminal|shell|命令/.test(normalized)) return 'command';
  if (/model|模型/.test(normalized)) return 'model';
  if (/mcp/.test(normalized)) return 'mcp';
  if (/skill|技能/.test(normalized)) return 'skill';
  if (/subagent|agent|子任务/.test(normalized)) return 'subagent';
  if (/handoff|dispatch|交接|调度/.test(normalized)) return 'handoff';
  if (/status|retry|状态|重试/.test(normalized)) return 'status';
  return activityCategory(name);
}

function activityFallbackName(category: string): string {
  return {
    command: '命令行',
    file: '文件操作',
    handoff: '任务交接',
    model: '模型调用',
    reasoning: '模型思考',
    search: '搜索',
    status: '运行状态',
    subagent: '子 Agent',
    tool: '工具调用',
  }[normalizedActivityCategory(category, category)] || '工具调用';
}

export function avatarRoleFor(
  profile: string,
  stage: HermesChatViewMessage['roleStage'],
  isUser = false,
): HermesChatAvatarRole {
  if (isUser) return 'user';
  if (stage === 'dispatcher') return 'dispatcher';
  if (stage === 'reporter') return 'reporter';
  if (stage === 'reviewer') return 'reviewer';
  if (stage === 'supervisor') return 'supervisor';
  const normalized = profile.toLowerCase();
  if (/dbb3/.test(normalized)) return 'dbb3-worker';
  if (/pc|wsl|windows|local/.test(normalized)) return 'pc-worker';
  if (/review/.test(normalized)) return 'reviewer';
  if (/supervis|监督/.test(normalized)) return 'supervisor';
  return 'hermes';
}

export function activityCategoryLabel(category: string, chinese = true): string {
  const normalized = normalizedActivityCategory(category, category);
  const labels = chinese
    ? {
        command: '命令',
        file: '文件',
        handoff: '交接',
        mcp: 'MCP',
        model: '模型',
        reasoning: '思考',
        search: '搜索',
        skill: '技能',
        status: '状态',
        subagent: '子任务',
      }
    : {
        command: 'Command',
        file: 'File',
        handoff: 'Handoff',
        mcp: 'MCP',
        model: 'Model',
        reasoning: 'Reasoning',
        search: 'Search',
        skill: 'Skill',
        status: 'Status',
        subagent: 'Subtask',
      };
  return labels[normalized as keyof typeof labels] || (chinese ? '工具' : 'Tool');
}
