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
  resolveControlColors,
  resolveCssGradientGeometry,
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
      prefixSuffixSpacerWidth: 20,
      prefixSuffixOffset: 12,
      prefixSuffixIconSize: 14,
      sizes: {
        default: {
          fontSizeRem: 1,
          letterSpacingEm: 0.2,
          paddingBlockEm: 1.25,
          paddingInlineStartEm: 0.9,
          paddingInlineEndEm: 0.75,
        },
        icon: { iconSize: 14, padding: 8, visibleSize: 30 },
        sm: {
          fontSizeRem: 0.7,
          iconSize: 12,
          letterSpacingEm: 0.15,
          paddingHorizontal: 12,
          paddingVertical: 6,
          visibleHeight: 12,
        },
        xs: { iconSize: 12, padding: 4, visibleSize: 20 },
      },
      translation:
        'CSS inset shadows become four absolute 1pt edge layers; no drop shadow.',
    },
    input: {
      visibleHeight: 36,
      borderWidth: 1,
      borderAlpha: 0.15,
      backgroundAlpha: 0.4,
      paddingHorizontal: 12,
      paddingVertical: 4,
      fontSize: 14,
      placeholderAlpha: 0.5,
      focusRingWidth: 1,
      focusRingAlpha: 0.3,
      focusBorderAlpha: 0.25,
      disabledOpacity: 0.5,
    },
    listItem: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 8,
      fontSize: 14,
      activeBackgroundAlpha: 0.1,
      pressedBackgroundAlpha: 0.05,
      focusRingWidth: 1,
      focusRingAlpha: 0.3,
    },
    confirmDialog: {
      overlayBlackAlpha: 0.6,
      maxWidth: 448,
      viewportHorizontalInset: 16,
      borderWidth: 1,
      borderAlpha: 0.15,
      headerPadding: 16,
      headerGap: 12,
      contentGap: 4,
      warningIconSize: 16,
      titleFontSize: 14,
      titleLetterSpacingEm: 0.08,
      descriptionFontSize: 12,
      descriptionLineHeight: 19.5,
      footerPadding: 12,
      footerGap: 8,
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
    iconSize: 14,
    hitSlop: { top: 3.25, right: 0, bottom: 3.25, left: 0 },
  });
  assert.equal(resolveButtonMetrics(defaultTokens, 'icon').visibleHeight, 30);
  assert.equal(resolveButtonMetrics(defaultTokens, 'sm').visibleHeight, 12);
  assert.equal(resolveButtonMetrics(defaultTokens, 'xs').visibleHeight, 20);
  assert.deepEqual(resolveButtonMetrics(defaultTokens, 'xs').hitSlop, {
    top: 12,
    right: 12,
    bottom: 12,
    left: 12,
  });
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
  assert.equal(arc.stops[1].color, 'rgba(255, 255, 255, 1)');
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
