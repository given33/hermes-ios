import {
  Button as SwiftUIButton,
  ContextMenu as SwiftUIContextMenu,
  Host as SwiftUIHost,
} from '@expo/ui/swift-ui';
import { type ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

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
  const content = (
    <IOSPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={onPress ? 'button' : undefined}
      haptic={haptic}
      onPress={onPress}
      style={Platform.OS === 'ios' ? styles.nativeContent : style}
    >
      {children}
    </IOSPressable>
  );

  if (Platform.OS !== 'ios' || !actions.length) return content;
  return (
    <SwiftUIHost style={style}>
      <SwiftUIContextMenu activationMethod="longPress">
        <SwiftUIContextMenu.Items>
          {actions.map((action) => (
            <SwiftUIButton
              key={action.id}
              onPress={action.onPress}
              role={action.destructive ? 'destructive' : 'default'}
              systemImage={action.systemImage as never}
            >
              {action.title}
            </SwiftUIButton>
          ))}
        </SwiftUIContextMenu.Items>
        <SwiftUIContextMenu.Trigger>
          {content}
        </SwiftUIContextMenu.Trigger>
      </SwiftUIContextMenu>
    </SwiftUIHost>
  );
}

const styles = StyleSheet.create({
  nativeContent: {
    flex: 1,
  },
});
