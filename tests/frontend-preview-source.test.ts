import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

test('frontend preview renders every customized WebUI route without API ownership', () => {
  const app = read('src/preview/FrontendPreviewApp.tsx');
  const previewSources = [
    app,
    read('src/preview/PreviewChatPage.tsx'),
    read('src/preview/PreviewCorePages.tsx'),
    read('src/preview/PreviewAutomationPages.tsx'),
    read('src/preview/PreviewSettingsPages.tsx'),
    read('src/preview/PreviewPluginPages.tsx'),
    read('src/preview/PreviewPrimitives.tsx'),
    read('src/preview/preview-fixtures.ts'),
  ].join('\n');

  for (const routeId of [
    'chat',
    'sessions',
    'files',
    'analytics',
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

  assert.doesNotMatch(previewSources, /HermesApiClient|useAuth|\bapi\.[a-z]/);
  assert.doesNotMatch(previewSources, /from ['"][^'"]*\/api\//);
  assert.doesNotMatch(previewSources, /WebView|WKWebView|react-native-webview/);
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

test('native runtime does not adapt Reduce Motion or Reduce Transparency', () => {
  const runtime = [
    read('src/app/NativeShell.tsx'),
    read('src/auth/LoginScreen.tsx'),
    read('src/components/ui/ConfirmDialog.tsx'),
    read('src/components/ui/NativeButton.tsx'),
    read('src/components/ui/NativeInput.tsx'),
    read('src/components/ui/NativeListItem.tsx'),
    read('src/preview/FrontendPreviewApp.tsx'),
    read('src/preview/PreviewChatPage.tsx'),
    read('src/preview/PreviewPrimitives.tsx'),
    read('modules/hermes-live-blur/ios/HermesLiquidGlassView.swift'),
  ].join('\n');

  assert.doesNotMatch(
    runtime,
    /ReduceMotion|useReducedMotion|reduceMotion|reduceTransparency|isReduceTransparency|isReduceMotion/,
  );
});

test('preview appearance persistence is limited to theme and font', () => {
  const themeProvider = read('src/design/ThemeProvider.tsx');
  const previewStart = themeProvider.indexOf(
    'export function FrontendPreviewThemeProvider',
  );
  const previewSource = themeProvider.slice(previewStart);

  assert.match(previewSource, /hermes\.preview\.theme/);
  assert.match(previewSource, /hermes\.preview\.font/);
  assert.doesNotMatch(previewSource, /HermesApiClient|setTheme\(value\)|setFontPref/);
});

test('chat preview preserves the customized collaboration single-chat contract', () => {
  const app = read('src/preview/FrontendPreviewApp.tsx');
  const chat = read('src/preview/PreviewChatPage.tsx');
  const contextMenu = read('src/components/ios/IOSContextMenu.tsx');
  const contextMenuBridge = read('modules/hermes-context-menu/index.ts');
  const contextMenuNative = read(
    'modules/hermes-context-menu/ios/HermesContextMenuView.swift',
  );
  const quickLookBridge = read('modules/hermes-quick-look/index.ts');
  const quickLookNative = read('modules/hermes-quick-look/ios/HermesQuickLookModule.swift');
  const nativeDrawer = read(
    'modules/hermes-ios-controls/ios/HermesDrawerSurfaceModule.swift',
  );
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
  };

  assert.match(app, /from '\.\/PreviewChatPage'/);
  assert.doesNotMatch(chat, /KeyboardAvoidingView/);
  assert.match(chat, /useAnimatedKeyboard\(\)/);
  assert.match(chat, /useAnimatedReaction\(/);
  assert.match(chat, /runOnJS\(keepLatestVisible\)\(false\)/);
  assert.match(chat, /paddingBottom: keyboard\.height\.value/);
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
  assert.match(chat, /onContentSizeChange=\{\(\) => keepLatestVisible\(true\)\}/);
  assert.match(chat, /onLayout=\{\(\) => keepLatestVisible\(false\)\}/);
  assert.match(chat, /onFocus=\{\(\) => keepLatestVisible\(false\)\}/);
  assert.match(chat, /Hermes Agent/);
  assert.match(chat, /当前窗口持续使用同一个会话/);
  assert.match(chat, /直接告诉 Hermes 你想做什么/);
  assert.match(chat, /function UnifiedMessage/);
  assert.match(chat, /function RoleActivityGroup/);
  assert.match(chat, /function ModelToolsDrawer/);
  assert.match(chat, /allowSwipeDismissal=\{Platform\.OS === 'ios'\}/);
  assert.match(chat, /animationType=\{Platform\.OS === 'ios' \? 'slide' : 'fade'\}/);
  assert.match(chat, /presentationStyle=\{Platform\.OS === 'ios' \? 'pageSheet' : 'overFullScreen'\}/);
  assert.match(chat, /configurePresentedSheet\(\)/);
  assert.doesNotMatch(chat, /ReduceMotion|useReducedMotion|reduceMotion/);
  assert.doesNotMatch(chat, /styles\.drawerBackdrop, backdropStyle/);
  assert.match(nativeDrawer, /struct HermesDrawerSurfaceView: ExpoSwiftUI\.View/);
  assert.match(nativeDrawer, /DragGesture\(minimumDistance: 8\)/);
  assert.match(chat, /safeAreaBottom/);
  assert.match(chat, /\[7 \+ safeAreaBottom, 3\]/);
  assert.match(chat, /ActionSheetIOS\.showActionSheetWithOptions/);
  assert.match(chat, /launchImageLibraryAsync/);
  assert.match(chat, /launchCameraAsync/);
  assert.match(chat, /DocumentPicker\.getDocumentAsync/);
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
  assert.match(chat, /<GlassView/);
  assert.match(chat, /isLiquidGlassAvailable\(\)/);
  assert.match(chat, /resolveComposerFontSize\(content\)/);
  assert.match(chat, /Math\.max\(12, 16 - \(Math\.min\(glyphCount, 40\) - 28\) \/ 3\)/);
  assert.equal(packageJson.dependencies['expo-glass-effect'], '~0.1.10');
  assert.equal(packageJson.dependencies['expo-symbols'], '~1.0.8');
  assert.match(quickLookBridge, /requireOptionalNativeModule<.*>\([\s\S]*'HermesQuickLook'/);
  assert.match(quickLookNative, /import QuickLook/);
  assert.match(quickLookNative, /QLPreviewController\(\)/);
  assert.match(quickLookNative, /\.runOnQueue\(\.main\)/);
  assert.match(chat, /function AttachmentItem/);
  assert.match(chat, /<HermesLiquidGlassView/);
  assert.match(chat, /blurRadius=\{24\}/);
  assert.match(chat, /glassCornerRadius=\{15\}/);
  assert.match(chat, /require\('\.\.\/\.\.\/assets\/icon\.png'\)/);
  assert.doesNotMatch(chat, /TerminalStatusBar|terminalTranscript/);
  assert.doesNotMatch(chat, /<PreviewModal[^>]+title=\{isChinese \? '模型与工具'/);
});

test('application surfaces use the shared iOS press, swipe, and haptic controls', () => {
  const applicationSources = [
    'src/app/HermesNativeApp.tsx',
    'src/app/NativeShell.tsx',
    'src/auth/LoginScreen.tsx',
    'src/preview/FrontendPreviewApp.tsx',
    'src/preview/PreviewAutomationPages.tsx',
    'src/preview/PreviewChatPage.tsx',
    'src/preview/PreviewCorePages.tsx',
    'src/preview/PreviewPluginPages.tsx',
    'src/preview/PreviewPrimitives.tsx',
    'src/preview/PreviewSettingsPages.tsx',
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
  const chat = read('src/preview/PreviewChatPage.tsx');
  const nativeDrawer = read(
    'modules/hermes-ios-controls/ios/HermesDrawerSurfaceModule.swift',
  );

  assert.match(shell, /const sidebarBackground = multiplyAlpha\([\s\S]*state\.mode === 'compact' \? 0\.96 : 1/);
  assert.match(shell, /backgroundColor: sidebarBackground/);
  assert.doesNotMatch(shell, /backgroundColor: 'transparent'/);
  assert.doesNotMatch(shell, /HermesLiveBlurView/);
  assert.match(shell, /left: drawerExtent/);
  assert.match(shell, /<HermesDrawerSurfaceView/);
  assert.match(shell, /hasNativeDrawerSurface/);
  assert.match(nativeDrawer, /Children\(\)/);
  assert.doesNotMatch(nativeDrawer, /Material|blur|UIVisualEffectView/);
  assert.match(chat, /backgroundColor: tokens\.colors\.background/);
  assert.doesNotMatch(chat, /drawerBackdrop:/);
  assert.doesNotMatch(
    shell,
    /styles\.content,\s*\{[^}]*paddingBottom: insets\.bottom/s,
  );
});

test('secondary interfaces use the native iOS sheet transition', () => {
  const primitives = read('src/preview/PreviewPrimitives.tsx');
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
  const primitives = read('src/preview/PreviewPrimitives.tsx');
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
  const chat = read('src/preview/PreviewChatPage.tsx');
  const core = read('src/preview/PreviewCorePages.tsx');
  const plugins = read('src/preview/PreviewPluginPages.tsx');
  const settings = read('src/preview/PreviewSettingsPages.tsx');

  assert.match(chat, /haptic="light"[\s\S]*onPress=\{send\}/);
  assert.match(core, /ActionSheetIOS\.showActionSheetWithOptions/);
  assert.match(plugins, /Share\.share\(/);
  assert.match(settings, /new File\(Paths\.cache, 'hermes-config-preview\.json'\)/);
  assert.match(settings, /Sharing\.shareAsync\(file\.uri/);
  assert.match(settings, /DocumentPicker\.getDocumentAsync\(\{/);
  assert.doesNotMatch(plugins, /Achievement share sheet opened/);
  assert.doesNotMatch(settings, /Config import picker opened|Config JSON export prepared/);
});

test('Chinese preview mode translates every shared visible control surface', () => {
  const i18n = read('src/i18n/NativeLocalization.tsx');
  const app = read('src/preview/FrontendPreviewApp.tsx');
  const button = read('src/components/ui/NativeButton.tsx');
  const input = read('src/components/ui/NativeInput.tsx');
  const dialog = read('src/components/ui/ConfirmDialog.tsx');
  const primitives = read('src/preview/PreviewPrimitives.tsx');

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

  assert.match(settings, /function ProfileActionsSheet/);
  assert.match(settings, /styles\.envValueRow/);
  assert.match(settings, /styles\.envValue/);
  assert.match(settings, /prefix=\{<Edit3 \/>\}/);
  assert.match(settings, /prefix=\{<Trash2 \/>\}/);
  assert.doesNotMatch(settings, /accessibilityLabel=\{`Clear \$\{key\}`\} destructive ghost/);
});

test('sidebar system actions and status bar follow the WebUI mobile contract', () => {
  const app = read('src/preview/FrontendPreviewApp.tsx');
  const root = read('src/app/HermesNativeApp.tsx');

  assert.match(app, /function SystemActionRow/);
  assert.match(app, /paddingHorizontal: 20/);
  assert.match(app, /paddingVertical: 8/);
  assert.match(app, /网关状态：/);
  assert.match(app, /活跃会话：2/);
  assert.match(app, /function SidebarControl/);
  assert.match(app, /styles\.footerVersion/);
  assert.match(root, /function ThemedStatusBar/);
  assert.match(root, /isLightColor\(theme\.palette\.background\.hex\)/);
});

test('skills preview uses the current WebUI filter and compact row structure', () => {
  const skills = read('src/preview/PreviewAutomationPages.tsx');
  const skillsPage = skills.slice(
    skills.indexOf('export function SkillsPreviewPage'),
    skills.indexOf('export function PluginsPreviewPage'),
  );
  const listItem = read('src/components/ui/NativeListItem.tsx');

  assert.match(skillsPage, /function SkillFilterItem/);
  assert.match(skillsPage, /<NativeListItem/);
  assert.match(skillsPage, /styles\.skillRow/);
  assert.match(skillsPage, /<Pencil \/>/);
  assert.match(skillsPage, /activeBackgroundColor=\{multiplyAlpha\(tokens\.colors\.foreground, 0\.9\)\}/);
  assert.doesNotMatch(skillsPage, /<PreviewGrid minItemWidth=\{290\}>/);
  assert.doesNotMatch(skillsPage, /prefix=\{<Code2 \/>\}/);
  assert.match(listItem, /activeBackgroundColor\?: string/);
  assert.match(listItem, /activeTextColor\?: string/);
  assert.match(listItem, /IOS_MOTION\.duration\.control/);
  assert.match(listItem, /IOS_MOTION\.curve\.standard/);
  assert.doesNotMatch(listItem, /ReduceMotion|useReducedMotion|reduceMotion/);
});
