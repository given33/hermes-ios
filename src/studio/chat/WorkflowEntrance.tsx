import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useMotion } from '../../design/motion';

const EASE = Easing.bezier(0.2, 0, 0, 1);

/** Property animation keeps streaming nodes in normal flow on native and web. */
export function useWorkflowEntrance(distance = 0, enabled = true) {
  const motion = useMotion();
  const reduceMotion = motion.reduceMotion;
  const progress = useSharedValue(enabled ? 0 : 1);
  useEffect(() => {
    progress.value = withTiming(1, { duration: enabled ? motion.fadeDuration(180) : 0, easing: EASE });
  }, [enabled, motion, progress]);
  return useAnimatedStyle(() => ({
    opacity: progress.value,
    ...(distance ? { transform: [{ translateY: reduceMotion ? 0 : distance * (1 - progress.value) }] } : {}),
  }));
}

export function WorkflowEntrance({ children, style, enabled = true }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  enabled?: boolean;
}) {
  const entrance = useWorkflowEntrance(4, enabled);
  return <Animated.View style={[style, entrance]}>{children}</Animated.View>;
}
