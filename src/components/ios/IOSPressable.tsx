import * as Haptics from 'expo-haptics';
import { type ReactNode, useState } from 'react';
import {
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { IOS_MOTION } from '../../design/ios-motion';

const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);

export type IOSHaptic = 'light' | 'medium' | 'none' | 'selection';

export interface IOSPressableProps
  extends Omit<PressableProps, 'children' | 'style'> {
  children?: ReactNode;
  haptic?: IOSHaptic;
  opacityTo?: number;
  pressedStyle?: StyleProp<ViewStyle>;
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
}

export function IOSPressable({
  children,
  disabled,
  haptic = 'none',
  onPress,
  onPressIn,
  onPressOut,
  opacityTo = 0.9,
  pressedStyle,
  scaleTo = 0.975,
  style,
  ...props
}: IOSPressableProps) {
  const [pressed, setPressed] = useState(false);
  const progress = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value * (1 - opacityTo),
    transform: [{ scale: 1 - progress.value * (1 - scaleTo) }],
  }));
  const spring = {
    damping: IOS_MOTION.spring.damping,
    mass: 0.72,
    stiffness: IOS_MOTION.spring.stiffness + 80,
  } as const;

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={(event) => {
        setPressed(true);
        progress.value = withSpring(1, spring);
        onPressIn?.(event);
      }}
      onPress={(event) => {
        if (!disabled) void playHaptic(haptic);
        onPress?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        progress.value = withSpring(0, spring);
        onPressOut?.(event);
      }}
      style={[style, pressed && pressedStyle, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}

export async function playHaptic(haptic: IOSHaptic): Promise<void> {
  if (Platform.OS !== 'ios' || haptic === 'none') return;
  try {
    if (haptic === 'selection') {
      await Haptics.selectionAsync();
      return;
    }
    await Haptics.impactAsync(
      haptic === 'medium'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
    );
  } catch {
    // Haptics may be unavailable in a simulator or while the camera is active.
  }
}
