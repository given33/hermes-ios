import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDashed,
  ListTodo,
  X,
} from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { IOSPressable } from '../../components/ios/IOSPressable';
import { useTheme } from '../../design/ThemeProvider';
import type { ChatPlan, ChatPlanItemStatus } from './chat-plan-model';

const BODY_MEDIUM = 'HermesGoogle-IBMPlexSans-500-Normal';
const BODY_SEMIBOLD = 'HermesGoogle-IBMPlexSans-600-Normal';

/**
 * Conversation-local plan disclosure.
 *
 * Todo snapshots are produced by the model through the canonical todo tool;
 * the client only renders the newest complete snapshot. Keeping this panel
 * above the composer avoids a second chat surface, a full-screen swipe drawer,
 * and the old floating close button/empty-plan state.
 */
export function ChatPlanDrawer({
  children,
  isChinese,
  plan,
}: {
  children: ReactNode;
  isChinese: boolean;
  plan: ChatPlan | null;
}) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const completed = plan?.completed || 0;
  const total = plan?.total || 0;

  if (!plan || total === 0) return <>{children}</>;

  return (
    <View style={planStyles.container}>
      <IOSPressable
        accessibilityLabel={isChinese ? '展开或收起计划' : 'Expand or collapse plan'}
        accessibilityState={{ expanded: open }}
        haptic="selection"
        onPress={() => setOpen((current) => !current)}
        style={[
          planStyles.header,
          {
            backgroundColor: tokens.colors.card,
            borderColor: tokens.colors.border,
          },
        ]}
      >
        <View style={planStyles.titleRow}>
          <ListTodo color={tokens.colors.textSecondary} size={16} strokeWidth={1.9} />
          <Text style={[planStyles.title, { color: tokens.colors.foreground }]}>
            {isChinese ? '计划' : 'Plan'} {completed}/{total}
          </Text>
        </View>
        {open ? (
          <ChevronUp color={tokens.colors.textSecondary} size={17} strokeWidth={1.9} />
        ) : (
          <ChevronDown color={tokens.colors.textSecondary} size={17} strokeWidth={1.9} />
        )}
      </IOSPressable>

      {open ? (
        <View
          style={[
            planStyles.content,
            {
              backgroundColor: tokens.colors.foregroundLayer,
              borderColor: tokens.colors.border,
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={planStyles.list}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {plan.items.map((item) => (
              <View key={item.id} style={planStyles.item}>
                <PlanStatusIcon
                  color={item.status === 'cancelled'
                    ? tokens.colors.destructive
                    : item.status === 'pending'
                      ? tokens.colors.textTertiary
                      : tokens.colors.success}
                  status={item.status}
                />
                <Text
                  style={[
                    planStyles.itemText,
                    { color: tokens.colors.foreground },
                    (item.status === 'completed' || item.status === 'cancelled')
                      && planStyles.terminalItemText,
                  ]}
                >
                  {item.content}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {children}
    </View>
  );
}

function PlanStatusIcon({
  color,
  status,
}: {
  color: string;
  status: ChatPlanItemStatus;
}) {
  if (status === 'completed') {
    return <Check color={color} size={16} strokeWidth={2.2} />;
  }
  if (status === 'cancelled') {
    return <X color={color} size={16} strokeWidth={2} />;
  }
  if (status === 'in_progress') {
    return <CircleDashed color={color} size={16} strokeWidth={2} />;
  }
  return <Circle color={color} size={16} strokeWidth={1.7} />;
}

const planStyles = StyleSheet.create({
  container: { minHeight: 0 },
  content: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 5,
    maxHeight: 172,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
    minHeight: 36,
    paddingHorizontal: 12,
  },
  item: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 9,
    minHeight: 30,
    paddingHorizontal: 3,
    paddingVertical: 6,
  },
  itemText: {
    flex: 1,
    fontFamily: BODY_MEDIUM,
    fontSize: 12,
    lineHeight: 17,
    minWidth: 0,
  },
  list: { paddingHorizontal: 11, paddingVertical: 7 },
  terminalItemText: { opacity: 0.55, textDecorationLine: 'line-through' },
  title: { fontFamily: BODY_SEMIBOLD, fontSize: 12, lineHeight: 17 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
});
