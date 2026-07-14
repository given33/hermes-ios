import { type ReactNode } from 'react';
import {
  StyleSheet,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  hasNativeSwipeActions,
  HermesSwipeActionsView,
} from '../../../modules/hermes-swipe-actions';
import { IOSContextMenu } from './IOSContextMenu';

export interface IOSSwipeAction {
  destructive?: boolean;
  icon?: string;
  id: string;
  label: string;
  onPress(): void;
  tintColor?: ColorValue;
}

export function IOSSwipeActions({
  actions,
  children,
  containerStyle,
}: {
  actions: readonly IOSSwipeAction[];
  children: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  if (!actions.length) return <>{children}</>;
  const nativeActions = actions.map((action) => ({
    destructive: action.destructive,
    id: action.id,
    systemImage: action.icon,
    tintColor: typeof action.tintColor === 'string' ? action.tintColor : undefined,
    title: action.label,
  }));
  if (!hasNativeSwipeActions) {
    return (
      <IOSContextMenu
        actions={actions.map((action) => ({
          destructive: action.destructive,
          id: action.id,
          onPress: action.onPress,
          systemImage: action.icon,
          title: action.label,
        }))}
        haptic="none"
        style={containerStyle}
      >
        {children}
      </IOSContextMenu>
    );
  }
  return (
    <HermesSwipeActionsView
      actions={nativeActions}
      fullSwipeEnabled={false}
      onAction={(event) => {
        actions.find((action) => action.id === event.nativeEvent.id)?.onPress();
      }}
      style={[styles.container, containerStyle]}
    >
      {children}
    </HermesSwipeActionsView>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});
