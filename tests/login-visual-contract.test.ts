import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  INITIAL_PROVIDER_BUTTON_INTERACTION,
  LOGIN_VISUAL_CONTRACT,
  providerButtonLayerTargets,
  providerButtonVisualState,
  reduceProviderButtonInteraction,
} from '../src/auth/login-visual-contract';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('login contract freezes the shared source colors, glow, motion, and shadow', () => {
  assert.deepEqual(LOGIN_VISUAL_CONTRACT.colors, {
    background: '#170d02',
    accent: '#ffac02',
    foreground: '#ffffff',
    error: '#ff6b6b',
  });
  assert.deepEqual(LOGIN_VISUAL_CONTRACT.glow, {
    opacity: 0.06,
    stop: '55%',
    radiusX: '70.710678%',
    radiusY: '141.421356%',
  });
  assert.deepEqual(LOGIN_VISUAL_CONTRACT.entrance, {
    durationMs: 600,
    translateY: 6,
    easing: [0, 0, 0.58, 1],
  });
  assert.deepEqual(LOGIN_VISUAL_CONTRACT.cardShadow, {
    spread: 20,
    blurSigma: 30,
    offsetY: 24,
    opacity: 0.6,
  });
});

test('login dither uses the repeating-conic top-right and bottom-left phase', () => {
  assert.deepEqual(LOGIN_VISUAL_CONTRACT.dither, {
    size: 3,
    opacity: 0.04,
    cells: [
      { x: 1.5, y: 0, width: 1.5, height: 1.5 },
      { x: 0, y: 1.5, width: 1.5, height: 1.5 },
    ],
  });
});

test('provider button contract preserves base, hover brightness, active invert, and timing', () => {
  const button = LOGIN_VISUAL_CONTRACT.providerButton;

  assert.deepEqual(button.base, {
    backgroundColor: '#ffac02',
    textColor: '#170d02',
    bevel: {
      top: 'rgba(255, 255, 255, 0.5)',
      right: 'rgba(0, 0, 0, 0.5)',
      bottom: 'rgba(0, 0, 0, 0.5)',
      left: 'rgba(255, 255, 255, 0.5)',
    },
  });
  assert.deepEqual(button.active, {
    backgroundColor: '#0053fd',
    textColor: '#e8f2fd',
    bevel: {
      top: 'rgba(0, 0, 0, 0.5)',
      right: 'rgba(255, 255, 255, 0.5)',
      bottom: 'rgba(255, 255, 255, 0.5)',
      left: 'rgba(0, 0, 0, 0.5)',
    },
  });
  assert.deepEqual(button.hover, {
    brightness: 1.08,
    backgroundColor: '#ffba02',
    textColor: '#190e02',
    bevel: {
      top: 'rgb(255, 231, 139)',
      right: 'rgb(138, 93, 1)',
      bottom: 'rgb(138, 93, 1)',
      left: 'rgb(255, 231, 139)',
    },
  });
  assert.deepEqual(button.filterTransition, {
    durationMs: 120,
    easing: [0, 0, 0.58, 1],
  });
  assert.deepEqual(button.focusVisible, {
    color: '#ffac02',
    width: 2,
    offset: 3,
  });
  assert.equal(button.disabledVisualOverride, null);
});

test('provider button interaction keeps active above hover and restores the right state', () => {
  const reduce = (
    state: typeof INITIAL_PROVIDER_BUTTON_INTERACTION,
    event: Parameters<typeof reduceProviderButtonInteraction>[1],
  ) => reduceProviderButtonInteraction(state, event);
  let state = INITIAL_PROVIDER_BUTTON_INTERACTION;
  assert.equal(providerButtonVisualState(state), 'base');

  state = reduce(state, 'hover-in');
  assert.equal(providerButtonVisualState(state), 'hover');
  state = reduce(state, 'press-in');
  assert.equal(providerButtonVisualState(state), 'active');
  state = reduce(state, 'press-out');
  assert.equal(providerButtonVisualState(state), 'hover');

  state = reduce(state, 'press-in');
  state = reduce(state, 'hover-out');
  assert.equal(providerButtonVisualState(state), 'active');
  state = reduce(state, 'press-out');
  assert.equal(providerButtonVisualState(state), 'base');

  state = reduce(state, 'hover-in');
  state = reduce(state, 'reset');
  assert.deepEqual(state, INITIAL_PROVIDER_BUTTON_INTERACTION);
  assert.equal(providerButtonVisualState(state), 'base');
});

test('provider button layer topology never routes a transition through a third state', () => {
  const base = providerButtonLayerTargets({ hovered: false, pressed: false });
  const hover = providerButtonLayerTargets({ hovered: true, pressed: false });
  const activeFromBase = providerButtonLayerTargets({ hovered: false, pressed: true });
  const activeFromHover = providerButtonLayerTargets({ hovered: true, pressed: true });
  const channels = (
    from: ReturnType<typeof providerButtonLayerTargets>,
    to: ReturnType<typeof providerButtonLayerTargets>,
  ) => ({
    hover: [from.hoverOpacity, to.hoverOpacity],
    active: [from.activeOpacity, to.activeOpacity],
  });

  assert.deepEqual(base, { hoverOpacity: 0, activeOpacity: 0 });
  assert.deepEqual(hover, { hoverOpacity: 1, activeOpacity: 0 });
  assert.deepEqual(activeFromBase, { hoverOpacity: 0, activeOpacity: 1 });
  assert.deepEqual(activeFromHover, { hoverOpacity: 1, activeOpacity: 1 });
  assert.deepEqual(channels(base, hover), { hover: [0, 1], active: [0, 0] });
  assert.deepEqual(channels(base, activeFromBase), {
    hover: [0, 0],
    active: [0, 1],
  });
  assert.deepEqual(channels(hover, activeFromHover), {
    hover: [1, 1],
    active: [0, 1],
  });
  assert.deepEqual(channels(activeFromHover, hover), {
    hover: [1, 1],
    active: [1, 0],
  });
});

test('LoginScreen consumes the pure visual contract instead of duplicating source values', () => {
  const source = readFileSync(resolve(projectRoot, 'src/auth/LoginScreen.tsx'), 'utf8');

  assert.match(source, /from '.\/login-visual-contract'/);
  assert.match(source, /LOGIN_VISUAL_CONTRACT/);
  assert.match(source, /providerButtonLayerTargets/);
  assert.match(source, /Animated\.timing\(hoverOpacity/);
  assert.match(source, /Animated\.timing\(activeOpacity/);
  assert.match(source, /PROVIDER_BUTTON\.active\.bevel\.top/);
  assert.match(source, /PROVIDER_BUTTON\.hover\.backgroundColor/);
  assert.match(source, /onHoverIn=/);
  assert.match(source, /onHoverOut=/);
  assert.match(source, /onPressIn=/);
  assert.match(source, /onPressOut=/);
  assert.match(source, /reduceProviderButtonInteraction/);
  assert.match(source, /providerButtonFocusRing/);
  assert.match(source, /accessibilityLabel=\{label\}/);
  assert.ok((source.match(/accessible=\{false\}/g) ?? []).length >= 2);
  assert.ok((source.match(/accessibilityElementsHidden/g) ?? []).length >= 2);
  assert.ok(
    (source.match(/importantForAccessibility="no-hide-descendants"/g) ?? []).length >= 2,
  );
  assert.doesNotMatch(source, /(?:hoverOpacity|activeOpacity)\.setValue/);
  assert.doesNotMatch(source, /enableNativeCSSParsing|react-native-reanimated/);
  assert.doesNotMatch(source, /inputRange:\s*\[0,\s*1,\s*2\]/);
  assert.doesNotMatch(source, /const LOGIN_DITHER_SIZE/);
  assert.doesNotMatch(source, /buttonDisabled:\s*\{[^}]*opacity/s);
});
