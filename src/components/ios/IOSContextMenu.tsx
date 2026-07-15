import { type ReactNode, useCallback } from 'react';
import {
  ActionSheetIOS,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  HermesContextMenuView,
  hasNativeContextMenu,
} from '../../../modules/hermes-context-menu';
import { IOSPressable, type IOSHaptic } from './IOSPressable';

export interface IOSContextMenuAction {
  destructive?: boolean;
  id: string;
  onPress(): void;
  systemImage?: string;
  title: string;
}

export function IOSContextMenu({
  accessibilityLabel,
  actions,
  children,
  haptic = 'light',
  onPress,
  style,
}: {
  accessibilityLabel?: string;
  actions: readonly IOSContextMenuAction[];
  children: ReactNode;
  haptic?: IOSHaptic;
  onPress?(): void;
  style?: StyleProp<ViewStyle>;
}) {
  const run = useCallback((id: string) => {
    actions.find((action) => action.id === id)?.onPress();
  }, [actions]);
  const showFallback = useCallback(() => {
    if (Platform.OS !== 'ios' || !actions.length) return;
    const cancelButtonIndex = actions.length;
    const destructiveButtonIndex = actions.findIndex((action) => action.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex,
        destructiveButtonIndex: destructiveButtonIndex >= 0
          ? destructiveButtonIndex
          : undefined,
        options: [...actions.map((action) => action.title), '取消'],
      },
      (index) => {
        if (index < actions.length) actions[index]?.onPress();
      },
    );
  }, [actions]);
  const content = (
    <IOSPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={onPress ? 'button' : undefined}
      haptic={haptic}
      onLongPress={hasNativeContextMenu ? undefined : showFallback}
      onPress={onPress}
      style={hasNativeContextMenu ? styles.nativeContent : style}
    >
      {children}
    </IOSPressable>
  );

  if (!hasNativeContextMenu) return content;
  return (
    <HermesContextMenuView
      actions={actions.map(({ destructive, id, systemImage, title }) => ({
        destructive,
        id,
        systemImage,
        title,
      }))}
      onMenuAction={(event) => run(event.nativeEvent.id)}
      style={style}
    >
      {content}
    </HermesContextMenuView>
  );
}

const styles = StyleSheet.create({
  nativeContent: {
    flex: 1,
  },
});
