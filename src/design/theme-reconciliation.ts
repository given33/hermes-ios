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

export interface ThemeReconciliationOptions {
  store: {
    read(): Promise<StoredThemePreferences>;
  };
  client: {
    getThemes(): Promise<ThemeListResponse>;
    getFontPref(): Promise<DashboardFontResponse>;
  };
  effects: ThemeStateEffectExecutor;
  getState(): ThemeState;
  commit(plan: ThemeStatePlan): void;
  markReady(): void;
}

export interface ThemeReconciliationHandle {
  cancel(): void;
  isActive(): boolean;
  markThemeMutation(): void;
  markFontMutation(): void;
  completed: Promise<void>;
}

export function executeLifecycleThemePlan(
  plan: ThemeStatePlan,
  effects: ThemeStateEffectExecutor,
  lifecycle: Pick<ThemeReconciliationHandle, 'isActive'>,
): Promise<void> {
  return executeThemeStateEffects(plan.effects, effects, lifecycle.isActive);
}

export function startThemeReconciliation(
  options: ThemeReconciliationOptions,
): ThemeReconciliationHandle {
  let active = true;
  let themeMutationEpoch = 0;
  let fontMutationEpoch = 0;
  const isActive = () => active;

  const applyPlan = async (plan: ThemeStatePlan) => {
    if (!active) return;
    options.commit(plan);
    await executeThemeStateEffects(plan.effects, options.effects, isActive);
  };

  const reconcileThemes = async () => {
    const requestEpoch = themeMutationEpoch;
    try {
      const response = await options.client.getThemes();
      if (!active || requestEpoch !== themeMutationEpoch) return;
      await applyPlan(planServerThemesReconcile(options.getState(), response));
    } catch {
      // Theme and font reconciliation fail independently, matching WebUI.
    }
  };

  const reconcileFont = async () => {
    const requestEpoch = fontMutationEpoch;
    try {
      const response = await options.client.getFontPref();
      if (!active || requestEpoch !== fontMutationEpoch) return;
      await applyPlan(planServerFontReconcile(options.getState(), response));
    } catch {
      // Theme and font reconciliation fail independently, matching WebUI.
    }
  };

  const completed = (async () => {
    try {
      const preferences = await options.store.read();
      if (!active) return;
      await applyPlan(planLocalSeed(options.getState(), preferences));
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
    completed,
  };
}
