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

test('Expo Go blur fallback gives way to SwiftUI Material in signed builds', () => {
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
  assert.match(nativeBlur, /import SwiftUI/);
  assert.match(nativeBlur, /ExpoSwiftUI\.View/);
  assert.match(nativeBlur, /\.fill\(\.regularMaterial\)/);
  assert.doesNotMatch(nativeBlur, /import UIKit|UIVisualEffectView|CAFilter/);
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
  const quickLookBridge = read('modules/hermes-quick-look/index.ts');
  const quickLookNative = read('modules/hermes-quick-look/ios/HermesQuickLookModule.swift');
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
  };

  assert.match(app, /from '\.\/PreviewChatPage'/);
  assert.doesNotMatch(chat, /KeyboardAvoidingView/);
  assert.match(chat, /useAnimatedKeyboard\(\)/);
  assert.match(chat, /paddingBottom: keyboard\.height\.value/);
  assert.match(
    chat,
    /<Reanimated\.View\s*style=\{\[\s*styles\.composer,[\s\S]*composerKeyboardStyle/,
  );
  assert.doesNotMatch(
    chat,
    /<View\s*style=\{\[\s*styles\.composer/,
  );
  assert.match(chat, /keyboardDidHide/);
  assert.match(chat, /Keyboard\.dismiss\(\)/);
  assert.match(chat, /keyboardDismissMode="interactive"/);
  assert.match(chat, /Hermes Agent/);
  assert.match(chat, /当前窗口持续使用同一个会话/);
  assert.match(chat, /直接告诉 Hermes 你想做什么/);
  assert.match(chat, /function UnifiedMessage/);
  assert.match(chat, /function RoleActivityGroup/);
  assert.match(chat, /function ModelToolsDrawer/);
  assert.match(chat, /<PreviewModal[\s\S]*open=\{open\}/);
  assert.doesNotMatch(chat, /ReduceMotion|useReducedMotion|reduceMotion/);
  assert.match(chat, /safeAreaBottom/);
  assert.match(chat, /\[7 \+ safeAreaBottom, 3\]/);
  assert.match(chat, /<IOSActionSheet/);
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
  assert.doesNotMatch(contextMenu, /ActionSheetIOS/);
  assert.match(contextMenu, /from '@expo\/ui\/swift-ui'/);
  assert.match(contextMenu, /<SwiftUIContextMenu activationMethod="longPress">/);
  assert.match(contextMenu, /<SwiftUIContextMenu\.Items>/);
  assert.match(contextMenu, /<SwiftUIContextMenu\.Trigger>/);
  assert.match(chat, /<SymbolView/);
  assert.match(chat, /PlatformColor\('secondarySystemBackground'\)/);
  assert.match(chat, /<GlassView/);
  assert.match(chat, /isLiquidGlassAvailable\(\)/);
  assert.match(chat, /resolveComposerFontSize\(content\)/);
  assert.match(chat, /Math\.max\(12, 16 - \(Math\.min\(glyphCount, 40\) - 28\) \/ 3\)/);
  assert.equal(packageJson.dependencies['expo-glass-effect'], '~0.1.10');
  assert.equal(packageJson.dependencies['expo-symbols'], '~1.0.8');
  assert.match(quickLookBridge, /requireOptionalNativeModule\('HermesQuickLook'\)/);
  assert.match(quickLookNative, /import QuickLook/);
  assert.match(quickLookNative, /import SwiftUI/);
  assert.match(quickLookNative, /ExpoSwiftUI\.View/);
  assert.match(quickLookNative, /\.quickLookPreview\(\$previewURL\)/);
  assert.doesNotMatch(quickLookNative, /QLPreviewController|UIViewController/);
  assert.match(chat, /function AttachmentItem/);
  assert.match(chat, /<HermesLiquidGlassView/);
  assert.match(chat, /blurRadius=\{24\}/);
  assert.match(chat, /glassCornerRadius=\{15\}/);
  assert.match(chat, /require\('\.\.\/\.\.\/assets\/icon\.png'\)/);
  assert.doesNotMatch(chat, /TerminalStatusBar|terminalTranscript/);
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
  assert.match(swipeNative, /import SwiftUI/);
  assert.match(swipeNative, /ExpoSwiftUI\.View/);
  assert.match(swipeNative, /\.swipeActions\(/);
  assert.match(swipeNative, /SwiftUI\.Button\(role: \.destructive\)/);
  assert.doesNotMatch(swipeNative, /import UIKit|UITableViewCell|UISwipeActionsConfiguration/);
});

test('mobile shell remains full bleed and keeps the WebUI sidebar readable without blur', () => {
  const shell = read('src/app/NativeShell.tsx');
  const chat = read('src/preview/PreviewChatPage.tsx');

  assert.match(shell, /const sidebarBackground = multiplyAlpha\([\s\S]*state\.mode === 'compact' \? 0\.96 : 1/);
  assert.match(shell, /backgroundColor: sidebarBackground/);
  assert.doesNotMatch(shell, /backgroundColor: 'transparent'/);
  assert.doesNotMatch(shell, /HermesLiveBlurView/);
  assert.match(shell, /left: drawerExtent/);
  assert.match(chat, /backgroundColor: 'transparent'/);
  assert.match(chat, /drawerBackdrop: \{ backgroundColor: 'rgba\(0,0,0,0\.60\)', right: 256 \}/);
  const contentStart = shell.indexOf('styles.content,');
  const contentBlock = shell.slice(
    contentStart,
    shell.indexOf('<NavigationContainer', contentStart),
  );
  assert.doesNotMatch(contentBlock, /paddingBottom: insets\.bottom/);
});

test('secondary interfaces use the native SwiftUI bottom sheet', () => {
  const primitives = read('src/preview/PreviewPrimitives.tsx');

  assert.match(primitives, /BottomSheet as SwiftUIBottomSheet/);
  assert.match(primitives, /<SwiftUIHost style=\{styles\.swiftUISheetHost\}>/);
  assert.match(primitives, /<SwiftUIBottomSheet/);
  assert.match(primitives, /presentationDetents=\{\['medium', 'large'\]\}/);
  assert.match(primitives, /presentationDragIndicator="visible"/);
  assert.doesNotMatch(primitives, /configurePresentedSheet|hermes-sheet-controller/);
});

test('cron scheduling uses the native SwiftUI compact time picker', () => {
  const automation = read('src/preview/PreviewAutomationPages.tsx');
  const timePicker = read('src/components/ios/IOSTimePicker.tsx');
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
  };

  assert.match(automation, /<IOSTimePicker/);
  assert.match(timePicker, /from '@expo\/ui\/swift-ui'/);
  assert.match(timePicker, /<SwiftUIHost/);
  assert.match(timePicker, /<SwiftUIDateTimePicker/);
  assert.match(timePicker, /displayedComponents="hourAndMinute"/);
  assert.match(timePicker, /variant="compact"/);
  assert.match(timePicker, /colorScheme=\{isLightHex\(theme\.palette\.background\.hex\) \? 'light' : 'dark'\}/);
  assert.equal(packageJson.dependencies['@react-native-community/datetimepicker'], undefined);
  assert.equal(packageJson.dependencies['@expo/ui'], '0.2.0-beta.9');
});

test('selection, search, switch, segmented, and progress controls use SwiftUI on iOS', () => {
  const primitives = read('src/preview/PreviewPrimitives.tsx');
  const bridge = read('modules/hermes-ios-controls/index.ts');
  const search = read(
    'modules/hermes-ios-controls/ios/HermesSearchBarModule.swift',
  );
  const selection = read(
    'modules/hermes-ios-controls/ios/HermesSelectionModule.swift',
  );

  assert.match(bridge, /requireNativeView/);
  assert.match(primitives, /HermesSearchBarView/);
  assert.match(primitives, /HermesSelectionView/);
  assert.match(primitives, /Switch as SwiftUISwitch/);
  assert.match(primitives, /Picker as SwiftUIPicker/);
  assert.match(primitives, /LinearProgress as SwiftUILinearProgress/);
  assert.match(primitives, /<SwiftUISwitch/);
  assert.match(primitives, /<SwiftUIPicker/);
  assert.match(primitives, /<SwiftUILinearProgress/);
  for (const source of [search, selection]) {
    assert.match(source, /import SwiftUI/);
    assert.match(source, /ExpoSwiftUI\.View/);
    assert.doesNotMatch(source, /import UIKit|UISearchBar|UIViewPropertyAnimator/);
  }
  assert.match(search, /TextField\(/);
  assert.match(selection, /RoundedRectangle/);
  assert.match(selection, /\.spring\(response: 0\.34, dampingFraction: 0\.82\)/);
  assert.doesNotMatch(primitives, /clearButtonMode="while-editing"[\s\S]*styles\.searchClear/);
});

test('project-owned Apple modules contain no direct UIKit implementation', () => {
  const nativeSources = [
    read('modules/hermes-ios-controls/ios/HermesAlertPresenterModule.swift'),
    read('modules/hermes-ios-controls/ios/HermesPressFeedbackModule.swift'),
    read('modules/hermes-ios-controls/ios/HermesSearchBarModule.swift'),
    read('modules/hermes-ios-controls/ios/HermesSelectionModule.swift'),
    read('modules/hermes-ios-controls/ios/HermesTextInputModule.swift'),
    read('modules/hermes-ios-controls/ios/HermesDrawerSurfaceModule.swift'),
    read('modules/hermes-ios-controls/ios/HermesConfirmationDialogModule.swift'),
    read('modules/hermes-live-blur/ios/HermesLiveBlurView.swift'),
    read('modules/hermes-live-blur/ios/HermesLiquidGlassView.swift'),
    read('modules/hermes-quick-look/ios/HermesQuickLookModule.swift'),
    read('modules/hermes-swipe-actions/ios/HermesSwipeActionsView.swift'),
  ].join('\n');

  assert.match(nativeSources, /import SwiftUI/);
  assert.doesNotMatch(nativeSources, /import UIKit/);
});

test('preview share, import, export, and model selection open iOS system surfaces', () => {
  const chat = read('src/preview/PreviewChatPage.tsx');
  const core = read('src/preview/PreviewCorePages.tsx');
  const plugins = read('src/preview/PreviewPluginPages.tsx');
  const settings = read('src/preview/PreviewSettingsPages.tsx');

  assert.match(chat, /haptic="light"[\s\S]*onPress=\{send\}/);
  assert.match(core, /<IOSActionSheet/);
  assert.match(plugins, /Share\.share\(/);
  assert.match(settings, /new File\(Paths\.cache, 'hermes-config-preview\.json'\)/);
  assert.match(settings, /Sharing\.shareAsync\(file\.uri/);
  assert.match(settings, /DocumentPicker\.getDocumentAsync\(\{/);
  assert.doesNotMatch(plugins, /Achievement share sheet opened/);
  assert.doesNotMatch(settings, /Config import picker opened|Config JSON export prepared/);
});

test('signed action choices use SwiftUI confirmationDialog with an Expo Go fallback', () => {
  const actionSheet = read('src/components/ios/IOSActionSheet.tsx');
  const nativeDialog = read(
    'modules/hermes-ios-controls/ios/HermesConfirmationDialogModule.swift',
  );

  assert.match(actionSheet, /hasNativeConfirmationDialog/);
  assert.match(actionSheet, /<HermesConfirmationDialogView/);
  assert.match(actionSheet, /ActionSheetIOS\.showActionSheetWithOptions/);
  assert.match(nativeDialog, /import SwiftUI/);
  assert.match(nativeDialog, /ExpoSwiftUI\.View/);
  assert.match(nativeDialog, /\.confirmationDialog\(/);
  assert.match(nativeDialog, /SwiftUI\.Button\(action\.title, role: \.destructive\)/);
  assert.doesNotMatch(nativeDialog, /import UIKit|UIAlertController/);
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

test('React Native preview owns the signed iOS frontend', () => {
  const app = read('src/preview/FrontendPreviewApp.tsx');
  const root = read('src/app/HermesNativeApp.tsx');

  assert.match(app, /function SystemActionRow/);
  assert.match(app, /paddingHorizontal: 20/);
  assert.match(app, /paddingVertical: 8/);
  assert.match(app, /网关状态：/);
  assert.match(app, /活跃会话：2/);
  assert.match(app, /function SidebarControl/);
  assert.match(app, /styles\.footerVersion/);
  assert.match(root, /<FrontendPreviewApp/);
  assert.match(root, /<NativeShell/);
  assert.match(root, /<ThemeProvider/);
  assert.doesNotMatch(root, /HermesSwiftUI(?:Frontend|Login)View/);
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
