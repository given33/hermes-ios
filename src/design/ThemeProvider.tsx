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
import {
  FONT_CHOICES,
  THEME_DEFAULT_FONT_ID,
  applyFontPreference,
  type FontChoice,
} from './font-catalog';
import {
  BUILTIN_THEMES,
  BUILTIN_THEME_ORDER,
  type BuiltinThemeName,
} from './theme-presets';
import { HermesThemeApi } from './theme-api';
import {
  getThemeEffectPlanQueue,
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
import { namespacedThemePreferenceStore, ThemePreferenceStore } from './theme-store';
import { deriveNativeThemeTokens } from './theme-tokens';
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
  preferenceNamespace?: string;
  preferenceStore?: ThemePreferenceStore;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const asyncStorageThemeStore = new ThemePreferenceStore(AsyncStorage);

export function ThemeProvider({
  children,
  client,
  preferenceNamespace,
  preferenceStore,
}: ThemeProviderProps) {
  const [state, dispatch] = useReducer(themeStateReducer, INITIAL_THEME_STATE);
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);
  const reconciliationRef = useRef<ThemeReconciliationHandle | null>(null);
  const scopedPreferenceStore = useMemo(
    () => preferenceStore
      || (preferenceNamespace
        ? namespacedThemePreferenceStore(AsyncStorage, preferenceNamespace)
        : asyncStorageThemeStore),
    [preferenceNamespace, preferenceStore],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // The design layer owns the theme/font endpoints; the raw transport client
  // is wrapped here rather than growing product methods of its own.
  const themeApi = useMemo(() => new HermesThemeApi(client), [client]);

  const effectExecutor = useMemo<ThemeStateEffectExecutor>(
    () => ({
      writeTheme: (value) => scopedPreferenceStore.writeTheme(value),
      writeFont: (value) => scopedPreferenceStore.writeFont(value),
      async putTheme(value) {
        await themeApi.setTheme(value);
      },
      async putFont(value) {
        await themeApi.setFontPref(value);
      },
    }),
    [scopedPreferenceStore, themeApi],
  );

  const effectQueue = useMemo(
    () => getThemeEffectPlanQueue(scopedPreferenceStore),
    [scopedPreferenceStore],
  );

  const commitPlan = useCallback((plan: ThemeStatePlan) => {
    stateRef.current = plan.state;
    dispatch({ type: 'replace-state', state: plan.state });
  }, []);

  useEffect(() => {
    setReady(false);
    const reconciliation = startThemeReconciliation({
      store: scopedPreferenceStore,
      client: themeApi,
      effects: effectExecutor,
      queue: effectQueue,
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
  }, [commitPlan, effectExecutor, effectQueue, scopedPreferenceStore, themeApi]);

  const setTheme = useCallback(
    async (name: string) => {
      const reconciliation = reconciliationRef.current;
      reconciliation?.markThemeMutation();
      const plan = planThemeMutation(stateRef.current, name);
      commitPlan(plan);
      await reconciliation?.runThemePlan(plan);
    },
    [commitPlan],
  );

  const setFont = useCallback(
    async (id: string) => {
      const reconciliation = reconciliationRef.current;
      reconciliation?.markFontMutation();
      const plan = planFontMutation(stateRef.current, id);
      commitPlan(plan);
      await reconciliation?.runFontPlan(plan);
    },
    [commitPlan],
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

export function FrontendPreviewThemeProvider({ children }: PropsWithChildren) {
  const [themeName, setThemeName] = useState<BuiltinThemeName>('studio-ink-light');
  const [fontId, setFontId] = useState(THEME_DEFAULT_FONT_ID);
  const [ready, setReady] = useState(false);
  const theme = BUILTIN_THEMES[themeName];
  const availableThemes = useMemo(
    () => BUILTIN_THEME_ORDER.map((name) => ({
      name,
      label: BUILTIN_THEMES[name].label,
      description: BUILTIN_THEMES[name].description,
      definition: BUILTIN_THEMES[name],
    })),
    [],
  );
  const setTheme = useCallback(async (name: string) => {
    if (Object.prototype.hasOwnProperty.call(BUILTIN_THEMES, name)) {
      const next = name as BuiltinThemeName;
      setThemeName(next);
      await AsyncStorage.setItem('hermes.preview.studio.theme', next);
    }
  }, []);
  const setFont = useCallback(async (id: string) => {
    if (
      id === THEME_DEFAULT_FONT_ID
      || FONT_CHOICES.some((choice) => choice.id === id)
    ) {
      setFontId(id);
      await AsyncStorage.setItem('hermes.preview.studio.font', id);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem('hermes.preview.studio.theme'),
      AsyncStorage.getItem('hermes.preview.studio.font'),
    ]).then(([storedTheme, storedFont]) => {
      if (cancelled) return;
      if (
        storedTheme
        && Object.prototype.hasOwnProperty.call(BUILTIN_THEMES, storedTheme)
      ) {
        setThemeName(storedTheme as BuiltinThemeName);
      }
      if (
        storedFont === THEME_DEFAULT_FONT_ID
        || FONT_CHOICES.some((choice) => choice.id === storedFont)
      ) {
        setFontId(storedFont ?? THEME_DEFAULT_FONT_ID);
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const value = useMemo<ThemeContextValue>(() => ({
    ready,
    theme,
    themeName,
    tokens: applyFontPreference(deriveNativeThemeTokens(theme), fontId),
    availableThemes,
    fontId,
    fontChoices: FONT_CHOICES,
    setTheme,
    setFont,
  }), [availableThemes, fontId, ready, setFont, setTheme, theme, themeName]);

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
