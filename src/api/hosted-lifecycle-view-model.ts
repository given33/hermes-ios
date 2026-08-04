import type { HostedLifecycleEvent } from './hosted-conversation-events';
import {
  streamEventToActivity,
  type HermesChatActivity,
  type HermesChatViewMessage,
} from './chat-view-model';

export interface HostedLifecycleApplication {
  completed: boolean;
  failed: boolean;
  firstTokenAt?: number;
  messages: HermesChatViewMessage[];
  phase?: 'executing' | 'reconnecting' | 'responding' | 'thinking';
  phaseStartedAt?: number;
  reconnectAttempt?: number;
}

/** Reduce canonical Hermes hosted events directly into one stable chat turn. */
export function applyHostedLifecycleEvents(
  messages: HermesChatViewMessage[],
  events: readonly HostedLifecycleEvent[],
  chinese = true,
): HostedLifecycleApplication {
  let nextMessages = messages;
  let completed = false;
  let failed = false;
  let phase: HostedLifecycleApplication['phase'];
  let phaseStartedAt: number | undefined;
  let reconnectAttempt: number | undefined;
  let firstTokenAt: number | undefined;

  for (const event of events) {
    if (event.role_stage.split(/[.:/]/, 1)[0] !== 'chat') continue;
    const eventType = event.event_type.toLowerCase();
    const occurredAt = positiveTimestamp(event.occurred_at) || Date.now();
    const payload = { ...event.payload };
    if (!stringValue(payload.entity_id) && event.entity_id) payload.entity_id = event.entity_id;
    let message = liveMessageFor(nextMessages, event.turn_id, occurredAt, chinese);
    const sourceEventType = stringValue(payload.source_event_type).toLowerCase();
    const requestAccepted = sourceEventType === 'request.accepted'
      || (!sourceEventType && stringValue(payload.status).toLowerCase() === 'started');
    const explicitModelStartedAt = positiveTimestamp(payload.model_started_at)
      || positiveTimestamp(payload.started_at);
    const modelStartedAt = explicitModelStartedAt
      || message.modelStartedAt
      || occurredAt;

    if (eventType === 'agent.started') {
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
      (eventType === 'thinking.started' || eventType === 'thinking.delta' || eventType === 'thinking.completed')
      && (!sourceEventType || sourceEventType.startsWith('reasoning.'))
    ) {
      const id = stringValue(payload.entity_id) || `thinking:${event.turn_id}`;
      const existing = message.activities?.find((activity) => activity.id === id);
      const text = structuredText(
        payload.text ?? payload.delta ?? payload.output ?? payload.reasoning,
      );
      if (!text && !existing?.output?.trim()) {
        continue;
      }
      const output = appendDelta(existing?.output || '', text);
      const status = eventType === 'thinking.completed' ? 'completed' : 'running';
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
      phaseStartedAt = message.startedAt || occurredAt;
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
    ) {
      if (eventType === 'command.output' && sourceEventType === 'status.update') {
        continue;
      }
      const activity = streamEventToActivity(eventType, payload, occurredAt);
      if (activity) {
        const existing = message.activities?.find(({ id }) => id === activity.id);
        const mergedActivity = existing
          ? {
              ...activity,
              input: activity.input || existing.input,
              name: activity.name === '命令' ? existing.name : activity.name,
              output: eventType === 'command.output'
                ? appendDelta(existing.output || '', activity.output || '')
                : activity.output || existing.output,
              startedAt: existing.startedAt || activity.startedAt,
              toolName: activity.toolName === '命令' ? existing.toolName : activity.toolName,
            }
          : activity;
        const firstOutput = !message.firstTokenAt;
        message = {
          ...message,
          activities: upsertActivity(message.activities, mergedActivity),
          firstTokenAt: message.firstTokenAt || occurredAt,
          modelStartedAt,
          startedAt: message.startedAt || occurredAt,
          status: 'running',
          timingLabel: chinese ? '正在执行' : 'Executing',
          updatedAt: occurredAt,
        };
        if (firstOutput) firstTokenAt = occurredAt;
      }
      phase = 'executing';
      phaseStartedAt = message.startedAt || occurredAt;
    } else if (eventType === 'message.delta' || eventType === 'message.completed') {
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
      phaseStartedAt = message.startedAt || occurredAt;
      if (eventType === 'message.completed') completed = true;
    } else if (eventType === 'turn.cancel_requested') {
      message = {
        ...message,
        activities: finishActivities(message.activities, 'cancelled', occurredAt),
        completedAt: occurredAt,
        status: 'cancelled',
        timingLabel: undefined,
        updatedAt: occurredAt,
      };
    } else if (eventType === 'turn.completed' || eventType === 'turn.cancelled' || eventType === 'turn.failed') {
      completed = eventType === 'turn.completed';
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
  }

  return {
    completed,
    failed,
    firstTokenAt,
    messages: nextMessages,
    phase,
    phaseStartedAt,
    reconnectAttempt,
  };
}

function liveMessageFor(
  messages: readonly HermesChatViewMessage[],
  turnId: string,
  occurredAt: number,
  chinese: boolean,
): HermesChatViewMessage {
  return messages.find((message) => (
    message.role === 'assistant'
    && message.runtimeTurnId === turnId
    && (message.roleStage || 'chat') === 'chat'
  )) || {
    activities: [],
    avatarRole: 'hermes',
    content: '',
    createdAt: occurredAt,
    id: `hosted-live:${turnId}:chat`,
    name: 'Hermes Agent',
    role: 'assistant',
    roleLabel: chinese ? '对话' : 'Chat',
    roleStage: 'chat',
    runtimeTurnId: turnId,
  };
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
