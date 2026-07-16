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
import { assertMobileHandshake } from '../api/hermes-types';
import { HERMES_ORIGIN } from '../config';
import { HermesMobileNotificationApi } from '../notifications/mobile-notifications';
import { AccessTokenController } from './access-token-controller';
import {
  authReducer,
  bootstrapSavedConnection,
  initialAuthState,
  type AuthState,
} from './auth-state';
import {
  CredentialStore,
  provisionConnection as persistVerifiedConnection,
} from './credential-store';
import { getMobileDeviceIdentity } from './device-identity';
import {
  MobileAuthApiClient,
  MobileAuthApiError,
  type MobileAuthSession,
} from './mobile-auth';

interface AuthContextValue {
  state: AuthState;
  client: HermesApiClient | null;
  registrationOpen: boolean;
  authenticate(username: string, password: string): Promise<void>;
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
}

const AuthContext = createContext<AuthContextValue | null>(null);
const credentialStore = new CredentialStore(SecureStore);

const UNLOCK_ERROR = 'Face ID 已取消或凭据不可用，请重试。';
const CONNECTION_ERROR = '无法验证 Hermes 连接，请重试。';
const LOGOUT_ERROR = '无法移除已保存的连接，请重试。';
const SESSION_EXPIRED_ERROR = '登录已过期，请重新登录。';

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const bootstrapStarted = useRef(false);
  const operationInFlight = useRef(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);

  useEffect(() => {
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    let active = true;

    void bootstrapSavedConnection(credentialStore)
      .then(async (result) => {
        if (!active) return;
        if (result.status === 'provisioning') {
          let error: string | undefined;
          try {
            const status = await new MobileAuthApiClient(HERMES_ORIGIN).getStatus();
            setRegistrationOpen(status.registrationOpen);
          } catch {
            error = CONNECTION_ERROR;
          }
          if (active) {
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
            error: UNLOCK_ERROR,
          });
        } else {
          dispatch({ type: 'AUTHENTICATED', connection: result.connection });
        }
      })
      .catch(() => {
        if (active) {
          dispatch({
            type: 'BOOTSTRAP_EMPTY',
            mode: 'login',
            error: CONNECTION_ERROR,
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const persistSession = useCallback(async (
    mobileAuth: MobileAuthApiClient,
    session: MobileAuthSession,
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
        store: credentialStore,
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
    dispatch({ type: 'AUTHENTICATED', connection });
  }, []);

  const authenticate = useCallback(
    async (username: string, password: string) => {
      if (state.status !== 'provisioning' || state.busy || operationInFlight.current) return;
      operationInFlight.current = true;
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
        await persistSession(mobileAuth, session);
      } catch (error) {
        dispatch({
          type: 'PROVISION_FAILED',
          error: authenticationErrorMessage(error),
        });
      } finally {
        operationInFlight.current = false;
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
    if (state.status !== 'provisioning' || state.busy || operationInFlight.current) return;
    operationInFlight.current = true;
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
      await persistSession(mobileAuth, session);
    } catch (error) {
      dispatch({ type: 'PROVISION_FAILED', error: authenticationErrorMessage(error) });
    } finally {
      operationInFlight.current = false;
    }
  }, [persistSession, state]);

  const requestRegistrationCode = useCallback(async (email: string) => {
    const delivery = await new MobileAuthApiClient(HERMES_ORIGIN)
      .requestRegistrationCode(email);
    return delivery.resendAfter;
  }, []);

  const unlock = useCallback(async () => {
    if (state.status !== 'locked' || state.busy || operationInFlight.current) return;
    operationInFlight.current = true;
    dispatch({ type: 'UNLOCK_STARTED' });
    try {
      const result = await bootstrapSavedConnection(credentialStore);
      if (result.status !== 'authenticated') {
        throw new Error('Protected credential unavailable');
      }
      dispatch({ type: 'AUTHENTICATED', connection: result.connection });
    } catch {
      dispatch({ type: 'UNLOCK_FAILED', error: UNLOCK_ERROR });
    } finally {
      operationInFlight.current = false;
    }
  }, [state]);

  const client = useMemo(() => {
    if (state.status !== 'authenticated') return null;
    const { connection } = state;
    const mobileAuth = new MobileAuthApiClient(connection.baseUrl);
    const accessTokens = new AccessTokenController(connection, {
      store: credentialStore,
      async refresh(refreshToken) {
        try {
          return await mobileAuth.refresh(refreshToken);
        } catch (error) {
          if (error instanceof MobileAuthApiError && error.status === 401) {
            await credentialStore.clear().catch(() => undefined);
            dispatch({ type: 'SESSION_EXPIRED', error: SESSION_EXPIRED_ERROR });
          }
          throw error;
        }
      },
      onSessionRefreshed(session) {
        dispatch({
          type: 'SESSION_REFRESHED',
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresAt: session.expiresAt,
          deviceId: session.deviceId,
        });
      },
    });
    return new HermesApiClient(connection.baseUrl, accessTokens);
  }, [state]);

  const rememberDeviceId = useCallback(async (deviceId: string) => {
    const normalized = deviceId.trim();
    if (!normalized || state.status !== 'authenticated') return;
    await credentialStore.saveDeviceId(normalized);
    dispatch({ type: 'DEVICE_IDENTIFIED', deviceId: normalized });
  }, [state.status]);

  const logout = useCallback(async () => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    try {
      if (state.status === 'authenticated') {
        const mobileAuth = new MobileAuthApiClient(state.connection.baseUrl);
        if (client) {
          const notifications = new HermesMobileNotificationApi(client);
          const deviceId = await notifications.resolveCurrentDeviceId(
            state.connection.deviceId,
          ).catch(() => '');
          if (deviceId) {
            await notifications.unregisterApns(deviceId).catch(() => undefined);
          }
        }
        await mobileAuth.logout(
          state.connection.refreshToken,
          state.connection.accessToken,
        ).catch(() => undefined);
      }
      await credentialStore.clear();
      dispatch({ type: 'LOGGED_OUT' });
    } catch {
      dispatch({ type: 'LOGOUT_FAILED', error: LOGOUT_ERROR });
    } finally {
      operationInFlight.current = false;
    }
  }, [client, state]);

  const value = useMemo(
    () => ({
      state,
      client,
      registrationOpen,
      authenticate,
      register,
      requestRegistrationCode,
      rememberDeviceId,
      unlock,
      logout,
    }),
    [
      authenticate,
      client,
      logout,
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
