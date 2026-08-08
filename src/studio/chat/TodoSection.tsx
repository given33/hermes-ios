import {
  CheckCircle2,
  Circle,
  CircleDashed,
  ListChecks,
  XCircle,
} from 'lucide-react-native';
import { Text, View } from 'react-native';

import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import type { HermesChatTodo } from '../../api/chat-view-types';
import { styles } from './chat-presentation-styles';

/**
 * Live agent todo list (the `todo` tool). Rendered above the activity
 * timeline while the model works; items are struck through as they are
 * completed and the in-progress item carries a running dot.
 */
export function TodoSection({
  isChinese,
  running,
  todos,
}: {
  isChinese: boolean;
  running: boolean;
  todos: readonly HermesChatTodo[];
}) {
  const { tokens } = useTheme();
  const completed = todos.filter((item) => item.status === 'completed').length;
  return (
    <View style={[styles.todoSection, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.05), borderColor: tokens.colors.border }]}>
      <View style={styles.todoHeader}>
        <ListChecks color={tokens.colors.primary} size={14} />
        <Text style={[styles.todoHeaderTitle, { color: tokens.colors.textSecondary }]}>
          {isChinese ? '待办清单' : 'Todo list'}
        </Text>
        <Text style={[styles.todoCount, { color: tokens.colors.textTertiary }]}>
          {isChinese
            ? `${completed}/${todos.length} 完成`
            : `${completed}/${todos.length} done`}
        </Text>
      </View>
      <View style={styles.todoList}>
        {todos.map((item) => {
          const done = item.status === 'completed';
          const cancelled = item.status === 'cancelled';
          const active = item.status === 'in_progress';
          return (
            <View key={item.id} style={styles.todoRow}>
              {done ? (
                <CheckCircle2 color={tokens.colors.success} size={14} />
              ) : cancelled ? (
                <XCircle color={tokens.colors.textTertiary} size={14} />
              ) : active ? (
                <CircleDashed color={tokens.colors.primary} size={14} />
              ) : (
                <Circle color={tokens.colors.textTertiary} size={14} />
              )}
              <Text
                numberOfLines={2}
                style={[
                  styles.todoTitle,
                  {
                    color: done || cancelled ? tokens.colors.textTertiary : tokens.colors.foreground,
                    textDecorationLine: done || cancelled ? 'line-through' : 'none',
                  },
                ]}
              >
                {item.title}
              </Text>
              {active && running ? (
                <View style={[styles.todoRunningDot, { backgroundColor: tokens.colors.primary }]} />
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
