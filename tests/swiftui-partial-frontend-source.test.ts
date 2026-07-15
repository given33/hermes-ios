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
  ) as {
    apple?: { modules?: string[]; appDelegateSubscribers?: string[] };
  };
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
  const frameRate = read(
    'modules/hermes-ios-controls/ios/HermesFrameRateModule.swift',
  );
  const routes = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const bridge = read('modules/hermes-ios-controls/index.ts');
  const app = read('src/app/HermesNativeApp.tsx');
  const config = JSON.parse(
    read('modules/hermes-ios-controls/expo-module.config.json'),
  ) as {
    apple?: { modules?: string[]; appDelegateSubscribers?: string[] };
  };
  const shell = read('src/app/NativeShell.tsx');

  assert.match(native, /private let hermesDrawerAnimation = Animation\.interactiveSpring/);
  assert.doesNotMatch(native, /HermesProMotionDriver|CADisplayLink/);
  assert.ok(config.apple?.modules?.includes('HermesFrameRateModule'));
  assert.ok(
    config.apple?.appDelegateSubscribers?.includes(
      'HermesFrameRateAppDelegateSubscriber',
    ),
  );
  assert.match(frameRate, /Name\("HermesFrameRate"\)/);
  assert.match(frameRate, /Thread\.isMainThread/);
  assert.match(frameRate, /DispatchQueue\.main\.async/);
  assert.match(frameRate, /method_exchangeImplementations/);
  assert.match(frameRate, /HermesFrameRateAppDelegateSubscriber/);
  assert.match(frameRate, /subscriberDidRegister/);
  assert.match(frameRate, /getDiagnostics/);
  assert.match(frameRate, /runOnQueue\(\.main\)/);
  assert.match(frameRate, /measuredCallbacksPerSecond/);
  assert.match(routes, /HermesFrameRateLogRow/);
  assert.match(routes, /TimelineView\(\.periodic/);
  assert.match(routes, /requested=\\\(snapshot\.requestedFramesPerSecond\)/);
  assert.match(frameRate, /CADisplayLink/);
  assert.match(frameRate, /UIScreen\.main\.maximumFramesPerSecond/);
  assert.match(frameRate, /preferredFrameRateRange = CAFrameRateRange/);
  assert.match(frameRate, /minimum: targetRate/);
  assert.match(frameRate, /preferred: targetRate/);
  assert.match(frameRate, /link\.add\(to: RunLoop\.main, forMode: \.common\)/);
  assert.match(frameRate, /OnAppBecomesActive/);
  assert.match(frameRate, /OnAppEntersForeground/);
  assert.match(frameRate, /OnAppEntersBackground/);
  assert.match(bridge, /startNativeFrameRateController/);
  assert.match(bridge, /getNativeFrameRateDiagnostics/);
  assert.match(app, /startNativeFrameRateController\(\)/);
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
  assert.match(native, /HermesRouteReadinessProbe/);
  assert.match(native, /override func layoutSubviews\(\)/);
  assert.match(native, /window != nil/);
  assert.match(native, /DispatchQueue\.main\.async \{ \[weak self\] in/);
  assert.doesNotMatch(native, /asyncAfter\(deadline: \.now\(\) \+ 0\.025\)/);
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

test('the composer keeps RN controls above a relayout-safe native blur background', () => {
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const liveBlur = read(
    'modules/hermes-live-blur/ios/HermesLiveBlurView.swift',
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
  assert.match(chat, /<HermesLiveBlurView/);
  assert.match(chat, /blurRadius=\{18\}/);
  assert.match(chat, /styles\.composerFrostedBackground/);
  assert.match(chat, /borderWidth: StyleSheet\.hairlineWidth/);
  assert.match(liveBlur, /UIVisualEffectView/);
  assert.match(liveBlur, /override func layoutSubviews\(\)/);
  assert.match(liveBlur, /installGaussianFilter\(\)/);
  assert.match(chat, /<HermesSwiftUIModelToolsView/);
  assert.doesNotMatch(
    chat,
    /<GlassView|<HermesLiquidGlassView|<HermesSwiftUIFrostedSurfaceView/,
  );
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
  assert.match(native, /paletteProvider: \{ \[weak props\] in props\?\.resolvedPalette/);
  assert.match(native, /appearanceSignatureProvider: \{ \[weak props\] in props\?\.themeSignature/);
  const design = read('modules/hermes-ios-controls/ios/HermesSwiftUIDesign.swift');
  assert.match(design, /guard signature != cachedProviderSignature else \{ return \}/);
  const routeView = native.slice(
    native.indexOf('struct HermesSwiftUIRouteView'),
    native.indexOf('final class HermesSwiftUIModelToolsProps'),
  );
  assert.doesNotMatch(routeView, /\.onAppear \{ props\.applyTheme/);
  assert.doesNotMatch(routeView, /\.onChange\(of: props\.themeSignature\)/);
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

test('heavy analytics content is staged before the sidebar close signal', () => {
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const routes = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const preview = read('src/preview/FrontendPreviewApp.tsx');

  assert.match(native, /route != \.analytics \|\| preparedAnalyticsPath == props\.path/);
  assert.match(native, /DispatchQueue\.main\.async \{/);
  assert.match(native, /preparedAnalyticsPath = path/);
  assert.match(native, /enabled: routeContentReady/);
  assert.match(routes, /let renderDeferredContent: Bool/);
  assert.match(routes, /HermesAnalyticsPage\([\s\S]*renderChart: renderDeferredContent/);
  assert.match(routes, /if renderChart \{[\s\S]*Chart\(points\)/);
  assert.doesNotMatch(preview, /<HermesSwiftUIRouteView\s+key=\{route\.path\}/);
});
