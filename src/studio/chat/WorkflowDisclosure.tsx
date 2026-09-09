import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { MOTION, useMotion } from '../../design/motion';

const EASE = Easing.bezier(0.2, 0, 0, 1);

/** Measure natural content independently of its clipped, animated container. */
export function WorkflowDisclosure({ open, children, style }: {
  open: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const motion = useMotion();
  const [mounted, setMounted] = useState(open);
  const measured = useRef(0);
  const openRef = useRef(open);
  const transitioning = useRef(false);
  const lastOpenChildren = useRef(children);
  if (open) lastOpenChildren.current = children;
  const height = useSharedValue(0);
  const opacity = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    openRef.current = open;
    transitioning.current = true;
    if (open) setMounted(true);
    height.value = withTiming(open ? measured.current : 0, {
      duration: motion.duration(MOTION.duration.transition), easing: EASE,
    });
    opacity.value = withTiming(open ? 1 : 0, { duration: motion.fadeDuration() });
    const timer = setTimeout(() => {
      transitioning.current = false;
      if (!open) setMounted(false);
    }, motion.duration(MOTION.duration.transition));
    return () => clearTimeout(timer);
  }, [open, motion, height, opacity]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    if (Math.abs(next - measured.current) < 0.5) return;
    measured.current = next;
    if (!openRef.current) return;
    // Only disclosure changes tween height. Token growth never restarts a layout animation.
    height.value = transitioning.current
      ? withTiming(next, { duration: motion.duration(MOTION.duration.transition), easing: EASE })
      : next;
  }, [height, motion]);
  const animatedStyle = useAnimatedStyle(() => ({ height: height.value, opacity: opacity.value }));

  return <Animated.View style={[styles.clip, animatedStyle]} pointerEvents={open ? 'auto' : 'none'}
    accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
    {mounted || open ? <View onLayout={onLayout} style={[styles.content, style]}>
      {open ? children : lastOpenChildren.current}
    </View> : null}
  </Animated.View>;
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  content: { position: 'absolute', top: 0, left: 0, right: 0 },
});
