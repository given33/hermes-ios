import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  INITIAL_PROVIDER_BUTTON_INTERACTION,
  LOGIN_DARK_PALETTE,
  LOGIN_LIGHT_PALETTE,
  LOGIN_VISUAL_CONTRACT,
  isLoginColorScheme,
  loginPalette,
  providerButtonLayerTargets,
  providerButtonVisualState,
  reduceProviderButtonInteraction,
} from '../src/auth/login-visual-contract';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('login contract ships light as the default and persists the toggle choice', () => {
  assert.equal(LOGIN_VISUAL_CONTRACT.defaultScheme, 'light');
  assert.equal(LOGIN_VISUAL_CONTRACT.appearanceStorageKey, 'hermes.login.appearance');
  assert.equal(loginPalette('light'), LOGIN_LIGHT_PALETTE);
  assert.equal(loginPalette('dark'), LOGIN_DARK_PALETTE);
  assert.equal(isLoginColorScheme('light'), true);
  assert.equal(isLoginColorScheme('dark'), true);
  assert.equal(isLoginColorScheme('amber'), false);
});

test('light palette uses a neutral canvas and high-contrast controls', () => {
  assert.equal(LOGIN_LIGHT_PALETTE.backgroundTop, '#ffffff');
  assert.equal(LOGIN_LIGHT_PALETTE.backgroundBottom, '#ffffff');
  assert.equal(LOGIN_LIGHT_PALETTE.card, '#ffffff');
  assert.equal(LOGIN_LIGHT_PALETTE.text, '#0f1216');
  assert.equal(LOGIN_LIGHT_PALETTE.accent, '#202727');
  assert.equal(LOGIN_LIGHT_PALETTE.accentDeep, '#0040c8');
  assert.equal(LOGIN_LIGHT_PALETTE.accentText, '#ffffff');
  assert.equal(LOGIN_LIGHT_PALETTE.inputFill, '#ffffff');
  assert.equal(LOGIN_LIGHT_PALETTE.error, '#d92d20');
});

test('dark palette mirrors every light key with an elevated dark card', () => {
  assert.deepEqual(Object.keys(LOGIN_DARK_PALETTE).sort(), Object.keys(LOGIN_LIGHT_PALETTE).sort());
  assert.equal(LOGIN_DARK_PALETTE.backgroundTop, '#151719');
  assert.equal(LOGIN_DARK_PALETTE.backgroundBottom, '#151719');
  assert.equal(LOGIN_DARK_PALETTE.card, '#1c1f23');
  assert.equal(LOGIN_DARK_PALETTE.text, '#f3f5f9');
  assert.equal(LOGIN_DARK_PALETTE.accent, '#e8efec');
  assert.equal(LOGIN_LIGHT_PALETTE.accentLabel, '#157858');
  assert.equal(LOGIN_DARK_PALETTE.accentLabel, '#9cb8ff');
  assert.equal(LOGIN_DARK_PALETTE.accentText, '#151719');
  assert.equal(LOGIN_DARK_PALETTE.error, '#f97066');
  // Every palette channel must be present — no partially defined scheme can
  // leave a control painting an undefined color.
  for (const [name, palette] of [['light', LOGIN_LIGHT_PALETTE], ['dark', LOGIN_DARK_PALETTE]] as const) {
    for (const [key, value] of Object.entries(palette)) {
      assert.equal(typeof value, 'string', `${name}.${key} must be a string`);
      assert.ok(value.length > 0, `${name}.${key} must not be empty`);
    }
  }
});

test('login controls preserve usable hit targets and restrained corners', () => {
  assert.equal(LOGIN_VISUAL_CONTRACT.input.radius, 8);
  assert.equal(LOGIN_VISUAL_CONTRACT.input.minHeight, 52);
  assert.equal(LOGIN_VISUAL_CONTRACT.button.radius, 8);
  assert.equal(LOGIN_VISUAL_CONTRACT.button.minHeight, 50);
  assert.equal(LOGIN_VISUAL_CONTRACT.segmented.radius, 8);
  assert.equal(LOGIN_VISUAL_CONTRACT.entrance.durationMs, 280);
  assert.equal(LOGIN_VISUAL_CONTRACT.entrance.translateY, 14);
  assert.equal(LOGIN_VISUAL_CONTRACT.providerButton.filterTransition.durationMs, 120);
  assert.equal(LOGIN_VISUAL_CONTRACT.providerButton.focusVisible.width, 2);
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
  assert.match(source, /loginPalette\(scheme\)/);
  assert.match(source, /providerButtonLayerTargets/);
  assert.match(source, /Animated\.timing\(hoverOpacity/);
  assert.match(source, /Animated\.timing\(activeOpacity/);
  assert.match(source, /onHoverIn=/);
  assert.match(source, /onHoverOut=/);
  assert.match(source, /onPressIn=/);
  assert.match(source, /onPressOut=/);
  assert.match(source, /reduceProviderButtonInteraction/);
  assert.match(source, /IOS_MOTION\.duration\.content|LOGIN_ENTRANCE\.durationMs/);
  assert.match(source, /IOS_MOTION\.duration\.press/);
  assert.match(source, /motion\.duration\(LOGIN_ENTRANCE\.durationMs\)/);
  assert.match(source, /motion\.reduceMotion \? 0 : LOGIN_ENTRANCE\.translateY/);
  assert.match(source, /providerButtonFocusRing/);
  assert.match(source, /accessibilityLabel=\{label\}/);
  assert.ok((source.match(/accessible=\{false\}/g) ?? []).length >= 2);
  assert.ok((source.match(/accessibilityElementsHidden/g) ?? []).length >= 2);
  assert.ok(
    (source.match(/importantForAccessibility="no-hide-descendants"/g) ?? []).length >= 2,
  );
  assert.doesNotMatch(source, /(?:hoverOpacity|activeOpacity)\.setValue/);
  assert.doesNotMatch(source, /enableNativeCSSParsing/);
  assert.doesNotMatch(source, /inputRange:\s*\[0,\s*1,\s*2\]/);
});

test('LoginScreen paints through the palette — no literal colors in the component', () => {
  const source = readFileSync(resolve(projectRoot, 'src/auth/LoginScreen.tsx'), 'utf8');

  // Every painted color routes through the palette object; hex/rgb literals
  // belong to the contract file only.
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(source, /rgba?\(/);
  assert.match(source, /palette\.accent\b/);
  assert.match(source, /palette\.inputFill/);
  assert.match(source, /palette\.errorSoft/);
});

test('LoginScreen keeps the appearance toggle wired to the persisted scheme', () => {
  const source = readFileSync(resolve(projectRoot, 'src/auth/LoginScreen.tsx'), 'utf8');

  assert.match(source, /appearanceStorageKey/);
  assert.match(source, /AsyncStorage\.getItem\(appearanceStorageKey\)/);
  assert.match(source, /AsyncStorage\.setItem\(appearanceStorageKey, next\)/);
  assert.match(source, /const next: LoginColorScheme = scheme === 'light' \? 'dark' : 'light'/);
  assert.match(source, /style=\{scheme === 'light' \? 'dark' : 'light'\}/);
  assert.match(source, /SunGlyph/);
  assert.match(source, /MoonGlyph/);
});

test('LoginScreen preserves the auth flow affordances of the previous screen', () => {
  const source = readFileSync(resolve(projectRoot, 'src/auth/LoginScreen.tsx'), 'utf8');

  // Face ID lock surface
  assert.match(source, /使用 Face ID 解锁/);
  assert.match(source, /MAX_FACE_ID_ATTEMPTS/);
  assert.match(source, /revealRememberedPassword/);
  // Registration verification flow
  assert.match(source, /requestRegistrationCode/);
  assert.match(source, /textContentType="oneTimeCode"/);
  assert.match(source, /发送验证码/);
  // Credential autofill chains
  assert.match(source, /textContentType=\{mode === 'register' \? 'newPassword' : 'password'\}/);
  assert.match(source, /autoComplete=\{mode === 'register' \? 'new-password' : 'current-password'\}/);
  assert.match(source, /scrollEventThrottle=\{8\}/);
});
