/**
 * Pure visual contract for the redesigned login surface.
 *
 * The screen renders before ThemeProvider exists (it IS the auth boundary),
 * so it carries its own dual-scheme palette: light by default, user-toggled
 * dark, persisted to AsyncStorage under `appearanceStorageKey`. Shared colors
 * and control dimensions live here; the screen owns its unframed layout.
 */

export type LoginColorScheme = 'light' | 'dark';

export interface LoginPalette {
  /** Vertical canvas gradient, top anchor. */
  backgroundTop: string;
  /** Vertical canvas gradient, bottom anchor. */
  backgroundBottom: string;
  /** Radial accent wash drawn from the top edge of the canvas. */
  glow: string;
  /** Elevated card surface. */
  card: string;
  /** Hairline card border. */
  cardBorder: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  inputFill: string;
  inputBorder: string;
  inputPlaceholder: string;
  /** Focused control chrome (border + focus ring). */
  accent: string;
  accentHover: string;
  accentActive: string;
  /** Darker accent stop for the monogram gradient. */
  accentDeep: string;
  accentText: string;
  /** Accent for text sitting ON the card/input surface (WCAG AA label role). */
  accentLabel: string;
  /** Tinted accent fill for segmented tracks and soft chips. */
  accentSoft: string;
  error: string;
  errorSoft: string;
  separator: string;
  /** Appearance-toggle chrome. */
  toggleFill: string;
  toggleBorder: string;
  toggleIcon: string;
  /** Native shadow color (iOS shadowColor / Android shadowColor). */
  shadow: string;
}

export const LOGIN_LIGHT_PALETTE: LoginPalette = {
  backgroundTop: '#ffffff',
  backgroundBottom: '#ffffff',
  glow: 'rgba(0, 83, 253, 0.10)',
  card: '#ffffff',
  cardBorder: 'rgba(15, 18, 22, 0.06)',
  text: '#0f1216',
  textSecondary: 'rgba(15, 18, 22, 0.62)',
  textTertiary: 'rgba(15, 18, 22, 0.42)',
  inputFill: '#ffffff',
  inputBorder: 'rgba(15, 18, 22, 0.16)',
  inputPlaceholder: 'rgba(15, 18, 22, 0.36)',
  accent: '#202727',
  accentHover: '#354441',
  accentActive: '#111816',
  accentDeep: '#0040c8',
  accentText: '#ffffff',
  accentLabel: '#157858',
  accentSoft: 'rgba(21, 120, 88, 0.08)',
  error: '#d92d20',
  errorSoft: 'rgba(217, 45, 32, 0.08)',
  separator: 'rgba(15, 18, 22, 0.08)',
  toggleFill: '#ffffff',
  toggleBorder: 'rgba(15, 18, 22, 0.10)',
  toggleIcon: '#3c4654',
  shadow: 'rgba(15, 23, 42, 0.10)',
};

export const LOGIN_DARK_PALETTE: LoginPalette = {
  backgroundTop: '#141817',
  backgroundBottom: '#141817',
  glow: 'rgba(58, 106, 222, 0.14)',
  card: '#191c23',
  cardBorder: 'rgba(255, 255, 255, 0.07)',
  text: '#f3f5f9',
  textSecondary: 'rgba(243, 245, 249, 0.64)',
  textTertiary: 'rgba(243, 245, 249, 0.42)',
  inputFill: '#1c2320',
  inputBorder: 'rgba(255, 255, 255, 0.18)',
  inputPlaceholder: 'rgba(243, 245, 249, 0.38)',
  accent: '#e8efec',
  accentHover: '#ffffff',
  accentActive: '#cbdad3',
  accentDeep: '#2c55a4',
  accentText: '#15241e',
  accentLabel: '#80d6b1',
  accentSoft: 'rgba(128, 214, 177, 0.12)',
  error: '#f97066',
  errorSoft: 'rgba(249, 112, 102, 0.12)',
  separator: 'rgba(255, 255, 255, 0.08)',
  toggleFill: '#1d212a',
  toggleBorder: 'rgba(255, 255, 255, 0.10)',
  toggleIcon: '#dfe4ee',
  shadow: 'rgba(0, 0, 0, 0.45)',
};

export function loginPalette(scheme: LoginColorScheme): LoginPalette {
  return scheme === 'dark' ? LOGIN_DARK_PALETTE : LOGIN_LIGHT_PALETTE;
}

export function isLoginColorScheme(value: string): value is LoginColorScheme {
  return value === 'light' || value === 'dark';
}

export interface ProviderButtonInteractionState {
  readonly hovered: boolean;
  readonly pressed: boolean;
}

export type ProviderButtonInteractionEvent =
  | 'hover-in'
  | 'hover-out'
  | 'press-in'
  | 'press-out'
  | 'reset';

export type ProviderButtonVisualState = 'base' | 'hover' | 'active';

export interface ProviderButtonLayerTargets {
  readonly hoverOpacity: 0 | 1;
  readonly activeOpacity: 0 | 1;
}

export const INITIAL_PROVIDER_BUTTON_INTERACTION: ProviderButtonInteractionState =
  Object.freeze({ hovered: false, pressed: false });

export function reduceProviderButtonInteraction(
  state: ProviderButtonInteractionState,
  event: ProviderButtonInteractionEvent,
): ProviderButtonInteractionState {
  switch (event) {
    case 'hover-in':
      return state.hovered ? state : { ...state, hovered: true };
    case 'hover-out':
      return state.hovered ? { ...state, hovered: false } : state;
    case 'press-in':
      return state.pressed ? state : { ...state, pressed: true };
    case 'press-out':
      return state.pressed ? { ...state, pressed: false } : state;
    case 'reset':
      return state.hovered || state.pressed
        ? INITIAL_PROVIDER_BUTTON_INTERACTION
        : state;
  }
}

export function providerButtonVisualState(
  state: ProviderButtonInteractionState,
): ProviderButtonVisualState {
  if (state.pressed) return 'active';
  return state.hovered ? 'hover' : 'base';
}

export function providerButtonLayerTargets(
  state: ProviderButtonInteractionState,
): ProviderButtonLayerTargets {
  return {
    hoverOpacity: state.hovered ? 1 : 0,
    activeOpacity: state.pressed ? 1 : 0,
  };
}

export const LOGIN_VISUAL_CONTRACT = {
  /** Light is the shipping default; the user's toggle choice is persisted. */
  defaultScheme: 'light' as LoginColorScheme,
  appearanceStorageKey: 'hermes.login.appearance',
  entrance: {
    durationMs: 280,
    translateY: 14,
  },
  card: {
    radius: 24,
    padding: 24,
    shadowRadius: 32,
    shadowOffsetY: 16,
    shadowOpacity: 1,
  },
  monogram: {
    size: 56,
    radius: 18,
    letter: 'H',
  },
  segmented: {
    height: 44,
    radius: 8,
    indicatorRadius: 6,
  },
  input: {
    radius: 8,
    minHeight: 52,
    focusRingWidth: 2,
  },
  button: {
    radius: 8,
    minHeight: 50,
  },
  toggle: {
    size: 44,
    radius: 22,
  },
  providerButton: {
    filterTransition: {
      durationMs: 120,
    },
    focusVisible: {
      width: 2,
      offset: 3,
    },
  },
} as const;
