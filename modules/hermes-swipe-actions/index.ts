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

export interface HermesNativeSwipeAction {
  destructive?: boolean;
  id: string;
  systemImage?: string;
  tintColor?: string;
  title: string;
}

interface HermesSwipeActionsViewProps extends ViewProps {
  actions: readonly HermesNativeSwipeAction[];
  children?: ReactNode;
  fullSwipeEnabled?: boolean;
  onAction?(event: NativeSyntheticEvent<{ id: string }>): void;
}

export const hasNativeSwipeActions =
  requireOptionalNativeModule('HermesSwipeActions') !== null;
const NativeHermesSwipeActionsView = hasNativeSwipeActions
  ? requireNativeView<HermesSwipeActionsViewProps>('HermesSwipeActions')
  : null;

export function HermesSwipeActionsView({
  children,
  ...props
}: HermesSwipeActionsViewProps) {
  if (NativeHermesSwipeActionsView) {
    return createElement(
      NativeHermesSwipeActionsView as ComponentType<HermesSwipeActionsViewProps>,
      props,
      children,
    );
  }
  return createElement(View, props, children);
}
