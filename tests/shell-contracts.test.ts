import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHELL_METRICS,
  SHELL_SLOT_ORDER,
  SHELL_SOURCES,
  createNativeShellState,
  reduceNativeShellState,
  resolveMobileDrawerTranslation,
  resolveShellTypography,
  resolveVisibleSidebarWidth,
} from '../src/app/shell-contracts';
import { deriveNativeThemeTokens } from '../src/design/theme-tokens';
import { defaultTheme } from '../src/design/theme-presets';

test('shell contract cites every customized WebUI source that owns its order', () => {
  assert.deepEqual(Object.keys(SHELL_SOURCES), [
    'shell',
    'profile',
    'status',
    'footer',
    'theme',
    'language',
  ]);
  for (const source of Object.values(SHELL_SOURCES)) {
    assert.match(source, /hermes-agent@c552a5063:web\/src\//);
  }
  assert.deepEqual(SHELL_SLOT_ORDER, [
    'brand',
    'profile',
    'core-navigation',
    'plugin-navigation',
    'system-actions',
    'theme-language',
    'auth',
    'status-footer',
  ]);
});

test('shell freezes the agreed native adaptation and exact WebUI motion', () => {
  assert.deepEqual(
    {
      breakpoint: SHELL_METRICS.breakpoint,
      sidebar: SHELL_METRICS.sidebarWidth,
      collapsed: SHELL_METRICS.collapsedSidebarWidth,
      header: SHELL_METRICS.headerHeight,
    },
    { breakpoint: 768, sidebar: 256, collapsed: 56, header: 56 },
  );
  assert.equal(SHELL_METRICS.mobileDrawerDurationMs, 200);
  assert.equal(SHELL_METRICS.desktopWidthDurationMs, 300);
  assert.equal(SHELL_METRICS.labelOpacityDurationMs, 300);
  assert.equal(SHELL_METRICS.hoverOpacityDurationMs, 200);
  assert.deepEqual(SHELL_METRICS.transitionEasing, [0.23, 1, 0.32, 1]);
  assert.equal(SHELL_METRICS.overlayColor, 'rgba(0, 0, 0, 0.7)');
  assert.equal(SHELL_METRICS.hoverLayerOpacity, 0.05);
});

test('shell typography consumes the actual 15px root and density spacing', () => {
  const tokens = deriveNativeThemeTokens(defaultTheme);
  const typography = resolveShellTypography(tokens);

  assert.equal(typography.spacingUnit, 3.75);
  assert.deepEqual(typography.nav, {
    fontSize: 13.125,
    lineHeight: 18.75,
    letterSpacing: 1.575,
    iconSize: 13.125,
    paddingHorizontal: 18.75,
    paddingVertical: 9.375,
    gap: 11.25,
    visibleHeight: 37.5,
  });
  assert.deepEqual(typography.section, {
    fontSize: 11.25,
    letterSpacing: 1.3499999999999999,
  });
  assert.deepEqual(typography.brand, {
    fontSize: 16.875,
    lineHeight: 16.03125,
    letterSpacing: 0.7875,
  });
  assert.deepEqual(typography.mobileBrand, {
    fontSize: 14.25,
    lineHeight: 13.5375,
  });
});

test('compact navigation opens, closes, and closes on route selection', () => {
  const initial = createNativeShellState('compact');
  const open = reduceNativeShellState(initial, { type: 'open-mobile' });
  assert.equal(open.mobileOpen, true);
  assert.equal(resolveMobileDrawerTranslation(open), 0);
  assert.equal(resolveVisibleSidebarWidth(open), 256);

  const navigated = reduceNativeShellState(open, {
    type: 'navigate',
    path: '/skills',
  });
  assert.deepEqual(navigated, {
    mode: 'compact',
    activePath: '/skills',
    collapsed: false,
    mobileOpen: false,
  });
  assert.equal(resolveMobileDrawerTranslation(navigated), -256);
});

test('split navigation alone owns the persistent collapsed state', () => {
  const split = createNativeShellState('split', '/chat');
  const compactToggle = reduceNativeShellState(
    createNativeShellState('compact'),
    { type: 'toggle-collapsed' },
  );
  assert.equal(compactToggle.collapsed, false);

  const collapsed = reduceNativeShellState(split, {
    type: 'toggle-collapsed',
  });
  assert.equal(collapsed.collapsed, true);
  assert.equal(resolveVisibleSidebarWidth(collapsed), 56);
  assert.equal(resolveMobileDrawerTranslation(collapsed), 0);

  const compact = reduceNativeShellState(collapsed, {
    type: 'layout-changed',
    mode: 'compact',
  });
  assert.equal(compact.collapsed, true);
  assert.equal(compact.mobileOpen, false);
  assert.equal(resolveVisibleSidebarWidth(compact), 256);
});
