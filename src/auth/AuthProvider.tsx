import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type PropsWithChildren,
} from 'react';

import { HermesApiClient } from '../api/HermesApiClient';
import { assertMobileHandshake } from '../api/hermes-types';
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

interface AuthContextValue {
  state: AuthState;
  client: HermesApiClient | null;
  provision(baseUrl: string, apiKey: string): Promise<void>;
  unlock(): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const credentialStore = new CredentialStore(SecureStore);

const UNLOCK_ERROR = 'Face ID 已取消或凭据不可用，请重试。';
const CONNECTION_ERROR = '无法验证 Hermes 连接，请重试。';
const LOGOUT_ERROR = '无法移除已保存的连接，请重试。';

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const bootstrapStarted = useRef(false);
  const operationInFlight = useRef(false);

  useEffect(() => {
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    let active = true;

    void bootstrapSavedConnection(credentialStore)
      .then((result) => {
        if (!active) return;
        if (result.status === 'provisioning') {
          dispatch({ type: 'BOOTSTRAP_EMPTY' });
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
        if (active) dispatch({ type: 'BOOTSTRAP_EMPTY' });
      });

    return () => {
      active = false;
    };
  }, []);

  const provision = useCallback(
    async (baseUrl: string, apiKey: string) => {
      if (state.status !== 'provisioning' || state.busy || operationInFlight.current) return;
      operationInFlight.current = true;
      dispatch({ type: 'PROVISION_STARTED' });
      try {
        const connection = await persistVerifiedConnection(
          { baseUrl, apiKey },
          {
            store: credentialStore,
            async verify(candidate) {
              const client = new HermesApiClient(candidate.baseUrl, candidate.apiKey);
              const response = await client.request<unknown>('/api/mobile/v1/handshake');
              assertMobileHandshake(response);
            },
          },
        );
        dispatch({ type: 'AUTHENTICATED', connection });
      } catch {
        dispatch({ type: 'PROVISION_FAILED', error: CONNECTION_ERROR });
      } finally {
        operationInFlight.current = false;
      }
    },
    [state],
  );

  const unlock = useCallback(async () => {
    if (state.status !== 'locked' || state.busy || operationInFlight.current) return;
    operationInFlight.current = true;
    dispatch({ type: 'UNLOCK_STARTED' });
    try {
      const apiKey = await credentialStore.readApiKey();
      if (!apiKey) throw new Error('Protected credential unavailable');
      dispatch({
        type: 'AUTHENTICATED',
        connection: { baseUrl: state.baseUrl, apiKey },
      });
    } catch {
      dispatch({ type: 'UNLOCK_FAILED', error: UNLOCK_ERROR });
    } finally {
      operationInFlight.current = false;
    }
  }, [state]);

  const logout = useCallback(async () => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    try {
      await credentialStore.clear();
      dispatch({ type: 'LOGGED_OUT' });
    } catch {
      dispatch({ type: 'LOGOUT_FAILED', error: LOGOUT_ERROR });
    } finally {
      operationInFlight.current = false;
    }
  }, []);

  const client = useMemo(
    () =>
      state.status === 'authenticated'
        ? new HermesApiClient(state.connection.baseUrl, state.connection.apiKey)
        : null,
    [state],
  );
  const value = useMemo(
    () => ({ state, client, provision, unlock, logout }),
    [client, logout, provision, state, unlock],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
