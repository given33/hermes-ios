import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
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

import { HermesApiClient } from '../api/HermesApiClient';
import { AsyncDeadlineError, withDeadline } from '../api/async-deadline';
import { assertMobileHandshake } from '../api/hermes-types';
import { HERMES_ORIGIN } from '../config';
import { IOSIntelligenceApi } from '../context/IOSIntelligenceApi';
import { HermesIOSContext, hasNativeIOSContext } from '../../modules/hermes-ios-context';
import { AccessTokenController } from './access-token-controller';
import {
  AuthLifecycleCoordinator,
  CredentialMutationQueue,
  isCurrentAuthSession,
} from './auth-lifecycle';
import {
  authReducer,
  bootstrapSavedConnection,
  inspectSavedConnection,
  initialAuthState,
  type AuthState,
} from './auth-state';
import {
  CredentialStore,
  provisionConnection as persistVerifiedConnection,
} from './credential-store';
import type { RememberedLogin, SavedConnection } from './credential-contract';
import { getMobileDeviceIdentity } from './device-identity';
import {
  MobileAuthApiClient,
  MobileAuthApiError,
  type MobileAuthSession,
} from './mobile-auth';

interface AuthContextValue {
  state: AuthState;
  client: HermesApiClient | null;
  rememberedLogin: RememberedLogin;
  registrationOpen: boolean;
  authenticate(username: string, password: string, rememberLogin: boolean): Promise<void>;
  register(
    email: string,
    verificationCode: string,
    username: string,
    password: string,
  ): Promise<void>;
  requestRegistrationCode(email: string): Promise<number>;
  rememberDeviceId(deviceId: string): Promise<void>;
  unlock(): Promise<void>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const credentialStore = new CredentialStore(SecureStore);
const credentialMutations = new CredentialMutationQueue();
const APNS_LOGOUT_DEADLINE_MS = 2_500;
const REMOTE_LOGOUT_DEADLINE_MS = 8_000;
// Face ID / SecureStore can take several seconds on cold biometrics. A short
// wall-clock race makes unlock look like a crash; keep it generous and map the
// deadline to the same unavailable path as a cancelled biometric.
const FACE_ID_UNLOCK_DEADLINE_MS = 45_000;

const UNLOCK_ERROR = 'Face ID 已取消或凭据不可用，请重试。';
const UNLOCK_CANCELLED_ERROR = 'Face ID 已取消，可以再次尝试。';
const UNLOCK_UNAVAILABLE_ERROR = 'Face ID 或已保存的登录凭据不可用，请使用账号密码登录。';
const CONNECTION_ERROR = '无法验证 Hermes 连接，请重试。';
const LOGOUT_ERROR = '无法移除已保存的连接，请重试。';
const SESSION_EXPIRED_ERROR = '登录已过期，请重新登录。';
const FACE_ID_PASSWORD_FALLBACK = 'Face ID 已连续失败 5 次，请输入账号密码。';
const EMPTY_REMEMBERED_LOGIN: RememberedLogin = {
  enabled: false,
  password: '',
  username: '',
};

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const authLifecycle = useRef(new AuthLifecycleCoordinator());
  const authenticatedConnection = useRef<SavedConnection | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [rememberedLogin, setRememberedLogin] = useState<RememberedLogin>(
    EMPTY_REMEMBERED_LOGIN,
  );
  authenticatedConnection.current = state.status === 'authenticated'
    ? state.connection
    : null;

  useEffect(() => {
    const bootstrapGeneration = authLifecycle.current.mount();
    let active = true;

    void Promise.all([
      // Preference only on cold start so the Face ID lock screen never
      // unlocks the remembered password before the user authenticates.
      credentialStore.readRememberedLoginPreference().catch(() => EMPTY_REMEMBERED_LOGIN),
      inspectSavedConnection(credentialStore),
    ])
      .then(async ([savedLogin, result]) => {
        if (!active || !authLifecycle.current.isCurrent(bootstrapGeneration)) return;
        setRememberedLogin(savedLogin);
        if (result.status === 'provisioning') {
          let error: string | undefined;
          try {
            const status = await new MobileAuthApiClient(HERMES_ORIGIN).getStatus();
            setRegistrationOpen(status.registrationOpen);
          } catch {
            error = CONNECTION_ERROR;
          }
          // Load the biometric-protected password only for the login form.
          if (active && authLifecycle.current.isCurrent(bootstrapGeneration) && savedLogin.enabled) {
            try {
              const fullLogin = await credentialStore.readRememberedLogin();
              if (active && authLifecycle.current.isCurrent(bootstrapGeneration)) {
                setRememberedLogin(fullLogin);
              }
            } catch {
              // Leave preference-only state; user can type the password.
            }
          }
          if (active && authLifecycle.current.isCurrent(bootstrapGeneration)) {
            dispatch({
              type: 'BOOTSTRAP_EMPTY',
              mode: 'login',
              setupTokenRequired: false,
              error,
            });
          }
        } else if (result.status === 'locked') {
          dispatch({
            type: 'BOOTSTRAP_LOCKED',
            baseUrl: result.baseUrl,
          });
        }
      })
      .catch(() => {
        if (active && authLifecycle.current.isCurrent(bootstrapGeneration)) {
          dispatch({
            type: 'BOOTSTRAP_EMPTY',
            mode: 'login',
            error: CONNECTION_ERROR,
          });
        }
      });

    return () => {
      active = false;
      authLifecycle.current.unmount();
    };
  }, []);

  const persistSession = useCallback(async (
    mobileAuth: MobileAuthApiClient,
    session: MobileAuthSession,
    operationGeneration: number,
  ) => {
    const connection = await persistVerifiedConnection(
      {
        baseUrl: mobileAuth.baseUrl,
        username: session.account.username,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        deviceId: session.deviceId,
      },
      {
        store: {
          save(candidate) {
            return credentialMutations.run(async () => {
              if (!authLifecycle.current.isCurrent(operationGeneration)) {
                throw new Error('Stale Hermes authentication operation');
              }
              await credentialStore.save(candidate);
              if (!authLifecycle.current.isCurrent(operationGeneration)) {
                await credentialStore.clear();
                throw new Error('Stale Hermes authentication operation');
              }
            });
          },
        },
        async verify(candidate) {
          const client = new HermesApiClient(
            candidate.baseUrl,
            candidate.accessToken,
          );
          const response = await client.request<unknown>('/api/mobile/v1/handshake');
          assertMobileHandshake(response);
        },
      },
    );
    if (!authLifecycle.current.isCurrent(operationGeneration)) {
      throw new Error('Stale Hermes authentication operation');
    }
    if (hasNativeIOSContext) {
      await HermesIOSContext.activateOwnerScope(
        `${connection.baseUrl}|${connection.username}`,
      );
    }
    if (!authLifecycle.current.isCurrent(operationGeneration)) {
      throw new Error('Stale Hermes authentication operation');
    }
    return connection;
  }, []);

  const authenticate = useCallback(
    async (username: string, password: string, rememberLogin: boolean) => {
      if (state.status !== 'provisioning' || state.busy) return;
      const operationGeneration = authLifecycle.current.beginOperation();
      if (operationGeneration === null) return;
      dispatch({ type: 'PROVISION_STARTED' });
      try {
        const mobileAuth = new MobileAuthApiClient(HERMES_ORIGIN);
        const device = await getMobileDeviceIdentity(SecureStore, {
          appVersion: Constants.expoConfig?.version,
          deviceName: Device.deviceName,
          modelId: Device.modelId,
          modelName: Device.modelName,
          osName: Device.osName,
          osVersion: Device.osVersion,
        });
        const session = await mobileAuth.login(username, password, device);
        const connection = await persistSession(
          mobileAuth,
          session,
          operationGeneration,
        );
        await credentialMutations.run(async () => {
          if (!authLifecycle.current.isCurrent(operationGeneration)) return;
          await credentialStore.saveRememberedLogin(username, password, rememberLogin);
        });
        if (!authLifecycle.current.isCurrent(operationGeneration)) return;
        setRememberedLogin({
          enabled: rememberLogin,
          password: rememberLogin ? password : '',
          username: username.trim(),
        });
        dispatch({ type: 'AUTHENTICATED', connection });
      } catch (error) {
        if (authLifecycle.current.isCurrent(operationGeneration)) {
          dispatch({
            type: 'PROVISION_FAILED',
            error: authenticationErrorMessage(error),
          });
        }
      } finally {
        authLifecycle.current.finishOperation(operationGeneration);
      }
    },
    [persistSession, state],
  );

  const register = useCallback(async (
    email: string,
    verificationCode: string,
    username: string,
    password: string,
  ) => {
    if (state.status !== 'provisioning' || state.busy) return;
    const operationGeneration = authLifecycle.current.beginOperation();
    if (operationGeneration === null) return;
    dispatch({ type: 'PROVISION_STARTED' });
    try {
      const mobileAuth = new MobileAuthApiClient(HERMES_ORIGIN);
      const status = await mobileAuth.getStatus();
      setRegistrationOpen(status.registrationOpen);
      if (!status.registrationOpen) {
        throw new MobileAuthApiError(403, 'Owner registration is closed');
      }
      const device = await getMobileDeviceIdentity(SecureStore, {
        appVersion: Constants.expoConfig?.version,
        deviceName: Device.deviceName,
        modelId: Device.modelId,
        modelName: Device.modelName,
        osName: Device.osName,
        osVersion: Device.osVersion,
      });
      const session = await mobileAuth.register(
        email,
        verificationCode,
        username,
        password,
        device,
      );
      const connection = await persistSession(
        mobileAuth,
        session,
        operationGeneration,
      );
      if (authLifecycle.current.isCurrent(operationGeneration)) {
        dispatch({ type: 'AUTHENTICATED', connection });
      }
    } catch (error) {
      if (authLifecycle.current.isCurrent(operationGeneration)) {
        dispatch({ type: 'PROVISION_FAILED', error: authenticationErrorMessage(error) });
      }
    } finally {
      authLifecycle.current.finishOperation(operationGeneration);
    }
  }, [persistSession, state]);

  const requestRegistrationCode = useCallback(async (email: string) => {
    const delivery = await new MobileAuthApiClient(HERMES_ORIGIN)
      .requestRegistrationCode(email);
    return delivery.resendAfter;
  }, []);

  const unlock = useCallback(async () => {
    if (state.status !== 'locked' || state.busy) return;
    const operationGeneration = authLifecycle.current.beginOperation();
    if (operationGeneration === null) return;
    dispatch({ type: 'UNLOCK_STARTED' });
    try {
      const result = await withDeadline(
        bootstrapSavedConnection(credentialStore),
        FACE_ID_UNLOCK_DEADLINE_MS,
        'Face ID unlock timed out',
      );
      if (!authLifecycle.current.isCurrent(operationGeneration)) return;
      if (result.status === 'locked') {
        const cancelled = result.failure === 'cancelled' || result.cancelled === true;
        const unavailable = result.failure === 'unavailable';
        dispatch({
          type: 'UNLOCK_FAILED',
          error: cancelled
            ? UNLOCK_CANCELLED_ERROR
            : unavailable
              ? UNLOCK_UNAVAILABLE_ERROR
              : UNLOCK_ERROR,
          fallbackError: FACE_ID_PASSWORD_FALLBACK,
          countAttempt: !cancelled && !unavailable,
          fallbackImmediately: unavailable,
        });
        return;
      }
      if (result.status !== 'authenticated') {
        dispatch({
          type: 'UNLOCK_FAILED',
          error: UNLOCK_UNAVAILABLE_ERROR,
          fallbackError: UNLOCK_UNAVAILABLE_ERROR,
          countAttempt: false,
          fallbackImmediately: true,
        });
        return;
      }
      if (hasNativeIOSContext) {
        await HermesIOSContext.activateOwnerScope(
          `${result.connection.baseUrl}|${result.connection.username}`,
        );
      }
      if (authLifecycle.current.isCurrent(operationGeneration)) {
        dispatch({ type: 'AUTHENTICATED', connection: result.connection });
      }
    } catch (error) {
      if (authLifecycle.current.isCurrent(operationGeneration)) {
        const timedOut = error instanceof AsyncDeadlineError;
        dispatch({
          type: 'UNLOCK_FAILED',
          error: timedOut ? UNLOCK_UNAVAILABLE_ERROR : UNLOCK_ERROR,
          fallbackError: FACE_ID_PASSWORD_FALLBACK,
          countAttempt: !timedOut,
          fallbackImmediately: timedOut,
        });
      }
    } finally {
      authLifecycle.current.finishOperation(operationGeneration);
    }
  }, [state]);

  const sessionConnection = state.status === 'authenticated'
    ? state.connection
    : null;
  const sessionGeneration = sessionConnection
    ? authLifecycle.current.currentGeneration()
    : 0;
  const clientSessionKey = sessionConnection
    ? `${sessionGeneration}\u0000${sessionConnection.baseUrl}\u0000${sessionConnection.username}`
    : '';
  const clientSession = useMemo(() => {
    if (!sessionConnection) return null;
    const connection = sessionConnection;
    const connectionGeneration = sessionGeneration;
    const isCurrentConnection = () => (
      authLifecycle.current.isCurrent(connectionGeneration)
      && isCurrentAuthSession(
        authenticatedConnection.current,
        connection,
        authLifecycle.current.currentGeneration(),
        connectionGeneration,
      )
    );
    const mobileAuth = new MobileAuthApiClient(connection.baseUrl);
    const accessTokens = new AccessTokenController(connection, {
      store: {
        saveSessionTokens(accessToken, refreshToken, expiresAt) {
          return credentialMutations.run(async () => {
            if (!isCurrentConnection()) return;
            await credentialStore.saveSessionTokens(accessToken, refreshToken, expiresAt);
          });
        },
      },
      async refresh(refreshToken) {
        try {
          return await mobileAuth.refresh(refreshToken);
        } catch (error) {
          if (
            error instanceof MobileAuthApiError
            && error.status === 401
            && isCurrentConnection()
          ) {
            const expirationGeneration = authLifecycle.current.invalidate();
            await credentialMutations
              .run(() => credentialStore.clearSession())
              .catch(() => undefined);
            if (
              authLifecycle.current.isCurrent(expirationGeneration)
              && isCurrentAuthSession(
                authenticatedConnection.current,
                connection,
                authLifecycle.current.currentGeneration(),
                expirationGeneration,
              )
            ) {
              dispatch({ type: 'SESSION_EXPIRED', error: SESSION_EXPIRED_ERROR });
            }
          }
          throw error;
        }
      },
      onSessionRefreshed(session) {
        if (!isCurrentConnection()) return;
        dispatch({
          type: 'SESSION_REFRESHED',
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresAt: session.expiresAt,
          deviceId: session.deviceId,
        });
      },
    });
    return {
      accessTokens,
      client: new HermesApiClient(connection.baseUrl, accessTokens),
    };
    // Token/device reducer updates keep the same controller. It already owns
    // the latest rotated token pair and replacing it mid-request races 401 retry.
  }, [clientSessionKey]);

  const retainedClientSession = useRef(clientSession);
  useEffect(() => {
    retainedClientSession.current = clientSession;
    return () => {
      if (retainedClientSession.current === clientSession) {
        retainedClientSession.current = null;
      }
      queueMicrotask(() => {
        if (retainedClientSession.current !== clientSession) {
          void clientSession?.accessTokens.dispose();
        }
      });
    };
  }, [clientSession]);

  const client = clientSession?.client ?? null;

  const rememberDeviceId = useCallback(async (deviceId: string) => {
    const normalized = deviceId.trim();
    if (!normalized || state.status !== 'authenticated') return;
    const connection = state.connection;
    const connectionGeneration = authLifecycle.current.currentGeneration();
    await credentialMutations.run(async () => {
      if (
        !authLifecycle.current.isCurrent(connectionGeneration)
        || !isCurrentAuthSession(
          authenticatedConnection.current,
          connection,
          authLifecycle.current.currentGeneration(),
          connectionGeneration,
        )
      ) return;
      await credentialStore.saveDeviceId(normalized);
    });
    if (
      authLifecycle.current.isCurrent(connectionGeneration)
      && isCurrentAuthSession(
        authenticatedConnection.current,
        connection,
        authLifecycle.current.currentGeneration(),
        connectionGeneration,
      )
    ) {
      dispatch({ type: 'DEVICE_IDENTIFIED', deviceId: normalized });
    }
  }, [state]);

  const logout = useCallback(async () => {
    const operationGeneration = authLifecycle.current.beginOperation();
    if (operationGeneration === null) return;
    try {
      if (state.status === 'authenticated') {
        const connection = state.connection;
        const logoutClient = new HermesApiClient(
          connection.baseUrl,
          connection.accessToken,
        );
        await unregisterApnsBeforeLogout(logoutClient, connection.deviceId);
        const remoteCleanup = new MobileAuthApiClient(connection.baseUrl).logout(
          connection.refreshToken,
          connection.accessToken,
        );
        void withDeadline(
          remoteCleanup,
          REMOTE_LOGOUT_DEADLINE_MS,
          'Hermes remote logout timed out',
        ).catch(() => undefined);
      }
      await credentialMutations.run(() => credentialStore.clearSession());
      if (authLifecycle.current.isCurrent(operationGeneration)) {
        if (!rememberedLogin.enabled) setRememberedLogin(EMPTY_REMEMBERED_LOGIN);
        dispatch({ type: 'LOGGED_OUT' });
      }
    } catch {
      if (authLifecycle.current.isCurrent(operationGeneration)) {
        dispatch({ type: 'LOGOUT_FAILED', error: LOGOUT_ERROR });
      }
      // Surface the failure to AccountPage / callers — authenticated LOGOUT_FAILED
      // intentionally keeps session identity for token-controller rebuild and
      // does not carry an error field on that state branch.
      throw new Error(LOGOUT_ERROR);
    } finally {
      authLifecycle.current.finishOperation(operationGeneration);
    }
  }, [rememberedLogin.enabled, state]);

  const deleteAccount = useCallback(async () => {
    if (state.status !== 'authenticated' || !client) return;
    const operationGeneration = authLifecycle.current.beginOperation();
    if (operationGeneration === null) return;
    let serverDeleted = false;
    try {
      const ownerScope = `${state.connection.baseUrl}|${state.connection.username}`;
      await new IOSIntelligenceApi(client).deleteAccount(ownerScope);
      serverDeleted = true;
      if (hasNativeIOSContext) {
        await HermesIOSContext.deleteOwnerScope(ownerScope);
      }
      if (authLifecycle.current.isCurrent(operationGeneration)) {
        await credentialMutations.run(() => credentialStore.clear());
        setRememberedLogin(EMPTY_REMEMBERED_LOGIN);
        dispatch({ type: 'LOGGED_OUT' });
      }
    } catch {
      if (serverDeleted && authLifecycle.current.isCurrent(operationGeneration)) {
        await credentialMutations
          .run(() => credentialStore.clear())
          .catch(() => undefined);
        setRememberedLogin(EMPTY_REMEMBERED_LOGIN);
        dispatch({ type: 'LOGGED_OUT' });
        return;
      }
      if (authLifecycle.current.isCurrent(operationGeneration)) {
        dispatch({ type: 'LOGOUT_FAILED', error: LOGOUT_ERROR });
      }
      throw new Error(LOGOUT_ERROR);
    } finally {
      authLifecycle.current.finishOperation(operationGeneration);
    }
  }, [client, state]);

  const value = useMemo(
    () => ({
      state,
      client,
      rememberedLogin,
      registrationOpen,
      authenticate,
      register,
      requestRegistrationCode,
      rememberDeviceId,
      unlock,
      logout,
      deleteAccount,
    }),
    [
      authenticate,
      client,
      deleteAccount,
      logout,
      rememberedLogin,
      register,
      registrationOpen,
      rememberDeviceId,
      requestRegistrationCode,
      state,
      unlock,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

async function unregisterApnsBeforeLogout(
  client: HermesApiClient,
  rawDeviceId = '',
): Promise<void> {
  const deviceId = rawDeviceId.trim();
  if (!deviceId) return;
  const abortController = new AbortController();
  try {
    await withDeadline(
      client.request(
        `/api/mobile/v1/devices/${encodeURIComponent(deviceId)}/apns`,
        { method: 'DELETE', signal: abortController.signal },
      ),
      APNS_LOGOUT_DEADLINE_MS,
      'Hermes APNs logout timed out',
    );
  } catch {
    // Local logout must complete even when the device or server is offline.
  } finally {
    abortController.abort();
  }
}

function authenticationErrorMessage(error: unknown): string {
  if (error instanceof MobileAuthApiError) {
    if (error.status === 401) return '用户名或密码不正确。';
    if (error.status === 403) return '验证码错误、已过期或注册暂未开放。';
    if (error.status === 409) return '服务器已有所有者账号，请登录。';
    if (error.status === 422) return '邮箱、验证码、账号或密码格式不符合要求。';
    if (error.status === 429) return '尝试次数过多，请稍后重试。';
    if (error.status === 502 || error.status === 503) return 'QQ 邮箱验证码服务尚未配置。';
  }
  return CONNECTION_ERROR;
}
