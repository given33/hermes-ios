import {
  Check,
  Circle,
  CircleDashed,
  ListTodo,
  X,
} from 'lucide-react-native';
import {
  type ReactNode,
  useCallback,
  useMemo,
} from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { IOSPressable } from '../../components/ios/IOSPressable';
import { useTheme } from '../../design/ThemeProvider';
import { IOS_MOTION } from '../../design/ios-motion';
import type { ChatPlan, ChatPlanItemStatus } from './chat-plan-model';

const BODY_REGULAR = 'HermesGoogle-IBMPlexSans-400-Normal';
const BODY_MEDIUM = 'HermesGoogle-IBMPlexSans-500-Normal';
const BODY_SEMIBOLD = 'HermesGoogle-IBMPlexSans-600-Normal';
const MONO_REGULAR = 'HermesTerminal-JetBrainsMono-400-Normal';
const SWIPE_ACTIVATION_PX = 16;

export function ChatPlanDrawer({
  children,
  isChinese,
  plan,
}: {
  children: ReactNode;
  isChinese: boolean;
  plan: ChatPlan | null;
}) {
  const { width } = useWindowDimensions();
  const { tokens } = useTheme();
  const drawerWidth = width;
  const offset = useSharedValue(0);
  const gestureStart = useSharedValue(0);

  const settleDrawer = useCallback((nextOpen: boolean) => {
    if (nextOpen) Keyboard.dismiss();
  }, []);
  const closeDrawer = useCallback(() => {
    offset.value = withTiming(0, {
      duration: IOS_MOTION.duration.content,
      easing: Easing.bezier(...IOS_MOTION.curve.decelerate),
    });
  }, [offset]);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-SWIPE_ACTIVATION_PX, SWIPE_ACTIVATION_PX])
    .failOffsetY([-18, 18])
    .onBegin(() => {
      gestureStart.value = offset.value;
    })
    .onUpdate((event) => {
      offset.value = Math.max(0, Math.min(drawerWidth, gestureStart.value + event.translationX));
    })
    .onEnd((event) => {
      const nextOpen = event.velocityX > 650
        || (event.velocityX >= -650 && offset.value >= drawerWidth * 0.38);
      offset.value = withTiming(nextOpen ? drawerWidth : 0, {
        duration: IOS_MOTION.duration.content,
        easing: Easing.bezier(...IOS_MOTION.curve.decelerate),
      });
      runOnJS(settleDrawer)(nextOpen);
    }), [drawerWidth, gestureStart, offset, settleDrawer]);

  const drawerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [0, Math.max(1, drawerWidth * 0.08)], [0, 1], Extrapolation.CLAMP),
    transform: [{
      translateX: interpolate(offset.value, [0, drawerWidth], [-drawerWidth * 0.08, 0], Extrapolation.CLAMP),
    }],
  }));
  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const completed = plan?.completed || 0;
  const total = plan?.total || 0;

  return (
    <GestureDetector gesture={pan}>
      <View style={drawerStyles.workspace}>
        <Reanimated.View
          style={[
            drawerStyles.drawer,
            {
              backgroundColor: tokens.colors.foregroundLayer,
              borderRightColor: tokens.colors.border,
              width: drawerWidth,
            },
            drawerStyle,
          ]}
        >
          <View style={[drawerStyles.header, { borderBottomColor: tokens.colors.border }]}>
            <View style={drawerStyles.titleRow}>
              <ListTodo color={tokens.colors.foreground} size={18} strokeWidth={1.9} />
              <Text style={[drawerStyles.title, { color: tokens.colors.foreground }]}>
                {total > 0
                  ? `${isChinese ? '计划' : 'Plan'} ${completed}/${total}`
                  : (isChinese ? '计划' : 'Plan')}
              </Text>
            </View>
            <IOSPressable
              accessibilityLabel={isChinese ? '关闭计划' : 'Close plan'}
              onPress={closeDrawer}
              style={drawerStyles.close}
            >
              <X color={tokens.colors.textSecondary} size={18} strokeWidth={1.8} />
            </IOSPressable>
          </View>

          <ScrollView
            contentContainerStyle={drawerStyles.list}
            decelerationRate="normal"
            showsVerticalScrollIndicator={false}
          >
            {plan?.items.length ? plan.items.map((item) => (
              <View
                key={item.id}
                style={[
                  drawerStyles.item,
                  {
                    backgroundColor: tokens.colors.card,
                    borderColor: item.status === 'in_progress'
                      ? tokens.colors.success
                      : tokens.colors.border,
                  },
                ]}
              >
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
                    drawerStyles.itemText,
                    { color: tokens.colors.foreground },
                    (item.status === 'completed' || item.status === 'cancelled')
                      && drawerStyles.terminalItemText,
                  ]}
                >
                  {item.content}
                </Text>
              </View>
            )) : (
              <View style={drawerStyles.empty}>
                <CircleDashed color={tokens.colors.textTertiary} size={22} strokeWidth={1.6} />
                <Text style={[drawerStyles.emptyText, { color: tokens.colors.textSecondary }]}>
                  {isChinese ? '暂无计划' : 'No active plan'}
                </Text>
              </View>
            )}
          </ScrollView>
        </Reanimated.View>

        <Reanimated.View style={[drawerStyles.surface, surfaceStyle]}>
          {children}
        </Reanimated.View>
      </View>
    </GestureDetector>
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
    return <Check color={color} size={17} strokeWidth={2.2} />;
  }
  if (status === 'cancelled') {
    return <X color={color} size={17} strokeWidth={2} />;
  }
  if (status === 'in_progress') {
    return <CircleDashed color={color} size={17} strokeWidth={2} />;
  }
  return <Circle color={color} size={17} strokeWidth={1.7} />;
}

const drawerStyles = StyleSheet.create({
  close: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  drawer: { borderRightWidth: StyleSheet.hairlineWidth, bottom: 0, left: 0, position: 'absolute', top: 0, zIndex: 1 },
  empty: { alignItems: 'center', gap: 10, justifyContent: 'center', minHeight: 180 },
  emptyText: { fontFamily: BODY_REGULAR, fontSize: 12, lineHeight: 17 },
  header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 54, paddingHorizontal: 14 },
  item: { alignItems: 'flex-start', borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 42, paddingHorizontal: 12, paddingVertical: 11 },
  itemText: { flex: 1, fontFamily: BODY_MEDIUM, fontSize: 12, lineHeight: 18, minWidth: 0 },
  list: { gap: 7, paddingBottom: 22, paddingHorizontal: 12, paddingTop: 12 },
  surface: { flex: 1, minHeight: 0, overflow: 'hidden', zIndex: 2 },
  terminalItemText: { opacity: 0.55, textDecorationLine: 'line-through' },
  title: { fontFamily: MONO_REGULAR, fontSize: 13, lineHeight: 18 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  workspace: { flex: 1, minHeight: 0, overflow: 'hidden' },
});
