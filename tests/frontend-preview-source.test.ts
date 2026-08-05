import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

test('composer attachments and console prompts stay bound to their conversation', () => {
  const attachments = read('src/studio/chat/useChatAttachmentController.ts');
  const attachmentLifecycle = read('src/studio/chat/useChatAttachmentLifecycle.ts');
  const drafts = read('src/studio/chat/useConversationDraftPersistence.ts');
  const consoleController = read('src/studio/chat/useMobileConsoleController.ts');
  const hostedSend = read('src/studio/chat/useHostedSendController.ts');

  assert.equal((attachments.match(/draftPersistent: true/g) || []).length >= 3, true);
  assert.match(attachments, /copyToCacheDirectory: true/);
  assert.doesNotMatch(
    attachmentLifecycle,
    /attachmentsRef\.current\s*=\s*\[\]/,
  );
  assert.match(attachments, /uniqueTurnId\('paste'\)/);
  assert.match(attachments, /粘贴内容不能超过/);
  assert.doesNotMatch(attachments, /绮樿创鍐呭/);
  assert.match(drafts, /hydrationRevision/);
  assert.match(drafts, /composerRevisionRef\.current/);
  assert.match(consoleController, /confirmationRef\.current = \{[\s\S]*ownsActiveView/);
  assert.doesNotMatch(consoleController, /Alert\.alert|cancelable: false/);
  assert.match(consoleController, /if \(ownsActiveView\(\)\) \{[\s\S]*conversation sync failed/);
  assert.match(consoleController, /consoleInvocationBlocksActiveView/);
  assert.match(
    hostedSend,
    /initializePendingEnqueue[\s\S]*clearDraftClaim[\s\S]*persistPendingAttachments[\s\S]*cleanupAttachmentSources/,
  );
  assert.match(
    hostedSend,
    /durableMutation[\s\S]*cleanupAttachmentSources\(pendingAttachments\)[\s\S]*deliveryClaim/,
  );
  assert.doesNotMatch(
    hostedSend,
    /finally \{[\s\S]{0,200}cleanupAttachmentSources\(pendingAttachments\)/,
  );
});

test('accepted hosted sends hand off directly to SSE without a blocking snapshot reload', () => {
  const hostedSend = read('src/studio/chat/useHostedSendController.ts');

  assert.match(hostedSend, /settleAcceptedOutboxItem\(queuedItem, ownerEpoch\)/);
  assert.doesNotMatch(hostedSend, /await loadConversation\(conversationId, generation\)/);
  assert.doesNotMatch(hostedSend, /conversationSyncGenerationRef/);
});

test('frontend preview renders every customized route and authenticated builds may attach cloud ownership', () => {
  const app = read('src/studio/FrontendPreviewApp.tsx');
  const previewSources = [
    app,
    read('src/studio/PreviewChatPage.tsx'),
    read('src/preview/PreviewCorePages.tsx'),
    read('src/preview/PreviewAutomationPages.tsx'),
    read('src/preview/PreviewSettingsPages.tsx'),
    read('src/preview/PreviewPluginPages.tsx'),
    read('src/studio/PreviewPrimitives.tsx'),
    read('src/studio/TeamParticipants.tsx'),
    read('src/preview/preview-fixtures.ts'),
    read('src/studio/team-participants-model.ts'),
  ].join('\n');

  for (const routeId of [
    'chat',
    'sessions',
    'files',
    'analytics',
    'runtime-center',
    'models',
    'logs',
    'cron',
    'skills',
    'plugins',
    'mcp',
    'pairing',
    'channels',
    'webhooks',
    'system',
    'profiles',
    'profile-new',
    'config',
    'env',
    'docs',
  ]) {
    assert.match(app, new RegExp(`case '${routeId}'`));
  }
  for (const plugin of [
    'collaboration',
    'hermes-achievements',
    'kanban',
  ]) {
    assert.match(app, new RegExp(`route\\.pluginName === '${plugin}'`));
  }

  assert.match(app, /FrontendPreviewAppProps/);
  assert.match(previewSources, /HermesCloudApi/);
  // Pages obtain product API objects from the composition root instead of
  // constructing their own copies next to every call site.
  assert.match(previewSources, /hermesCloudApiFor\(/);
  assert.doesNotMatch(previewSources, /new HermesCloudApi\(/);
  assert.doesNotMatch(previewSources, /new ConversationLocalStore\(/);
  assert.match(previewSources, /useHermesSwiftUIRouteData/);
  // Production/authenticated surfaces must not serve fixture pages as live data.
  assert.match(app, /EXPO_PUBLIC_FRONTEND_PREVIEW === '1'/);
  assert.match(app, /allowFixturePages/);
  assert.match(app, /production-route-unavailable/);
  assert.doesNotMatch(previewSources, /useAuth/);
  assert.doesNotMatch(previewSources, /WebView|WKWebView|react-native-webview/);
});

test('distributable IPA builds always launch the authenticated production frontend', () => {
  const workflow = read('.github/workflows/ios-unsigned.yml');
  const app = read('src/app/HermesNativeApp.tsx');
  const metro = read('metro.config.js');
  const productionFixtures = read('src/preview/production-fixtures.ts');
  const productionRouteStubs = read('src/preview/production-route-stubs.tsx');
  const productionPreviewLocalization = read('src/i18n/production-preview-localization.ts');
  const productionChatSimulator = read('src/preview/production-chat-simulator.ts');
  const productionVerifier = read('scripts/verify-production-bundle.mjs');
  const productionContract = read('scripts/production-artifact-contract.mjs');

  assert.match(workflow, /EXPO_PUBLIC_FRONTEND_PREVIEW: '0'/);
  assert.match(workflow, /HERMES_DISTRIBUTABLE_BUILD: '1'/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.doesNotMatch(workflow, /inputs\.frontend_preview/);
  assert.match(app, /process\.env\.EXPO_PUBLIC_FRONTEND_PREVIEW === '1'/);
  assert.doesNotMatch(app, /__DEV__[\s\S]{0,80}EXPO_PUBLIC_FRONTEND_PREVIEW/);
  assert.match(metro, /EXPO_PUBLIC_FRONTEND_PREVIEW !== '1'/);
  assert.match(metro, /production-fixtures\.ts/);
  assert.match(metro, /production-route-stubs\.tsx/);
  assert.match(metro, /production-preview-localization\.ts/);
  assert.match(metro, /production-chat-simulator\.ts/);
  assert.match(metro, /chat-fixture-simulator/);
  assert.doesNotMatch(productionFixtures, /ses_|HMS-|Mapped the customized|Deployment is healthy/);
  assert.doesNotMatch(productionRouteStubs, /v0\.9\.3|HMS-|Workspace backup|Deployment is healthy/);
  assert.doesNotMatch(productionPreviewLocalization, /HMS-|fixture routes|Gateway deployment|Workspace backup/);
  assert.doesNotMatch(productionChatSimulator, /preview\/local-hermes|当前消息按简单对话处理/);
  assert.match(workflow, /verify-production-bundle\.mjs/);
  assert.match(productionVerifier, /verifyProductionBuffers/);
  assert.match(productionContract, /preview fixture leaked into the production bundle/);
  for (const marker of [
    'HMS-142',
    'Complete frontend fixture routes',
    'Research digest automation',
    'Workspace backup',
    'Tasks Completed',
    'native-ios',
    'HERMES AGENT  v0.9.3',
  ]) {
    assert.ok(productionContract.includes(marker));
  }
});

test('Expo Go fallback never replaces the exact blur in signed native builds', () => {
  const bridge = read('modules/hermes-live-blur/index.ts');
  const nativeBlur = read('modules/hermes-live-blur/ios/HermesLiveBlurView.swift');
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
  };

  assert.match(bridge, /requireOptionalNativeModule\('HermesLiveBlur'\)/);
  assert.match(bridge, /requireNativeView<.*>\('HermesLiveBlur'\)/s);
  assert.match(bridge, /return createElement\(BlurView/);
  assert.match(bridge, /if \(NativeHermesLiveBlurView\)/);
  assert.equal(packageJson.dependencies['expo-blur'], '~15.0.8');
  assert.match(nativeBlur, /String\("retliFAC"\.reversed\(\)\)/);
  assert.match(nativeBlur, /String\("rulBnaissuag"\.reversed\(\)\)/);
  assert.match(nativeBlur, /backdropLayer\.filters = \[gaussianFilter\]/);
});

test('native runtime adapts spatial and looping motion to the OS Reduce Motion setting', () => {
  const runtime = [
    read('src/app/NativeShell.tsx'),
    read('src/auth/LoginScreen.tsx'),
    read('src/components/ui/ConfirmDialog.tsx'),
    read('src/components/ui/NativeButton.tsx'),
    read('src/components/ui/NativeInput.tsx'),
    read('src/components/ui/NativeListItem.tsx'),
    read('src/studio/FrontendPreviewApp.tsx'),
    read('src/studio/PreviewChatPage.tsx'),
    read('src/studio/PreviewPrimitives.tsx'),
    read('modules/hermes-live-blur/ios/HermesLiquidGlassView.swift'),
  ].join('\n');

  const motion = read('src/design/motion.ts');
  const swiftUI = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIPartialFrontendModule.swift',
  );
  assert.match(motion, /useReducedMotion/);
  assert.match(motion, /reduced: 120/);
  assert.match(runtime, /useMotion|reduceMotion/);
  assert.match(swiftUI, /@Environment\(\\\.accessibilityReduceMotion\)/);
  assert.match(swiftUI, /hermesReducedMotionFade/);
  assert.doesNotMatch(runtime, /reduceTransparency|isReduceTransparency/);

  const loopingSources = [
    read('src/components/ui/NativeButton.tsx'),
    read('src/studio/PreviewMemoryPage.tsx'),
    read('src/studio/chat/ChatComposerPresentation.tsx'),
    read('src/studio/chat/ChatPresentation.tsx'),
  ].join('\n');
  assert.match(loopingSources, /visible && !motion\.reduceMotion/);
  assert.match(loopingSources, /if \(motion\.reduceMotion\)/);
  assert.match(loopingSources, /busy && !motion\.reduceMotion/);
});

test('preview appearance persistence is limited to theme and font', () => {
  const themeProvider = read('src/design/ThemeProvider.tsx');
  const previewStart = themeProvider.indexOf(
    'export function FrontendPreviewThemeProvider',
  );
  const previewSource = themeProvider.slice(previewStart);

  assert.match(previewSource, /hermes\.preview\.studio\.theme/);
  assert.match(previewSource, /hermes\.preview\.studio\.font/);
  assert.doesNotMatch(previewSource, /HermesApiClient|setTheme\(value\)|setFontPref/);
});

test('the transport client carries no product endpoints and pages share one composition root', () => {
  const apiClient = read('src/api/HermesApiClient.ts');
  const themeApi = read('src/design/theme-api.ts');
  const registry = read('src/api/hermes-api-registry.ts');

  // Dashboard theme/font endpoints belong to the design layer; the transport
  // client must never import design payload shapes again.
  assert.doesNotMatch(apiClient, /theme-types|getThemes|setFontPref|dashboard\/theme/);
  assert.match(themeApi, /api\/dashboard\/themes/);
  assert.match(themeApi, /api\/dashboard\/font/);
  assert.match(read('src/design/ThemeProvider.tsx'), /new HermesThemeApi\(client\)/);

  // The registry is the only production module allowed to construct the
  // product API objects; every page asks it for the shared instances.
  assert.match(registry, /new HermesCloudApi\(client\)/);
  assert.match(registry, /new ConversationLocalStore\(\)/);
  for (const page of [
    'src/app/useHermesSwiftUIRouteData.ts',
    'src/models/ModelsManagementPage.tsx',
    'src/api/local-account-purge.ts',
  ]) {
    const source = read(page);
    assert.doesNotMatch(source, /new HermesCloudApi\(/, `${page} constructs HermesCloudApi`);
    assert.doesNotMatch(source, /new ConversationLocalStore\(/, `${page} constructs ConversationLocalStore`);
  }
});

test('chat preview preserves the customized collaboration single-chat contract', () => {
  const app = read('src/studio/FrontendPreviewApp.tsx');
  const chat = [
    read('src/studio/PreviewChatPage.tsx'),
    read('src/studio/chat/useChatPageActions.ts'),
    read('src/studio/chat/ChatPresentation.tsx'),
    read('src/studio/chat/ChatCollaborationPresentation.tsx'),
    read('src/studio/chat/ChatHeader.tsx'),
    read('src/studio/chat/ChatMessageStream.tsx'),
    read('src/studio/chat/ChatComposer.tsx'),
    read('src/studio/chat/ChatComposerPresentation.tsx'),
    read('src/studio/chat/ChatPlanDrawer.tsx'),
    read('src/studio/chat/ChatPageShell.tsx'),
    read('src/studio/chat/chat-plan-model.ts'),
    read('src/studio/chat/ConversationHistory.tsx'),
    read('src/studio/chat/ChatModelToolsDrawer.tsx'),
    read('src/studio/chat/chat-presentation-styles.ts'),
    read('src/studio/chat/chat-attachments.ts'),
    read('src/studio/chat/useChatScrollController.ts'),
    read('src/studio/chat/useConversationIndexLifecycle.ts'),
    read('src/studio/chat/useConversationIndexController.ts'),
    read('src/studio/chat/useConversationSnapshotController.ts'),
    read('src/studio/chat/useOptimisticConversationState.ts'),
    read('src/studio/chat/useHostedConversationStream.ts'),
    read('src/studio/chat/useHostedCancellationController.ts'),
    read('src/studio/chat/useHostedOutboxReplayController.ts'),
    read('src/studio/chat/useChatAttachmentController.ts'),
    read('src/studio/chat/useChatAttachmentLifecycle.ts'),
    read('src/studio/chat/useHostedInterventionController.ts'),
    read('src/studio/chat/useHostedSendController.ts'),
    read('src/studio/chat/useHostedTurnDeliveryService.ts'),
    read('src/studio/chat/useConversationActionsController.ts'),
    read('src/studio/chat/useChatComposerNavigationController.ts'),
    read('src/studio/chat/useHermesVoice.ts'),
  ].join('\n');
  const contextMenu = read('src/components/ios/IOSContextMenu.tsx');
  const contextMenuBridge = read('modules/hermes-context-menu/index.ts');
  const contextMenuNative = read(
    'modules/hermes-context-menu/ios/HermesContextMenuView.swift',
  );
  const quickLookBridge = read('modules/hermes-quick-look/index.ts');
  const quickLookNative = read('modules/hermes-quick-look/ios/HermesQuickLookModule.swift');
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
  };

  assert.match(app, /from '\.\/PreviewChatPage'/);
  assert.doesNotMatch(chat, /KeyboardAvoidingView/);
  assert.match(chat, /useAnimatedKeyboard\(\)/);
  assert.doesNotMatch(chat, /useAnimatedReaction\(/);
  assert.doesNotMatch(chat, /runOnJS\(keepLatestVisible\)\(false\)/);
  assert.match(chat, /paddingBottom: keyboard\.height\.value \* keyboardAvoidanceEnabled\.value/);
  assert.match(chat, /composerInputRef\.current\?\.blur\(\)/);
  assert.match(chat, /keyboardAvoidanceEnabled\.value = 0/);
  assert.match(chat, /requestAnimationFrame\(\(\) => showIOSAttachmentPicker\(ownerEpoch\)\)/);
  assert.match(
    chat,
    /<Reanimated\.View[\s\S]{0,240}styles\.composer,[\s\S]*composerKeyboardStyle/,
  );
  assert.doesNotMatch(
    chat,
    /<View\s*style=\{\[\s*styles\.composer/,
  );
  assert.match(chat, /keyboardDidHide/);
  assert.match(chat, /Keyboard\.dismiss\(\)/);
  assert.match(chat, /keyboardDismissMode="interactive"/);
  assert.match(chat, /useEffect\(\(\) => \{\s*keepLatestVisible\(false\);\s*\}, \[followVersion, keepLatestVisible\]\)/);
  assert.doesNotMatch(chat, /onContentSizeChange=\{\(\) => keepLatestVisible/);
  assert.doesNotMatch(chat, /onLayout=\{\(\) => keepLatestVisible\(false\)\}/);
  assert.match(chat, /cancelAnimationFrame\(pendingScrollFrame\.current\)/);
  assert.match(chat, /keepLatestVisible\(true, true\)/);
  assert.match(chat, /onFocus=\{actions\.onFocus\}/);
  assert.match(
    chat,
    /onFocus: \(\) => \{[\s\S]{0,260}keyboardAvoidanceEnabled\.value = 1;[\s\S]{0,160}keepLatestVisible\(false, true\);/,
  );
  assert.match(chat, /Hermes Agent/);
  assert.doesNotMatch(chat, /当前窗口持续使用同一个会话|This window keeps using the same conversation/);
  assert.match(chat, /collaborationState !== 'single'/);
  assert.match(chat, /accessibilityLabel=\{model\.isChinese \? '上传图片或文件'/);
  assert.match(chat, /haptic="light"[\s\S]{0,220}scaleTo=\{0\.9\}/);
  assert.match(chat, /accessibilityLabel=\{model\.isChinese \? '拍照'/);
  assert.match(chat, /onPress=\{actions\.onTakePhoto\}/);
  assert.match(chat, /onTakePhoto: \(\) => \{ void pickPhoto\(true\); \}/);
  assert.match(chat, /ImagePicker\.launchCameraAsync/);
  assert.match(chat, /UIImagePickerPresentationStyle\.FULL_SCREEN/);
  assert.match(chat, /onLongPress=\{voiceInputActive \? undefined : actions\.onToggleReadRepliesAloud\}/);
  assert.doesNotMatch(chat, /语音输入需要在 iPhone 原生版本中使用/);
  assert.match(chat, /useAudioRecorder\(RecordingPresets\.HIGH_QUALITY\)/);
  assert.match(chat, /cloudApi\.transcribeAudio\(/);
  assert.match(chat, /subscribeVoiceTranscript/);
  assert.match(chat, /applyTranscript\(`\$\{voiceDraftPrefixRef\.current\}\$\{event\.text\}`\)/);
  assert.match(chat, /ImagePicker\.launchCameraAsync/);
  assert.match(chat, /name="camera\.fill"[\s\S]{0,80}size=\{22\}/);
  assert.match(chat, /name=\{model\.voiceState === 'listening' \? 'stop\.fill' : 'mic'\}/);
  assert.match(chat, /model\.voiceState === 'listening' \? 16 : 22/);
  assert.match(chat, /voicePrimaryAction === 'toggleReadRepliesAloud'/);
  assert.match(chat, /accessibilityState=\{\{[\s\S]{0,120}disabled: voiceControlDisabled/);
  assert.match(chat, /delayLongPress=\{400\}/);
  assert.doesNotMatch(chat, /accessibilityLabel=\{model\.isChinese \? '输入斜杠命令'/);
  assert.match(chat, /filteredSlashCommands/);
  assert.match(chat, /styles\.openMinisSlashPopup/);
  assert.match(chat, /height: 224/);
  assert.match(chat, /showScrollToBottom && !slashMenuOpen/);
  assert.match(chat, /OpenMinisVoiceWaveform/);
  assert.match(chat, /openMinisToolbar: \{[^}]*flexDirection: 'row'/);
  assert.match(chat, /openMinisRoundControl: \{[^}]*height: 38[^}]*width: 38/);
  assert.match(chat, /<ChatPlanDrawer/);
  assert.match(chat, /const chatPlan = useMemo\(\(\) => latestChatPlan\(displayMessages\)/);
  assert.match(chat, /Gesture\.Pan\(\)/);
  assert.match(chat, /event\.translationX/);
  assert.match(chat, /const drawerWidth = width/);
  assert.match(chat, /\[0, 1\], Extrapolation\.CLAMP/);
  assert.doesNotMatch(chat, /pointerEvents=\{open \? 'auto' : 'none'\}/);
  assert.match(chat, /Plan.*\$\{completed\}\/\$\{total\}/s);
  assert.match(chat, /activity\.toolName, activity\.name/);
  assert.match(chat, /'cancelled',\s*'completed',\s*'in_progress',\s*'pending'/s);
  assert.match(chat, /OpenMinis\/OpenMinis@9cf3a855/);
  assert.match(chat, /styles\.gatewayStatusLabel/);
  assert.match(chat, /styles\.gatewayStatusVersion/);
  assert.match(chat, /gatewayStatusLabel: \{[\s\S]*width: 36/);
  assert.match(chat, /gatewayStatusVersion: \{[\s\S]*textAlign: 'left'/);
  assert.match(chat, /新对话/);
  assert.match(chat, /function UnifiedMessage/);
  assert.match(app, /clearPreferredConversationId/);
  assert.match(chat, /onPreferredConversationConsumed\?\.\(preferredConversationId\)/);
  assert.doesNotMatch(app, /继续对话|Continue conversation/);
  assert.match(chat, /function RoleActivityGroup/);
  assert.match(chat, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(chat, /styles\.activityCount/);
  assert.match(chat, /activity\.category === 'reasoning'/);
  assert.match(chat, /styles\.reasoningActivityDetail/);
  assert.match(chat, /activityDisplayContent\(activity\)/);
  assert.match(chat, /function ConversationHistory/);
  assert.match(chat, /previewConversationHistory/);
  assert.match(chat, /accessibilityLabel=\{isChinese \? '[^']+' : 'Refresh history'\}[\s\S]{0,100}onPress=\{onRefresh\}/);
  assert.match(chat, /accessibilityLabel="Check API Relay" onPress=\{onCheckRelay\}/);
  assert.match(chat, /cloudApi\.getStatus\(\)/);
  assert.match(chat, /isChinese \? '会话' : 'Conversations'/);
  assert.doesNotMatch(chat, /<ModelToolsDrawer/);
  assert.match(chat, /animationType="none"/);
  assert.match(chat, /translateX/);
  assert.match(chat, /withSpring\(0,[\s\S]*IOS_MOTION\.spring\.stiffness/);
  assert.match(chat, /const motion = useMotion\(\)/);
  assert.match(chat, /if \(motion\.reduceMotion\)/);
  assert.match(chat, /runOnJS\(setMounted\)\(false\)/);
  assert.match(chat, /styles\.drawerBackdrop, backdropStyle/);
  assert.match(chat, /safeAreaBottom/);
  assert.match(chat, /\[Math\.max\(10, safeAreaBottom - 12\), 6\]/);
  assert.match(chat, /ActionSheetIOS\.showActionSheetWithOptions/);
  assert.match(chat, /launchImageLibraryAsync/);
  assert.match(chat, /launchCameraAsync/);
  assert.match(chat, /ImagePicker\.getPendingResultAsync\(\)/);
  assert.match(chat, /DocumentPicker\.getDocumentAsync/);
  assert.match(chat, /attachmentPickerFlight\.current\.run/);
  assert.match(chat, /subscribeToWebPickerAbandonment/);
  assert.match(chat, /cleanupAttachmentSources\(prepared\)/);
  assert.match(chat, /copyToCacheDirectory: true/);
  assert.match(
    chat,
    /copyAttachmentIntoDraftCache\(\s*cacheOwner \|\| 'local',\s*asset\.uri/,
  );
  assert.match(chat, /ownedTemporary: Platform\.OS !== 'web'/);
  assert.match(chat, /if \(Platform\.OS === 'web'\) return;/);
  assert.match(chat, /cleanupAttachmentSources\(pendingAttachments\)/);
  assert.match(
    chat,
    /cleanupAttachmentSources\([\s\S]{0,120}attachmentsRef\.current\.filter\(\(attachment\) => !attachment\.draftPersistent\)/,
  );
  assert.match(chat, /cleanupAttachmentSources\(\[attachment\]\)/);
  assert.match(chat, /Sharing\.shareAsync/);
  assert.match(chat, /presentQuickLook/);
  assert.match(chat, /<IOSContextMenu/);
  assert.match(chat, /id: 'preview'/);
  assert.match(chat, /id: 'share'/);
  assert.match(chat, /id: 'remove'/);
  assert.match(chat, /destructive: true/);
  assert.match(contextMenu, /ActionSheetIOS\.showActionSheetWithOptions/);
  assert.match(contextMenu, /onLongPress=\{hasNativeContextMenu \? undefined : showFallback\}/);
  assert.match(contextMenuBridge, /requireOptionalNativeModule/);
  assert.match(contextMenuBridge, /requireNativeView/);
  assert.match(contextMenuNative, /UIContextMenuInteraction/);
  assert.match(contextMenuNative, /UIMenu/);
  assert.match(contextMenuNative, /UIAction/);
  assert.match(chat, /<SymbolView/);
  assert.match(chat, /PlatformColor\('secondarySystemBackground'\)/);
  assert.match(chat, /backgroundColor: tokens\.colors\.card/);
  assert.match(chat, /borderColor: tokens\.colors\.border/);
  assert.doesNotMatch(chat, /DynamicColorIOS/);
  assert.doesNotMatch(chat, /<HermesLiveBlurView/);
  assert.match(chat, /borderColor: 'transparent', borderWidth: 0/);
  assert.match(chat, /outlineColor: 'transparent', outlineStyle: 'solid', outlineWidth: 0/);
  assert.match(chat, /borderWidth: StyleSheet\.hairlineWidth/);
  assert.doesNotMatch(chat, /<HermesSwiftUIFrostedSurfaceView|<BlurView/);
  assert.doesNotMatch(chat, /<GlassView|isLiquidGlassAvailable\(\)/);
  assert.match(chat, /resolveComposerFontSize\(content\)/);
  assert.match(chat, /Math\.max\(12, 16 - \(Math\.min\(glyphCount, 40\) - 28\) \/ 3\)/);
  assert.equal(packageJson.dependencies['expo-glass-effect'], '~0.1.10');
  assert.equal(packageJson.dependencies['expo-asset'], '~12.0.13');
  assert.equal(packageJson.dependencies['expo-audio'], '~1.1.1');
  assert.equal(packageJson.dependencies['expo-speech'], '~14.0.8');
  assert.equal(packageJson.dependencies['expo-symbols'], '~1.0.8');
  assert.match(quickLookBridge, /requireOptionalNativeModule<.*>\([\s\S]*'HermesQuickLook'/);
  assert.match(quickLookNative, /import QuickLook/);
  assert.match(quickLookNative, /QLPreviewController\(\)/);
  assert.match(quickLookNative, /title: String\?, promise: Promise/);
  assert.match(quickLookNative, /promise\.resolve\(true\)/);
  assert.doesNotMatch(quickLookNative, /withCheckedContinuation/);
  assert.match(quickLookNative, /\.runOnQueue\(\.main\)/);
  assert.match(chat, /function AttachmentItem/);
  assert.match(
    chat,
    /await localStore\.initializePendingEnqueue\([\s\S]{0,500}enqueuePersisted = true;/,
  );
  assert.match(
    chat,
    /const delivery = await outbox\.deliverPendingEnqueue\(queuedItem, ownerEpoch\);\s*if \(!isCurrentSend\(\)\) return;\s*queuedItem = delivery\.item;/,
  );
  assert.match(
    chat,
    /enqueueAcknowledged = true;\s*hostedAccepted = delivery\.response\.accepted;/,
  );
  assert.match(
    chat,
    /const acceptedMutation = await outbox\.acceptPendingOutboxItem\(queuedItem, ownerEpoch\);[\s\S]{0,1400}setHostedRunning\(true\);/,
  );
  assert.match(
    chat,
    /const responseFailure = hostedTurnResponseFailure\(delivery\.response\);/,
  );
  assert.match(
    chat,
    /const outcome = await cancellation\.handleOutboxFailure\(\s*queuedItem,\s*responseFailure,\s*ownerEpoch,\s*\);/,
  );
  assert.match(
    chat,
    /updatePendingPhase\('reconnecting', reconnecting\.phaseStartedAt\);/,
  );
  assert.match(
    chat,
    /if \(enqueuePersisted && !enqueueAcknowledged\) \{[\s\S]{0,800}handleOutboxFailure/,
  );
  assert.doesNotMatch(chat, /<HermesLiquidGlassView/);
  assert.match(chat, /<StudioOfficialAvatar/);
  assert.equal(packageJson.dependencies['@multiavatar/multiavatar'], '1.0.7');
  assert.doesNotMatch(chat, /TerminalStatusBar|terminalTranscript/);
  assert.doesNotMatch(chat, /<PreviewModal[^>]+title=\{isChinese \? '模型与工具'/);
});

test('interactive preview controls never use empty callbacks or actionless buttons', () => {
  const interactiveSources = [
    'src/preview/PreviewAutomationPages.tsx',
    'src/preview/HermesStudioSettingsPage.tsx',
    'src/preview/PreviewPluginPages.tsx',
    'src/preview/PreviewSettingsPages.tsx',
  ].map(read).join('\n');

  assert.doesNotMatch(
    interactiveSources,
    /on(?:Change|Press|ValueChange)=\{\([^)]*\)\s*=>\s*\{\s*\}\}/,
  );
  assert.doesNotMatch(
    interactiveSources,
    /<NativeButton(?:(?!onPress|>).)*>(?:Archive|Add server)<\/NativeButton>/s,
  );
  assert.match(interactiveSources, /onChange=\{setStatusFilter\}/);
  assert.match(interactiveSources, /onChange=\{setDeliverOnly\}/);
  assert.match(interactiveSources, /toggleServer\(server\.name, active\)/);
  assert.match(interactiveSources, /setArchivedTasks/);
  for (const [input] of interactiveSources.matchAll(/(<NativeInput\b[^>]*\bvalue=\{?[^>]*\/>)/g)) {
    assert.match(
      input,
      /onChangeText=|editable=\{false\}/,
      `controlled input is missing an update handler: ${input}`,
    );
  }
});

test('Studio secondary surfaces keep the device, account, and compact-header contracts', () => {
  const automation = read('src/preview/PreviewAutomationPages.tsx');
  const account = read('src/auth/AccountPage.tsx');
  const primitives = read('src/studio/PreviewPrimitives.tsx');

  assert.match(automation, /输入远程设备 URL/);
  assert.match(automation, /复制配对链接/);
  assert.match(automation, /Agent 版本/);
  assert.match(automation, /配对请求/);
  assert.match(account, /StudioProfileAvatar/);
  assert.match(account, /账户独立加密归档/);
  assert.match(account, /本地明文缓存/);
  assert.match(primitives, /!compact \? <View style=\{styles\.pageHeadingCopy\}>/);
  assert.match(primitives, /pageHeaderCompact/);
});

test('application surfaces use the shared iOS press, swipe, and haptic controls', () => {
  const applicationSources = [
    'src/app/HermesNativeApp.tsx',
    'src/app/NativeShell.tsx',
    'src/auth/LoginScreen.tsx',
    'src/studio/FrontendPreviewApp.tsx',
    'src/preview/PreviewAutomationPages.tsx',
    'src/studio/PreviewChatPage.tsx',
    'src/preview/PreviewCorePages.tsx',
    'src/preview/PreviewPluginPages.tsx',
    'src/studio/PreviewPrimitives.tsx',
    'src/preview/PreviewSettingsPages.tsx',
    'src/studio/TeamParticipants.tsx',
  ].map(read).join('\n');
  const iosPressable = read('src/components/ios/IOSPressable.tsx');
  const swipeActions = read('src/components/ios/IOSSwipeActions.tsx');
  const swipeBridge = read('modules/hermes-swipe-actions/index.ts');
  const swipeNative = read(
    'modules/hermes-swipe-actions/ios/HermesSwipeActionsView.swift',
  );

  assert.doesNotMatch(applicationSources, /\bPressable\b/);
  assert.match(applicationSources, /IOSPressable/);
  assert.match(applicationSources, /IOSSwipeActions/);
  assert.match(iosPressable, /Reanimated\.createAnimatedComponent\(Pressable\)/);
  assert.match(iosPressable, /withSpring\(1, spring\)/);
  assert.match(iosPressable, /Haptics\.impactAsync/);
  assert.match(iosPressable, /Haptics\.selectionAsync/);
  assert.match(iosPressable, /haptic = 'none'/);
  assert.match(iosPressable, /onPress=\{\(event\) => \{[\s\S]*playHaptic\(haptic\)/);
  assert.match(swipeActions, /HermesSwipeActionsView/);
  assert.doesNotMatch(swipeActions, /ReanimatedSwipeable/);
  assert.match(swipeBridge, /requireNativeView/);
  assert.match(swipeNative, /UITableViewCell/);
  assert.match(swipeNative, /UISwipeActionsConfiguration/);
  assert.match(swipeNative, /UIContextualAction/);
});

test('mobile shell remains full bleed and keeps the WebUI sidebar readable without blur', () => {
  const shell = read('src/app/NativeShell.tsx');
  const app = read('src/studio/FrontendPreviewApp.tsx');
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
  ].join('\n');

  assert.match(shell, /const sidebarBackground = rootBackground/);
  assert.match(shell, /backgroundColor: sidebarBackground/);
  assert.match(shell, /drawerStyle=\{\[[\s\S]*\{ backgroundColor, width: drawerWidth \}[\s\S]*\]\}/);
  assert.match(shell, /drawerType="front"/);
  assert.doesNotMatch(app, /accessibilityLabel="Theme and font"|onTheme=/);
  assert.doesNotMatch(shell, /HermesLiveBlurView/);
  assert.doesNotMatch(shell, /swiftUIDrawerHost|mobileSidebar|left: drawerExtent/);
  assert.match(chat, /backgroundColor: 'transparent'/);
  assert.match(chat, /drawerBackdrop: \{ backgroundColor: 'rgba\(0,0,0,0\.60\)', right: 256 \}/);
  const contentStart = shell.indexOf('styles.content,');
  const contentBlock = shell.slice(
    contentStart,
    shell.indexOf('{activeRoute', contentStart),
  );
  assert.doesNotMatch(contentBlock, /paddingBottom: insets\.bottom/);
});

test('secondary interfaces use the native iOS sheet transition', () => {
  const primitives = read('src/studio/PreviewPrimitives.tsx');
  const sheetBridge = read('modules/hermes-sheet-controller/index.ts');
  const sheetNative = read(
    'modules/hermes-sheet-controller/ios/HermesSheetControllerModule.swift',
  );

  assert.match(primitives, /allowSwipeDismissal=\{iosSheet\}/);
  assert.match(primitives, /animationType=\{iosSheet \? 'slide' : 'fade'\}/);
  assert.match(primitives, /presentationStyle=\{iosSheet \? 'pageSheet' : 'overFullScreen'\}/);
  assert.match(primitives, /transparent=\{!iosSheet\}/);
  assert.match(primitives, /configurePresentedSheet\(\)/);
  assert.match(sheetBridge, /requireOptionalNativeModule/);
  assert.match(sheetNative, /sheet\.detents = \[\.medium\(\), \.large\(\)\]/);
  assert.match(sheetNative, /sheet\.prefersGrabberVisible = true/);
  assert.match(sheetNative, /sheet\.prefersScrollingExpandsWhenScrolledToEdge = true/);
  assert.match(sheetNative, /sheet\.animateChanges/);
});

test('cron scheduling uses the native compact iOS time picker', () => {
  const automation = read('src/preview/PreviewAutomationPages.tsx');
  const timePicker = read('src/components/ios/IOSTimePicker.tsx');
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
  };

  assert.match(automation, /<IOSTimePicker/);
  assert.match(timePicker, /@react-native-community\/datetimepicker/);
  assert.match(timePicker, /display=\{Platform\.OS === 'ios' \? 'compact' : 'default'\}/);
  assert.match(timePicker, /mode="time"/);
  assert.match(timePicker, /accentColor=\{tokens\.colors\.primary\}/);
  assert.match(timePicker, /textColor=\{tokens\.colors\.foreground\}/);
  assert.match(timePicker, /themeVariant=\{isLightHex\(theme\.palette\.background\.hex\) \? 'light' : 'dark'\}/);
  assert.doesNotMatch(timePicker, /Haptics\.selectionAsync/);
  assert.equal(
    packageJson.dependencies['@react-native-community/datetimepicker'],
    '8.4.4',
  );
});

test('selection, search, switch, and progress controls use UIKit in signed builds', () => {
  const primitives = read('src/studio/PreviewPrimitives.tsx');
  const bridge = read('modules/hermes-ios-controls/index.ts');
  const segmented = read(
    'modules/hermes-ios-controls/ios/HermesSegmentedControlModule.swift',
  );
  const nativeSwitch = read(
    'modules/hermes-ios-controls/ios/HermesSwitchModule.swift',
  );
  const search = read(
    'modules/hermes-ios-controls/ios/HermesSearchBarModule.swift',
  );
  const progress = read(
    'modules/hermes-ios-controls/ios/HermesProgressModule.swift',
  );
  const selection = read(
    'modules/hermes-ios-controls/ios/HermesSelectionModule.swift',
  );

  assert.match(bridge, /requireNativeView/);
  assert.match(primitives, /HermesSegmentedControlView/);
  assert.match(primitives, /HermesSwitchView/);
  assert.match(primitives, /HermesSearchBarView/);
  assert.match(primitives, /HermesProgressView/);
  assert.match(primitives, /HermesSelectionView/);
  assert.match(segmented, /UISegmentedControl/);
  assert.match(nativeSwitch, /UISwitch/);
  assert.match(search, /UISearchBar/);
  assert.match(progress, /UIProgressView/);
  assert.match(selection, /UIViewPropertyAnimator/);
  assert.doesNotMatch(primitives, /clearButtonMode="while-editing"[\s\S]*styles\.searchClear/);
});

test('preview share, import, export, and model selection open iOS system surfaces', () => {
  const chat = [
    read('src/studio/PreviewChatPage.tsx'),
    read('src/studio/chat/useChatPageState.ts'),
    read('src/studio/chat/useChatPageActions.ts'),
    read('src/studio/chat/ChatComposer.tsx'),
    read('src/studio/chat/useHostedSendController.ts'),
  ].join('\n');
  const plugins = read('src/preview/PreviewPluginPages.tsx');
  const settings = read('src/preview/PreviewSettingsPages.tsx');

  assert.match(chat, /haptic=\{model\.canCancelHostedTurn \? 'medium' : model\.canSend \? 'light' : 'none'\}/);
  assert.match(chat, /hitSlop=\{8\}[\s\S]*onPress=\{model\.canCancelHostedTurn \?[\s\S]*: actions\.onSend\}/);
  assert.match(chat, /const currentContent = contentRef\.current/);
  assert.match(chat, /sendSubmissionGateRef\.current\.tryAcquire\(\)/);
  assert.match(
    chat,
    /initializePendingEnqueue\([\s\S]*enqueuePersisted = true;[\s\S]*setSending\(true\);/,
  );
  assert.match(chat, /void send\(\)\.finally\(\(\) => sendSubmissionGateRef\.current\.release\(\)\);/);
  assert.doesNotMatch(chat, /pendingSendFrame/);
  // PreviewCorePages no longer asserts an ActionSheetIOS call: its only
  // occurrence lived in a dead duplicate ChatPreviewPage that was never
  // imported (the real one comes from ./PreviewChatPage) and has been
  // deleted. The live action-sheet paths are still pinned on `chat` above
  // and on `contextMenu`.
  assert.match(plugins, /Share\.share\(/);
  assert.match(settings, /new File\(Paths\.cache, 'hermes-config-preview\.json'\)/);
  assert.match(settings, /Sharing\.shareAsync\(file\.uri/);
  assert.match(settings, /DocumentPicker\.getDocumentAsync\(\{/);
  assert.doesNotMatch(plugins, /Achievement share sheet opened/);
  assert.doesNotMatch(settings, /Config import picker opened|Config JSON export prepared/);
});

test('chat continuation keeps the opened conversation Profile on every send step', () => {
  const chat = [
    read('src/studio/PreviewChatPage.tsx'),
    read('src/studio/chat/useHostedSendController.ts'),
    read('src/studio/chat/useHostedTurnDeliveryService.ts'),
  ].join('\n');

  assert.match(
    chat,
    /conversationIndexRef\.current\.find\([\s\S]*activeConversationIdRef\.current[\s\S]*\?\.profile\?\.trim\(\)[\s\S]*\|\| profile/,
  );
  assert.match(chat, /const conversationProfile = \([\s\S]*\?\.profile\?\.trim\(\)[\s\S]*\|\| profile/);
  assert.match(chat, /profiles: \[conversationProfile\]/);
  assert.match(chat, /conversationProfile,\s*conversationTitle:/);
  assert.match(chat, /conversationProfile,\s*conversationTitle:/);
  assert.match(chat, /profile: item\.conversationProfile \|\| profile,\s*turnId: item\.input\.turnId/);
});

test('stale conversation selection is removed instead of surfacing another 404', () => {
  const chat = [
    read('src/studio/PreviewChatPage.tsx'),
    read('src/studio/chat/useConversationActionsController.ts'),
  ].join('\n');
  assert.match(chat, /if \(isConversationNotFoundError\(error\)\) \{/);
  assert.match(chat, /conversationIndexRef\.current\.filter\([\s\S]*id !== conversationId/);
  assert.match(chat, /commitConversationIndex\(remaining, fallbackId, ownerEpoch\)/);
  assert.match(chat, /await openConversation\(fallbackId, generation\)/);
});

test('chat and notification lifecycles fence stale work without restarting account services', () => {
  const route = read('src/app/useHermesSwiftUIRouteData.ts');
  const notifications = read('src/notifications/NotificationProvider.tsx');
  const indexLifecycle = read('src/studio/chat/useConversationIndexLifecycle.ts');
  const snapshot = read('src/studio/chat/useConversationSnapshotController.ts');
  const state = read('src/studio/chat/useChatPageState.ts');
  const send = read('src/studio/chat/useHostedSendController.ts');

  assert.match(route, /let pollInFlight = false/);
  assert.doesNotMatch(route, /const pollInFlight = useRef/);
  assert.match(route, /EVENT_FAILURE_LOG_INTERVAL_MS = 60_000/);
  assert.match(route, /Hermes managed-resource event refresh failed/);
  assert.doesNotMatch(
    route,
    /consumeManagedResourceEvents\([\s\S]{0,800}\.catch\(\(\) => undefined\)/,
  );
  assert.match(notifications, /new Map<string, number>\(\)/);
  assert.match(notifications, /MAX_HANDLED_NOTIFICATIONS = 256/);
  assert.match(notifications, /notificationAccountRef\.current/);
  assert.doesNotMatch(notifications, /\}, \[client, state\]\)/);
  assert.doesNotMatch(notifications, /\[client, rememberDeviceId, runtime, state\]/);
  assert.match(indexLifecycle, /openNotificationConversation\(notificationConversationId\)/);
  assert.doesNotMatch(
    indexLifecycle,
    /preferredConversationId \|\| notificationConversationId/,
  );
  assert.doesNotMatch(indexLifecycle, /catch\(\(\) => undefined\)/);
  assert.match(
    snapshot,
    /!activateConversation[\s\S]{0,100}activeConversationIdRef\.current !== incomingConversation\.id/,
  );
  assert.match(state, /messagesRef\.current = next/);
  assert.match(send, /const pendingAttachments = \[\.\.\.attachmentsRef\.current\]/);
  assert.match(send, /const currentMessages = \[\.\.\.messagesRef\.current\]/);
  assert.doesNotMatch(send, /recentMessages: \[\.\.\.messages, userMessage\]/);
});

test('same-owner account epochs fence every long-lived chat callback', () => {
  const snapshot = read('src/studio/chat/useConversationSnapshotController.ts');
  const index = read('src/studio/chat/useConversationIndexController.ts');
  const actions = read('src/studio/chat/useConversationActionsController.ts');
  const stream = read('src/studio/chat/useHostedConversationStream.ts');
  const outbox = read('src/studio/chat/useHostedOutboxReplayController.ts');

  for (const source of [snapshot, index, actions, stream, outbox]) {
    assert.match(source, /captureConversationStorageEpoch/);
    assert.match(source, /isConversationStorageEpochCurrent/);
  }
  assert.match(snapshot, /applyConversation\(conversation, ownerEpoch, false, activateConversation\)/);
  assert.match(index, /commitConversationIndex\(synchronized, activeId, ownerEpoch\)/);
  assert.match(actions, /applyConversation\(result\.conversation, ownerEpoch, false, true\)/);
  assert.match(actions, /applyConversation\(response\.conversation, ownerEpoch, false, true\)/);
  assert.match(
    stream,
    /applyConversation\([\s\S]*hosted_event_cursor:[\s\S]*ownerEpoch, resetCursor(?:, false, true)?\)/,
  );
  assert.match(outbox, /const lifecycleCurrent = \(\) => isConversationStorageEpochCurrent/);
});

test('Chinese preview mode translates every shared visible control surface', () => {
  const i18n = read('src/i18n/NativeLocalization.tsx');
  const app = read('src/studio/FrontendPreviewApp.tsx');
  const button = read('src/components/ui/NativeButton.tsx');
  const input = read('src/components/ui/NativeInput.tsx');
  const dialog = read('src/components/ui/ConfirmDialog.tsx');
  const primitives = read('src/studio/PreviewPrimitives.tsx');

  assert.match(app, /<NativeLocalizationProvider locale=\{locale\}>/);
  for (const source of [button, input, dialog, primitives]) {
    assert.match(source, /useNativeLocalization/);
  }
  for (const translation of [
    "'Runtime': '\u8fd0\u884c\u73af\u5883'",
    "'Credentials': '\u51ed\u636e'",
    "'Replace': '\u66ff\u6362'",
    "'Add credential': '\u6dfb\u52a0\u51ed\u636e'",
    "'Set active': '\u8bbe\u4e3a\u5f53\u524d'",
    "'SOUL.md': '\u7f16\u8f91 SOUL.md'",
  ]) {
    assert.ok(i18n.includes(translation), `missing translation ${translation}`);
  }
});

test('narrow admin rows use mobile-safe action layouts instead of scattered icon buttons', () => {
  const settings = read('src/preview/PreviewSettingsPages.tsx');

  assert.doesNotMatch(settings, /function ProfileActionsSheet|Profile actions|Set active/);
  assert.match(settings, /主服务器 Hermes/);
  assert.match(settings, /DBB3 Hermes/);
  assert.match(settings, /WSL Hermes/);
  assert.match(settings, /gatewayStatuses/);
  assert.match(settings, /styles\.envValueRow/);
  assert.match(settings, /styles\.envValue/);
  assert.match(settings, /PREVIEW_MODEL_CREDENTIALS/);
  assert.match(settings, /Removed model credential/);
  assert.doesNotMatch(settings, /PREVIEW_ENV_GROUPS|CUSTOM_KEY|setEditing\(/);
  assert.match(settings, /prefix=\{<Trash2 \/>\}/);
  assert.doesNotMatch(settings, /accessibilityLabel=\{`Clear \$\{key\}`\} destructive ghost/);
});

test('sidebar system actions and status bar follow the WebUI mobile contract', () => {
  const app = read('src/studio/FrontendPreviewApp.tsx');
  const root = read('src/app/HermesNativeApp.tsx');

  assert.match(app, /function SystemActionRow/);
  assert.match(app, /paddingHorizontal: 20/);
  assert.match(app, /paddingVertical: 8/);
  assert.match(app, /网关状态：/);
  assert.match(app, /summary\.activeSessions/);
  assert.match(app, /api\.getSystem\(\)/);
  assert.match(app, /api\.restartGateway\(\)/);
  assert.match(app, /api\.updateHermes\(\)/);
  assert.match(app, /function SidebarControl/);
  assert.match(app, /styles\.footerVersion/);
  assert.match(root, /function ThemedStatusBar/);
  assert.match(root, /isLightColor\(theme\.palette\.background\.hex\)/);
});

test('skills preview scans local skills and renders the Hermes Studio categorized list', () => {
  const skills = read('src/preview/PreviewAutomationPages.tsx');
  const skillsPage = skills.slice(
    skills.indexOf('export function SkillsPreviewPage'),
    skills.indexOf('export function PluginsPreviewPage'),
  );
  const listItem = read('src/components/ui/NativeListItem.tsx');

  assert.match(skillsPage, /<NativeListItem/);
  assert.match(skillsPage, /styles\.skillSourceLegend/);
  assert.match(skillsPage, /'builtin'[\s\S]*'hub'[\s\S]*'local'[\s\S]*'external'[\s\S]*'modified'/);
  assert.match(skillsPage, /styles\.studioSkillSidebar/);
  assert.match(skillsPage, /自动检索本机 Skill/);
  assert.match(skillsPage, /自动添加/);
  assert.doesNotMatch(skillsPage, /styles\.studioSkillDetail|技能目标|SKILL\.md/);
  assert.doesNotMatch(skillsPage, /label: 'Hermes'|label: 'Claude'|label: 'Codex'/);
  assert.match(skillsPage, /activeBackgroundColor=\{multiplyAlpha\(tokens\.colors\.primary, 0\.09\)\}/);
  assert.doesNotMatch(skillsPage, /toolsets|Browse hub/);
  assert.doesNotMatch(skillsPage, /<PreviewGrid minItemWidth=\{290\}>/);
  assert.doesNotMatch(skillsPage, /prefix=\{<Code2 \/>\}/);
  assert.match(listItem, /activeBackgroundColor\?: string/);
  assert.match(listItem, /activeTextColor\?: string/);
  assert.match(listItem, /IOS_MOTION\.duration\.control/);
  assert.match(listItem, /IOS_MOTION\.curve\.standard/);
  assert.doesNotMatch(listItem, /ReduceMotion|useReducedMotion|reduceMotion/);
});
