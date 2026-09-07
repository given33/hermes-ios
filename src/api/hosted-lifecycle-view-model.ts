import { isRecord } from './chat-view-values';
import { appendExecutionReport } from './chat-execution-phases';
import { hostedRoleIdentity } from './hosted-role-identity';
import type { HostedLifecycleEvent } from './hosted-conversation-events';
import {
  reduceHostedRuntimeEvents,
  type HostedRuntimeProjection,
} from './hosted-runtime-reducer';
import type { HermesChatRoleStage, HermesChatTodo } from './chat-view-types';
import { truncateByCodePoints } from './text-clamp';
import {
  avatarRoleFor,
  hostedViewTurnIsTerminal,
  streamEventToActivity,
  type HermesChatActivity,
  type HermesChatViewMessage,
} from './chat-view-model';

export interface HostedLifecycleApplication {
  cancelled: boolean;
  completed: boolean;
  failed: boolean;
  firstTokenAt?: number;
  messages: HermesChatViewMessage[];
  notices: string[];
  phase?: 'executing' | 'reconnecting' | 'responding' | 'thinking';
  phaseStartedAt?: number;
  reconnectAttempt?: number;
  runtime: HostedRuntimeProjection;
  turnActive: boolean;
}

/** Reduce canonical Hermes hosted events directly into one stable chat turn. */
export function applyHostedLifecycleEvents(
  messages: HermesChatViewMessage[],
  events: readonly HostedLifecycleEvent[],
  chinese = true,
  runtime?: HostedRuntimeProjection,
  controllingTurnId?: string,
): HostedLifecycleApplication {
  if (controllingTurnId && events.some((event) => event.turn_id !== controllingTurnId)) {
    // History may finish checkpointing after the next send starts. Reconcile
    // its bubbles without letting its terminal event end the current send.
    const history = applyHostedLifecycleEvents(messages,
      events.filter((event) => event.turn_id !== controllingTurnId), chinese);
    return applyHostedLifecycleEvents(history.messages,
      events.filter((event) => event.turn_id === controllingTurnId), chinese, runtime);
  }
  const runtimeProjection = reduceHostedRuntimeEvents(runtime, events);
  let nextMessages = messages;
  let completed = false;
  let cancelled = false;
  let failed = false;
  let phase: HostedLifecycleApplication['phase'];
  let phaseStartedAt: number | undefined;
  let reconnectAttempt: number | undefined;
  let firstTokenAt: number | undefined;
  let turnActive = false;
  const notices: string[] = [];

  for (const event of events) {
    // Hosted team events are emitted from the worker/reviewer/reporter
    // stages as well as the user-facing chat stage.  They still belong to
    // the same runtime turn and must not be dropped by the chat reducer.
    // A terminal event is occasionally tagged with the synthetic `turn`
    // stage, so accept that stage only for terminal turn lifecycle events.
    const rawRoleStage = String(event.role_stage || 'chat');
    const roleStage = rawRoleStage.split(/[.:/]/, 1)[0].toLowerCase() || 'chat';
    const eventTypeForStage = event.event_type.toLowerCase();
    const acceptedRoleStage = roleStage === 'chat'
      || roleStage === 'aggregator'
      || roleStage === 'worker'
      || roleStage === 'reviewer'
      || roleStage === 'reporter'
      || roleStage === 'supervisor'
      || roleStage === 'rework'
      // Stage prefixes: manager_planning / dispatcher_* flow events carry a
      // single-segment stage with no separator; accept any stage rooted in
      // manager/dispatch so live planning events are not dropped until the
      // next snapshot refresh.
      || roleStage.startsWith('manager')
      || roleStage.startsWith('dispatch')
      || (roleStage === 'turn' && (
        eventTypeForStage === 'turn.completed'
        || eventTypeForStage === 'turn.cancelled'
        || eventTypeForStage === 'turn.failed'
        || eventTypeForStage === 'turn.cancel_requested'
      ));
    if (!acceptedRoleStage) continue;
    const milestone = /(?:^|[.:/])(?:milestone|opening|progress)(?:[.:/]|$)/i.test(rawRoleStage);
    const eventType = milestone && event.event_type.toLowerCase() === 'message.completed'
      ? 'message.interim' : event.event_type.toLowerCase();
    const occurredAt = positiveTimestamp(event.occurred_at) || Date.now();
    const payload = { ...event.payload };
    if (!stringValue(payload.entity_id) && event.entity_id) payload.entity_id = event.entity_id;
    const liveRoleStage = normalizeLiveRoleStage(roleStage);
    const terminalTurnEvent = eventType === 'turn.completed'
      || eventType === 'turn.cancelled'
      || eventType === 'turn.failed';
    const existingTurnMessage = terminalTurnEvent
      ? nextMessages.find((candidate) => (
        candidate.role === 'assistant'
        && candidate.runtimeTurnId === event.turn_id
      ))
      : undefined;
    let message = existingTurnMessage
      || liveMessageFor(
        nextMessages,
        event.turn_id,
        liveRoleStage,
        event.role_stage,
        payload,
        occurredAt,
        chinese,
      );
    // A milestone is a completed message, not a completed agent execution.
    const wasMessageCompleted = message.executionComplete === true;
    const settledMessage = wasMessageCompleted ? message : undefined;
    if (!wasMessageCompleted) {
      message = { ...message, completedAt: undefined, completedObservedAt: undefined };
    }
    const sourceEventType = stringValue(payload.source_event_type).toLowerCase();
    const requestAccepted = sourceEventType === 'request.accepted'
      || (!sourceEventType && stringValue(payload.status).toLowerCase() === 'started');
    const explicitModelStartedAt = positiveTimestamp(payload.model_started_at)
      || positiveTimestamp(payload.started_at);
    const modelStartedAt = explicitModelStartedAt
      || message.modelStartedAt
      || occurredAt;

    const notice = officialFrontendNotice(eventType, payload, chinese);
    if (notice) {
      notices.push(notice);
      continue;
    }
    if (
      eventType === 'notification.clear'
      || eventType === 'gateway.ready'
      || eventType === 'skin.changed'
      || eventType === 'reaction'
      || eventType === 'voice.status'
      || eventType === 'voice.transcript'
      || eventType === 'wake.detected'
    ) continue;

    if (eventType === 'agent.started') {
      turnActive = true;
      message = {
        ...message,
        remotePhase: message.roleStage === 'worker' && requestAccepted ? 'executing' : message.remotePhase,
        model: modelLabel(payload) || message.model,
        modelStartedAt: explicitModelStartedAt
          || (requestAccepted ? occurredAt : message.modelStartedAt),
        provider: stringValue(payload.provider) || message.provider,
        status: undefined,
        timingLabel: undefined,
      };
    } else if (
      eventType === 'connection.retry_scheduled'
      || eventType === 'connection.retry_started'
    ) {
      turnActive = true;
      const attempt = Math.max(1, numericValue(payload.attempt) || 1);
      const maxAttempts = Math.max(attempt, numericValue(payload.max_attempts) || 5);
      phase = 'reconnecting';
      phaseStartedAt = occurredAt;
      reconnectAttempt = attempt;
      message = {
        ...message,
        activities: upsertActivity(message.activities, {
          category: 'status',
          duration: '',
          id: 'model-connection-retry',
          name: chinese
            ? `正在重新连接 (${attempt}/${maxAttempts})`
            : `Reconnecting (${attempt}/${maxAttempts})`,
          preview: '',
          startedAt: occurredAt,
          status: 'running',
        }),
        status: 'running',
        timingLabel: chinese
          ? `正在重新连接 (${attempt}/${maxAttempts})`
          : `Reconnecting (${attempt}/${maxAttempts})`,
        updatedAt: occurredAt,
      };
    } else if (eventType === 'connection.retry_finished') {
      message = {
        ...message,
        activities: removeActivity(message.activities, 'model-connection-retry'),
        status: message.firstTokenAt ? message.status : undefined,
        timingLabel: message.firstTokenAt ? message.timingLabel : undefined,
        updatedAt: occurredAt,
      };
    } else if (
      (
        eventType === 'reasoning.delta'
        || eventType === 'reasoning.available'
        || eventType === 'thinking.started'
        || eventType === 'thinking.delta'
        || eventType === 'thinking.completed'
      )
      // `reasoning.*` is already the canonical event family. The older
      // `thinking.*` aliases are accepted only when they came from the
      // reasoning channel, so a gateway status string cannot start timing.
      && (
        eventType.startsWith('reasoning.')
        || !sourceEventType
        || sourceEventType.startsWith('reasoning.')
      )
    ) {
      const lastReasoning = message.activities?.filter(activity => activity.category === 'reasoning').at(-1);
      const reasoningComplete = eventType === 'reasoning.available' || eventType === 'thinking.completed';
      const fallbackReasoningId = lastReasoning && (lastReasoning.status === 'running' || reasoningComplete)
        ? lastReasoning.id : `thinking:${event.turn_id}:${event.cursor}`;
      const id = stringValue(payload.entity_id) || fallbackReasoningId;
      const existing = message.activities?.find((activity) => activity.id === id);
      let text = structuredText(
        payload.text
          ?? payload.delta
          ?? payload.output
          ?? payload.reasoning
          ?? payload.content
          ?? payload.message,
      );
      if (sourceEventType === 'reasoning.available' && text && message.content.trim().startsWith(text.trim())) text = '';
      if (!text && !existing?.output?.trim()) {
        continue;
      }
      turnActive = true;
      const output = appendDelta(existing?.output || '', text);
      const status = (
        eventType === 'reasoning.available'
        || eventType === 'thinking.completed'
      ) ? 'completed' : 'running';
      const activity: HermesChatActivity = {
        category: 'reasoning',
        completedAt: status === 'completed' ? occurredAt : undefined,
        duration: '',
        durationMs: status === 'completed' && existing?.startedAt
          ? Math.max(0, occurredAt - existing.startedAt)
          : 0,
        id,
        name: chinese ? '模型思考' : 'Model reasoning',
        output,
        preview: truncateByCodePoints(lastNonEmptyLine(output), 120),
        startedAt: existing?.startedAt || occurredAt,
        status,
      };
      if (text && !message.firstTokenAt) {
        firstTokenAt = occurredAt;
        message = { ...message, firstTokenAt: occurredAt };
      }
      phase = 'thinking';
      // The visible thinking clock begins at the first real reasoning token,
      // not at an earlier queue/tool event that may have created the same
      // assistant envelope.
      phaseStartedAt = message.firstTokenAt || occurredAt;
      message = {
        ...message,
        activities: upsertActivity(message.activities, activity),
        modelStartedAt,
        startedAt: message.startedAt || occurredAt,
        status: wasMessageCompleted ? undefined : 'running',
        timingLabel: wasMessageCompleted ? undefined : (chinese ? '正在思考' : 'Thinking'),
        updatedAt: occurredAt,
      };
    } else if (
      eventType.startsWith('tool.')
      || eventType.startsWith('subagent.')
      || eventType.startsWith('command.')
      || eventType === 'browser.progress'
      || eventType.startsWith('moa.')
      || eventType === 'approval.request'
      || eventType === 'clarify.request'
      || eventType === 'secret.request'
      || eventType === 'sudo.request'
      || eventType === 'secret.expire'
      || eventType === 'sudo.expire'
      || eventType === 'background.complete'
      || eventType === 'review.summary'
      || eventType === 'awaiting.choice'
      || eventType === 'supervisor.verdict'
      || eventType === 'rework.started'
      || eventType === 'rework.dispatched'
    ) {
      if (eventType === 'command.output' && (sourceEventType === 'status.update'
          || payload.unmapped_frontend_event === true)) {
        continue;
      }
      if (sourceEventType === 'tool.generating' && !payload.tool_id && !payload.call_id
          && !payload.tool_call_id && !payload.entity_id) {
        continue;
      }
      const activity = streamEventToActivity(eventType, payload, occurredAt);
      if (activity) {
        activity.startedAt ||= occurredAt;
        if (['completed', 'failed', 'cancelled'].includes(activity.status)) activity.completedAt ||= occurredAt;
        turnActive = !['background.complete', 'review.summary'].includes(eventType)
          || turnActive;
        const existing = message.activities?.find(({ id }) => id === activity.id);
        const mergedActivity = existing
          ? {
              ...activity,
              category: eventType === 'command.output' ? existing.category : activity.category,
              completedAt: activity.completedAt || existing.completedAt,
              durationMs: activity.durationMs || existing.durationMs,
              input: activity.input || existing.input,
              name: activity.name === '命令' ? existing.name : activity.name,
              output: eventType === 'command.output'
                || eventType === 'browser.progress'
                || eventType === 'moa.reference'
                ? appendDelta(existing.output || '', activity.output || '')
                : activity.output || existing.output,
              startedAt: existing.startedAt || activity.startedAt,
              status: existing.status === 'completed' && activity.status === 'running'
                ? existing.status : activity.status,
              toolName: activity.toolName === '命令' ? existing.toolName : activity.toolName,
              files: activity.files || existing.files,
              question: activity.question || existing.question,
              options: activity.options || existing.options,
              severity: activity.severity || existing.severity,
              agentName: activity.agentName || existing.agentName,
              reworkRound: activity.reworkRound ?? existing.reworkRound,
            }
          : activity;
        message = {
          ...message,
          activities: upsertActivity(message.activities, mergedActivity),
          // The `todo` tool result carries the full task list; refresh the
          // live todo panel from every completion event.
          todos: eventType === 'tool.complete' || eventType === 'tool.completed'
            ? normalizeTodoPayload(payload) ?? message.todos
            : message.todos,
          // Tool/command/subagent events are execution details, not model
          // output. The first-token clock is owned by reasoning/message deltas.
          firstTokenAt: message.firstTokenAt,
          modelStartedAt,
          startedAt: message.startedAt || occurredAt,
          status: wasMessageCompleted ? undefined : 'running',
          timingLabel: wasMessageCompleted ? undefined : (chinese ? '正在执行' : 'Executing'),
          updatedAt: occurredAt,
        };
      }
      if (!['background.complete', 'review.summary'].includes(eventType)) {
        phase = 'executing';
        // Keep the execution label visible without starting its timer before
        // the first real model token arrives.
        phaseStartedAt = message.firstTokenAt || undefined;
      }
    } else if (
      eventType === 'message.delta'
      || eventType === 'message.interim'
      || eventType === 'message.completed'
    ) {
      turnActive = true;
      const text = structuredText(
        payload.text ?? payload.delta ?? payload.content ?? payload.message,
      );
      const content = eventType === 'message.completed' && text
        ? preferCompleteText(message.content, text)
        : eventType === 'message.interim' ? '' : appendDelta(message.content, text);
      if (text && !message.firstTokenAt) {
        firstTokenAt = occurredAt;
        message = { ...message, firstTokenAt: occurredAt };
      }
      message = {
        ...message,
        activities: eventType === 'message.completed'
          ? finishActivities(completeTransientActivities(message.activities, occurredAt), 'completed', occurredAt)
          : completeTransientActivities(message.activities, occurredAt),
        completedAt: eventType === 'message.completed' ? occurredAt : undefined,
        completedObservedAt: eventType === 'message.completed' ? message.completedObservedAt : undefined,
        executionComplete: eventType === 'message.completed',
        content,
        executionReports: eventType === 'message.interim'
          ? appendExecutionReport(message.executionReports, {
              id: `${event.turn_id}:report:${message.executionReports?.length || 0}`,
              content: text, createdAt: occurredAt,
            }) : message.executionReports,
        modelStartedAt,
        startedAt: message.startedAt || occurredAt,
        status: eventType === 'message.completed' ? 'completed' : 'running',
        timingLabel: eventType === 'message.completed'
          ? undefined
          : chinese ? '正在回复' : 'Responding',
        updatedAt: occurredAt,
      };
      phase = 'responding';
      phaseStartedAt = message.firstTokenAt || occurredAt;
      // A worker completing its message does not complete the parent turn.
      if (eventType === 'message.completed' && liveRoleStage === 'chat') completed = true;
    } else if (eventType === 'turn.cancel_requested') {
      turnActive = true;
      message = {
        ...message,
        activities: finishActivities(message.activities, 'cancelled', occurredAt),
        completedAt: occurredAt,
        executionComplete: true,
        status: 'cancelled',
        timingLabel: undefined,
        updatedAt: occurredAt,
      };
    } else if (terminalTurnEvent) {
      // A synthetic turn terminal is authoritative for every role bubble in
      // the turn. Keep the reducer's activity flag terminal as well; the UI
      // controller also checks completed/failed/cancelled, but other
      // consumers use turnActive directly while reconciling a snapshot.
      turnActive = false;
      completed = eventType === 'turn.completed';
      cancelled = eventType === 'turn.cancelled';
      failed = eventType === 'turn.failed';
      const status = eventType === 'turn.completed'
        ? 'completed'
        : eventType === 'turn.cancelled' ? 'cancelled' : 'failed';
      const error = structuredText(payload.error ?? payload.message);
      message = {
        ...message,
        activities: finishActivities(message.activities, status, occurredAt),
        completedAt: occurredAt,
        executionComplete: true,
        turnTerminal: true,
        content: message.content || error,
        status,
        timingLabel: undefined,
        updatedAt: occurredAt,
      };
    } else {
      continue;
    }
    if (settledMessage && !terminalTurnEvent) {
      message = {
        ...message,
        status: settledMessage.status || 'completed',
        completedAt: settledMessage.completedAt,
        executionComplete: true,
        timingLabel: undefined,
        activities: finishActivities(message.activities,
          settledMessage.status === 'cancelled' ? 'cancelled'
            : settledMessage.status === 'failed' ? 'failed' : 'completed',
          settledMessage.completedAt || occurredAt),
      };
    }
    nextMessages = upsertLiveMessage(nextMessages, message);
    if (terminalTurnEvent) {
      // A team turn can have several live role bubbles. The synthetic turn
      // terminal closes every bubble in that turn, not only whichever role
      // emitted the terminal frame.
      const terminalStatus = eventType === 'turn.completed'
        ? 'completed'
        : eventType === 'turn.cancelled' ? 'cancelled' : 'failed';
      nextMessages = nextMessages.map((candidate) => (
        candidate.role === 'assistant' && candidate.runtimeTurnId === event.turn_id
          ? {
              ...candidate,
              activities: finishActivities(candidate.activities, terminalStatus, occurredAt),
              completedAt: occurredAt,
              executionComplete: true,
              status: terminalStatus,
              turnTerminal: true,
              timingLabel: undefined,
              updatedAt: occurredAt,
            }
          : candidate
      ));
    }
  }

  const latestTurnId = controllingTurnId || events.at(-1)?.turn_id || runtimeProjection.turnId;
  const settledTurnMessage = nextMessages.find((message) => (
    hostedViewTurnIsTerminal([message], latestTurnId || '')
  ));
  if (events.length && settledTurnMessage) {
    completed = settledTurnMessage.status === 'completed';
    cancelled = settledTurnMessage.status === 'cancelled';
    failed = settledTurnMessage.status === 'failed';
    turnActive = false;
    phase = undefined;
    phaseStartedAt = undefined;
    reconnectAttempt = 0;
  }

  return {
    cancelled,
    completed,
    failed,
    firstTokenAt,
    messages: nextMessages,
    notices,
    phase,
    phaseStartedAt,
    reconnectAttempt,
    runtime: runtimeProjection,
    turnActive,
  };
}

function officialFrontendNotice(
  eventType: string,
  payload: Record<string, unknown>,
  chinese: boolean,
): string {
  if (eventType === 'notification.show') return structuredText(payload.text);
  if (eventType === 'billing.step_up.verification') {
    const url = stringValue(payload.verification_url);
    const code = stringValue(payload.user_code);
    if (!url) return '';
    return chinese
      ? `请在浏览器完成验证：${url}${code ? `（验证码 ${code}）` : ''}`
      : `Complete verification in your browser: ${url}${code ? ` (code ${code})` : ''}`;
  }
  if (eventType === 'dashboard.new_session_requested') {
    return structuredText(payload.reason)
      || (chinese ? 'Hermes 请求创建新会话' : 'Hermes requested a new session');
  }
  if (eventType === 'gateway.stderr') return structuredText(payload.line);
  if (eventType === 'gateway.start_timeout') {
    return chinese ? 'Hermes 网关启动超时' : 'Hermes gateway startup timed out';
  }
  if (eventType === 'gateway.protocol_error') {
    const preview = structuredText(payload.preview);
    return chinese
      ? `Hermes 网关协议错误${preview ? `：${preview}` : ''}`
      : `Hermes gateway protocol error${preview ? `: ${preview}` : ''}`;
  }
  return '';
}

function liveMessageFor(
  messages: readonly HermesChatViewMessage[],
  turnId: string,
  roleStage: HermesChatRoleStage,
  rawRoleStage: string,
  payload: Record<string, unknown>,
  occurredAt: number,
  chinese: boolean,
): HermesChatViewMessage {
  const identity = hostedRoleIdentity(rawRoleStage, roleStage);
  const profile = stringValue(payload.profile) || rawRoleStage.split(/[.:/]/).find(part => part.endsWith('-worker')) || '';
  const memberId = stringValue(payload.member_id);
  const existing = messages.find((message) => (
    message.role === 'assistant'
    && message.runtimeTurnId === turnId
    && (message.roleStage || 'chat') === roleStage
    && hostedRoleIdentity(message.rawRoleStage, message.roleStage) === identity
    && (!profile || !message.profile || message.profile === profile)
    && (!memberId || !message.memberId || message.memberId === memberId)
  ));
  if (existing) return { ...existing, profile: profile || existing.profile,
    memberId: memberId || existing.memberId, rawRoleStage: identity };
  return {
    activities: [],
    avatarRole: avatarRoleFor(stringValue(payload.profile), roleStage, false),
    content: '',
    createdAt: occurredAt,
    id: `hosted-live:${turnId}:${identity}:${memberId || profile}`,
    name: liveRoleName(roleStage, profile, chinese),
    profile: profile || undefined,
    memberId: memberId || undefined,
    rawRoleStage: identity,
    finalReport: identity === 'aggregator',
    role: 'assistant',
    roleLabel: liveRoleLabel(roleStage, chinese),
    roleStage,
    runtimeTurnId: turnId,
  };
}

function normalizeLiveRoleStage(value: string): HermesChatRoleStage {
  const normalized = value.toLowerCase();
  if (normalized === 'worker' || normalized.startsWith('worker.')) return 'worker';
  if (
    normalized === 'reviewer'
    || normalized.startsWith('reviewer.')
    || normalized === 'reporter'
    || normalized.startsWith('reporter.')
    || normalized === 'supervisor'
    || normalized.startsWith('supervisor.')
  ) return 'worker';
  // Keep the same stage names the snapshot-side normalizer uses
  // (chat-view-model.ts normalizeRoleStage) so live and persisted bubbles
  // share a fold key — mismatched keys caused the live bubble to be
  // re-appended at the tail instead of merging with its snapshot twin.
  if (normalized.startsWith('manager')) return 'dispatcher';
  if (normalized.startsWith('dispatch')) return 'dispatcher';
  return 'chat';
}

function liveRoleLabel(stage: HermesChatRoleStage, chinese: boolean): string {
  if (chinese) {
    return {
      chat: 'Hermes Agent',
      worker: '任务执行',
      reviewer: '任务执行',
      reporter: '任务执行',
      dispatcher: '任务调度',
      supervisor: '任务执行',
    }[stage];
  }
  return {
    chat: 'Hermes Agent',
    worker: 'Execution',
    reviewer: 'Execution',
    reporter: 'Execution',
    dispatcher: 'Task dispatch',
    supervisor: 'Execution',
  }[stage];
}

function liveRoleName(
  stage: HermesChatRoleStage,
  profile: string,
  chinese: boolean,
): string {
  if (stage === 'chat') return 'Hermes Agent';
  if (stage === 'worker' && /dbb3/i.test(profile)) return chinese ? 'DBB3 执行员' : 'DBB3 Worker';
  if (stage === 'worker' && /pc|wsl|local|windows/i.test(profile)) {
    return chinese ? 'PC/WSL 执行员' : 'PC/WSL Worker';
  }
  if (stage === 'worker' && /hk|hong.?kong|香港/i.test(profile)) {
    return chinese ? 'HK 执行员' : 'Hong Kong Worker';
  }
  if (stage === 'worker') return chinese ? 'DBB3 执行员' : 'DBB3 Worker';
  return liveRoleLabel(stage, chinese);
}

function upsertLiveMessage(
  messages: HermesChatViewMessage[],
  message: HermesChatViewMessage,
): HermesChatViewMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((candidate, candidateIndex) => (
    candidateIndex === index ? message : candidate
  ));
}

function upsertActivity(
  activities: HermesChatActivity[] | undefined,
  activity: HermesChatActivity,
): HermesChatActivity[] {
  const current = activities || [];
  const index = current.findIndex(({ id }) => id === activity.id);
  if (index < 0) return [...current, activity];
  return current.map((existing, existingIndex) => (
    existingIndex === index ? { ...existing, ...activity } : existing
  ));
}

function removeActivity(
  activities: HermesChatActivity[] | undefined,
  id: string,
): HermesChatActivity[] | undefined {
  const remaining = (activities || []).filter((activity) => activity.id !== id);
  return remaining.length ? remaining : undefined;
}

function completeTransientActivities(
  activities: HermesChatActivity[] | undefined,
  completedAt: number,
): HermesChatActivity[] | undefined {
  const visible = (activities || []).filter(({ id }) => (
    id !== 'model-runtime-status' && id !== 'model-connection-retry'
  ));
  if (!visible.length) return undefined;
  return visible.map((activity) => (
    activity.category === 'reasoning' && activity.status === 'running'
      ? { ...activity, completedAt, status: 'completed' as const }
      : activity
  ));
}

function finishActivities(
  activities: HermesChatActivity[] | undefined,
  status: string,
  completedAt: number,
): HermesChatActivity[] | undefined {
  if (!activities?.length) return activities;
  const terminalStatus = status === 'completed'
    ? 'completed'
    : status === 'cancelled' ? 'cancelled' : 'failed';
  return activities.map((activity) => (
    activity.status === 'running' || activity.status === 'queued'
      ? { ...activity, completedAt, status: terminalStatus }
      : activity
  ));
}

function appendDelta(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current || current.endsWith(incoming)) return current;
  if (incoming.startsWith(current)) return incoming;
  return current + incoming;
}

function preferCompleteText(current: string, complete: string): string {
  return complete || current;
}

function modelLabel(payload: Record<string, unknown>): string {
  return [stringValue(payload.provider), stringValue(payload.model)].filter(Boolean).join(' · ');
}

function structuredText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTodoList(value: unknown): HermesChatTodo[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [];
  const items = value
    .map((entry): HermesChatTodo | null => {
      if (!isRecord(entry)) return null;
      const id = stringValue(entry.id);
      const title = stringValue(entry.title) || stringValue(entry.content);
      if (!id || !title) return null;
      const rawStatus = stringValue(entry.status).toLowerCase();
      const status = rawStatus === 'in_progress'
        || rawStatus === 'completed'
        || rawStatus === 'cancelled'
        ? rawStatus
        : 'pending';
      return { id, title, status };
    })
    .filter((entry): entry is HermesChatTodo => entry !== null);
  // An explicit empty list is a canonical clear signal. A non-empty list
  // with no valid entries is malformed, not a clear instruction: preserve the
  // last known plan instead of erasing it because an adapter returned junk.
  return items.length ? items : null;
}

/** Read the canonical todo-tool result envelope used by hosted events. */
function normalizeTodoPayload(payload: Record<string, unknown>): HermesChatTodo[] | null {
  if (Object.prototype.hasOwnProperty.call(payload, 'todos')) {
    return normalizeTodoList(payload.todos);
  }
  for (const key of ['result', 'result_text']) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const parsed = parseTodoEnvelope(payload[key]);
    if (parsed !== null) return normalizeTodoList(parsed);
  }
  return null;
}

function parseTodoEnvelope(value: unknown): unknown[] | null {
  if (isRecord(value) && Array.isArray(value.todos)) return value.todos;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed) && Array.isArray(parsed.todos)) return parsed.todos;
  } catch {
    // Some tool adapters prepend a short status line before JSON.
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed: unknown = JSON.parse(value.slice(start, end + 1));
        if (isRecord(parsed) && Array.isArray(parsed.todos)) return parsed.todos;
      } catch {
        // Ignore malformed tool output and preserve the previous todo state.
      }
    }
  }
  return null;
}

function numericValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveTimestamp(value: unknown): number {
  const parsed = numericValue(value);
  return parsed > 0 ? parsed : 0;
}

function lastNonEmptyLine(value: string): string {
  return value.split('\n').map((line) => line.trim()).filter(Boolean).at(-1) || '';
}
