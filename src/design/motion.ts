import { useMemo } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import { IOS_MOTION } from './ios-motion';

/**
 * Central motion tokens for product surfaces, per the Hermes Studio parity
 * contract (docs/architecture/hermes-studio-mobile-parity.md): control
 * feedback in the 150-250 ms band, page/section transitions in the
 * 160-260 ms band, always interruptible, always Reduce Motion aware.
 *
 * Durations that already satisfy the contract are re-exported from
 * IOS_MOTION so the app keeps one source of truth; `transition` is the
 * contract band's section-transition value for surfaces that previously
 * popped with no animation at all. The 300-360 ms navigation/drawer timings
 * in IOS_MOTION are deliberately not re-banded here — they are the native
 * stack's timings, pinned by the shell source contracts, and re-timing them
 * is the shell owner's decision.
 */
export const MOTION = {
  duration: {
    /** Pressed-state feedback on rows and buttons (control band). */
    press: IOS_MOTION.duration.press,
    /** Toggles, selection marks, disclosure chevrons (control band). */
    control: IOS_MOTION.duration.control,
    /** In-page section/list/sheet transitions (transition band). */
    transition: 240,
    /**
     * Ambient loading pulse period. Not a transition, so it sits outside the
     * 160-260 ms band on purpose; under Reduce Motion it must not run at all
     * (gate the loop, do not just shorten it).
     */
    skeleton: 1_100,
  },
  easing: IOS_MOTION.curve,
  fade: {
    /** Short non-spatial transition retained when Reduce Motion is enabled. */
    reduced: 120,
    standard: 180,
  },
  reduceMotion: {
    allowLargeScale: false,
    allowLoop: false,
    spatialDuration: 0,
  },
  spring: IOS_MOTION.spring,
} as const;

export interface MotionController {
  /** Mirrors the OS Reduce Motion switch (reanimated keeps it current). */
  reduceMotion: boolean;
  /**
   * Duration for timing-based animations: the base value normally, 0 under
   * Reduce Motion so the property snaps to its target instead of tweening.
   * withTiming(…, { duration: 0 }) still lands the exact final value and
   * remains interruptible, which a conditional non-animated branch is not.
   */
  duration(baseMs: number): number;
  /**
   * Gate for spatial entering/exiting/layout animation props. Spatial motion
   * is removed when Reduce Motion is enabled.
   */
  animate<T>(animation: T): T | undefined;
  /** Select a short fade in place of a spatial transition under Reduce Motion. */
  fade<T>(animation: T, reducedFade: T): T;
  /** Duration for opacity-only transitions, retaining a short accessible fade. */
  fadeDuration(baseMs?: number): number;
}

export function useMotion(): MotionController {
  const reduceMotion = useReducedMotion();
  return useMemo<MotionController>(() => ({
    reduceMotion,
    duration: (baseMs: number) => (
      reduceMotion ? MOTION.reduceMotion.spatialDuration : baseMs
    ),
    animate: <T,>(animation: T) => (reduceMotion ? undefined : animation),
    fade: <T,>(animation: T, reducedFade: T) => (
      reduceMotion ? reducedFade : animation
    ),
    fadeDuration: (baseMs = MOTION.fade.standard) => (
      reduceMotion ? MOTION.fade.reduced : baseMs
    ),
  }), [reduceMotion]);
}
