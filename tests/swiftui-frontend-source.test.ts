import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(projectRoot, path), 'utf8');

const swiftUIFiles = [
  'modules/hermes-ios-controls/ios/HermesSwiftUIDesign.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUIFrontendModule.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUIChat.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUIAutomationPages.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUIAdminPages.swift',
  'modules/hermes-ios-controls/ios/HermesSwiftUILoginModule.swift',
] as const;

test('iOS entry mounts only the SwiftUI login and frontend surfaces', () => {
  const appRoot = read('App.tsx');
  const app = read('src/app/HermesNativeApp.tsx');
  const bridge = read('modules/hermes-ios-controls/index.ts');
  const config = read('modules/hermes-ios-controls/expo-module.config.json');
  const unsignedWorkflow = read('.github/workflows/ios-unsigned.yml');

  assert.match(app, /FRONTEND_PREVIEW = process\.env\.EXPO_PUBLIC_FRONTEND_PREVIEW === '1'/);
  assert.match(app, /FRONTEND_PREVIEW && hasNativeSwiftUIFrontend/);
  assert.doesNotMatch(app, /__DEV__/);
  assert.match(app, /<HermesSwiftUIFrontendView/);
  assert.match(app, /<HermesSwiftUILoginView/);
  assert.doesNotMatch(app, /FrontendPreviewApp|NativeShell|LoginScreen|ThemeProvider|ThemedStatusBar/);
  assert.match(appRoot, /return <HermesNativeApp \/>/);
  assert.doesNotMatch(appRoot, /GestureHandlerRootView|SafeAreaProvider|<View/);
  assert.match(bridge, /optionalView<HermesSwiftUIFrontendProps>\(/);
  assert.match(bridge, /optionalView<HermesSwiftUILoginProps>\(/);
  assert.match(config, /HermesSwiftUIFrontendModule/);
  assert.match(config, /HermesSwiftUILoginModule/);
  assert.match(unsignedWorkflow, /EXPO_PUBLIC_FRONTEND_PREVIEW: '1'/);
});

test('signed frontend source has no RN, Reanimated, UIKit, or WebView surface', () => {
  const nativeFrontend = swiftUIFiles.map(read).join('\n');

  assert.match(nativeFrontend, /import SwiftUI/);
  assert.doesNotMatch(
    nativeFrontend,
    /import UIKit|UIView|UIViewController|React Native|react-native|Reanimated|Animated\.|Pressable|WKWebView|WebView/,
  );
});

test('SwiftUI owns full phone and iPad navigation plus every Hermes route', () => {
  const frontend = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIFrontendModule.swift',
  );
  const pages = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift',
  );

  assert.match(frontend, /NavigationSplitView/);
  assert.match(frontend, /NavigationStack/);
  assert.match(frontend, /navigationSplitViewStyle\(\.balanced\)/);
  assert.match(frontend, /List\(selection: \$selection\)/);
  assert.match(frontend, /ToolbarItemGroup\(placement: \.navigationBarTrailing\)/);
  assert.doesNotMatch(frontend, /onChange\(of: selectedRoute\)/);
  assert.doesNotMatch(frontend, /columnVisibility = \.detailOnly/);

  for (const route of [
    'chat', 'sessions', 'files', 'analytics', 'models', 'logs', 'cron',
    'skills', 'plugins', 'mcp', 'pairing', 'channels', 'webhooks',
    'achievements', 'collaboration', 'kanban', 'profiles', 'config',
    'env', 'system', 'docs',
  ]) {
    assert.match(frontend, new RegExp(`case ${route}(?:\\r?\\n|$)`));
    assert.match(pages, new RegExp(`case \\.${route}:`));
  }
});

test('chat composer, messages, gestures, sheets, and effects are native SwiftUI', () => {
  const app = read('src/app/HermesNativeApp.tsx');
  const attachmentBridge = read('src/app/native-frontend-attachments.ts');
  const chat = read('modules/hermes-ios-controls/ios/HermesSwiftUIChat.swift');
  const design = read('modules/hermes-ios-controls/ios/HermesSwiftUIDesign.swift');
  const frontend = read('modules/hermes-ios-controls/ios/HermesSwiftUIFrontendModule.swift');

  assert.match(chat, /@FocusState private var composerFocused/);
  assert.match(chat, /private static let bottomAnchor/);
  assert.match(chat, /\.onChange\(of: composerFocused\)/);
  assert.match(chat, /proxy\.scrollTo\(Self\.bottomAnchor, anchor: \.bottom\)/);
  assert.match(chat, /TextField\([\s\S]*axis: \.vertical/);
  assert.match(chat, /\.safeAreaInset\(edge: \.bottom/);
  assert.match(chat, /Menu \{/);
  assert.match(chat, /DisclosureGroup\(isExpanded:/);
  assert.match(chat, /\.sheet\(isPresented: \$toolsOpen\)/);
  assert.match(chat, /\.transition\([\s\S]*\.move\(edge: \.bottom\)/);
  assert.match(chat, /TimelineView\(\.animation\(minimumInterval: 1\.0 \/ 120\.0\)\)/);
  assert.match(chat, /\.spring\(response:/);
  assert.match(chat, /attachmentIds/);
  assert.match(chat, /attachmentNames/);
  assert.match(chat, /onAction\("remove-attachment", attachment\.id\)/);
  assert.match(attachmentBridge, /ImagePicker\.launchCameraAsync/);
  assert.match(attachmentBridge, /ImagePicker\.launchImageLibraryAsync/);
  assert.match(attachmentBridge, /DocumentPicker\.getDocumentAsync/);
  assert.match(app, /attachmentIds=\{attachments\.map/);
  assert.match(app, /attachmentNames=\{attachments\.map/);
  assert.match(app, /\.catch\(\(\) => \{/);
  assert.match(frontend, /onAction\("dismiss-error", nil\)/);
  assert.match(design, /Canvas\(colorMode: \.linear, rendersAsynchronously: true\)/);
  assert.match(design, /TimelineView\(\.animation\(minimumInterval: 1\.0 \/ 120\.0\)\)/);
  assert.match(design, /\.sensoryFeedback\(\.impact\(weight: \.light\)/);
  assert.match(design, /UserDefaults\.standard\.set\(theme\.rawValue/);
  assert.match(design, /UserDefaults\.standard\.set\(compactDensity/);
});

test('every SwiftUI route is interactive frontend state without empty actions', () => {
  const pages = swiftUIFiles.map(read).join('\n');

  assert.doesNotMatch(pages, /Button\s*\{\s*\}/);
  assert.doesNotMatch(pages, /(?:selection|isOn|text): \.constant\(/);
  assert.match(pages, /\.sheet\(item: \$selectedFile\)/);
  assert.match(pages, /\.sheet\(item: \$selectedSkill\)/);
  assert.match(pages, /editTarget = item/);
  assert.match(pages, /soulTarget = profile/);
  assert.match(pages, /private var filteredLogs:/);
  assert.match(pages, /private var filteredDocuments:/);
  assert.match(pages, /prompt: newPrompt\.isEmpty/);
  assert.match(pages, /notes: skillTextBinding/);
  assert.match(pages, /onChange: updateProfile/);
  assert.match(pages, /importConfiguration\(from: url\)/);
  assert.match(pages, /guard applied else/);
  assert.match(pages, /firstIndex\(where: \{ \$0\.id == profile\.id \}\)/);
  assert.match(pages, /attachmentIds/);
});

test('login, fonts, and system controls are rendered by SwiftUI', () => {
  const login = read('modules/hermes-ios-controls/ios/HermesSwiftUILoginModule.swift');
  const design = read('modules/hermes-ios-controls/ios/HermesSwiftUIDesign.swift');
  const pages = [
    read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift'),
    read('modules/hermes-ios-controls/ios/HermesSwiftUIAutomationPages.swift'),
    read('modules/hermes-ios-controls/ios/HermesSwiftUIAdminPages.swift'),
  ].join('\n');

  assert.match(login, /SecureField\(/);
  assert.match(login, /@FocusState private var focusedField/);
  assert.match(login, /Image\(systemName: "faceid"\)/);
  assert.match(login, /withAnimation\(\.easeOut\(duration: 0\.6\)\)/);
  for (const font of [
    'RulesExpanded-Bold',
    'RulesCompressed-Medium',
    'Collapse-Regular',
    'Collapse-Bold',
    'Mondwest-Regular',
    'JetBrainsMono-Regular',
  ]) {
    assert.ok(design.includes(font), `missing SwiftUI Hermes font ${font}`);
  }
  for (const nativeControl of [
    'swipeActions', 'contextMenu', 'fileImporter', 'ShareLink', 'Chart',
    'DatePicker', 'Toggle', 'Picker', 'ProgressView', 'confirmationDialog',
    'DisclosureGroup', 'SecureField', 'TextEditor', 'dropDestination',
  ]) {
    assert.ok(pages.includes(nativeControl), `missing native SwiftUI control ${nativeControl}`);
  }
});
