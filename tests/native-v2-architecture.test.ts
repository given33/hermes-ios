import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(resolve(projectRoot, 'App.tsx'), 'utf8');
const indexSource = readFileSync(resolve(projectRoot, 'index.ts'), 'utf8');
const appConfig = JSON.parse(readFileSync(resolve(projectRoot, 'app.json'), 'utf8'));
const packageConfig = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));

test('native v2 has no WebView runtime', () => {
  assert.doesNotMatch(appSource, /react-native-webview|<WebView|injectedJavaScript/);
  assert.equal(packageConfig.dependencies['react-native-webview'], undefined);
});

test('native v2 registers every frozen WebUI destination', async () => {
  const { HERMES_NATIVE_ROUTES } = await import('../src/app/route-registry');

  assert.deepEqual(
    HERMES_NATIVE_ROUTES.map((route) => route.id),
    ['chat', 'sessions', 'models', 'logs', 'cron', 'skills', 'plugins', 'mcp',
      'channels', 'webhooks', 'pairing', 'profiles', 'config', 'env', 'system',
      'docs', 'kanban', 'achievements'],
  );
});

test('native v2 mounts the Hermes root inside native providers', () => {
  assert.match(indexSource, /import ['"]react-native-gesture-handler['"]/);
  assert.match(appSource, /GestureHandlerRootView/);
  assert.match(appSource, /SafeAreaProvider/);
  assert.match(appSource, /HermesNativeApp/);
  assert.doesNotMatch(appSource, /NetInfo|FileSystem|SecureStore|Sharing/);
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
