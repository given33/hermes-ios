export interface ChatRuntimeStatusActivity {
  name: string;
  output?: string;
  preview?: string;
  startedAt?: number;
}

export type ChatRuntimeWaitingState =
  | {
      attempt: number;
      maxAttempts: number;
      phase: 'reconnecting';
      startedAt: number;
    }
  | {
      phase: 'thinking';
      startedAt: number;
    };

const RECONNECT_PATTERN = /(?:正在重新连接|正在重连|reconnecting)\s*[（(](\d+)\s*\/\s*(\d+)[）)]/i;
const THINKING_PATTERN = /(?:正在思考|thinking)/i;

function runtimeStatusText(activity: ChatRuntimeStatusActivity): string {
  return [activity.name, activity.output, activity.preview]
    .map((value) => value?.trim() || '')
    .filter(Boolean)
    .join(' ');
}

export function isChatRuntimeStatusActivity(
  activity: ChatRuntimeStatusActivity,
): boolean {
  return activity.name === '运行状态'
    || activity.name === 'Runtime status'
    || RECONNECT_PATTERN.test(activity.name)
    || THINKING_PATTERN.test(activity.name);
}

export function latestChatRuntimeWaitingState(
  activities: readonly ChatRuntimeStatusActivity[],
): ChatRuntimeWaitingState | null {
  const latest = activities.reduce<ChatRuntimeStatusActivity | null>((current, activity) => {
    if (!isChatRuntimeStatusActivity(activity)) return current;
    if (!current || (activity.startedAt || 0) >= (current.startedAt || 0)) return activity;
    return current;
  }, null);
  if (!latest) return null;

  const text = runtimeStatusText(latest);
  const reconnect = text.match(RECONNECT_PATTERN);
  if (reconnect) {
    const attempt = Math.max(1, Number(reconnect[1]) || 1);
    const maxAttempts = Math.max(attempt, Number(reconnect[2]) || 5);
    return {
      attempt,
      maxAttempts,
      phase: 'reconnecting',
      startedAt: latest.startedAt || 0,
    };
  }
  if (THINKING_PATTERN.test(text)) {
    return {
      phase: 'thinking',
      startedAt: latest.startedAt || 0,
    };
  }
  return null;
}
