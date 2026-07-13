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

test('native v2 registers every frozen WebUI destination', async () => {
  const { HERMES_NATIVE_ROUTES } = await import('../src/app/route-registry');

  assert.deepEqual(
    HERMES_NATIVE_ROUTES,
    [
      { id: 'chat', label: '单聊', title: '单聊' },
      { id: 'sessions', label: '会话', title: '会话' },
      { id: 'models', label: '模型', title: '模型' },
      { id: 'logs', label: '日志', title: '日志' },
      { id: 'cron', label: '定时任务', title: '定时任务' },
      { id: 'skills', label: '技能', title: '技能' },
      { id: 'plugins', label: '插件管理', title: '插件管理' },
      { id: 'mcp', label: 'MCP', title: 'MCP' },
      { id: 'channels', label: '消息渠道', title: '消息渠道' },
      { id: 'webhooks', label: '网络钩子', title: '网络钩子' },
      { id: 'pairing', label: '设备配对', title: '设备配对' },
      { id: 'profiles', label: '多Agent配置', title: '多Agent配置' },
      { id: 'config', label: '配置', title: '配置' },
      { id: 'env', label: '密钥', title: '密钥' },
      { id: 'system', label: '系统监控', title: '系统监控' },
      { id: 'docs', label: '文档', title: '文档' },
      { id: 'kanban', label: '看板', title: '看板' },
      { id: 'achievements', label: '成就', title: '成就' },
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

  assert.equal(appConfig.expo.ios.bundleIdentifier, 'com.given33.hermesagent.nativebeta');
  assert.equal(appConfig.expo.version, '2.0.0-beta.1');
  assert.equal(appConfig.expo.ios.buildNumber, '9');
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
