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
    palette: {
      background: { hex: '#041c1c', alpha: 1 },
      midground: { hex: '#ffe6cb', alpha: 1 },
      foreground: { hex: '#ffffff', alpha: 0 },
      warmGlow: 'rgba(255, 189, 56, 0.35)',
      noiseOpacity: 1,
    },
    typography: {
      fontSans: SYSTEM_SANS,
      fontMono: SYSTEM_MONO,
      baseSize: '15px',
      lineHeight: '1.55',
      letterSpacing: '0',
    },
    layout: {
      radius: '0.5rem',
      density: 'comfortable',
    },
    terminalBackground: '#000000',
  });
});

test('preserves the Nous-blue terminals and series plus override-theme fields', () => {
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
    typography: BUILTIN_THEMES.default.typography,
    layout: BUILTIN_THEMES.default.layout,
    terminalBackground: '#f5f8fc',
    terminalForeground: '#170d02',
    seriesColors: {
      inputTokenAccent: '#001934',
      outputTokenAccent: '#0053fd',
    },
    swatchColors: ['#170d02', '#0053FD', '#E8F2FD'],
  });
  assert.deepEqual(BUILTIN_THEMES.cyberpunk.colorOverrides, {
    success: '#00ff88',
    warning: '#ffd700',
    destructive: '#ff0055',
  });
  assert.equal(BUILTIN_THEMES.cyberpunk.layout.radius, '0');
  assert.equal(BUILTIN_THEMES.cyberpunk.palette.noiseOpacity, 1.2);
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

test('plans a switch that clears prior overrides, series, assets, and components', () => {
  const previous: DashboardTheme = {
    ...BUILTIN_THEMES.default,
    name: 'operator-rich',
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
  assert.equal(plan.removeVariableKeys.some((key) => key.includes('bad key')), false);
});
