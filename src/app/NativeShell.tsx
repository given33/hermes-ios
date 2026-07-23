import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code,
  Cpu,
  Database,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Heart,
  KeyRound,
  Menu,
  MessageSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Puzzle,
  Radio,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  Users,
  Webhook,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import {
  DefaultTheme,
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Drawer } from 'react-native-drawer-layout';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Reanimated, {
  Easing,
  FadeInRight,
  FadeOutLeft,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedTintedIcon } from '../components/ui/AnimatedTintedIcon';
import { IOSPressable } from '../components/ios/IOSPressable';
import { NativeButton } from '../components/ui/NativeButton';
import {
  multiplyAlpha,
  opaque,
} from '../design/control-contracts';
import { resolveNativeFontStack } from '../design/native-font-faces';
import { resolveSwiftUIThemeProps } from '../design/swiftui-theme';
import { useTheme } from '../design/ThemeProvider';
import { IOS_MOTION } from '../design/ios-motion';
import {
  composeRouteRegistry,
  type ComposedNavigationItem,
  type ComposedRoute,
  type NativeNavigationIconName,
  type NativeRouteLocale,
  type PluginManifest,
  type RouteDashboardConfig,
} from './route-composition';
import {
  SHELL_METRICS,
  createSidebarRootState,
  createNativeShellState,
  reduceNativeShellState,
  resolveCompactNavigationEvent,
  resolveNativeShellPath,
  resolveShellTypography,
  resolveVisibleSidebarWidth,
} from './shell-contracts';
import { useAdaptiveLayout } from './useAdaptiveLayout';
import {
  HermesSwiftUISidebarView,
  hasNativeSwiftUIPartialFrontend,
} from '../../modules/hermes-ios-controls';

const NAV_ICONS: Record<NativeNavigationIconName, LucideIcon> = {
  Activity,
  BarChart3,
  BookOpen,
  Clock,
  Code,
  Cpu,
  Database,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Heart,
  KeyRound,
  MessageSquare,
  Package,
  Plug,
  Puzzle,
  Radio,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  Users,
  Webhook,
  Wrench,
  Zap,
};

const REFERENCE_SIDEBAR_ROUTES = [
  { labels: { en: 'Chat', zh: '单聊' }, path: '/chat', symbol: 'message.fill' },
  { labels: { en: 'Sessions', zh: '会话' }, path: '/sessions', symbol: 'bubble.left.and.bubble.right' },
  { labels: { en: 'Files', zh: '文件' }, path: '/files', symbol: 'folder' },
  { labels: { en: 'Analytics', zh: '分析' }, path: '/analytics', symbol: 'chart.bar.xaxis' },
  { labels: { en: 'Smart Weather', zh: '智能天气' }, path: '/smart-weather', symbol: 'cloud.rain' },
  { labels: { en: 'Models', zh: '模型' }, path: '/models', symbol: 'cpu' },
  { labels: { en: 'Logs', zh: '日志' }, path: '/logs', symbol: 'doc.text.magnifyingglass' },
  { labels: { en: 'Scheduled tasks', zh: '定时任务' }, path: '/cron', symbol: 'clock.arrow.circlepath' },
  { labels: { en: 'Skills', zh: '技能' }, path: '/skills', symbol: 'shippingbox' },
  { labels: { en: 'MCP', zh: 'MCP' }, path: '/mcp', symbol: 'network' },
  { labels: { en: 'Device pairing', zh: '设备配对' }, path: '/pairing', symbol: 'lock.shield' },
  { labels: { en: 'Channels', zh: '消息渠道' }, path: '/channels', symbol: 'dot.radiowaves.left.and.right' },
  { labels: { en: 'Webhooks', zh: '网络钩子' }, path: '/webhooks', symbol: 'arrow.triangle.branch' },
  { labels: { en: 'Achievements', zh: '成就' }, path: '/achievements', symbol: 'trophy' },
  { labels: { en: 'Collaboration', zh: '协作' }, path: '/collaboration', symbol: 'person.3' },
  { labels: { en: 'Kanban', zh: '看板' }, path: '/kanban', symbol: 'rectangle.3.group' },
  { labels: { en: 'Workflows', zh: '工作流' }, path: '/workflows', symbol: 'arrow.triangle.branch' },
  { labels: { en: 'Approvals', zh: '审批中心' }, path: '/approvals', symbol: 'checkmark.shield' },
  { labels: { en: 'Runtime Center', zh: '运行中心' }, path: '/runtime-center', symbol: 'waveform.path.ecg' },
  { labels: { en: 'Agent profiles', zh: '多 Agent 配置' }, path: '/profiles', symbol: 'person.2' },
  { labels: { en: 'Configuration', zh: '配置' }, path: '/config', symbol: 'slider.horizontal.3' },
  { labels: { en: 'Account', zh: '账户' }, path: '/account', symbol: 'person.crop.circle' },
  { labels: { en: 'Secrets', zh: '密钥' }, path: '/env', symbol: 'key' },
  { labels: { en: 'System', zh: '系统监控' }, path: '/system', symbol: 'gauge' },
  { labels: { en: 'Documentation', zh: '文档' }, path: '/docs', symbol: 'book.closed' },
] as const satisfies readonly {
  labels: Record<NativeRouteLocale, string>;
  path: string;
  symbol: SFSymbol;
}[];

const REFERENCE_SIDEBAR_FALLBACK_ICONS = {
  '/workflows': 'Zap',
  '/approvals': 'ShieldCheck',
  '/runtime-center': 'Activity',
  '/achievements': 'Star',
  '/analytics': 'BarChart3',
  '/smart-weather': 'Globe',
  '/channels': 'Radio',
  '/chat': 'MessageSquare',
  '/collaboration': 'Users',
  '/config': 'Settings',
  '/account': 'Users',
  '/cron': 'Clock',
  '/docs': 'BookOpen',
  '/env': 'KeyRound',
  '/files': 'FolderOpen',
  '/kanban': 'Database',
  '/logs': 'FileText',
  '/mcp': 'Globe',
  '/models': 'Cpu',
  '/pairing': 'ShieldCheck',
  '/profiles': 'Users',
  '/sessions': 'MessageSquare',
  '/skills': 'Package',
  '/system': 'Activity',
  '/webhooks': 'Webhook',
} as const satisfies Record<
  (typeof REFERENCE_SIDEBAR_ROUTES)[number]['path'],
  NativeNavigationIconName
>;

const COLOR_TRANSITION_EASING = Easing.bezier(
  ...IOS_MOTION.curve.standard,
);
const IOS_NAVIGATION_EASING = Easing.bezier(...IOS_MOTION.curve.navigation);
const PAGE_ENTERING = FadeInRight
  .duration(IOS_MOTION.duration.navigationEnter)
  .easing(IOS_NAVIGATION_EASING);
const PAGE_EXITING = FadeOutLeft
  .duration(IOS_MOTION.duration.navigationExit)
  .easing(IOS_NAVIGATION_EASING);
type CompactStackParamList = Record<
  string,
  { path?: string; sidebarSelection?: boolean } | undefined
>;
const CompactStack = createNativeStackNavigator<CompactStackParamList>();

export interface NativeShellSlotContext {
  collapsed: boolean;
  compact: boolean;
  activePath: string;
  navigate(path: string): void;
  openNavigation(): void;
  reportRouteReady(path: string): void;
}

export interface NativeShellSlots {
  profile?(context: NativeShellSlotContext): ReactNode;
  system?(context: NativeShellSlotContext): ReactNode;
  controls?(context: NativeShellSlotContext): ReactNode;
  auth?(context: NativeShellSlotContext): ReactNode;
  footer?(context: NativeShellSlotContext): ReactNode;
}

export type SidebarGatewayState =
  | 'online'
  | 'offline'
  | 'degraded'
  | 'unknown';

export interface SidebarGatewayStatus {
  id: string;
  label: string;
  state: SidebarGatewayState;
  version?: string | null;
}

const EMPTY_SIDEBAR_GATEWAY_STATUSES: readonly SidebarGatewayStatus[] = [];

export interface NativeShellProps {
  config?: RouteDashboardConfig | null;
  gatewayStatuses?: readonly SidebarGatewayStatus[];
  initialPath?: string;
  locale?: NativeRouteLocale;
  manifests?: readonly PluginManifest[];
  nativeRouteChrome?: boolean;
  renderRoute?(
    route: ComposedRoute,
    label: string,
    context: NativeShellSlotContext,
  ): ReactNode;
  slots?: NativeShellSlots;
}

export function NativeShell({
  config,
  gatewayStatuses = EMPTY_SIDEBAR_GATEWAY_STATUSES,
  initialPath = '/sessions',
  locale = 'zh',
  manifests = [],
  nativeRouteChrome = false,
  renderRoute,
  slots,
}: NativeShellProps) {
  const insets = useSafeAreaInsets();
  const layout = useAdaptiveLayout();
  const useSwiftUISidebar =
    Platform.OS === 'ios' && hasNativeSwiftUIPartialFrontend;
  const { tokens } = useTheme();
  const compactNavigationRef = useNavigationContainerRef<CompactStackParamList>();
  const composition = useMemo(
    () => composeRouteRegistry({ config, locale, manifests }),
    [config, locale, manifests],
  );
  const resolvedInitialPath = resolveNativeShellPath(
    composition.routes,
    initialPath,
  );
  const [state, dispatch] = useReducer(
    reduceNativeShellState,
    undefined,
    () => createNativeShellState(layout.mode, resolvedInitialPath),
  );
  const referenceCompactSidebar = Platform.OS === 'ios' || Platform.OS === 'web';
  const compactSidebarWidth = layout.width;
  const drawerExtent = state.mode === 'compact' && referenceCompactSidebar
    ? compactSidebarWidth
    : SHELL_METRICS.sidebarWidth + insets.left;
  const visibleSidebarWidth = state.mode === 'compact' && referenceCompactSidebar
    ? compactSidebarWidth
    : resolveVisibleSidebarWidth(state) + insets.left;
  const sidebarWidth = useSharedValue(visibleSidebarWidth);
  const pendingSidebarPath = useRef<string | null>(null);
  const pendingSidebarFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSidebarCloseFrame = useRef<number | null>(null);
  const typography = resolveShellTypography(tokens);
  const swiftUIThemeProps = resolveSwiftUIThemeProps(tokens);
  const resolvedGatewayStatuses = useMemo(
    () => resolveSidebarGatewayStatuses(gatewayStatuses),
    [gatewayStatuses],
  );
  const gatewayStatusesJson = useMemo(
    () => JSON.stringify(resolvedGatewayStatuses),
    [resolvedGatewayStatuses],
  );
  const rootBackground = opaque(tokens.colors.background);
  const sidebarBackground = rootBackground;
  const borderStrong = multiplyAlpha(tokens.colors.foreground, 0.2);
  const borderSoft = multiplyAlpha(tokens.colors.foreground, 0.1);

  useEffect(() => {
    dispatch({ type: 'layout-changed', mode: layout.mode });
  }, [layout.mode]);

  useEffect(() => {
    const resolvedPath = resolveNativeShellPath(
      composition.routes,
      state.activePath,
    );
    if (resolvedPath !== state.activePath) {
      dispatch({ type: 'navigate', path: resolvedPath });
    }
  }, [composition.routes, state.activePath]);

  useEffect(() => {
    sidebarWidth.value = withTiming(visibleSidebarWidth, {
      duration: IOS_MOTION.duration.rail,
      easing: IOS_NAVIGATION_EASING,
    });
  }, [sidebarWidth, state.collapsed, state.mode, visibleSidebarWidth]);

  const clearPendingSidebarSelection = useCallback(() => {
    pendingSidebarPath.current = null;
    if (pendingSidebarFallback.current) {
      clearTimeout(pendingSidebarFallback.current);
      pendingSidebarFallback.current = null;
    }
    if (pendingSidebarCloseFrame.current !== null) {
      cancelAnimationFrame(pendingSidebarCloseFrame.current);
      pendingSidebarCloseFrame.current = null;
    }
  }, []);
  const openMobile = useCallback(() => {
    Keyboard.dismiss();
    clearPendingSidebarSelection();
    dispatch({ type: 'open-mobile' });
  }, [clearPendingSidebarSelection]);
  const closeMobile = useCallback(() => {
    clearPendingSidebarSelection();
    dispatch({ type: 'close-mobile' });
  }, [clearPendingSidebarSelection]);
  const reportRouteReady = useCallback((path: string) => {
    const resolved = resolveNativeShellPath(composition.routes, path);
    if (pendingSidebarPath.current !== resolved) return;
    if (pendingSidebarFallback.current) {
      clearTimeout(pendingSidebarFallback.current);
      pendingSidebarFallback.current = null;
    }
    pendingSidebarPath.current = null;
    pendingSidebarCloseFrame.current = requestAnimationFrame(() => {
      pendingSidebarCloseFrame.current = null;
      dispatch({ type: 'close-mobile' });
    });
  }, [composition.routes]);
  useEffect(() => clearPendingSidebarSelection, [clearPendingSidebarSelection]);
  const navigate = useCallback(
    (path: string) => {
      Keyboard.dismiss();
      const resolved = resolveNativeShellPath(composition.routes, path);
      const currentRoute = compactNavigationRef.getCurrentRoute();
      const currentPath = currentRoute?.name;
      if (
        state.mode === 'compact'
        && compactNavigationRef.isReady()
        && currentPath !== resolved
      ) {
        compactNavigationRef.navigate(resolved);
      }
      dispatch({ type: 'navigate', path: resolved });
    },
    [compactNavigationRef, composition.routes, state.mode],
  );
  const selectSidebarRoute = useCallback(
    (path: string) => {
      Keyboard.dismiss();
      const resolved = resolveNativeShellPath(composition.routes, path);
      if (
        state.mode === 'compact'
        && compactNavigationRef.isReady()
      ) {
        const currentRoute = compactNavigationRef.getCurrentRoute();
        const currentPath = currentRoute?.name;
        if (currentPath === resolved) {
          closeMobile();
          return;
        }
        clearPendingSidebarSelection();
        pendingSidebarPath.current = resolved;
        compactNavigationRef.resetRoot(createSidebarRootState(resolved));
        dispatch({ type: 'select-route', path: resolved });
        // Keep the drawer over the route being replaced until the destination
        // has produced its first layout. This prevents the old chat screen or
        // an empty native host from flashing during the drawer animation.
        pendingSidebarFallback.current = setTimeout(() => {
          if (pendingSidebarPath.current !== resolved) return;
          pendingSidebarPath.current = null;
          pendingSidebarFallback.current = null;
          dispatch({ type: 'close-mobile' });
        }, 1_500);
        return;
      }
      dispatch({ type: 'navigate', path: resolved });
    },
    [
      clearPendingSidebarSelection,
      closeMobile,
      compactNavigationRef,
      composition.routes,
      state.mode,
    ],
  );
  const syncCompactNavigation = useCallback(() => {
    Keyboard.dismiss();
    const currentRoute = compactNavigationRef.getCurrentRoute();
    const current = currentRoute?.name;
    if (!current) return;
    const resolved = resolveNativeShellPath(composition.routes, current);
    const event = resolveCompactNavigationEvent(
      state.activePath,
      resolved,
      pendingSidebarPath.current,
    );
    if (event) dispatch(event);
  }, [compactNavigationRef, composition.routes, state.activePath]);
  const toggleCollapsed = useCallback(
    () => dispatch({ type: 'toggle-collapsed' }),
    [],
  );
  const drawerWidthStyle = useAnimatedStyle(() => ({
    width: sidebarWidth.value,
  }));
  const activeRoute = composition.routes.find(
    (route) => route.path === state.activePath,
  );
  const allNavigationItems = [
    ...composition.coreItems,
    ...composition.pluginItems,
  ];
  const activeLabel = allNavigationItems.find(
    (item) => item.path === activeRoute?.path,
  )?.label ?? activeRoute?.path ?? '';
  const slotContext: NativeShellSlotContext = {
    collapsed: state.mode === 'split' && state.collapsed,
    compact: state.mode === 'compact',
    activePath: state.activePath,
    navigate,
    openNavigation: openMobile,
    reportRouteReady,
  };
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 700);
  const compactSidebar = useSwiftUISidebar ? (
    <HermesSwiftUISidebarView
      {...swiftUIThemeProps}
      activePath={state.activePath}
      gatewayStatusesJson={gatewayStatusesJson}
      locale={locale}
      onNavigate={(event) => selectSidebarRoute(event.nativeEvent.path)}
      onRequestClose={closeMobile}
      open
      presentation="embedded"
      themeBackgroundColor={rootBackground}
      style={styles.swiftUISidebar}
    />
  ) : (
    <Sidebar
      borderSoft={borderSoft}
      borderStrong={borderStrong}
      closeMobile={closeMobile}
      composition={composition}
      gatewayStatuses={resolvedGatewayStatuses}
      insets={insets}
      locale={locale}
      navigate={selectSidebarRoute}
      onToggleCollapsed={toggleCollapsed}
      sidebarBackground={sidebarBackground}
      slotContext={slotContext}
      slots={slots}
      state={state}
      typography={typography}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: rootBackground }]}>
      <CompactDrawerFrame
        backgroundColor={sidebarBackground}
        compact={state.mode === 'compact'}
        drawerContent={compactSidebar}
        drawerWidth={drawerExtent}
        locale={locale}
        onClose={closeMobile}
        onOpen={openMobile}
        open={state.mobileOpen}
        swipeEnabled
      >
        <View style={styles.body}>
        {state.mode === 'split' ? (
          <Reanimated.View
            style={[
              styles.splitSidebar,
              { backgroundColor: sidebarBackground },
              drawerWidthStyle,
            ]}
          >
            {useSwiftUISidebar ? (
              <HermesSwiftUISidebarView
                {...swiftUIThemeProps}
                activePath={state.activePath}
                gatewayStatusesJson={gatewayStatusesJson}
                locale={locale}
                onNavigate={(event) => selectSidebarRoute(event.nativeEvent.path)}
                onRequestClose={closeMobile}
                open
                presentation="split"
                themeBackgroundColor={rootBackground}
                style={styles.swiftUISidebar}
              />
            ) : (
              <Sidebar
                borderSoft={borderSoft}
                borderStrong={borderStrong}
                closeMobile={closeMobile}
                composition={composition}
                gatewayStatuses={resolvedGatewayStatuses}
                insets={insets}
                locale={locale}
                navigate={selectSidebarRoute}
                onToggleCollapsed={toggleCollapsed}
                sidebarBackground={sidebarBackground}
                slotContext={slotContext}
                slots={slots}
                state={state}
                typography={typography}
              />
            )}
          </Reanimated.View>
        ) : null}

        <View
          accessibilityElementsHidden={
            state.mode === 'compact' && state.mobileOpen
          }
          importantForAccessibility={
            state.mode === 'compact' && state.mobileOpen
              ? 'no-hide-descendants'
              : 'auto'
          }
          style={[
            styles.content,
            state.mode === 'split'
              ? {
                  paddingRight: insets.right,
                  paddingTop: insets.top,
                }
              : null,
          ]}
        >
          {state.mode === 'compact' ? (
            <NavigationContainer
              onReady={syncCompactNavigation}
              onStateChange={syncCompactNavigation}
              ref={compactNavigationRef}
              theme={{
                ...DefaultTheme,
                colors: {
                  ...DefaultTheme.colors,
                  background: rootBackground,
                  border: borderStrong,
                  card: rootBackground,
                  notification: tokens.colors.destructive,
                  primary: tokens.colors.primary,
                  text: tokens.colors.foreground,
                },
              }}
            >
              <CompactStack.Navigator
                initialRouteName={state.activePath}
                screenOptions={{
                  animation: 'slide_from_right',
                  contentStyle: { backgroundColor: rootBackground },
                  gestureEnabled: true,
                  headerBackButtonDisplayMode: 'minimal',
                  headerBackButtonMenuEnabled: true,
                  headerShadowVisible: false,
                  headerStyle: { backgroundColor: rootBackground },
                  headerTintColor: tokens.colors.foreground,
                  headerTitleAlign: 'left',
                  headerTitleStyle: {
                    fontFamily: displayFont,
                    // react-native-screens stores native-stack title sizes as NSInteger.
                    fontSize: Math.round(typography.mobileBrand.fontSize),
                  },
                }}
              >
                {composition.routes.map((route) => {
                  const label = allNavigationItems.find(
                    (item) => item.path === route.path,
                  )?.label ?? route.path;
                  const chatRoute = route.routeId === 'chat';
                  const swiftUIRoute = nativeRouteChrome
                    && route.routeId !== 'chat'
                    && route.routeId !== 'smart-weather'
                    && route.routeId !== 'account';
                  return (
                    <CompactStack.Screen
                      key={route.path}
                      name={route.path}
                      options={({ navigation, route: navigationRoute }) => ({
                        animation: navigationRoute.params?.sidebarSelection
                          ? 'none'
                          : 'default',
                        headerBackVisible: navigation.canGoBack(),
                        headerLeft: navigation.canGoBack()
                          ? undefined
                          : () => (
                              <IOSPressable
                                accessibilityLabel={route.routeId === 'chat'
                                  ? locale === 'zh' ? '\u6253\u5f00\u5bfc\u822a' : 'Open navigation'
                                  : locale === 'zh' ? '\u8fd4\u56de\u4fa7\u8fb9\u680f' : 'Back to sidebar'}
                                haptic="none"
                                hitSlop={10}
                                onPress={openMobile}
                                opacityTo={0.7}
                                scaleTo={0.9}
                                style={styles.nativeHeaderButton}
                              >
                                {route.routeId === 'chat' ? (
                                  <Menu color={tokens.colors.foreground} size={22} />
                                ) : (
                                  <ChevronLeft color={tokens.colors.foreground} size={26} />
                                )}
                              </IOSPressable>
                            ),
                        headerShown: !chatRoute && !swiftUIRoute,
                        title: label || 'Hermes Agent',
                      })}
                    >
                      {() => {
                        const compactContext: NativeShellSlotContext = {
                          ...slotContext,
                          activePath: route.path,
                        };
                        return (
                          <View
                            style={[
                              styles.routeStage,
                              chatRoute ? undefined : {
                                paddingLeft: insets.left,
                                paddingRight: insets.right,
                              },
                            ]}
                          >
                            {renderRoute?.(route, label, compactContext)
                              ?? <RoutePreview label={label} />}
                          </View>
                        );
                      }}
                    </CompactStack.Screen>
                  );
                })}
              </CompactStack.Navigator>
            </NavigationContainer>
          ) : activeRoute ? (
            nativeRouteChrome ? (
              <View style={styles.routeStage}>
                {renderRoute?.(activeRoute, activeLabel, slotContext)
                  ?? <RoutePreview label={activeLabel} />}
              </View>
            ) : (
              <Reanimated.View
                entering={PAGE_ENTERING}
                exiting={PAGE_EXITING}
                key={activeRoute.path}
                style={styles.routeStage}
              >
                {renderRoute?.(activeRoute, activeLabel, slotContext)
                  ?? <RoutePreview label={activeLabel} />}
              </Reanimated.View>
            )
          ) : null}
        </View>
        </View>
      </CompactDrawerFrame>
    </View>
  );
}

function CompactDrawerFrame({
  backgroundColor,
  children,
  compact,
  drawerContent,
  drawerWidth,
  locale,
  onClose,
  onOpen,
  open,
  swipeEnabled,
}: {
  backgroundColor: string;
  children: ReactNode;
  compact: boolean;
  drawerContent: ReactNode;
  drawerWidth: number;
  locale: NativeRouteLocale;
  onClose(): void;
  onOpen(): void;
  open: boolean;
  swipeEnabled: boolean;
}) {
  if (!compact) return children;
  return (
    <Drawer
      direction="ltr"
      drawerPosition="left"
      drawerStyle={[
        styles.compactDrawerPanel,
        { backgroundColor, width: drawerWidth },
      ]}
      drawerType="front"
      keyboardDismissMode="on-drag"
      onClose={onClose}
      onOpen={onOpen}
      open={open}
      overlayAccessibilityLabel={locale === 'zh' ? '关闭导航' : 'Close navigation'}
      overlayStyle={{ backgroundColor: SHELL_METRICS.overlayColor }}
      renderDrawerContent={() => (
        <View collapsable={false} style={styles.compactDrawerSurface}>
          {drawerContent}
        </View>
      )}
      style={styles.compactDrawer}
      swipeEdgeWidth={28}
      swipeEnabled={swipeEnabled}
      swipeMinDistance={48}
      swipeMinVelocity={450}
    >
      {children}
    </Drawer>
  );
}

function Sidebar({
  borderSoft,
  borderStrong,
  closeMobile,
  composition,
  gatewayStatuses,
  insets,
  locale,
  navigate,
  onToggleCollapsed,
  sidebarBackground,
  slotContext,
  slots,
  state,
  typography,
}: {
  borderSoft: string;
  borderStrong: string;
  closeMobile(): void;
  composition: ReturnType<typeof composeRouteRegistry>;
  gatewayStatuses: readonly SidebarGatewayStatus[];
  insets: ReturnType<typeof useSafeAreaInsets>;
  locale: NativeRouteLocale;
  navigate(path: string): void;
  onToggleCollapsed(): void;
  sidebarBackground: string;
  slotContext: NativeShellSlotContext;
  slots?: NativeShellSlots;
  state: ReturnType<typeof createNativeShellState>;
  typography: ReturnType<typeof resolveShellTypography>;
}) {
  const { tokens } = useTheme();
  if (
    (Platform.OS === 'ios' || Platform.OS === 'web')
    && state.mode === 'compact'
  ) {
    return (
      <ExpoReferenceSidebar
        activePath={state.activePath}
        gatewayStatuses={gatewayStatuses}
        insets={insets}
        locale={locale}
        navigate={navigate}
      />
    );
  }
  const collapsed = state.mode === 'split' && state.collapsed;
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 700);
  return (
    <View
      accessibilityLabel="Hermes navigation"
      style={[
        styles.sidebar,
        {
          backgroundColor: sidebarBackground,
          borderRightColor: borderStrong,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingTop: insets.top,
        },
      ]}
    >
      <ScrollView
        bounces={false}
        decelerationRate="normal"
        contentContainerStyle={{
          paddingVertical: typography.spacingUnit * 2,
        }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={8}
        style={styles.navigation}
      >
        <View
          style={[
            styles.sidebarHeader,
            { paddingHorizontal: typography.spacingUnit * 4 },
            collapsed && styles.sidebarHeaderCollapsed,
          ]}
        >
          {!collapsed ? (
            <Text
              style={[
                styles.sidebarBrand,
                {
                  color: tokens.colors.foreground,
                  fontFamily: displayFont,
                  fontSize: typography.brand.fontSize,
                  fontWeight: displayFont ? undefined : '700',
                  letterSpacing: typography.brand.letterSpacing,
                  lineHeight: typography.brand.lineHeight,
                },
              ]}
            >
              HERMES{'\n'}AGENT
            </Text>
          ) : null}

          {state.mode === 'compact' ? (
            <NativeButton
              accessibilityLabel={locale === 'zh' ? '\u5173\u95ed\u5bfc\u822a' : 'Close navigation'}
              ghost
              onPress={closeMobile}
              size="icon"
            >
              <X />
            </NativeButton>
          ) : (
            <NativeButton
              accessibilityLabel={
                locale === 'zh'
                  ? collapsed ? '\u5c55\u5f00' : '\u6298\u53e0'
                  : collapsed ? 'Expand' : 'Collapse'
              }
              ghost
              onPress={onToggleCollapsed}
              size="icon"
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </NativeButton>
          )}
        </View>

        {slots?.profile?.(slotContext)}
        {composition.coreItems.map((item, index) => (
          <ShellNavigationItem
            active={state.activePath === item.path}
            collapsed={collapsed}
            item={item}
            key={navigationItemKey(item, index)}
            onPress={() => navigate(item.path)}
            typography={typography}
          />
        ))}

        {composition.pluginItems.map((item, index) => (
          <ShellNavigationItem
            active={state.activePath === item.path}
            collapsed={collapsed}
            item={item}
            key={navigationItemKey(item, index)}
            onPress={() => navigate(item.path)}
            typography={typography}
          />
        ))}
        {slots?.system?.(slotContext)}
        {slots?.controls?.(slotContext)}
        {!collapsed ? slots?.auth?.(slotContext) : null}
        {!collapsed ? slots?.footer?.(slotContext) : null}
      </ScrollView>
    </View>
  );
}

function ExpoReferenceSidebar({
  activePath,
  gatewayStatuses,
  insets,
  locale,
  navigate,
}: {
  activePath: string;
  gatewayStatuses: readonly SidebarGatewayStatus[];
  insets: ReturnType<typeof useSafeAreaInsets>;
  locale: NativeRouteLocale;
  navigate(path: string): void;
}) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityLabel="Hermes navigation"
      style={[
        styles.referenceSidebar,
        {
          paddingBottom: insets.bottom,
          paddingTop: insets.top,
        },
      ]}
    >
      <ScrollView
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
        bounces={false}
        contentContainerStyle={styles.referenceSidebarContent}
        contentInsetAdjustmentBehavior="never"
        decelerationRate="normal"
        scrollEventThrottle={8}
        showsVerticalScrollIndicator={false}
        style={styles.referenceSidebarScroll}
      >
        <View style={styles.referenceSidebarHeader}>
          <Text
            numberOfLines={1}
            style={[
              styles.referenceSidebarTitle,
              { color: tokens.colors.foreground },
            ]}
          >
            Hermes Agent
          </Text>
        </View>

        <View style={styles.referenceSidebarGroup}>
          {REFERENCE_SIDEBAR_ROUTES.map((route) => {
            const FallbackIcon = NAV_ICONS[
              REFERENCE_SIDEBAR_FALLBACK_ICONS[route.path]
            ];
            const active = activePath === route.path;
            return (
              <IOSPressable
                    accessibilityRole="link"
                    accessibilityState={{ selected: active }}
                    key={route.path}
                    onPress={() => navigate(route.path)}
                    opacityTo={0.76}
                    scaleTo={0.99}
                    style={[
                      styles.referenceSidebarRow,
                      active
                        ? { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.10) }
                        : null,
                    ]}
                  >
                    <SymbolView
                      fallback={(
                        <FallbackIcon
                          color={tokens.colors.primary}
                          size={18}
                          strokeWidth={1.8}
                        />
                      )}
                      name={route.symbol}
                      size={18}
                      tintColor={tokens.colors.primary}
                      type="monochrome"
                      weight="regular"
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.referenceSidebarRowLabel,
                        { color: tokens.colors.foreground },
                      ]}
                    >
                      {route.labels[locale]}
                    </Text>
                    <SymbolView
                      fallback={(
                        <ChevronRight
                          color={tokens.colors.textTertiary}
                          size={13}
                          strokeWidth={2.4}
                        />
                      )}
                      name="chevron.right"
                      size={13}
                      tintColor={tokens.colors.textTertiary}
                      type="monochrome"
                      weight="semibold"
                    />
              </IOSPressable>
            );
          })}
        </View>
        <View style={styles.referenceSidebarFooter}>
          <View style={styles.referenceSidebarGatewayList}>
            {gatewayStatuses.map((gateway) => (
              <View key={gateway.id} style={styles.referenceSidebarGatewayRow}>
                <View
                  style={[
                    styles.referenceSidebarStatusDot,
                    { backgroundColor: gatewayStateColor(gateway.state, tokens) },
                  ]}
                />
                <View style={styles.referenceSidebarStatusCopy}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.referenceSidebarStatusTitle,
                      { color: tokens.colors.foreground },
                    ]}
                  >
                    {gateway.label}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.referenceSidebarStatusMeta,
                      { color: tokens.colors.textSecondary },
                    ]}
                  >
                    {gatewayStatusMeta(gateway, locale)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function ShellNavigationItem({
  active,
  collapsed,
  item,
  onPress,
  typography,
}: {
  active: boolean;
  collapsed: boolean;
  item: ComposedNavigationItem;
  onPress(): void;
  typography: ReturnType<typeof resolveShellTypography>;
}) {
  const { tokens } = useTheme();
  const Icon = NAV_ICONS[item.icon];
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const targetColor = active || hovered || pressed
    ? tokens.colors.foreground
    : tokens.colors.textSecondary;
  const color = useSharedValue(targetColor);
  const hoverOpacity = useSharedValue(0);
  const labelOpacity = useSharedValue(
    collapsed
      ? SHELL_METRICS.collapsedLabelOpacity
      : SHELL_METRICS.expandedLabelOpacity,
  );

  useEffect(() => {
    color.value = withTiming(targetColor, {
      duration: IOS_MOTION.duration.control,
      easing: COLOR_TRANSITION_EASING,
    });
  }, [color, targetColor]);

  useEffect(() => {
    hoverOpacity.value = withTiming(
      hovered || pressed ? SHELL_METRICS.hoverLayerOpacity : 0,
      {
        duration: IOS_MOTION.duration.press,
        easing: COLOR_TRANSITION_EASING,
      },
    );
  }, [hovered, hoverOpacity, pressed]);

  useEffect(() => {
    labelOpacity.value = withTiming(
      collapsed
        ? SHELL_METRICS.collapsedLabelOpacity
        : SHELL_METRICS.expandedLabelOpacity,
      {
        duration: IOS_MOTION.duration.control,
        easing: COLOR_TRANSITION_EASING,
      },
    );
  }, [collapsed, labelOpacity]);

  const textStyle = useAnimatedStyle(() => ({
    color: color.value,
    opacity: labelOpacity.value,
  }));
  const hoverStyle = useAnimatedStyle(() => ({
    opacity: hoverOpacity.value,
  }));
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 400);

  return (
    <IOSPressable
      accessibilityLabel={collapsed ? item.label : undefined}
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.navItem,
        {
          gap: typography.nav.gap,
          paddingHorizontal: typography.nav.paddingHorizontal,
          paddingVertical: typography.nav.paddingVertical,
        },
      ]}
    >
      <Reanimated.View
        pointerEvents="none"
        style={[
          styles.navHover,
          {
            backgroundColor: tokens.colors.foreground,
            bottom: typography.nav.paddingVertical * 0.2,
            left: typography.nav.paddingHorizontal * 0.3,
            right: typography.nav.paddingHorizontal * 0.3,
            top: typography.nav.paddingVertical * 0.2,
          },
          hoverStyle,
        ]}
      />
      {focused ? (
        <View
          pointerEvents="none"
          style={[
            styles.focusRing,
            { borderColor: tokens.colors.foreground },
          ]}
        />
      ) : null}
      <AnimatedTintedIcon
        color={color}
        icon={<Icon size={typography.nav.iconSize} />}
      />
      <Reanimated.Text
        numberOfLines={1}
        style={[
          styles.navLabel,
          {
            fontFamily: displayFont,
            fontSize: typography.nav.fontSize,
            letterSpacing: typography.nav.letterSpacing,
            lineHeight: typography.nav.lineHeight,
          },
          textStyle,
        ]}
      >
        {item.label}
      </Reanimated.Text>
      {active ? (
        <View
          pointerEvents="none"
          style={[
            styles.activeIndicator,
            { backgroundColor: tokens.colors.foreground },
          ]}
        />
      ) : null}
    </IOSPressable>
  );
}

function RoutePreview({ label }: { label: string }) {
  const { tokens } = useTheme();
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 700);
  return (
    <View style={styles.routePreview}>
      <Text
        style={[
          styles.routeTitle,
          {
            color: tokens.colors.foreground,
            fontFamily: displayFont,
            fontWeight: displayFont ? undefined : '700',
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function resolveSidebarGatewayStatuses(
  statuses: readonly SidebarGatewayStatus[],
): SidebarGatewayStatus[] {
  const byId = new Map(statuses.map((status) => [status.id.toLowerCase(), status]));
  return [
    byId.get('dbb3') ?? { id: 'dbb3', label: 'DBB3', state: 'unknown' },
    byId.get('wsl') ?? { id: 'wsl', label: 'WSL', state: 'unknown' },
  ].map((status) => ({
    id: status.id,
    label: status.label.trim() || status.id,
    state: status.state,
    version: status.version?.trim() || null,
  }));
}

function gatewayStatusMeta(
  gateway: SidebarGatewayStatus,
  locale: NativeRouteLocale,
): string {
  const stateLabel = locale === 'zh'
    ? {
        degraded: '\u5f02\u5e38',
        offline: '\u79bb\u7ebf',
        online: '\u5728\u7ebf',
        unknown: '\u68c0\u6d4b\u4e2d',
      }[gateway.state]
    : gateway.state === 'unknown' ? 'Checking' : gateway.state;
  return gateway.version ? `${stateLabel} \u00b7 ${gateway.version}` : stateLabel;
}

function gatewayStateColor(
  state: SidebarGatewayState,
  tokens: ReturnType<typeof useTheme>['tokens'],
): string {
  if (state === 'online') return tokens.colors.success;
  if (state === 'degraded') return tokens.colors.warning;
  if (state === 'offline') return tokens.colors.destructive;
  return tokens.colors.textDisabled;
}

function navigationItemKey(
  item: ComposedNavigationItem,
  index: number,
): string {
  return [
    item.source,
    item.pluginName ?? item.routeId ?? 'route',
    item.path,
    index,
  ].join(':');
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
    minWidth: 0,
  },
  content: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  routeStage: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  nativeHeaderButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  splitSidebar: {
    flexShrink: 0,
    height: '100%',
    overflow: 'hidden',
  },
  compactDrawer: {
    flex: 1,
  },
  compactDrawerPanel: {
    overflow: 'hidden',
  },
  compactDrawerSurface: {
    flex: 1,
    minHeight: 0,
    backgroundColor: 'transparent',
  },
  swiftUISidebar: {
    flex: 1,
  },
  sidebar: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  sidebarHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    height: SHELL_METRICS.headerHeight,
    justifyContent: 'space-between',
  },
  sidebarHeaderCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
  sidebarBrand: {
    textTransform: 'uppercase',
  },
  referenceSidebar: {
    backgroundColor: 'transparent',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  referenceSidebarHeader: {
    height: 96,
    justifyContent: 'flex-end',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  referenceSidebarTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 41,
  },
  referenceSidebarScroll: {
    flex: 1,
    minHeight: 0,
  },
  referenceSidebarContent: {
    paddingBottom: 18,
  },
  referenceSidebarGroup: {
    backgroundColor: 'transparent',
  },
  referenceSidebarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  referenceSidebarRowLabel: {
    flex: 1,
    fontFamily: 'Collapse-Regular',
    fontSize: 15,
    letterSpacing: 0,
    lineHeight: 21,
  },
  referenceSidebarFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 58,
    paddingBottom: 9,
    paddingHorizontal: 20,
    paddingTop: 3,
  },
  referenceSidebarGatewayList: {
    flex: 1,
    gap: 6,
  },
  referenceSidebarGatewayRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  referenceSidebarStatusDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  referenceSidebarStatusCopy: {
    flex: 1,
    gap: 2,
  },
  referenceSidebarStatusTitle: {
    fontFamily: 'Collapse-Bold',
    fontSize: 13,
    letterSpacing: 0,
    lineHeight: 17,
  },
  referenceSidebarStatusMeta: {
    fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal',
    fontSize: 10,
    letterSpacing: 0,
    lineHeight: 14,
  },
  navigation: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  navItem: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 52,
    overflow: 'hidden',
    position: 'relative',
  },
  navLabel: {
    flexShrink: 0,
    textTransform: 'uppercase',
  },
  navHover: {
    position: 'absolute',
  },
  focusRing: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
  },
  activeIndicator: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: SHELL_METRICS.activeIndicatorWidth,
  },
  routePreview: {
    flex: 1,
    padding: 24,
  },
  routeTitle: {
    fontSize: 18,
    letterSpacing: 0,
  },
});
