import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(projectRoot, path), 'utf8');

test('Swift and TypeScript route action protocols remain exactly aligned', () => {
  const contract = read('src/app/swiftui-route-contract.ts');
  const generatedContract = read('src/app/swiftui-route-actions.generated.ts');
  const swiftSource = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIRouteData.swift',
  );
  const swiftActionsSource = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIRouteActions.generated.swift',
  );
  const swiftPages = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift',
  );
  const typeScriptActions = new Set(
    [...generatedContract.matchAll(/^\s+[A-Za-z][A-Za-z0-9]*:\s*'([^']+)',?$/gm)]
      .map((match) => match[1]),
  );
  const swiftActions = new Set(
    [...swiftActionsSource.matchAll(/case\s+[A-Za-z][A-Za-z0-9]*\s*=\s*"([^"]+)"/g)]
      .map((match) => match[1]),
  );

  assert.deepEqual([...swiftActions].sort(), [...typeScriptActions].sort());
  assert.match(generatedContract, /generate-swiftui-route-actions\.mjs\. Do not edit/);
  assert.match(swiftActionsSource, /generate-swiftui-route-actions\.mjs\. Do not edit/);
  assert.match(generatedContract, /interface HermesSwiftUIRouteActionPayload/);
  assert.match(generatedContract, /isHermesSwiftUIRouteActionPayload/);
  assert.match(swiftActionsSource, /struct HermesRouteActionPayload: Encodable, Equatable/);
  assert.doesNotMatch(contract, /interface HermesSwiftUIRouteActionPayload\s*\{/);
  assert.doesNotMatch(swiftSource, /struct HermesRouteActionPayload\s*:/);
  assert.match(contract, /payloadDigest\?: string/);
  assert.match(swiftSource, /let payloadDigest: String\?/);
  assert.match(swiftPages, /fields\["payloadDigest"\] = payloadDigest/);
  assert.doesNotMatch(read('src/app/hermes-route-data.ts'), /renderedApprovalDigests/);
});

test('SwiftUI route snapshots stay split by product domain', () => {
  const coordinator = read('src/app/hermes-route-data.ts');
  const domains = [
    'management',
    'model-selection',
    'models',
    'sessions-files',
    'support',
    'system',
    'workflows',
  ];

  for (const domain of domains) {
    assert.ok(
      existsSync(resolve(projectRoot, `src/app/route-snapshots/${domain}.ts`)),
      `missing route snapshot domain: ${domain}`,
    );
  }
  // The route coordinator owns the complete upstream action bridge (including
  // Bot Mode, managed workers, and native memory/system controls). Keep a
  // generous ceiling here; domain snapshot implementations remain split out
  // and this guard is only intended to catch accidental monolith re-growth.
  assert.ok(coordinator.split(/\r?\n/).length < 1000);
  assert.doesNotMatch(
    coordinator,
    /function (?:modelsSnapshot|systemSnapshot|workflowsSnapshot|filesSnapshot|integrationsSnapshot)\(/,
  );
});

test('native Bot Mode controls expose official profile capability and avatar actions', () => {
  const pages = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const actions = read('modules/hermes-ios-controls/ios/HermesSwiftUIRouteActions.generated.swift');
  const api = read('src/api/cloud/management.ts');
  assert.match(pages, /botProfileDescribe/);
  assert.match(pages, /botProfileConfigure/);
  assert.match(pages, /botAvatarUpload/);
  assert.match(pages, /botRelaySend/);
  assert.match(pages, /botAvatarGenerate/);
  assert.match(pages, /botPetSelect/);
  assert.match(pages, /Avatar color/);
  assert.match(pages, /Avatar shape/);
  assert.match(pages, /Cross-connection Bot Relay/);
  assert.match(pages, /allowedContentTypes: \[\.image\]/);
  assert.match(actions, /case botProfileConfigure = "bot\.profile\.configure"/);
  assert.match(actions, /case botRelaySend = "bot\.relay\.send"/);
  assert.match(actions, /case botAvatarGenerate = "bot\.avatar\.generate"/);
  assert.match(actions, /case botPetSelect = "bot\.pet\.select"/);
  assert.match(api, /\/api\/bots\/\$\{encodeURIComponent\(name\)\}\/describe/);
  assert.match(api, /\/assets\/\$\{encodeURIComponent\(asset\)\}/);
  assert.match(api, /\/api\/bot-mode\/relay\/roster/);
  assert.match(api, /\/api\/bot-mode\/relay\/send/);
  assert.match(api, /\/assets\/avatar\/generate/);
  assert.match(api, /\/api\/bot-mode\/pets\/gallery/);
  assert.match(api, /\/assets\/avatar\/pet/);
});

test('native Git workspace exposes the official status, review, and mutation surface', () => {
  const pages = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const data = read('modules/hermes-ios-controls/ios/HermesSwiftUIRouteData.swift');
  const actions = read('src/app/hermes-route-data.ts');
  const routes = read('src/api/cloud/routes.ts');
  for (const action of ['gitRefresh', 'gitSelect', 'gitStage', 'gitUnstage', 'gitRevert', 'gitCommit', 'gitPush', 'gitSwitchBranch', 'gitGhAuth', 'gitCreatePR', 'gitAddWorktree', 'gitRemoveWorktree']) {
    assert.match(pages + data + actions, new RegExp(`\\.${action}\\b`));
  }
  for (const field of ['statusJSON', 'branchesJSON', 'baseBranchesJSON', 'worktreesJSON', 'reviewJSON', 'shipInfoJSON', 'ghAuthJSON', 'commitContextJSON', 'revParseJSON', 'pullRequestsJSON', 'fileDiffJSON']) {
    assert.match(data, new RegExp(`let ${field}:`));
  }
  assert.match(routes, /case 'git'/);
  assert.match(routes, /getGitReviewDiff/);
  assert.match(routes, /listGitPullRequests/);
  assert.match(pages, /Create or open Pull Request/);
  assert.match(pages, /Create worktree/);
  assert.match(pages, /Remove worktree/);
});

test('native Cron and Bot Mode expose editable, profile-scoped routines', () => {
  const pages = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const routeData = read('src/app/hermes-route-data.ts');
  const routes = read('src/api/cloud/routes.ts');
  assert.match(pages, /cronUpdate/);
  assert.match(pages, /Bot Routines/);
  assert.match(pages, /Add routine for this bot/);
  assert.match(routeData, /updateCronJob\(payload\.id, updates, payload\.fields\?\.profile \|\| profile\)/);
  assert.match(routes, /bot_routines/);
});

test('signed iOS builds keep native route surfaces while the JS sidebar remains authoritative', () => {
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
  const preview = read('src/studio/FrontendPreviewApp.tsx');

  assert.ok(
    config.apple?.modules?.includes('HermesSwiftUIPartialFrontendModule'),
  );
  assert.match(bridge, /HermesSwiftUIRouteView/);
  assert.match(bridge, /HermesSwiftUIModelToolsView/);
  assert.match(bridge, /HermesSwiftUIFrostedSurfaceView/);
  assert.doesNotMatch(bridge, /HermesSwiftUISidebarView|hasNativeSwiftUISidebar/);
  assert.doesNotMatch(native, /HermesSwiftUISidebarView|HermesSidebar/);
  assert.match(native, /View\(HermesSwiftUIRouteView\.self\)/);
  assert.match(native, /View\(HermesSwiftUIModelToolsView\.self\)/);
  assert.match(native, /View\(HermesSwiftUIFrostedSurfaceView\.self\)/);
  const hostedViews = [
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
  assert.match(
    routes,
    /case \.memory:\s*HermesMemoryPage\(data: data\.memory, chinese: chinese, onAction: onAction\)/,
  );
  assert.doesNotMatch(routes, /case \.chat:[\s\S]*HermesChatPage\(/);
  assert.match(preview, /route\.routeId !== 'chat'/);
  assert.doesNotMatch(
    preview,
    /usesNativeSwiftUIRoute[\s\S]{0,500}route\.routeId !== 'workflows'/,
  );
  assert.match(read('src/api/cloud/workflows.ts'), /\/api\/plugins\/workflows/);
  assert.match(read('src/app/useHermesSwiftUIRouteData.ts'), /routeId === 'workflows'/);
  assert.match(preview, /<ChatPreviewPage/);
  assert.match(preview, /<ChatPreviewPage[\s\S]*profile=\{profile\}/);
  const chat = [
    read('src/studio/PreviewChatPage.tsx'),
    read('src/studio/chat/ChatPresentation.tsx'),
    read('src/studio/chat/ChatHeader.tsx'),
    read('src/studio/chat/ChatMessageStream.tsx'),
    read('src/studio/chat/ChatComposer.tsx'),
    read('src/studio/chat/ChatComposerPresentation.tsx'),
    read('src/studio/chat/ConversationHistory.tsx'),
    read('src/studio/chat/ChatModelToolsDrawer.tsx'),
    read('src/studio/chat/chat-presentation-styles.ts'),
    read('src/studio/chat/hosted-turn-delivery-service.ts'),
    read('src/studio/chat/useHostedCancellationController.ts'),
    read('src/studio/chat/useHostedOutboxReplayController.ts'),
    read('src/studio/chat/useChatAttachmentController.ts'),
    read('src/studio/chat/useHostedInterventionController.ts'),
    read('src/studio/chat/useHostedSendController.ts'),
    read('src/studio/chat/useConversationActionsController.ts'),
    read('src/studio/chat/useChatComposerNavigationController.ts'),
  ].join('\n');
  assert.match(chat, /createConversation\(\s*profile,/);
  assert.match(chat, /enqueueHostedTurn\(item\.conversationId, \{/);
  assert.match(chat, /createConversationIfMissing: createOnEnqueue/);
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

test('the cloud files page splits its generic view chain for Release compilation', () => {
  const pages = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  assert.match(pages, /private struct HermesFilesPage:[\s\S]*let content = List/);
  assert.match(pages, /let searchableContent = content[\s\S]*\.searchable/);
  assert.match(pages, /let toolbarContent = searchableContent[\s\S]*\.toolbar/);
  assert.match(pages, /return toolbarContent[\s\S]*\.fileImporter/);
});

test('SwiftUI management pages expose the server write operations', () => {
  const routes = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const routeData = read('src/app/hermes-route-data.ts');

  assert.match(routes, /\.skillSelect/);
  assert.match(routes, /\.skillCreate/);
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
  assert.match(routes, /\.pairingApprove/);
  assert.match(routes, /item\.requestId/);
  assert.match(routeData, /api\.approvePairing/);
  assert.match(routes, /编辑渠道配置/);
  assert.match(routes, /updateConfigValue\("stream_output"/);
  assert.match(routes, /updateConfigValue\("auto_compact"/);
  assert.match(routes, /\.fileImporter\(/);
  assert.match(routes, /folderCreateOpen/);
  assert.match(routes, /\.folderCreate/);
  assert.match(routes, /\/api\/files\/mkdir/);
  assert.match(routes, /startAccessingSecurityScopedResource\(\)/);
  assert.match(routes, /stopAccessingSecurityScopedResource\(\)/);
  assert.match(routes, /NSFileCoordinator\(\)\.coordinate\(/);
  assert.match(routes, /FileManager\.default\.copyItem\(at: readableURL, to: destination\)/);
  assert.match(routes, /HermesFileImports/);
  assert.match(routes, /cleanupExpiredBatches/);
  assert.match(routes, /fields: \["stagedImport": "true"\]/);
  assert.match(
    routes,
    /HermesRouteActionPayload\(\s*route: "files",\s*requestId: "file-import-[\s\S]*?fields: \["stagedImport": "true"\],\s*uris:/,
  );
  assert.match(routeData, /payload\.fields\?\.stagedImport === 'true'/);
  assert.match(routeData, /removeStagedFileImport\(uri\)/);
  assert.match(routes, /\.configImport/);
  assert.doesNotMatch(routes, /isOn: \.constant\(data\.config\.(?:streamOutput|autoCompact)\)/);
  assert.match(routeData, /api\.updateSkillContent/);
  assert.match(routeData, /loadSessionSurfaceMetadata/);
  assert.match(routeData, /api\.bulkDeleteSessions/);
  assert.match(routeData, /api\.importSessions/);
  assert.match(routeData, /api\.uploadImport/);
  assert.match(routeData, /api\.createHook/);
  assert.match(routeData, /api\.deleteHook/);
  assert.match(routes, /sessionProjectsJSON/);
  assert.match(routes, /sessionPullRequestsJSON/);
  assert.match(routes, /\.sessionBulkDelete/);
  assert.match(routes, /\.sessionImport/);
  assert.match(routes, /\.systemBackupImport/);
  assert.match(routes, /\.systemHookCreate/);
  assert.match(routes, /\.systemHookDelete/);
  assert.match(routeData, /api\.rescanAchievements/);
  assert.match(routeData, /api\.createKanbanTask/);
  assert.match(routeData, /api\.updateKanbanTask/);
  assert.match(routeData, /api\.saveCustomModel/);
  assert.match(routeData, /api\.testCustomModel/);
  assert.match(routeData, /api\.discoverCustomModels/);
  assert.match(routeData, /api\.deleteEnvironmentVariable/);
  // Custom-model normalization lives in HermesCloudApi alone; the route layer
  // once shipped a second copy whose unknown-input fallback diverged.
  assert.doesNotMatch(routeData, /function customApiMode/);
  assert.doesNotMatch(routeData, /function customReasoningEffort/);
  assert.match(routes, /case \.env: return \.environment/);
  assert.match(routes, /\.environment/);
  assert.match(routeData, /HERMES_SWIFTUI_ROUTE_ACTIONS\.environmentSet/);
  assert.match(routeData, /api\.updateChannel/);
  assert.match(routes, /节点安装状态/);
  assert.match(routes, /data\.installations/);
  assert.match(routes, /localizedInstallationState/);
  assert.match(routes, /case "hk": return chinese \? "香港" : "Hong Kong"/);
  assert.match(routes, /context\.branchableMessages/);
  assert.match(routes, /\.sessionFork/);
  assert.match(routeData, /api\.forkConversationFromMessage/);
  assert.match(routeData, /managedInstallationsSnapshot/);
  const controller = read('src/app/useHermesSwiftUIRouteData.ts');
  assert.match(controller, /INSTALLATION_REFRESH_MS = 2_000/);
  assert.match(controller, /routeId === 'skills' \|\| routeId === 'mcp'/);
});

test('the JS sidebar remains authoritative while native page navigation stays available', () => {
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
  assert.doesNotMatch(frameRate, /method_exchangeImplementations/);
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
  assert.match(native, /@Environment\(\\\.accessibilityReduceMotion\)/);
  assert.match(native, /hermesReducedMotionFade = Animation\.easeOut\(duration: 0\.12\)/);
  assert.match(native, /NavigationStack \{/);
  assert.doesNotMatch(native, /navigationTitle\("Hermes Agent"\)/);
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
  assert.doesNotMatch(native, /HermesSwiftUISidebarView|HermesSidebar/);
  assert.doesNotMatch(bridge, /HermesSwiftUISidebarView|hasNativeSwiftUIPartialFrontend|hasNativeSwiftUISidebar/);
  assert.doesNotMatch(shell, /useSwiftUISidebar|HermesSwiftUISidebarView/);
  assert.match(shell, /const compactSidebar = \(\s*<Sidebar/);
  assert.match(shell, /<CompactDrawerFrame[\s\S]*drawerContent=\{compactSidebar\}/);
  assert.doesNotMatch(shell, /drawerTranslationStyle|swiftUIDrawerHost/);
});

test('the composer uses the source-attributed OpenMinis solid two-level surface', () => {
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const liveBlur = read(
    'modules/hermes-live-blur/ios/HermesLiveBlurView.swift',
  );
  const chat = [
    read('src/studio/PreviewChatPage.tsx'),
    read('src/studio/chat/ChatPresentation.tsx'),
    read('src/studio/chat/ChatHeader.tsx'),
    read('src/studio/chat/ChatMessageStream.tsx'),
    read('src/studio/chat/ChatComposer.tsx'),
    read('src/studio/chat/ChatComposerPresentation.tsx'),
    read('src/studio/chat/ConversationHistory.tsx'),
    read('src/studio/chat/ChatModelToolsDrawer.tsx'),
  ].join('\n');

  assert.match(native, /\.fill\(\.regularMaterial\)/);
  assert.doesNotMatch(native, /Children\(\)/);
  assert.match(native, /struct HermesSwiftUIModelToolsView/);
  assert.match(native, /Picker\(chinese \? "推理强度"/);
  assert.match(native, /@State private var selectedReasoning = "medium"/);
  assert.match(native, /selectedReasoning = \$0\s*props\.onReasoningChange/);
  assert.match(native, /selectedModel = \$0\s*props\.onModelChange/);
  assert.match(chat, /<View style=\{surfaceStyle\}>/);
  assert.match(chat, /OpenMinis\/OpenMinis@9cf3a855/);
  assert.match(chat, /backgroundColor: tokens\.colors\.card/);
  assert.match(chat, /borderColor: tokens\.colors\.border/);
  assert.doesNotMatch(chat, /DynamicColorIOS/);
  assert.match(chat, /styles\.openMinisToolbar/);
  assert.doesNotMatch(chat, /<HermesLiveBlurView/);
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
  const preview = read('src/studio/FrontendPreviewApp.tsx');
  const routes = read('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift');
  const admin = read('modules/hermes-ios-controls/ios/HermesSwiftUIAdminPages.swift');

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
  assert.match(routes, /ScrollView/);
  assert.match(native, /appearance\.palette\.background\s*\.ignoresSafeArea\(\)/);
  assert.match(admin, /\.font\(HermesFonts\.body\(15\)\)/);
  assert.doesNotMatch(native, /\.background\(\.ultraThinMaterial\)/);
  assert.match(shell, /<SymbolView[\s\S]*name=\{item\.symbol as SFSymbol\}[\s\S]*size=\{16\}/);
  assert.match(shell, /referenceSidebarRow:[\s\S]*minHeight: 52/);
  assert.match(preview, /\.\.\.resolveSwiftUIThemeProps\(tokens\)/);
});

test('chat header exposes live dual-gateway status while native routes keep back semantics', () => {
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const bridge = read('modules/hermes-ios-controls/index.ts');
  const chat = [
    read('src/studio/PreviewChatPage.tsx'),
    read('src/studio/chat/ChatHeader.tsx'),
  ].join('\n');
  const shell = read('src/app/NativeShell.tsx');

  assert.doesNotMatch(bridge, /onThemeChange\?\(event: NativeSyntheticEvent<\{ name: string \}>\)/);
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
  const preview = read('src/studio/FrontendPreviewApp.tsx');

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
  const store = [
    read('src/api/conversation-local-store.ts'),
    read('src/api/conversation-room-outbox.ts'),
  ].join('\n');

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
  // The queue-expiry notice follows the active locale instead of hardcoding
  // Chinese copy, and route actions carry the locale into the data layer.
  assert.match(controller, /条待发群聊消息已失效[\s\S]{0,160}pending room messages expired/);
  assert.match(controller, /performHermesSwiftUIRouteAction\(api, event, profile, locale\)/);
  assert.match(store, /hermes\.native\.collaboration-room-outbox\.v1/);
});

test('SwiftUI session deletion commits locally before durable cloud replay', () => {
  const controller = read('src/app/useHermesSwiftUIRouteData.ts');
  const sessionsProjection = read('src/app/route-snapshots/sessions-files.ts');
  const stage = controller.indexOf('const queued = await localStore.stageConversationDeletion(');
  const legacyCloudAction = controller.indexOf(
    'const result = await performHermesSwiftUIRouteAction(api, event, profile, locale);',
  );
  const replay = controller.indexOf('await conversationDeleteReplayService?.replay()');
  const synchronize = controller.indexOf('await synchronizeConversationCache(');
  const localRead = controller.indexOf('localStore.read(cacheOwner)');
  const tombstoneRead = controller.indexOf(
    'localStore.readPendingConversationDeletionIds(cacheOwner)',
  );
  const localPublish = controller.indexOf(
    'setDataJson(encodeHermesSwiftUIRouteSnapshot(localSnapshot))',
  );

  assert.ok(stage >= 0 && stage < legacyCloudAction);
  assert.ok(replay >= 0 && replay < synchronize);
  assert.ok(localRead >= 0 && localRead < replay);
  assert.ok(tombstoneRead >= 0 && tombstoneRead < replay);
  assert.ok(localPublish >= 0 && localPublish < synchronize);
  assert.match(controller, /removeSessionFromRouteSnapshot\(current, conversationId\)/);
  assert.match(controller, /kind: conversationId\.startsWith\('official:'\) \? 'session' : 'conversation'/);
  assert.match(controller, /isAlreadyDeletedRemote/);
  assert.match(controller, /result\?\.ok === false/);
  assert.match(sessionsProjection, /conversation\.source !== 'collaboration_room'/);
  assert.match(sessionsProjection, /!conversation\.id\.startsWith\('chat_room_'\)/);
  assert.match(controller, /createHermesSwiftUISessionsSnapshotFromConversations/);
});

test('SwiftUI route navigation control is only rendered for the compact drawer shell', () => {
  const bridge = read('modules/hermes-ios-controls/index.ts');
  const native = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  const preview = read('src/studio/FrontendPreviewApp.tsx');

  assert.match(bridge, /showsNavigationButton\?: boolean/);
  assert.match(preview, /compactNavigation=\{context\.compact\}/);
  assert.match(preview, /showsNavigationButton=\{compactNavigation\}/);
  assert.match(native, /@Field var showsNavigationButton = true/);
  assert.match(
    native,
    /if props\.showsNavigationButton \{\s*ToolbarItem\(placement: \.navigationBarLeading\)/,
  );
});
