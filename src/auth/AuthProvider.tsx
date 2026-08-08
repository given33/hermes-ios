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
import { Platform } from 'react-native';

import { HermesApiClient, HermesApiError } from '../api/HermesApiClient';
import { withDeadline } from '../api/async-deadline';
import { assertMobileHandshake } from '../api/hermes-types';
import { sharedConversationLocalStore } from '../api/hermes-api-registry';
import { purgeLocalAccountData } from '../api/local-account-purge';
import { HERMES_ORIGIN } from '../config';
import { IOSIntelligenceApi } from '../context/IOSIntelligenceApi';
import { HermesIOSContext, hasNativeIOSContext } from '../../modules/hermes-ios-context';
import { AccessTokenController } from './access-token-controller';
import {
  accountOwnerScope,
  accountGenerationFromOwnerScope,
  LEGACY_ACCOUNT_GENERATION,
  legacyAccountOwnerScope,
} from './account-identity';
import {
  AuthLifecycleCoordinator,
  CredentialMutationQueue,
  isCurrentAuthSession,
  runOptionalAuthEffect,
} from './auth-lifecycle';
import {
  authReducer,
  bootstrapSavedConnection,
  initialAuthState,
  inspectSavedConnection,
  MAX_FACE_ID_ATTEMPTS,
  type AuthState,
} from './auth-state';
import {
  CredentialStore,
  provisionConnection as persistVerifiedConnection,
  type SecureStoreAdapter,
} from './credential-store';
import type { RememberedLogin, SavedConnection } from './credential-contract';
import { getMobileDeviceIdentity } from './device-identity';
import { LocalAccountCleanupSaga } from './local-account-cleanup-saga';
import {
  MobileAuthApiClient,
  MobileAuthApiError,
  type MobileAuthSession,
} from './mobile-auth';
import { clearExpoAccountNotifications } from '../notifications/expo-notification-runtime';
import {
  savedSessionFailureInvalidatesCredentials,
  savedSessionFailureIsCleartextBaseUrl,
} from './session-restore-policy';

interface AuthContextValue {
  state: AuthState;
  client: HermesApiClient | null;
  rememberedLogin: RememberedLogin;
  registrationOpen: boolean;
  authenticate(username: string, password: string, rememberLogin: boolean): Promise<void>;
  unlock(): Promise<void>;
  register(
    email: string,
    verificationCode: string,
    username: string,
    password: string,
  ): Promise<void>;
  requestRegistrationCode(email: string): Promise<number>;
  revealRememberedPassword(): Promise<string | null>;
  rememberDeviceId(deviceId: string): Promise<void>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const volatileWebSession = new Map<string, string>();
const webSessionStore: SecureStoreAdapter = {
  async getItemAsync(key) {
    return volatileWebSession.get(key) ?? null;
  },
  async setItemAsync(key, value) {
    volatileWebSession.set(key, value);
  },
  async deleteItemAsync(key) {
    volatileWebSession.delete(key);
  },
};
const authStore: SecureStoreAdapter = Platform.OS === 'web' ? webSessionStore : SecureStore;
const credentialStore = new CredentialStore(authStore);
const credentialMutations = new CredentialMutationQueue();
const localAccountCleanupSaga = new LocalAccountCleanupSaga();
const APNS_LOGOUT_DEADLINE_MS = 2_500;
const NOTIFICATION_CLEANUP_DEADLINE_MS = 2_500;
const REMOTE_LOGOUT_DEADLINE_MS = 8_000;
const SAVED_SESSION_RETRY_DELAY_MS = 5_000;
const CONNECTION_ERROR = '无法验证 Hermes 连接，请重试。';
const LOGOUT_ERROR = '无法移除已保存的连接，请重试。';
const SESSION_EXPIRED_ERROR = '登录已过期，请重新登录。';
const CLEARTEXT_BASEURL_ERROR = '保存的服务器地址使用了不安全的 http://，已被安全策略拒绝。'
  + '请改用 https:// 服务器地址重新登录；如确需 http（仅限本地开发），'
  + '请使用设置了 EXPO_PUBLIC_HERMES_ALLOW_HTTP=1 的开发构建。';
const UNLOCK_FAILED_ERROR = '面容识别未通过，请重试。';
const UNLOCK_CANCELLED_ERROR = '已取消解锁，请重试或使用密码登录。';
const UNLOCK_UNAVAILABLE_ERROR = '无法使用 Face ID 解锁，请使用密码登录。';
const UNLOCK_LOCKOUT_ERROR = '解锁失败次数过多，请使用密码登录。';
const EMPTY_REMEMBERED_LOGIN: RememberedLogin = {
  enabled: false,
  password: '',
  username: '',
};

function currentMobileAppVersion(): string {
  const version = Constants.expoConfig?.version?.trim() || 'unknown';
  const build = Constants.expoConfig?.ios?.buildNumber?.trim();
  return build ? `${version} (${build})` : version;
}

async function activateNativeOwnerScope(
  ownerScope: string,
  accountGeneration: string,
): Promise<void> {
  if (!hasNativeIOSContext) return;
  await HermesIOSContext.activateOwnerScope(ownerScope, accountGeneration);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const authLifecycle = useRef(new AuthLifecycleCoordinator());
  const authenticatedConnection = useRef<SavedConnection | null>(null);
  const persistAuthenticatedSession = useRef(false);
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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const current = () => active && authLifecycle.current.isCurrent(bootstrapGeneration);
    const scheduleRetry = () => {
      if (!current() || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void restoreSavedSession(false);
      }, SAVED_SESSION_RETRY_DELAY_MS);
    };
    const restoreSavedSession = async (firstAttempt: boolean) => {
      let refreshingSavedSession = false;
      let savedOwnerScope = '';
      try {
        if (firstAttempt) {
          // Legacy biometric entries are deleted without reading them. The v2
          // refresh token is non-interactive after the first successful login.
          await credentialStore.clearLegacySession().catch(() => undefined);
          await localAccountCleanupSaga
            .resume(localAccountCleanupTasks())
            .catch(() => []);
        }
        // Cold start reads only unprotected metadata: the remembered-login
        // preference (never the password item) and the protection-mode flag.
        const [savedLogin, unlockRequired] = await Promise.all([
          credentialStore.readRememberedLoginPreference().catch(() => EMPTY_REMEMBERED_LOGIN),
          credentialStore.sessionUnlockRequired(),
        ]);
        if (!current()) return;
        if (!savedLogin.enabled) {
          // Older builds persisted a refresh session even when the user did
          // not opt in to remembered login. Remove that legacy session before
          // it can bypass password authentication on this launch.
          await credentialMutations.run(() => credentialStore.clearSession()).catch(() => undefined);
          if (!current()) return;
          setRememberedLogin(EMPTY_REMEMBERED_LOGIN);
        } else {
          setRememberedLogin(savedLogin);
        }
        if (savedLogin.enabled && !unlockRequired) {
          // Remembered sessions must stay biometric-gated. If a previous
          // Keychain write fell back to device-only protection, keep the
          // remembered password but require a fresh explicit login.
          await credentialMutations.run(() => credentialStore.clearSession()).catch(() => undefined);
          if (!current()) return;
        } else if (savedLogin.enabled && unlockRequired) {
          const inspection = await inspectSavedConnection(credentialStore);
          if (!current()) return;
          if (inspection.status === 'locked') {
            // The refresh token sits behind a Face ID ACL. Keep every token
            // item closed until unlock() passes the biometric check.
            dispatch({ type: 'BOOTSTRAP_LOCKED', baseUrl: inspection.baseUrl });
            return;
          }
          // A protection flag without a base URL is a partial wipe; drop the
          // leftovers and continue to the provisioning path.
          await credentialMutations.run(() => credentialStore.clearSession()).catch(() => undefined);
        }
        const result = await bootstrapSavedConnection(credentialStore);
        if (!current()) return;
        if (result.status === 'authenticated') {
          refreshingSavedSession = true;
          savedOwnerScope = savedConnectionOwnerScope(result.connection);
          const adoption = await adoptSavedSession(result.connection, current);
          if (adoption.outcome === 'deleted') {
            if (current()) {
              setRememberedLogin(EMPTY_REMEMBERED_LOGIN);
              dispatch({
                type: 'BOOTSTRAP_EMPTY',
                mode: 'login',
                setupTokenRequired: false,
              });
            }
            return;
          }
          if (adoption.outcome === 'authenticated' && current()) {
            persistAuthenticatedSession.current = true;
            await activateLocalAccountData(adoption.connection);
            dispatch({ type: 'AUTHENTICATED', connection: adoption.connection });
          }
          return;
        }

        if (result.status === 'locked') {
          await credentialMutations.run(() => credentialStore.clearSession()).catch(() => undefined);
        }

        if (current()) {
          let error: string | undefined;
          try {
            const status = await new MobileAuthApiClient(HERMES_ORIGIN).getStatus();
            setRegistrationOpen(status.registrationOpen);
          } catch {
            error = CONNECTION_ERROR;
          }
          if (current()) {
            dispatch({
              type: 'BOOTSTRAP_EMPTY',
              mode: 'login',
              setupTokenRequired: false,
              error,
            });
          }
        }
      } catch (error) {
        const invalidatesSavedSession = savedSessionFailureInvalidatesCredentials(error);
        if (
          refreshingSavedSession
          && invalidatesSavedSession
          && savedOwnerScope
          && await hasPendingRemoteAccountDeletion(savedOwnerScope)
        ) {
          // A committed server deletion revokes the same refresh token before
          // the client can persist its local phase transition. The durable
          // user deletion intent makes that 401/403 sufficient to finish the
          // local wipe without resurrecting the deleted account.
          await localAccountCleanupSaga.markRemoteDone(savedOwnerScope).catch(() => undefined);
          await localAccountCleanupSaga
            .run(savedOwnerScope, localAccountCleanupTasks())
            .catch(() => undefined);
          await credentialMutations.run(() => credentialStore.clear()).catch(() => undefined);
          if (current()) {
            setRememberedLogin(EMPTY_REMEMBERED_LOGIN);
            dispatch({
              type: 'BOOTSTRAP_EMPTY',
              mode: 'login',
              setupTokenRequired: false,
            });
          }
          return;
        }
        if (
          refreshingSavedSession
          && !invalidatesSavedSession
        ) {
          scheduleRetry();
          return;
        }
        await credentialMutations.run(() => credentialStore.clearSession()).catch(() => undefined);
        if (current()) {
          dispatch({
            type: 'BOOTSTRAP_EMPTY',
            mode: 'login',
            error: invalidatesSavedSession
              ? invalidatedSessionError(error)
              : CONNECTION_ERROR,
          });
        }
      }
    };

    void restoreSavedSession(true);

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      authLifecycle.current.unmount();
    };
  }, []);

  const persistSession = useCallback(async (
    mobileAuth: MobileAuthApiClient,
    session: MobileAuthSession,
    operationGeneration: number,
    persistCredentials: boolean,
  ) => {
    const connection = await persistVerifiedConnection(
      {
        baseUrl: mobileAuth.baseUrl,
        username: session.account.username,
        accountGeneration: session.account.accountGeneration,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        deviceId: session.deviceId,
      },
      {
        store: {
          async save(candidate) {
            await credentialMutations.run(async () => {
              if (!authLifecycle.current.isCurrent(operationGeneration)) {
                throw new Error('Stale Hermes authentication operation');
              }
              if (persistCredentials) await credentialStore.save(candidate);
              if (!authLifecycle.current.isCurrent(operationGeneration)) {
                if (persistCredentials) await credentialStore.clearSession();
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
          await verifyMobileHandshake(client, mobileAuth);
        },
      },
    );
    if (!authLifecycle.current.isCurrent(operationGeneration)) {
      throw new Error('Stale Hermes authentication operation');
    }
    await activateNativeOwnerScope(
      accountOwnerScope(connection),
      connection.accountGeneration,
    );
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
        const device = await getMobileDeviceIdentity(authStore, {
          appVersion: currentMobileAppVersion(),
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
          rememberLogin,
        );
        const rememberedLoginSaved = await runOptionalAuthEffect(
          () => credentialMutations.run(async () => {
            if (!authLifecycle.current.isCurrent(operationGeneration)) return;
            await credentialStore.saveRememberedLogin(username, password, rememberLogin);
            if (!rememberLogin) await credentialStore.clearSession();
          }),
        );
        if (!rememberedLoginSaved && rememberLogin) {
          await runOptionalAuthEffect(() => credentialMutations.run(async () => {
            await credentialStore.saveRememberedLogin(username, password, false);
            await credentialStore.clearSession();
          }));
        }
        if (!authLifecycle.current.isCurrent(operationGeneration)) return;
        const remembered = rememberLogin && rememberedLoginSaved;
        const biometricSessionSaved = remembered
          && await credentialStore.sessionUnlockRequired().catch(() => false);
        if (remembered && !biometricSessionSaved) {
          await credentialMutations.run(() => credentialStore.clearSession()).catch(() => undefined);
        }
        persistAuthenticatedSession.current = biometricSessionSaved;
        setRememberedLogin(remembered
          ? { enabled: true, password: '', username: username.trim() }
          : EMPTY_REMEMBERED_LOGIN);
        await activateLocalAccountData(connection);
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

  const unlock = useCallback(async () => {
    if (state.status !== 'locked' || state.busy) return;
    const failedAttempts = state.failedAttempts;
    const operationGeneration = authLifecycle.current.beginOperation();
    if (operationGeneration === null) return;
    dispatch({ type: 'UNLOCK_STARTED' });
    const currentOperation = () => authLifecycle.current.isCurrent(operationGeneration);
    let refreshingSavedSession = false;
    let savedOwnerScope = '';
    try {
      // The Face ID prompt fires inside this read: the Keychain releases the
      // refresh token only after the biometric check passes.
      const result = await bootstrapSavedConnection(credentialStore);
      if (!currentOperation()) return;
      if (result.status !== 'authenticated') {
        const failure = result.status === 'locked' ? result.failure : undefined;
        if (failure === 'cancelled') {
          dispatch({
            type: 'UNLOCK_FAILED',
            error: UNLOCK_CANCELLED_ERROR,
            countAttempt: false,
          });
          return;
        }
        if (failure === 'authentication_failed') {
          // The OS prompt already allowed its own retries; count one
          // app-level attempt and drop the saved session once the budget
          // is spent so a stranger cannot keep probing the biometric.
          if (failedAttempts + 1 >= MAX_FACE_ID_ATTEMPTS) {
            await credentialMutations.run(() => credentialStore.clearSession()).catch(() => undefined);
          }
          if (currentOperation()) {
            dispatch({
              type: 'UNLOCK_FAILED',
              error: UNLOCK_FAILED_ERROR,
              fallbackError: UNLOCK_LOCKOUT_ERROR,
            });
          }
          return;
        }
        // Missing items or a biometry re-enrolment invalidated the token;
        // the saved session can never unlock, so fall back to password login.
        await credentialMutations.run(() => credentialStore.clearSession()).catch(() => undefined);
        if (currentOperation()) {
          dispatch({
            type: 'UNLOCK_FAILED',
            error: UNLOCK_UNAVAILABLE_ERROR,
            fallbackImmediately: true,
          });
        }
        return;
      }
      refreshingSavedSession = true;
      savedOwnerScope = savedConnectionOwnerScope(result.connection);
      const adoption = await adoptSavedSession(result.connection, currentOperation);
      if (adoption.outcome === 'deleted') {
        if (currentOperation()) {
          setRememberedLogin(EMPTY_REMEMBERED_LOGIN);
          dispatch({
            type: 'BOOTSTRAP_EMPTY',
            mode: 'login',
            setupTokenRequired: false,
          });
        }
        return;
      }
      if (adoption.outcome === 'authenticated' && currentOperation()) {
        persistAuthenticatedSession.current = true;
        await activateLocalAccountData(adoption.connection);
        dispatch({ type: 'AUTHENTICATED', connection: adoption.connection });
      }
    } catch (error) {
      const invalidatesSavedSession = savedSessionFailureInvalidatesCredentials(error);
      if (
        refreshingSavedSession
        && invalidatesSavedSession
        && savedOwnerScope
        && await hasPendingRemoteAccountDeletion(savedOwnerScope)
      ) {
        // Same terminal signal as the cold-start path: a committed server
        // deletion revoked this refresh token, so finish the local wipe.
        await localAccountCleanupSaga.markRemoteDone(savedOwnerScope).catch(() => undefined);
        await localAccountCleanupSaga
          .run(savedOwnerScope, localAccountCleanupTasks())
          .catch(() => undefined);
        await credentialMutations.run(() => credentialStore.clear()).catch(() => undefined);
        if (currentOperation()) {
          setRememberedLogin(EMPTY_REMEMBERED_LOGIN);
          dispatch({
            type: 'BOOTSTRAP_EMPTY',
            mode: 'login',
            setupTokenRequired: false,
          });
        }
        return;
      }
      if (invalidatesSavedSession) {
        await credentialMutations.run(() => credentialStore.clearSession()).catch(() => undefined);
        if (currentOperation()) {
          dispatch({
            type: 'UNLOCK_FAILED',
            error: invalidatedSessionError(error),
            fallbackImmediately: true,
          });
        }
        return;
      }
      // Transient network failure: stay locked without spending an attempt.
      if (currentOperation()) {
        dispatch({
          type: 'UNLOCK_FAILED',
          error: CONNECTION_ERROR,
          countAttempt: false,
        });
      }
    } finally {
      authLifecycle.current.finishOperation(operationGeneration);
    }
  }, [state]);

  const revealRememberedPassword = useCallback(async () => {
    if (!rememberedLogin.enabled) return null;
    try {
      // Face ID gates this read; it must only run from an explicit user action.
      const saved = await credentialStore.readRememberedLogin();
      if (!saved.enabled || !saved.password) return null;
      setRememberedLogin(saved);
      return saved.password;
    } catch {
      // Cancelled or biometrics unavailable — the user types the password.
      return null;
    }
  }, [rememberedLogin.enabled]);

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
      const device = await getMobileDeviceIdentity(authStore, {
        appVersion: currentMobileAppVersion(),
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
        false,
      );
      if (authLifecycle.current.isCurrent(operationGeneration)) {
        await activateLocalAccountData(connection);
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

  const sessionConnection = state.status === 'authenticated'
    ? state.connection
    : null;
  const sessionGeneration = sessionConnection
    ? authLifecycle.current.currentGeneration()
    : 0;
  const clientSessionKey = sessionConnection
    ? `${sessionGeneration}\u0000${accountOwnerScope(sessionConnection)}`
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
        saveSessionTokens(accessToken, refreshToken, expiresAt, accountGeneration) {
          return credentialMutations.run(async () => {
            if (!isCurrentConnection() || !persistAuthenticatedSession.current) return;
            await credentialStore.saveSessionTokens(
              accessToken,
              refreshToken,
              expiresAt,
              accountGeneration,
            );
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
          accountGeneration: session.account.accountGeneration,
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
      await runOptionalAuthEffect(clearAccountNotificationsBeforeAuthExit);
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
      // Product boundary: logout / session expiry clear credentials only.
      // Always location keeps collecting while the process is alive so the
      // agent can still obtain the user's path without force-quit; queued
      // events remain local until the next authenticated upload.
      await credentialMutations.run(() => credentialStore.clearSession());
      if (authLifecycle.current.isCurrent(operationGeneration)) {
        persistAuthenticatedSession.current = false;
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
      await runOptionalAuthEffect(clearAccountNotificationsBeforeAuthExit);
      const ownerScope = accountOwnerScope(state.connection);
      // Persist the user's deletion intent before the remote request. If the
      // server commits and the app exits before the next line, cold-start
      // recovery uses the revoked refresh token as the terminal phase signal.
      await localAccountCleanupSaga.begin(ownerScope);
      await new IOSIntelligenceApi(client).deleteAccount(ownerScope);
      serverDeleted = true;
      await localAccountCleanupSaga.markRemoteDone(ownerScope);
      await localAccountCleanupSaga.run(ownerScope, localAccountCleanupTasks());
      if (authLifecycle.current.isCurrent(operationGeneration)) {
        await credentialMutations.run(() => credentialStore.clear());
        persistAuthenticatedSession.current = false;
        setRememberedLogin(EMPTY_REMEMBERED_LOGIN);
        dispatch({ type: 'LOGGED_OUT' });
      }
    } catch {
      if (serverDeleted && authLifecycle.current.isCurrent(operationGeneration)) {
        const ownerScope = accountOwnerScope(state.connection);
        await localAccountCleanupSaga.begin(ownerScope).catch(() => undefined);
        await localAccountCleanupSaga.markRemoteDone(ownerScope).catch(() => undefined);
        await localAccountCleanupSaga
          .run(ownerScope, localAccountCleanupTasks())
          .catch(() => undefined);
        await credentialMutations
          .run(() => credentialStore.clear())
          .catch(() => undefined);
        persistAuthenticatedSession.current = false;
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
      unlock,
      register,
      requestRegistrationCode,
      revealRememberedPassword,
      rememberDeviceId,
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
      revealRememberedPassword,
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

function localAccountCleanupTasks() {
  return {
    async deleteNativeOwner(ownerScope: string) {
      if (hasNativeIOSContext) {
        await HermesIOSContext.deleteOwnerScope(
          ownerScope,
          accountGenerationFromOwnerScope(ownerScope),
        );
      }
    },
    async purgeAccountData(ownerScope: string) {
      await purgeLocalAccountData(ownerScope);
    },
  };
}

async function activateLocalAccountData(connection: SavedConnection): Promise<void> {
  // Local conversation cleanup is an optional post-login effect. Its
  // storage adapter may be unavailable in a re-signed build, but that must
  // not turn a successful remote login into CONNECTION_ERROR.
  await runOptionalAuthEffect(() => sharedConversationLocalStore().activate(
    accountOwnerScope(connection),
  ));
}

async function verifyMobileHandshake(
  client: HermesApiClient,
  mobileAuth: MobileAuthApiClient,
): Promise<void> {
  try {
    const response = await client.request<unknown>('/api/mobile/v1/handshake');
    assertMobileHandshake(response);
    return;
  } catch (error) {
    // The backend deliberately exposes this endpoint as a public, read-only
    // contract probe. Some reverse proxies still send a newly minted bearer
    // through the cookie gate and answer 401/403 (often as a login redirect),
    // which used to make correct credentials look invalid. Retry the same
    // probe without Authorization in that narrow case; all other failures
    // retain their existing, useful error classification.
    const retryWithoutBearer = error instanceof HermesApiError
      ? error.status === 401 || error.status === 403
      : error instanceof Error
        && /incompatible mobile handshake|invalid JSON/i.test(error.message);
    if (!retryWithoutBearer) {
      throw error;
    }
    try {
      assertMobileHandshake(await mobileAuth.getHandshake());
      return;
    } catch {
      // Keep the original authenticated-probe error. In particular, do not
      // turn a malformed server response into a misleading password error.
      throw error;
    }
  }
}

async function hasPendingRemoteAccountDeletion(ownerScope: string): Promise<boolean> {
  const normalized = ownerScope.trim().toLowerCase();
  if (!normalized) return false;
  return (await localAccountCleanupSaga.pending())
    .some((record) => record.owner.toLowerCase() === normalized && !record.remoteDone);
}

type SavedSessionAdoption =
  | { outcome: 'authenticated'; connection: SavedConnection }
  /** A pending remote account deletion completed; the saved session is gone. */
  | { outcome: 'deleted' }
  /** The auth generation changed mid-flight; the caller must do nothing. */
  | { outcome: 'stale' };

/**
 * Turns a saved connection into a live one: rotate the refresh token, finish
 * any pending account deletion, verify the handshake, persist, and activate
 * the native owner scope. Shared by the non-interactive cold start and the
 * Face ID unlock path so both keep identical rotation/deletion semantics.
 */
async function adoptSavedSession(
  saved: SavedConnection,
  isCurrent: () => boolean,
): Promise<SavedSessionAdoption> {
  const savedOwnerScope = savedConnectionOwnerScope(saved);
  const mobileAuth = new MobileAuthApiClient(saved.baseUrl);
  const refreshed = await mobileAuth.refresh(saved.refreshToken);
  if (refreshed.account.username !== saved.username) {
    throw new Error('Hermes refreshed a different account');
  }
  if (
    saved.accountGeneration !== LEGACY_ACCOUNT_GENERATION
    && refreshed.account.accountGeneration !== saved.accountGeneration
  ) {
    throw new Error('Hermes refreshed a different account generation');
  }
  // Refresh tokens rotate on every successful exchange. Persist the
  // successor before the handshake so a transient handshake failure
  // never retries an already-consumed token and revokes this device.
  await credentialMutations.run(() => credentialStore.saveSessionTokens(
    refreshed.accessToken,
    refreshed.refreshToken,
    refreshed.expiresAt,
    refreshed.account.accountGeneration,
  ));
  if (await hasPendingRemoteAccountDeletion(savedOwnerScope)) {
    const deletionClient = new HermesApiClient(
      mobileAuth.baseUrl,
      refreshed.accessToken,
    );
    await new IOSIntelligenceApi(deletionClient).deleteAccount(savedOwnerScope);
    await localAccountCleanupSaga.markRemoteDone(savedOwnerScope);
    await localAccountCleanupSaga.run(savedOwnerScope, localAccountCleanupTasks());
    await credentialMutations.run(() => credentialStore.clear());
    return { outcome: 'deleted' };
  }
  const verifiedConnection = await persistVerifiedConnection(
    {
      baseUrl: mobileAuth.baseUrl,
      username: refreshed.account.username,
      accountGeneration: refreshed.account.accountGeneration,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      deviceId: refreshed.deviceId,
    },
    {
      store: {
        async save(candidate) {
          await credentialMutations.run(() => credentialStore.save(candidate));
        },
      },
      async verify(candidate) {
        const client = new HermesApiClient(candidate.baseUrl, candidate.accessToken);
        await verifyMobileHandshake(client, mobileAuth);
      },
    },
  );
  if (!isCurrent()) return { outcome: 'stale' };
  await activateNativeOwnerScope(
    accountOwnerScope(verifiedConnection),
    verifiedConnection.accountGeneration,
  );
  return { outcome: 'authenticated', connection: verifiedConnection };
}

function savedConnectionOwnerScope(connection: SavedConnection): string {
  return connection.accountGeneration === LEGACY_ACCOUNT_GENERATION
    ? legacyAccountOwnerScope(connection)
    : accountOwnerScope(connection);
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

async function clearAccountNotificationsBeforeAuthExit(): Promise<void> {
  await withDeadline(
    clearExpoAccountNotifications(),
    NOTIFICATION_CLEANUP_DEADLINE_MS,
    'Hermes notification cleanup timed out',
  );
}

function invalidatedSessionError(error: unknown): string {
  // A cleartext http:// base URL saved before the transport hardening can
  // never restore; say why instead of claiming the login expired.
  return savedSessionFailureIsCleartextBaseUrl(error)
    ? CLEARTEXT_BASEURL_ERROR
    : SESSION_EXPIRED_ERROR;
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
  if (error instanceof HermesApiError) {
    if (error.status === 401 || error.status === 403) {
      return '登录成功但会话未被服务器接受，请重试或联系管理员。';
    }
    if (error.status === 404) {
      return '服务器未部署移动端接口，请升级 Hermes 后端后重试。';
    }
    if (error.status >= 500) {
      return 'Hermes 服务器暂时不可用，请稍后重试。';
    }
  }
  if (error instanceof Error) {
    const message = error.message;
    if (/timed?\s*out|timeout/i.test(message)) {
      return '连接 Hermes 超时，请检查网络后重试。';
    }
    if (/incompatible mobile handshake/i.test(message)) {
      return '服务器移动端协议不兼容，请升级 Hermes 后端后重试。';
    }
    if (/same-origin|origin could not be verified/i.test(message)) {
      return 'Hermes 连接被重定向到不受信任的地址。';
    }
    if (/Network request failed|Failed to fetch|network/i.test(message)) {
      return '无法连接到 Hermes 服务器，请检查网络后重试。';
    }
  }
  return CONNECTION_ERROR;
}
