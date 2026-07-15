import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('React Native pages use preview and authenticated theme providers', () => {
  const appSource = readFileSync(
    resolve(projectRoot, 'src', 'app', 'HermesNativeApp.tsx'),
    'utf8',
  );
  const providerSource = readFileSync(
    resolve(projectRoot, 'src', 'design', 'ThemeProvider.tsx'),
    'utf8',
  );

  assert.match(appSource, /const \{ state, client \} = useAuth\(\)/);
  assert.match(appSource, /<LoginScreen/);
  assert.match(appSource, /<FrontendPreviewApp/);
  assert.match(appSource, /<NativeShell/);
  assert.match(appSource, /<ThemeProvider/);
  assert.match(appSource, /<FrontendPreviewThemeProvider/);
  assert.match(appSource, /EXPO_PUBLIC_FRONTEND_PREVIEW/);
  assert.doesNotMatch(appSource, /HermesSwiftUI(?:Frontend|Login)View/);

  assert.match(providerSource, /@react-native-async-storage\/async-storage/);
  assert.match(providerSource, /ThemePreferenceStore/);
  assert.match(providerSource, /startThemeReconciliation/);
  assert.match(providerSource, /getThemeEffectPlanQueue/);
  assert.match(providerSource, /runThemePlan/);
  assert.match(providerSource, /runFontPlan/);
  assert.doesNotMatch(providerSource, /AppState|conversation|message|attachment|task result/i);
});

test('frontend preview theme state stays local and never receives an API client', () => {
  const providerSource = readFileSync(
    resolve(projectRoot, 'src', 'design', 'ThemeProvider.tsx'),
    'utf8',
  );
  const preview = providerSource.slice(
    providerSource.indexOf('export function FrontendPreviewThemeProvider'),
    providerSource.indexOf('export function useTheme'),
  );

  assert.match(preview, /BUILTIN_THEMES/);
  assert.match(preview, /deriveNativeThemeTokens/);
  assert.doesNotMatch(preview, /HermesApiClient|ThemePreferenceStore|client\./);
});
