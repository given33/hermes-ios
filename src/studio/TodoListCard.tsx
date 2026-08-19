import {
  CheckCircle2,
  Circle,
  ListChecks,
  RefreshCw,
  XCircle,
} from 'lucide-react-native';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { StudioRoleAvatar } from '../components/studio/StudioRoleAvatar';
import { multiplyAlpha } from '../design/control-contracts';
import { useTheme } from '../design/ThemeProvider';
import {
  todoAssigneeAvatarRole,
  todoDependencyLabel,
  todoItemIcon,
  todoStatusLabel,
  todoStatusColor,
  type TodoItem,
  type TodoItemIcon,
} from './todolist-card-model';

const BODY_REGULAR = 'HermesGoogle-IBMPlexSans-400-Normal';
const BODY_SEMIBOLD = 'HermesGoogle-IBMPlexSans-600-Normal';
const MONO_REGULAR = 'HermesTerminal-JetBrainsMono-400-Normal';

/**
 * 编排工作流(orchestrator-worker)manager 计划卡片。
 * 垂直 todolist:每行 = 左侧状态图标(✓/⟳/○/✗)+ 指派角色头像,
 * 右侧标题 + 指派者与依赖标注;多项之间的依赖/并行关系由 depends_on 决定。
 * 配色全部来自 useTheme().tokens,深浅色自动切换。
 */
export function TodoListCard({
  isChinese,
  items,
}: {
  isChinese: boolean;
  items: readonly TodoItem[];
}) {
  const { tokens } = useTheme();
  const completed = useMemo(
    () => items.filter((item) => item.status === 'completed').length,
    [items],
  );
  // 每行的静态派生(图标、头像角色、依赖标注)随 items 一次算好,
  // 流式刷新时避免逐行重复字符串处理。
  const rows = useMemo(() => items.map((item) => ({
    avatarRole: todoAssigneeAvatarRole(item.assignee),
    dependencyLabel: todoDependencyLabel(item, isChinese),
    icon: todoItemIcon(item.status),
    item,
  })), [items, isChinese]);
  return (
    <View
      accessibilityLabel={isChinese
        ? `任务分派,共 ${items.length} 项,${completed} 项完成`
        : `Task plan, ${items.length} items, ${completed} done`}
      style={[
        styles.card,
        {
          backgroundColor: multiplyAlpha(tokens.colors.primary, 0.05),
          borderColor: tokens.colors.border,
        },
      ]}
    >
      <View style={styles.header}>
        <ListChecks color={tokens.colors.primary} size={14} />
        <Text style={[styles.headerTitle, { color: tokens.colors.textSecondary }]}>
          {isChinese ? '任务分派' : 'Task plan'}
        </Text>
        <Text style={[styles.count, { color: tokens.colors.textTertiary }]}>
          {isChinese
            ? `${completed}/${items.length} 完成`
            : `${completed}/${items.length} done`}
        </Text>
      </View>
      <View style={styles.list}>
        {rows.map(({ avatarRole, dependencyLabel, icon, item }) => (
          <TodoItemRow
            avatarRole={avatarRole}
            dependencyLabel={dependencyLabel}
            icon={icon}
            isChinese={isChinese}
            item={item}
            key={item.id}
          />
        ))}
      </View>
    </View>
  );
}

function TodoItemRow({
  avatarRole,
  dependencyLabel,
  icon,
  isChinese,
  item,
}: {
  avatarRole: ReturnType<typeof todoAssigneeAvatarRole>;
  dependencyLabel: string;
  icon: TodoItemIcon;
  isChinese: boolean;
  item: TodoItem;
}) {
  const { tokens } = useTheme();
  const statusColor = todoStatusColor(item.status, tokens);
  const settled = item.status === 'completed' || item.status === 'failed';
  return (
    <View
      accessibilityLabel={[
        todoStatusLabel(item.status, isChinese),
        item.title,
        item.assignee,
        dependencyLabel,
      ].filter(Boolean).join(' · ')}
      style={styles.row}
    >
      <TodoStatusIcon color={statusColor} icon={icon} />
      <View style={styles.avatar}>
        <StudioRoleAvatar role={avatarRole} size={16} />
      </View>
      <View style={styles.rowCopy}>
        <Text
          numberOfLines={2}
          style={[
            styles.title,
            {
              color: settled ? tokens.colors.textTertiary : tokens.colors.foreground,
              textDecorationLine: item.status === 'completed' ? 'line-through' : 'none',
            },
          ]}
        >
          {item.title}
        </Text>
        <View style={styles.metaRow}>
          {item.assignee ? (
            <Text numberOfLines={1} style={[styles.assignee, { color: statusColor }]}>
              {item.assignee}
            </Text>
          ) : null}
          {dependencyLabel ? (
            <View
              style={[
                styles.dependency,
                { backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.06) },
              ]}
            >
              <Text style={[styles.dependencyText, { color: tokens.colors.textTertiary }]}>
                {dependencyLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** 四态图标:完成 ✓ / 进行中 ⟳ / 等待 ○ / 失败 ✗。 */
function TodoStatusIcon({ color, icon }: { color: string; icon: TodoItemIcon }) {
  switch (icon) {
    case 'check': return <CheckCircle2 color={color} size={14} />;
    case 'spinner': return <RefreshCw color={color} size={14} />;
    case 'cross': return <XCircle color={color} size={14} />;
    default: return <Circle color={color} size={14} />;
  }
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, gap: 6, maxWidth: 520, padding: 8, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  headerTitle: { fontFamily: BODY_SEMIBOLD, fontSize: 10, letterSpacing: 0.4, lineHeight: 14, textTransform: 'uppercase' },
  count: { fontFamily: MONO_REGULAR, fontSize: 9, lineHeight: 13, marginLeft: 'auto' },
  list: { gap: 3 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 7, minHeight: 30 },
  avatar: { alignItems: 'center', borderRadius: 8, height: 16, justifyContent: 'center', width: 16 },
  rowCopy: { flex: 1, gap: 1 },
  title: { fontFamily: BODY_REGULAR, fontSize: 12, lineHeight: 17 },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  assignee: { fontFamily: MONO_REGULAR, fontSize: 9, lineHeight: 12 },
  dependency: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  dependencyText: { fontFamily: BODY_REGULAR, fontSize: 9, lineHeight: 12 },
});
