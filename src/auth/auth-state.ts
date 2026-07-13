import type { SavedConnection } from './credential-contract';

export type AuthState =
  | { status: 'loading' }
  | { status: 'provisioning'; busy: boolean; error?: string }
  | { status: 'locked'; baseUrl: string; busy: boolean; error?: string }
  | { status: 'authenticated'; connection: SavedConnection };

export type AuthAction =
  | { type: 'BOOTSTRAP_EMPTY' }
  | { type: 'BOOTSTRAP_LOCKED'; baseUrl: string; error?: string }
  | { type: 'UNLOCK_STARTED' }
  | { type: 'UNLOCK_FAILED'; error: string }
  | { type: 'PROVISION_STARTED' }
  | { type: 'PROVISION_FAILED'; error: string }
  | { type: 'AUTHENTICATED'; connection: SavedConnection }
  | { type: 'LOGGED_OUT' }
  | { type: 'LOGOUT_FAILED'; error: string };

export const initialAuthState: AuthState = { status: 'loading' };

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'BOOTSTRAP_EMPTY':
    case 'LOGGED_OUT':
      return { status: 'provisioning', busy: false };
    case 'BOOTSTRAP_LOCKED':
      return {
        status: 'locked',
        baseUrl: action.baseUrl,
        busy: false,
        ...(action.error ? { error: action.error } : {}),
      };
    case 'UNLOCK_STARTED':
      return state.status === 'locked'
        ? { status: 'locked', baseUrl: state.baseUrl, busy: true }
        : state;
    case 'UNLOCK_FAILED':
      return state.status === 'locked'
        ? {
            status: 'locked',
            baseUrl: state.baseUrl,
            busy: false,
            error: action.error,
          }
        : state;
    case 'PROVISION_STARTED':
      return state.status === 'provisioning'
        ? { status: 'provisioning', busy: true }
        : state;
    case 'PROVISION_FAILED':
      return state.status === 'provisioning'
        ? { status: 'provisioning', busy: false, error: action.error }
        : state;
    case 'LOGOUT_FAILED':
      if (state.status === 'locked') {
        return { ...state, busy: false, error: action.error };
      }
      if (state.status === 'provisioning') {
        return { ...state, busy: false, error: action.error };
      }
      return state;
    case 'AUTHENTICATED':
      return { status: 'authenticated', connection: action.connection };
  }
}

export interface CredentialReader {
  readBaseUrl(): Promise<string | null>;
  readApiKey(): Promise<string | null>;
}

export type BootstrapResult =
  | { status: 'provisioning' }
  | { status: 'locked'; baseUrl: string }
  | { status: 'authenticated'; connection: SavedConnection };

export async function bootstrapSavedConnection(
  store: CredentialReader,
): Promise<BootstrapResult> {
  const baseUrl = await store.readBaseUrl();
  if (!baseUrl) return { status: 'provisioning' };

  try {
    const apiKey = await store.readApiKey();
    if (!apiKey) return { status: 'locked', baseUrl };
    return { status: 'authenticated', connection: { baseUrl, apiKey } };
  } catch {
    return { status: 'locked', baseUrl };
  }
}
