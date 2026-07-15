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
    /untransformedBottom[\s\S]*composerRect\.bottom\s*-\s*currentKeyboardNudge/,
  );
  assert.match(appSource, /Math\.min\(72,\s*Math\.max\(0,/);
  assert.match(appSource, /new MutationObserver\(bindComposerObserver\)/);
  assert.match(appSource, /mutationObserver\?\.disconnect\(\)/);
  assert.match(appSource, /new ResizeObserver\(settleViewport\)/);
  assert.match(appSource, /window\.__HERMES_SYNC_VIEWPORT__\s*=\s*settleViewport/);
  assert.match(appSource, /type:\s*'viewport-metrics'/);
  assert.match(appSource, /new CustomEvent\('hermes:viewport-change'/);
});

test('the native bridge suspends network work and stops broad DOM observation', () => {
  assert.match(appSource, /new CustomEvent\('hermes:app-background'\)/);
  assert.match(appSource, /new CustomEvent\('hermes:app-resume'\)/);
  assert.match(
    appSource,
    /if \(composer\)[\s\S]*mutationObserver\?\.disconnect\(\)/,
  );
  assert.doesNotMatch(appSource, /window\.dispatchEvent\(new Event\('focus'\)\)/);
  assert.doesNotMatch(appSource, /document\.dispatchEvent\(new Event\('visibilitychange'\)\)/);
});

test('subresource 5xx responses do not mark the whole WebView as failed', () => {
  assert.match(
    appSource,
    /nativeEvent\.statusCode >= 500 && isHermesMainDocument\(nativeEvent\.url\)/,
  );
});

test('release checks bypass stale GitHub API caches', () => {
  assert.match(appSource, /cache:\s*'no-store'/);
  assert.match(appSource, /GITHUB_LATEST_RELEASE_API.*Date\.now\(\)/s);
});

test('cold startup restores the saved route before mounting one web view', () => {
  assert.match(appSource, /useState<string \| null>\(null\)/);
  assert.match(
    appSource,
    /SecureStore\.getItemAsync\(LAST_PAGE_KEY\)[\s\S]*setSourceUrl\(/,
  );
  assert.match(appSource, /sourceUrl\s*\?\s*\([\s\S]*<WebView/);
  assert.doesNotMatch(appSource, /useState\(buildHermesUrl\(\)\)/);
});

test('release checks wait until the first Hermes page is ready', () => {
  assert.match(appSource, /const \[webReady, setWebReady\] = useState\(false\)/);
  assert.match(appSource, /message\.type === 'ready'[\s\S]*setWebReady\(true\)/);
  assert.match(appSource, /releaseCheckStartedRef\.current/);
  assert.match(
    appSource,
    /if \(!webReady \|\| releaseCheckStartedRef\.current\) return/,
  );
});

test('the 1.0.7 release increments both app and native build versions', () => {
  assert.equal(appConfig.expo.version, '1.0.7');
  assert.equal(appConfig.expo.ios.buildNumber, '8');
  assert.equal(packageConfig.version, '1.0.7');
});
