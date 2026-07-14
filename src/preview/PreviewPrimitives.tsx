import { HermesLiveBlurView } from '../../modules/hermes-live-blur';
import {
  hasNativeSearchBar,
  hasNativeSelection,
  HermesSearchBarView,
  HermesSelectionView,
} from '../../modules/hermes-ios-controls';
import {
  BottomSheet as SwiftUIBottomSheet,
  Host as SwiftUIHost,
  LinearProgress as SwiftUILinearProgress,
  Picker as SwiftUIPicker,
  Switch as SwiftUISwitch,
} from '@expo/ui/swift-ui';
import { disabled as swiftUIDisabled } from '@expo/ui/swift-ui/modifiers';
import {
  Check,
  ChevronRight,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import {
  Modal,
  Platform,
  PlatformColor,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Reanimated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs,
  Line,
  Pattern,
  Polyline,
  Rect,
} from 'react-native-svg';

import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { IOSPressable } from '../components/ios/IOSPressable';
import {
  CONTROL_METRICS,
  multiplyAlpha,
  opaque,
} from '../design/control-contracts';
import { resolveNativeFontStack } from '../design/native-font-faces';
import { useTheme } from '../design/ThemeProvider';
import { IOS_MOTION } from '../design/ios-motion';
import { useNativeLocalization } from '../i18n/NativeLocalization';

export function PreviewPage({
  actions,
  children,
  eyebrow,
  subtitle,
  title,
}: PropsWithChildren<{
  actions?: ReactNode;
  eyebrow?: string;
  subtitle?: string;
  title: string;
}>) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  const spacing = 4 * tokens.layout.spacingMultiplier;
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 700);
  const bodyFont = resolveNativeFontStack(tokens.typography.fontSans, 400);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.pageContent,
        {
          gap: spacing * 5,
          padding: width < 620 ? spacing * 4 : spacing * 6,
          paddingBottom: (width < 620 ? spacing * 4 : spacing * 6) + insets.bottom,
        },
      ]}
      decelerationRate="normal"
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={8}
      showsVerticalScrollIndicator={false}
      style={styles.page}
    >
      <View
        style={[
          styles.pageHeader,
          { gap: spacing * 3 },
          width < 620 && styles.pageHeaderCompact,
        ]}
      >
        <View style={[styles.pageHeadingCopy, { gap: spacing }]}> 
          {eyebrow ? (
            <Text
              style={{
                color: tokens.colors.textTertiary,
                fontFamily: displayFont,
                fontSize: rootSize * 0.72,
                letterSpacing: rootSize * 0.08,
                lineHeight: rootSize,
                textTransform: 'uppercase',
              }}
            >
              {t(eyebrow)}
            </Text>
          ) : null}
          <Text
            accessibilityRole="header"
            style={{
              color: tokens.colors.foreground,
              fontFamily: displayFont,
              fontSize: rootSize * 1.18,
              fontWeight: displayFont ? undefined : '700',
              letterSpacing: rootSize * 0.04,
              lineHeight: rootSize * 1.45,
            }}
          >
            {t(title)}
          </Text>
          {subtitle ? (
            <Text
              style={{
                color: tokens.colors.textSecondary,
                fontFamily: bodyFont,
                fontSize: rootSize * 0.88,
                lineHeight: rootSize * 1.35,
              }}
            >
              {t(subtitle)}
            </Text>
          ) : null}
        </View>
        {actions ? (
          <View style={[styles.pageActions, width < 620 && styles.pageActionsCompact]}>
            {actions}
          </View>
        ) : null}
      </View>
      {children}
    </ScrollView>
  );
}

export function PreviewCard({
  action,
  children,
  style,
  subtitle,
  title,
}: PropsWithChildren<{
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
  subtitle?: string;
  title?: string;
}>) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  const spacing = 4 * tokens.layout.spacingMultiplier;
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 600);
  const bodyFont = resolveNativeFontStack(tokens.typography.fontSans, 400);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.colors.card,
          borderColor: tokens.colors.border,
          borderRadius: parseRadius(tokens.layout.radius),
        },
        style,
      ]}
    >
      {title || subtitle || action ? (
        <View
          style={[
            styles.cardHeader,
            {
              borderBottomColor: tokens.colors.border,
              gap: spacing * 3,
              padding: spacing * 4,
            },
          ]}
        >
          <View style={[styles.cardHeading, { gap: spacing * 0.75 }]}> 
            {title ? (
              <Text
                style={{
                  color: tokens.colors.cardForeground,
                  fontFamily: displayFont,
                  fontSize: rootSize * 0.92,
                  fontWeight: displayFont ? undefined : '600',
                  lineHeight: rootSize * 1.3,
                }}
              >
                {t(title)}
              </Text>
            ) : null}
            {subtitle ? (
              <Text
                style={{
                  color: tokens.colors.textSecondary,
                  fontFamily: bodyFont,
                  fontSize: rootSize * 0.78,
                  lineHeight: rootSize * 1.18,
                }}
              >
                {t(subtitle)}
              </Text>
            ) : null}
          </View>
          {action}
        </View>
      ) : null}
      <View style={[styles.cardContent, { gap: spacing * 3, padding: spacing * 4 }]}> 
        {children}
      </View>
    </View>
  );
}

export function PreviewGrid({
  children,
  minItemWidth = 220,
}: PropsWithChildren<{ minItemWidth?: number }>) {
  return (
    <View style={styles.grid}>
      {Children.map(children, (child) => (
        <View style={{ flex: 1, minWidth: minItemWidth }}>{child}</View>
      ))}
    </View>
  );
}

export function PreviewText({
  children,
  color,
  numberOfLines,
  style,
  variant = 'body',
}: PropsWithChildren<{
  color?: string;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  variant?: 'body' | 'muted' | 'mono' | 'heading' | 'label' | 'tiny';
}>) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  const mono = variant === 'mono';
  const display = variant === 'heading' || variant === 'label';
  const fontSize = variant === 'heading'
    ? rootSize
    : variant === 'label' || variant === 'tiny'
      ? rootSize * 0.7
      : variant === 'muted'
        ? rootSize * 0.76
        : rootSize * 0.84;
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          color: color ?? (variant === 'muted' || variant === 'tiny'
            ? tokens.colors.textSecondary
            : tokens.colors.foreground),
          fontFamily: resolveNativeFontStack(
            mono
              ? tokens.typography.fontMono
              : display
                ? tokens.typography.fontDisplay
                : tokens.typography.fontSans,
            display ? 600 : 400,
          ),
          fontSize,
          letterSpacing: variant === 'label' ? rootSize * 0.06 : 0,
          lineHeight: fontSize * 1.45,
          textTransform: variant === 'label' ? 'uppercase' : 'none',
        },
        style,
      ]}
    >
      {Children.map(children, (child) => (
        typeof child === 'string' ? t(child) : child
      ))}
    </Text>
  );
}

export function PreviewDivider() {
  const { tokens } = useTheme();
  return <View style={{ backgroundColor: tokens.colors.border, height: 1 }} />;
}

export function PreviewRow({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.inlineRow, style]}>{children}</View>;
}

export type BadgeTone =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'outline';

export function PreviewBadge({
  children,
  tone = 'default',
}: PropsWithChildren<{ tone?: BadgeTone }>) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const color = tone === 'success'
    ? tokens.colors.success
    : tone === 'warning'
      ? tokens.colors.warning
      : tone === 'danger'
        ? tokens.colors.destructive
        : tokens.colors.foreground;
  const background = tone === 'outline'
    ? 'transparent'
    : multiplyAlpha(color, 0.1);
  const font = resolveNativeFontStack(tokens.typography.fontMono, 500);
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: background,
          borderColor: multiplyAlpha(color, tone === 'outline' ? 0.4 : 0.25),
        },
      ]}
    >
      <Text
        style={{
          color,
          fontFamily: font,
          fontSize: rootSize * 0.68,
          lineHeight: rootSize,
        }}
      >
        {Children.map(children, (child) => (
          typeof child === 'string' ? t(child) : child
        ))}
      </Text>
      {tone !== 'outline' ? <Grain color={color} /> : null}
    </View>
  );
}

function Grain({ color }: { color: string }) {
  return (
    <Svg height="100%" pointerEvents="none" style={StyleSheet.absoluteFill} width="100%">
      <Defs>
        <Pattern height="2" id="badge-grain" patternUnits="userSpaceOnUse" width="2">
          <Rect fill={color} height="1" opacity={0.12} width="1" x="0" y="0" />
          <Rect fill={color} height="1" opacity={0.12} width="1" x="1" y="1" />
        </Pattern>
      </Defs>
      <Rect fill="url(#badge-grain)" height="100%" width="100%" />
    </Svg>
  );
}

export function PreviewMetric({
  accent,
  hint,
  icon: Icon,
  label,
  value,
}: {
  accent?: string;
  hint?: string;
  icon?: LucideIcon;
  label: string;
  value: string;
}) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  const display = resolveNativeFontStack(tokens.typography.fontDisplay, 600);
  const mono = resolveNativeFontStack(tokens.typography.fontMono, 600);
  const color = accent ?? tokens.colors.foreground;

  return (
    <PreviewCard>
      <View style={styles.metricTop}>
        <Text
          style={{
            color: tokens.colors.textSecondary,
            fontFamily: display,
            fontSize: rootSize * 0.72,
            lineHeight: rootSize,
            textTransform: 'uppercase',
          }}
        >
          {t(label)}
        </Text>
        {Icon ? <Icon color={color} size={16} strokeWidth={1.75} /> : null}
      </View>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={{
          color,
          fontFamily: mono,
          fontSize: rootSize * 1.55,
          lineHeight: rootSize * 1.9,
        }}
      >
        {t(value)}
      </Text>
      {hint ? (
        <Text
          style={{
            color: tokens.colors.textTertiary,
            fontFamily: resolveNativeFontStack(tokens.typography.fontSans, 400),
            fontSize: rootSize * 0.72,
            lineHeight: rootSize,
          }}
        >
          {t(hint)}
        </Text>
      ) : null}
    </PreviewCard>
  );
}

export function PreviewToggle({
  accessibilityLabel,
  disabled = false,
  onChange,
  value,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  onChange(value: boolean): void;
  value: boolean;
}) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    progress.value = withSpring(value ? 1 : 0, {
      damping: IOS_MOTION.spring.damping,
      mass: 0.72,
      stiffness: IOS_MOTION.spring.stiffness,
    });
  }, [progress, value]);
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [tokens.colors.muted, tokens.colors.primary],
    ),
  }));
  const thumb = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [tokens.colors.textTertiary, tokens.colors.primaryForeground],
    ),
    transform: [{ translateX: progress.value * 16 }],
  }));
  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost style={styles.nativeSwitch}>
        <SwiftUISwitch
          color={tokens.colors.primary}
          label={t(accessibilityLabel)}
          modifiers={[swiftUIDisabled(disabled)]}
          onValueChange={onChange}
          value={value}
        />
      </SwiftUIHost>
    );
  }
  return (
    <IOSPressable
      accessibilityLabel={t(accessibilityLabel)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={8}
      haptic="selection"
      onPress={() => onChange(!value)}
      opacityTo={0.86}
      scaleTo={0.94}
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <Reanimated.View style={[styles.switchTrack, track]}>
        <Reanimated.View style={[styles.switchThumb, thumb]} />
      </Reanimated.View>
    </IOSPressable>
  );
}

export function PreviewSettingRow({
  detail,
  label,
  onPress,
  trailing,
}: {
  detail?: string;
  label: string;
  onPress?: () => void;
  trailing?: ReactNode;
}) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const body = resolveNativeFontStack(tokens.typography.fontSans, 500);
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  const content = (
    <Fragment>
      <View style={styles.settingCopy}>
        <Text
          style={{
            color: tokens.colors.foreground,
            fontFamily: body,
            fontSize: rootSize * 0.86,
            lineHeight: rootSize * 1.25,
          }}
        >
          {t(label)}
        </Text>
        {detail ? (
          <Text
            style={{
              color: tokens.colors.textSecondary,
              fontFamily: resolveNativeFontStack(tokens.typography.fontSans, 400),
              fontSize: rootSize * 0.74,
              lineHeight: rootSize * 1.12,
            }}
          >
            {t(detail)}
          </Text>
        ) : null}
      </View>
      {trailing ?? (onPress ? (
        <ChevronRight color={tokens.colors.textTertiary} size={16} />
      ) : null)}
    </Fragment>
  );
  if (!onPress) return <View style={styles.settingRow}>{content}</View>;
  return (
    <IOSPressable
      onPress={onPress}
      pressedStyle={{ backgroundColor: tokens.colors.muted }}
      style={styles.settingRow}
    >
      {content}
    </IOSPressable>
  );
}

export function PreviewProgress({
  color,
  value,
}: {
  color?: string;
  value: number;
}) {
  const { tokens } = useTheme();
  const progress = Math.max(0, Math.min(100, value)) / 100;
  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost style={styles.nativeProgress}>
        <SwiftUILinearProgress
          color={color ?? tokens.colors.primary}
          progress={progress}
        />
      </SwiftUIHost>
    );
  }
  return (
    <View style={[styles.progressTrack, { backgroundColor: tokens.colors.muted }]}> 
      <View
        style={[
          styles.progressFill,
          {
            backgroundColor: color ?? tokens.colors.primary,
            width: `${progress * 100}%`,
          },
        ]}
      />
    </View>
  );
}

export function PreviewSegmented<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange(value: T): void;
  options: readonly { label: string; value: T }[];
  value: T;
}) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const font = resolveNativeFontStack(tokens.typography.fontSans, 500);
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost
        style={[
          styles.nativeSegmented,
          { width: Math.max(128, options.length * 78) },
        ]}
      >
        <SwiftUIPicker
          color={tokens.colors.primary}
          onOptionSelected={(event) => {
          const selected = options[event.nativeEvent.index];
          if (selected) onChange(selected.value);
          }}
          options={options.map((option) => t(option.label))}
          selectedIndex={selectedIndex}
          variant="segmented"
        />
      </SwiftUIHost>
    );
  }
  return (
    <View style={[styles.segmented, { borderColor: tokens.colors.border }]}> 
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <IOSPressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            haptic="selection"
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              selected && { backgroundColor: tokens.colors.primary },
            ]}
          >
            <Text
              numberOfLines={1}
              style={{
                color: selected
                  ? tokens.colors.primaryForeground
                  : tokens.colors.textSecondary,
                fontFamily: font,
                fontSize: rootSize * 0.72,
                lineHeight: rootSize,
              }}
            >
              {t(option.label)}
            </Text>
          </IOSPressable>
        );
      })}
    </View>
  );
}

export function PreviewSearch({
  onChangeText,
  placeholder,
  value,
}: {
  onChangeText(value: string): void;
  placeholder: string;
  value: string;
}) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  const font = resolveNativeFontStack(tokens.typography.fontMono, 400);
  if (Platform.OS === 'ios' && hasNativeSearchBar) {
    return (
      <HermesSearchBarView
        backgroundColorValue={multiplyAlpha(tokens.colors.foreground, 0.08)}
        fontName={font}
        fontSize={rootSize * 0.8}
        onChangeText={(event) => onChangeText(event.nativeEvent.value)}
        placeholder={t(placeholder)}
        placeholderColor={tokens.colors.textTertiary}
        style={styles.nativeSearch}
        textColor={tokens.colors.foreground}
        tintColor={tokens.colors.primary}
        value={value}
      />
    );
  }
  return (
    <View style={styles.searchWrap}>
      <NativeInput
        clearButtonMode="while-editing"
        onChangeText={onChangeText}
        placeholder={placeholder}
        returnKeyType="search"
        style={styles.searchInput}
        value={value}
      />
    </View>
  );
}

export function PreviewDataRow({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: ReactNode;
}) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  return (
    <View style={[styles.dataRow, { borderBottomColor: tokens.colors.border }]}> 
      <Text
        style={{
          color: tokens.colors.textSecondary,
          flex: 1,
          fontFamily: resolveNativeFontStack(tokens.typography.fontSans, 400),
          fontSize: rootSize * 0.78,
          lineHeight: rootSize * 1.15,
        }}
      >
        {t(label)}
      </Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text
          style={{
            color: tokens.colors.foreground,
            flexShrink: 1,
            fontFamily: resolveNativeFontStack(
              mono ? tokens.typography.fontMono : tokens.typography.fontSans,
              500,
            ),
            fontSize: rootSize * 0.78,
            lineHeight: rootSize * 1.15,
            textAlign: 'right',
          }}
        >
          {typeof value === 'string' ? t(value) : value}
        </Text>
      ) : value}
    </View>
  );
}

export function PreviewLineChart({
  height = 180,
  points,
}: {
  height?: number;
  points: readonly number[];
}) {
  const { tokens } = useTheme();
  const width = 640;
  const inset = 16;
  const max = Math.max(...points, 1);
  const step = (width - inset * 2) / Math.max(1, points.length - 1);
  const coordinates = points.map((point, index) => (
    `${inset + index * step},${height - inset - (point / max) * (height - inset * 2)}`
  )).join(' ');
  return (
    <View style={{ height, overflow: 'hidden' }}>
      <Svg height={height} preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`} width="100%">
        {[0.25, 0.5, 0.75].map((position) => (
          <Line
            key={position}
            stroke={tokens.colors.border}
            strokeWidth="1"
            x1="0"
            x2={width}
            y1={height * position}
            y2={height * position}
          />
        ))}
        <Polyline
          fill="none"
          points={coordinates}
          stroke={tokens.series.inputTokenAccent}
          strokeLinecap="square"
          strokeLinejoin="miter"
          strokeWidth="3"
        />
      </Svg>
    </View>
  );
}

export function PreviewBarChart({
  values,
}: {
  values: readonly { label: string; value: number }[];
}) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const max = Math.max(...values.map((item) => item.value), 1);
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  return (
    <View style={styles.barChart}>
      {values.map((item, index) => (
        <View key={item.label} style={styles.barColumn}>
          <View
            style={[
              styles.bar,
              {
                backgroundColor: index % 2
                  ? tokens.series.outputTokenAccent
                  : tokens.series.inputTokenAccent,
                height: 112 * (item.value / max),
              },
            ]}
          />
          <Text
            numberOfLines={1}
            style={{
              color: tokens.colors.textTertiary,
              fontFamily: resolveNativeFontStack(tokens.typography.fontMono, 400),
              fontSize: rootSize * 0.62,
              lineHeight: rootSize,
            }}
          >
            {t(item.label)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function PreviewModal({
  children,
  onClose,
  open,
  title,
}: PropsWithChildren<{
  onClose(): void;
  open: boolean;
  title: string;
}>) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const display = resolveNativeFontStack(tokens.typography.fontDisplay, 700);
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  const iosSheet = Platform.OS === 'ios';
  const panel = (
    <View
      accessibilityViewIsModal
      style={[
        styles.modalPanel,
        iosSheet && styles.modalSheetPanel,
        {
          backgroundColor: opaque(tokens.colors.background),
          borderColor: tokens.colors.border,
        },
        iosSheet ? {
          height: Math.min(height * 0.82, 760),
          width,
        } : {
          maxHeight: height - 64,
          width: Math.min(560, width - 32),
        },
      ]}
    >
      <View style={[styles.modalHeader, { borderBottomColor: tokens.colors.border }]}>
        <Text
          accessibilityRole="header"
          style={{
            color: tokens.colors.foreground,
            fontFamily: display,
            fontSize: rootSize,
            lineHeight: rootSize * 1.35,
          }}
        >
          {t(title)}
        </Text>
        <NativeButton accessibilityLabel="Close" ghost onPress={onClose} size="icon">
          <X />
        </NativeButton>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.modalContent,
          iosSheet && { paddingBottom: 16 + insets.bottom },
        ]}
        decelerationRate="normal"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={8}
      >
        {children}
      </ScrollView>
    </View>
  );

  if (iosSheet) {
    return (
      <SwiftUIHost style={styles.swiftUISheetHost}>
        <SwiftUIBottomSheet
          isOpened={open}
          onIsOpenedChange={(isOpened) => {
            if (!isOpened && open) onClose();
          }}
          presentationDetents={['medium', 'large']}
          presentationDragIndicator="visible"
        >
          {panel}
        </SwiftUIBottomSheet>
      </SwiftUIHost>
    );
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={open}
    >
      <View
        style={styles.modalRoot}
      >
        <HermesLiveBlurView blurRadius={4} style={StyleSheet.absoluteFill} />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0, 0, 0, 0.7)' },
          ]}
        />
        <IOSPressable
          haptic="none"
          onPress={onClose}
          opacityTo={1}
          scaleTo={1}
          style={StyleSheet.absoluteFill}
        />
        {panel}
      </View>
    </Modal>
  );
}

export function PreviewChoice({
  description,
  label,
  onPress,
  selected,
  swatches,
}: {
  description?: string;
  label: string;
  onPress(): void;
  selected: boolean;
  swatches?: readonly string[];
}) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  const content = (
    <>
      {swatches ? (
        <View style={styles.swatches}>
          {swatches.map((color, index) => (
            <View
              key={`${color}-${index}`}
              style={[styles.swatch, { backgroundColor: color }]}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.choiceCopy}>
        <Text
          style={{
            color: tokens.colors.foreground,
            fontFamily: resolveNativeFontStack(tokens.typography.fontSans, 500),
            fontSize: rootSize * 0.82,
            lineHeight: rootSize * 1.2,
          }}
        >
          {t(label)}
        </Text>
        {description ? (
          <Text
            style={{
              color: tokens.colors.textSecondary,
              fontFamily: resolveNativeFontStack(tokens.typography.fontSans, 400),
              fontSize: rootSize * 0.7,
              lineHeight: rootSize,
            }}
          >
            {t(description)}
          </Text>
        ) : null}
      </View>
    </>
  );
  return (
    <IOSPressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      haptic="selection"
      onPress={onPress}
      style={styles.choicePressable}
    >
      {Platform.OS === 'ios' && hasNativeSelection ? (
        <HermesSelectionView
          borderWidth={1}
          checkmarkBackgroundColor={tokens.colors.primary}
          checkmarkTintColor={tokens.colors.primaryForeground}
          cornerRadius={0}
          selected={selected}
          selectedBackgroundColor={tokens.colors.muted}
          selectedBorderColor={tokens.colors.primary}
          style={styles.choice}
          unselectedBackgroundColor="transparent"
          unselectedBorderColor={tokens.colors.border}
        >
          {content}
        </HermesSelectionView>
      ) : (
        <View
          style={[
            styles.choice,
            {
              backgroundColor: selected ? tokens.colors.muted : 'transparent',
              borderColor: selected ? tokens.colors.primary : tokens.colors.border,
            },
          ]}
        >
          {content}
          <View
            style={[
              styles.choiceCheck,
              {
                backgroundColor: selected ? tokens.colors.primary : 'transparent',
                borderColor: selected ? tokens.colors.primary : tokens.colors.border,
              },
            ]}
          >
            {selected ? (
              <Check color={tokens.colors.primaryForeground} size={12} strokeWidth={3} />
            ) : null}
          </View>
        </View>
      )}
    </IOSPressable>
  );
}

export function PreviewEmpty({
  detail,
  icon: Icon,
  title,
}: {
  detail: string;
  icon: LucideIcon;
  title: string;
}) {
  const { tokens } = useTheme();
  const { t } = useNativeLocalization();
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  return (
    <View style={styles.empty}>
      <Icon color={tokens.colors.textTertiary} size={30} strokeWidth={1.25} />
      <Text style={{
        color: tokens.colors.foreground,
        fontFamily: resolveNativeFontStack(tokens.typography.fontSans, 600),
        fontSize: rootSize * 0.9,
      }}>
        {t(title)}
      </Text>
      <Text style={{
        color: tokens.colors.textSecondary,
        fontFamily: resolveNativeFontStack(tokens.typography.fontSans, 400),
        fontSize: rootSize * 0.76,
        lineHeight: rootSize * 1.15,
        textAlign: 'center',
      }}>
        {t(detail)}
      </Text>
    </View>
  );
}

function parseRadius(value: string): number {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return 8;
  return value.endsWith('rem') ? number * 15 : number;
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  pageContent: {
    alignSelf: 'center',
    maxWidth: 1280,
    minHeight: '100%',
    width: '100%',
  },
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pageHeaderCompact: {
    flexDirection: 'column',
  },
  pageHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  pageActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: 8,
  },
  pageActionsCompact: {
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
    width: '100%',
  },
  card: {
    borderWidth: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  cardHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardHeading: {
    flex: 1,
    minWidth: 0,
  },
  cardContent: {
    minWidth: 0,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 22,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  metricTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  switchTrack: {
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 36,
  },
  switchThumb: {
    borderRadius: 8,
    height: 16,
    width: 16,
  },
  nativeSwitch: {
    height: 31,
    width: 51,
  },
  settingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  settingCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  progressTrack: {
    height: 6,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    height: '100%',
  },
  nativeProgress: {
    height: 6,
    width: '100%',
  },
  segmented: {
    alignItems: 'stretch',
    alignSelf: 'flex-start',
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 34,
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  nativeSegmented: {
    alignSelf: 'flex-start',
    height: 34,
  },
  searchWrap: {
    justifyContent: 'center',
    minWidth: 180,
  },
  searchInput: {
    paddingHorizontal: 10,
  },
  nativeSearch: {
    height: 38,
    minWidth: 180,
    width: '100%',
  },
  dataRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 38,
    paddingVertical: 8,
  },
  barChart: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 8,
    height: 150,
    justifyContent: 'space-around',
    paddingTop: 10,
  },
  barColumn: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
    height: '100%',
    justifyContent: 'flex-end',
    maxWidth: 72,
    minWidth: 24,
  },
  bar: {
    minHeight: 2,
    width: '70%',
  },
  modalRoot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  modalPanel: {
    borderWidth: 1,
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.35)',
    overflow: 'hidden',
  },
  modalSheetPanel: {
    borderWidth: 0,
    boxShadow: 'none',
    flex: 1,
    width: '100%',
  },
  swiftUISheetHost: {
    height: 1,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 1,
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
  },
  modalContent: {
    gap: 8,
    padding: 16,
  },
  choice: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 54,
    paddingBottom: 10,
    paddingLeft: 10,
    paddingRight: 42,
    paddingTop: 10,
  },
  choicePressable: {
    alignSelf: 'stretch',
  },
  choiceCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  choiceCheck: {
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  swatches: {
    borderRadius: 3,
    flexDirection: 'row',
    height: 28,
    overflow: 'hidden',
    width: 48,
  },
  swatch: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    minHeight: 180,
    padding: 24,
  },
});
