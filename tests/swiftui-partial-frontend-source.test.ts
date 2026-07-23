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
  assert.match(preview, /<ChatPreviewPage[\s\S]*profile=\{profile\}/);
  const chat = read('src/preview/PreviewChatPage.tsx');
  assert.match(chat, /createConversation\(profile,/);
  assert.match(chat, /enqueueHostedTurn\(item\.conversationId, item\.input, signal\)/);
  assert.match(chat, /persistPendingAttachments\(/);
  assert.match(chat, /upsertPendingEnqueue\(cacheOwner,/);
  assert.match(chat, /cancelHostedTurn\(/);
  assert.doesNotMatch(chat, /new HermesChatStream|existingSessionId:/);
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

test('SwiftUI management pages expose the server write operations', () => {
  const routes = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const routeData = read('src/app/hermes-route-data.ts');

  assert.match(routes, /\.skillSelect/);
  assert.match(routes, /\.skillUpdate/);
  assert.match(routes, /\.achievementsRescan/);
  assert.match(routes, /\.kanbanCreate/);
  assert.match(routes, /\.kanbanUpdate/);
  assert.match(routes, /\.kanbanMove/);
  assert.match(routes, /\.modelSave/);
  assert.match(routes, /\.modelTest/);
  assert.match(routes, /\.modelSelect/);
  assert.match(routes, /\.modelDiscover/);
  assert.match(routes, /ForEach\(models\)/);
  assert.match(routes, /ForEach\(displayedDetectedModels, id: \\.self\)/);
  assert.match(routes, /hermes-detect-models/);
  assert.match(routes, /HermesRouteActionPayload\(route: "models", id: model\.id\)/);
  assert.match(routes, /API key \(optional\)/);
  assert.doesNotMatch(
    routes,
    /configuration\?\.apiKeyConfigured == true \|\| !apiKey\.isEmpty/,
  );
  assert.match(routes, /\.integrationUpdate/);
  assert.match(routes, /编辑渠道配置/);
  assert.match(routes, /updateConfigValue\("stream_output"/);
  assert.match(routes, /updateConfigValue\("auto_compact"/);
  assert.match(routes, /\.fileImporter\(/);
  assert.match(routes, /startAccessingSecurityScopedResource\(\)/);
  assert.match(routes, /stopAccessingSecurityScopedResource\(\)/);
  assert.match(routes, /NSFileCoordinator\(\)\.coordinate\(/);
  assert.match(routes, /FileManager\.default\.copyItem\(at: readableURL, to: destination\)/);
  assert.match(routes, /HermesFileImports/);
  assert.match(routes, /cleanupExpiredBatches/);
  assert.match(routes, /fields: \["stagedImport": "true"\]/);
  assert.match(routeData, /payload\.fields\?\.stagedImport === 'true'/);
  assert.match(routeData, /removeStagedFileImport\(uri\)/);
  assert.match(routes, /\.configImport/);
  assert.doesNotMatch(routes, /isOn: \.constant\(data\.config\.(?:streamOutput|autoCompact)\)/);
  assert.match(routeData, /api\.updateSkillContent/);
  assert.match(routeData, /api\.rescanAchievements/);
  assert.match(routeData, /api\.createKanbanTask/);
  assert.match(routeData, /api\.updateKanbanTask/);
  assert.match(routeData, /api\.saveCustomModel/);
  assert.match(routeData, /api\.testCustomModel/);
  assert.match(routeData, /api\.discoverCustomModels/);
  assert.match(routeData, /api\.deleteModelCredential/);
  assert.doesNotMatch(routes, /case \.env: return \.environment/);
  assert.doesNotMatch(routes, /\.environmentUpsert/);
  assert.doesNotMatch(routeData, /HERMES_SWIFTUI_ROUTE_ACTIONS\.environmentUpsert/);
  assert.match(routeData, /api\.updateChannel/);
});

test('SwiftUI owns one synchronized sidebar transition and native page navigation', () => {
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const frameRate = read(
    'modules/hermes-ios-controls/ios/HermesFrameRateModule.swift',
  );
  const routes = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const admin = read('modules/hermes-ios-controls/ios/HermesSwiftUIAdminPages.swift');
  const bridge = read('modules/hermes-ios-controls/index.ts');
  const app = read('src/app/HermesNativeApp.tsx');
  const config = JSON.parse(
    read('modules/hermes-ios-controls/expo-module.config.json'),
  ) as {
    apple?: { modules?: string[]; appDelegateSubscribers?: string[] };
  };
  const shell = read('src/app/NativeShell.tsx');
  const nativeSidebar = native.slice(
    native.indexOf('struct HermesSwiftUISidebarView'),
    native.indexOf('final class HermesSwiftUIRouteProps'),
  );

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
  assert.match(native, /withAnimation\(hermesDrawerAnimation\) \{ presented = next \}/);
  assert.match(native, /NavigationStack \{/);
  assert.doesNotMatch(native, /navigationTitle\("Hermes Agent"\)/);
  assert.match(native, /Text\("Hermes Agent"\)\s*\.font\(\.largeTitle\.bold\(\)\)/);
  assert.match(native, /ScrollView\(\.vertical, showsIndicators: false\)/);
  assert.match(nativeSidebar, /\.background\(Color\.clear\.ignoresSafeArea\(\)\)/);
  assert.doesNotMatch(nativeSidebar, /appearance\.palette\.background\s*\.ignoresSafeArea\(\)/);
  assert.match(native, /\.frame\(maxWidth: \.infinity, minHeight: 52, alignment: \.leading\)/);
  assert.match(nativeSidebar, /ForEach\(HermesRoute\.allCases\.filter\(\\\.visibleInSidebar\)\)/);
  assert.doesNotMatch(nativeSidebar, /ForEach\(0\.\.<4|sectionTitle|Workspace|Automation|Administration/);
  assert.match(
    native,
    /private func select\(_ route: HermesRoute\) \{\s*dismissHermesKeyboard\(\)\s*feedbackTrigger \+= 1\s*props\.onNavigate\(\["path": route\.path\]\)\s*\}/,
  );
  assert.doesNotMatch(native, /props\.onNavigate\(\["path": route\.path\]\)\s*if isDrawer/);
  assert.doesNotMatch(nativeSidebar, /DragGesture\(minimumDistance: 8/);
  assert.doesNotMatch(native, /DragGesture\(minimumDistance: 12/);
  assert.match(shell, /import \{ Drawer \} from 'react-native-drawer-layout'/);
  assert.match(admin, /HermesProfileEditor\([\s\S]*\.onDisappear \{ dismissHermesKeyboard\(\) \}/);
  // Offline admin system catalog must never invent CPU/memory/online metrics.
  assert.match(admin, /struct HermesSystemPage: View/);
  assert.doesNotMatch(admin, /HermesMetric\(title: "CPU", value: "18%"/);
  assert.doesNotMatch(admin, /ProgressView\(value: 0\.18\)/);
  assert.doesNotMatch(admin, /value: "3\.4 GB"/);
  assert.match(admin, /managed-node live snapshots|托管节点实时快照/);
  assert.match(routes, /data\.system\.nodes/);
  assert.match(routes, /\.refreshable \{ onAction\(\.refresh, HermesRouteActionPayload\(route: "system"\)/);
  assert.match(native, /var onReady = EventDispatcher\(\)/);
  assert.match(native, /HermesRouteReadinessProbe/);
  assert.match(native, /override func layoutSubviews\(\)/);
  assert.match(native, /window != nil/);
  assert.match(native, /DispatchQueue\.main\.async \{ \[weak self\] in/);
  assert.doesNotMatch(native, /asyncAfter\(deadline: \.now\(\) \+ 0\.025\)/);
  assert.match(native, /props\.onReady\(\["path": path\]\)/);
  assert.match(shell, /useSwiftUISidebar \? \(/);
  assert.match(shell, /<HermesSwiftUISidebarView/);
  assert.match(shell, /const compactSidebar = useSwiftUISidebar \? \(/);
  assert.match(shell, /<CompactDrawerFrame[\s\S]*drawerContent=\{compactSidebar\}/);
  assert.match(shell, /presentation="embedded"/);
  assert.match(native, /fillsAvailableWidth/);
  assert.match(native, /ForEach\(gateways\)/);
  assert.match(native, /gatewayMeta\(gateway\)/);
  assert.match(native, /gatewayColor\(gateway\.state\)/);
  assert.doesNotMatch(shell, /drawerTranslationStyle|swiftUIDrawerHost/);
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
  assert.match(native, /ScrollView\(\.vertical, showsIndicators: false\)/);
  assert.doesNotMatch(native, /\.listStyle\(\.insetGrouped\)/);
  assert.match(native, /appearance\.palette\.background\s*\.ignoresSafeArea\(\)/);
  assert.match(native, /\.font\(HermesFonts\.body\(15\)\)/);
  assert.doesNotMatch(native, /\.background\(\.ultraThinMaterial\)/);
  assert.match(native, /minHeight: 52/);
  assert.match(shell, /\.\.\.swiftUIThemeProps/);
  assert.match(shell, /<SymbolView[\s\S]*name=\{route\.symbol\}[\s\S]*size=\{18\}/);
  assert.match(shell, /referenceSidebarRow:[\s\S]*minHeight: 52/);
  assert.match(preview, /\.\.\.resolveSwiftUIThemeProps\(tokens\)/);
});

test('chat header exposes live dual-gateway status while SwiftUI keeps back semantics without a theme shortcut', () => {
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const bridge = read('modules/hermes-ios-controls/index.ts');
  const chat = read('src/preview/PreviewChatPage.tsx');
  const shell = read('src/app/NativeShell.tsx');

  assert.match(bridge, /gatewayStatusesJson: string/);
  assert.doesNotMatch(bridge, /onThemeChange\?\(event: NativeSyntheticEvent<\{ name: string \}>\)/);
  assert.match(native, /decodeGateways\(props\.gatewayStatusesJson\)/);
  assert.match(chat, /gatewayStatuses\.map\(\(gateway\)/);
  assert.match(chat, /gateway\.state === 'online'[\s\S]*tokens\.colors\.success/);
  assert.match(chat, /gateway\.state === 'degraded'[\s\S]*tokens\.colors\.warning/);
  assert.match(chat, /tokens\.colors\.destructive/);
  assert.doesNotMatch(native, /v0\.9\.3|2 sessions|2 个会话/);
  assert.doesNotMatch(native, /Menu \{\s*ForEach\(themes\)|paintpalette|decodeThemes/);
  assert.match(native, /Image\(systemName: "chevron\.backward"\)/);
  assert.match(native, /返回侧边栏/);
  assert.match(native, /if route == \.system \{[\s\S]*ToolbarItem\(placement: \.navigationBarTrailing\)/);
  assert.match(native, /HermesRouteAction\.refresh\.rawValue[\s\S]*HermesRouteActionPayload\(route: "system"\)/);
  assert.match(native, /刷新系统状态/);
  assert.match(native, /navigationBar\.shadowImage = UIImage\(\)/);
  assert.match(native, /standard\.shadowColor = \.clear/);
  assert.match(native, /scrollEdge\.shadowColor = \.clear/);
  assert.match(native, /\.toolbarBackground\(appearance\.palette\.background, for: \.navigationBar\)/);
  assert.match(native, /\.toolbarBackground\(\.visible, for: \.navigationBar\)/);
  assert.match(shell, /gatewayStatusesJson=\{gatewayStatusesJson\}/);
  assert.match(shell, /headerShadowVisible: false/);
  assert.doesNotMatch(shell, /themeName=\{themeName\}|themesJson=\{sidebarThemesJson\}/);
  assert.match(shell, /id: 'dbb3', label: 'DBB3', state: 'unknown'/);
  assert.match(shell, /id: 'wsl', label: 'WSL', state: 'unknown'/);
});

test('native account documentation matches the one-time login contract', () => {
  const admin = read('modules/hermes-ios-controls/ios/HermesSwiftUIAdminPages.swift');
  assert.match(admin, /首次登录后会自动恢复会话/);
  assert.doesNotMatch(admin, /Face ID|quick unlock/);
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
  assert.match(native, /private var activationGeneration = 0/);
  assert.match(native, /activationGeneration == readyGeneration/);
  assert.match(native, /lastReportedGeneration != activationGeneration/);
  assert.match(routes, /let renderDeferredContent: Bool/);
  assert.match(routes, /HermesAnalyticsPage\([\s\S]*renderChart: renderDeferredContent/);
  assert.match(routes, /if renderChart \{[\s\S]*Chart\(points\)/);
  assert.doesNotMatch(preview, /<HermesSwiftUIRouteView\s+key=\{route\.path\}/);
  assert.doesNotMatch(preview, /<PreviewRoute\s+key=\{route\.path\}/);
});

test('SwiftUI collaboration keeps its draft and stable request until durable acknowledgement', () => {
  const routes = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const controller = read('src/app/useHermesSwiftUIRouteData.ts');
  const store = read('src/api/conversation-local-store.ts');

  assert.match(routes, /collaborationPendingRequestId/);
  assert.match(routes, /collaborationPendingRoomId == roomId/);
  assert.match(routes, /collaborationPendingRoomId = roomId/);
  assert.match(routes, /\.submitLabel\(\.send\)/);
  assert.match(routes, /dismissHermesKeyboard\(\)[\s\S]*collaborationPendingRequestId/);
  assert.match(routes, /Button\(chinese \? "取消" : "Cancel"\)[\s\S]*dismissHermesKeyboard\(\)[\s\S]*onCancel\(\)/);
  assert.match(routes, /Button\(chinese \? "保存" : "Save"\)[\s\S]*dismissHermesKeyboard\(\)[\s\S]*onSave\(\)/);
  assert.match(
    routes,
    /TextField\(chinese \? "会话名称" : "Session name", text: \$renameText\)[\s\S]*\.onSubmit \{ dismissHermesKeyboard\(\) \}/,
  );
  assert.match(
    routes,
    /Button\(chinese \? "取消" : "Cancel"\) \{\s*dismissHermesKeyboard\(\)\s*renameTarget = nil/,
  );
  assert.match(
    routes,
    /Button\(chinese \? "保存" : "Save"\) \{\s*dismissHermesKeyboard\(\)[\s\S]*\.sessionRename/,
  );
  assert.match(routes, /requestId: requestId/);
  assert.match(routes, /onChange\(of: data\.collaboration\.acknowledgedRequestId\)/);
  assert.doesNotMatch(
    routes,
    /guard !text\.isEmpty else \{ return \}\s*collaborationDraft = ""\s*onAction\(\.collaborationSend/,
  );
  assert.match(controller, /upsertPendingRoomMessage\(cacheOwner, item\)/);
  assert.match(controller, /sendCollaborationRoomMessage\([\s\S]*item\.requestId/);
  assert.match(controller, /removePendingRoomMessage\(cacheOwner, item\.requestId\)/);
  assert.match(controller, /isPermanentRoomSendError\(error\)/);
  assert.match(controller, /!\[401, 408, 429\]\.includes\(error\.status\)/);
  assert.match(store, /hermes\.native\.collaboration-room-outbox\.v1/);
});
