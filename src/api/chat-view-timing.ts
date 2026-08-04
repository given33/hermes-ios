import type {
  HermesChatActivity,
  HermesChatActivityStatus,
  HermesChatViewMessage,
} from './chat-view-types';
import { stringValue } from './chat-view-values';

export const TERMINAL_TURN_STATES = new Set([
  'cancelled',
  'completed',
  'failed',
  'stopped',
]);

export function normalizeStatus(value: unknown): HermesChatActivityStatus {
  const normalized = stringValue(value).toLowerCase();
  if (normalized === 'failed' || normalized === 'error') return 'failed';
  if (normalized === 'running' || normalized === 'streaming') return 'running';
  if (normalized === 'queued' || normalized === 'pending' || normalized === 'starting') {
    return 'queued';
  }
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'stopped') {
    return 'cancelled';
  }
  return 'completed';
}

export function normalizeMessageStatus(value: unknown): string {
  return normalizeStatus(value);
}

export function formatActivitySummary(
  message: Pick<
    HermesChatViewMessage,
    'activities' | 'completedAt' | 'durationMs' | 'startedAt' | 'status' | 'timingLabel' | 'updatedAt'
  >,
  chinese = true,
  now = Date.now(),
): string {
  const running = messageIsRunning(message);
  const durationMs = messageDurationMs(message, now);
  const prefix = message.timingLabel || (running
    ? chinese ? '处理中' : 'Processing'
    : chinese ? '已处理' : 'Processed');
  if (running && /^(?:正在思考|正在重连|Thinking|Reconnecting)/i.test(prefix)) {
    return prefix;
  }
  return `${prefix} ${formatCompactDuration(durationMs)}`;
}

export function messageHasExecutionTiming(
  message: Pick<
    HermesChatViewMessage,
    'completedAt' | 'durationMs' | 'firstTokenAt' | 'modelStartedAt' | 'roleStage' | 'startedAt' | 'status' | 'updatedAt'
  >,
): boolean {
  if (message.roleStage === 'chat' && message.status === 'failed' && !message.firstTokenAt) {
    return false;
  }
  return Boolean(
    message.startedAt
    || message.completedAt
    || message.updatedAt
    || message.durationMs
    || message.status,
  );
}

export function messageDurationMs(
  message: Pick<
    HermesChatViewMessage,
    'activities' | 'completedAt' | 'durationMs' | 'firstTokenAt' | 'modelStartedAt' | 'startedAt'
    | 'status' | 'updatedAt'
  >,
  now = Date.now(),
): number {
  const running = messageIsRunning(message);
  const modelBoundary = message.modelStartedAt || message.startedAt;
  const firstTokenLowerBound = modelBoundary && message.firstTokenAt
    ? Math.max(0, message.firstTokenAt - modelBoundary)
    : 0;
  if (running && message.startedAt) {
    return Math.max(0, now - message.startedAt);
  }
  if (!running && message.modelStartedAt) {
    return Math.max(
      firstTokenLowerBound,
      (message.completedAt || message.updatedAt || now) - message.modelStartedAt,
    );
  }
  if ((message.durationMs || 0) > 0) {
    return Math.max(firstTokenLowerBound, message.durationMs || 0);
  }
  if (message.startedAt) {
    return Math.max(
      firstTokenLowerBound,
      (message.completedAt || message.updatedAt || now) - message.startedAt,
    );
  }
  return firstTokenLowerBound;
}

export function messageIsRunning(
  message: Pick<HermesChatViewMessage, 'activities' | 'status'>,
): boolean {
  const status = (message.status || '').toLowerCase();
  if (TERMINAL_TURN_STATES.has(status)) return false;
  return ['pending', 'queued', 'running', 'starting', 'streaming'].includes(status)
    || Boolean(message.activities?.some(({ status: activityStatus }) => (
      activityStatus === 'queued' || activityStatus === 'running'
    )));
}

export function formatMessageLocalTime(
  timestamp: number | undefined,
  chinese = true,
  now = Date.now(),
): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const current = new Date(now);
  const time = `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
  const sameDay = date.getFullYear() === current.getFullYear()
    && date.getMonth() === current.getMonth()
    && date.getDate() === current.getDate();
  if (sameDay) return time;
  if (date.getFullYear() === current.getFullYear()) {
    return chinese
      ? `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
      : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

export function messageStatusLabel(status: string | undefined, chinese = true): string {
  const normalized = normalizeMessageStatus(status);
  const labels = chinese
    ? {
        cancelled: '已取消',
        completed: '已完成',
        failed: '失败',
        queued: '排队中',
        running: '执行中',
      }
    : {
        cancelled: 'Cancelled',
        completed: 'Completed',
        failed: 'Failed',
        queued: 'Queued',
        running: 'Running',
      };
  return labels[normalized as keyof typeof labels];
}

function formatCompactDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function padTime(value: number): string {
  return String(value).padStart(2, '0');
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_TURN_STATES.has(status) || status === 'cancelled';
}

export function firstActivityTimestamp(activities?: HermesChatActivity[]): number {
  const timestamps = (activities || [])
    .map(({ startedAt }) => startedAt)
    .filter((value): value is number => Boolean(value));
  return timestamps.length ? Math.min(...timestamps) : 0;
}

export function lastActivityTimestamp(activities?: HermesChatActivity[]): number {
  return Math.max(
    0,
    ...((activities || []).map(({ completedAt, startedAt }) => (
      completedAt || startedAt || 0
    ))),
  );
}

export function calculateDurationMs(
  startedAt: number,
  endedAt: number,
  activities?: HermesChatActivity[],
): number {
  if (startedAt && endedAt) return Math.max(0, endedAt - startedAt);
  const first = firstActivityTimestamp(activities);
  const last = lastActivityTimestamp(activities);
  if (first && last) return Math.max(0, last - first);
  return Math.max(0, ...(activities || []).map(({ durationMs }) => durationMs || 0));
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds <= 0) return '';
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}
