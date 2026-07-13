import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getThemeEffectPlanQueue,
  startThemeReconciliation,
  ThemeEffectPlanQueue,
  type ThemeReconciliationHandle,
} from '../src/design/theme-reconciliation';
import {
  INITIAL_THEME_STATE,
  planFontMutation,
  planThemeMutation,
  type ThemeState,
  type ThemeStateEffectExecutor,
  type ThemeStatePlan,
} from '../src/design/theme-state';
import type {
  DashboardFontResponse,
  ThemeListResponse,
} from '../src/design/theme-types';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for reconciliation state');
}

const noOpEffects: ThemeStateEffectExecutor = {
  async writeTheme() {},
  async writeFont() {},
  async putTheme() {},
  async putFont() {},
};

function startHarness(options: {
  themes: Deferred<ThemeListResponse>;
  font: Deferred<DashboardFontResponse>;
  effects?: ThemeStateEffectExecutor;
  queue?: ThemeEffectPlanQueue;
  store?: {
    read(): Promise<{ theme: string | null; font: string | null }>;
  };
}): {
  handle: ThemeReconciliationHandle;
  getState(): ThemeState;
  setState(next: ThemeState): void;
  getCalls(): string[];
  getReadyCount(): number;
} {
  let state = INITIAL_THEME_STATE;
  let readyCount = 0;
  const calls: string[] = [];
  const handle = startThemeReconciliation({
    store: options.store ?? {
      async read() {
        calls.push('local-read');
        return { theme: 'default', font: 'theme' };
      },
    },
    client: {
      getThemes() {
        calls.push('get-themes');
        return options.themes.promise;
      },
      getFontPref() {
        calls.push('get-font');
        return options.font.promise;
      },
    },
    effects: options.effects ?? noOpEffects,
    queue: options.queue ?? new ThemeEffectPlanQueue(),
    getState: () => state,
    commit(plan: ThemeStatePlan) {
      state = plan.state;
    },
    markReady() {
      readyCount += 1;
    },
  });

  return {
    handle,
    getState: () => state,
    setState(next) {
      state = next;
    },
    getCalls: () => calls,
    getReadyCount: () => readyCount,
  };
}

test('theme and font GETs reconcile independently as each response completes', async () => {
  const themes = deferred<ThemeListResponse>();
  const font = deferred<DashboardFontResponse>();
  const harness = startHarness({ themes, font });

  await waitFor(() => harness.getReadyCount() === 1);
  assert.deepEqual(harness.getCalls(), ['local-read', 'get-themes', 'get-font']);

  font.resolve({ font: 'inter' });
  await waitFor(() => harness.getState().fontId === 'inter');
  assert.equal(harness.getState().themeName, 'default');

  themes.resolve({ active: 'mono', themes: [] });
  await harness.handle.completed;
  assert.equal(harness.getState().themeName, 'mono');
  assert.equal(harness.getState().fontId, 'inter');
});

test('late initial responses cannot roll back newer same-field user mutations', async () => {
  const themes = deferred<ThemeListResponse>();
  const font = deferred<DashboardFontResponse>();
  const harness = startHarness({ themes, font });
  await waitFor(() => harness.getReadyCount() === 1);

  harness.handle.markThemeMutation();
  const themeMutation = planThemeMutation(harness.getState(), 'mono');
  harness.setState(themeMutation.state);
  harness.handle.markFontMutation();
  const fontMutation = planFontMutation(harness.getState(), 'jetbrains-mono');
  harness.setState(fontMutation.state);

  themes.resolve({ active: 'nous-blue', themes: [] });
  font.resolve({ font: 'system-serif' });
  await harness.handle.completed;
  assert.equal(harness.getState().themeName, 'mono');
  assert.equal(harness.getState().fontId, 'jetbrains-mono');
});

test('an unmodified field reconciles from stateRef.current without losing the other field', async () => {
  const firstThemes = deferred<ThemeListResponse>();
  const firstFont = deferred<DashboardFontResponse>();
  const first = startHarness({ themes: firstThemes, font: firstFont });
  await waitFor(() => first.getReadyCount() === 1);

  first.handle.markFontMutation();
  first.setState(planFontMutation(first.getState(), 'jetbrains-mono').state);
  firstThemes.resolve({ active: 'nous-blue', themes: [] });
  await waitFor(() => first.getState().themeName === 'nous-blue');
  assert.equal(first.getState().fontId, 'jetbrains-mono');
  firstFont.resolve({ font: 'system-serif' });
  await first.handle.completed;
  assert.equal(first.getState().fontId, 'jetbrains-mono');

  const secondThemes = deferred<ThemeListResponse>();
  const secondFont = deferred<DashboardFontResponse>();
  const second = startHarness({ themes: secondThemes, font: secondFont });
  await waitFor(() => second.getReadyCount() === 1);

  second.handle.markThemeMutation();
  second.setState(planThemeMutation(second.getState(), 'mono').state);
  secondFont.resolve({ font: 'system-serif' });
  await waitFor(() => second.getState().fontId === 'system-serif');
  assert.equal(second.getState().themeName, 'mono');
  secondThemes.resolve({ active: 'nous-blue', themes: [] });
  await second.handle.completed;
  assert.equal(second.getState().themeName, 'mono');
});

test('cancellation after an awaited storage write blocks stale API and font effects', async () => {
  const themes = deferred<ThemeListResponse>();
  const font = deferred<DashboardFontResponse>();
  const storageWrite = deferred<void>();
  const effectCalls: string[] = [];
  const harness = startHarness({
    themes,
    font,
    effects: {
      async writeTheme(value) {
        effectCalls.push(`local-theme:${value}`);
        await storageWrite.promise;
      },
      async writeFont(value) {
        effectCalls.push(`local-font:${value}`);
      },
      async putTheme(value) {
        effectCalls.push(`server-theme:${value}`);
      },
      async putFont(value) {
        effectCalls.push(`server-font:${value}`);
      },
    },
  });
  await waitFor(() => harness.getReadyCount() === 1);

  themes.resolve({ active: 'lens-5i', themes: [] });
  await waitFor(() => effectCalls.length === 1);
  assert.equal(harness.getState().themeName, 'nous-blue');

  harness.handle.cancel();
  storageWrite.resolve(undefined);
  font.resolve({ font: 'inter' });
  await harness.handle.completed;

  assert.deepEqual(effectCalls, ['local-theme:nous-blue']);
  assert.equal(harness.getState().themeName, 'nous-blue');
  assert.equal(harness.getState().fontId, 'theme');
});

test('the Provider mutation runner stops a queued PUT when its lifecycle is cancelled', async () => {
  const themes = deferred<ThemeListResponse>();
  const font = deferred<DashboardFontResponse>();
  const storageWrite = deferred<void>();
  const effectCalls: string[] = [];
  const effects: ThemeStateEffectExecutor = {
    async writeTheme(value) {
      effectCalls.push(`local-theme:${value}`);
      await storageWrite.promise;
    },
    async writeFont(value) {
      effectCalls.push(`local-font:${value}`);
    },
    async putTheme(value) {
      effectCalls.push(`server-theme:${value}`);
    },
    async putFont(value) {
      effectCalls.push(`server-font:${value}`);
    },
  };
  const harness = startHarness({ themes, font, effects });
  await waitFor(() => harness.getReadyCount() === 1);

  const mutation = planThemeMutation(harness.getState(), 'mono');
  harness.setState(mutation.state);
  harness.handle.markThemeMutation();
  const mutationRun = harness.handle.runThemePlan(mutation);
  await waitFor(() => effectCalls.length === 1);

  harness.handle.cancel();
  storageWrite.resolve(undefined);
  themes.resolve({ active: 'nous-blue', themes: [] });
  font.resolve({ font: 'inter' });
  await mutationRun;
  await harness.handle.completed;

  assert.deepEqual(effectCalls, ['local-theme:mono']);
  assert.equal(harness.getState().themeName, 'mono');
});

test('a blocked server alias plan cannot persist after a newer user theme mutation', async () => {
  const themes = deferred<ThemeListResponse>();
  const font = deferred<DashboardFontResponse>();
  const oldStorageWrite = deferred<void>();
  const effectCalls: string[] = [];
  let localTheme = 'default';
  let serverTheme = 'default';
  let localFont = 'theme';
  const harness = startHarness({
    themes,
    font,
    effects: {
      async writeTheme(value) {
        effectCalls.push(`local-theme:start:${value}`);
        if (value === 'nous-blue') await oldStorageWrite.promise;
        localTheme = value;
        effectCalls.push(`local-theme:done:${value}`);
      },
      async writeFont(value) {
        localFont = value;
        effectCalls.push(`local-font:${value}`);
      },
      async putTheme(value) {
        serverTheme = value;
        effectCalls.push(`server-theme:${value}`);
      },
      async putFont(value) {
        effectCalls.push(`server-font:${value}`);
      },
    },
  });
  await waitFor(() => harness.getReadyCount() === 1);

  themes.resolve({ active: 'lens-5i', themes: [] });
  await waitFor(() => effectCalls.includes('local-theme:start:nous-blue'));

  font.resolve({ font: 'inter' });
  await waitFor(() => localFont === 'inter');
  assert.equal(localTheme, 'default');

  harness.handle.markThemeMutation();
  const mutation = planThemeMutation(harness.getState(), 'mono');
  harness.setState(mutation.state);
  const mutationRun = harness.handle.runThemePlan(mutation);
  assert.equal(harness.getState().themeName, 'mono');

  oldStorageWrite.resolve(undefined);
  await mutationRun;
  await harness.handle.completed;

  assert.equal(localTheme, 'mono');
  assert.equal(serverTheme, 'mono');
  assert.equal(effectCalls.includes('server-theme:nous-blue'), false);
  assert.deepEqual(
    effectCalls.filter((call) => call.startsWith('local-theme')),
    [
      'local-theme:start:nous-blue',
      'local-theme:done:nous-blue',
      'local-theme:start:mono',
      'local-theme:done:mono',
    ],
  );
});

test('a blocked server font write cannot persist after a newer user font mutation', async () => {
  const themes = deferred<ThemeListResponse>();
  const font = deferred<DashboardFontResponse>();
  const oldStorageWrite = deferred<void>();
  const effectCalls: string[] = [];
  let localFont = 'theme';
  let serverFont = 'theme';
  const harness = startHarness({
    themes,
    font,
    effects: {
      async writeTheme() {},
      async writeFont(value) {
        effectCalls.push(`local-font:start:${value}`);
        if (value === 'inter') await oldStorageWrite.promise;
        localFont = value;
        effectCalls.push(`local-font:done:${value}`);
      },
      async putTheme() {},
      async putFont(value) {
        serverFont = value;
        effectCalls.push(`server-font:${value}`);
      },
    },
  });
  await waitFor(() => harness.getReadyCount() === 1);

  font.resolve({ font: 'inter' });
  await waitFor(() => effectCalls.includes('local-font:start:inter'));
  harness.handle.markFontMutation();
  const mutation = planFontMutation(harness.getState(), 'jetbrains-mono');
  harness.setState(mutation.state);
  const mutationRun = harness.handle.runFontPlan(mutation);
  assert.equal(harness.getState().fontId, 'jetbrains-mono');

  oldStorageWrite.resolve(undefined);
  themes.resolve({ active: 'default', themes: [] });
  await mutationRun;
  await harness.handle.completed;

  assert.equal(localFont, 'jetbrains-mono');
  assert.equal(serverFont, 'jetbrains-mono');
  assert.deepEqual(effectCalls, [
    'local-font:start:inter',
    'local-font:done:inter',
    'local-font:start:jetbrains-mono',
    'local-font:done:jetbrains-mono',
    'server-font:jetbrains-mono',
  ]);
});

test('rapid user mutations persist and PUT only the newest value last', async () => {
  const themes = deferred<ThemeListResponse>();
  const font = deferred<DashboardFontResponse>();
  const firstThemeWrite = deferred<void>();
  const firstFontWrite = deferred<void>();
  const effectCalls: string[] = [];
  let localTheme = 'default';
  let serverTheme = 'default';
  let localFont = 'theme';
  let serverFont = 'theme';
  const harness = startHarness({
    themes,
    font,
    effects: {
      async writeTheme(value) {
        effectCalls.push(`local-theme:${value}`);
        if (value === 'mono') await firstThemeWrite.promise;
        localTheme = value;
      },
      async writeFont(value) {
        effectCalls.push(`local-font:${value}`);
        if (value === 'inter') await firstFontWrite.promise;
        localFont = value;
      },
      async putTheme(value) {
        effectCalls.push(`server-theme:${value}`);
        serverTheme = value;
      },
      async putFont(value) {
        effectCalls.push(`server-font:${value}`);
        serverFont = value;
      },
    },
  });
  await waitFor(() => harness.getReadyCount() === 1);

  harness.handle.markThemeMutation();
  const firstTheme = planThemeMutation(harness.getState(), 'mono');
  harness.setState(firstTheme.state);
  const firstThemeRun = harness.handle.runThemePlan(firstTheme);
  harness.handle.markFontMutation();
  const firstFont = planFontMutation(harness.getState(), 'inter');
  harness.setState(firstFont.state);
  const firstFontRun = harness.handle.runFontPlan(firstFont);
  await waitFor(() => effectCalls.includes('local-theme:mono'));
  await waitFor(() => effectCalls.includes('local-font:inter'));

  harness.handle.markThemeMutation();
  const lastTheme = planThemeMutation(harness.getState(), 'nous-blue');
  harness.setState(lastTheme.state);
  const lastThemeRun = harness.handle.runThemePlan(lastTheme);
  harness.handle.markFontMutation();
  const lastFont = planFontMutation(harness.getState(), 'space-mono');
  harness.setState(lastFont.state);
  const lastFontRun = harness.handle.runFontPlan(lastFont);
  assert.equal(harness.getState().themeName, 'nous-blue');
  assert.equal(harness.getState().fontId, 'space-mono');

  firstThemeWrite.resolve(undefined);
  firstFontWrite.resolve(undefined);
  themes.resolve({ active: 'ember', themes: [] });
  font.resolve({ font: 'spectral' });
  await firstThemeRun;
  await firstFontRun;
  await lastThemeRun;
  await lastFontRun;
  await harness.handle.completed;

  assert.equal(localTheme, 'nous-blue');
  assert.equal(serverTheme, 'nous-blue');
  assert.equal(localFont, 'space-mono');
  assert.equal(serverFont, 'space-mono');
  assert.equal(effectCalls.includes('server-theme:mono'), false);
  assert.equal(effectCalls.includes('server-font:inter'), false);
});

test('a hung old-client PUT cannot block a replacement lifecycle sharing the store queue', async () => {
  const oldThemes = deferred<ThemeListResponse>();
  const oldFont = deferred<DashboardFontResponse>();
  const oldPutResponse = deferred<void>();
  const effectCalls: string[] = [];
  let localTheme = 'default';
  let serverTheme = 'default';
  const sharedStore = {
    async read() {
      return { theme: localTheme, font: 'theme' };
    },
  };
  const sharedQueue = getThemeEffectPlanQueue(sharedStore);
  assert.equal(getThemeEffectPlanQueue(sharedStore), sharedQueue);
  const oldLifecycle = startHarness({
    themes: oldThemes,
    font: oldFont,
    queue: sharedQueue,
    store: sharedStore,
    effects: {
      async writeTheme(value) {
        localTheme = value;
        effectCalls.push(`old-local:${value}`);
      },
      async writeFont() {},
      async putTheme(value) {
        serverTheme = value;
        effectCalls.push(`old-server:start:${value}`);
        await oldPutResponse.promise;
        effectCalls.push(`old-server:done:${value}`);
      },
      async putFont() {},
    },
  });
  await waitFor(() => oldLifecycle.getReadyCount() === 1);

  oldLifecycle.handle.markThemeMutation();
  const oldMutation = planThemeMutation(oldLifecycle.getState(), 'mono');
  oldLifecycle.setState(oldMutation.state);
  const oldMutationRun = oldLifecycle.handle.runThemePlan(oldMutation);
  await waitFor(() => effectCalls.includes('old-server:start:mono'));
  oldLifecycle.handle.cancel();

  const newThemes = deferred<ThemeListResponse>();
  const newFont = deferred<DashboardFontResponse>();
  const newLifecycle = startHarness({
    themes: newThemes,
    font: newFont,
    queue: sharedQueue,
    store: sharedStore,
    effects: {
      async writeTheme(value) {
        localTheme = value;
        effectCalls.push(`new-local:${value}`);
      },
      async writeFont() {},
      async putTheme(value) {
        serverTheme = value;
        effectCalls.push(`new-server:${value}`);
      },
      async putFont() {},
    },
  });

  await waitFor(() => newLifecycle.getReadyCount() === 1);
  newLifecycle.handle.markThemeMutation();
  const newMutation = planThemeMutation(newLifecycle.getState(), 'nous-blue');
  newLifecycle.setState(newMutation.state);
  const newMutationRun = newLifecycle.handle.runThemePlan(newMutation);
  await newMutationRun;

  assert.equal(localTheme, 'nous-blue');
  assert.equal(serverTheme, 'nous-blue');
  assert.equal(effectCalls.includes('old-server:done:mono'), false);
  assert.ok(effectCalls.includes('new-local:nous-blue'));
  assert.ok(effectCalls.includes('new-server:nous-blue'));

  oldPutResponse.resolve(undefined);
  oldThemes.resolve({ active: 'default', themes: [] });
  oldFont.resolve({ font: 'theme' });
  newThemes.resolve({ active: 'default', themes: [] });
  newFont.resolve({ font: 'theme' });
  await oldMutationRun;
  await oldLifecycle.handle.completed;
  await newLifecycle.handle.completed;
  assert.equal(serverTheme, 'nous-blue');
});
