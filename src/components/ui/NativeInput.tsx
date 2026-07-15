import { forwardRef, useEffect, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  type TextInputProps,
} from 'react-native';
import Reanimated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  CONTROL_METRICS,
  resolveControlColors,
  resolveInputMetrics,
} from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { IOS_MOTION } from '../../design/ios-motion';
import { useNativeLocalization } from '../../i18n/NativeLocalization';

const AnimatedTextInput = Reanimated.createAnimatedComponent(TextInput);
const TRANSITION_EASING = Easing.bezier(
  ...IOS_MOTION.curve.standard,
);

export interface NativeInputProps extends TextInputProps {
  disabled?: boolean;
}

export const NativeInput = forwardRef<TextInput, NativeInputProps>(
  function NativeInput(
    {
      disabled = false,
      editable = true,
      multiline = false,
      onBlur,
      onFocus,
      placeholderTextColor,
      style,
      ...props
    },
    ref,
  ) {
    const { tokens } = useTheme();
    const { t } = useNativeLocalization();
    const colors = resolveControlColors(tokens).input;
    const metrics = resolveInputMetrics(tokens);
    const [focused, setFocused] = useState(false);
    const focusProgress = useSharedValue(0);
    const enabled = editable && !disabled;

    useEffect(() => {
      if (!enabled) {
        setFocused(false);
        focusProgress.value = withTiming(0, {
          duration: IOS_MOTION.duration.control,
          easing: TRANSITION_EASING,
        });
      }
    }, [enabled, focusProgress]);

    const focusStyle = useAnimatedStyle(() => ({
      borderColor: interpolateColor(
        focusProgress.value,
        [0, 1],
        [colors.border, colors.focusBorder],
      ),
      outlineColor: interpolateColor(
        focusProgress.value,
        [0, 1],
        ['rgba(0, 0, 0, 0)', colors.focusRing],
      ),
    }));

    const handleFocus: NonNullable<TextInputProps['onFocus']> = (event) => {
      setFocused(true);
      focusProgress.value = withTiming(1, {
        duration: IOS_MOTION.duration.control,
        easing: TRANSITION_EASING,
      });
      onFocus?.(event);
    };
    const handleBlur: NonNullable<TextInputProps['onBlur']> = (event) => {
      setFocused(false);
      focusProgress.value = withTiming(0, {
        duration: IOS_MOTION.duration.control,
        easing: TRANSITION_EASING,
      });
      onBlur?.(event);
    };

    return (
      <AnimatedTextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel
          ? t(props.accessibilityLabel)
          : undefined}
        accessibilityState={{
          ...props.accessibilityState,
          disabled: !enabled,
        }}
        cursorColor={tokens.colors.foreground}
        editable={enabled}
        multiline={multiline}
        onBlur={handleBlur}
        onFocus={handleFocus}
        placeholder={typeof props.placeholder === 'string'
          ? t(props.placeholder)
          : props.placeholder}
        placeholderTextColor={placeholderTextColor ?? colors.placeholder}
        ref={ref}
        selectionColor={tokens.colors.foreground}
        style={[
          styles.input,
          {
            backgroundColor: colors.background,
            borderWidth: CONTROL_METRICS.input.borderWidth,
            color: tokens.colors.foreground,
            fontFamily: 'Courier New',
            fontSize: metrics.fontSize,
            height: multiline ? undefined : metrics.visibleHeight,
            lineHeight: metrics.lineHeight,
            minHeight: metrics.visibleHeight,
            opacity: enabled ? 1 : CONTROL_METRICS.input.disabledOpacity,
            outlineWidth: focused ? CONTROL_METRICS.input.focusRingWidth : 0,
            paddingHorizontal: metrics.paddingHorizontal,
            paddingVertical: metrics.paddingVertical,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          focusStyle,
          style,
        ]}
      />
    );
  },
);

const styles = StyleSheet.create({
  input: {
    borderRadius: 0,
  },
});
