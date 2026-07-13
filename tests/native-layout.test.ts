import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../App.tsx'),
  'utf8',
);
const appConfig = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../app.json'), 'utf8'),
);
const packageConfig = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
);

test('the web view owns the full screen safe area without native double padding', () => {
  assert.match(appSource, /useSafeAreaInsets/);
  assert.doesNotMatch(appSource, /SafeAreaView/);
  assert.match(appSource, /top:\s*insets\.top\s*\+\s*8/);
  assert.match(appSource, /automaticallyAdjustContentInsets=\{false\}/);
  assert.match(appSource, /contentInset=\{\{ top: 0, right: 0, bottom: 0, left: 0 \}\}/);
  assert.match(appSource, /dataset\.hermesKeyboard/);
  assert.match(appSource, /padding-bottom:\s*3px\s*!important/);
  assert.match(appSource, /--hermes-composer-keyboard-nudge/);
  assert.match(
    appSource,
    /viewportBottom\s*-\s*composer\.getBoundingClientRect\(\)\.bottom\s*-\s*4/,
  );
  assert.match(appSource, /Math\.min\(56,\s*Math\.max\(0,/);
  assert.match(appSource, /keyboardGap\s*\+\s*currentKeyboardNudge/);
  assert.match(appSource, /new CustomEvent\('hermes:viewport-change'/);
});

test('release checks bypass stale GitHub API caches', () => {
  assert.match(appSource, /cache:\s*'no-store'/);
  assert.match(appSource, /GITHUB_LATEST_RELEASE_API.*Date\.now\(\)/s);
});

test('the 1.0.4 release increments both app and native build versions', () => {
  assert.equal(appConfig.expo.version, '1.0.4');
  assert.equal(appConfig.expo.ios.buildNumber, '5');
  assert.equal(packageConfig.version, '1.0.4');
});
