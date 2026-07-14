import type { NativeThemeTokens } from './theme-types';

export const CONTROL_SOURCE_MAP = {
  button: '@nous-research/ui@0.18.2/src/ui/components/button.tsx',
  input: '@nous-research/ui@0.18.2/src/ui/components/input.tsx',
  listItem: '@nous-research/ui@0.18.2/src/ui/components/list-item.tsx',
  confirmDialog:
    '@nous-research/ui@0.18.2/src/ui/components/confirm-dialog.tsx',
  typography:
    '@nous-research/ui@0.18.2/src/ui/components/typography/index.tsx',
  arcBorder: '@nous-research/ui@0.18.2/src/ui/globals.css:.arc-border',
  webTheme: 'hermes-agent@4272ccd44:web/src/index.css',
} as const;

export const CONTROL_METRICS = {
  minimumHitTarget: 44,
  tailwind: {
    spacingRem: 0.25,
    transitionDurationMs: 150,
    transitionEasing: [0.4, 0, 0.2, 1],
  },
  button: {
    bevelWidth: 1,
    arcBorderWidth: 1.25,
    arcBorderInset: -2,
    arcBorderDurationMs: 2230,
    arcBorderOpacityDurationMs: 200,
    arcBorderAngleDegrees: 160,
    arcBorderBackgroundSizePercent: 300,
    arcBorderPositionStart: [15, 15],
    arcBorderPositionEnd: [75, 75],
    arcBorderEasing: 'linear',
    arcForegroundAlphaThreshold: 0.5,
    arcBorderStops: [
      ['transparent', 0],
      ['foreground-threshold', 0.15],
      ['midground', 0.2],
      ['background', 0.25],
      ['transparent', 0.35],
      ['transparent', 0.4],
      ['foreground-threshold', 0.55],
      ['midground', 0.6],
      ['background', 0.65],
      ['transparent', 0.75],
      ['transparent', 0.8],
      ['foreground-threshold', 0.95],
      ['midground', 1],
    ],
    prefixSuffixSpacerSpacingUnits: 5,
    prefixSuffixOffsetSpacingUnits: 3,
    prefixSuffixIconSpacingUnits: 3.5,
    sizes: {
      default: {
        fontSizeRem: 1,
        letterSpacingEm: 0.2,
        paddingBlockEm: 1.25,
        paddingInlineStartEm: 0.9,
        paddingInlineEndEm: 0.75,
      },
      icon: { iconSpacingUnits: 3.5, paddingSpacingUnits: 2 },
      sm: {
        fontSizeRem: 0.7,
        iconSpacingUnits: 3,
        letterSpacingEm: 0.15,
        paddingHorizontalSpacingUnits: 3,
        paddingVerticalSpacingUnits: 1.5,
      },
      xs: { iconSpacingUnits: 3, paddingSpacingUnits: 1 },
    },
    translation:
      'CSS inset shadows become four absolute 1pt edge layers; no drop shadow.',
  },
  input: {
    heightSpacingUnits: 9,
    borderWidth: 1,
    borderAlpha: 0.15,
    backgroundAlpha: 0.4,
    paddingHorizontalSpacingUnits: 3,
    paddingVerticalSpacingUnits: 1,
    fontSizeRem: 0.875,
    lineHeightRem: 1.25,
    placeholderAlpha: 0.5,
    focusRingWidth: 1,
    focusRingAlpha: 0.3,
    focusBorderAlpha: 0.25,
    disabledOpacity: 0.5,
  },
  listItem: {
    paddingHorizontalSpacingUnits: 3,
    paddingVerticalSpacingUnits: 2,
    gapSpacingUnits: 2,
    fontSizeRem: 0.875,
    lineHeightRem: 1.25,
    activeBackgroundAlpha: 0.1,
    pressedBackgroundAlpha: 0.05,
    focusRingWidth: 1,
    focusRingAlpha: 0.3,
  },
  confirmDialog: {
    overlayBlackAlpha: 0.6,
    backdropBlurRadius: 8,
    maxWidthRem: 28,
    viewportHorizontalInsetRem: 1,
    borderWidth: 1,
    borderAlpha: 0.15,
    headerPaddingSpacingUnits: 4,
    headerGapSpacingUnits: 3,
    contentGapSpacingUnits: 1,
    warningIconSpacingUnits: 4,
    warningIconMarginTopSpacingUnits: 0.5,
    titleFontSizeRem: 0.875,
    titleLineHeightRem: 1.25,
    titleLetterSpacingEm: 0.08,
    descriptionFontSizeRem: 0.75,
    descriptionLineHeightMultiplier: 1.625,
    footerPaddingSpacingUnits: 3,
    footerGapSpacingUnits: 2,
  },
  screenState: {
    paddingVertical: 48,
    gap: 8,
    textSize: 14,
    spinnerSize: 14,
  },
} as const;

export type NativeButtonSize = 'default' | 'icon' | 'sm' | 'xs';
export type NativeButtonInteractionEvent =
  | 'focus'
  | 'blur'
  | 'hover-in'
  | 'hover-out'
  | 'press-in'
  | 'press-out'
  | 'reset';
export type NativeButtonVisualState =
  | 'base'
  | 'hovered'
  | 'focused'
  | 'pressed'
  | 'disabled';

export interface NativeButtonInteraction {
  focused: boolean;
  hovered: boolean;
  pressed: boolean;
}

export const INITIAL_NATIVE_BUTTON_INTERACTION: NativeButtonInteraction = {
  focused: false,
  hovered: false,
  pressed: false,
};

export interface NativeButtonMetrics {
  visibleHeight: number;
  fontSize: number;
  letterSpacing: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  iconSize: number;
  prefixSuffixSpacerWidth: number;
  prefixSuffixOffset: number;
  prefixSuffixIconSize: number;
  hitSlop: { top: number; right: number; bottom: number; left: number };
}

export interface NativeInputMetrics {
  visibleHeight: number;
  paddingHorizontal: number;
  paddingVertical: number;
  fontSize: number;
  lineHeight: number;
}

export interface NativeListItemMetrics {
  paddingHorizontal: number;
  paddingVertical: number;
  gap: number;
  fontSize: number;
  lineHeight: number;
}

export interface NativeConfirmDialogMetrics {
  maxWidth: number;
  viewportHorizontalInset: number;
  headerPadding: number;
  headerGap: number;
  contentGap: number;
  warningIconSize: number;
  warningIconMarginTop: number;
  titleFontSize: number;
  titleLineHeight: number;
  titleLetterSpacing: number;
  descriptionFontSize: number;
  descriptionLineHeight: number;
  footerPadding: number;
  footerGap: number;
}

export interface NativeButtonVariant {
  destructive?: boolean;
  ghost?: boolean;
  invert?: boolean;
  outlined?: boolean;
}

export type NativeButtonVariantId =
  | 'solid-default'
  | 'solid-invert'
  | 'outlined-default'
  | 'outlined-invert'
  | 'ghost-default'
  | 'ghost-destructive'
  | 'solid-destructive'
  | 'outlined-destructive';

export interface NativeButtonBevel {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export interface NativeButtonVisual {
  id: NativeButtonVariantId;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  bevel: NativeButtonBevel | null;
  arcVisible: boolean;
  filter: NativeButtonFilter | null;
}

export type NativeButtonFilter = ReadonlyArray<
  { invert: number } | { brightness: number }
>;

export interface ArcGradientContract {
  angleDegrees: number;
  backgroundSizePercent: number;
  positionStart: readonly [number, number];
  positionEnd: readonly [number, number];
  vector: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  stops: ReadonlyArray<{ color: string; offset: number }>;
}

export interface ConfirmDialogGateState {
  generation: number;
  loading: boolean;
  open: boolean;
  resolvedGeneration: number | null;
}

export type ConfirmDialogEffect = 'cancel' | 'confirm';
export type ConfirmDialogGateEvent =
  | { type: 'sync'; open: boolean; loading: boolean }
  | { type: 'cancel' }
  | { type: 'confirm' };

export interface ConfirmDialogTransition {
  state: ConfirmDialogGateState;
  effect: ConfirmDialogEffect | null;
}

export const INITIAL_CONFIRM_DIALOG_GATE: ConfirmDialogGateState = {
  generation: 0,
  loading: false,
  open: false,
  resolvedGeneration: null,
};

interface ParsedColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const DEFAULT_BEVEL: NativeButtonBevel = {
  top: '#ffffff80',
  right: '#00000080',
  bottom: '#00000080',
  left: '#ffffff80',
};
const INVERT_BEVEL: NativeButtonBevel = {
  top: '#ffffff29',
  right: '#00000080',
  bottom: '#00000080',
  left: '#ffffff29',
};
const INVERT_OUTLINED_BEVEL: NativeButtonBevel = {
  top: '#ffffff29',
  right: '#ffffff12',
  bottom: '#ffffff12',
  left: '#ffffff29',
};

function parseBaseSize(value: string): number {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)px\s*$/.exec(value);
  return match ? Number(match[1]) : 15;
}

function tailwindSpacing(tokens: NativeThemeTokens, units: number): number {
  return parseBaseSize(tokens.typography.baseSize)
    * CONTROL_METRICS.tailwind.spacingRem
    * tokens.layout.spacingMultiplier
    * units;
}

function buttonAffixMetrics(tokens: NativeThemeTokens) {
  return {
    prefixSuffixSpacerWidth: tailwindSpacing(
      tokens,
      CONTROL_METRICS.button.prefixSuffixSpacerSpacingUnits,
    ),
    prefixSuffixOffset: tailwindSpacing(
      tokens,
      CONTROL_METRICS.button.prefixSuffixOffsetSpacingUnits,
    ),
    prefixSuffixIconSize: tailwindSpacing(
      tokens,
      CONTROL_METRICS.button.prefixSuffixIconSpacingUnits,
    ),
  };
}

function hitSlop(visibleHeight: number, visibleWidth?: number) {
  const vertical = Math.max(0, (CONTROL_METRICS.minimumHitTarget - visibleHeight) / 2);
  const horizontal = visibleWidth === undefined
    ? 0
    : Math.max(0, (CONTROL_METRICS.minimumHitTarget - visibleWidth) / 2);
  return {
    top: vertical,
    right: horizontal,
    bottom: vertical,
    left: horizontal,
  };
}

export function resolveButtonMetrics(
  tokens: NativeThemeTokens,
  size: NativeButtonSize = 'default',
): NativeButtonMetrics {
  const rootFontSize = parseBaseSize(tokens.typography.baseSize);
  const affix = buttonAffixMetrics(tokens);

  if (size === 'icon') {
    const contract = CONTROL_METRICS.button.sizes.icon;
    const iconSize = tailwindSpacing(tokens, contract.iconSpacingUnits);
    const padding = tailwindSpacing(tokens, contract.paddingSpacingUnits);
    const visibleSize = iconSize + padding * 2;
    return {
      visibleHeight: visibleSize,
      fontSize: rootFontSize,
      letterSpacing: rootFontSize * 0.2,
      paddingTop: padding,
      paddingBottom: padding,
      paddingLeft: padding,
      paddingRight: padding,
      iconSize,
      ...affix,
      hitSlop: hitSlop(visibleSize, visibleSize),
    };
  }

  if (size === 'sm') {
    const contract = CONTROL_METRICS.button.sizes.sm;
    const fontSize = rootFontSize * contract.fontSizeRem;
    const paddingHorizontal = tailwindSpacing(
      tokens,
      contract.paddingHorizontalSpacingUnits,
    );
    const paddingVertical = tailwindSpacing(
      tokens,
      contract.paddingVerticalSpacingUnits,
    );
    const visibleHeight = paddingVertical * 2;
    return {
      visibleHeight,
      fontSize,
      letterSpacing: fontSize * contract.letterSpacingEm,
      paddingTop: paddingVertical,
      paddingBottom: paddingVertical,
      paddingLeft: paddingHorizontal,
      paddingRight: paddingHorizontal,
      iconSize: tailwindSpacing(tokens, contract.iconSpacingUnits),
      ...affix,
      hitSlop: hitSlop(visibleHeight),
    };
  }

  if (size === 'xs') {
    const contract = CONTROL_METRICS.button.sizes.xs;
    const iconSize = tailwindSpacing(tokens, contract.iconSpacingUnits);
    const padding = tailwindSpacing(tokens, contract.paddingSpacingUnits);
    const visibleSize = iconSize + padding * 2;
    return {
      visibleHeight: visibleSize,
      fontSize: rootFontSize,
      letterSpacing: rootFontSize * 0.2,
      paddingTop: padding,
      paddingBottom: padding,
      paddingLeft: padding,
      paddingRight: padding,
      iconSize,
      ...affix,
      hitSlop: hitSlop(visibleSize, visibleSize),
    };
  }

  const contract = CONTROL_METRICS.button.sizes.default;
  const fontSize = rootFontSize * contract.fontSizeRem;
  const verticalPadding = fontSize * contract.paddingBlockEm;
  const visibleHeight = verticalPadding * 2;
  return {
    visibleHeight,
    fontSize,
    letterSpacing: fontSize * contract.letterSpacingEm,
    paddingTop: verticalPadding,
    paddingBottom: verticalPadding,
    paddingLeft: fontSize * contract.paddingInlineStartEm,
    paddingRight: fontSize * contract.paddingInlineEndEm,
    iconSize: affix.prefixSuffixIconSize,
    ...affix,
    hitSlop: hitSlop(visibleHeight),
  };
}

export function resolveInputMetrics(tokens: NativeThemeTokens): NativeInputMetrics {
  return {
    visibleHeight: tailwindSpacing(tokens, CONTROL_METRICS.input.heightSpacingUnits),
    paddingHorizontal: tailwindSpacing(
      tokens,
      CONTROL_METRICS.input.paddingHorizontalSpacingUnits,
    ),
    paddingVertical: tailwindSpacing(
      tokens,
      CONTROL_METRICS.input.paddingVerticalSpacingUnits,
    ),
    fontSize: parseBaseSize(tokens.typography.baseSize) * CONTROL_METRICS.input.fontSizeRem,
    lineHeight: parseBaseSize(tokens.typography.baseSize) * CONTROL_METRICS.input.lineHeightRem,
  };
}

export function resolveListItemMetrics(
  tokens: NativeThemeTokens,
): NativeListItemMetrics {
  return {
    paddingHorizontal: tailwindSpacing(
      tokens,
      CONTROL_METRICS.listItem.paddingHorizontalSpacingUnits,
    ),
    paddingVertical: tailwindSpacing(
      tokens,
      CONTROL_METRICS.listItem.paddingVerticalSpacingUnits,
    ),
    gap: tailwindSpacing(tokens, CONTROL_METRICS.listItem.gapSpacingUnits),
    fontSize: parseBaseSize(tokens.typography.baseSize)
      * CONTROL_METRICS.listItem.fontSizeRem,
    lineHeight: parseBaseSize(tokens.typography.baseSize)
      * CONTROL_METRICS.listItem.lineHeightRem,
  };
}

export function resolveConfirmDialogMetrics(
  tokens: NativeThemeTokens,
): NativeConfirmDialogMetrics {
  const baseSize = parseBaseSize(tokens.typography.baseSize);
  const titleFontSize = baseSize * CONTROL_METRICS.confirmDialog.titleFontSizeRem;
  const descriptionFontSize = baseSize
    * CONTROL_METRICS.confirmDialog.descriptionFontSizeRem;
  return {
    maxWidth: baseSize * CONTROL_METRICS.confirmDialog.maxWidthRem,
    viewportHorizontalInset:
      baseSize * CONTROL_METRICS.confirmDialog.viewportHorizontalInsetRem,
    headerPadding: tailwindSpacing(
      tokens,
      CONTROL_METRICS.confirmDialog.headerPaddingSpacingUnits,
    ),
    headerGap: tailwindSpacing(
      tokens,
      CONTROL_METRICS.confirmDialog.headerGapSpacingUnits,
    ),
    contentGap: tailwindSpacing(
      tokens,
      CONTROL_METRICS.confirmDialog.contentGapSpacingUnits,
    ),
    warningIconSize: tailwindSpacing(
      tokens,
      CONTROL_METRICS.confirmDialog.warningIconSpacingUnits,
    ),
    warningIconMarginTop: tailwindSpacing(
      tokens,
      CONTROL_METRICS.confirmDialog.warningIconMarginTopSpacingUnits,
    ),
    titleFontSize,
    titleLineHeight:
      baseSize * CONTROL_METRICS.confirmDialog.titleLineHeightRem,
    titleLetterSpacing:
      titleFontSize * CONTROL_METRICS.confirmDialog.titleLetterSpacingEm,
    descriptionFontSize,
    descriptionLineHeight:
      descriptionFontSize
      * CONTROL_METRICS.confirmDialog.descriptionLineHeightMultiplier,
    footerPadding: tailwindSpacing(
      tokens,
      CONTROL_METRICS.confirmDialog.footerPaddingSpacingUnits,
    ),
    footerGap: tailwindSpacing(
      tokens,
      CONTROL_METRICS.confirmDialog.footerGapSpacingUnits,
    ),
  };
}

export function reduceNativeButtonInteraction(
  state: NativeButtonInteraction,
  event: NativeButtonInteractionEvent,
): NativeButtonInteraction {
  switch (event) {
    case 'focus':
      return state.focused ? state : { ...state, focused: true };
    case 'blur':
      return state.focused ? { ...state, focused: false } : state;
    case 'hover-in':
      return state.hovered ? state : { ...state, hovered: true };
    case 'hover-out':
      return state.hovered ? { ...state, hovered: false } : state;
    case 'press-in':
      return state.pressed ? state : { ...state, pressed: true };
    case 'press-out':
      return state.pressed ? { ...state, pressed: false } : state;
    case 'reset':
      return state.focused || state.hovered || state.pressed
        ? INITIAL_NATIVE_BUTTON_INTERACTION
        : state;
  }
}

export function resolveNativeButtonVisualState(
  state: NativeButtonInteraction,
  disabled = false,
  loading = false,
): NativeButtonVisualState {
  if (disabled || loading) return 'disabled';
  if (state.pressed) return 'pressed';
  if (state.focused) return 'focused';
  if (state.hovered) return 'hovered';
  return 'base';
}

export function resolveButtonVariantId(
  variant: NativeButtonVariant = {},
): NativeButtonVariantId {
  if (variant.ghost) {
    return variant.destructive ? 'ghost-destructive' : 'ghost-default';
  }
  if (variant.destructive) {
    return variant.outlined
      ? 'outlined-destructive'
      : 'solid-destructive';
  }
  if (variant.outlined) {
    return variant.invert ? 'outlined-invert' : 'outlined-default';
  }
  return variant.invert ? 'solid-invert' : 'solid-default';
}

export function resolveButtonVisual(
  tokens: NativeThemeTokens,
  variant: NativeButtonVariant = {},
  state: NativeButtonVisualState = 'base',
): NativeButtonVisual {
  const id = resolveButtonVariantId(variant);
  const midground = tokens.colors.foreground;
  const background = opaque(tokens.colors.background);
  const destructive = tokens.colors.destructive;
  const destructiveForeground = tokens.colors.destructiveForeground;
  const arcVisible = state === 'hovered' || state === 'focused' || state === 'pressed';
  const foregroundAlpha = parseColor(tokens.colors.foregroundLayer).alpha;
  const activeFilter: NativeButtonFilter = [
    { invert: 1 },
    { brightness: 100 - 99 * foregroundAlpha },
  ];

  let visual: NativeButtonVisual;
  if (state === 'disabled') {
    visual = {
      id,
      backgroundColor: multiplyAlpha(midground, 0.15),
      borderColor: id === 'outlined-destructive'
        ? multiplyAlpha(destructive, 0.4)
        : TRANSPARENT,
      textColor: midground,
      bevel: null,
      arcVisible: false,
      filter: null,
    };
  } else switch (id) {
    case 'ghost-default':
      visual = {
        id,
        backgroundColor: state === 'hovered' || state === 'pressed'
          ? multiplyAlpha(midground, 0.1)
          : TRANSPARENT,
        borderColor: TRANSPARENT,
        textColor: midground,
        bevel: null,
        arcVisible: false,
        filter: null,
      };
      break;
    case 'ghost-destructive':
      visual = {
        id,
        backgroundColor: state === 'hovered' || state === 'pressed'
          ? multiplyAlpha(destructive, 0.1)
          : TRANSPARENT,
        borderColor: TRANSPARENT,
        textColor: destructive,
        bevel: null,
        arcVisible: false,
        filter: null,
      };
      break;
    case 'solid-destructive':
      visual = {
        id,
        backgroundColor: state === 'hovered' || state === 'pressed'
          ? multiplyAlpha(destructive, 0.9)
          : destructive,
        borderColor: TRANSPARENT,
        textColor: destructiveForeground,
        bevel: INVERT_BEVEL,
        arcVisible,
        filter: null,
      };
      break;
    case 'outlined-destructive':
      visual = {
        id,
        backgroundColor: state === 'hovered' || state === 'pressed'
          ? multiplyAlpha(destructive, 0.1)
          : TRANSPARENT,
        borderColor: multiplyAlpha(destructive, 0.4),
        textColor: destructive,
        bevel: null,
        arcVisible,
        filter: null,
      };
      break;
    case 'solid-invert':
      visual = {
        id,
        backgroundColor: multiplyAlpha(midground, 0.15),
        borderColor: TRANSPARENT,
        textColor: midground,
        bevel: INVERT_BEVEL,
        arcVisible,
        filter: state === 'pressed' ? activeFilter : null,
      };
      break;
    case 'outlined-default':
      visual = {
        id,
        backgroundColor: TRANSPARENT,
        borderColor: TRANSPARENT,
        textColor: midground,
        bevel: DEFAULT_BEVEL,
        arcVisible,
        filter: state === 'pressed' ? activeFilter : null,
      };
      break;
    case 'outlined-invert':
      visual = {
        id,
        backgroundColor: TRANSPARENT,
        borderColor: TRANSPARENT,
        textColor: midground,
        bevel: INVERT_OUTLINED_BEVEL,
        arcVisible,
        filter: state === 'pressed' ? activeFilter : null,
      };
      break;
    case 'solid-default':
      visual = {
        id,
        backgroundColor: midground,
        borderColor: TRANSPARENT,
        textColor: background,
        bevel: DEFAULT_BEVEL,
        arcVisible,
        filter: state === 'pressed' ? [{ invert: 1 }] : null,
      };
      break;
  }

  // RN 0.81 exposes ViewStyle.filter, but its iOS Fabric implementation only
  // executes brightness and opacity. Resolve the CSS color matrix here so
  // invert is not silently dropped on iOS.
  return visual.filter ? applyButtonFilterToVisual(visual) : visual;
}

export function resolveControlColors(tokens: NativeThemeTokens) {
  const midground = tokens.colors.foreground;
  return {
    input: {
      background: multiplyAlpha(tokens.colors.background, CONTROL_METRICS.input.backgroundAlpha),
      border: multiplyAlpha(midground, CONTROL_METRICS.input.borderAlpha),
      placeholder: multiplyAlpha(midground, CONTROL_METRICS.input.placeholderAlpha),
      focusRing: multiplyAlpha(midground, CONTROL_METRICS.input.focusRingAlpha),
      focusBorder: multiplyAlpha(midground, CONTROL_METRICS.input.focusBorderAlpha),
    },
    listItem: {
      activeBackground: multiplyAlpha(midground, CONTROL_METRICS.listItem.activeBackgroundAlpha),
      pressedBackground: multiplyAlpha(midground, CONTROL_METRICS.listItem.pressedBackgroundAlpha),
      activeText: midground,
      inactiveText: tokens.colors.textSecondary,
      disabledText: tokens.colors.textDisabled,
      focusRing: multiplyAlpha(midground, CONTROL_METRICS.listItem.focusRingAlpha),
    },
    dialog: {
      overlay: 'rgba(0, 0, 0, 0.6)',
      background: opaque(tokens.colors.background),
      foregroundBase: opaque(tokens.colors.foregroundLayer),
      border: multiplyAlpha(midground, CONTROL_METRICS.confirmDialog.borderAlpha),
      description: multiplyAlpha(midground, 0.6),
    },
  };
}

export function resolveArcGradient(
  tokens: NativeThemeTokens,
  filter: NativeButtonFilter | null = null,
): ArcGradientContract {
  const angleRadians = CONTROL_METRICS.button.arcBorderAngleDegrees * Math.PI / 180;
  const dx = Math.sin(angleRadians);
  const dy = -Math.cos(angleRadians);
  const foreground = parseColor(tokens.colors.foregroundLayer);
  const thresholdColor = foreground.alpha < CONTROL_METRICS.button.arcForegroundAlphaThreshold
    ? formatColor(foreground)
    : TRANSPARENT;
  const namedColors: Record<(typeof CONTROL_METRICS.button.arcBorderStops)[number][0], string> = {
    transparent: TRANSPARENT,
    'foreground-threshold': thresholdColor,
    midground: tokens.colors.foreground,
    background: tokens.colors.background,
  };

  return {
    angleDegrees: CONTROL_METRICS.button.arcBorderAngleDegrees,
    backgroundSizePercent: CONTROL_METRICS.button.arcBorderBackgroundSizePercent,
    positionStart: CONTROL_METRICS.button.arcBorderPositionStart,
    positionEnd: CONTROL_METRICS.button.arcBorderPositionEnd,
    vector: {
      start: { x: (1 - dx) / 2, y: (1 - dy) / 2 },
      end: { x: (1 + dx) / 2, y: (1 + dy) / 2 },
    },
    stops: CONTROL_METRICS.button.arcBorderStops.map(([name, offset]) => ({
      color: filter
        ? applyButtonFilterToColor(namedColors[name], filter)
        : namedColors[name],
      offset,
    })),
  };
}

export function resolveCssGradientGeometry(
  width: number,
  height: number,
  angleDegrees: number,
) {
  if (width <= 0 || height <= 0) {
    return { x1: 0.5, y1: 0, x2: 0.5, y2: 1 };
  }
  const radians = angleDegrees * Math.PI / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const lineLength = Math.abs(width * dx) + Math.abs(height * dy);
  return {
    x1: 0.5 - dx * lineLength / (2 * width),
    y1: 0.5 - dy * lineLength / (2 * height),
    x2: 0.5 + dx * lineLength / (2 * width),
    y2: 0.5 + dy * lineLength / (2 * height),
  };
}

export function applyButtonFilterToColor(
  color: string,
  filter: NativeButtonFilter,
): string {
  const parsed = parseColor(color);
  if (parsed.alpha === 0) return formatColor(parsed);

  let red = parsed.red / 255;
  let green = parsed.green / 255;
  let blue = parsed.blue / 255;
  for (const operation of filter) {
    if ('invert' in operation) {
      const amount = Math.max(0, Math.min(1, operation.invert));
      red = red * (1 - amount) + (1 - red) * amount;
      green = green * (1 - amount) + (1 - green) * amount;
      blue = blue * (1 - amount) + (1 - blue) * amount;
    } else {
      red *= operation.brightness;
      green *= operation.brightness;
      blue *= operation.brightness;
    }
  }
  return formatColor({
    red: Math.max(0, Math.min(255, red * 255)),
    green: Math.max(0, Math.min(255, green * 255)),
    blue: Math.max(0, Math.min(255, blue * 255)),
    alpha: parsed.alpha,
  });
}

function applyButtonFilterToVisual(
  visual: NativeButtonVisual,
): NativeButtonVisual {
  const filter = visual.filter;
  if (!filter) return visual;
  const transform = (color: string) => applyButtonFilterToColor(color, filter);
  return {
    ...visual,
    backgroundColor: transform(visual.backgroundColor),
    borderColor: transform(visual.borderColor),
    textColor: transform(visual.textColor),
    bevel: visual.bevel
      ? {
          top: transform(visual.bevel.top),
          right: transform(visual.bevel.right),
          bottom: transform(visual.bevel.bottom),
          left: transform(visual.bevel.left),
        }
      : null,
  };
}

export function transitionConfirmDialogGate(
  state: ConfirmDialogGateState,
  event: ConfirmDialogGateEvent,
): ConfirmDialogTransition {
  if (event.type === 'sync') {
    if (event.open && !state.open) {
      return {
        state: {
          generation: state.generation + 1,
          loading: event.loading,
          open: true,
          resolvedGeneration: null,
        },
        effect: null,
      };
    }
    const loading = event.open ? event.loading : false;
    if (state.open === event.open && state.loading === loading) {
      return { state, effect: null };
    }
    return {
      state: { ...state, open: event.open, loading },
      effect: null,
    };
  }

  if (
    !state.open
    || state.loading
    || state.resolvedGeneration === state.generation
  ) {
    return { state, effect: null };
  }

  return {
    state: { ...state, resolvedGeneration: state.generation },
    effect: event.type,
  };
}

function parseColor(color: string): ParsedColor {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    let raw = hex[1];
    if (raw.length === 3 || raw.length === 4) {
      raw = raw.split('').map((character) => character + character).join('');
    }
    return {
      red: Number.parseInt(raw.slice(0, 2), 16),
      green: Number.parseInt(raw.slice(2, 4), 16),
      blue: Number.parseInt(raw.slice(4, 6), 16),
      alpha: raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(value);
  if (rgb) {
    return {
      red: Number(rgb[1]),
      green: Number(rgb[2]),
      blue: Number(rgb[3]),
      alpha: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }

  if (value === 'transparent') {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }
  throw new TypeError(`Unsupported native control color: ${color}`);
}

function formatColor(color: ParsedColor): string {
  const alpha = String(Number(Math.max(0, Math.min(1, color.alpha)).toFixed(6)));
  return `rgba(${Math.round(color.red)}, ${Math.round(color.green)}, ${Math.round(color.blue)}, ${alpha})`;
}

export function multiplyAlpha(color: string, alpha: number): string {
  const parsed = parseColor(color);
  return formatColor({ ...parsed, alpha: parsed.alpha * alpha });
}

export function opaque(color: string): string {
  return formatColor({ ...parseColor(color), alpha: 1 });
}
