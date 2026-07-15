import type {
  DashboardTheme,
  ThemeLayout,
  ThemeTypography,
} from './theme-types';

const SYSTEM_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';

const DEFAULT_TYPOGRAPHY: ThemeTypography = {
  fontSans: SYSTEM_SANS,
  fontMono: SYSTEM_MONO,
  baseSize: '15px',
  lineHeight: '1.55',
  letterSpacing: '0',
};

const DEFAULT_LAYOUT: ThemeLayout = {
  radius: '0.5rem',
  density: 'comfortable',
};

export const defaultTheme: DashboardTheme = {
  name: 'default',
  label: 'Hermes Teal',
  description: 'Classic dark teal \u2014 the canonical Hermes look',
  palette: {
    background: { hex: '#041c1c', alpha: 1 },
    midground: { hex: '#ffe6cb', alpha: 1 },
    foreground: { hex: '#ffffff', alpha: 0 },
    warmGlow: 'rgba(255, 189, 56, 0.35)',
    noiseOpacity: 1,
  },
  typography: DEFAULT_TYPOGRAPHY,
  layout: DEFAULT_LAYOUT,
  terminalBackground: '#000000',
};

export const midnightTheme: DashboardTheme = {
  name: 'midnight',
  label: 'Midnight',
  description: 'Deep blue-violet with cool accents',
  palette: {
    background: { hex: '#0a0a1f', alpha: 1 },
    midground: { hex: '#d4c8ff', alpha: 1 },
    foreground: { hex: '#ffffff', alpha: 0 },
    warmGlow: 'rgba(167, 139, 250, 0.32)',
    noiseOpacity: 0.8,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"Inter", ${SYSTEM_SANS}`,
    fontMono: `"JetBrains Mono", ${SYSTEM_MONO}`,
    fontUrl:
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap',
    letterSpacing: '-0.005em',
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: '0.75rem',
  },
};

export const emberTheme: DashboardTheme = {
  name: 'ember',
  label: 'Ember',
  description: 'Warm crimson and bronze \u2014 forge vibes',
  palette: {
    background: { hex: '#1a0a06', alpha: 1 },
    midground: { hex: '#ffd8b0', alpha: 1 },
    foreground: { hex: '#ffffff', alpha: 0 },
    warmGlow: 'rgba(249, 115, 22, 0.38)',
    noiseOpacity: 1,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: '"Spectral", Georgia, "Times New Roman", serif',
    fontMono: `"IBM Plex Mono", ${SYSTEM_MONO}`,
    fontUrl:
      'https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap',
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: '0.25rem',
  },
  colorOverrides: {
    destructive: '#c92d0f',
    warning: '#f97316',
  },
};

export const monoTheme: DashboardTheme = {
  name: 'mono',
  label: 'Mono',
  description: 'Clean grayscale \u2014 minimal and focused',
  palette: {
    background: { hex: '#0e0e0e', alpha: 1 },
    midground: { hex: '#eaeaea', alpha: 1 },
    foreground: { hex: '#ffffff', alpha: 0 },
    warmGlow: 'rgba(255, 255, 255, 0.1)',
    noiseOpacity: 0.6,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"IBM Plex Sans", ${SYSTEM_SANS}`,
    fontMono: `"IBM Plex Mono", ${SYSTEM_MONO}`,
    fontUrl:
      'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap',
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: '0',
  },
};

export const cyberpunkTheme: DashboardTheme = {
  name: 'cyberpunk',
  label: 'Cyberpunk',
  description: 'Neon green on black \u2014 matrix terminal',
  palette: {
    background: { hex: '#040608', alpha: 1 },
    midground: { hex: '#9bffcf', alpha: 1 },
    foreground: { hex: '#ffffff', alpha: 0 },
    warmGlow: 'rgba(0, 255, 136, 0.22)',
    noiseOpacity: 1.2,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"Share Tech Mono", "JetBrains Mono", ${SYSTEM_MONO}`,
    fontMono: `"Share Tech Mono", "JetBrains Mono", ${SYSTEM_MONO}`,
    fontUrl:
      'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=JetBrains+Mono:wght@400;700&display=swap',
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: '0',
  },
  colorOverrides: {
    success: '#00ff88',
    warning: '#ffd700',
    destructive: '#ff0055',
  },
};

export const roseTheme: DashboardTheme = {
  name: 'rose',
  label: 'Ros\u00e9',
  description: 'Soft pink and warm ivory \u2014 easy on the eyes',
  palette: {
    background: { hex: '#1a0f15', alpha: 1 },
    midground: { hex: '#ffd4e1', alpha: 1 },
    foreground: { hex: '#ffffff', alpha: 0 },
    warmGlow: 'rgba(249, 168, 212, 0.3)',
    noiseOpacity: 0.9,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: '"Fraunces", Georgia, serif',
    fontMono: `"DM Mono", ${SYSTEM_MONO}`,
    fontUrl:
      'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Mono:wght@400;500&display=swap',
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: '1rem',
  },
};

export const nousBlueTheme: DashboardTheme = {
  name: 'nous-blue',
  label: 'Nous Blue',
  description: 'Light mode \u2014 vivid Nous-blue accents on cream canvas',
  palette: {
    background: { hex: '#E8F2FD', alpha: 1 },
    midground: { hex: '#0053FD', alpha: 1 },
    foreground: { hex: '#170d02', alpha: 0 },
    warmGlow: 'rgba(0, 83, 253, 0.12)',
    noiseOpacity: 0,
  },
  typography: DEFAULT_TYPOGRAPHY,
  layout: DEFAULT_LAYOUT,
  terminalBackground: '#f5f8fc',
  terminalForeground: '#170d02',
  seriesColors: {
    inputTokenAccent: '#001934',
    outputTokenAccent: '#0053fd',
  },
  swatchColors: ['#170d02', '#0053FD', '#E8F2FD'],
};

export const defaultLargeTheme: DashboardTheme = {
  name: 'default-large',
  label: 'Hermes Teal (Large)',
  description: 'Hermes Teal with bigger fonts and roomier spacing',
  palette: defaultTheme.palette,
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    baseSize: '18px',
    lineHeight: '1.65',
  },
  layout: {
    ...DEFAULT_LAYOUT,
    density: 'spacious',
  },
};

export const BUILTIN_THEME_ORDER = [
  'default',
  'default-large',
  'nous-blue',
  'midnight',
  'ember',
  'mono',
  'cyberpunk',
  'rose',
] as const;

export type BuiltinThemeName = (typeof BUILTIN_THEME_ORDER)[number];

export const BUILTIN_THEMES: Record<BuiltinThemeName, DashboardTheme> = {
  default: defaultTheme,
  'default-large': defaultLargeTheme,
  'nous-blue': nousBlueTheme,
  midnight: midnightTheme,
  ember: emberTheme,
  mono: monoTheme,
  cyberpunk: cyberpunkTheme,
  rose: roseTheme,
};
