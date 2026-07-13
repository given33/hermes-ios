import assert from 'node:assert/strict';
import test from 'node:test';

import { THEME_DEFAULT_FONT_ID } from '../src/design/font-catalog';
import { BUILTIN_THEMES } from '../src/design/theme-presets';
import {
  INITIAL_THEME_STATE,
  executeThemeStateEffects,
  migrateThemeName,
  planFontMutation,
  planLocalSeed,
  planServerFontReconcile,
  planServerThemesReconcile,
  planThemeMutation,
  resolveActiveTheme,
  selectActiveThemeTokens,
  themeStateReducer,
  type ThemeStateAction,
} from '../src/design/theme-state';
import {
  THEME_STORAGE_KEYS,
  ThemePreferenceStore,
  type AsyncStorageAdapter,
} from '../src/design/theme-store';
import type { DashboardTheme, ThemeListResponse } from '../src/design/theme-types';

class MemoryAsyncStorage implements AsyncStorageAdapter {
  readonly calls: Array<
    | { operation: 'get'; key: string }
    | { operation: 'set'; key: string; value: string }
  > = [];

  constructor(readonly values = new Map<string, string>()) {}

  async getItem(key: string): Promise<string | null> {
    this.calls.push({ operation: 'get', key });
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.calls.push({ operation: 'set', key, value });
    this.values.set(key, value);
  }
}

test('theme preference store can touch exactly the two approved AsyncStorage keys', async () => {
  assert.deepEqual(THEME_STORAGE_KEYS, {
    theme: 'hermes-dashboard-theme',
    font: 'hermes-dashboard-font',
  });

  const adapter = new MemoryAsyncStorage(new Map([
    [THEME_STORAGE_KEYS.theme, 'mono'],
    [THEME_STORAGE_KEYS.font, 'inter'],
    ['conversation-cache', 'must-not-be-read'],
  ]));
  const store = new ThemePreferenceStore(adapter);

  assert.deepEqual(await store.read(), { theme: 'mono', font: 'inter' });
  await store.writeTheme('nous-blue');
  await store.writeFont('theme');

  assert.deepEqual(adapter.calls, [
    { operation: 'get', key: 'hermes-dashboard-theme' },
    { operation: 'get', key: 'hermes-dashboard-font' },
    { operation: 'set', key: 'hermes-dashboard-theme', value: 'nous-blue' },
    { operation: 'set', key: 'hermes-dashboard-font', value: 'theme' },
  ]);
  assert.deepEqual([...new Set(adapter.calls.map((call) => call.key))], [
    'hermes-dashboard-theme',
    'hermes-dashboard-font',
  ]);
});

test('local seed migrates aliases while preserving unknown theme names for later resolution', () => {
  assert.equal(migrateThemeName('lens-5i'), 'nous-blue');
  assert.equal(migrateThemeName('mono'), 'mono');

  const preferences = { theme: 'lens-5i', font: 'not-a-font' };
  const action: ThemeStateAction = { type: 'seed-local', preferences };
  const reduced = themeStateReducer(INITIAL_THEME_STATE, action);
  const plan = planLocalSeed(INITIAL_THEME_STATE, preferences);

  assert.deepEqual(plan.state, reduced);
  assert.equal(plan.state.themeName, 'nous-blue');
  assert.equal(plan.state.fontId, THEME_DEFAULT_FONT_ID);
  assert.deepEqual(plan.effects, [
    {
      type: 'storage-set',
      key: 'hermes-dashboard-theme',
      value: 'nous-blue',
    },
  ]);

  const unknown = planLocalSeed(INITIAL_THEME_STATE, {
    theme: 'missing-theme',
    font: 'inter',
  });
  assert.equal(unknown.state.themeName, 'missing-theme');
  assert.equal(unknown.state.fontId, 'inter');
  assert.equal(resolveActiveTheme(unknown.state), BUILTIN_THEMES.default);
  assert.deepEqual(unknown.effects, []);
});

test('server theme and font values replace local seed and retain user definitions', () => {
  const userTheme: DashboardTheme = {
    ...BUILTIN_THEMES.default,
    name: 'operator-green',
    label: 'Operator Green',
    description: 'Server-defined operator theme',
    layoutVariant: 'tiled',
    palette: {
      ...BUILTIN_THEMES.default.palette,
      background: { hex: '#00110a', alpha: 1 },
      midground: { hex: '#a8ffcf', alpha: 1 },
    },
  };
  const serverThemes: ThemeListResponse = {
    active: 'operator-green',
    themes: [
      {
        name: 'default',
        label: 'Hermes Teal',
        description: 'Classic dark teal',
      },
      {
        name: userTheme.name,
        label: userTheme.label,
        description: userTheme.description,
        definition: userTheme,
      },
    ],
  };
  const local = planLocalSeed(INITIAL_THEME_STATE, {
    theme: 'mono',
    font: 'inter',
  }).state;
  const themePlan = planServerThemesReconcile(local, serverThemes);
  const fontPlan = planServerFontReconcile(themePlan.state, { font: 'system-serif' });

  assert.equal(themePlan.state.themeName, 'operator-green');
  assert.equal(resolveActiveTheme(themePlan.state), userTheme);
  assert.deepEqual(themePlan.state.availableThemes, serverThemes.themes);
  assert.equal(themePlan.state.userThemeDefinitions['operator-green'], userTheme);
  assert.deepEqual(themePlan.effects, [
    {
      type: 'storage-set',
      key: 'hermes-dashboard-theme',
      value: 'operator-green',
    },
  ]);

  assert.equal(fontPlan.state.fontId, 'system-serif');
  assert.deepEqual(fontPlan.effects, [
    {
      type: 'storage-set',
      key: 'hermes-dashboard-font',
      value: 'system-serif',
    },
  ]);
  const tokens = selectActiveThemeTokens(fontPlan.state);
  assert.equal(tokens.name, 'operator-green');
  assert.equal(tokens.layout.variant, 'tiled');
  assert.equal(tokens.typography.fontSans.startsWith('Georgia'), true);
  assert.equal(tokens.typography.fontMono, userTheme.typography.fontMono);
});

test('server alias reconciliation writes local state before pushing migration back', () => {
  const plan = planServerThemesReconcile(INITIAL_THEME_STATE, {
    active: 'lens-5i',
    themes: [],
  });

  assert.equal(plan.state.themeName, 'nous-blue');
  assert.deepEqual(plan.effects, [
    {
      type: 'storage-set',
      key: 'hermes-dashboard-theme',
      value: 'nous-blue',
    },
    {
      type: 'api-put',
      path: '/api/dashboard/theme',
      body: { name: 'nous-blue' },
    },
  ]);
});

test('unknown server theme names persist while rendering falls back without rollback', () => {
  const local = planLocalSeed(INITIAL_THEME_STATE, {
    theme: 'mono',
    font: 'inter',
  }).state;
  const themePlan = planServerThemesReconcile(local, {
    active: 'missing-theme',
    themes: [],
  });
  const fontPlan = planServerFontReconcile(themePlan.state, {
    font: 'missing-font',
  });

  assert.equal(themePlan.state.themeName, 'missing-theme');
  assert.equal(resolveActiveTheme(themePlan.state), BUILTIN_THEMES.default);
  assert.deepEqual(themePlan.effects, [
    {
      type: 'storage-set',
      key: 'hermes-dashboard-theme',
      value: 'missing-theme',
    },
  ]);
  assert.equal(fontPlan.state.fontId, 'theme');
  assert.deepEqual(fontPlan.effects, [
    {
      type: 'storage-set',
      key: 'hermes-dashboard-font',
      value: 'theme',
    },
  ]);
});

test('theme and font mutations commit state then order local writes before PUTs', () => {
  const userTheme: DashboardTheme = {
    ...BUILTIN_THEMES.default,
    name: 'user-theme',
    label: 'User Theme',
    description: 'User theme',
  };
  const withUserTheme = planServerThemesReconcile(INITIAL_THEME_STATE, {
    active: 'default',
    themes: [{
      name: userTheme.name,
      label: userTheme.label,
      description: userTheme.description,
      definition: userTheme,
    }],
  }).state;

  const themePlan = planThemeMutation(withUserTheme, 'user-theme');
  assert.equal(themePlan.state.themeName, 'user-theme');
  assert.deepEqual(themePlan.effects, [
    {
      type: 'storage-set',
      key: 'hermes-dashboard-theme',
      value: 'user-theme',
    },
    {
      type: 'api-put',
      path: '/api/dashboard/theme',
      body: { name: 'user-theme' },
    },
  ]);

  const fontPlan = planFontMutation(themePlan.state, 'jetbrains-mono');
  assert.equal(fontPlan.state.fontId, 'jetbrains-mono');
  assert.deepEqual(fontPlan.effects, [
    {
      type: 'storage-set',
      key: 'hermes-dashboard-font',
      value: 'jetbrains-mono',
    },
    {
      type: 'api-put',
      path: '/api/dashboard/font',
      body: { font: 'jetbrains-mono' },
    },
  ]);

  const invalidTheme = planThemeMutation(fontPlan.state, 'not-known');
  const invalidFont = planFontMutation(fontPlan.state, 'not-known');
  assert.equal(invalidTheme.state.themeName, 'default');
  assert.equal(invalidFont.state.fontId, 'theme');
  assert.equal(themePlan.state.themeName, 'user-theme');
});

test('effect execution preserves order and never rolls committed state back on failure', async () => {
  const plan = planFontMutation(INITIAL_THEME_STATE, 'inter');
  const calls: string[] = [];

  await executeThemeStateEffects(plan.effects, {
    async writeTheme(value) {
      calls.push(`local-theme:${value}`);
    },
    async writeFont(value) {
      calls.push(`local-font:${value}`);
      throw new Error('AsyncStorage unavailable');
    },
    async putTheme(value) {
      calls.push(`server-theme:${value}`);
    },
    async putFont(value) {
      calls.push(`server-font:${value}`);
      throw new Error('server unavailable');
    },
  });

  assert.deepEqual(calls, ['local-font:inter', 'server-font:inter']);
  assert.equal(plan.state.fontId, 'inter');
  assert.equal(INITIAL_THEME_STATE.fontId, 'theme');
});
