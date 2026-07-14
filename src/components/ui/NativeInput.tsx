import { forwardRef, useEffect, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputFocusEventData,
  type TextInputProps,
  type TextInputSubmitEditingEventData,
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
import { resolveNativeFontStack } from '../../design/native-font-faces';
import {
  hasNativeTextInput,
  HermesTextInputView,
} from '../../../modules/hermes-ios-controls';

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
    const translatedPlaceholder = typeof props.placeholder === 'string'
      ? t(props.placeholder)
      : '';

    if (Platform.OS === 'ios' && hasNativeTextInput && ref === null) {
      return (
        <HermesTextInputView
          accessibilityLabel={props.accessibilityLabel
            ? t(props.accessibilityLabel)
            : undefined}
          accessibilityState={{
            ...props.accessibilityState,
            disabled: !enabled,
          }}
          autoCapitalize={props.autoCapitalize ?? 'sentences'}
          autoCorrect={props.autoCorrect ?? true}
          backgroundColorValue={colors.background}
          borderColor={colors.border}
          borderWidth={CONTROL_METRICS.input.borderWidth}
          controlled={props.value !== undefined}
          editable={enabled}
          focusBorderColor={colors.focusBorder}
          focusRequest={0}
          focusRingColor={colors.focusRing}
          focusRingWidth={CONTROL_METRICS.input.focusRingWidth}
          fontName={resolveNativeFontStack(tokens.typography.fontMono, 400)}
          fontSize={metrics.fontSize}
          multiline={multiline}
          onChangeText={(event) => props.onChangeText?.(event.nativeEvent.value)}
          onNativeBlur={(event) => {
            setFocused(false);
            onBlur?.(event as unknown as NativeSyntheticEvent<TextInputFocusEventData>);
          }}
          onNativeFocus={(event) => {
            setFocused(true);
            onFocus?.(event as unknown as NativeSyntheticEvent<TextInputFocusEventData>);
          }}
          onNativeSubmit={(event) => {
            props.onSubmitEditing?.(
              event as unknown as NativeSyntheticEvent<TextInputSubmitEditingEventData>,
            );
          }}
          paddingHorizontal={metrics.paddingHorizontal}
          paddingVertical={metrics.paddingVertical}
          placeholder={translatedPlaceholder}
          placeholderColor={typeof placeholderTextColor === 'string'
            ? placeholderTextColor
            : colors.placeholder}
          returnKeyType={props.returnKeyType ?? 'default'}
          secure={props.secureTextEntry === true}
          style={[
            styles.input,
            {
              height: multiline ? undefined : metrics.visibleHeight,
              minHeight: metrics.visibleHeight,
              opacity: enabled ? 1 : CONTROL_METRICS.input.disabledOpacity,
            },
            style,
          ]}
          textColor={tokens.colors.foreground}
          tintColor={tokens.colors.foreground}
          value={props.value ?? props.defaultValue ?? ''}
        />
      );
    }

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
        placeholder={translatedPlaceholder || props.placeholder}
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
