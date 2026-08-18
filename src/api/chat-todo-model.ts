import type { HermesChatActivity, HermesChatTodo, HermesChatTodoStatus } from './chat-view-types';

const TODO_STATUS_ALIASES: Record<string, HermesChatTodoStatus> = {
  active: 'in_progress',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  complete: 'completed',
  completed: 'completed',
  doing: 'in_progress',
  done: 'completed',
  finished: 'completed',
  in_progress: 'in_progress',
  inprogress: 'in_progress',
  pending: 'pending',
  queued: 'pending',
  todo: 'pending',
  waiting: 'pending',
  未开始: 'pending',
  待办: 'pending',
  待处理: 'pending',
  已完成: 'completed',
  已取消: 'cancelled',
  进行中: 'in_progress',
  执行中: 'in_progress',
};

/** Parse the several todo payload shapes emitted by hosted and legacy agents. */
export function parseTodoItems(value: unknown): HermesChatTodo[] | null {
  const parsed = parseTodoValue(value, 0);
  if (!parsed) return null;
  const items = Array.isArray(parsed) ? parsed : parsed.todos;
  if (!Array.isArray(items)) return null;
  return items.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const title = firstString(
      item.title,
      item.content,
      item.text,
      item.description,
      item.label,
      item.name,
    );
    if (!title) return [];
    const id = firstString(item.id, item.key, item.uuid) || `todo-${index + 1}`;
    return [{
      id,
      title,
      status: normalizeTodoStatus(item.status),
    }];
  });
}

/** Return the newest todo snapshot carried by one mapped activity. */
export function todoItemsFromActivity(activity: HermesChatActivity): HermesChatTodo[] | null {
  const name = `${activity.toolName || ''} ${activity.name || ''}`.toLowerCase();
  if (!/(?:^|[^a-z])todo(?:$|[^a-z])|待办|任务清单/.test(name)) return null;
  return parseTodoItems(activity.output) || parseTodoItems(activity.input);
}

export function normalizeTodoStatus(value: unknown): HermesChatTodoStatus {
  const normalized = String(value ?? 'pending')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return TODO_STATUS_ALIASES[normalized] || 'pending';
}

function parseTodoValue(value: unknown, depth: number): { todos: unknown[] } | unknown[] | null {
  if (depth > 3 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (!text) return null;
    try {
      return parseTodoValue(JSON.parse(text), depth + 1);
    } catch {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return parseTodoValue(JSON.parse(text.slice(start, end + 1)), depth + 1);
        } catch {
          return null;
        }
      }
      const arrayStart = text.indexOf('[');
      const arrayEnd = text.lastIndexOf(']');
      if (arrayStart >= 0 && arrayEnd > arrayStart) {
        try {
          return parseTodoValue(JSON.parse(text.slice(arrayStart, arrayEnd + 1)), depth + 1);
        } catch {
          return null;
        }
      }
      return null;
    }
  }
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return null;
  if (Array.isArray(value.todos)) return { todos: value.todos };
  for (const key of ['items', 'tasks', 'plan', 'data', 'result', 'output', 'content']) {
    const nested = parseTodoValue(value[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() || '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
