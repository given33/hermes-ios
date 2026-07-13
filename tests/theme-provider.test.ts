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

  assert.match(appSource, /import \{ ThemeProvider \} from '\.\.\/design\/ThemeProvider'/);
  assert.match(appSource, /const \{ state, client \} = useAuth\(\)/);
  assert.match(appSource, /<ThemeProvider client=\{client\}>/);
  assert.match(appSource, /Hermes authenticated content/);

  assert.match(providerSource, /@react-native-async-storage\/async-storage/);
  assert.match(providerSource, /ThemePreferenceStore/);
  assert.match(providerSource, /executeThemeStateEffects/);
  assert.doesNotMatch(providerSource, /AppState|conversation|message|attachment|task result/i);
});
