import {
  requireNativeView,
  requireOptionalNativeModule,
} from 'expo';
import { createElement, type ComponentType, type ReactNode } from 'react';
import {
  View,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';

export interface HermesContextMenuNativeAction {
  destructive?: boolean;
  id: string;
  systemImage?: string;
  title: string;
}

interface HermesContextMenuViewProps extends ViewProps {
  actions: readonly HermesContextMenuNativeAction[];
  children?: ReactNode;
  onMenuAction?(event: NativeSyntheticEvent<{ id: string }>): void;
}

export const hasNativeContextMenu =
  requireOptionalNativeModule('HermesContextMenu') !== null;
const NativeHermesContextMenuView = hasNativeContextMenu
  ? requireNativeView<HermesContextMenuViewProps>('HermesContextMenu')
  : null;

export function HermesContextMenuView({
  children,
  ...props
}: HermesContextMenuViewProps) {
  if (NativeHermesContextMenuView) {
    return createElement(
      NativeHermesContextMenuView as ComponentType<HermesContextMenuViewProps>,
      props,
      children,
    );
  }
  return createElement(View, props, children);
}
