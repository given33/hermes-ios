import { BlurView } from 'expo-blur';
import {
  requireNativeView,
  requireOptionalNativeModule,
} from 'expo';
import { createElement, type ComponentType } from 'react';
import {
  StyleSheet,
  View,
  type ColorValue,
  type ViewProps,
} from 'react-native';

export interface HermesLiveBlurViewProps extends ViewProps {
  blurRadius: number;
}

const hasExactNativeBlur =
  requireOptionalNativeModule('HermesLiveBlur') !== null;
const NativeHermesLiveBlurView = hasExactNativeBlur
  ? requireNativeView<HermesLiveBlurViewProps>('HermesLiveBlur')
  : null;

export interface HermesLiquidGlassViewProps extends ViewProps {
  blurRadius?: number;
  glassCornerRadius?: number;
  interactive?: boolean;
  tintColor?: ColorValue;
}

const hasNativeLiquidGlass =
  requireOptionalNativeModule('HermesLiquidGlass') !== null;
const NativeHermesLiquidGlassView = hasNativeLiquidGlass
  ? requireNativeView<HermesLiquidGlassViewProps>('HermesLiquidGlass')
  : null;

export function HermesLiveBlurView(props: HermesLiveBlurViewProps) {
  if (NativeHermesLiveBlurView) {
    return createElement(
      NativeHermesLiveBlurView as ComponentType<HermesLiveBlurViewProps>,
      props,
    );
  }

  const { blurRadius, ...viewProps } = props;
  return createElement(BlurView, {
    ...viewProps,
    intensity: Math.min(100, Math.max(0, blurRadius * 2.5)),
    tint: 'dark',
  });
}

export function HermesLiquidGlassView({
  blurRadius = 24,
  children,
  glassCornerRadius = 15,
  interactive = true,
  style,
  tintColor = 'rgba(255, 255, 255, 0.06)',
  ...viewProps
}: HermesLiquidGlassViewProps) {
  const nativeProps = {
    ...viewProps,
    blurRadius,
    glassCornerRadius,
    interactive,
    style,
    tintColor,
  };
  if (NativeHermesLiquidGlassView) {
    return createElement(
      NativeHermesLiquidGlassView as ComponentType<HermesLiquidGlassViewProps>,
      nativeProps,
      children,
    );
  }

  return createElement(
    View,
    {
      ...viewProps,
      style: [
        styles.glassFallback,
        { borderRadius: glassCornerRadius },
        style,
      ],
    },
    createElement(BlurView, {
      intensity: Math.min(100, Math.max(0, blurRadius * 2.5)),
      key: 'blur',
      style: StyleSheet.absoluteFill,
      tint: 'dark',
    }),
    createElement(View, {
      key: 'tint',
      pointerEvents: 'none',
      style: [StyleSheet.absoluteFill, { backgroundColor: tintColor }],
    }),
    createElement(View, {
      key: 'highlight',
      pointerEvents: 'none',
      style: styles.glassFallbackHighlight,
    }),
    createElement(View, {
      key: 'shadow-edge',
      pointerEvents: 'none',
      style: styles.glassFallbackShadowEdge,
    }),
    children,
  );
}

const styles = StyleSheet.create({
  glassFallback: {
    overflow: 'hidden',
  },
  glassFallbackHighlight: {
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
    height: StyleSheet.hairlineWidth,
    left: 7,
    position: 'absolute',
    right: 7,
    top: 0,
  },
  glassFallbackShadowEdge: {
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    left: 7,
    position: 'absolute',
    right: 7,
  },
});
