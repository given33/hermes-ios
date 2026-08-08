import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

test('re-sign-compatible builds opt into the same native fallbacks as Expo Go', () => {
  const appConfig = read('app.config.js');
  assert.match(appConfig, /HERMES_EXPO_GO_PARITY/);
  assert.match(appConfig, /hermesExpoGoParity: expoGoParityBuild/);

  for (const file of [
    'modules/hermes-context-menu/index.ts',
    'modules/hermes-ios-context/index.ts',
    'modules/hermes-ios-controls/index.ts',
    'modules/hermes-live-blur/index.ts',
    'modules/hermes-quick-look/index.ts',
    'modules/hermes-sheet-controller/index.ts',
    'modules/hermes-swipe-actions/index.ts',
  ]) {
    assert.match(
      read(file),
      /isExpoGoParityBuild/,
      `${file} must honor the Expo Go parity flag`,
    );
  }
});

test('the app config derives parity for the unsigned re-sign workflow', () => {
  const require = createRequire(import.meta.url);
  const configFactory = require(resolve(root, 'app.config.js')) as () => {
    extra?: { hermesExpoGoParity?: boolean };
  };
  const saved = {
    EXPO_PUBLIC_FRONTEND_PREVIEW: process.env.EXPO_PUBLIC_FRONTEND_PREVIEW,
    HERMES_DISTRIBUTABLE_BUILD: process.env.HERMES_DISTRIBUTABLE_BUILD,
    HERMES_RESIGN_COMPAT_BUILD: process.env.HERMES_RESIGN_COMPAT_BUILD,
    HERMES_EXPO_GO_PARITY: process.env.HERMES_EXPO_GO_PARITY,
    NODE_ENV: process.env.NODE_ENV,
  };
  try {
    process.env.EXPO_PUBLIC_FRONTEND_PREVIEW = '0';
    process.env.HERMES_DISTRIBUTABLE_BUILD = '1';
    process.env.HERMES_RESIGN_COMPAT_BUILD = '1';
    delete process.env.HERMES_EXPO_GO_PARITY;
    process.env.NODE_ENV = 'production';
    assert.equal(configFactory().extra?.hermesExpoGoParity, true);

    process.env.HERMES_RESIGN_COMPAT_BUILD = '0';
    assert.equal(configFactory().extra?.hermesExpoGoParity, false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
