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
  assert.match(source, /from 'react-native-gesture-handler'/);
  assert.match(source, /from 'react-native-reanimated'/);
  assert.doesNotMatch(source, /WebView|WKWebView|document\.|window\.|localStorage/);
});

test('phone drawer and iPad rail use iOS spring and timing motion', () => {
  const source = read('src/app/NativeShell.tsx');
  assert.match(source, /IOS_MOTION\.duration\.rail/);
  assert.match(source, /IOS_MOTION\.curve\.navigation/);
  assert.match(source, /IOS_DRAWER_SPRING/);
  assert.match(source, /resolveVisibleSidebarWidth/);
  assert.match(source, /resolveMobileDrawerTranslation/);
  assert.match(source, /Gesture\.Pan\(\)/);
  assert.match(source, /styles\.openEdge/);
  assert.match(source, /unifiedChatActive \? insets\.top : insets\.top \+ SHELL_METRICS\.headerHeight/);
  assert.doesNotMatch(
    source.slice(source.indexOf('openEdge: {')),
    /openEdge:\s*\{[^}]*top:\s*0/s,
  );
  assert.match(source, /\.onEnd\(\(event, success\) =>/);
  assert.match(source, /if \(!success\)/);
  assert.match(source, /event\.translationX \+ event\.velocityX \* 0\.12/);
  assert.match(source, /withSpring\(0,[\s\S]*runOnJS\(openMobile\)/);
  assert.match(source, /withSpring\(-drawerExtent,[\s\S]*runOnJS\(closeMobile\)/);
  assert.match(source, /velocity: event\.velocityX/);
  assert.doesNotMatch(source, /ReduceMotion|useReducedMotion|reduceMotion/);
});

test('ProMotion uses system navigation and 8ms scroll cadence', () => {
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
  assert.match(source, /createNativeStackNavigator<CompactStackParamList>\(\)/);
  assert.match(source, /<SplitViewHost/);
  assert.match(
    source,
    /Platform\.OS === 'ios'[\s\S]*hasNativeDrawerSurface[\s\S]*state\.mode === 'split'/,
  );
  assert.match(source, /<SplitViewScreen\.Column>/);
  assert.match(source, /unstable_headerLeftItems/);
  assert.match(source, /name: 'line\.3\.horizontal'/);
  assert.match(source, /IOS_NAVIGATION_EASING = Easing\.bezier\(\.\.\.IOS_MOTION\.curve\.navigation\)/);
  assert.doesNotMatch(source, /FadeInRight|FadeOutLeft|PAGE_ENTERING|PAGE_EXITING/);
  assert.match(source, /animation: 'default'/);
  for (const scrollSource of scrollSources) {
    const scrollViews = scrollSource.match(/<ScrollView\s/g)?.length ?? 0;
    const promotionCadence = scrollSource.match(/scrollEventThrottle=\{8\}/g)?.length ?? 0;
    assert.equal(promotionCadence, scrollViews);
  }
});

test('signed iPad builds enable the react-native-screens split view implementation', () => {
  const workflow = read('.github/workflows/ios-unsigned.yml');
  const eas = JSON.parse(read('eas.json')) as {
    build: Record<string, { env?: Record<string, string> }>;
  };

  assert.match(workflow, /RNS_GAMMA_ENABLED: '1'/);
  for (const profile of ['development', 'preview', 'production']) {
    assert.equal(eas.build[profile]?.env?.RNS_GAMMA_ENABLED, '1');
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

test('compact navigation is owned by UIKit native-stack instead of a simulated back gesture', () => {
  const source = read('src/app/NativeShell.tsx');

  assert.match(source, /createNativeStackNavigator<CompactStackParamList>\(\)/);
  assert.match(source, /<NavigationContainer/);
  assert.match(source, /<CompactStack\.Navigator/);
  assert.match(source, /animation: 'default'/);
  assert.match(source, /gestureEnabled: true/);
  assert.match(source, /headerBackButtonMenuEnabled: true/);
  assert.match(source, /compactNavigationRef\.canGoBack\(\)/);
  assert.match(source, /onStateChange=\{syncCompactNavigation\}/);
  assert.doesNotMatch(source, /routeHistory|backTranslation|backGesture/);
});
