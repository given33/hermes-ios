import { isRecord } from './chat-view-values';
import type { HostedLifecycleEvent } from './hosted-conversation-events';
import type { HermesChatRoleStage, HermesChatTodo } from './chat-view-types';
import {
  avatarRoleFor,
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
  turnActive: boolean;
}

/** Reduce canonical Hermes hosted events directly into one stable chat turn. */
export function applyHostedLifecycleEvents(
  messages: HermesChatViewMessage[],
  events: readonly HostedLifecycleEvent[],
  chinese = true,
): HostedLifecycleApplication {
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
    const roleStage = event.role_stage.split(/[.:/]/, 1)[0].toLowerCase();
    const eventTypeForStage = event.event_type.toLowerCase();
    const acceptedRoleStage = roleStage === 'chat'
      || roleStage === 'worker'
      || roleStage === 'reviewer'
      || roleStage === 'reporter'
      || (roleStage === 'turn' && (
        eventTypeForStage === 'turn.completed'
        || eventTypeForStage === 'turn.cancelled'
        || eventTypeForStage === 'turn.failed'
        || eventTypeForStage === 'turn.cancel_requested'
      ));
    if (!acceptedRoleStage) continue;
    const eventType = event.event_type.toLowerCase();
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
      const id = stringValue(payload.entity_id) || `thinking:${event.turn_id}`;
      const existing = message.activities?.find((activity) => activity.id === id);
      const text = structuredText(
        payload.text
          ?? payload.delta
          ?? payload.output
          ?? payload.reasoning
          ?? payload.content
          ?? payload.message,
      );
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
        preview: lastNonEmptyLine(output).slice(0, 120),
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
        status: 'running',
        timingLabel: chinese ? '正在思考' : 'Thinking',
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
    ) {
      if (eventType === 'command.output' && sourceEventType === 'status.update') {
        continue;
      }
      const activity = streamEventToActivity(eventType, payload, occurredAt);
      if (activity) {
        turnActive = !['background.complete', 'review.summary'].includes(eventType)
          || turnActive;
        const existing = message.activities?.find(({ id }) => id === activity.id);
        const mergedActivity = existing
          ? {
              ...activity,
              input: activity.input || existing.input,
              name: activity.name === '命令' ? existing.name : activity.name,
              output: eventType === 'command.output'
                || eventType === 'browser.progress'
                || eventType === 'moa.reference'
                ? appendDelta(existing.output || '', activity.output || '')
                : activity.output || existing.output,
              startedAt: existing.startedAt || activity.startedAt,
              toolName: activity.toolName === '命令' ? existing.toolName : activity.toolName,
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
          status: 'running',
          timingLabel: chinese ? '正在执行' : 'Executing',
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
        : appendDelta(message.content, text);
      if (text && !message.firstTokenAt) {
        firstTokenAt = occurredAt;
        message = { ...message, firstTokenAt: occurredAt };
      }
      message = {
        ...message,
        activities: completeTransientActivities(message.activities, occurredAt),
        completedAt: eventType === 'message.completed' ? occurredAt : undefined,
        content,
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
      if (eventType === 'message.completed') completed = true;
    } else if (eventType === 'turn.cancel_requested') {
      turnActive = true;
      message = {
        ...message,
        activities: finishActivities(message.activities, 'cancelled', occurredAt),
        completedAt: occurredAt,
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
        content: message.content || error,
        status,
        timingLabel: undefined,
        updatedAt: occurredAt,
      };
    } else {
      continue;
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
              status: terminalStatus,
              timingLabel: undefined,
              updatedAt: occurredAt,
            }
          : candidate
      ));
    }
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
  return messages.find((message) => (
    message.role === 'assistant'
    && message.runtimeTurnId === turnId
    && (message.roleStage || 'chat') === roleStage
  )) || {
    activities: [],
    avatarRole: avatarRoleFor(stringValue(payload.profile), roleStage, false),
    content: '',
    createdAt: occurredAt,
    id: `hosted-live:${turnId}:${roleStage}`,
    name: liveRoleName(roleStage, stringValue(payload.profile), chinese),
    profile: stringValue(payload.profile) || undefined,
    rawRoleStage,
    role: 'assistant',
    roleLabel: liveRoleLabel(roleStage, chinese),
    roleStage,
    runtimeTurnId: turnId,
  };
}

function normalizeLiveRoleStage(value: string): HermesChatRoleStage {
  const normalized = value.toLowerCase();
  if (normalized === 'worker' || normalized.startsWith('worker.')) return 'worker';
  if (normalized === 'reviewer' || normalized.startsWith('reviewer.')) return 'reviewer';
  if (normalized === 'reporter' || normalized.startsWith('reporter.')) return 'reporter';
  return 'chat';
}

function liveRoleLabel(stage: HermesChatRoleStage, chinese: boolean): string {
  if (chinese) {
    return {
      chat: 'Hermes Agent',
      worker: '任务执行',
      reviewer: '结果审核',
      reporter: '最终汇报',
      dispatcher: '任务调度',
      supervisor: '流程监督',
    }[stage];
  }
  return {
    chat: 'Hermes Agent',
    worker: 'Execution',
    reviewer: 'Review',
    reporter: 'Final report',
    dispatcher: 'Task dispatch',
    supervisor: 'Workflow supervision',
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
  return liveRoleLabel(stage, chinese);
}

function upsertLiveMessage(
  messages: HermesChatViewMessage[],
  message: HermesChatViewMessage,
): HermesChatViewMessage[] {
  const index = messages.findIndex((candidate) => (
    candidate.role === 'assistant'
    && candidate.runtimeTurnId === message.runtimeTurnId
    && (candidate.roleStage || 'chat') === (message.roleStage || 'chat')
  ));
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
  if (!current || complete.length >= current.length) return complete;
  return current;
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
