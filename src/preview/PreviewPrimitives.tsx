import { HermesLiveBlurView } from '../../modules/hermes-live-blur';
import {
  Check,
  ChevronRight,
  Search,
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
  Pressable,
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
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Defs,
  Line,
  Pattern,
  Polyline,
  Rect,
} from 'react-native-svg';

import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import {
  CONTROL_METRICS,
  multiplyAlpha,
  opaque,
} from '../design/control-contracts';
import { resolveNativeFontStack } from '../design/native-font-faces';
import { useTheme } from '../design/ThemeProvider';

const TRANSITION = {
  duration: CONTROL_METRICS.tailwind.transitionDurationMs,
  easing: Easing.bezier(...CONTROL_METRICS.tailwind.transitionEasing),
};

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
  const { tokens } = useTheme();
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
        },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={styles.page}
    >
      <View style={[styles.pageHeader, { gap: spacing * 3 }]}> 
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
              {eyebrow}
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
            {title}
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
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
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
                {title}
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
                {subtitle}
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
      {children}
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
        {children}
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
          {label}
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
        {value}
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
          {hint}
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
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, TRANSITION);
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
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onChange(!value)}
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <Reanimated.View style={[styles.switchTrack, track]}>
        <Reanimated.View style={[styles.switchThumb, thumb]} />
      </Reanimated.View>
    </Pressable>
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
          {label}
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
            {detail}
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
    <Pressable onPress={onPress} style={({ pressed }) => [
      styles.settingRow,
      pressed && { backgroundColor: tokens.colors.muted },
    ]}>
      {content}
    </Pressable>
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
  return (
    <View style={[styles.progressTrack, { backgroundColor: tokens.colors.muted }]}> 
      <View
        style={[
          styles.progressFill,
          {
            backgroundColor: color ?? tokens.colors.primary,
            width: `${Math.max(0, Math.min(100, value))}%`,
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
  const font = resolveNativeFontStack(tokens.typography.fontSans, 500);
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  return (
    <View style={[styles.segmented, { borderColor: tokens.colors.border }]}> 
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
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
              {option.label}
            </Text>
          </Pressable>
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
  return (
    <View style={styles.searchWrap}>
      <Search
        color={tokens.colors.textTertiary}
        pointerEvents="none"
        size={15}
        style={styles.searchIcon}
      />
      <NativeInput
        onChangeText={onChangeText}
        placeholder={placeholder}
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
        {label}
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
          {value}
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
            {item.label}
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
  const { height, width } = useWindowDimensions();
  const display = resolveNativeFontStack(tokens.typography.fontDisplay, 700);
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={open}
    >
      <View style={styles.modalRoot}>
        <HermesLiveBlurView blurRadius={4} style={StyleSheet.absoluteFill} />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0, 0, 0, 0.7)' },
          ]}
        />
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <View
          accessibilityViewIsModal
          style={[
            styles.modalPanel,
            {
              backgroundColor: opaque(tokens.colors.background),
              borderColor: tokens.colors.border,
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
              {title}
            </Text>
            <NativeButton accessibilityLabel="Close" ghost onPress={onClose} size="icon">
              <X />
            </NativeButton>
          </View>
          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
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
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? tokens.colors.muted : 'transparent',
          borderColor: selected ? tokens.colors.primary : tokens.colors.border,
        },
      ]}
    >
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
          {label}
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
            {description}
          </Text>
        ) : null}
      </View>
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
    </Pressable>
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
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  return (
    <View style={styles.empty}>
      <Icon color={tokens.colors.textTertiary} size={30} strokeWidth={1.25} />
      <Text style={{
        color: tokens.colors.foreground,
        fontFamily: resolveNativeFontStack(tokens.typography.fontSans, 600),
        fontSize: rootSize * 0.9,
      }}>
        {title}
      </Text>
      <Text style={{
        color: tokens.colors.textSecondary,
        fontFamily: resolveNativeFontStack(tokens.typography.fontSans, 400),
        fontSize: rootSize * 0.76,
        lineHeight: rootSize * 1.15,
        textAlign: 'center',
      }}>
        {detail}
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
  searchWrap: {
    justifyContent: 'center',
    minWidth: 180,
  },
  searchIcon: {
    left: 10,
    position: 'absolute',
    zIndex: 2,
  },
  searchInput: {
    paddingLeft: 32,
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
    padding: 10,
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
