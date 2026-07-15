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
  const hostedViews = [
    'HermesSwiftUISidebarView',
    'HermesSwiftUIRouteView',
    'HermesSwiftUIModelToolsView',
    'HermesSwiftUIFrostedSurfaceView',
  ];
  for (const view of hostedViews) {
    assert.match(
      native,
      new RegExp(
        `struct ${view}: ExpoSwiftUI\\.View, ExpoSwiftUI\\.WithHostingView`,
      ),
      `${view} must mount through a concrete HostingView`,
    );
  }
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
  assert.match(native, /struct HermesProMotionDriver: UIViewRepresentable/);
  assert.match(native, /UIScreen\.main\.maximumFramesPerSecond/);
  assert.match(native, /preferredFrameRateRange = CAFrameRateRange/);
  assert.match(native, /minimum: maximum >= 120 \? 80 : maximumRate/);
  assert.match(native, /link\.add\(to: \.main, forMode: \.common\)/);
  assert.match(native, /withAnimation\(hermesDrawerAnimation\) \{ presented = true \}/);
  assert.match(native, /withAnimation\(hermesDrawerAnimation\) \{ presented = false \}/);
  assert.match(native, /NavigationStack \{/);
  assert.doesNotMatch(native, /navigationTitle\("Hermes Agent"\)/);
  assert.match(native, /Text\("Hermes Agent"\)\s*\.font\(\.largeTitle\.bold\(\)\)/);
  assert.match(native, /\.listRowSeparator\(\.hidden\)/);
  assert.match(
    native,
    /private func select\(_ route: HermesRoute\) \{\s*feedbackTrigger \+= 1\s*props\.onNavigate\(\["path": route\.path\]\)\s*\}/,
  );
  assert.doesNotMatch(native, /props\.onNavigate\(\["path": route\.path\]\)\s*if isDrawer/);
  assert.match(native, /DragGesture\(minimumDistance: 8/);
  assert.match(native, /var onReady = EventDispatcher\(\)/);
  assert.match(native, /DispatchQueue\.main\.asyncAfter\(deadline: \.now\(\) \+ 0\.025\)/);
  assert.match(native, /props\.onReady\(\["path": path\]\)/);
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

test('the composer keeps RN controls above a SwiftUI material background', () => {
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const chat = read('src/preview/PreviewChatPage.tsx');

  assert.match(native, /\.fill\(\.regularMaterial\)/);
  assert.doesNotMatch(native, /Children\(\)/);
  assert.match(native, /struct HermesSwiftUIModelToolsView/);
  assert.match(native, /Picker\(chinese \? "推理强度"/);
  assert.match(native, /@State private var selectedReasoning = "medium"/);
  assert.match(native, /selectedReasoning = \$0\s*props\.onReasoningChange/);
  assert.match(native, /selectedModel = \$0\s*props\.onModelChange/);
  assert.match(chat, /<View style=\{surfaceStyle\}>/);
  assert.match(chat, /<HermesSwiftUIFrostedSurfaceView/);
  assert.match(chat, /styles\.composerFrostedBackground/);
  assert.match(chat, /borderWidth: usesNativeFrostedSurface \? 0 : 1/);
  assert.match(chat, /<HermesSwiftUIModelToolsView/);
  assert.doesNotMatch(chat, /<GlassView|<HermesLiquidGlassView/);
});

test('SwiftUI partial pages inherit the active Hermes theme instead of a fixed palette', () => {
  const bridge = read('modules/hermes-ios-controls/index.ts');
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const shell = read('src/app/NativeShell.tsx');
  const preview = read('src/preview/FrontendPreviewApp.tsx');

  assert.match(bridge, /interface HermesSwiftUIThemeProps/);
  assert.match(native, /protocol HermesThemeProviding/);
  assert.match(native, /props\.applyTheme\(to: appearance\)/);
  assert.match(native, /\.listStyle\(\.insetGrouped\)/);
  assert.match(native, /\.font\(HermesFonts\.body\(15\)\)/);
  assert.match(native, /\.padding\(14\)/);
  assert.doesNotMatch(native, /\.background\(\.ultraThinMaterial\)/);
  assert.doesNotMatch(native, /\.frame\(minHeight: 58\)/);
  assert.match(shell, /\.\.\.swiftUIThemeProps/);
  assert.match(shell, /<SymbolView[\s\S]*name=\{route\.symbol\}[\s\S]*size=\{18\}/);
  assert.match(shell, /referenceSidebarRow:[\s\S]*minHeight: 44/);
  assert.match(preview, /\.\.\.resolveSwiftUIThemeProps\(tokens\)/);
});
