import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('authenticated native content is reachable through the native ThemeProvider', () => {
  const appSource = readFileSync(
    resolve(projectRoot, 'src', 'app', 'HermesNativeApp.tsx'),
    'utf8',
  );
  const providerSource = readFileSync(
    resolve(projectRoot, 'src', 'design', 'ThemeProvider.tsx'),
    'utf8',
  );

  assert.match(appSource, /ThemeProvider[\s\S]*from '\.\.\/design\/ThemeProvider'/);
  assert.match(appSource, /const \{ state, client, deleteAccount, logout \} = useAuth\(\)/);
  assert.match(appSource, /account=\{\{[\s\S]*deleteAccount,[\s\S]*logout,[\s\S]*username:/);
  assert.match(appSource, /<ThemeProvider client=\{client\}>/);
  assert.match(appSource, /Hermes authenticated content/);
  assert.match(
    appSource,
    /<FrontendPreviewApp[\s\S]{0,180}cacheOwner=\{`\$\{state\.connection\.baseUrl\}\|\$\{state\.connection\.username\}`\}[\s\S]{0,80}client=\{client\}[\s\S]{0,80}notificationTarget=\{notificationTarget\}/,
  );
  assert.doesNotMatch(appSource, /<NativeShell \/>/);
  assert.match(appSource, /EXPO_PUBLIC_FRONTEND_PREVIEW/);
  assert.doesNotMatch(appSource, /__DEV__\s*&&\s*process\.env\.EXPO_PUBLIC_FRONTEND_PREVIEW/);
  assert.match(appSource, /<FrontendPreviewThemeProvider>/);

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
