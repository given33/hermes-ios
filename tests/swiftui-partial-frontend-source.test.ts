import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(projectRoot, path), 'utf8');

test('signed iOS builds use the partial SwiftUI frontend without replacing chat', () => {
  const config = JSON.parse(
    read('modules/hermes-ios-controls/expo-module.config.json'),
  ) as { apple?: { modules?: string[] } };
  const bridge = read('modules/hermes-ios-controls/index.ts');
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const routes = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const preview = read('src/preview/FrontendPreviewApp.tsx');

  assert.ok(
    config.apple?.modules?.includes('HermesSwiftUIPartialFrontendModule'),
  );
  assert.match(bridge, /HermesSwiftUISidebarView/);
  assert.match(bridge, /HermesSwiftUIRouteView/);
  assert.match(bridge, /HermesSwiftUIModelToolsView/);
  assert.match(bridge, /HermesSwiftUIFrostedSurfaceView/);
  assert.match(native, /View\(HermesSwiftUISidebarView\.self\)/);
  assert.match(native, /View\(HermesSwiftUIRouteView\.self\)/);
  assert.match(native, /View\(HermesSwiftUIModelToolsView\.self\)/);
  assert.match(native, /View\(HermesSwiftUIFrostedSurfaceView\.self\)/);
  assert.match(routes, /case \.chat:[\s\S]*EmptyView\(\)/);
  assert.doesNotMatch(routes, /case \.chat:[\s\S]*HermesChatPage\(/);
  assert.match(preview, /route\.routeId !== 'chat'/);
  assert.match(preview, /<ChatPreviewPage/);
  assert.equal(
    existsSync(resolve(
      projectRoot,
      'modules/hermes-ios-controls/ios/HermesSwiftUIChat.swift',
    )),
    false,
  );
  assert.equal(
    existsSync(resolve(
      projectRoot,
      'modules/hermes-ios-controls/ios/HermesSwiftUIFrontendModule.swift',
    )),
    false,
  );
});

test('SwiftUI owns one synchronized sidebar transition and native page navigation', () => {
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const shell = read('src/app/NativeShell.tsx');

  assert.match(native, /private let hermesDrawerAnimation = Animation\.interactiveSpring/);
  assert.match(native, /withAnimation\(hermesDrawerAnimation\) \{ presented = true \}/);
  assert.match(native, /withAnimation\(hermesDrawerAnimation\) \{ presented = false \}/);
  assert.match(native, /NavigationStack \{/);
  assert.match(native, /DragGesture\(minimumDistance: 8/);
  assert.match(shell, /useSwiftUISidebar \? \(/);
  assert.match(shell, /<HermesSwiftUISidebarView/);
  const compactBranchStart = shell.indexOf("{state.mode === 'compact' ? (");
  const swiftUIBranchStart = shell.indexOf('useSwiftUISidebar ? (', compactBranchStart);
  const fallbackBranchStart = shell.indexOf(') : (\n        <Fragment>', swiftUIBranchStart);
  assert.ok(compactBranchStart >= 0 && swiftUIBranchStart > compactBranchStart);
  assert.ok(fallbackBranchStart > swiftUIBranchStart);
  assert.doesNotMatch(
    shell.slice(swiftUIBranchStart, fallbackBranchStart),
    /overlayStyle|drawerTranslationStyle/,
  );
});

test('the composer is SwiftUI frosted material and model tools stay native', () => {
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const chat = read('src/preview/PreviewChatPage.tsx');

  assert.match(native, /\.fill\(\.regularMaterial\)/);
  assert.match(native, /Children\(\)/);
  assert.match(native, /struct HermesSwiftUIModelToolsView/);
  assert.match(native, /Picker\(chinese \? "推理强度"/);
  assert.match(chat, /<HermesSwiftUIFrostedSurfaceView/);
  assert.match(chat, /<HermesSwiftUIModelToolsView/);
  assert.doesNotMatch(chat, /<GlassView|<HermesLiquidGlassView/);
});
