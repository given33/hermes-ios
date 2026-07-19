import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(projectRoot, path), 'utf8');

test('native shell uses only native surfaces and the canonical route composer', () => {
  const source = read('src/app/NativeShell.tsx');
  assert.match(source, /composeRouteRegistry/);
  assert.match(source, /from 'react-native'/);
  assert.doesNotMatch(source, /from 'react-native-gesture-handler'/);
  assert.match(source, /from 'react-native-reanimated'/);
  assert.doesNotMatch(source, /WebView|WKWebView|document\.|window\.|localStorage/);
});

test('phone drawer is button-driven while the iPad rail keeps native motion', () => {
  const source = read('src/app/NativeShell.tsx');
  assert.match(source, /IOS_MOTION\.duration\.rail/);
  assert.match(source, /IOS_MOTION\.curve\.navigation/);
  assert.match(source, /IOS_DRAWER_SPRING/);
  assert.match(source, /resolveVisibleSidebarWidth/);
  assert.match(source, /resolveMobileDrawerTranslation/);
  assert.doesNotMatch(source, /Gesture\.Pan\(\)|GestureDetector|styles\.openEdge/);
  assert.match(source, /onPress=\{openMobile\}/);
  assert.match(source, /onPress=\{closeMobile\}/);
  assert.doesNotMatch(source, /ReduceMotion|useReducedMotion|reduceMotion/);
});

test('ProMotion uses native UI-thread transitions and 8ms scroll cadence', () => {
  const source = read('src/app/NativeShell.tsx');
  const appConfig = JSON.parse(read('app.json')) as {
    expo: { ios: { infoPlist: Record<string, unknown> } };
  };
  const scrollSources = [
    'src/app/NativeShell.tsx',
    'src/auth/LoginScreen.tsx',
    'src/preview/PreviewChatPage.tsx',
    'src/preview/PreviewCorePages.tsx',
    'src/preview/PreviewPluginPages.tsx',
    'src/preview/PreviewPrimitives.tsx',
  ].map(read);

  assert.equal(
    appConfig.expo.ios.infoPlist.CADisableMinimumFrameDurationOnPhone,
    true,
  );
  assert.match(source, /FadeInRight[\s\S]*duration\(IOS_MOTION\.duration\.navigationEnter\)/);
  assert.match(source, /FadeOutLeft[\s\S]*duration\(IOS_MOTION\.duration\.navigationExit\)/);
  assert.match(source, /IOS_NAVIGATION_EASING = Easing\.bezier\(\.\.\.IOS_MOTION\.curve\.navigation\)/);
  assert.match(source, /entering=\{PAGE_ENTERING\}/);
  assert.match(source, /exiting=\{PAGE_EXITING\}/);
  assert.match(source, /animation: 'slide_from_right'/);
  for (const scrollSource of scrollSources) {
    const scrollViews = scrollSource.match(/<ScrollView\s/g)?.length ?? 0;
    const promotionCadence = scrollSource.match(/scrollEventThrottle=\{8\}/g)?.length ?? 0;
    assert.equal(promotionCadence, scrollViews);
  }
});

test('navigation keeps icon and text on one exact shared color animation', () => {
  const source = read('src/app/NativeShell.tsx');
  assert.match(source, /const color = useSharedValue\(targetColor\)/);
  assert.match(source, /color\.value = withTiming\(targetColor/);
  assert.match(source, /<AnimatedTintedIcon[\s\S]*color=\{color\}/);
  assert.match(source, /color: color\.value/);
  assert.doesNotMatch(source, /ReduceMotion|useReducedMotion|reduceMotion/);
});

test('sidebar preserves the customized WebUI ownership order', () => {
  const source = read('src/app/NativeShell.tsx');
  const markers = [
    'styles.sidebarHeader',
    'slots?.profile',
    'composition.coreItems.map',
    'composition.pluginItems.map',
    'slots?.system',
    'slots?.controls',
    'slots?.auth',
    'slots?.footer',
  ];
  let offset = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, offset + 1);
    assert.ok(next > offset, `${marker} must follow the prior shell slot`);
    offset = next;
  }
});

test('safe areas and modal accessibility cover phone and tablet shells', () => {
  const source = read('src/app/NativeShell.tsx');
  assert.match(source, /headerStyle: \{ backgroundColor: rootBackground \}/);
  assert.match(source, /headerTitleStyle:/);
  assert.match(source, /fontSize: Math\.round\(typography\.mobileBrand\.fontSize\)/);
  assert.match(source, /paddingLeft: insets\.left/);
  assert.match(source, /paddingRight: insets\.right/);
  assert.match(source, /paddingBottom: insets\.bottom/);
  assert.match(source, /SHELL_METRICS\.sidebarWidth \+ insets\.left/);
  assert.match(source, /accessibilityElementsHidden=\{!state\.mobileOpen\}/);
  assert.match(source, /accessibilityViewIsModal=\{state\.mobileOpen\}/);
  assert.match(source, /'no-hide-descendants'/);
});

test('every requested path is resolved before route, selection, and slot state', () => {
  const source = read('src/app/NativeShell.tsx');
  assert.match(source, /resolveNativeShellPath\(\s*composition\.routes,\s*initialPath/s);
  assert.match(source, /const resolved = resolveNativeShellPath\(composition\.routes, path\)/);
  assert.match(source, /dispatch\(\{ type: 'navigate', path: resolved \}\)/);
  assert.match(source, /resolveNativeShellPath\(\s*composition\.routes,\s*state\.activePath/s);
  assert.doesNotMatch(source, /activeRoute[\s\S]*\?\? composition\.routes/);
});

test('compact navigation keeps UIKit native-stack edge-swipe navigation enabled', () => {
  const source = read('src/app/NativeShell.tsx');

  assert.match(source, /createNativeStackNavigator<CompactStackParamList>\(\)/);
  assert.match(source, /<NavigationContainer/);
  assert.match(source, /<CompactStack\.Navigator/);
  assert.match(source, /animation: 'slide_from_right'/);
  assert.match(source, /gestureEnabled: true/);
  assert.match(source, /headerBackButtonMenuEnabled: true/);
  assert.match(source, /navigation\.canGoBack\(\)/);
  assert.match(source, /onStateChange=\{syncCompactNavigation\}/);
  assert.doesNotMatch(source, /routeHistory|backTranslation|backGesture/);
});

test('sidebar uses one opaque safe-area surface, full-width hit targets, and no theme shortcut', () => {
  const source = read('src/app/NativeShell.tsx');
  const routes = read('src/app/route-registry.ts');

  assert.match(source, /const sidebarBackground = rootBackground/);
  assert.match(source, /swiftUIDrawerHost,[\s\S]*backgroundColor: state\.mobileOpen[\s\S]*\? rootBackground[\s\S]*: 'transparent'/);
  assert.match(source, /showsVerticalScrollIndicator=\{false\}/);
  assert.match(source, /referenceSidebarRow:[\s\S]*minHeight: 52/);
  assert.match(source, /navItem:[\s\S]*minHeight: 52/);
  assert.match(source, /referenceSidebarGroup:[\s\S]*backgroundColor: 'transparent'/);
  assert.doesNotMatch(source, /referenceSidebarThemeButton|Change theme|Palette/);
  assert.match(routes, /id: 'plugins', path: '\/plugins', visibleInSidebar: false/);
});

test('navigation actions dismiss the keyboard before changing routes or opening the sidebar', () => {
  const source = read('src/app/NativeShell.tsx');

  assert.match(source, /const openMobile = useCallback\(\(\) => \{\s*Keyboard\.dismiss\(\)/);
  assert.match(source, /const navigate = useCallback\([\s\S]*\(path: string\) => \{\s*Keyboard\.dismiss\(\)/);
  assert.match(source, /const selectSidebarRoute = useCallback\([\s\S]*\(path: string\) => \{\s*Keyboard\.dismiss\(\)/);
  assert.match(source, /const syncCompactNavigation = useCallback\(\(\) => \{\s*Keyboard\.dismiss\(\)/);
});

test('secondary root pages return to the sidebar while chat retains the menu button', () => {
  const source = read('src/app/NativeShell.tsx');

  assert.match(source, /route\.routeId === 'chat'[\s\S]*Open navigation[\s\S]*Back to sidebar/);
  assert.match(source, /route\.routeId === 'chat' \? \([\s\S]*<Menu[\s\S]*<ChevronLeft/);
  assert.match(source, /onPress=\{openMobile\}/);
});

test('sidebar selections keep a root page so the native edge swipe can return', () => {
  const source = read('src/app/NativeShell.tsx');

  assert.match(source, /const selectSidebarRoute = useCallback/);
  assert.match(source, /compactNavigationRef\.dispatch\(StackActions\.popToTop\(\)\)/);
  assert.match(source, /compactNavigationRef\.dispatch\(StackActions\.push\(resolved, \{/);
  assert.match(source, /animation: navigationRoute\.params\?\.sidebarSelection\s*\? 'none'\s*: 'default'/);
  assert.doesNotMatch(source, /STABLE_SWIFTUI_ROUTE_NAME/);
  assert.doesNotMatch(source, /reuseSwiftUIHost/);
  assert.match(source, /name=\{route\.path\}/);
  assert.match(source, /headerShown: !chatRoute && !swiftUIRoute/);
  assert.match(source, /pendingSidebarPath\.current = resolved/);
  assert.match(source, /dispatch\(\{ type: 'select-route', path: resolved \}\)/);
  assert.match(source, /const reportRouteReady = useCallback/);
  assert.match(source, /pendingSidebarPath\.current !== resolved/);
  assert.match(source, /onNavigate=\{\(event\) => selectSidebarRoute\(event\.nativeEvent\.path\)\}/);
  assert.match(source, /navigate=\{selectSidebarRoute\}/);
});

test('the compact fallback sidebar is one continuous panel without row dividers', () => {
  const source = read('src/app/NativeShell.tsx');
  const sidebar = source.slice(
    source.indexOf('function ExpoReferenceSidebar'),
    source.indexOf('function ShellNavigationItem'),
  );

  assert.match(sidebar, /<ScrollView[\s\S]*referenceSidebarHeader[\s\S]*REFERENCE_SIDEBAR_GROUPS[\s\S]*referenceSidebarFooter[\s\S]*<\/ScrollView>/);
  assert.doesNotMatch(sidebar, /borderBottomWidth/);
});
