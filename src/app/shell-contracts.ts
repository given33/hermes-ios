import type { NativeThemeTokens } from '../design/theme-types';
import {
  ADAPTIVE_LAYOUT_METRICS,
  type AdaptiveLayoutMode,
} from './useAdaptiveLayout';

export const SHELL_SOURCES = {
  shell: 'hermes-agent@c552a5063:web/src/App.tsx',
  profile: 'hermes-agent@c552a5063:web/src/components/ProfileSwitcher.tsx',
  status: 'hermes-agent@c552a5063:web/src/components/SidebarStatusStrip.tsx',
  footer: 'hermes-agent@c552a5063:web/src/components/SidebarFooter.tsx',
  theme: 'hermes-agent@c552a5063:web/src/components/ThemeSwitcher.tsx',
  language: 'hermes-agent@c552a5063:web/src/components/LanguageSwitcher.tsx',
} as const;

export const SHELL_METRICS = {
  breakpoint: ADAPTIVE_LAYOUT_METRICS.breakpoint,
  sidebarWidth: ADAPTIVE_LAYOUT_METRICS.sidebarWidth,
  collapsedSidebarWidth: ADAPTIVE_LAYOUT_METRICS.collapsedSidebarWidth,
  headerHeight: ADAPTIVE_LAYOUT_METRICS.headerHeight,
  mobileDrawerDurationMs: 200,
  desktopWidthDurationMs: 300,
  labelOpacityDurationMs: 300,
  hoverOpacityDurationMs: 200,
  transitionEasing: [0.23, 1, 0.32, 1] as const,
  overlayColor: 'rgba(0, 0, 0, 0.7)',
  borderWidth: 1,
  activeIndicatorWidth: 1,
  navHorizontalSpacingUnits: 5,
  navVerticalSpacingUnits: 2.5,
  navGapSpacingUnits: 3,
  navIconRem: 0.875,
  navFontRem: 0.875,
  navLineHeightRem: 1.25,
  navLetterSpacingEm: 0.12,
  sectionFontRem: 0.75,
  sectionLetterSpacingEm: 0.12,
  brandFontRem: 1.125,
  brandLineHeight: 0.95,
  brandLetterSpacingRem: 0.0525,
  mobileBrandFontRem: 0.95,
  systemActionFontRem: 0.75,
  systemActionLetterSpacingEm: 0.1,
  collapsedLabelOpacity: 0,
  expandedLabelOpacity: 1,
  hoverLayerOpacity: 0.05,
} as const;

export const SHELL_SLOT_ORDER = [
  'brand',
  'profile',
  'core-navigation',
  'plugin-navigation',
  'system-actions',
  'theme-language',
  'auth',
  'status-footer',
] as const;

export interface ResolvedShellTypography {
  spacingUnit: number;
  nav: {
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    iconSize: number;
    paddingHorizontal: number;
    paddingVertical: number;
    gap: number;
    visibleHeight: number;
  };
  section: {
    fontSize: number;
    letterSpacing: number;
  };
  brand: {
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
  };
  mobileBrand: {
    fontSize: number;
    lineHeight: number;
  };
  systemAction: {
    fontSize: number;
    letterSpacing: number;
  };
}

export interface NativeShellState {
  mode: AdaptiveLayoutMode;
  activePath: string;
  collapsed: boolean;
  mobileOpen: boolean;
}

export type NativeShellEvent =
  | { type: 'open-mobile' }
  | { type: 'close-mobile' }
  | { type: 'toggle-collapsed' }
  | { type: 'navigate'; path: string }
  | { type: 'layout-changed'; mode: AdaptiveLayoutMode };

export function resolveShellTypography(
  tokens: NativeThemeTokens,
): ResolvedShellTypography {
  const root = parseRootSize(tokens.typography.baseSize);
  const spacing = root * 0.25 * tokens.layout.spacingMultiplier;
  const navFontSize = root * SHELL_METRICS.navFontRem;
  const navLineHeight = root * SHELL_METRICS.navLineHeightRem;
  const navPaddingVertical = spacing * SHELL_METRICS.navVerticalSpacingUnits;
  const brandFontSize = root * SHELL_METRICS.brandFontRem;
  const mobileBrandFontSize = root * SHELL_METRICS.mobileBrandFontRem;
  const sectionFontSize = root * SHELL_METRICS.sectionFontRem;
  const systemActionFontSize = root * SHELL_METRICS.systemActionFontRem;

  return {
    spacingUnit: spacing,
    nav: {
      fontSize: navFontSize,
      lineHeight: navLineHeight,
      letterSpacing: navFontSize * SHELL_METRICS.navLetterSpacingEm,
      iconSize: root * SHELL_METRICS.navIconRem,
      paddingHorizontal: spacing * SHELL_METRICS.navHorizontalSpacingUnits,
      paddingVertical: navPaddingVertical,
      gap: spacing * SHELL_METRICS.navGapSpacingUnits,
      visibleHeight: navLineHeight + navPaddingVertical * 2,
    },
    section: {
      fontSize: sectionFontSize,
      letterSpacing: sectionFontSize * SHELL_METRICS.sectionLetterSpacingEm,
    },
    brand: {
      fontSize: brandFontSize,
      lineHeight: brandFontSize * SHELL_METRICS.brandLineHeight,
      letterSpacing: root * SHELL_METRICS.brandLetterSpacingRem,
    },
    mobileBrand: {
      fontSize: mobileBrandFontSize,
      lineHeight: mobileBrandFontSize * SHELL_METRICS.brandLineHeight,
    },
    systemAction: {
      fontSize: systemActionFontSize,
      letterSpacing:
        systemActionFontSize * SHELL_METRICS.systemActionLetterSpacingEm,
    },
  };
}

export function createNativeShellState(
  mode: AdaptiveLayoutMode,
  activePath = '/sessions',
): NativeShellState {
  return {
    mode,
    activePath,
    collapsed: false,
    mobileOpen: false,
  };
}

export function reduceNativeShellState(
  state: NativeShellState,
  event: NativeShellEvent,
): NativeShellState {
  switch (event.type) {
    case 'open-mobile':
      return state.mode === 'compact' && !state.mobileOpen
        ? { ...state, mobileOpen: true }
        : state;
    case 'close-mobile':
      return state.mobileOpen ? { ...state, mobileOpen: false } : state;
    case 'toggle-collapsed':
      return state.mode === 'split'
        ? { ...state, collapsed: !state.collapsed }
        : state;
    case 'navigate':
      return state.activePath === event.path && !state.mobileOpen
        ? state
        : { ...state, activePath: event.path, mobileOpen: false };
    case 'layout-changed':
      return state.mode === event.mode && !state.mobileOpen
        ? state
        : { ...state, mode: event.mode, mobileOpen: false };
  }
}

export function resolveVisibleSidebarWidth(state: NativeShellState): number {
  if (state.mode === 'compact') return SHELL_METRICS.sidebarWidth;
  return state.collapsed
    ? SHELL_METRICS.collapsedSidebarWidth
    : SHELL_METRICS.sidebarWidth;
}

export function resolveMobileDrawerTranslation(state: NativeShellState): number {
  if (state.mode === 'split' || state.mobileOpen) return 0;
  return -SHELL_METRICS.sidebarWidth;
}

function parseRootSize(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}
