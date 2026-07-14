import {
  requireNativeViewManager,
  requireOptionalNativeModule,
} from 'expo-modules-core';
import { createElement, type ComponentType } from 'react';
import { View, type ViewProps } from 'react-native';

export interface HermesLiveBlurViewProps extends ViewProps {
  blurRadius: number;
}

const hasExactNativeBlur =
  requireOptionalNativeModule('HermesLiveBlur') !== null;
const NativeHermesLiveBlurView = hasExactNativeBlur
  ? requireNativeViewManager<HermesLiveBlurViewProps>('HermesLiveBlur')
  : null;

export function HermesLiveBlurView(props: HermesLiveBlurViewProps) {
  if (NativeHermesLiveBlurView) {
    return createElement(
      NativeHermesLiveBlurView as ComponentType<HermesLiveBlurViewProps>,
      props,
    );
  }

  const { blurRadius: _blurRadius, ...viewProps } = props;
  return createElement(View, viewProps);
}
