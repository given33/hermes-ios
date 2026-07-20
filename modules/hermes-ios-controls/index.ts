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

interface HermesFrameRateNativeModule {
  start(): void;
  stop(): void;
  getDiagnostics(): Promise<Record<string, unknown>>;
}

const nativeFrameRateModule =
  requireOptionalNativeModule<HermesFrameRateNativeModule>('HermesFrameRate');

export function startNativeFrameRateController() {
  nativeFrameRateModule?.start();
}

export async function getNativeFrameRateDiagnostics() {
  return (await nativeFrameRateModule?.getDiagnostics()) ?? null;
}

export interface HermesSwiftUIThemeProps {
  themeAccentColor: string;
  themeBackgroundColor: string;
  themeBorderColor: string;
  themeColorScheme: 'dark' | 'light';
  themeDestructiveColor: string;
  themeElevatedColor: string;
  themeForegroundColor: string;
  themePrimaryColor: string;
  themeSecondaryColor: string;
  themeSuccessColor: string;
  themeSurfaceColor: string;
  themeTertiaryColor: string;
  themeWarningColor: string;
}

function optionalView<P extends NativeViewProps>(
  name: string,
  viewName?: string,
) {
  const available = requireOptionalNativeModule(name) !== null;
  const NativeView = available ? requireNativeView<P>(name, viewName) : null;
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

export interface HermesSwiftUISidebarProps extends NativeViewProps, HermesSwiftUIThemeProps {
  activePath: string;
  gatewayStatusesJson: string;
  locale: 'en' | 'zh';
  onNavigate?(event: NativeSyntheticEvent<{ path: string }>): void;
  onRequestClose?(event: NativeSyntheticEvent<Record<string, never>>): void;
  open: boolean;
  presentation: 'drawer' | 'embedded' | 'split';
}

export interface HermesSwiftUIRouteProps extends NativeViewProps, HermesSwiftUIThemeProps {
  dataJson?: string;
  locale: 'en' | 'zh';
  onAction?(event: NativeSyntheticEvent<{ action: string; payload: string }>): void;
  onOpenNavigation?(event: NativeSyntheticEvent<Record<string, never>>): void;
  onReady?(event: NativeSyntheticEvent<{ path: string }>): void;
  path: string;
  pluginName: string;
  routeId: string;
}

export interface HermesSwiftUIModelToolsProps extends NativeViewProps, HermesSwiftUIThemeProps {
  locale: 'en' | 'zh';
  model: string;
  onModelChange?(event: NativeSyntheticEvent<{ model: string }>): void;
  onNewConversation?(event: NativeSyntheticEvent<Record<string, never>>): void;
  onReasoningChange?(event: NativeSyntheticEvent<{ reasoning: string }>): void;
  onRequestClose?(event: NativeSyntheticEvent<Record<string, never>>): void;
  onToolsChange?(event: NativeSyntheticEvent<{ enabled: boolean }>): void;
  open: boolean;
  reasoning: 'high' | 'low' | 'medium';
  toolsEnabled: boolean;
}

export interface HermesSwiftUIFrostedSurfaceProps extends NativeViewProps {
  colorScheme: 'dark' | 'light';
  cornerRadius: number;
  tintColor: string;
}

const segmented = optionalView<HermesSegmentedControlProps>('HermesSegmentedControl');
const nativeSwitch = optionalView<HermesSwitchProps>('HermesSwitch');
const search = optionalView<HermesSearchBarProps>('HermesSearchBar');
const progress = optionalView<HermesProgressProps>('HermesProgress');
const selection = optionalView<HermesSelectionProps>('HermesSelection');
const pressFeedback = optionalView<HermesPressFeedbackProps>('HermesPressFeedback');
const swiftUIPartialSidebar = optionalView<HermesSwiftUISidebarProps>(
  'HermesSwiftUIPartialFrontend',
  'HermesSwiftUISidebarView',
);
const swiftUIPartialRoute = optionalView<HermesSwiftUIRouteProps>(
  'HermesSwiftUIPartialFrontend',
  'HermesSwiftUIRouteView',
);
const swiftUIPartialModelTools = optionalView<HermesSwiftUIModelToolsProps>(
  'HermesSwiftUIPartialFrontend',
  'HermesSwiftUIModelToolsView',
);
const swiftUIPartialFrostedSurface = optionalView<HermesSwiftUIFrostedSurfaceProps>(
  'HermesSwiftUIPartialFrontend',
  'HermesSwiftUIFrostedSurfaceView',
);

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
export const hasNativeSwiftUIPartialFrontend = swiftUIPartialSidebar.available;
export const HermesSwiftUISidebarView = swiftUIPartialSidebar.Component;
export const HermesSwiftUIRouteView = swiftUIPartialRoute.Component;
export const HermesSwiftUIModelToolsView = swiftUIPartialModelTools.Component;
export const HermesSwiftUIFrostedSurfaceView = swiftUIPartialFrostedSurface.Component;
