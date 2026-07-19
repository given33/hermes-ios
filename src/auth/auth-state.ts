import type { SavedConnection } from './credential-contract';

export type AuthMode = 'register' | 'login';
export const MAX_FACE_ID_ATTEMPTS = 5;

export type AuthState =
  | { status: 'loading' }
  | {
      status: 'provisioning';
      mode: AuthMode;
      setupTokenRequired: boolean;
      busy: boolean;
      error?: string;
    }
  | {
      status: 'locked';
      baseUrl: string;
      busy: boolean;
      failedAttempts: number;
      error?: string;
    }
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
  | {
      type: 'UNLOCK_FAILED';
      error: string;
      fallbackError?: string;
      countAttempt?: boolean;
      fallbackImmediately?: boolean;
    }
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
        failedAttempts: 0,
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
        ? {
            status: 'locked',
            baseUrl: state.baseUrl,
            busy: true,
            failedAttempts: state.failedAttempts,
          }
        : state;
    case 'UNLOCK_FAILED':
      if (state.status !== 'locked') return state;
      if (
        action.fallbackImmediately === true
        || (
          action.countAttempt !== false
          && state.failedAttempts + 1 >= MAX_FACE_ID_ATTEMPTS
        )
      ) {
        return {
          status: 'provisioning',
          mode: 'login',
          setupTokenRequired: false,
          busy: false,
          error: action.fallbackError ?? action.error,
        };
      }
      return {
        ...state,
        busy: false,
        failedAttempts: state.failedAttempts + (action.countAttempt === false ? 0 : 1),
        error: action.error,
      };
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
      // Logout and account deletion invalidate the active client generation
      // before remote cleanup starts. A failed cleanup must still produce a
      // fresh authenticated state so React rebuilds the token controller for
      // the current generation instead of retaining the invalidated client.
      return state.status === 'authenticated' ? { ...state } : state;
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
  | {
      status: 'locked';
      baseUrl: string;
      cancelled?: boolean;
      failure?: ProtectedCredentialFailure;
    }
  | { status: 'authenticated'; connection: SavedConnection };

export type ProtectedCredentialFailure =
  | 'authentication_failed'
  | 'cancelled'
  | 'unavailable';

export async function inspectSavedConnection(
  store: Pick<CredentialReader, 'readBaseUrl'>,
): Promise<Extract<BootstrapResult, { status: 'provisioning' | 'locked' }>> {
  const baseUrl = await store.readBaseUrl();
  return baseUrl ? { status: 'locked', baseUrl } : { status: 'provisioning' };
}

export async function bootstrapSavedConnection(
  store: CredentialReader,
): Promise<BootstrapResult> {
  const baseUrl = await store.readBaseUrl();
  if (!baseUrl) return { status: 'provisioning' };

  try {
    const refreshToken = await store.readRefreshToken();
    if (!refreshToken) {
      return { status: 'locked', baseUrl, failure: 'unavailable' };
    }

    const [username, accessToken, expiresAt, deviceId] = await Promise.all([
      store.readUsername(),
      store.readAccessToken(),
      store.readAccessExpiresAt(),
      store.readDeviceId?.() ?? Promise.resolve(null),
    ]);
    if (!username || !accessToken || expiresAt === null) {
      return { status: 'locked', baseUrl, failure: 'unavailable' };
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
  } catch (error) {
    const failure = classifyProtectedCredentialError(error);
    return {
      status: 'locked',
      baseUrl,
      failure,
      ...(failure === 'cancelled' ? { cancelled: true } : {}),
    };
  }
}

export function classifyProtectedCredentialError(
  error: unknown,
): ProtectedCredentialFailure {
  const message = error instanceof Error
    ? `${error.name} ${error.message}`
    : String(error || '');
  if (
    /cancel|canceled|cancelled|user.?fallback|errsecusercanceled|app.?cancel|system.?cancel|-128/i
      .test(message)
  ) {
    return 'cancelled';
  }
  if (
    /authentication.?failed|biometr(?:y|ic).?failed|errsecauthfailed|laerrorauthenticationfailed/i
      .test(message)
  ) {
    return 'authentication_failed';
  }
  return 'unavailable';
}
