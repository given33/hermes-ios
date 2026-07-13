import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { LOGIN_VISUAL_CONTRACT } from '../src/auth/login-visual-contract';

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

test('provider button contract preserves base, active invert, bevel, and interaction timing', () => {
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

test('LoginScreen consumes the pure visual contract instead of duplicating source values', () => {
  const source = readFileSync(resolve(projectRoot, 'src/auth/LoginScreen.tsx'), 'utf8');

  assert.match(source, /from '.\/login-visual-contract'/);
  assert.match(source, /LOGIN_VISUAL_CONTRACT/);
  assert.match(source, /Animated\.timing\(filterProgress/);
  assert.match(source, /PROVIDER_BUTTON\.active\.bevel\.top/);
  assert.match(source, /onPressIn=\{\(\) => animateFilter\(1\)\}/);
  assert.match(source, /onPressOut=\{\(\) => animateFilter\(0\)\}/);
  assert.match(source, /providerButtonFocusRing/);
  assert.doesNotMatch(source, /const LOGIN_DITHER_SIZE/);
  assert.doesNotMatch(source, /buttonDisabled:\s*\{[^}]*opacity/s);
});
