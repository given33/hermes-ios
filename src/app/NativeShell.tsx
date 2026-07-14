import {
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
  Pressable,
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
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedTintedIcon } from '../components/ui/AnimatedTintedIcon';
import { NativeButton } from '../components/ui/NativeButton';
import {
  CONTROL_METRICS,
  multiplyAlpha,
  opaque,
} from '../design/control-contracts';
import { resolveNativeFontStack } from '../design/native-font-faces';
import { useTheme } from '../design/ThemeProvider';
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

const WEB_TRANSITION_EASING = Easing.bezier(
  ...SHELL_METRICS.transitionEasing,
);
const COLOR_TRANSITION_EASING = Easing.bezier(
  ...CONTROL_METRICS.tailwind.transitionEasing,
);

export interface NativeShellSlotContext {
  collapsed: boolean;
  compact: boolean;
  activePath: string;
  navigate(path: string): void;
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
  renderRoute?(route: ComposedRoute, label: string): ReactNode;
  slots?: NativeShellSlots;
}

export function NativeShell({
  config,
  initialPath = '/sessions',
  locale = 'zh',
  manifests = [],
  renderRoute,
  slots,
}: NativeShellProps) {
  const insets = useSafeAreaInsets();
  const layout = useAdaptiveLayout();
  const { tokens } = useTheme();
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
  const drawerExtent = SHELL_METRICS.sidebarWidth + insets.left;
  const visibleSidebarWidth = resolveVisibleSidebarWidth(state) + insets.left;
  const initialDrawerTranslation = resolveMobileDrawerTranslation(state) < 0
    ? -drawerExtent
    : 0;
  const sidebarWidth = useSharedValue(visibleSidebarWidth);
  const drawerTranslation = useSharedValue(initialDrawerTranslation);
  const typography = resolveShellTypography(tokens);
  const rootBackground = opaque(tokens.colors.background);
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
      duration: SHELL_METRICS.desktopWidthDurationMs,
      easing: WEB_TRANSITION_EASING,
    });
  }, [sidebarWidth, state.collapsed, state.mode, visibleSidebarWidth]);

  useEffect(() => {
    const target = resolveMobileDrawerTranslation(state) < 0
      ? -drawerExtent
      : 0;
    drawerTranslation.value = withTiming(target, {
      duration: SHELL_METRICS.mobileDrawerDurationMs,
      easing: WEB_TRANSITION_EASING,
    });
  }, [drawerExtent, drawerTranslation, state.mobileOpen, state.mode]);

  const openMobile = useCallback(() => dispatch({ type: 'open-mobile' }), []);
  const closeMobile = useCallback(() => dispatch({ type: 'close-mobile' }), []);
  const navigate = useCallback(
    (path: string) => dispatch({
      type: 'navigate',
      path: resolveNativeShellPath(composition.routes, path),
    }),
    [composition.routes],
  );
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
          drawerTranslation.value = withTiming(-drawerExtent, {
            duration: SHELL_METRICS.mobileDrawerDurationMs,
            easing: WEB_TRANSITION_EASING,
          });
          return;
        }
        if (event.translationX > drawerExtent * 0.25) {
          runOnJS(openMobile)();
        } else {
          drawerTranslation.value = withTiming(-drawerExtent, {
            duration: SHELL_METRICS.mobileDrawerDurationMs,
            easing: WEB_TRANSITION_EASING,
          });
        }
      }),
    [drawerExtent, drawerTranslation, openMobile],
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
          drawerTranslation.value = withTiming(0, {
            duration: SHELL_METRICS.mobileDrawerDurationMs,
            easing: WEB_TRANSITION_EASING,
          });
          return;
        }
        if (event.translationX < -drawerExtent * 0.25) {
          runOnJS(closeMobile)();
        } else {
          drawerTranslation.value = withTiming(0, {
            duration: SHELL_METRICS.mobileDrawerDurationMs,
            easing: WEB_TRANSITION_EASING,
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
  };

  return (
    <View style={[styles.root, { backgroundColor: rootBackground }]}>
      {state.mode === 'compact' ? (
        <MobileHeader
          borderColor={borderStrong}
          hidden={state.mobileOpen}
          locale={locale}
          onOpen={openMobile}
          safeLeft={insets.left}
          safeRight={insets.right}
          safeTop={insets.top}
          typography={typography}
        />
      ) : null}

      <View
        style={[
          styles.body,
          state.mode === 'compact' && { paddingTop: insets.top + SHELL_METRICS.headerHeight },
        ]}
      >
        {state.mode === 'split' ? (
          <Reanimated.View style={[styles.splitSidebar, drawerWidthStyle]}>
            <Sidebar
              borderSoft={borderSoft}
              borderStrong={borderStrong}
              closeMobile={closeMobile}
              composition={composition}
              insets={insets}
              locale={locale}
              navigate={navigate}
              onToggleCollapsed={toggleCollapsed}
              rootBackground={rootBackground}
              slotContext={slotContext}
              slots={slots}
              state={state}
              typography={typography}
            />
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
            state.mode === 'compact'
              ? {
                  paddingBottom: insets.bottom,
                  paddingLeft: insets.left,
                  paddingRight: insets.right,
                }
              : {
                  paddingBottom: insets.bottom,
                  paddingRight: insets.right,
                  paddingTop: insets.top,
                },
          ]}
        >
          {activeRoute
            ? renderRoute?.(activeRoute, activeLabel)
              ?? <RoutePreview label={activeLabel} />
            : null}
        </View>
      </View>

      {state.mode === 'compact' ? (
        <Fragment>
          <Reanimated.View
            accessibilityElementsHidden={!state.mobileOpen}
            importantForAccessibility={
              state.mobileOpen ? 'yes' : 'no-hide-descendants'
            }
            pointerEvents={state.mobileOpen ? 'auto' : 'none'}
            style={[styles.overlay, { backgroundColor: SHELL_METRICS.overlayColor }, overlayStyle]}
          >
            <Pressable
              accessibilityLabel={locale === 'zh' ? '\u5173\u95ed\u5bfc\u822a' : 'Close navigation'}
              onPress={closeMobile}
              style={StyleSheet.absoluteFill}
            />
          </Reanimated.View>

          {!state.mobileOpen ? (
            <GestureDetector gesture={openGesture}>
              <View
                style={[
                  styles.openEdge,
                  { top: insets.top + SHELL_METRICS.headerHeight },
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
                navigate={navigate}
                onToggleCollapsed={toggleCollapsed}
                rootBackground={rootBackground}
                slotContext={slotContext}
                slots={slots}
                state={state}
                typography={typography}
              />
            </Reanimated.View>
          </GestureDetector>
        </Fragment>
      ) : null}
    </View>
  );
}

function MobileHeader({
  borderColor,
  hidden,
  locale,
  onOpen,
  safeLeft,
  safeRight,
  safeTop,
  typography,
}: {
  borderColor: string;
  hidden: boolean;
  locale: NativeRouteLocale;
  onOpen(): void;
  safeLeft: number;
  safeRight: number;
  safeTop: number;
  typography: ReturnType<typeof resolveShellTypography>;
}) {
  const { tokens } = useTheme();
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 700);
  return (
    <View
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={[
        styles.mobileHeader,
        {
          backgroundColor: opaque(tokens.colors.background),
          borderBottomColor: borderColor,
          gap: typography.spacingUnit * 2,
          height: safeTop + SHELL_METRICS.headerHeight,
          paddingBottom: typography.spacingUnit * 2,
          paddingLeft: safeLeft + typography.spacingUnit * 4,
          paddingRight: safeRight + typography.spacingUnit * 4,
          paddingTop: safeTop,
        },
      ]}
    >
      <NativeButton
        accessibilityLabel={locale === 'zh' ? '\u6253\u5f00\u5bfc\u822a' : 'Open navigation'}
        ghost
        onPress={onOpen}
        size="icon"
      >
        <Menu />
      </NativeButton>
      <Text
        style={[
          styles.mobileBrand,
          {
            color: tokens.colors.foreground,
            fontFamily: displayFont,
            fontSize: typography.mobileBrand.fontSize,
            fontWeight: displayFont ? undefined : '700',
            lineHeight: typography.mobileBrand.lineHeight,
          },
        ]}
      >
        Hermes Agent
      </Text>
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
  rootBackground,
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
  rootBackground: string;
  slotContext: NativeShellSlotContext;
  slots?: NativeShellSlots;
  state: ReturnType<typeof createNativeShellState>;
  typography: ReturnType<typeof resolveShellTypography>;
}) {
  const { tokens } = useTheme();
  const collapsed = state.mode === 'split' && state.collapsed;
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 700);
  return (
    <View
      accessibilityLabel="Hermes navigation"
      style={[
        styles.sidebar,
        {
          backgroundColor: rootBackground,
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
        contentContainerStyle={{
          paddingVertical: typography.spacingUnit * 2,
        }}
        showsVerticalScrollIndicator={false}
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
      duration: CONTROL_METRICS.tailwind.transitionDurationMs,
      easing: COLOR_TRANSITION_EASING,
    });
  }, [color, targetColor]);

  useEffect(() => {
    hoverOpacity.value = withTiming(
      hovered || pressed ? SHELL_METRICS.hoverLayerOpacity : 0,
      {
        duration: SHELL_METRICS.hoverOpacityDurationMs,
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
        duration: SHELL_METRICS.labelOpacityDurationMs,
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
    <Pressable
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
    </Pressable>
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
  mobileHeader: {
    alignItems: 'center',
    borderBottomWidth: SHELL_METRICS.borderWidth,
    flexDirection: 'row',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 40,
  },
  mobileBrand: {},
  splitSidebar: {
    flexShrink: 0,
    height: '100%',
    overflow: 'hidden',
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
