import assert from 'node:assert/strict';
import test from 'node:test';

import type { DashboardTheme } from '../src/design/theme-types';
import {
  BUILTIN_THEME_ORDER,
  BUILTIN_THEMES,
} from '../src/design/theme-presets';
import {
  deriveNativeThemeTokens,
  planThemeTransition,
} from '../src/design/theme-tokens';

const SYSTEM_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';

const DEFAULT_TYPOGRAPHY = {
  fontSans: SYSTEM_SANS,
  fontMono: SYSTEM_MONO,
  baseSize: '15px',
  lineHeight: '1.55',
  letterSpacing: '0',
};

const DEFAULT_LAYOUT = {
  radius: '0.5rem',
  density: 'comfortable',
};

const DEFAULT_PALETTE = {
  background: { hex: '#041c1c', alpha: 1 },
  midground: { hex: '#ffe6cb', alpha: 1 },
  foreground: { hex: '#ffffff', alpha: 0 },
  warmGlow: 'rgba(255, 189, 56, 0.35)',
  noiseOpacity: 1,
};

test('freezes the eight customized-WebUI themes in source order', () => {
  assert.deepEqual(BUILTIN_THEME_ORDER, [
    'default',
    'default-large',
    'nous-blue',
    'midnight',
    'ember',
    'mono',
    'cyberpunk',
    'rose',
  ]);
  assert.deepEqual(
    Object.values(BUILTIN_THEMES).map((theme) => theme.name),
    BUILTIN_THEME_ORDER,
  );
});

test('copies the complete canonical default theme snapshot', () => {
  assert.deepEqual(BUILTIN_THEMES.default, {
    name: 'default',
    label: 'Hermes Teal',
    description: 'Classic dark teal \u2014 the canonical Hermes look',
    palette: DEFAULT_PALETTE,
    typography: DEFAULT_TYPOGRAPHY,
    layout: DEFAULT_LAYOUT,
    terminalBackground: '#000000',
  });
});

test('copies the complete canonical Nous-blue theme snapshot', () => {
  assert.deepEqual(BUILTIN_THEMES['nous-blue'], {
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
  });
});

test('copies complete snapshots for every other canonical built-in theme', () => {
  assert.deepEqual(
    {
      'default-large': BUILTIN_THEMES['default-large'],
      midnight: BUILTIN_THEMES.midnight,
      ember: BUILTIN_THEMES.ember,
      mono: BUILTIN_THEMES.mono,
      cyberpunk: BUILTIN_THEMES.cyberpunk,
      rose: BUILTIN_THEMES.rose,
    },
    {
      'default-large': {
        name: 'default-large',
        label: 'Hermes Teal (Large)',
        description: 'Hermes Teal with bigger fonts and roomier spacing',
        palette: DEFAULT_PALETTE,
        typography: {
          ...DEFAULT_TYPOGRAPHY,
          baseSize: '18px',
          lineHeight: '1.65',
        },
        layout: {
          ...DEFAULT_LAYOUT,
          density: 'spacious',
        },
      },
      midnight: {
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
      },
      ember: {
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
      },
      mono: {
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
      },
      cyberpunk: {
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
      },
      rose: {
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
      },
    },
  );
});

test('derives native semantic colors from the exact WebUI color mixes', () => {
  const tokens = deriveNativeThemeTokens(BUILTIN_THEMES.default);

  assert.deepEqual(tokens.colors, {
    background: 'rgba(4, 28, 28, 1)',
    foregroundLayer: 'rgba(255, 255, 255, 0)',
    foreground: 'rgba(255, 230, 203, 1)',
    card: 'rgba(14, 36, 35, 1)',
    cardForeground: 'rgba(255, 230, 203, 1)',
    popover: 'rgba(14, 36, 35, 1)',
    popoverForeground: 'rgba(255, 230, 203, 1)',
    primary: 'rgba(255, 230, 203, 1)',
    primaryForeground: 'rgba(4, 28, 28, 1)',
    secondary: 'rgba(19, 40, 39, 1)',
    secondaryForeground: 'rgba(255, 230, 203, 1)',
    muted: 'rgba(24, 44, 42, 1)',
    mutedForeground: 'rgba(255, 230, 203, 0.8)',
    accent: 'rgba(29, 48, 46, 1)',
    accentForeground: 'rgba(255, 230, 203, 1)',
    destructive: '#fb2c36',
    destructiveForeground: '#ffffff',
    success: '#4ade80',
    warning: '#ffbd38',
    border: 'rgba(255, 230, 203, 0.15)',
    input: 'rgba(255, 230, 203, 0.15)',
    ring: 'rgba(255, 230, 203, 1)',
    textSecondary: 'rgba(255, 230, 203, 0.8)',
    textTertiary: 'rgba(255, 230, 203, 0.65)',
    textDisabled: 'rgba(255, 230, 203, 0.45)',
  });
  assert.deepEqual(tokens.layout, {
    radius: '0.5rem',
    density: 'comfortable',
    spacingMultiplier: 1,
    variant: 'standard',
  });
  assert.deepEqual(tokens.terminal, {
    background: '#000000',
    foreground: '#f0e6d2',
  });
  assert.deepEqual(tokens.series, {
    inputTokenAccent: '#ffe6cb',
    outputTokenAccent: '#34d399',
  });
});

test('applies theme overrides and Nous-blue native defaults', () => {
  const cyberpunk = deriveNativeThemeTokens(BUILTIN_THEMES.cyberpunk);
  assert.equal(cyberpunk.colors.success, '#00ff88');
  assert.equal(cyberpunk.colors.warning, '#ffd700');
  assert.equal(cyberpunk.colors.destructive, '#ff0055');

  const nousBlue = deriveNativeThemeTokens(BUILTIN_THEMES['nous-blue']);
  assert.equal(nousBlue.colors.card, 'rgba(223, 236, 253, 1)');
  assert.deepEqual(nousBlue.terminal, {
    background: '#f5f8fc',
    foreground: '#170d02',
  });
  assert.deepEqual(nousBlue.series, {
    inputTokenAccent: '#001934',
    outputTokenAccent: '#0053fd',
  });
});

test('rounds custom layer alpha to the same integer percentage as ThemeProvider', () => {
  const custom: DashboardTheme = {
    ...BUILTIN_THEMES.default,
    name: 'fractional-alpha',
    palette: {
      ...BUILTIN_THEMES.default.palette,
      background: { hex: '#123456', alpha: 0.333 },
      midground: { hex: '#abcdef', alpha: 0.666 },
      foreground: { hex: '#654321', alpha: 0.333 },
    },
  };

  const colors = deriveNativeThemeTokens(custom).colors;
  assert.deepEqual(
    {
      background: colors.background,
      foregroundLayer: colors.foregroundLayer,
      foreground: colors.foreground,
      cardForeground: colors.cardForeground,
      popoverForeground: colors.popoverForeground,
      primary: colors.primary,
      secondaryForeground: colors.secondaryForeground,
      accentForeground: colors.accentForeground,
      ring: colors.ring,
    },
    {
      background: 'rgba(18, 52, 86, 0.33)',
      foregroundLayer: 'rgba(101, 67, 33, 0.33)',
      foreground: 'rgba(171, 205, 239, 0.67)',
      cardForeground: 'rgba(171, 205, 239, 0.67)',
      popoverForeground: 'rgba(171, 205, 239, 0.67)',
      primary: 'rgba(171, 205, 239, 0.67)',
      secondaryForeground: 'rgba(171, 205, 239, 0.67)',
      accentForeground: 'rgba(171, 205, 239, 0.67)',
      ring: 'rgba(171, 205, 239, 0.67)',
    },
  );
});

test('derives compact density and honors explicit display fonts before fallback', () => {
  const custom: DashboardTheme = {
    ...BUILTIN_THEMES.default,
    name: 'compact-display',
    typography: {
      ...BUILTIN_THEMES.default.typography,
      fontDisplay: 'Collapse',
    },
    layout: {
      radius: '0.25rem',
      density: 'compact',
    },
  };

  const customTokens = deriveNativeThemeTokens(custom);
  assert.equal(customTokens.layout.spacingMultiplier, 0.85);
  assert.equal(customTokens.typography.fontDisplay, 'Collapse');
  assert.equal(
    deriveNativeThemeTokens(BUILTIN_THEMES.default).typography.fontDisplay,
    SYSTEM_SANS,
  );
});

test('plans a switch that clears prior overrides, series, assets, and components', () => {
  const previous: DashboardTheme = {
    ...BUILTIN_THEMES.default,
    name: 'operator-rich',
    layoutVariant: 'cockpit',
    customCSS: '.dashboard { filter: contrast(1.1); }',
    colorOverrides: {
      card: '#101010',
      warning: '#f59e0b',
    },
    seriesColors: {
      inputTokenAccent: '#112233',
      outputTokenAccent: '#445566',
    },
    assets: {
      bg: '/themes/operator/bg.png',
      custom: {
        'hud-grid': '/themes/operator/grid.png',
        'bad key': '/ignored.png',
      },
    },
    componentStyles: {
      card: { clipPath: 'polygon(0 0, 100% 0, 100% 90%, 0 100%)' },
      sidebar: { backgroundColor: '#050505' },
    },
  };

  const plan = planThemeTransition(previous, BUILTIN_THEMES.default);

  assert.deepEqual(plan.removeVariableKeys, [
    '--color-card',
    '--color-card-foreground',
    '--color-popover',
    '--color-popover-foreground',
    '--color-primary',
    '--color-primary-foreground',
    '--color-secondary',
    '--color-secondary-foreground',
    '--color-muted',
    '--color-muted-foreground',
    '--color-accent',
    '--color-accent-foreground',
    '--color-destructive',
    '--color-destructive-foreground',
    '--color-success',
    '--color-warning',
    '--color-border',
    '--color-input',
    '--color-ring',
    '--series-input-token',
    '--series-output-token',
    '--theme-asset-bg',
    '--theme-asset-bg-raw',
    '--theme-asset-custom-hud-grid',
    '--theme-asset-custom-hud-grid-raw',
    '--component-card-clip-path',
    '--component-sidebar-background-color',
  ]);
  assert.deepEqual(plan.tokens, deriveNativeThemeTokens(BUILTIN_THEMES.default));
  assert.equal(plan.tokens.layout.variant, 'standard');
  assert.equal(plan.tokens.customCSS, undefined);
  assert.equal(plan.removeVariableKeys.some((key) => key.includes('bad key')), false);
});
