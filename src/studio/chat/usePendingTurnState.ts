import { useCallback, useReducer, useRef } from 'react';

import type { PendingPhase } from './chat-types';

export interface PendingTurnState {
  phase: PendingPhase;
  phaseStartedAt: number;
  reconnectAttempt: number;
}

export type PendingTurnAction =
  | { attempt: number; type: 'reconnect-attempt' }
  | { phase: PendingPhase; startedAt: number; type: 'phase' }
  | { now: number; type: 'reset' };

export function createPendingTurnState(now = Date.now()): PendingTurnState {
  return { phase: 'connecting', phaseStartedAt: now, reconnectAttempt: 0 };
}

export function pendingTurnReducer(
  state: PendingTurnState,
  action: PendingTurnAction,
): PendingTurnState {
  switch (action.type) {
    case 'phase':
      if (state.phase === action.phase && state.phaseStartedAt === action.startedAt) return state;
      return { ...state, phase: action.phase, phaseStartedAt: action.startedAt };
    case 'reconnect-attempt':
      if (state.reconnectAttempt === action.attempt) return state;
      return { ...state, reconnectAttempt: action.attempt };
    case 'reset':
      return createPendingTurnState(action.now);
  }
}

export function usePendingTurnState() {
  const initialNowRef = useRef(Date.now());
  const [state, dispatch] = useReducer(
    pendingTurnReducer,
    initialNowRef.current,
    createPendingTurnState,
  );
  const phaseRef = useRef<PendingPhase>('connecting');
  const phaseStartedAtRef = useRef(initialNowRef.current);
  const firstTokenAtRef = useRef(0);
  const activeRef = useRef(false);

  const updatePhase = useCallback((phase: PendingPhase, startedAt = Date.now()) => {
    phaseRef.current = phase;
    phaseStartedAtRef.current = startedAt;
    dispatch({ phase, startedAt, type: 'phase' });
  }, []);

  const setReconnectAttempt = useCallback((attempt: number) => {
    dispatch({ attempt: Math.max(0, Math.floor(attempt)), type: 'reconnect-attempt' });
  }, []);

  const reset = useCallback((now = Date.now()) => {
    activeRef.current = false;
    firstTokenAtRef.current = 0;
    phaseRef.current = 'connecting';
    phaseStartedAtRef.current = now;
    dispatch({ now, type: 'reset' });
  }, []);

  return {
    activeRef,
    firstTokenAtRef,
    phaseRef,
    phaseStartedAtRef,
    reset,
    setReconnectAttempt,
    state,
    updatePhase,
  };
}
