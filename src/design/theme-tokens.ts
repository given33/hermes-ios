import type {
  DashboardTheme,
  NativeThemeColors,
  NativeThemeTokens,
  ThemeColorOverrides,
  ThemeComponentStyles,
  ThemeDensity,
  ThemeLayer,
  ThemeTransitionPlan,
} from './theme-types';

const DENSITY_MULTIPLIERS: Record<ThemeDensity, number> = {
  compact: 0.85,
  comfortable: 1,
  spacious: 1.2,
};

const COLOR_OVERRIDE_VARIABLES: Record<keyof ThemeColorOverrides, string> = {
  card: '--color-card',
  cardForeground: '--color-card-foreground',
  popover: '--color-popover',
  popoverForeground: '--color-popover-foreground',
  primary: '--color-primary',
  primaryForeground: '--color-primary-foreground',
  secondary: '--color-secondary',
  secondaryForeground: '--color-secondary-foreground',
  muted: '--color-muted',
  mutedForeground: '--color-muted-foreground',
  accent: '--color-accent',
  accentForeground: '--color-accent-foreground',
  destructive: '--color-destructive',
  destructiveForeground: '--color-destructive-foreground',
  success: '--color-success',
  warning: '--color-warning',
  border: '--color-border',
  input: '--color-input',
  ring: '--color-ring',
};

const SERIES_VARIABLES = [
  '--series-input-token',
  '--series-output-token',
] as const;

const NAMED_ASSET_KEYS = [
  'bg',
  'hero',
  'logo',
  'crest',
  'sidebar',
  'header',
] as const;

const COMPONENT_BUCKETS: ReadonlyArray<keyof ThemeComponentStyles> = [
  'card',
  'header',
  'footer',
  'sidebar',
  'tab',
  'progress',
  'badge',
  'backdrop',
  'page',
];

interface Rgb {
  red: number;
  green: number;
  blue: number;
}

function parseHexColor(hex: string): Rgb {
  const raw = hex.trim().replace(/^#/, '');
  const expanded = raw.length === 3
    ? raw.split('').map((character) => character + character).join('')
    : raw;

  if (!/^[a-fA-F0-9]{6}$/.test(expanded)) {
    throw new TypeError(`Expected a six-digit hex color, received ${hex}`);
  }

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function formatAlpha(alpha: number): string {
  return String(Number(Math.min(1, Math.max(0, alpha)).toFixed(6)));
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${Math.round(color.red)}, ${Math.round(color.green)}, ${Math.round(color.blue)}, ${formatAlpha(alpha)})`;
}

function layerColor(layer: ThemeLayer): string {
  const percentage = Math.round(layer.alpha * 100);
  return rgba(parseHexColor(layer.hex), percentage / 100);
}

function opaqueColor(hex: string): string {
  return rgba(parseHexColor(hex), 1);
}

function colorWithAlpha(hex: string, alpha: number): string {
  return rgba(parseHexColor(hex), alpha);
}

function mixOpaqueColors(foreground: string, background: string, amount: number): string {
  const front = parseHexColor(foreground);
  const back = parseHexColor(background);

  return rgba(
    {
      red: front.red * amount + back.red * (1 - amount),
      green: front.green * amount + back.green * (1 - amount),
      blue: front.blue * amount + back.blue * (1 - amount),
    },
    1,
  );
}

function deriveSemanticColors(theme: DashboardTheme): NativeThemeColors {
  const background = theme.palette.background;
  const midground = theme.palette.midground;
  const foreground = theme.palette.foreground;
  const midgroundColor = layerColor(midground);
  const backgroundBase = opaqueColor(background.hex);
  const textSecondary = colorWithAlpha(midground.hex, 0.8);

  const colors: NativeThemeColors = {
    background: layerColor(background),
    foregroundLayer: layerColor(foreground),
    foreground: midgroundColor,
    card: mixOpaqueColors(midground.hex, background.hex, 0.04),
    cardForeground: midgroundColor,
    popover: mixOpaqueColors(midground.hex, background.hex, 0.04),
    popoverForeground: midgroundColor,
    primary: midgroundColor,
    primaryForeground: backgroundBase,
    secondary: mixOpaqueColors(midground.hex, background.hex, 0.06),
    secondaryForeground: midgroundColor,
    muted: mixOpaqueColors(midground.hex, background.hex, 0.08),
    mutedForeground: textSecondary,
    accent: mixOpaqueColors(midground.hex, background.hex, 0.1),
    accentForeground: midgroundColor,
    destructive: '#fb2c36',
    destructiveForeground: '#ffffff',
    success: '#4ade80',
    warning: '#ffbd38',
    border: colorWithAlpha(midground.hex, 0.15),
    input: colorWithAlpha(midground.hex, 0.15),
    ring: midgroundColor,
    textSecondary,
    textTertiary: colorWithAlpha(midground.hex, 0.65),
    textDisabled: colorWithAlpha(midground.hex, 0.45),
  };

  for (const [key, value] of Object.entries(theme.colorOverrides ?? {})) {
    if (value && key in colors) {
      colors[key as keyof NativeThemeColors] = value;
    }
  }

  return colors;
}

export function deriveNativeThemeTokens(theme: DashboardTheme): NativeThemeTokens {
  return {
    name: theme.name,
    colors: deriveSemanticColors(theme),
    typography: {
      ...theme.typography,
      fontDisplay: theme.typography.fontDisplay ?? theme.typography.fontSans,
    },
    layout: {
      ...theme.layout,
      spacingMultiplier: DENSITY_MULTIPLIERS[theme.layout.density] ?? 1,
      variant: theme.layoutVariant ?? 'standard',
    },
    terminal: {
      background: theme.terminalBackground ?? '#000000',
      foreground: theme.terminalForeground ?? '#f0e6d2',
    },
    series: {
      inputTokenAccent: theme.seriesColors?.inputTokenAccent ?? '#ffe6cb',
      outputTokenAccent: theme.seriesColors?.outputTokenAccent ?? '#34d399',
    },
    effects: {
      warmGlow: theme.palette.warmGlow,
      noiseOpacity: theme.palette.noiseOpacity,
    },
    assets: theme.assets,
    componentStyles: theme.componentStyles,
    customCSS: theme.customCSS,
    swatchColors: theme.swatchColors,
  };
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function previousDynamicVariableKeys(theme: DashboardTheme | undefined): string[] {
  if (!theme) return [];

  const keys: string[] = [];
  const assets = theme.assets;
  if (assets) {
    for (const key of NAMED_ASSET_KEYS) {
      const value = assets[key];
      if (typeof value === 'string' && value.trim()) {
        keys.push(`--theme-asset-${key}`, `--theme-asset-${key}-raw`);
      }
    }
    for (const [key, value] of Object.entries(assets.custom ?? {})) {
      if (
        typeof value === 'string'
        && value.trim()
        && /^[a-zA-Z0-9_-]+$/.test(key)
      ) {
        keys.push(
          `--theme-asset-custom-${key}`,
          `--theme-asset-custom-${key}-raw`,
        );
      }
    }
  }

  for (const bucket of COMPONENT_BUCKETS) {
    const properties = theme.componentStyles?.[bucket];
    for (const [property, value] of Object.entries(properties ?? {})) {
      if (
        typeof value === 'string'
        && value.trim()
        && /^[a-zA-Z0-9_-]+$/.test(property)
      ) {
        keys.push(`--component-${bucket}-${toKebabCase(property)}`);
      }
    }
  }

  return keys;
}

export function planThemeTransition(
  previous: DashboardTheme | undefined,
  next: DashboardTheme,
): ThemeTransitionPlan {
  return {
    tokens: deriveNativeThemeTokens(next),
    removeVariableKeys: [
      ...Object.values(COLOR_OVERRIDE_VARIABLES),
      ...SERIES_VARIABLES,
      ...previousDynamicVariableKeys(previous),
    ],
  };
}
