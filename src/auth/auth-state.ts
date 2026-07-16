import type { SavedConnection } from './credential-contract';

export type AuthMode = 'register' | 'login';

export type AuthState =
  | { status: 'loading' }
  | {
      status: 'provisioning';
      mode: AuthMode;
      setupTokenRequired: boolean;
      busy: boolean;
      error?: string;
    }
  | { status: 'locked'; baseUrl: string; busy: boolean; error?: string }
  | { status: 'authenticated'; connection: SavedConnection };

export type AuthAction =
  | {
      type: 'BOOTSTRAP_EMPTY';
      mode: AuthMode;
      setupTokenRequired?: boolean;
      error?: string;
    }
  | { type: 'BOOTSTRAP_LOCKED'; baseUrl: string; error?: string }
  | {
      type: 'AUTH_MODE_RESOLVED';
      mode: AuthMode;
      setupTokenRequired?: boolean;
    }
  | { type: 'UNLOCK_STARTED' }
  | { type: 'UNLOCK_FAILED'; error: string }
  | { type: 'PROVISION_STARTED' }
  | { type: 'PROVISION_FAILED'; error: string }
  | { type: 'AUTHENTICATED'; connection: SavedConnection }
  | { type: 'LOGGED_OUT' }
  | { type: 'SESSION_EXPIRED'; error: string }
  | {
      type: 'SESSION_REFRESHED';
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      deviceId?: string;
    }
  | { type: 'DEVICE_IDENTIFIED'; deviceId: string }
  | { type: 'LOGOUT_FAILED'; error: string };

export const initialAuthState: AuthState = { status: 'loading' };

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'BOOTSTRAP_EMPTY':
      return {
        status: 'provisioning',
        mode: action.mode,
        setupTokenRequired: action.setupTokenRequired ?? false,
        busy: false,
        ...(action.error ? { error: action.error } : {}),
      };
    case 'LOGGED_OUT':
      return {
        status: 'provisioning',
        mode: 'login',
        setupTokenRequired: false,
        busy: false,
      };
    case 'SESSION_EXPIRED':
      return {
        status: 'provisioning',
        mode: 'login',
        setupTokenRequired: false,
        busy: false,
        error: action.error,
      };
    case 'SESSION_REFRESHED':
      return state.status === 'authenticated'
        ? {
            ...state,
            connection: {
              ...state.connection,
              accessToken: action.accessToken,
              refreshToken: action.refreshToken,
              expiresAt: action.expiresAt,
              ...(action.deviceId ? { deviceId: action.deviceId } : {}),
            },
          }
        : state;
    case 'BOOTSTRAP_LOCKED':
      return {
        status: 'locked',
        baseUrl: action.baseUrl,
        busy: false,
        ...(action.error ? { error: action.error } : {}),
      };
    case 'AUTH_MODE_RESOLVED':
      return state.status === 'provisioning'
        ? {
            ...state,
            mode: action.mode,
            setupTokenRequired: action.setupTokenRequired ?? false,
          }
        : state;
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
        ? {
            status: 'provisioning',
            mode: state.mode,
            setupTokenRequired: state.setupTokenRequired,
            busy: true,
          }
        : state;
    case 'PROVISION_FAILED':
      return state.status === 'provisioning'
        ? {
            status: 'provisioning',
            mode: state.mode,
            setupTokenRequired: state.setupTokenRequired,
            busy: false,
            error: action.error,
          }
        : state;
    case 'LOGOUT_FAILED':
      if (state.status === 'locked' || state.status === 'provisioning') {
        return { ...state, busy: false, error: action.error };
      }
      return state;
    case 'AUTHENTICATED':
      return { status: 'authenticated', connection: action.connection };
    case 'DEVICE_IDENTIFIED':
      return state.status === 'authenticated'
        ? {
            ...state,
            connection: { ...state.connection, deviceId: action.deviceId },
          }
        : state;
  }
}

export interface CredentialReader {
  readBaseUrl(): Promise<string | null>;
  readRefreshToken(): Promise<string | null>;
  readUsername(): Promise<string | null>;
  readAccessToken(): Promise<string | null>;
  readAccessExpiresAt(): Promise<number | null>;
  readDeviceId?(): Promise<string | null>;
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
    const refreshToken = await store.readRefreshToken();
    if (!refreshToken) return { status: 'locked', baseUrl };

    const [username, accessToken, expiresAt, deviceId] = await Promise.all([
      store.readUsername(),
      store.readAccessToken(),
      store.readAccessExpiresAt(),
      store.readDeviceId?.() ?? Promise.resolve(null),
    ]);
    if (!username || !accessToken || expiresAt === null) {
      return { status: 'locked', baseUrl };
    }
    return {
      status: 'authenticated',
      connection: {
        baseUrl,
        username,
        accessToken,
        refreshToken,
        expiresAt,
        ...(deviceId ? { deviceId } : {}),
      },
    };
  } catch {
    return { status: 'locked', baseUrl };
  }
}
