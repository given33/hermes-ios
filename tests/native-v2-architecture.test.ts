import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertGestureHandlerImportFirst,
  assertNativeRootComposition,
  assertNoWebRuntime,
  readNativeRuntimeSources,
} from './support/native-v2-architecture';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(resolve(projectRoot, 'App.tsx'), 'utf8');
const indexSource = readFileSync(resolve(projectRoot, 'index.ts'), 'utf8');
const appConfig = JSON.parse(readFileSync(resolve(projectRoot, 'app.json'), 'utf8'));
const packageConfig = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));

test('native v2 has no WebView runtime', () => {
  assertNoWebRuntime(readNativeRuntimeSources(projectRoot));
  assert.equal(packageConfig.dependencies['react-native-webview'], undefined);
});

test('native runtime guard rejects nested WebView, WKWebView, DOM, and iframe sources', () => {
  const forbiddenSources = [
    "import { WebView } from 'react-native-webview'; export const Panel = () => <WebView />;",
    'export const nativeView: WKWebView | null = null;',
    "export const bridge = () => document.querySelector('#root');",
    "export const Frame = () => <iframe title='legacy' />;",
  ];

  for (const source of forbiddenSources) {
    assert.throws(
      () => assertNoWebRuntime([{ path: 'src/features/nested/LegacyPanel.tsx', source }]),
      /forbidden web runtime/i,
    );
  }
});

test('native v2 registers the canonical WebUI core route paths', async () => {
  const { HERMES_NATIVE_ROUTES } = await import('../src/app/route-registry');

  assert.deepEqual(
    HERMES_NATIVE_ROUTES.map((route) => route.path),
    [
      '/',
      '/sessions',
      '/files',
      '/analytics',
      '/smart-weather',
      '/models',
      '/logs',
      '/cron',
      '/skills',
      '/plugins',
      '/mcp',
      '/pairing',
      '/channels',
      '/webhooks',
      '/system',
      '/profiles',
      '/profiles/new',
      '/config',
      '/account',
      '/env',
      '/docs',
      '/chat',
    ],
  );
});

test('native v2 loads gesture handler before any other entry statement', () => {
  assertGestureHandlerImportFirst(indexSource);
});

test('gesture handler entry guard rejects reordered imports', () => {
  assert.throws(
    () => assertGestureHandlerImportFirst(`
      import { registerRootComponent } from 'expo';
      import 'react-native-gesture-handler';
      import App from './App';
      registerRootComponent(App);
    `),
    /gesture handler import order/i,
  );
});

test('native v2 mounts the Hermes root inside native providers', () => {
  assertNativeRootComposition(appSource);
});

test('native root guard rejects reordered layers and extra wrappers', () => {
  assert.throws(
    () => assertNativeRootComposition(`
      export default function App() {
        return <SafeAreaProvider><GestureHandlerRootView><HermesNativeApp /></GestureHandlerRootView></SafeAreaProvider>;
      }
    `),
    /native root composition/i,
  );
  assert.throws(
    () => assertNativeRootComposition(`
      export default function App() {
        return <GestureHandlerRootView><SafeAreaProvider><View><HermesNativeApp /></View></SafeAreaProvider></GestureHandlerRootView>;
      }
    `),
    /native root composition/i,
  );
});

test('native v2 uses the isolated beta identity and required Expo plugins', () => {
  const pluginNames = appConfig.expo.plugins.map((plugin: string | [string, unknown]) =>
    typeof plugin === 'string' ? plugin : plugin[0],
  );
  const secureStorePlugin = appConfig.expo.plugins.find(
    (plugin: string | [string, Record<string, unknown>]) =>
      Array.isArray(plugin) && plugin[0] === 'expo-secure-store',
  );

  assert.equal(appConfig.expo.ios.bundleIdentifier, 'app.sunstone1029.fig1171');
  assert.equal(appConfig.expo.version, '2.0.0-beta.1');
  assert.equal(appConfig.expo.ios.buildNumber, '29');
  assert.equal(packageConfig.version, '2.0.0-beta.1');
  assert.deepEqual(
    pluginNames.filter((name: string) => [
      'expo-secure-store',
      'expo-notifications',
      'expo-image-picker',
      'expo-splash-screen',
    ].includes(name)),
    [
      'expo-secure-store',
      'expo-notifications',
      'expo-image-picker',
      'expo-splash-screen',
    ],
  );
  assert.ok(Array.isArray(secureStorePlugin));
  assert.equal(secureStorePlugin[1].faceIDPermission, undefined);
});
