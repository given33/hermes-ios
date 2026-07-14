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
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  CONTROL_METRICS,
  resolveControlColors,
  resolveListItemMetrics,
} from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { AnimatedTintedIcon } from './AnimatedTintedIcon';

const TRANSITION_EASING = Easing.bezier(
  ...CONTROL_METRICS.tailwind.transitionEasing,
);

export interface NativeListItemProps
  extends Omit<PressableProps, 'children'> {
  active?: boolean;
  children: ReactNode;
  textStyle?: StyleProp<TextStyle>;
}

export const NativeListItem = forwardRef<View, NativeListItemProps>(
  function NativeListItem(
    {
      active = false,
      children,
      disabled = false,
      hitSlop,
      onBlur,
      onFocus,
      onHoverIn,
      onHoverOut,
      onPressIn,
      onPressOut,
      style,
      textStyle,
      ...props
    },
    ref,
  ) {
    const { tokens } = useTheme();
    const colors = resolveControlColors(tokens).listItem;
    const metrics = resolveListItemMetrics(tokens);
    const [focused, setFocused] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [pressed, setPressed] = useState(false);
    const isDisabled = disabled === true;
    const resolvedTextColor = isDisabled
      ? colors.disabledText
      : active || hovered || pressed
        ? colors.activeText
        : colors.inactiveText;
    const animatedBackground = useSharedValue(
      active ? colors.activeBackground : 'rgba(0, 0, 0, 0)',
    );
    const animatedText = useSharedValue(resolvedTextColor);
    const animatedOutline = useSharedValue('rgba(0, 0, 0, 0)');

    useEffect(() => {
      const timing = {
        duration: CONTROL_METRICS.tailwind.transitionDurationMs,
        easing: TRANSITION_EASING,
      };
      animatedBackground.value = withTiming(
        active
          ? colors.activeBackground
          : hovered || pressed
            ? colors.pressedBackground
            : 'rgba(0, 0, 0, 0)',
        timing,
      );
      animatedText.value = withTiming(
        isDisabled
          ? colors.disabledText
          : active || hovered || pressed
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
    ]);

    const animatedItemStyle = useAnimatedStyle(() => ({
      backgroundColor: animatedBackground.value,
      outlineColor: animatedOutline.value,
    }));
    const animatedTextStyle = useAnimatedStyle(() => ({
      color: animatedText.value,
    }));
    const visibleHeight = metrics.lineHeight + metrics.paddingVertical * 2;
    const defaultHitSlop = Math.max(
      0,
      (CONTROL_METRICS.minimumHitTarget - visibleHeight) / 2,
    );

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
        hitSlop={hitSlop ?? {
          top: defaultHitSlop,
          right: 0,
          bottom: defaultHitSlop,
          left: 0,
        }}
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
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          setPressed(false);
          onPressOut?.(event);
        }}
        ref={ref}
        style={(state) => [
          styles.item,
          {
            gap: metrics.gap,
            paddingHorizontal: metrics.paddingHorizontal,
            paddingVertical: metrics.paddingVertical,
          },
          typeof style === 'function' ? style(state) : style,
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
          ),
        )}
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
        {child}
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
      />
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
    alignItems: 'center',
    borderRadius: 0,
    flexDirection: 'row',
  },
  text: {
    fontFamily: 'Courier New',
  },
});
