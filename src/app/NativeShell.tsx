import {
  Activity,
  BarChart3,
  BookOpen,
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
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  FadeInRight,
  FadeOutLeft,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
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
  createNativeShellState,
  reduceNativeShellState,
  resolveMobileDrawerTranslation,
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

const REFERENCE_SIDEBAR_GROUPS = [
  {
    labels: { en: 'Workspace', zh: '工作区' },
    routes: [
      { labels: { en: 'Chat', zh: '单聊' }, path: '/chat', symbol: 'message.fill' },
      { labels: { en: 'Sessions', zh: '会话' }, path: '/sessions', symbol: 'bubble.left.and.bubble.right' },
      { labels: { en: 'Files', zh: '文件' }, path: '/files', symbol: 'folder' },
      { labels: { en: 'Analytics', zh: '分析' }, path: '/analytics', symbol: 'chart.bar.xaxis' },
      { labels: { en: 'Models', zh: '模型' }, path: '/models', symbol: 'cpu' },
      { labels: { en: 'Logs', zh: '日志' }, path: '/logs', symbol: 'doc.text.magnifyingglass' },
    ],
  },
  {
    labels: { en: 'Automation', zh: '自动化' },
    routes: [
      { labels: { en: 'Scheduled tasks', zh: '定时任务' }, path: '/cron', symbol: 'clock.arrow.circlepath' },
      { labels: { en: 'Skills', zh: '技能' }, path: '/skills', symbol: 'shippingbox' },
      { labels: { en: 'Plugins', zh: '插件管理' }, path: '/plugins', symbol: 'puzzlepiece.extension' },
      { labels: { en: 'MCP', zh: 'MCP' }, path: '/mcp', symbol: 'network' },
      { labels: { en: 'Device pairing', zh: '设备配对' }, path: '/pairing', symbol: 'lock.shield' },
      { labels: { en: 'Channels', zh: '消息渠道' }, path: '/channels', symbol: 'dot.radiowaves.left.and.right' },
      { labels: { en: 'Webhooks', zh: '网络钩子' }, path: '/webhooks', symbol: 'arrow.triangle.branch' },
    ],
  },
  {
    labels: { en: 'Extensions', zh: '扩展' },
    routes: [
      { labels: { en: 'Achievements', zh: '成就' }, path: '/achievements', symbol: 'trophy' },
      { labels: { en: 'Collaboration', zh: '协作' }, path: '/collaboration', symbol: 'person.3' },
      { labels: { en: 'Kanban', zh: '看板' }, path: '/kanban', symbol: 'rectangle.3.group' },
    ],
  },
  {
    labels: { en: 'Administration', zh: '管理' },
    routes: [
      { labels: { en: 'Agent profiles', zh: '多 Agent 配置' }, path: '/profiles', symbol: 'person.2' },
      { labels: { en: 'Configuration', zh: '配置' }, path: '/config', symbol: 'slider.horizontal.3' },
      { labels: { en: 'Secrets', zh: '密钥' }, path: '/env', symbol: 'key' },
      { labels: { en: 'System', zh: '系统监控' }, path: '/system', symbol: 'gauge' },
      { labels: { en: 'Documentation', zh: '文档' }, path: '/docs', symbol: 'book.closed' },
    ],
  },
] as const satisfies readonly {
  labels: Record<NativeRouteLocale, string>;
  routes: readonly {
    labels: Record<NativeRouteLocale, string>;
    path: string;
    symbol: SFSymbol;
  }[];
}[];

const REFERENCE_SIDEBAR_FALLBACK_ICONS = {
  '/achievements': 'Star',
  '/analytics': 'BarChart3',
  '/channels': 'Radio',
  '/chat': 'MessageSquare',
  '/collaboration': 'Users',
  '/config': 'Settings',
  '/cron': 'Clock',
  '/docs': 'BookOpen',
  '/env': 'KeyRound',
  '/files': 'FolderOpen',
  '/kanban': 'Database',
  '/logs': 'FileText',
  '/mcp': 'Globe',
  '/models': 'Cpu',
  '/pairing': 'ShieldCheck',
  '/plugins': 'Puzzle',
  '/profiles': 'Users',
  '/sessions': 'MessageSquare',
  '/skills': 'Package',
  '/system': 'Activity',
  '/webhooks': 'Webhook',
} as const satisfies Record<
  (typeof REFERENCE_SIDEBAR_GROUPS)[number]['routes'][number]['path'],
  NativeNavigationIconName
>;

const COLOR_TRANSITION_EASING = Easing.bezier(
  ...IOS_MOTION.curve.standard,
);
const IOS_NAVIGATION_EASING = Easing.bezier(...IOS_MOTION.curve.navigation);
const IOS_DRAWER_SPRING = {
  damping: IOS_MOTION.spring.damping,
  mass: IOS_MOTION.spring.mass,
  overshootClamping: true,
  stiffness: IOS_MOTION.spring.stiffness,
} as const;
const PAGE_ENTERING = FadeInRight
  .duration(IOS_MOTION.duration.navigationEnter)
  .easing(IOS_NAVIGATION_EASING);
const PAGE_EXITING = FadeOutLeft
  .duration(IOS_MOTION.duration.navigationExit)
  .easing(IOS_NAVIGATION_EASING);
type CompactStackParamList = Record<string, undefined>;
const CompactStack = createNativeStackNavigator<CompactStackParamList>();

export interface NativeShellSlotContext {
  collapsed: boolean;
  compact: boolean;
  activePath: string;
  navigate(path: string): void;
  openNavigation(): void;
}

export interface NativeShellSlots {
  profile?(context: NativeShellSlotContext): ReactNode;
  system?(context: NativeShellSlotContext): ReactNode;
  controls?(context: NativeShellSlotContext): ReactNode;
  auth?(context: NativeShellSlotContext): ReactNode;
  footer?(context: NativeShellSlotContext): ReactNode;
}

export interface NativeShellProps {
  config?: RouteDashboardConfig | null;
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
  const initialDrawerTranslation = resolveMobileDrawerTranslation(state) < 0
    ? -drawerExtent
    : 0;
  const sidebarWidth = useSharedValue(visibleSidebarWidth);
  const drawerTranslation = useSharedValue(initialDrawerTranslation);
  const [canGoBack, setCanGoBack] = useState(false);
  const typography = resolveShellTypography(tokens);
  const swiftUIThemeProps = resolveSwiftUIThemeProps(tokens);
  const rootBackground = opaque(tokens.colors.background);
  const sidebarBackground = multiplyAlpha(
    rootBackground,
    state.mode === 'compact' ? 0.96 : 1,
  );
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

  useEffect(() => {
    const target = resolveMobileDrawerTranslation(state) < 0
      ? -drawerExtent
      : 0;
    drawerTranslation.value = withSpring(target, IOS_DRAWER_SPRING);
  }, [drawerExtent, drawerTranslation, state.mobileOpen, state.mode]);

  const openMobile = useCallback(() => dispatch({ type: 'open-mobile' }), []);
  const closeMobile = useCallback(() => dispatch({ type: 'close-mobile' }), []);
  const navigate = useCallback(
    (path: string) => {
      const resolved = resolveNativeShellPath(composition.routes, path);
      if (
        state.mode === 'compact'
        && compactNavigationRef.isReady()
        && compactNavigationRef.getCurrentRoute()?.name !== resolved
      ) {
        compactNavigationRef.navigate(resolved);
      }
      dispatch({ type: 'navigate', path: resolved });
    },
    [compactNavigationRef, composition.routes, state.mode],
  );
  const selectSidebarRoute = useCallback(
    (path: string) => {
      const resolved = resolveNativeShellPath(composition.routes, path);
      if (
        state.mode === 'compact'
        && compactNavigationRef.isReady()
        && compactNavigationRef.getCurrentRoute()?.name !== resolved
      ) {
        compactNavigationRef.resetRoot({
          index: 0,
          routes: [{ name: resolved }],
        });
      }
      dispatch({ type: 'navigate', path: resolved });
    },
    [compactNavigationRef, composition.routes, state.mode],
  );
  const syncCompactNavigation = useCallback(() => {
    const current = compactNavigationRef.getCurrentRoute()?.name;
    setCanGoBack(compactNavigationRef.canGoBack());
    if (!current) return;
    const resolved = resolveNativeShellPath(composition.routes, current);
    if (resolved !== state.activePath) {
      dispatch({ type: 'navigate', path: resolved });
    }
  }, [compactNavigationRef, composition.routes, state.activePath]);
  const toggleCollapsed = useCallback(
    () => dispatch({ type: 'toggle-collapsed' }),
    [],
  );
  const drawerWidthStyle = useAnimatedStyle(() => ({
    width: sidebarWidth.value,
  }));
  const drawerTranslationStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drawerTranslation.value }],
  }));
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      drawerTranslation.value,
      [-drawerExtent, 0],
      [0, 1],
      'clamp',
    ),
  }));
  const openGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX(8)
      .failOffsetY([-12, 12])
      .onUpdate((event) => {
        drawerTranslation.value = Math.max(
          -drawerExtent,
          Math.min(0, -drawerExtent + event.translationX),
        );
      })
      .onEnd((event, success) => {
        if (!success) {
          drawerTranslation.value = withSpring(-drawerExtent, IOS_DRAWER_SPRING);
          return;
        }
        const projectedTranslation = event.translationX + event.velocityX * 0.12;
        if (projectedTranslation > drawerExtent * 0.25) {
          if (useSwiftUISidebar) {
            runOnJS(openMobile)();
            return;
          }
          drawerTranslation.value = withSpring(0, {
            ...IOS_DRAWER_SPRING,
            velocity: event.velocityX,
          }, (finished) => {
            if (finished) runOnJS(openMobile)();
          });
        } else {
          drawerTranslation.value = withSpring(-drawerExtent, {
            ...IOS_DRAWER_SPRING,
            velocity: event.velocityX,
          });
        }
      }),
    [drawerExtent, drawerTranslation, openMobile, useSwiftUISidebar],
  );
  const closeGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX(-8)
      .failOffsetY([-12, 12])
      .onUpdate((event) => {
        drawerTranslation.value = Math.max(
          -drawerExtent,
          Math.min(0, event.translationX),
        );
      })
      .onEnd((event, success) => {
        if (!success) {
          drawerTranslation.value = withSpring(0, IOS_DRAWER_SPRING);
          return;
        }
        const projectedTranslation = event.translationX + event.velocityX * 0.12;
        if (projectedTranslation < -drawerExtent * 0.25) {
          drawerTranslation.value = withSpring(-drawerExtent, {
            ...IOS_DRAWER_SPRING,
            velocity: event.velocityX,
          }, (finished) => {
            if (finished) runOnJS(closeMobile)();
          });
        } else {
          drawerTranslation.value = withSpring(0, {
            ...IOS_DRAWER_SPRING,
            velocity: event.velocityX,
          });
        }
      }),
    [closeMobile, drawerExtent, drawerTranslation],
  );
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
  };
  const unifiedChatActive = activeRoute?.routeId === 'chat';
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 700);

  return (
    <View style={[styles.root, { backgroundColor: rootBackground }]}>
      <View style={styles.body}>
        {state.mode === 'split' ? (
          <Reanimated.View style={[styles.splitSidebar, drawerWidthStyle]}>
            {useSwiftUISidebar ? (
              <HermesSwiftUISidebarView
                {...swiftUIThemeProps}
                activePath={state.activePath}
                locale={locale}
                onNavigate={(event) => selectSidebarRoute(event.nativeEvent.path)}
                onRequestClose={closeMobile}
                open
                presentation="split"
                style={styles.swiftUISidebar}
              />
            ) : (
              <Sidebar
                borderSoft={borderSoft}
                borderStrong={borderStrong}
                closeMobile={closeMobile}
                composition={composition}
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
                  animation: 'default',
                  animationMatchesGesture: true,
                  contentStyle: { backgroundColor: rootBackground },
                  gestureDirection: 'horizontal',
                  gestureEnabled: true,
                  headerBackButtonDisplayMode: 'minimal',
                  headerBackButtonMenuEnabled: true,
                  headerShadowVisible: true,
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
                  return (
                    <CompactStack.Screen
                      key={route.path}
                      name={route.path}
                      options={({ navigation }) => ({
                        headerBackVisible: navigation.canGoBack(),
                        headerLeft: navigation.canGoBack()
                          ? undefined
                          : () => (
                              <IOSPressable
                                accessibilityLabel={locale === 'zh' ? '\u6253\u5f00\u5bfc\u822a' : 'Open navigation'}
                                haptic="none"
                                hitSlop={10}
                                onPress={openMobile}
                                opacityTo={0.7}
                                scaleTo={0.9}
                                style={styles.nativeHeaderButton}
                              >
                                <Menu color={tokens.colors.foreground} size={22} />
                              </IOSPressable>
                            ),
                        headerShown: !chatRoute && !nativeRouteChrome,
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
                              chatRoute ? null : {
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

      {state.mode === 'compact' ? (
        useSwiftUISidebar ? (
          <Fragment>
            {!state.mobileOpen && !canGoBack ? (
              <GestureDetector gesture={openGesture}>
                <View
                  style={[
                    styles.openEdge,
                    { top: unifiedChatActive ? insets.top : insets.top + SHELL_METRICS.headerHeight },
                  ]}
                />
              </GestureDetector>
            ) : null}
            <View
              accessibilityElementsHidden={!state.mobileOpen}
              accessibilityViewIsModal={state.mobileOpen}
              importantForAccessibility={state.mobileOpen ? 'yes' : 'no-hide-descendants'}
              pointerEvents={state.mobileOpen ? 'auto' : 'none'}
              style={styles.swiftUIDrawerHost}
            >
              <HermesSwiftUISidebarView
                {...swiftUIThemeProps}
                activePath={state.activePath}
                locale={locale}
                onNavigate={(event) => selectSidebarRoute(event.nativeEvent.path)}
                onRequestClose={closeMobile}
                open={state.mobileOpen}
                presentation="drawer"
                style={styles.swiftUISidebar}
              />
            </View>
          </Fragment>
        ) : (
        <Fragment>
          <Reanimated.View
            accessibilityElementsHidden={!state.mobileOpen}
            importantForAccessibility={
              state.mobileOpen ? 'yes' : 'no-hide-descendants'
            }
            pointerEvents={state.mobileOpen ? 'auto' : 'none'}
            style={[
              styles.overlay,
              {
                backgroundColor: SHELL_METRICS.overlayColor,
                left: drawerExtent,
              },
              overlayStyle,
            ]}
          >
            <IOSPressable
              accessibilityLabel={locale === 'zh' ? '\u5173\u95ed\u5bfc\u822a' : 'Close navigation'}
              haptic="none"
              onPress={closeMobile}
              opacityTo={1}
              scaleTo={1}
              style={StyleSheet.absoluteFill}
            />
          </Reanimated.View>

          {!state.mobileOpen && !canGoBack ? (
            <GestureDetector gesture={openGesture}>
              <View
                style={[
                  styles.openEdge,
                  { top: unifiedChatActive ? insets.top : insets.top + SHELL_METRICS.headerHeight },
                ]}
              />
            </GestureDetector>
          ) : null}

          <GestureDetector gesture={closeGesture}>
            <Reanimated.View
              accessibilityElementsHidden={!state.mobileOpen}
              accessibilityViewIsModal={state.mobileOpen}
              importantForAccessibility={
                state.mobileOpen ? 'yes' : 'no-hide-descendants'
              }
              style={[
                styles.mobileSidebar,
                drawerWidthStyle,
                drawerTranslationStyle,
              ]}
            >
              <Sidebar
                borderSoft={borderSoft}
                borderStrong={borderStrong}
                closeMobile={closeMobile}
                composition={composition}
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
            </Reanimated.View>
          </GestureDetector>
        </Fragment>
        )
      ) : null}
    </View>
  );
}

function Sidebar({
  borderSoft,
  borderStrong,
  closeMobile,
  composition,
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
      <View
        style={[
          styles.sidebarHeader,
          {
            borderBottomColor: borderStrong,
            paddingHorizontal: typography.spacingUnit * 4,
          },
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

      <ScrollView
        bounces={false}
        decelerationRate="normal"
        contentContainerStyle={{
          paddingVertical: typography.spacingUnit * 2,
        }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={8}
        style={[styles.navigation, { borderTopColor: borderSoft }]}
      >
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

        {composition.pluginItems.length > 0 ? (
          <View
            style={[
              styles.pluginSection,
              {
                borderTopColor: borderSoft,
                paddingBottom: typography.spacingUnit * 2,
              },
            ]}
          >
            {!collapsed ? (
              <Text
                style={[
                  styles.sectionLabel,
                  {
                    color: tokens.colors.textTertiary,
                    fontFamily: resolveNativeFontStack(
                      tokens.typography.fontDisplay,
                      400,
                    ),
                    fontSize: typography.section.fontSize,
                    letterSpacing: typography.section.letterSpacing,
                    paddingBottom: typography.spacingUnit,
                    paddingHorizontal: typography.spacingUnit * 5,
                    paddingTop: typography.spacingUnit * 2.5,
                  },
                ]}
              >
                {locale === 'zh' ? '\u63d2\u4ef6' : 'Plugins'}
              </Text>
            ) : null}
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
          </View>
        ) : null}
      </ScrollView>

      {slots?.system?.(slotContext)}
      {slots?.controls?.(slotContext)}
      {!collapsed ? slots?.auth?.(slotContext) : null}
      {!collapsed ? slots?.footer?.(slotContext) : null}
    </View>
  );
}

function ExpoReferenceSidebar({
  activePath,
  insets,
  locale,
  navigate,
}: {
  activePath: string;
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
          backgroundColor: opaque(tokens.colors.background),
          paddingBottom: insets.bottom,
          paddingTop: insets.top,
        },
      ]}
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

      <ScrollView
        contentContainerStyle={styles.referenceSidebarContent}
        decelerationRate="normal"
        scrollEventThrottle={8}
        showsVerticalScrollIndicator
        style={styles.referenceSidebarScroll}
      >
        {REFERENCE_SIDEBAR_GROUPS.map((group) => (
          <View key={group.labels.en} style={styles.referenceSidebarSection}>
            <Text
              style={[
                styles.referenceSidebarSectionLabel,
                { color: tokens.colors.textTertiary },
              ]}
            >
              {group.labels[locale]}
            </Text>
            <View
              style={[
                styles.referenceSidebarGroup,
                { backgroundColor: tokens.colors.card },
              ]}
            >
              {group.routes.map((route, index) => {
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
                      index < group.routes.length - 1
                        ? {
                            borderBottomColor: tokens.colors.border,
                            borderBottomWidth: StyleSheet.hairlineWidth,
                          }
                        : null,
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
          </View>
        ))}
      </ScrollView>

      <View
        style={styles.referenceSidebarFooter}
      >
        <View
          style={[
            styles.referenceSidebarStatusDot,
            { backgroundColor: tokens.colors.success },
          ]}
        />
        <View style={styles.referenceSidebarStatusCopy}>
          <Text
            style={[
              styles.referenceSidebarStatusTitle,
              { color: tokens.colors.foreground },
            ]}
          >
            {locale === 'zh' ? '网关在线' : 'Gateway online'}
          </Text>
          <Text
            style={[
              styles.referenceSidebarStatusMeta,
              { color: tokens.colors.textSecondary },
            ]}
          >
            {locale === 'zh' ? 'v0.9.3 · 2 个会话' : 'v0.9.3 · 2 sessions'}
          </Text>
        </View>
      </View>
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
  const visibleHeight = typography.nav.visibleHeight;
  const hitSlopVertical = Math.max(0, (44 - visibleHeight) / 2);
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 400);

  return (
    <IOSPressable
      accessibilityLabel={collapsed ? item.label : undefined}
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      hitSlop={{
        top: hitSlopVertical,
        right: 0,
        bottom: hitSlopVertical,
        left: 0,
      }}
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
  swiftUIDrawerHost: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
  },
  swiftUISidebar: {
    flex: 1,
  },
  mobileSidebar: {
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    top: 0,
    zIndex: 50,
  },
  sidebar: {
    borderRightWidth: SHELL_METRICS.borderWidth,
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  sidebarHeader: {
    alignItems: 'center',
    borderBottomWidth: SHELL_METRICS.borderWidth,
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
    paddingHorizontal: 16,
  },
  referenceSidebarSection: {
    marginBottom: 24,
  },
  referenceSidebarSectionLabel: {
    fontFamily: 'Collapse-Regular',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 7,
    paddingHorizontal: 16,
  },
  referenceSidebarGroup: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  referenceSidebarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
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
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 10,
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
    borderTopWidth: SHELL_METRICS.borderWidth,
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  navItem: {
    alignItems: 'center',
    flexDirection: 'row',
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
  pluginSection: {
    borderTopWidth: SHELL_METRICS.borderWidth,
  },
  sectionLabel: {},
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  openEdge: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    width: 24,
    zIndex: 45,
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
