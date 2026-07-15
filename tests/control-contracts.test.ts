import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTROL_METRICS,
  CONTROL_SOURCE_MAP,
  INITIAL_CONFIRM_DIALOG_GATE,
  INITIAL_NATIVE_BUTTON_INTERACTION,
  reduceNativeButtonInteraction,
  resolveArcGradient,
  resolveButtonMetrics,
  resolveButtonVariantId,
  resolveButtonVisual,
  resolveConfirmDialogMetrics,
  resolveControlColors,
  resolveCssGradientGeometry,
  resolveInputMetrics,
  resolveListItemMetrics,
  resolveNativeButtonVisualState,
  transitionConfirmDialogGate,
} from '../src/design/control-contracts';
import { BUILTIN_THEMES } from '../src/design/theme-presets';
import { deriveNativeThemeTokens } from '../src/design/theme-tokens';
import {
  ADAPTIVE_LAYOUT_METRICS,
  resolveAdaptiveLayout,
} from '../src/app/useAdaptiveLayout';

const defaultTokens = deriveNativeThemeTokens(BUILTIN_THEMES.default);
const defaultLargeTokens = deriveNativeThemeTokens(BUILTIN_THEMES['default-large']);

test('control contracts cite the exact canonical source implementations', () => {
  assert.deepEqual(CONTROL_SOURCE_MAP, {
    button: '@nous-research/ui@0.18.2/src/ui/components/button.tsx',
    input: '@nous-research/ui@0.18.2/src/ui/components/input.tsx',
    listItem: '@nous-research/ui@0.18.2/src/ui/components/list-item.tsx',
    confirmDialog:
      '@nous-research/ui@0.18.2/src/ui/components/confirm-dialog.tsx',
    typography:
      '@nous-research/ui@0.18.2/src/ui/components/typography/index.tsx',
    arcBorder: '@nous-research/ui@0.18.2/src/ui/globals.css:.arc-border',
    webTheme: 'hermes-agent@4272ccd44:web/src/index.css',
  });
});

test('freezes exact visible control metrics and native translation notes', () => {
  assert.deepEqual(CONTROL_METRICS, {
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
  });
});

test('button sizes preserve visible CSS geometry while hit slop reaches 44pt', () => {
  assert.deepEqual(resolveButtonMetrics(defaultTokens, 'default'), {
    visibleHeight: 37.5,
    fontSize: 15,
    letterSpacing: 3,
    paddingTop: 18.75,
    paddingBottom: 18.75,
    paddingLeft: 13.5,
    paddingRight: 11.25,
    iconSize: 13.125,
    prefixSuffixSpacerWidth: 18.75,
    prefixSuffixOffset: 11.25,
    prefixSuffixIconSize: 13.125,
    hitSlop: { top: 3.25, right: 0, bottom: 3.25, left: 0 },
  });
  assert.equal(resolveButtonMetrics(defaultTokens, 'icon').visibleHeight, 28.125);
  assert.equal(resolveButtonMetrics(defaultTokens, 'sm').visibleHeight, 11.25);
  assert.equal(resolveButtonMetrics(defaultTokens, 'xs').visibleHeight, 18.75);
  assert.deepEqual(resolveButtonMetrics(defaultTokens, 'xs').hitSlop, {
    top: 12.625,
    right: 12.625,
    bottom: 12.625,
    left: 12.625,
  });
  assert.equal(resolveButtonMetrics(defaultLargeTokens, 'default').visibleHeight, 45);
  assert.equal(resolveButtonMetrics(defaultLargeTokens, 'icon').visibleHeight, 40.5);
});

test('rem and spacing controls consume root size and density exactly', () => {
  assert.deepEqual(resolveInputMetrics(defaultTokens), {
    visibleHeight: 33.75,
    paddingHorizontal: 11.25,
    paddingVertical: 3.75,
    fontSize: 13.125,
    lineHeight: 18.75,
  });
  assert.deepEqual(resolveListItemMetrics(defaultTokens), {
    paddingHorizontal: 11.25,
    paddingVertical: 7.5,
    gap: 7.5,
    fontSize: 13.125,
    lineHeight: 18.75,
  });
  assert.deepEqual(resolveConfirmDialogMetrics(defaultTokens), {
    maxWidth: 420,
    viewportHorizontalInset: 15,
    headerPadding: 15,
    headerGap: 11.25,
    contentGap: 3.75,
    warningIconSize: 15,
    warningIconMarginTop: 1.875,
    titleFontSize: 13.125,
    titleLineHeight: 18.75,
    titleLetterSpacing: 1.05,
    descriptionFontSize: 11.25,
    descriptionLineHeight: 18.28125,
    footerPadding: 11.25,
    footerGap: 7.5,
  });
  const largeInput = resolveInputMetrics(defaultLargeTokens);
  assert.ok(Math.abs(largeInput.visibleHeight - 48.6) < 1e-10);
  assert.ok(Math.abs(largeInput.paddingVertical - 5.4) < 1e-10);
  assert.equal(largeInput.paddingHorizontal, 16.2);
  assert.equal(largeInput.fontSize, 15.75);
  assert.equal(largeInput.lineHeight, 22.5);
  assert.equal(resolveConfirmDialogMetrics(defaultLargeTokens).maxWidth, 504);
  assert.ok(
    Math.abs(resolveConfirmDialogMetrics(defaultLargeTokens).headerPadding - 21.6)
      < 1e-10,
  );
});

test('control colors derive exact source alpha variants from NativeThemeTokens', () => {
  const colors = resolveControlColors(defaultTokens);
  assert.deepEqual(colors.input, {
    background: 'rgba(4, 28, 28, 0.4)',
    border: 'rgba(255, 230, 203, 0.15)',
    placeholder: 'rgba(255, 230, 203, 0.5)',
    focusRing: 'rgba(255, 230, 203, 0.3)',
    focusBorder: 'rgba(255, 230, 203, 0.25)',
  });
  assert.deepEqual(colors.listItem, {
    activeBackground: 'rgba(255, 230, 203, 0.1)',
    pressedBackground: 'rgba(255, 230, 203, 0.05)',
    activeText: 'rgba(255, 230, 203, 1)',
    inactiveText: 'rgba(255, 230, 203, 0.8)',
    disabledText: 'rgba(255, 230, 203, 0.45)',
    focusRing: 'rgba(255, 230, 203, 0.3)',
  });
  assert.equal(colors.dialog.overlay, 'rgba(0, 0, 0, 0.6)');
  assert.equal(colors.dialog.background, 'rgba(4, 28, 28, 1)');
  assert.equal(colors.dialog.foregroundBase, 'rgba(255, 255, 255, 1)');
  assert.equal(colors.dialog.description, 'rgba(255, 230, 203, 0.6)');
});

test('adaptive layout uses the native 768pt contract in portrait and landscape', () => {
  assert.deepEqual(ADAPTIVE_LAYOUT_METRICS, {
    breakpoint: 768,
    headerHeight: 56,
    sidebarWidth: 256,
    collapsedSidebarWidth: 56,
  });
  assert.equal(resolveAdaptiveLayout(402).mode, 'compact');
  assert.equal(resolveAdaptiveLayout(767).mode, 'compact');
  assert.equal(resolveAdaptiveLayout(768).mode, 'split');
  assert.equal(resolveAdaptiveLayout(834).mode, 'split');
  assert.equal(resolveAdaptiveLayout(932).mode, 'split');
});

test('button interaction reducer is idempotent and preserves visual priority', () => {
  let state = INITIAL_NATIVE_BUTTON_INTERACTION;
  assert.equal(resolveNativeButtonVisualState(state), 'base');

  state = reduceNativeButtonInteraction(state, 'focus');
  assert.equal(resolveNativeButtonVisualState(state), 'focused');
  assert.equal(reduceNativeButtonInteraction(state, 'focus'), state);

  state = reduceNativeButtonInteraction(state, 'hover-in');
  assert.equal(resolveNativeButtonVisualState(state), 'focused');

  state = reduceNativeButtonInteraction(state, 'press-in');
  assert.equal(resolveNativeButtonVisualState(state), 'pressed');
  assert.equal(resolveNativeButtonVisualState(state, true), 'disabled');
  assert.equal(resolveNativeButtonVisualState(state, false, true), 'disabled');

  state = reduceNativeButtonInteraction(state, 'press-out');
  assert.equal(resolveNativeButtonVisualState(state), 'focused');
  state = reduceNativeButtonInteraction(state, 'blur');
  assert.equal(resolveNativeButtonVisualState(state), 'hovered');
  state = reduceNativeButtonInteraction(state, 'hover-out');
  assert.deepEqual(state, INITIAL_NATIVE_BUTTON_INTERACTION);
  assert.equal(reduceNativeButtonInteraction(state, 'reset'), state);
});

test('button variant resolver covers the complete canonical matrix', () => {
  const variants = [
    [{}, 'solid-default'],
    [{ invert: true }, 'solid-invert'],
    [{ outlined: true }, 'outlined-default'],
    [{ outlined: true, invert: true }, 'outlined-invert'],
    [{ ghost: true }, 'ghost-default'],
    [{ ghost: true, destructive: true }, 'ghost-destructive'],
    [{ destructive: true }, 'solid-destructive'],
    [{ destructive: true, outlined: true }, 'outlined-destructive'],
  ] as const;
  assert.deepEqual(
    variants.map(([variant]) => resolveButtonVariantId(variant)),
    variants.map(([, id]) => id),
  );

  const expectedPressedFilters = {
    'solid-default': [{ invert: 1 }],
    'solid-invert': [{ invert: 1 }, { brightness: 100 }],
    'outlined-default': [{ invert: 1 }, { brightness: 100 }],
    'outlined-invert': [{ invert: 1 }, { brightness: 100 }],
    'ghost-default': null,
    'ghost-destructive': null,
    'solid-destructive': null,
    'outlined-destructive': null,
  } as const;
  for (const [variant, id] of variants) {
    for (const state of ['base', 'hovered', 'focused', 'pressed', 'disabled'] as const) {
      const visual = resolveButtonVisual(defaultTokens, variant, state);
      assert.equal(visual.id, id, `${id}/${state} keeps its variant`);
      assert.deepEqual(
        visual.filter,
        state === 'pressed' ? expectedPressedFilters[id] : null,
        `${id}/${state} maps the canonical active filter`,
      );
      assert.equal(
        visual.arcVisible,
        !('ghost' in variant && variant.ghost) && state !== 'disabled'
          && (state === 'hovered' || state === 'focused' || state === 'pressed'),
        `${id}/${state} maps arc visibility`,
      );
    }
  }

  assert.deepEqual(resolveButtonVisual(defaultTokens).bevel, {
    top: '#ffffff80',
    right: '#00000080',
    bottom: '#00000080',
    left: '#ffffff80',
  });
  assert.equal(
    resolveButtonVisual(defaultTokens, { ghost: true }, 'pressed').arcVisible,
    false,
  );
  assert.deepEqual(
    {
      background: resolveButtonVisual(defaultTokens, {}, 'pressed').backgroundColor,
      text: resolveButtonVisual(defaultTokens, {}, 'pressed').textColor,
    },
    {
      background: 'rgba(0, 25, 52, 1)',
      text: 'rgba(251, 227, 227, 1)',
    },
  );
  assert.equal(
    resolveButtonVisual(defaultTokens, { invert: true }, 'pressed').backgroundColor,
    'rgba(0, 255, 255, 0.15)',
  );
  const disabled = resolveButtonVisual(
    defaultTokens,
    { destructive: true },
    'disabled',
  );
  assert.equal(disabled.backgroundColor, 'rgba(255, 230, 203, 0.15)');
  assert.equal(disabled.borderColor, 'rgba(0, 0, 0, 0)');
  assert.equal(disabled.bevel, null);
  assert.equal(disabled.arcVisible, false);
  assert.equal(disabled.filter, null);

  const highAlphaTokens = {
    ...defaultTokens,
    colors: {
      ...defaultTokens.colors,
      foregroundLayer: 'rgba(255, 255, 255, 0.75)',
    },
  };
  assert.deepEqual(
    resolveButtonVisual(highAlphaTokens, { invert: true }, 'pressed').filter,
    [{ invert: 1 }, { brightness: 25.75 }],
  );

  const disabledOutlinedDestructive = resolveButtonVisual(
    defaultTokens,
    { destructive: true, outlined: true },
    'disabled',
  );
  assert.equal(
    disabledOutlinedDestructive.borderColor,
    'rgba(251, 44, 54, 0.4)',
  );
});

test('arc gradient preserves its exact moving vector and alpha threshold colors', () => {
  const arc = resolveArcGradient(defaultTokens);
  assert.equal(arc.angleDegrees, 160);
  assert.equal(arc.backgroundSizePercent, 300);
  assert.deepEqual(arc.positionStart, [15, 15]);
  assert.deepEqual(arc.positionEnd, [75, 75]);
  assert.ok(Math.abs(arc.vector.start.x - 0.3289899283) < 1e-9);
  assert.ok(Math.abs(arc.vector.start.y - 0.0301536896) < 1e-9);
  assert.ok(Math.abs(arc.vector.end.x - 0.6710100717) < 1e-9);
  assert.ok(Math.abs(arc.vector.end.y - 0.9698463104) < 1e-9);
  assert.deepEqual(arc.stops.map((stop) => stop.offset), [
    0, 0.15, 0.2, 0.25, 0.35, 0.4, 0.55, 0.6, 0.65, 0.75, 0.8, 0.95, 1,
  ]);
  assert.equal(arc.stops[1].color, 'rgba(255, 255, 255, 0)');
  assert.equal(arc.stops[2].color, 'rgba(255, 230, 203, 1)');
  assert.equal(arc.stops[3].color, 'rgba(4, 28, 28, 1)');

  const opaqueForeground = resolveArcGradient({
    ...defaultTokens,
    colors: {
      ...defaultTokens.colors,
      foregroundLayer: 'rgba(18, 52, 86, 0.5)',
    },
  });
  assert.equal(opaqueForeground.stops[1].color, 'rgba(0, 0, 0, 0)');
  assert.equal(opaqueForeground.stops[6].color, 'rgba(0, 0, 0, 0)');
  assert.equal(opaqueForeground.stops[11].color, 'rgba(0, 0, 0, 0)');
});

test('slash-alpha colors multiply translucent theme layers', () => {
  const translucent = {
    ...defaultTokens,
    colors: {
      ...defaultTokens.colors,
      background: 'rgba(4, 28, 28, 0.5)',
      foreground: 'rgba(255, 230, 203, 0.5)',
    },
  };
  const colors = resolveControlColors(translucent);
  assert.equal(colors.input.background, 'rgba(4, 28, 28, 0.2)');
  assert.equal(colors.input.border, 'rgba(255, 230, 203, 0.075)');
  assert.equal(colors.input.placeholder, 'rgba(255, 230, 203, 0.25)');
  assert.equal(colors.listItem.activeBackground, 'rgba(255, 230, 203, 0.05)');
  assert.equal(colors.dialog.description, 'rgba(255, 230, 203, 0.3)');
  assert.equal(
    resolveButtonVisual(translucent, {}, 'disabled').backgroundColor,
    'rgba(255, 230, 203, 0.075)',
  );
});

test('SVG arc geometry preserves the CSS angle for non-square buttons', () => {
  const geometry = resolveCssGradientGeometry(300, 90, 160);
  const dx = (geometry.x2 - geometry.x1) * 300;
  const dy = (geometry.y2 - geometry.y1) * 90;
  assert.ok(Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI - 160) < 1e-10);
  assert.deepEqual(resolveCssGradientGeometry(0, 0, 160), {
    x1: 0.5,
    y1: 0,
    x2: 0.5,
    y2: 1,
  });
});

test('confirm dialog gate emits at most one action for each open generation', () => {
  let state = INITIAL_CONFIRM_DIALOG_GATE;
  let transition = transitionConfirmDialogGate(state, {
    type: 'sync', open: true, loading: false,
  });
  state = transition.state;
  assert.equal(state.generation, 1);

  transition = transitionConfirmDialogGate(state, { type: 'confirm' });
  state = transition.state;
  assert.equal(transition.effect, 'confirm');
  assert.equal(
    transitionConfirmDialogGate(state, { type: 'confirm' }).effect,
    null,
  );
  assert.equal(
    transitionConfirmDialogGate(state, { type: 'cancel' }).effect,
    null,
  );

  state = transitionConfirmDialogGate(state, {
    type: 'sync', open: false, loading: false,
  }).state;
  state = transitionConfirmDialogGate(state, {
    type: 'sync', open: true, loading: true,
  }).state;
  assert.equal(state.generation, 2);
  assert.equal(
    transitionConfirmDialogGate(state, { type: 'cancel' }).effect,
    null,
  );

  state = transitionConfirmDialogGate(state, {
    type: 'sync', open: true, loading: false,
  }).state;
  transition = transitionConfirmDialogGate(state, { type: 'cancel' });
  assert.equal(transition.effect, 'cancel');
  assert.equal(transition.state.resolvedGeneration, 2);
});
