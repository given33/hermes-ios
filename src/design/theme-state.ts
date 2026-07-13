import {
  THEME_DEFAULT_FONT_ID,
  applyFontPreference,
  isFontPreference,
} from './font-catalog';
import {
  BUILTIN_THEMES,
  BUILTIN_THEME_ORDER,
} from './theme-presets';
import { THEME_STORAGE_KEYS, type StoredThemePreferences } from './theme-store';
import { deriveNativeThemeTokens } from './theme-tokens';
import type {
  DashboardFontResponse,
  DashboardTheme,
  NativeThemeTokens,
  ThemeListEntry,
  ThemeListResponse,
} from './theme-types';

export interface ThemeState {
  themeName: string;
  fontId: string;
  availableThemes: ThemeListEntry[];
  userThemeDefinitions: Record<string, DashboardTheme>;
}

export type ThemeStateAction =
  | { type: 'seed-local'; preferences: StoredThemePreferences }
  | { type: 'reconcile-server-themes'; response: ThemeListResponse }
  | { type: 'reconcile-server-font'; response: DashboardFontResponse }
  | { type: 'set-theme'; name: string }
  | { type: 'set-font'; id: string }
  | { type: 'replace-state'; state: ThemeState };

export type ThemeStateEffect =
  | {
      type: 'storage-set';
      key: (typeof THEME_STORAGE_KEYS)[keyof typeof THEME_STORAGE_KEYS];
      value: string;
    }
  | {
      type: 'api-put';
      path: '/api/dashboard/theme';
      body: { name: string };
    }
  | {
      type: 'api-put';
      path: '/api/dashboard/font';
      body: { font: string };
    };

export interface ThemeStatePlan {
  state: ThemeState;
  effects: ThemeStateEffect[];
}

export interface ThemeStateEffectExecutor {
  writeTheme(value: string): Promise<void>;
  writeFont(value: string): Promise<void>;
  putTheme(value: string): Promise<void>;
  putFont(value: string): Promise<void>;
}

const BUILTIN_THEME_ENTRIES: ThemeListEntry[] = BUILTIN_THEME_ORDER.map((name) => {
  const theme = BUILTIN_THEMES[name];
  return {
    name: theme.name,
    label: theme.label,
    description: theme.description,
  };
});

export const INITIAL_THEME_STATE: ThemeState = {
  themeName: 'default',
  fontId: THEME_DEFAULT_FONT_ID,
  availableThemes: BUILTIN_THEME_ENTRIES,
  userThemeDefinitions: {},
};

const THEME_NAME_ALIASES: Record<string, string> = {
  'lens-5i': 'nous-blue',
};

export function migrateThemeName(name: string): string {
  return THEME_NAME_ALIASES[name] ?? name;
}

function isBuiltinTheme(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_THEMES, name);
}

function isKnownTheme(state: ThemeState, name: string): boolean {
  return (
    isBuiltinTheme(name)
    || Object.prototype.hasOwnProperty.call(state.userThemeDefinitions, name)
    || state.availableThemes.some((theme) => theme.name === name)
  );
}

function normalizeLocalTheme(name: string | null): string {
  return migrateThemeName(name ?? 'default');
}

function normalizeFont(id: string | null | undefined): string {
  return isFontPreference(id) ? id : THEME_DEFAULT_FONT_ID;
}

function serverThemeState(state: ThemeState, response: ThemeListResponse): ThemeState {
  const definitions: Record<string, DashboardTheme> = {};
  for (const entry of response.themes) {
    if (entry.definition) definitions[entry.name] = entry.definition;
  }

  const availableThemes = response.themes.length > 0
    ? response.themes
    : state.availableThemes;
  const userThemeDefinitions = Object.keys(definitions).length > 0
    ? definitions
    : state.userThemeDefinitions;
  const indexedState: ThemeState = {
    ...state,
    availableThemes,
    userThemeDefinitions,
  };

  if (!response.active) return indexedState;
  const migrated = migrateThemeName(response.active);
  return {
    ...indexedState,
    themeName: migrated,
  };
}

export function themeStateReducer(
  state: ThemeState,
  action: ThemeStateAction,
): ThemeState {
  switch (action.type) {
    case 'seed-local':
      return {
        ...state,
        themeName: normalizeLocalTheme(action.preferences.theme),
        fontId: normalizeFont(action.preferences.font),
      };
    case 'reconcile-server-themes':
      return serverThemeState(state, action.response);
    case 'reconcile-server-font':
      return {
        ...state,
        fontId: normalizeFont(action.response.font),
      };
    case 'set-theme':
      return {
        ...state,
        themeName: isKnownTheme(state, action.name) ? action.name : 'default',
      };
    case 'set-font':
      return {
        ...state,
        fontId: normalizeFont(action.id),
      };
    case 'replace-state':
      return action.state;
  }
}

export function planLocalSeed(
  state: ThemeState,
  preferences: StoredThemePreferences,
): ThemeStatePlan {
  const next = themeStateReducer(state, { type: 'seed-local', preferences });
  const effects: ThemeStateEffect[] = [];
  if (
    preferences.theme !== null
    && migrateThemeName(preferences.theme) !== preferences.theme
  ) {
    effects.push({
      type: 'storage-set',
      key: THEME_STORAGE_KEYS.theme,
      value: next.themeName,
    });
  }
  return { state: next, effects };
}

export function planServerThemesReconcile(
  state: ThemeState,
  response: ThemeListResponse,
): ThemeStatePlan {
  const next = themeStateReducer(state, {
    type: 'reconcile-server-themes',
    response,
  });
  const effects: ThemeStateEffect[] = [];
  if (response.active && next.themeName !== state.themeName) {
    effects.push({
      type: 'storage-set',
      key: THEME_STORAGE_KEYS.theme,
      value: next.themeName,
    });
  }
  if (response.active && migrateThemeName(response.active) !== response.active) {
    effects.push({
      type: 'api-put',
      path: '/api/dashboard/theme',
      body: { name: migrateThemeName(response.active) },
    });
  }
  return { state: next, effects };
}

export function planServerFontReconcile(
  state: ThemeState,
  response: DashboardFontResponse,
): ThemeStatePlan {
  const next = themeStateReducer(state, {
    type: 'reconcile-server-font',
    response,
  });
  const effects: ThemeStateEffect[] = next.fontId === state.fontId
    ? []
    : [{
        type: 'storage-set',
        key: THEME_STORAGE_KEYS.font,
        value: next.fontId,
      }];
  return { state: next, effects };
}

export function planThemeMutation(state: ThemeState, name: string): ThemeStatePlan {
  const next = themeStateReducer(state, { type: 'set-theme', name });
  return {
    state: next,
    effects: [
      {
        type: 'storage-set',
        key: THEME_STORAGE_KEYS.theme,
        value: next.themeName,
      },
      {
        type: 'api-put',
        path: '/api/dashboard/theme',
        body: { name: next.themeName },
      },
    ],
  };
}

export function planFontMutation(state: ThemeState, id: string): ThemeStatePlan {
  const next = themeStateReducer(state, { type: 'set-font', id });
  return {
    state: next,
    effects: [
      {
        type: 'storage-set',
        key: THEME_STORAGE_KEYS.font,
        value: next.fontId,
      },
      {
        type: 'api-put',
        path: '/api/dashboard/font',
        body: { font: next.fontId },
      },
    ],
  };
}

export function resolveActiveTheme(state: ThemeState): DashboardTheme {
  return (
    BUILTIN_THEMES[state.themeName as keyof typeof BUILTIN_THEMES]
    ?? state.userThemeDefinitions[state.themeName]
    ?? BUILTIN_THEMES.default
  );
}

export function selectActiveThemeTokens(state: ThemeState): NativeThemeTokens {
  return applyFontPreference(
    deriveNativeThemeTokens(resolveActiveTheme(state)),
    state.fontId,
  );
}

export async function executeThemeStateEffects(
  effects: readonly ThemeStateEffect[],
  executor: ThemeStateEffectExecutor,
): Promise<void> {
  for (const effect of effects) {
    try {
      if (effect.type === 'storage-set') {
        if (effect.key === THEME_STORAGE_KEYS.theme) {
          await executor.writeTheme(effect.value);
        } else {
          await executor.writeFont(effect.value);
        }
      } else if (effect.path === '/api/dashboard/theme') {
        await executor.putTheme(effect.body.name);
      } else {
        await executor.putFont(effect.body.font);
      }
    } catch {
      // WebUI keeps the already-selected state and lets later effects proceed.
    }
  }
}
