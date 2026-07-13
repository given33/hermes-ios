import {
  executeThemeStateEffects,
  planLocalSeed,
  planServerFontReconcile,
  planServerThemesReconcile,
  type ThemeState,
  type ThemeStateEffect,
  type ThemeStateEffectExecutor,
  type ThemeStatePlan,
} from './theme-state';
import type { StoredThemePreferences } from './theme-store';
import type {
  DashboardFontResponse,
  ThemeListResponse,
} from './theme-types';

type ThemeEffectField = 'theme' | 'font';

export class ThemeEffectPlanQueue {
  private themeTail: Promise<void> = Promise.resolve();
  private fontTail: Promise<void> = Promise.resolve();

  runStorage(
    field: ThemeEffectField,
    plan: ThemeStatePlan,
    effects: ThemeStateEffectExecutor,
    guard: () => boolean,
  ): Promise<void> {
    const storageEffects = plan.effects.filter(
      (effect) => effect.type === 'storage-set',
    );
    if (storageEffects.length === 0) return Promise.resolve();
    const task = () => executeThemeStateEffects(storageEffects, effects, guard);
    const previous = field === 'theme' ? this.themeTail : this.fontTail;
    const queued = previous.then(task, task);
    const settled = queued.catch(() => {});
    if (field === 'theme') {
      this.themeTail = settled;
    } else {
      this.fontTail = settled;
    }
    return queued;
  }
}

const EFFECT_QUEUES_BY_STORE = new WeakMap<object, ThemeEffectPlanQueue>();

export function getThemeEffectPlanQueue(store: object): ThemeEffectPlanQueue {
  const existing = EFFECT_QUEUES_BY_STORE.get(store);
  if (existing) return existing;
  const queue = new ThemeEffectPlanQueue();
  EFFECT_QUEUES_BY_STORE.set(store, queue);
  return queue;
}

export interface ThemeReconciliationOptions {
  store: {
    read(): Promise<StoredThemePreferences>;
  };
  client: {
    getThemes(): Promise<ThemeListResponse>;
    getFontPref(): Promise<DashboardFontResponse>;
  };
  effects: ThemeStateEffectExecutor;
  queue: ThemeEffectPlanQueue;
  getState(): ThemeState;
  commit(plan: ThemeStatePlan): void;
  markReady(): void;
}

export interface ThemeReconciliationHandle {
  cancel(): void;
  isActive(): boolean;
  markThemeMutation(): void;
  markFontMutation(): void;
  runThemePlan(plan: ThemeStatePlan): Promise<void>;
  runFontPlan(plan: ThemeStatePlan): Promise<void>;
  completed: Promise<void>;
}

export function startThemeReconciliation(
  options: ThemeReconciliationOptions,
): ThemeReconciliationHandle {
  let active = true;
  let themeMutationEpoch = 0;
  let fontMutationEpoch = 0;
  let themeNetworkTail: Promise<void> = Promise.resolve();
  let fontNetworkTail: Promise<void> = Promise.resolve();
  const isActive = () => active;

  const runNetwork = (
    field: ThemeEffectField,
    effects: ThemeStateEffect[],
    guard: () => boolean,
  ): Promise<void> => {
    if (effects.length === 0) return Promise.resolve();
    const task = () => executeThemeStateEffects(effects, options.effects, guard);
    const previous = field === 'theme' ? themeNetworkTail : fontNetworkTail;
    const queued = previous.then(task, task);
    const settled = queued.catch(() => {});
    if (field === 'theme') {
      themeNetworkTail = settled;
    } else {
      fontNetworkTail = settled;
    }
    return queued;
  };

  const runThemePlanAt = async (plan: ThemeStatePlan, epoch: number) => {
    const guard = () => active && themeMutationEpoch === epoch;
    await options.queue.runStorage('theme', plan, options.effects, guard);
    if (!guard()) return;
    await runNetwork(
      'theme',
      plan.effects.filter((effect) => effect.type === 'api-put'),
      guard,
    );
  };
  const runFontPlanAt = async (plan: ThemeStatePlan, epoch: number) => {
    const guard = () => active && fontMutationEpoch === epoch;
    await options.queue.runStorage('font', plan, options.effects, guard);
    if (!guard()) return;
    await runNetwork(
      'font',
      plan.effects.filter((effect) => effect.type === 'api-put'),
      guard,
    );
  };

  const applyThemePlan = async (plan: ThemeStatePlan, epoch: number) => {
    if (!active || themeMutationEpoch !== epoch) return;
    options.commit(plan);
    await runThemePlanAt(plan, epoch);
  };
  const applyFontPlan = async (plan: ThemeStatePlan, epoch: number) => {
    if (!active || fontMutationEpoch !== epoch) return;
    options.commit(plan);
    await runFontPlanAt(plan, epoch);
  };

  const reconcileThemes = async () => {
    const requestEpoch = themeMutationEpoch;
    try {
      const response = await options.client.getThemes();
      if (!active || requestEpoch !== themeMutationEpoch) return;
      await applyThemePlan(
        planServerThemesReconcile(options.getState(), response),
        requestEpoch,
      );
    } catch {
      // Theme and font reconciliation fail independently, matching WebUI.
    }
  };

  const reconcileFont = async () => {
    const requestEpoch = fontMutationEpoch;
    try {
      const response = await options.client.getFontPref();
      if (!active || requestEpoch !== fontMutationEpoch) return;
      await applyFontPlan(
        planServerFontReconcile(options.getState(), response),
        requestEpoch,
      );
    } catch {
      // Theme and font reconciliation fail independently, matching WebUI.
    }
  };

  const completed = (async () => {
    try {
      const preferences = await options.store.read();
      if (!active) return;
      await applyThemePlan(
        planLocalSeed(options.getState(), preferences),
        themeMutationEpoch,
      );
    } catch {
      // Keep built-in defaults and continue to the server authority.
    }

    if (!active) return;
    options.markReady();
    const themesTask = reconcileThemes();
    const fontTask = reconcileFont();
    await themesTask;
    await fontTask;
  })();

  return {
    cancel() {
      active = false;
    },
    isActive,
    markThemeMutation() {
      themeMutationEpoch += 1;
    },
    markFontMutation() {
      fontMutationEpoch += 1;
    },
    runThemePlan(plan) {
      return runThemePlanAt(plan, themeMutationEpoch);
    },
    runFontPlan(plan) {
      return runFontPlanAt(plan, fontMutationEpoch);
    },
    completed,
  };
}
