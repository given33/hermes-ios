import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { CONTROL_METRICS, resolveControlColors } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';

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
      style,
      textStyle,
      ...props
    },
    ref,
  ) {
    const { tokens } = useTheme();
    const colors = resolveControlColors(tokens).listItem;
    const [focused, setFocused] = useState(false);
    const [hovered, setHovered] = useState(false);
    const isDisabled = disabled === true;

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
        hitSlop={hitSlop ?? styles.hitSlop}
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
        ref={ref}
        style={(state) => [
          styles.item,
          {
            backgroundColor: active
              ? colors.activeBackground
              : (hovered || state.pressed) && !isDisabled
                ? colors.pressedBackground
                : 'transparent',
            outlineColor: focused ? colors.focusRing : 'transparent',
            outlineWidth: focused ? CONTROL_METRICS.listItem.focusRingWidth : 0,
          },
          typeof style === 'function' ? style(state) : style,
        ]}
      >
        {({ pressed }) => {
          const color = isDisabled
            ? colors.disabledText
            : active || hovered || pressed
              ? colors.activeText
              : colors.inactiveText;
          return Children.map(
            children,
            (child) => renderListItemChild(child, color, textStyle),
          );
        }}
      </Pressable>
    );
  },
);

function renderListItemChild(
  child: ReactNode,
  color: string,
  textStyle: StyleProp<TextStyle>,
) {
  if (typeof child === 'string' || typeof child === 'number') {
    return (
      <Text style={[styles.text, { color }, textStyle]}>
        {child}
      </Text>
    );
  }
  if (!isValidElement(child)) return child;
  if (child.type === Text) {
    const text = child as ReactElement<{ style?: StyleProp<TextStyle> }>;
    return cloneElement(text, {
      style: [styles.text, { color }, text.props.style, textStyle],
    });
  }
  return cloneElement(child as ReactElement<{ color?: string }>, { color });
}

const styles = StyleSheet.create({
  item: {
    alignItems: 'center',
    borderRadius: 0,
    flexDirection: 'row',
    gap: CONTROL_METRICS.listItem.gap,
    paddingHorizontal: CONTROL_METRICS.listItem.paddingHorizontal,
    paddingVertical: CONTROL_METRICS.listItem.paddingVertical,
  },
  text: {
    fontFamily: 'Courier New',
    fontSize: CONTROL_METRICS.listItem.fontSize,
  },
  hitSlop: {
    top: 6,
    right: 0,
    bottom: 6,
    left: 0,
  },
});
