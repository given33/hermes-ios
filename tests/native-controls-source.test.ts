import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(projectRoot, path), 'utf8');

test('native controls render through React Native without a browser surface', () => {
  const sources = [
    'src/components/ui/NativeButton.tsx',
    'src/components/ui/NativeInput.tsx',
    'src/components/ui/NativeListItem.tsx',
    'src/components/ui/ConfirmDialog.tsx',
    'src/components/ui/ScreenState.tsx',
  ].map(read).join('\n');

  assert.doesNotMatch(sources, /WebView|WKWebView|document\.|window\.|innerHTML/);
  assert.match(sources, /from 'react-native'/);
});

test('arc border stays native, exact, and continuously animated', () => {
  const button = read('src/components/ui/NativeButton.tsx');
  const contract = read('src/design/control-contracts.ts');

  assert.match(button, /from 'react-native-svg'/);
  assert.match(button, /withRepeat\(/);
  assert.match(button, /withTiming\(1/);
  assert.match(button, /cancelAnimation\(progress\);[\s\S]*if \(visible\)/);
  assert.match(button, /\[progress, visible\]/);
  assert.match(button, /Easing\.linear/);
  assert.match(button, /if \(visible\)/);
  assert.match(button, /resolveCssGradientGeometry/);
  assert.match(contract, /arcBorderDurationMs: 2230/);
  assert.match(contract, /arcBorderBackgroundSizePercent: 300/);
  assert.match(contract, /brightness: 100 - 99 \* foregroundAlpha/);
  assert.doesNotMatch(
    button,
    /ReduceMotion|useReducedMotion|reduceMotion|AccessibilityInfo|isReduceMotionEnabled/,
  );
  assert.doesNotMatch(button, /filter:\s*\[/);
  assert.match(button, /textTransform: 'uppercase'/);
  assert.match(button, /Easing\.bezier\(\.\.\.IOS_MOTION\.curve\.standard\)/);
});

test('native button gives small and CJK labels enough painted line space', () => {
  const button = read('src/components/ui/NativeButton.tsx');

  assert.match(button, /Math\.max\(metrics\.visibleHeight, size === 'sm' \? 30 : 40\)/);
  assert.match(button, /metrics\.fontSize \* \(size === 'sm' \? 1\.35 : 1\.2\)/);
  assert.match(button, /containsCjk\(displayChild\)/);
  assert.match(button, /\? 0\s*:\s*letterSpacing/);
});

test('input and list item use the shared iOS control motion', () => {
  const input = read('src/components/ui/NativeInput.tsx');
  const listItem = read('src/components/ui/NativeListItem.tsx');
  const animatedIcon = read('src/components/ui/AnimatedTintedIcon.tsx');
  const controlsBridge = read('modules/hermes-ios-controls/index.ts');
  const controlsConfig = JSON.parse(
    read('modules/hermes-ios-controls/expo-module.config.json'),
  ) as { apple?: { modules?: string[] } };
  const nativePressFeedback = read(
    'modules/hermes-ios-controls/ios/HermesPressFeedbackModule.swift',
  );
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
  };
  for (const source of [input, listItem]) {
    assert.match(source, /IOS_MOTION\.duration\.control/);
    assert.match(source, /IOS_MOTION\.curve\.standard/);
    assert.doesNotMatch(source, /ReduceMotion|useReducedMotion|reduceMotion/);
    assert.match(source, /withTiming\(/);
  }
  assert.doesNotMatch(listItem, /createAnimatedComponent\(Pressable\)/);
  assert.match(listItem, /<Pressable/);
  assert.match(listItem, /<Reanimated\.View/);
  assert.match(listItem, /<Reanimated\.Text/);
  assert.match(listItem, /<AnimatedTintedIcon/);
  assert.match(listItem, /pressProgress\.value = withSpring\(1/);
  assert.match(listItem, /pressProgress\.value = withSpring\(0/);
  assert.match(listItem, /playHaptic\(haptic\)/);
  assert.match(listItem, /Platform\.OS === 'ios' && hasNativePressFeedback/);
  assert.match(listItem, /<HermesPressFeedbackView/);
  assert.match(listItem, /onNativePress=/);
  assert.match(listItem, /onPressState=/);
  assert.match(controlsBridge, /optionalView<HermesPressFeedbackProps>\('HermesPressFeedback'\)/);
  assert.match(controlsBridge, /requireNativeView<P>\(name, viewName\)/);
  assert.ok(controlsConfig.apple?.modules?.includes('HermesPressFeedbackModule'));
  assert.match(nativePressFeedback, /UILongPressGestureRecognizer/);
  assert.match(nativePressFeedback, /UIViewPropertyAnimator\(/);
  assert.match(nativePressFeedback, /CGAffineTransform\(scaleX:/);
  assert.match(nativePressFeedback, /UISelectionFeedbackGenerator/);
  assert.match(nativePressFeedback, /UIImpactFeedbackGenerator/);
  assert.match(
    nativePressFeedback,
    /case \.ended:[\s\S]*emitHaptic\(\)[\s\S]*onNativePress\(\[:\]\)/,
  );
  assert.doesNotMatch(
    nativePressFeedback,
    /case \.began:\n(?:(?!case \.ended:)[\s\S])*emitHaptic\(\)/,
  );
  assert.match(animatedIcon, /from '@react-native-masked-view\/masked-view'/);
  assert.match(animatedIcon, /<MaskedView/);
  assert.match(animatedIcon, /StyleSheet\.flatten\(icon\.props\.style\)/);
  assert.match(animatedIcon, /icon\.props\.width \?\? iconStyle\?\.width \?\? size/);
  assert.match(animatedIcon, /icon\.props\.height \?\? iconStyle\?\.height \?\? size/);
  assert.match(animatedIcon, /color: '#000000'/);
  assert.match(animatedIcon, /style: undefined/);
  assert.match(animatedIcon, /style=\{\[icon\.props\.style, \{ height, width \}\]\}/);
  assert.match(animatedIcon, /backgroundColor: color\.value/);
  assert.match(animatedIcon, /StyleSheet\.absoluteFill, animatedFillStyle/);
  assert.doesNotMatch(animatedIcon, /currentColor/);
  assert.doesNotMatch(animatedIcon, /createAnimatedComponent\(iconType\)/);
  assert.equal(
    packageJson.dependencies['@react-native-masked-view/masked-view'],
    '0.3.2',
  );
});

test('confirm dialog keeps canonical blur, fonts, and native modal behavior', () => {
  const dialog = read('src/components/ui/ConfirmDialog.tsx');
  const nativeBlur = read(
    'modules/hermes-live-blur/ios/HermesLiveBlurView.swift',
  );
  const liquidGlass = read(
    'modules/hermes-live-blur/ios/HermesLiquidGlassView.swift',
  );
  const liquidGlassModule = read(
    'modules/hermes-live-blur/ios/HermesLiquidGlassModule.swift',
  );
  const moduleConfig = JSON.parse(
    read('modules/hermes-live-blur/expo-module.config.json'),
  ) as { apple?: { modules?: string[] }; platforms?: string[] };
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
  };

  assert.equal(packageJson.dependencies['@shopify/react-native-skia'], undefined);
  assert.equal(packageJson.dependencies['react-native-view-shot'], undefined);
  assert.equal(packageJson.dependencies['expo-blur'], '~15.0.8');
  assert.equal(packageJson.dependencies['expo-modules-core'], undefined);
  assert.deepEqual(moduleConfig.platforms, ['apple']);
  assert.deepEqual(moduleConfig.apple?.modules, [
    'HermesLiveBlurModule',
    'HermesLiquidGlassModule',
  ]);
  assert.match(dialog, /<HermesLiveBlurView/);
  assert.match(dialog, /blurRadius=\{CONTROL_METRICS\.confirmDialog\.backdropBlurRadius\}/);
  assert.doesNotMatch(dialog, /tint=|intensity=/);
  assert.doesNotMatch(dialog, /captureScreen|base64|tmpfile|BackdropFilter/);
  assert.match(nativeBlur, /backdropLayer\.filters = \[gaussianFilter\]/);
  assert.match(nativeBlur, /for tintView in effectView\.subviews\.dropFirst\(\)/);
  assert.match(nativeBlur, /gaussianFilter\.setValue\(blurRadius, forKey: "inputRadius"\)/);
  assert.match(read('modules/hermes-live-blur/index.ts'), /createElement\(BlurView/);
  assert.doesNotMatch(nativeBlur, /UIGraphics|snapshot|write|Data\(/);
  assert.match(dialog, /RulesExpandedBold/);
  assert.match(dialog, /MondwestRegular/);
  assert.match(dialog, /presentationStyle="overFullScreen"/);
  assert.match(dialog, /DIALOG_DURATION_MS = IOS_MOTION\.duration\.modal/);
  assert.doesNotMatch(dialog, /ReduceMotion|useReducedMotion|reduceMotion/);
  assert.match(dialog, /transitionConfirmDialogGate/);
  assert.match(liquidGlassModule, /Name\("HermesLiquidGlass"\)/);
  assert.match(liquidGlass, /UIVisualEffectView\(\)/);
  assert.match(liquidGlass, /UIBlurEffect\(style: \.systemUltraThinMaterial\)/);
  assert.match(liquidGlass, /backdropLayer\.filters = \[gaussianFilter\]/);
  assert.match(liquidGlass, /UIViewPropertyAnimator\(/);
  assert.doesNotMatch(
    liquidGlass,
    /reduceTransparency|reduceMotion|isReduceTransparency|isReduceMotion/,
  );
  assert.match(liquidGlass, /layer\.cornerCurve = \.continuous/);
});

test('all native modules and the app share an explicit iOS 18 deployment target', () => {
  const appConfig = JSON.parse(read('app.json')) as {
    expo: { plugins: Array<string | [string, Record<string, unknown>]> };
  };
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
  };
  const podspec = read('modules/hermes-live-blur/ios/HermesLiveBlur.podspec');
  const buildProperties = appConfig.expo.plugins.find(
    (plugin): plugin is [string, { ios: { deploymentTarget: string } }] =>
      Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  );

  assert.equal(packageJson.dependencies['expo-build-properties'], '~1.0.10');
  assert.ok(buildProperties);
  assert.equal(buildProperties[1].ios.deploymentTarget, '18.0');
  assert.match(podspec, /s\.platforms\s*=\s*\{ :ios => '18\.0' \}/);
});

test('local native effects always launch through a development client', () => {
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  const appConfig = JSON.parse(read('app.json')) as {
    expo: { plugins: Array<string | [string, Record<string, unknown>]> };
  };
  const easConfig = JSON.parse(read('eas.json')) as {
    build: { development: { developmentClient?: boolean } };
  };
  const launchSources = [
    packageJson.scripts.start,
    packageJson.scripts.dev,
    packageJson.scripts.ios,
    packageJson.scripts.android,
    read('scripts/start-expo.ps1'),
  ].join('\n');
  const pluginNames = appConfig.expo.plugins.map((plugin) =>
    typeof plugin === 'string' ? plugin : plugin[0],
  );

  assert.equal(packageJson.dependencies['expo-dev-client'], '~6.0.21');
  assert.ok(pluginNames.includes('expo-dev-client'));
  assert.equal(easConfig.build.development.developmentClient, true);
  assert.match(launchSources, /--dev-client/);
  assert.doesNotMatch(launchSources, /--go(?:\s|$)/);
});
