import {
  executeThemeStateEffects,
  planLocalSeed,
  planServerFontReconcile,
  planServerThemesReconcile,
  type ThemeState,
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

  run(
    field: ThemeEffectField,
    plan: ThemeStatePlan,
    effects: ThemeStateEffectExecutor,
    guard: () => boolean,
  ): Promise<void> {
    const task = () => executeThemeStateEffects(plan.effects, effects, guard);
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
  const isActive = () => active;

  const runThemePlanAt = (plan: ThemeStatePlan, epoch: number) =>
    options.queue.run(
      'theme',
      plan,
      options.effects,
      () => active && themeMutationEpoch === epoch,
    );
  const runFontPlanAt = (plan: ThemeStatePlan, epoch: number) =>
    options.queue.run(
      'font',
      plan,
      options.effects,
      () => active && fontMutationEpoch === epoch,
    );

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
