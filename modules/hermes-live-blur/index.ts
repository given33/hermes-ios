import { requireNativeViewManager } from 'expo-modules-core';
import { createElement } from 'react';
import type { ViewProps } from 'react-native';

export interface HermesLiveBlurViewProps extends ViewProps {
  blurRadius: number;
}

const NativeHermesLiveBlurView =
  requireNativeViewManager<HermesLiveBlurViewProps>('HermesLiveBlur');

export function HermesLiveBlurView(props: HermesLiveBlurViewProps) {
  return createElement(NativeHermesLiveBlurView, props);
}
