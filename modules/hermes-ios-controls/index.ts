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

export interface HermesAlertPresenterProps extends NativeViewProps {
  open: boolean;
  overlayColor: string;
}

export interface HermesTextInputProps extends NativeViewProps {
  autoCapitalize: string;
  autoCorrect: boolean;
  backgroundColorValue: string;
  borderColor: string;
  borderWidth: number;
  controlled: boolean;
  editable: boolean;
  focusBorderColor: string;
  focusRequest: number;
  focusRingColor: string;
  focusRingWidth: number;
  fontName?: string;
  fontSize: number;
  multiline: boolean;
  onChangeText?(event: NativeSyntheticEvent<{ value: string }>): void;
  onNativeBlur?(event: NativeSyntheticEvent<Record<string, never>>): void;
  onNativeFocus?(event: NativeSyntheticEvent<Record<string, never>>): void;
  onNativeSubmit?(event: NativeSyntheticEvent<{ value: string }>): void;
  paddingHorizontal: number;
  paddingVertical: number;
  placeholder: string;
  placeholderColor: string;
  returnKeyType: string;
  secure: boolean;
  textColor: string;
  tintColor: string;
  value: string;
}

export interface HermesDrawerSurfaceProps extends NativeViewProps {
  onRequestClose?(event: NativeSyntheticEvent<Record<string, never>>): void;
  open: boolean;
  width: number;
}

export interface HermesConfirmationDialogAction {
  destructive?: boolean;
  id: string;
  title: string;
}

export interface HermesConfirmationDialogProps extends NativeViewProps {
  actions: HermesConfirmationDialogAction[];
  cancelTitle: string;
  onAction?(event: NativeSyntheticEvent<{ id: string }>): void;
  onOpenChange?(event: NativeSyntheticEvent<{ open: boolean }>): void;
  open: boolean;
  title: string;
}

export interface HermesSwiftUIFrontendProps extends NativeViewProps {
  attachmentIds: string[];
  attachmentNames: string[];
  errorMessage: string;
  locale: 'en' | 'zh';
  onAction?(event: NativeSyntheticEvent<{ action: string; payload?: string }>): void;
}

export interface HermesSwiftUILoginProps extends NativeViewProps {
  baseUrl: string;
  busy: boolean;
  errorMessage: string;
  loading: boolean;
  locked: boolean;
  locale: 'en' | 'zh';
  onLogout?(event: NativeSyntheticEvent<Record<string, never>>): void;
  onProvision?(event: NativeSyntheticEvent<{ apiKey: string; baseUrl: string }>): void;
  onUnlock?(event: NativeSyntheticEvent<Record<string, never>>): void;
}

const search = optionalView<HermesSearchBarProps>('HermesSearchBar');
const selection = optionalView<HermesSelectionProps>('HermesSelection');
const pressFeedback = optionalView<HermesPressFeedbackProps>('HermesPressFeedback');
const alertPresenter = optionalView<HermesAlertPresenterProps>('HermesAlertPresenter');
const textInput = optionalView<HermesTextInputProps>('HermesTextInput');
const drawerSurface = optionalView<HermesDrawerSurfaceProps>('HermesDrawerSurface');
const confirmationDialog = optionalView<HermesConfirmationDialogProps>(
  'HermesConfirmationDialog',
);
const swiftUIFrontend = optionalView<HermesSwiftUIFrontendProps>(
  'HermesSwiftUIFrontend',
);
const swiftUILogin = optionalView<HermesSwiftUILoginProps>('HermesSwiftUILogin');

export const hasNativeSearchBar = search.available;
export const HermesSearchBarView = search.Component;
export const hasNativeSelection = selection.available;
export const HermesSelectionView = selection.Component;
export const hasNativePressFeedback = pressFeedback.available;
export const HermesPressFeedbackView = pressFeedback.Component;
export const hasNativeAlertPresenter = alertPresenter.available;
export const HermesAlertPresenterView = alertPresenter.Component;
export const hasNativeTextInput = textInput.available;
export const HermesTextInputView = textInput.Component;
export const hasNativeDrawerSurface = drawerSurface.available;
export const HermesDrawerSurfaceView = drawerSurface.Component;
export const hasNativeConfirmationDialog = confirmationDialog.available;
export const HermesConfirmationDialogView = confirmationDialog.Component;
export const hasNativeSwiftUIFrontend = swiftUIFrontend.available;
export const HermesSwiftUIFrontendView = swiftUIFrontend.Component;
export const hasNativeSwiftUILogin = swiftUILogin.available;
export const HermesSwiftUILoginView = swiftUILogin.Component;
