import { useMemo } from 'react';
import type { useWindowDimensions as UseWindowDimensions } from 'react-native';

export const ADAPTIVE_LAYOUT_METRICS = {
  breakpoint: 768,
  headerHeight: 56,
  sidebarWidth: 256,
  collapsedSidebarWidth: 56,
} as const;

export type AdaptiveLayoutMode = 'compact' | 'split';

export interface AdaptiveLayout {
  mode: AdaptiveLayoutMode;
  width: number;
  compact: boolean;
  split: boolean;
  headerHeight: number;
  sidebarWidth: number;
  collapsedSidebarWidth: number;
}

export function resolveAdaptiveLayout(width: number): AdaptiveLayout {
  const normalizedWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const mode: AdaptiveLayoutMode = normalizedWidth < ADAPTIVE_LAYOUT_METRICS.breakpoint
    ? 'compact'
    : 'split';
  return {
    mode,
    width: normalizedWidth,
    compact: mode === 'compact',
    split: mode === 'split',
    headerHeight: ADAPTIVE_LAYOUT_METRICS.headerHeight,
    sidebarWidth: ADAPTIVE_LAYOUT_METRICS.sidebarWidth,
    collapsedSidebarWidth: ADAPTIVE_LAYOUT_METRICS.collapsedSidebarWidth,
  };
}

export function useAdaptiveLayout(): AdaptiveLayout {
  // Keep the pure resolver importable by Node contract tests. Metro still
  // statically resolves this native dependency in the application bundle.
  const { useWindowDimensions } = require('react-native') as {
    useWindowDimensions: typeof UseWindowDimensions;
  };
  const { width } = useWindowDimensions();
  return useMemo(() => resolveAdaptiveLayout(width), [width]);
}
