import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { CONTROL_METRICS } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { NativeButton } from './NativeButton';

export type ScreenStateKind = 'loading' | 'empty' | 'error';

export interface ScreenStateProps {
  kind: ScreenStateKind;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  testID?: string;
}

export function ScreenState({
  kind,
  message,
  onRetry,
  retryLabel = 'Retry',
  testID,
}: ScreenStateProps) {
  const { tokens } = useTheme();
  const color = kind === 'error'
    ? tokens.colors.destructive
    : tokens.colors.textSecondary;

  return (
    <View
      accessibilityLiveRegion={kind === 'loading' ? 'polite' : 'none'}
      accessibilityRole={kind === 'loading' ? 'progressbar' : undefined}
      style={styles.container}
      testID={testID}
    >
      {kind === 'loading' ? (
        <ActivityIndicator color={color} size={CONTROL_METRICS.screenState.spinnerSize} />
      ) : null}
      <Text style={[styles.message, { color }]}>{message}</Text>
      {kind === 'error' && onRetry ? (
        <NativeButton onPress={onRetry} outlined size="sm">
          {retryLabel}
        </NativeButton>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: CONTROL_METRICS.screenState.gap,
    justifyContent: 'center',
    paddingVertical: CONTROL_METRICS.screenState.paddingVertical,
    width: '100%',
  },
  message: {
    fontFamily: 'Courier New',
    fontSize: CONTROL_METRICS.screenState.textSize,
    textAlign: 'center',
  },
});
