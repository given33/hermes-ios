import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import type { HermesApiClient } from '../api/HermesApiClient';
import { FONT_CHOICES, type FontChoice } from './font-catalog';
import {
  executeLifecycleThemePlan,
  startThemeReconciliation,
  type ThemeReconciliationHandle,
} from './theme-reconciliation';
import {
  INITIAL_THEME_STATE,
  planFontMutation,
  planThemeMutation,
  resolveActiveTheme,
  selectActiveThemeTokens,
  themeStateReducer,
  type ThemeStateEffectExecutor,
  type ThemeStatePlan,
} from './theme-state';
import { ThemePreferenceStore } from './theme-store';
import type {
  DashboardTheme,
  NativeThemeTokens,
  ThemeListEntry,
} from './theme-types';

export interface ThemeContextValue {
  ready: boolean;
  theme: DashboardTheme;
  themeName: string;
  tokens: NativeThemeTokens;
  availableThemes: ThemeListEntry[];
  fontId: string;
  fontChoices: FontChoice[];
  setTheme(name: string): Promise<void>;
  setFont(id: string): Promise<void>;
}

interface ThemeProviderProps extends PropsWithChildren {
  client: HermesApiClient;
  preferenceStore?: ThemePreferenceStore;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const asyncStorageThemeStore = new ThemePreferenceStore(AsyncStorage);

export function ThemeProvider({
  children,
  client,
  preferenceStore = asyncStorageThemeStore,
}: ThemeProviderProps) {
  const [state, dispatch] = useReducer(themeStateReducer, INITIAL_THEME_STATE);
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);
  const reconciliationRef = useRef<ThemeReconciliationHandle | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const effectExecutor = useMemo<ThemeStateEffectExecutor>(
    () => ({
      writeTheme: (value) => preferenceStore.writeTheme(value),
      writeFont: (value) => preferenceStore.writeFont(value),
      async putTheme(value) {
        await client.setTheme(value);
      },
      async putFont(value) {
        await client.setFontPref(value);
      },
    }),
    [client, preferenceStore],
  );

  const executeEffects = useCallback(
    (plan: ThemeStatePlan) => {
      const lifecycle = reconciliationRef.current;
      if (!lifecycle) return Promise.resolve();
      return executeLifecycleThemePlan(plan, effectExecutor, lifecycle);
    },
    [effectExecutor],
  );

  const commitPlan = useCallback((plan: ThemeStatePlan) => {
    stateRef.current = plan.state;
    dispatch({ type: 'replace-state', state: plan.state });
  }, []);

  useEffect(() => {
    setReady(false);
    const reconciliation = startThemeReconciliation({
      store: preferenceStore,
      client,
      effects: effectExecutor,
      getState: () => stateRef.current,
      commit: commitPlan,
      markReady: () => setReady(true),
    });
    reconciliationRef.current = reconciliation;
    return () => {
      reconciliation.cancel();
      if (reconciliationRef.current === reconciliation) {
        reconciliationRef.current = null;
      }
    };
  }, [client, commitPlan, effectExecutor, preferenceStore]);

  const setTheme = useCallback(
    async (name: string) => {
      reconciliationRef.current?.markThemeMutation();
      const plan = planThemeMutation(stateRef.current, name);
      commitPlan(plan);
      await executeEffects(plan);
    },
    [commitPlan, executeEffects],
  );

  const setFont = useCallback(
    async (id: string) => {
      reconciliationRef.current?.markFontMutation();
      const plan = planFontMutation(stateRef.current, id);
      commitPlan(plan);
      await executeEffects(plan);
    },
    [commitPlan, executeEffects],
  );

  const value = useMemo<ThemeContextValue>(() => ({
    ready,
    theme: resolveActiveTheme(state),
    themeName: state.themeName,
    tokens: selectActiveThemeTokens(state),
    availableThemes: state.availableThemes,
    fontId: state.fontId,
    fontChoices: FONT_CHOICES,
    setTheme,
    setFont,
  }), [ready, setFont, setTheme, state]);

  return (
    <ThemeContext.Provider value={value}>
      {ready ? children : null}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
