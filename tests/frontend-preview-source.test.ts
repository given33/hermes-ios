import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

test('frontend preview renders every customized WebUI route without API ownership', () => {
  const app = read('src/preview/FrontendPreviewApp.tsx');
  const previewSources = [
    app,
    read('src/preview/PreviewCorePages.tsx'),
    read('src/preview/PreviewAutomationPages.tsx'),
    read('src/preview/PreviewSettingsPages.tsx'),
    read('src/preview/PreviewPluginPages.tsx'),
    read('src/preview/PreviewPrimitives.tsx'),
    read('src/preview/preview-fixtures.ts'),
  ].join('\n');

  for (const routeId of [
    'chat',
    'sessions',
    'files',
    'analytics',
    'models',
    'logs',
    'cron',
    'skills',
    'plugins',
    'mcp',
    'pairing',
    'channels',
    'webhooks',
    'system',
    'profiles',
    'profile-new',
    'config',
    'env',
    'docs',
  ]) {
    assert.match(app, new RegExp(`case '${routeId}'`));
  }
  for (const plugin of [
    'collaboration',
    'hermes-achievements',
    'kanban',
  ]) {
    assert.match(app, new RegExp(`route\\.pluginName === '${plugin}'`));
  }

  assert.doesNotMatch(previewSources, /HermesApiClient|useAuth|\bapi\.[a-z]/);
  assert.doesNotMatch(previewSources, /from ['"][^'"]*\/api\//);
  assert.doesNotMatch(previewSources, /WebView|WKWebView|react-native-webview/);
});

test('Expo Go fallback never replaces the exact blur in signed native builds', () => {
  const bridge = read('modules/hermes-live-blur/index.ts');
  const nativeBlur = read('modules/hermes-live-blur/ios/HermesLiveBlurView.swift');
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
  };

  assert.match(bridge, /requireOptionalNativeModule\('HermesLiveBlur'\)/);
  assert.match(bridge, /requireNativeViewManager<.*>\('HermesLiveBlur'\)/s);
  assert.match(bridge, /return createElement\(View, viewProps\)/);
  assert.equal(packageJson.dependencies['expo-blur'], undefined);
  assert.match(nativeBlur, /String\("retliFAC"\.reversed\(\)\)/);
  assert.match(nativeBlur, /String\("rulBnaissuag"\.reversed\(\)\)/);
  assert.match(nativeBlur, /backdropLayer\.filters = \[gaussianFilter\]/);
});

test('preview appearance persistence is limited to theme and font', () => {
  const themeProvider = read('src/design/ThemeProvider.tsx');
  const previewStart = themeProvider.indexOf(
    'export function FrontendPreviewThemeProvider',
  );
  const previewSource = themeProvider.slice(previewStart);

  assert.match(previewSource, /hermes\.preview\.theme/);
  assert.match(previewSource, /hermes\.preview\.font/);
  assert.doesNotMatch(previewSource, /HermesApiClient|setTheme\(value\)|setFontPref/);
});
