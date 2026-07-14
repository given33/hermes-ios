import { forwardRef, useEffect, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  type TextInputProps,
} from 'react-native';

import { CONTROL_METRICS, resolveControlColors } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';

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
    const colors = resolveControlColors(tokens).input;
    const [focused, setFocused] = useState(false);
    const enabled = editable && !disabled;

    useEffect(() => {
      if (!enabled) setFocused(false);
    }, [enabled]);

    const handleFocus: NonNullable<TextInputProps['onFocus']> = (event) => {
      setFocused(true);
      onFocus?.(event);
    };
    const handleBlur: NonNullable<TextInputProps['onBlur']> = (event) => {
      setFocused(false);
      onBlur?.(event);
    };

    return (
      <TextInput
        {...props}
        accessibilityState={{
          ...props.accessibilityState,
          disabled: !enabled,
        }}
        cursorColor={tokens.colors.foreground}
        editable={enabled}
        multiline={multiline}
        onBlur={handleBlur}
        onFocus={handleFocus}
        placeholderTextColor={placeholderTextColor ?? colors.placeholder}
        ref={ref}
        selectionColor={tokens.colors.foreground}
        style={[
          styles.input,
          {
            backgroundColor: colors.background,
            borderColor: focused ? colors.focusBorder : colors.border,
            color: tokens.colors.foreground,
            height: multiline ? undefined : CONTROL_METRICS.input.visibleHeight,
            minHeight: CONTROL_METRICS.input.visibleHeight,
            opacity: enabled ? 1 : CONTROL_METRICS.input.disabledOpacity,
            outlineColor: focused ? colors.focusRing : 'transparent',
            outlineWidth: focused ? CONTROL_METRICS.input.focusRingWidth : 0,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          style,
        ]}
      />
    );
  },
);

const styles = StyleSheet.create({
  input: {
    borderRadius: 0,
    borderWidth: CONTROL_METRICS.input.borderWidth,
    fontFamily: 'Courier New',
    fontSize: CONTROL_METRICS.input.fontSize,
    paddingHorizontal: CONTROL_METRICS.input.paddingHorizontal,
    paddingVertical: CONTROL_METRICS.input.paddingVertical,
  },
});
