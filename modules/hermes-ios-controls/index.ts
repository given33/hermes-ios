import {
  requireNativeView,
  requireOptionalNativeModule,
} from 'expo';
import {
  createElement,
  forwardRef,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  View,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';

type NativeViewProps = ViewProps & { children?: ReactNode };

function optionalView<P extends NativeViewProps>(name: string) {
  const available = requireOptionalNativeModule(name) !== null;
  const NativeView = available ? requireNativeView<P>(name) : null;
  const Component = forwardRef<View, P>(function OptionalNativeView(
    { children, ...props },
    ref,
  ) {
    const nativeProps = { ...props, ref } as unknown as P;
    return NativeView
      ? createElement(NativeView as ComponentType<P>, nativeProps, children)
      : createElement(View, nativeProps, children);
  });
  return { available, Component };
}

export interface HermesSegmentedControlProps extends NativeViewProps {
  backgroundColorValue: string;
  fontName?: string;
  fontSize: number;
  onValueChange?(event: NativeSyntheticEvent<{ index: number }>): void;
  selectedIndex: number;
  selectedTextColor: string;
  textColor: string;
  tintColor: string;
  values: readonly string[];
}

export interface HermesSwitchProps extends NativeViewProps {
  disabled?: boolean;
  offTintColor: string;
  onTintColor: string;
  onValueChange?(event: NativeSyntheticEvent<{ value: boolean }>): void;
  thumbTintColor?: string;
  value: boolean;
}

export interface HermesSearchBarProps extends NativeViewProps {
  backgroundColorValue: string;
  fontName?: string;
  fontSize: number;
  onChangeText?(event: NativeSyntheticEvent<{ value: string }>): void;
  onSubmit?(event: NativeSyntheticEvent<{ value: string }>): void;
  placeholder: string;
  placeholderColor: string;
  textColor: string;
  tintColor: string;
  value: string;
}

export interface HermesProgressProps extends NativeViewProps {
  progress: number;
  progressTintColor: string;
  trackHeight: number;
  trackTintColor: string;
}

export interface HermesSelectionProps extends NativeViewProps {
  borderWidth: number;
  checkmarkBackgroundColor: string;
  checkmarkTintColor: string;
  cornerRadius: number;
  selected: boolean;
  selectedBackgroundColor: string;
  selectedBorderColor: string;
  unselectedBackgroundColor: string;
  unselectedBorderColor: string;
}

export interface HermesPressFeedbackProps extends NativeViewProps {
  disabled?: boolean;
  haptic: 'light' | 'medium' | 'none' | 'selection';
  onNativePress?(event: NativeSyntheticEvent<Record<string, never>>): void;
  onPressState?(event: NativeSyntheticEvent<{ pressed: boolean }>): void;
  opacityTo: number;
  scaleTo: number;
}

export interface HermesInputFocusProps extends NativeViewProps {
  backgroundColorValue: string;
  borderColor: string;
  borderWidth: number;
  focusBorderColor: string;
  focused: boolean;
  focusRingColor: string;
  focusRingWidth: number;
}

export interface HermesAlertPresenterProps extends NativeViewProps {
  open: boolean;
  overlayColor: string;
}

export interface HermesDrawerSurfaceProps extends NativeViewProps {
  onRequestClose?(event: NativeSyntheticEvent<Record<string, never>>): void;
  open: boolean;
  overlayColor: string;
  width: number;
}

const segmented = optionalView<HermesSegmentedControlProps>('HermesSegmentedControl');
const nativeSwitch = optionalView<HermesSwitchProps>('HermesSwitch');
const search = optionalView<HermesSearchBarProps>('HermesSearchBar');
const progress = optionalView<HermesProgressProps>('HermesProgress');
const selection = optionalView<HermesSelectionProps>('HermesSelection');
const pressFeedback = optionalView<HermesPressFeedbackProps>('HermesPressFeedback');
const inputFocus = optionalView<HermesInputFocusProps>('HermesInputFocus');
const alertPresenter = optionalView<HermesAlertPresenterProps>('HermesAlertPresenter');
const drawerSurface = optionalView<HermesDrawerSurfaceProps>('HermesDrawerSurface');

export const hasNativeSegmentedControl = segmented.available;
export const HermesSegmentedControlView = segmented.Component;
export const hasNativeSwitch = nativeSwitch.available;
export const HermesSwitchView = nativeSwitch.Component;
export const hasNativeSearchBar = search.available;
export const HermesSearchBarView = search.Component;
export const hasNativeProgress = progress.available;
export const HermesProgressView = progress.Component;
export const hasNativeSelection = selection.available;
export const HermesSelectionView = selection.Component;
export const hasNativePressFeedback = pressFeedback.available;
export const HermesPressFeedbackView = pressFeedback.Component;
export const hasNativeInputFocus = inputFocus.available;
export const HermesInputFocusView = inputFocus.Component;
export const hasNativeAlertPresenter = alertPresenter.available;
export const HermesAlertPresenterView = alertPresenter.Component;
export const hasNativeDrawerSurface = drawerSurface.available;
export const HermesDrawerSurfaceView = drawerSurface.Component;
