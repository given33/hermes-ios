export interface ThemeLayer {
  alpha: number;
  hex: string;
}

export interface ThemePalette {
  background: ThemeLayer;
  midground: ThemeLayer;
  foreground: ThemeLayer;
  warmGlow: string;
  noiseOpacity: number;
}

export interface ThemeTypography {
  fontSans: string;
  fontMono: string;
  fontDisplay?: string;
  fontUrl?: string;
  baseSize: string;
  lineHeight: string;
  letterSpacing: string;
}

export type ThemeDensity = 'compact' | 'comfortable' | 'spacious';

export interface ThemeLayout {
  radius: string;
  density: ThemeDensity;
}

export type ThemeLayoutVariant = 'standard' | 'cockpit' | 'tiled';

export interface ThemeAssets {
  bg?: string;
  hero?: string;
  logo?: string;
  crest?: string;
  sidebar?: string;
  header?: string;
  custom?: Record<string, string>;
}

export interface ThemeComponentStyles {
  card?: Record<string, string>;
  header?: Record<string, string>;
  footer?: Record<string, string>;
  sidebar?: Record<string, string>;
  tab?: Record<string, string>;
  progress?: Record<string, string>;
  badge?: Record<string, string>;
  backdrop?: Record<string, string>;
  page?: Record<string, string>;
}

export interface ThemeSeriesColors {
  inputTokenAccent?: string;
  outputTokenAccent?: string;
}

export interface ThemeColorOverrides {
  card?: string;
  cardForeground?: string;
  popover?: string;
  popoverForeground?: string;
  primary?: string;
  primaryForeground?: string;
  secondary?: string;
  secondaryForeground?: string;
  muted?: string;
  mutedForeground?: string;
  accent?: string;
  accentForeground?: string;
  destructive?: string;
  destructiveForeground?: string;
  success?: string;
  warning?: string;
  border?: string;
  input?: string;
  ring?: string;
}

export interface DashboardTheme {
  description: string;
  label: string;
  name: string;
  palette: ThemePalette;
  typography: ThemeTypography;
  layout: ThemeLayout;
  layoutVariant?: ThemeLayoutVariant;
  assets?: ThemeAssets;
  customCSS?: string;
  componentStyles?: ThemeComponentStyles;
  colorOverrides?: ThemeColorOverrides;
  seriesColors?: ThemeSeriesColors;
  swatchColors?: [string, string, string];
  terminalBackground?: string;
  terminalForeground?: string;
}

export interface ThemeListEntry {
  description: string;
  label: string;
  name: string;
  definition?: DashboardTheme;
}

export interface ThemeListResponse {
  active: string;
  themes: ThemeListEntry[];
}

export interface DashboardFontResponse {
  font: string;
}

export interface NativeThemeColors {
  background: string;
  foregroundLayer: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  warning: string;
  border: string;
  input: string;
  ring: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
}

export interface NativeThemeTokens {
  name: string;
  colors: NativeThemeColors;
  typography: ThemeTypography & { fontDisplay: string };
  layout: ThemeLayout & {
    spacingMultiplier: number;
    variant: ThemeLayoutVariant;
  };
  terminal: {
    background: string;
    foreground: string;
  };
  series: {
    inputTokenAccent: string;
    outputTokenAccent: string;
  };
  effects: {
    warmGlow: string;
    noiseOpacity: number;
  };
  assets?: ThemeAssets;
  componentStyles?: ThemeComponentStyles;
  customCSS?: string;
  swatchColors?: [string, string, string];
}

export interface ThemeTransitionPlan {
  tokens: NativeThemeTokens;
  removeVariableKeys: string[];
}
