import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertHybridRootComposition,
  assertNoWebRuntime,
  assertReactNativeEntry,
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
      '/env',
      '/docs',
      '/chat',
    ],
  );
});

test('native v2 entry initializes the React Native gesture runtime', () => {
  assertReactNativeEntry(indexSource);
});

test('React Native entry guard rejects a missing gesture runtime', () => {
  assert.throws(
    () => assertReactNativeEntry(`
      import { registerRootComponent } from 'expo';
      import App from './App';
      registerRootComponent(App);
    `),
    /React Native entry/i,
  );
});

test('native v2 mounts the RN app inside gesture and safe-area providers', () => {
  assertHybridRootComposition(appSource);
});

test('hybrid root guard rejects incomplete provider composition', () => {
  assert.throws(
    () => assertHybridRootComposition(`
      export default function App() {
        return <SafeAreaProvider><HermesNativeApp /></SafeAreaProvider>;
      }
    `),
    /hybrid root composition/i,
  );
  assert.throws(
    () => assertHybridRootComposition(`
      export default function App() {
        return <GestureHandlerRootView><HermesNativeApp /></GestureHandlerRootView>;
      }
    `),
    /hybrid root composition/i,
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

  assert.equal(appConfig.expo.ios.bundleIdentifier, 'com.given33.hermesagent.nativebeta');
  assert.equal(appConfig.expo.version, '2.0.0-beta.1');
  assert.equal(appConfig.expo.ios.buildNumber, '13');
  assert.equal(appConfig.expo.userInterfaceStyle, 'automatic');
  assert.match(JSON.stringify(appConfig.expo.plugins), /"dark":\{"backgroundColor":"#000000"\}/);
  assert.equal(packageConfig.version, '2.0.0-beta.1');
  assert.deepEqual(
    pluginNames.filter((name: string) => [
      'expo-secure-store',
      'expo-notifications',
      'expo-local-authentication',
      'expo-image-picker',
      'expo-splash-screen',
    ].includes(name)),
    [
      'expo-secure-store',
      'expo-notifications',
      'expo-local-authentication',
      'expo-image-picker',
      'expo-splash-screen',
    ],
  );
  assert.ok(Array.isArray(secureStorePlugin));
  assert.equal(typeof secureStorePlugin[1].faceIDPermission, 'string');
});
