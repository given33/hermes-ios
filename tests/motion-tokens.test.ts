import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { IOS_MOTION } from '../src/design/ios-motion';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// motion.ts imports react-native-reanimated (for useReducedMotion), which
// cannot load under node:test, so the contract is pinned against the source.
const motionSource = readFileSync(resolve(projectRoot, 'src/design/motion.ts'), 'utf8');

test('motion tokens sit inside the Studio parity bands', () => {
  // docs/architecture/hermes-studio-mobile-parity.md: controls 150-250 ms,
  // transitions 160-260 ms, interruptible, Reduce Motion aware.
  assert.ok(
    IOS_MOTION.duration.press >= 150 && IOS_MOTION.duration.press <= 250,
    `press ${IOS_MOTION.duration.press}ms escapes the 150-250ms control band`,
  );
  assert.ok(
    IOS_MOTION.duration.control >= 150 && IOS_MOTION.duration.control <= 250,
    `control ${IOS_MOTION.duration.control}ms escapes the 150-250ms control band`,
  );
  assert.match(motionSource, /press: IOS_MOTION\.duration\.press/);
  assert.match(motionSource, /control: IOS_MOTION\.duration\.control/);

  const transition = Number(motionSource.match(/transition: (\d+)/)?.[1]);
  assert.ok(
    transition >= 160 && transition <= 260,
    `transition ${transition}ms escapes the 160-260ms transition band`,
  );
});

test('useMotion honors the OS Reduce Motion switch for both timing and mount animations', () => {
  assert.match(motionSource, /useReducedMotion/);
  // Timing durations collapse to 0 (snap, still interruptible)…
  assert.match(motionSource, /reduceMotion \? 0 : baseMs/);
  // …and entering/exiting props are dropped entirely.
  assert.match(motionSource, /reduceMotion \? undefined : animation/);
});
