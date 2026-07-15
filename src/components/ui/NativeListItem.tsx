import {
  Children,
  cloneElement,
  forwardRef,
  Fragment,
  isValidElement,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { LucideProps } from 'lucide-react-native';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  CONTROL_METRICS,
  resolveControlColors,
  resolveListItemMetrics,
} from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { IOS_MOTION } from '../../design/ios-motion';
import { useNativeLocalization } from '../../i18n/NativeLocalization';
import {
  hasNativePressFeedback,
  HermesPressFeedbackView,
} from '../../../modules/hermes-ios-controls';
import { playHaptic, type IOSHaptic } from '../ios/IOSPressable';
import { AnimatedTintedIcon } from './AnimatedTintedIcon';

const TRANSITION_EASING = Easing.bezier(
  ...IOS_MOTION.curve.standard,
);

export interface NativeListItemProps
  extends Omit<PressableProps, 'children'> {
  active?: boolean;
  activeBackgroundColor?: string;
  activeTextColor?: string;
  children: ReactNode;
  haptic?: IOSHaptic;
  textStyle?: StyleProp<TextStyle>;
}

export const NativeListItem = forwardRef<View, NativeListItemProps>(
  function NativeListItem(
    {
      active = false,
      activeBackgroundColor,
      activeTextColor,
      children,
      disabled = false,
      haptic = 'none',
      hitSlop,
      onBlur,
      onFocus,
      onHoverIn,
      onHoverOut,
      onPress,
      onPressIn,
      onPressOut,
      style,
      textStyle,
      ...props
    },
    ref,
  ) {
    const { tokens } = useTheme();
    const { t } = useNativeLocalization();
    const colors = resolveControlColors(tokens).listItem;
    const metrics = resolveListItemMetrics(tokens);
    const [focused, setFocused] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [pressed, setPressed] = useState(false);
    const isDisabled = disabled === true;
    const resolvedActiveBackground = activeBackgroundColor ?? colors.activeBackground;
    const resolvedActiveText = activeTextColor ?? colors.activeText;
    const resolvedTextColor = isDisabled
      ? colors.disabledText
      : active
        ? resolvedActiveText
        : hovered || pressed
          ? colors.activeText
        : colors.inactiveText;
    const animatedBackground = useSharedValue(
      active ? resolvedActiveBackground : 'rgba(0, 0, 0, 0)',
    );
    const animatedText = useSharedValue(resolvedTextColor);
    const animatedOutline = useSharedValue('rgba(0, 0, 0, 0)');
    const pressProgress = useSharedValue(0);

    useEffect(() => {
      const timing = {
        duration: IOS_MOTION.duration.control,
        easing: TRANSITION_EASING,
      };
      animatedBackground.value = withTiming(
        active
          ? resolvedActiveBackground
          : hovered || pressed
            ? colors.pressedBackground
            : 'rgba(0, 0, 0, 0)',
        timing,
      );
      animatedText.value = withTiming(
        isDisabled
          ? colors.disabledText
          : active
            ? resolvedActiveText
            : hovered || pressed
              ? colors.activeText
            : colors.inactiveText,
        timing,
      );
      animatedOutline.value = withTiming(
        focused ? colors.focusRing : 'rgba(0, 0, 0, 0)',
        timing,
      );
    }, [
      active,
      animatedBackground,
      animatedOutline,
      animatedText,
      colors,
      focused,
      hovered,
      isDisabled,
      pressed,
      resolvedActiveBackground,
      resolvedActiveText,
    ]);

    const animatedItemStyle = useAnimatedStyle(() => ({
      backgroundColor: animatedBackground.value,
      outlineColor: animatedOutline.value,
    }));
    const animatedTextStyle = useAnimatedStyle(() => ({
      color: animatedText.value,
    }));
    const pressStyle = useAnimatedStyle(() => ({
      opacity: 1 - pressProgress.value * 0.08,
      transform: [{ scale: 1 - pressProgress.value * 0.018 }],
    }));
    const visibleHeight = metrics.lineHeight + metrics.paddingVertical * 2;
    const defaultHitSlop = Math.max(
      0,
      (CONTROL_METRICS.minimumHitTarget - visibleHeight) / 2,
    );
    const itemContent = (
      <Reanimated.View
        style={[
          {
            gap: metrics.gap,
            paddingHorizontal: metrics.paddingHorizontal,
            paddingVertical: metrics.paddingVertical,
          },
          styles.itemContent,
          pressStyle,
        ]}
      >
        <Reanimated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              outlineWidth: focused
                ? CONTROL_METRICS.listItem.focusRingWidth
                : 0,
            },
            animatedItemStyle,
          ]}
        />
        {Children.map(
          children,
          (child) => renderListItemChild(
            child,
            animatedTextStyle,
            animatedText,
            metrics.fontSize,
            metrics.lineHeight,
            textStyle,
            t,
          ),
        )}
      </Reanimated.View>
    );
    const resolvedHitSlop = hitSlop ?? {
      top: defaultHitSlop,
      right: 0,
      bottom: defaultHitSlop,
      left: 0,
    };

    if (Platform.OS === 'ios' && hasNativePressFeedback) {
      return (
        <HermesPressFeedbackView
          {...props}
          accessibilityRole={props.accessibilityRole ?? 'button'}
          accessibilityState={{
            ...props.accessibilityState,
            disabled: isDisabled,
            selected: active,
          }}
          disabled={isDisabled}
          haptic={haptic}
          hitSlop={resolvedHitSlop}
          onNativePress={(event) => {
            onPress?.(event as unknown as GestureResponderEvent);
          }}
          onPressState={(event) => {
            const nextPressed = event.nativeEvent.pressed;
            setPressed(nextPressed);
            if (nextPressed) {
              onPressIn?.(event as unknown as GestureResponderEvent);
            } else {
              onPressOut?.(event as unknown as GestureResponderEvent);
            }
          }}
          opacityTo={0.92}
          ref={ref}
          scaleTo={0.982}
          style={[
            styles.item,
            typeof style === 'function' ? style({ pressed }) : style,
          ]}
        >
          {itemContent}
        </HermesPressFeedbackView>
      );
    }

    return (
      <Pressable
        {...props}
        accessibilityRole={props.accessibilityRole ?? 'button'}
        accessibilityState={{
          ...props.accessibilityState,
          disabled: isDisabled,
          selected: active,
        }}
        disabled={isDisabled}
        hitSlop={resolvedHitSlop}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onHoverIn={(event) => {
          setHovered(true);
          onHoverIn?.(event);
        }}
        onHoverOut={(event) => {
          setHovered(false);
          onHoverOut?.(event);
        }}
        onPressIn={(event) => {
          setPressed(true);
          pressProgress.value = withSpring(1, {
            damping: IOS_MOTION.spring.damping,
            mass: 0.72,
            stiffness: IOS_MOTION.spring.stiffness + 80,
          });
          onPressIn?.(event);
        }}
        onPress={(event) => {
          void playHaptic(haptic);
          onPress?.(event);
        }}
        onPressOut={(event) => {
          setPressed(false);
          pressProgress.value = withSpring(0, {
            damping: IOS_MOTION.spring.damping,
            mass: 0.72,
            stiffness: IOS_MOTION.spring.stiffness + 80,
          });
          onPressOut?.(event);
        }}
        ref={ref}
        style={(state) => [
          styles.item,
          typeof style === 'function' ? style(state) : style,
        ]}
      >
        {itemContent}
      </Pressable>
    );
  },
);

function renderListItemChild(
  child: ReactNode,
  animatedColor: StyleProp<TextStyle>,
  animatedColorValue: SharedValue<string>,
  fontSize: number,
  lineHeight: number,
  textStyle: StyleProp<TextStyle>,
  translate: (value: string) => string,
): ReactNode {
  if (typeof child === 'string' || typeof child === 'number') {
    return (
      <Reanimated.Text
        style={[
          styles.text,
          { fontSize, lineHeight },
          animatedColor,
          textStyle,
        ]}
      >
        {typeof child === 'string' ? translate(child) : child}
      </Reanimated.Text>
    );
  }
  if (!isValidElement(child)) return child;
  if (child.type === Fragment) {
    const fragment = child as ReactElement<{ children?: ReactNode }>;
    return (
      <Fragment>
        {Children.map(fragment.props.children, (nested) => renderListItemChild(
          nested,
          animatedColor,
          animatedColorValue,
          fontSize,
          lineHeight,
          textStyle,
          translate,
        ))}
      </Fragment>
    );
  }
  if (child.type === Text) {
    const text = child as ReactElement<{
      children?: ReactNode;
      style?: StyleProp<TextStyle>;
    }>;
    return (
      <Reanimated.Text
        {...text.props}
        style={[
          styles.text,
          { fontSize, lineHeight },
          animatedColor,
          text.props.style,
          textStyle,
        ]}
      >
        {Children.map(text.props.children, (nested) => (
          typeof nested === 'string' ? translate(nested) : nested
        ))}
      </Reanimated.Text>
    );
  }
  if (child.type === View) {
    const view = child as ReactElement<{ children?: ReactNode }>;
    return cloneElement(view, {
      children: Children.map(view.props.children, (nested) => renderListItemChild(
        nested,
        animatedColor,
        animatedColorValue,
        fontSize,
        lineHeight,
        textStyle,
        translate,
      )),
    });
  }
  return (
    <AnimatedTintedIcon
      color={animatedColorValue}
      icon={child as ReactElement<TintableIconProps>}
    />
  );
}

type TintableIconProps = LucideProps;

const styles = StyleSheet.create({
  item: {
    overflow: 'visible',
  },
  itemContent: {
    alignItems: 'center',
    borderRadius: 0,
    flexDirection: 'row',
    flex: 1,
    position: 'relative',
  },
  text: {
    fontFamily: 'Courier New',
  },
});
