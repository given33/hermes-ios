import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(projectRoot, path), 'utf8');

const wholePageSwiftUISources = [
  'modules/hermes-ios-controls/ios/HermesSwiftUIAdminPages.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUIAutomationPages.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUIChat.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUIDesign.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUIFrontendModule.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUILoginModule.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift',
] as const;

test('React Native owns the app root, navigation, and visible pages', () => {
  const appRoot = read('App.tsx');
  const entry = read('index.ts');
  const app = read('src/app/HermesNativeApp.tsx');

  assert.match(entry, /import 'react-native-gesture-handler'/);
  assert.match(appRoot, /<GestureHandlerRootView/);
  assert.match(appRoot, /<SafeAreaProvider>/);
  assert.match(app, /<FrontendPreviewApp/);
  assert.match(app, /<LoginScreen/);
  assert.match(app, /<NativeShell/);
  assert.doesNotMatch(app, /HermesSwiftUI(?:Frontend|Login)View/);
});

test('whole-page SwiftUI frontend modules are absent from the hybrid build', () => {
  const config = read('modules/hermes-ios-controls/expo-module.config.json');
  const bridge = read('modules/hermes-ios-controls/index.ts');

  for (const path of wholePageSwiftUISources) {
    assert.equal(existsSync(resolve(projectRoot, path)), false, `${path} must stay removed`);
  }
  assert.doesNotMatch(config, /HermesSwiftUI(?:Frontend|Login)Module/);
  assert.doesNotMatch(bridge, /HermesSwiftUI(?:Frontend|Login)/);
});

test('SwiftUI remains limited to leaf controls mounted by React Native', () => {
  const config = JSON.parse(
    read('modules/hermes-ios-controls/expo-module.config.json'),
  ) as { apple: { modules: string[] } };
  const expectedModules = [
    'HermesSearchBarModule',
    'HermesSelectionModule',
    'HermesPressFeedbackModule',
    'HermesAlertPresenterModule',
    'HermesTextInputModule',
    'HermesDrawerSurfaceModule',
    'HermesConfirmationDialogModule',
  ];

  assert.deepEqual(config.apple.modules, expectedModules);
  for (const name of expectedModules) {
    const source = read(`modules/hermes-ios-controls/ios/${name}.swift`);
    assert.match(source, /import SwiftUI/);
    assert.match(source, /ExpoSwiftUI\.View, ExpoSwiftUI\.WithHostingView/);
    assert.doesNotMatch(source, /import UIKit/);
  }
});

test('signed preview keeps the RN page tree and has no WebView runtime', () => {
  const previewSources = [
    'src/preview/FrontendPreviewApp.tsx',
    'src/preview/PreviewChatPage.tsx',
    'src/preview/PreviewCorePages.tsx',
    'src/preview/PreviewAutomationPages.tsx',
    'src/preview/PreviewSettingsPages.tsx',
    'src/app/NativeShell.tsx',
  ].map(read).join('\n');

  assert.match(previewSources, /from 'react-native'/);
  assert.match(previewSources, /NativeShell/);
  assert.match(previewSources, /ChatPreviewPage/);
  assert.doesNotMatch(previewSources, /WebView|WKWebView|document\.|window\.|<iframe/);
});
