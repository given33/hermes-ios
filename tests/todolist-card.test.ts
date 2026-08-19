import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import type { NativeThemeTokens } from '../src/design/theme-types';
import {
  deriveTodoListStatuses,
  parseTodoListItems,
  todoAssigneeAvatarRole,
  todoDependencyLabel,
  todoItemIcon,
  todoListItemsForMessage,
  todoStatusLabel,
  todoStatusColor,
  type TodoItem,
} from '../src/studio/todolist-card-model';

/**
 * todolist 卡片(编排工作流 manager 计划)测试。
 * 纯逻辑(解析/状态推导/图标/依赖/主题色)直接单测;
 * 组件与聊天流集成按项目惯例做源码结构断言(RN 组件无法在 node 内渲染)。
 */

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

const PLAN_ITEMS = [
  {
    id: 'step-1',
    title: '查询 dbb3 节点状态',
    assignee: 'dbb3-worker',
    depends_on: [],
    user_task_fragment: '查询dbb3的状态',
  },
  {
    id: 'step-2',
    title: '汇总结果并撰写报告',
    assignee: 'pc-worker',
    depends_on: ['step-1'],
    user_task_fragment: '汇总结果',
  },
  {
    id: 'step-3',
    title: '并行校验产物完整性',
    assignee: 'reviewer',
    depends_on: [],
    user_task_fragment: '校验产物',
  },
];

function progressActivity(
  overrides: Partial<{ memberId: string; name: string; status: string }> = {},
) {
  return {
    name: '工具调用',
    status: 'completed',
    ...overrides,
  };
}

/** 浅色主题 tokens(useTheme() 返回值的颜色子集)。 */
const LIGHT_TOKENS = themeTokens({
  destructive: '#C6463F',
  primary: '#2F6FED',
  success: '#3E9C4C',
  textTertiary: '#8A8F98',
});

/** 深色主题 tokens:同名 token 取深色板的不同色值。 */
const DARK_TOKENS = themeTokens({
  destructive: '#E06666',
  primary: '#7AA5F8',
  success: '#5BC46A',
  textTertiary: '#6E7480',
});

function themeTokens(overrides: Partial<NativeThemeTokens['colors']>): Pick<NativeThemeTokens, 'colors'> {
  const base: NativeThemeTokens['colors'] = {
    accent: '#A855F7',
    accentForeground: '#FFFFFF',
    background: '#F7F8F9',
    border: '#E2E5E9',
    card: '#FFFFFF',
    cardForeground: '#17211C',
    destructive: '#C6463F',
    destructiveForeground: '#FFFFFF',
    foreground: '#17211C',
    foregroundLayer: '#F2F5F3',
    input: '#E7EAEE',
    muted: '#EEF0F2',
    mutedForeground: '#5F6672',
    popover: '#FFFFFF',
    popoverForeground: '#17211C',
    primary: '#2F6FED',
    primaryForeground: '#FFFFFF',
    ring: '#2F6FED',
    secondary: '#E8ECF4',
    secondaryForeground: '#1F2A44',
    success: '#3E9C4C',
    textDisabled: '#B4B9C0',
    textSecondary: '#5F6672',
    textTertiary: '#8A8F98',
    warning: '#D28B22',
  };
  return { colors: { ...base, ...overrides } };
}

function messageWithMeta(
  meta: Record<string, unknown>,
  extra: { activities?: unknown[]; status?: string } = {},
) {
  return {
    activities: extra.activities || [],
    status: extra.status || 'running',
    meta,
  } as unknown as Parameters<typeof todoListItemsForMessage>[0];
}

// ---------------------------------------------------------------------------
// 1. 解析与渲染数量
// ---------------------------------------------------------------------------

test('manager_plan.plan 解析出正确数量的计划项并保留字段', () => {
  const items = parseTodoListItems({ plan: PLAN_ITEMS });
  assert.equal(items?.length, 3);
  assert.deepEqual(
    items?.map(({ id }) => id),
    ['step-1', 'step-2', 'step-3'],
  );
  const first = items?.[0];
  assert.equal(first?.title, '查询 dbb3 节点状态');
  assert.equal(first?.assignee, 'dbb3-worker');
  assert.deepEqual(first?.depends_on, []);
  assert.equal(first?.user_task_fragment, '查询dbb3的状态');
});

test('meta.todolist 直接数组与 JSON 字符串载荷均可解析', () => {
  assert.equal(parseTodoListItems(PLAN_ITEMS)?.length, 3);
  const asJson = parseTodoListItems(JSON.stringify({ todolist: PLAN_ITEMS }));
  assert.equal(asJson?.length, 3);
});

test('缺少标题的项被丢弃,全部无效时返回 null', () => {
  const items = parseTodoListItems([
    { id: 'a', title: '有效项', assignee: 'dbb3-worker', depends_on: [], user_task_fragment: 'a' },
    { id: 'b', assignee: 'dbb3-worker', depends_on: [] },
    '垃圾项',
  ]);
  assert.equal(items?.length, 1);
  assert.equal(parseTodoListItems([{ nope: 1 }]), null);
  assert.equal(parseTodoListItems('not json'), null);
  assert.equal(parseTodoListItems(null), null);
});

test('消息检测:meta.todolist / meta.manager_plan.plan 命中,无计划返回 null', () => {
  assert.equal(todoListItemsForMessage(messageWithMeta({ todolist: PLAN_ITEMS }))?.length, 3);
  assert.equal(
    todoListItemsForMessage(messageWithMeta({ manager_plan: { plan: PLAN_ITEMS } }))?.length,
    3,
  );
  // metadata 包装与消息顶层字段同样兼容。
  const wrapped = {
    activities: [],
    metadata: { todolist: PLAN_ITEMS },
    status: 'running',
  } as unknown as Parameters<typeof todoListItemsForMessage>[0];
  assert.equal(todoListItemsForMessage(wrapped)?.length, 3);
  assert.equal(todoListItemsForMessage({ activities: [], status: 'running' }), null);
  assert.equal(todoListItemsForMessage(messageWithMeta({ todolist: [] })), null);
});

// ---------------------------------------------------------------------------
// 2. 状态推导(hosted turn 执行轨迹 → 每项四态)
// ---------------------------------------------------------------------------

test('执行轨迹按 user_task_fragment 匹配并聚合出完成/进行/失败', () => {
  const items = deriveTodoListStatuses(parseTodoListItems(PLAN_ITEMS) || [], {
    activities: [
      progressActivity({ name: '执行 查询dbb3的状态', status: 'completed' }),
      progressActivity({ name: '执行 汇总结果', status: 'running' }),
      progressActivity({ name: '执行 校验产物', status: 'failed' }),
    ],
    turnStatus: 'running',
  });
  assert.deepEqual(
    items.map(({ status }) => status),
    ['completed', 'in_progress', 'failed'],
  );
});

test('无匹配轨迹的项:turn 运行中为等待,turn 完成后视为已完成', () => {
  const running = deriveTodoListStatuses(parseTodoListItems(PLAN_ITEMS) || [], {
    activities: [],
    turnStatus: 'running',
  });
  assert.ok(running.every(({ status }) => status === 'pending'));

  const finished = deriveTodoListStatuses(parseTodoListItems(PLAN_ITEMS) || [], {
    activities: [],
    turnStatus: 'completed',
  });
  assert.ok(finished.every(({ status }) => status === 'completed'));
});

test('memberId 兜底:唯一指向该 assignee 的活动归入对应项', () => {
  const items = deriveTodoListStatuses(parseTodoListItems(PLAN_ITEMS) || [], {
    activities: [progressActivity({ memberId: 'reviewer', status: 'completed' })],
    turnStatus: 'running',
  });
  assert.deepEqual(
    items.map(({ status }) => status),
    ['pending', 'pending', 'completed'],
  );
});

test('服务端显式给出的非 pending 状态优先于轨迹推导', () => {
  const drafts = parseTodoListItems([
    { id: 's1', title: '显式失败项', assignee: 'dbb3-worker', depends_on: [], status: 'failed' },
  ]);
  const items = deriveTodoListStatuses(drafts || [], {
    activities: [progressActivity({ name: '显式失败项', status: 'completed' })],
    turnStatus: 'running',
  });
  assert.equal(items[0].status, 'failed');
});

// ---------------------------------------------------------------------------
// 3. 状态图标与标签映射
// ---------------------------------------------------------------------------

test('四态图标映射:✓ / ⟳ / ○ / ✗', () => {
  assert.equal(todoItemIcon('completed'), 'check');
  assert.equal(todoItemIcon('in_progress'), 'spinner');
  assert.equal(todoItemIcon('pending'), 'circle');
  assert.equal(todoItemIcon('failed'), 'cross');
  assert.equal(todoStatusLabel('completed', true), '已完成');
  assert.equal(todoStatusLabel('pending', false), 'Waiting');
});

// ---------------------------------------------------------------------------
// 4. 依赖标记
// ---------------------------------------------------------------------------

test('依赖标注:无依赖为空,单项显示「依赖前项」,多项显示数量', () => {
  const noDep: TodoItem = {
    id: 'a', title: '甲', assignee: 'dbb3-worker', depends_on: [], user_task_fragment: '', status: 'pending',
  };
  const single: TodoItem = { ...noDep, id: 'b', depends_on: ['a'] };
  const multi: TodoItem = { ...noDep, id: 'c', depends_on: ['a', 'b'] };
  assert.equal(todoDependencyLabel(noDep, true), '');
  assert.equal(todoDependencyLabel(single, true), '依赖前项');
  assert.equal(todoDependencyLabel(multi, true), '依赖前 2 项');
  assert.equal(todoDependencyLabel(single, false), 'depends on previous');
  assert.equal(todoDependencyLabel(multi, false), 'depends on 2 steps');
});

// ---------------------------------------------------------------------------
// 5. 深浅色主题下的状态颜色
// ---------------------------------------------------------------------------

test('状态色取自主题 tokens,深浅色各自成立', () => {
  assert.equal(todoStatusColor('completed', LIGHT_TOKENS), '#3E9C4C');
  assert.equal(todoStatusColor('in_progress', LIGHT_TOKENS), '#2F6FED');
  assert.equal(todoStatusColor('pending', LIGHT_TOKENS), '#8A8F98');
  assert.equal(todoStatusColor('failed', LIGHT_TOKENS), '#C6463F');

  assert.equal(todoStatusColor('completed', DARK_TOKENS), '#5BC46A');
  assert.equal(todoStatusColor('in_progress', DARK_TOKENS), '#7AA5F8');
  assert.equal(todoStatusColor('pending', DARK_TOKENS), '#6E7480');
  assert.equal(todoStatusColor('failed', DARK_TOKENS), '#E06666');
});

test('指派角色映射为确定性头像角色(头像配色来源)', () => {
  assert.equal(todoAssigneeAvatarRole('dbb3-worker'), 'dbb3-worker');
  assert.equal(todoAssigneeAvatarRole('pc-worker'), 'pc-worker');
  assert.equal(todoAssigneeAvatarRole('dbb3-manager'), 'dispatcher');
  assert.equal(todoAssigneeAvatarRole('reviewer'), 'reviewer');
  assert.equal(todoAssigneeAvatarRole(''), 'hermes');
});

// ---------------------------------------------------------------------------
// 6. 组件与聊天流集成(源码结构断言,项目既有惯例)
// ---------------------------------------------------------------------------

test('TodoListCard 每项渲染一行并使用主题 token 与四态图标', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/studio/TodoListCard.tsx'), 'utf8');
  // 数量:逐项 map 渲染,key 绑定 item.id。
  assert.match(source, /items\.map\(/);
  assert.match(source, /key=\{item\.id\}/);
  // 主题:useTheme().tokens 提供深浅色,状态色经 todoStatusColor 取自 tokens。
  assert.match(source, /useTheme\(\)/);
  assert.match(source, /todoStatusColor\(item\.status, tokens\)/);
  assert.match(source, /tokens\.colors\.textTertiary/);
  // 四态图标:✓ ⟳ ○ ✗。
  assert.match(source, /case 'check': return <CheckCircle2/);
  assert.match(source, /case 'spinner': return <RefreshCw/);
  assert.match(source, /case 'cross': return <XCircle/);
  assert.match(source, /default: return <Circle/);
  // 依赖标注与指派角色渲染。
  assert.match(source, /dependencyLabel/);
  assert.match(source, /StudioRoleAvatar/);
  assert.match(source, /todoAssigneeAvatarRole/);
});

test('ChatPresentation 在 meta 携带计划时渲染 TodoListCard 而非 Markdown', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/studio/chat/ChatPresentation.tsx'),
    'utf8',
  );
  assert.match(source, /import \{ TodoListCard \} from '\.\.\/TodoListCard'/);
  assert.match(source, /todoListItemsForMessage/);
  // 检测命中 → TodoListCard 与正文 Markdown 并存(卡片在上,正文在下)。
  assert.match(
    source,
    /\{todoListItems\?\.length \? \(\s*<TodoListCard isChinese=\{isChinese\} items=\{todoListItems\} \/>\s*\) : null\}\s*\{message\.content\.trim\(\) \? <Markdown/,
  );
  // 气泡判定包含计划项,meta-only 计划消息也有气泡。
  assert.match(source, /todoListItems\?\.length,\s*\);/);
});
