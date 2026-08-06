import type {
  HermesChatActivity,
  HermesChatViewMessage,
} from '../../api/chat-view-types';

export type ChatPlanItemStatus = 'cancelled' | 'completed' | 'in_progress' | 'pending';

export interface ChatPlanItem {
  content: string;
  id: string;
  status: ChatPlanItemStatus;
}

export interface ChatPlan {
  completed: number;
  items: ChatPlanItem[];
  total: number;
  updatedAt: number;
}

interface TodoSnapshot {
  todos?: unknown;
}

const TODO_STATUSES = new Set<ChatPlanItemStatus>([
  'cancelled',
  'completed',
  'in_progress',
  'pending',
]);

/** Resolve the latest full todo-tool snapshot across the current conversation. */
export function latestChatPlan(messages: readonly HermesChatViewMessage[]): ChatPlan | null {
  const snapshots = messages.flatMap((message) => (
    (message.activities || []).flatMap((activity) => {
      if (!isTodoActivity(activity)) return [];
      const items = parseTodoItems(activity.output) || parseTodoItems(activity.input);
      if (!items) return [];
      return [{
        items,
        updatedAt: activity.completedAt
          || activity.startedAt
          || message.updatedAt
          || message.createdAt
          || 0,
      }];
    })
  ));
  const latest = snapshots.sort((left, right) => right.updatedAt - left.updatedAt)[0];
  // An empty todo snapshot is a clear signal that no plan is active. Treat it
  // as absence instead of opening a full-width drawer that only says
  // “暂无计划”; the drawer is reserved for an actual model-generated plan.
  if (!latest || latest.items.length === 0) return null;
  return {
    completed: latest.items.filter(({ status }) => status === 'completed').length,
    items: latest.items,
    total: latest.items.length,
    updatedAt: latest.updatedAt,
  };
}

function isTodoActivity(activity: HermesChatActivity): boolean {
  return [activity.toolName, activity.name]
    .some((value) => value?.trim().toLowerCase() === 'todo');
}

function parseTodoItems(value: string | undefined): ChatPlanItem[] | null {
  if (!value?.trim()) return null;
  const snapshot = parseTodoSnapshot(value);
  if (!snapshot || !Array.isArray(snapshot.todos)) return null;
  return snapshot.todos.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const content = String(item.content || '').trim();
    if (!content) return [];
    const rawStatus = String(item.status || 'pending').trim().toLowerCase();
    const status = TODO_STATUSES.has(rawStatus as ChatPlanItemStatus)
      ? rawStatus as ChatPlanItemStatus
      : 'pending';
    return [{
      content,
      id: String(item.id || `plan-${index + 1}`),
      status,
    }];
  });
}

function parseTodoSnapshot(value: string): TodoSnapshot | null {
  try {
    return JSON.parse(value) as TodoSnapshot;
  } catch {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(value.slice(start, end + 1)) as TodoSnapshot;
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
