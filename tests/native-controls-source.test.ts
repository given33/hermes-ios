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
  assert.match(button, /Easing\.linear/);
  assert.match(button, /resolveCssGradientGeometry/);
  assert.match(contract, /arcBorderDurationMs: 2230/);
  assert.match(contract, /arcBorderBackgroundSizePercent: 300/);
  assert.match(contract, /brightness: 100 - 99 \* foregroundAlpha/);
  assert.doesNotMatch(button, /reduceMotion|AccessibilityInfo|isReduceMotionEnabled/);
  assert.doesNotMatch(button, /filter:\s*\[/);
  assert.match(button, /textTransform: 'uppercase'/);
  assert.match(button, /Easing\.bezier\(\.\.\.CONTROL_METRICS\.tailwind\.transitionEasing\)/);
});

test('input and list item animate canonical transition-colors timing', () => {
  const input = read('src/components/ui/NativeInput.tsx');
  const listItem = read('src/components/ui/NativeListItem.tsx');
  for (const source of [input, listItem]) {
    assert.match(source, /CONTROL_METRICS\.tailwind\.transitionDurationMs/);
    assert.match(source, /CONTROL_METRICS\.tailwind\.transitionEasing/);
    assert.match(source, /withTiming\(/);
  }
  assert.doesNotMatch(listItem, /createAnimatedComponent\(Pressable\)/);
  assert.match(listItem, /<Pressable/);
  assert.match(listItem, /<Reanimated\.View/);
  assert.match(listItem, /<Reanimated\.Text/);
});

test('confirm dialog keeps canonical blur, fonts, and native modal behavior', () => {
  const dialog = read('src/components/ui/ConfirmDialog.tsx');
  const nativeBlur = read(
    'modules/hermes-live-blur/ios/HermesLiveBlurView.swift',
  );
  const moduleConfig = JSON.parse(
    read('modules/hermes-live-blur/expo-module.config.json'),
  ) as { apple?: { modules?: string[] }; platforms?: string[] };
  const packageJson = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
  };

  assert.equal(packageJson.dependencies['@shopify/react-native-skia'], undefined);
  assert.equal(packageJson.dependencies['react-native-view-shot'], undefined);
  assert.equal(packageJson.dependencies['expo-blur'], undefined);
  assert.equal(packageJson.dependencies['expo-modules-core'], '~3.0.30');
  assert.deepEqual(moduleConfig.platforms, ['apple']);
  assert.deepEqual(moduleConfig.apple?.modules, ['HermesLiveBlurModule']);
  assert.match(dialog, /<HermesLiveBlurView/);
  assert.match(dialog, /blurRadius=\{CONTROL_METRICS\.confirmDialog\.backdropBlurRadius\}/);
  assert.doesNotMatch(dialog, /tint=|intensity=/);
  assert.doesNotMatch(dialog, /captureScreen|base64|tmpfile|BackdropFilter/);
  assert.match(nativeBlur, /backdropLayer\.filters = \[gaussianFilter\]/);
  assert.match(nativeBlur, /for tintView in effectView\.subviews\.dropFirst\(\)/);
  assert.match(nativeBlur, /gaussianFilter\.setValue\(blurRadius, forKey: "inputRadius"\)/);
  assert.doesNotMatch(nativeBlur, /UIGraphics|snapshot|write|Data\(/);
  assert.match(dialog, /RulesExpandedBold/);
  assert.match(dialog, /MondwestRegular/);
  assert.match(dialog, /presentationStyle="overFullScreen"/);
  assert.match(dialog, /DIALOG_DURATION_MS = 150/);
  assert.match(dialog, /transitionConfirmDialogGate/);
});
