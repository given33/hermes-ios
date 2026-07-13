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
});

test('release checks bypass stale GitHub API caches', () => {
  assert.match(appSource, /cache:\s*'no-store'/);
  assert.match(appSource, /GITHUB_LATEST_RELEASE_API.*Date\.now\(\)/s);
});

test('the 1.0.2 release increments both app and native build versions', () => {
  assert.equal(appConfig.expo.version, '1.0.2');
  assert.equal(appConfig.expo.ios.buildNumber, '3');
  assert.equal(packageConfig.version, '1.0.2');
});
