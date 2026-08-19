import { isRecord, stringValue } from '../api/chat-view-values';
import type { HermesChatAvatarRole, HermesChatViewMessage } from '../api/chat-view-model';
import type { NativeThemeTokens } from '../design/theme-types';
import { teamMemberAvatarRole, teamMemberRoleFor } from './team-participants-model';

/**
 * 编排工作流(orchestrator-worker)todolist 卡片的纯逻辑层。
 * manager 下发的计划经 `parseTodoListItems` 解析为 `TodoItem[]`,
 * 每项状态由本轮 hosted turn 的执行轨迹(activities)与终态推导,
 * 不在任何客户端凭空捏造状态。
 */

/** 卡片渲染所需的四态:完成 / 进行中 / 等待 / 失败。 */
export type TodoItemStatus = 'completed' | 'failed' | 'in_progress' | 'pending';

/** 状态图标(纯文本字形约定):✓ / ⟳ / ○ / ✗。 */
export type TodoItemIcon = 'check' | 'circle' | 'cross' | 'spinner';

/** manager_plan 单项:服务端字段 + 客户端推导出的 status。 */
export interface TodoItem {
  id: string;
  title: string;
  assignee: string;
  depends_on: readonly string[];
  user_task_fragment: string;
  status: TodoItemStatus;
  /** 服务端原始状态串;仅用于判断是否跳过客户端推导,渲染层不读。 */
  rawStatus?: string;
}

/** 状态推导所依赖的执行轨迹子集(HermesChatActivity 可直接赋值)。 */
export interface TodoProgressActivity {
  status: string;
  agentName?: string;
  detail?: string;
  id?: string;
  input?: string;
  memberId?: string;
  name: string;
  output?: string;
  preview?: string;
  toolName?: string;
}

export interface TodoListProgressContext {
  activities?: readonly TodoProgressActivity[];
  /** 本轮 hosted turn 的终态(已由视图模型折叠进 message.status)。 */
  turnStatus?: string;
}

const STATUS_ALIASES: Record<string, TodoItemStatus> = {
  blocked: 'failed',
  cancel: 'failed',
  canceled: 'failed',
  cancelled: 'failed',
  complete: 'completed',
  completed: 'completed',
  did: 'completed',
  done: 'completed',
  error: 'failed',
  failed: 'failed',
  finished: 'completed',
  in_progress: 'in_progress',
  inprogress: 'in_progress',
  pending: 'pending',
  queued: 'pending',
  running: 'in_progress',
  skipped: 'failed',
  stopped: 'failed',
  waiting: 'pending',
  失败: 'failed',
  已完成: 'completed',
  已取消: 'failed',
  待处理: 'pending',
  待开始: 'pending',
  进行中: 'in_progress',
  错误: 'failed',
};

const RUNNING_ACTIVITY_STATUSES = new Set(['queued', 'running', 'starting', 'streaming']);
const FAILED_ACTIVITY_STATUSES = new Set(['blocked', 'cancelled', 'canceled', 'failed', 'stopped']);
const COMPLETED_ACTIVITY_STATUSES = new Set(['completed']);

/**
 * 解析 manager 计划载荷为数组。接受:
 * - 数组本身(meta.todolist 的常见形态);
 * - { plan: [...] } / { items: [...] } 等包装(meta.manager_plan 的形态);
 * - JSON 字符串(遗留载荷把计划序列化成文本)。
 * 无法解析或没有合法项时返回 null,调用方回退到普通 Markdown 渲染。
 */
export function parseTodoListItems(value: unknown): TodoItem[] | null {
  const list = extractTodoArray(value, 0);
  if (!list?.length) return null;
  const items = list.flatMap((entry, index): TodoItem[] => {
    if (!isRecord(entry)) return [];
    const title = firstString(entry.title, entry.task, entry.label, entry.name, entry.text);
    if (!title) return [];
    const id = firstString(entry.id, entry.key, entry.step) || `step-${index + 1}`;
    const rawStatus = firstString(entry.status);
    return [{
      id,
      title,
      assignee: firstString(entry.assignee, entry.worker, entry.member, entry.owner),
      depends_on: stringIdList(entry.depends_on ?? entry.dependsOn ?? entry.dependencies ?? entry.after),
      user_task_fragment: firstString(
        entry.user_task_fragment,
        entry.userTaskFragment,
        entry.fragment,
        entry.task_fragment,
      ),
      status: normalizeTodoItemStatus(rawStatus),
      ...(rawStatus ? { rawStatus } : {}),
    }];
  });
  return items.length ? items : null;
}

/**
 * 从一条聊天消息中提取 todolist 计划并推导每项状态。
 * 检测条件:message.meta.todolist 或 message.meta.manager_plan.plan 存在且为数组
 * (同时兼容 metadata 包装与消息顶层字段)。视图层只做防御式读取,
 * 数据层(src/api)不为此改动。
 */
export function todoListItemsForMessage(
  message: Pick<HermesChatViewMessage, 'activities' | 'status' | 'planItems'>,
): TodoItem[] | null {
  // Primary: the typed planItems field set by collaborationMessageToView
  // (reads server meta.todolist / meta.manager_plan). Fallback: defensive
  // reads for messages constructed outside the standard pipeline.
  const raw = message.planItems
    ?? (() => {
      const source = message as unknown as Record<string, unknown>;
      const meta: Record<string, unknown> = {
        ...(isRecord(source.meta) ? source.meta : {}),
        ...(isRecord(source.metadata) ? source.metadata : {}),
      };
      return meta.todolist ?? meta.todo_list ?? meta.manager_plan ?? undefined;
    })();
  const items = parseTodoListItems(raw);
  if (!items) return null;
  return deriveTodoListStatuses(items, {
    activities: message.activities,
    turnStatus: message.status,
  });
}

/**
 * 依据执行轨迹推导每项状态:
 * 1. 服务端显式给出的 item.status 优先;
 * 2. 能与 activity 文本(user_task_fragment / 标题)或 memberId 匹配的项,
 *    按其活动聚合 —— 任一失败 → failed,任一运行 → in_progress,全部完成 → completed;
 * 3. 无匹配轨迹的项:turn 已正常收尾(completed)视为已完成,否则等待中。
 */
export function deriveTodoListStatuses(
  items: readonly TodoItem[],
  progress: TodoListProgressContext,
): TodoItem[] {
  const activities = progress.activities || [];
  const turnCompleted = normalizeTurnTerminal(progress.turnStatus) === 'completed';
  return items.map((item, index) => {
    if (isExplicitStatus(item)) return item;
    const matched = activities.filter((activity) => activityMatchesItem(activity, item))
      .concat(memberFallbackActivities(activities, item, items, index));
    if (!matched.length) {
      return { ...item, status: turnCompleted ? 'completed' as const : 'pending' as const };
    }
    return { ...item, status: aggregateActivityStatuses(matched) };
  });
}

/** 四态到图标字形的映射:✓ / ⟳ / ○ / ✗。 */
export function todoItemIcon(status: TodoItemStatus): TodoItemIcon {
  switch (status) {
    case 'completed': return 'check';
    case 'in_progress': return 'spinner';
    case 'failed': return 'cross';
    default: return 'circle';
  }
}

/** 四态的可读标签(无障碍朗读与摘要共用)。 */
export function todoStatusLabel(status: TodoItemStatus, isChinese: boolean): string {
  switch (status) {
    case 'completed': return isChinese ? '已完成' : 'Done';
    case 'in_progress': return isChinese ? '进行中' : 'In progress';
    case 'failed': return isChinese ? '失败' : 'Failed';
    default: return isChinese ? '等待中' : 'Waiting';
  }
}

/** 四态到主题色的映射(传入 useTheme().tokens,深浅色由主题决定)。 */
export function todoStatusColor(
  status: TodoItemStatus,
  tokens: Pick<NativeThemeTokens, 'colors'>,
): string {
  switch (status) {
    case 'completed': return tokens.colors.success;
    case 'in_progress': return tokens.colors.primary;
    case 'failed': return tokens.colors.destructive;
    default: return tokens.colors.textTertiary;
  }
}

/** 依赖标注:无依赖返回空串;依赖 1 项显示「依赖前项」,多项显示数量。 */
export function todoDependencyLabel(item: TodoItem, isChinese: boolean): string {
  const count = item.depends_on.length;
  if (!count) return '';
  return isChinese
    ? (count > 1 ? `依赖前 ${count} 项` : '依赖前项')
    : (count > 1 ? `depends on ${count} steps` : 'depends on previous');
}

/** 指派角色 → 头像角色(复用团队花名册的确定性映射,带各自头像配色)。 */
export function todoAssigneeAvatarRole(assignee: string): HermesChatAvatarRole {
  const normalized = assignee.trim().toLowerCase();
  if (!normalized) return 'hermes';
  return teamMemberAvatarRole(normalized, teamMemberRoleFor(normalized));
}

function normalizeTodoItemStatus(value: unknown): TodoItemStatus {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return STATUS_ALIASES[normalized] || 'pending';
}

function isExplicitStatus(item: TodoItem): boolean {
  // 服务端显式给出且不是默认 pending 时才信任,否则交给轨迹推导:
  // 计划刚下发时各项都是 pending,后续进度必须由 hosted turn 轨迹驱动。
  const raw = item.rawStatus || '';
  return Boolean(raw) && normalizeTodoItemStatus(raw) !== 'pending';
}

function extractTodoArray(value: unknown, depth: number): unknown[] | null {
  if (depth > 3 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (!text) return null;
    try {
      return extractTodoArray(JSON.parse(text), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return null;
  for (const key of ['plan', 'todolist', 'todo_list', 'items', 'tasks', 'steps']) {
    const nested = extractTodoArray(value[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function stringIdList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => stringValue(entry).trim()).filter(Boolean);
}

function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim() || '';
}

/** 去空白归一化:中文任务片段里的空格差异不应破坏子串匹配。 */
function normalizeMatchText(value: unknown): string {
  return stringValue(value).toLowerCase().replace(/\s+/g, '');
}

function activityMatchesItem(
  activity: TodoProgressActivity,
  item: TodoItem,
): boolean {
  const fragment = normalizeMatchText(item.user_task_fragment || item.title);
  if (fragment.length < 2) return false;
  const haystack = [
    activity.name,
    activity.toolName,
    activity.agentName,
    activity.detail,
    activity.preview,
    activity.input,
    activity.output,
  ].map(normalizeMatchText).join('\n');
  return haystack.includes(fragment);
}

/**
 * 文本匹配失败时的兜底:同一 assignee(memberId)只对应一个未匹配项时,
 * 把该成员的全部活动归到这一项,避免并行多 worker 时张冠李戴。
 */
function memberFallbackActivities(
  activities: readonly TodoProgressActivity[],
  item: TodoItem,
  items: readonly TodoItem[],
  index: number,
): readonly TodoProgressActivity[] {
  const assignee = item.assignee.trim().toLowerCase();
  if (!assignee) return [];
  const claimants = items.filter((candidate, position) => (
    position !== index
    && candidate.assignee.trim().toLowerCase() === assignee
    && !activities.some((activity) => activityMatchesItem(activity, candidate))
  ));
  if (claimants.length) return [];
  return activities.filter((activity) => (
    // The activity-level memberId field is optional and rarely populated
    // by the view model (it lives on the HOST MESSAGE, not individual
    // activities). Fall back to matching the activity's agentName against
    // the assignee — teamMemberIdForEvent produces deterministic profile-
    // based names that align with todo assignees.
    (activity.memberId || activity.agentName || '').trim().toLowerCase() === assignee
    || (activity.agentName || '').trim().toLowerCase().includes(assignee)
  ));
}

function aggregateActivityStatuses(
  activities: readonly TodoProgressActivity[],
): TodoItemStatus {
  const statuses = activities.map(({ status }) => (status || '').toLowerCase());
  if (statuses.some((status) => FAILED_ACTIVITY_STATUSES.has(status))) return 'failed';
  if (statuses.some((status) => RUNNING_ACTIVITY_STATUSES.has(status))) return 'in_progress';
  // 取消的活动永远不会完成,按失败收敛;其余以 completed 为准。
  return statuses.some((status) => COMPLETED_ACTIVITY_STATUSES.has(status))
    ? 'completed'
    : 'pending';
}

function normalizeTurnTerminal(value: unknown): 'completed' | 'failed' | null {
  const status = stringValue(value).toLowerCase();
  if (status === 'completed') return 'completed';
  if (['failed', 'error', 'cancelled', 'canceled', 'stopped'].includes(status)) return 'failed';
  return null;
}
