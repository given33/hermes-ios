const PROVIDER_BUTTON_BASE_BEVEL = {
  top: 'rgba(255, 255, 255, 0.5)',
  right: 'rgba(0, 0, 0, 0.5)',
  bottom: 'rgba(0, 0, 0, 0.5)',
  left: 'rgba(255, 255, 255, 0.5)',
} as const;

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

export const LOGIN_VISUAL_CONTRACT = {
  colors: {
    background: '#170d02',
    accent: '#ffac02',
    foreground: '#ffffff',
    error: '#ff6b6b',
  },
  dither: {
    size: 3,
    opacity: 0.04,
    cells: [
      { x: 1.5, y: 0, width: 1.5, height: 1.5 },
      { x: 0, y: 1.5, width: 1.5, height: 1.5 },
    ],
  },
  glow: {
    opacity: 0.06,
    stop: '55%',
    radiusX: '70.710678%',
    radiusY: '141.421356%',
  },
  entrance: {
    durationMs: 600,
    translateY: 6,
    easing: [0, 0, 0.58, 1],
  },
  cardShadow: {
    spread: 20,
    blurSigma: 30,
    offsetY: 24,
    opacity: 0.6,
  },
  providerButton: {
    base: {
      backgroundColor: '#ffac02',
      textColor: '#170d02',
      bevel: PROVIDER_BUTTON_BASE_BEVEL,
    },
    hover: {
      brightness: 1.08,
      backgroundColor: '#ffba02',
      textColor: '#190e02',
      // CSS brightness is applied after the translucent bevel is composited.
      bevel: {
        top: 'rgb(255, 231, 139)',
        right: 'rgb(138, 93, 1)',
        bottom: 'rgb(138, 93, 1)',
        left: 'rgb(255, 231, 139)',
      },
    },
    active: {
      backgroundColor: '#0053fd',
      textColor: '#e8f2fd',
      bevel: {
        top: 'rgba(0, 0, 0, 0.5)',
        right: 'rgba(255, 255, 255, 0.5)',
        bottom: 'rgba(255, 255, 255, 0.5)',
        left: 'rgba(0, 0, 0, 0.5)',
      },
    },
    filterTransition: {
      durationMs: 120,
      easing: [0, 0, 0.58, 1],
    },
    focusVisible: {
      color: '#ffac02',
      width: 2,
      offset: 3,
    },
    disabledVisualOverride: null,
  },
} as const;
