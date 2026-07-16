import { normalizeBaseUrl } from '../api/HermesApiClient';
import {
  ACCESS_EXPIRES_AT_STORAGE_KEY,
  ACCESS_TOKEN_STORAGE_KEY,
  BASE_URL_STORAGE_KEY,
  CREDENTIAL_STORAGE_KEYS,
  DEVICE_ID_STORAGE_KEY,
  FACE_ID_PROMPT,
  REFRESH_TOKEN_KEY_PREFIX,
  REFRESH_TOKEN_POINTER_STORAGE_KEY,
  REFRESH_TOKEN_STORAGE_KEY,
  REMEMBER_LOGIN_STORAGE_KEY,
  REMEMBERED_PASSWORD_STORAGE_KEY,
  USERNAME_STORAGE_KEY,
  type RememberedLogin,
  type SavedConnection,
} from './credential-contract';

export interface SecureStoreOptions {
  requireAuthentication?: boolean;
  authenticationPrompt?: string;
}

export interface SecureStoreAdapter {
  getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void>;
}

export interface CredentialWriter {
  save(connection: SavedConnection): Promise<void>;
}

export interface SessionTokenWriter {
  saveSessionTokens(
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
  ): Promise<void>;
}

const PROTECTED_REFRESH_TOKEN_OPTIONS = Object.freeze({
  requireAuthentication: true,
  authenticationPrompt: FACE_ID_PROMPT,
});

export class CredentialStore implements CredentialWriter, SessionTokenWriter {
  constructor(private readonly secureStore: SecureStoreAdapter) {}

  readBaseUrl(): Promise<string | null> {
    return this.secureStore.getItemAsync(BASE_URL_STORAGE_KEY);
  }

  async readRefreshToken(): Promise<string | null> {
    const currentKey = await this.secureStore.getItemAsync(
      REFRESH_TOKEN_POINTER_STORAGE_KEY,
    );
    if (isRefreshTokenKey(currentKey)) {
      return this.secureStore.getItemAsync(
        currentKey,
        PROTECTED_REFRESH_TOKEN_OPTIONS,
      );
    }
    return this.secureStore.getItemAsync(
      REFRESH_TOKEN_STORAGE_KEY,
      PROTECTED_REFRESH_TOKEN_OPTIONS,
    );
  }

  readUsername(): Promise<string | null> {
    return this.secureStore.getItemAsync(USERNAME_STORAGE_KEY);
  }

  async readRememberedLogin(): Promise<RememberedLogin> {
    const [username, preference, password] = await Promise.all([
      this.readUsername(),
      this.secureStore.getItemAsync(REMEMBER_LOGIN_STORAGE_KEY),
      this.secureStore.getItemAsync(REMEMBERED_PASSWORD_STORAGE_KEY),
    ]);
    const enabled = preference === '1' && Boolean(password);
    return {
      enabled,
      password: enabled ? password ?? '' : '',
      username: username ?? '',
    };
  }

  async saveRememberedLogin(
    username: string,
    password: string,
    enabled: boolean,
  ): Promise<void> {
    if (!enabled) {
      await Promise.all([
        this.secureStore.setItemAsync(REMEMBER_LOGIN_STORAGE_KEY, '0'),
        this.secureStore.deleteItemAsync(REMEMBERED_PASSWORD_STORAGE_KEY),
      ]);
      return;
    }
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      throw new Error('Invalid remembered Hermes login');
    }
    await Promise.all([
      this.secureStore.setItemAsync(USERNAME_STORAGE_KEY, normalizedUsername),
      this.secureStore.setItemAsync(REMEMBER_LOGIN_STORAGE_KEY, '1'),
      this.secureStore.setItemAsync(REMEMBERED_PASSWORD_STORAGE_KEY, password),
    ]);
  }

  readAccessToken(): Promise<string | null> {
    return this.secureStore.getItemAsync(ACCESS_TOKEN_STORAGE_KEY);
  }

  readDeviceId(): Promise<string | null> {
    return this.secureStore.getItemAsync(DEVICE_ID_STORAGE_KEY);
  }

  async readAccessExpiresAt(): Promise<number | null> {
    const stored = await this.secureStore.getItemAsync(ACCESS_EXPIRES_AT_STORAGE_KEY);
    if (stored === null) return null;
    const expiresAt = Number(stored);
    return Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null;
  }

  async save(connection: SavedConnection): Promise<void> {
    let refreshTokenKey = '';
    try {
      await this.secureStore.setItemAsync(BASE_URL_STORAGE_KEY, connection.baseUrl);
      await this.secureStore.setItemAsync(USERNAME_STORAGE_KEY, connection.username);
      await this.secureStore.setItemAsync(ACCESS_TOKEN_STORAGE_KEY, connection.accessToken);
      await this.secureStore.setItemAsync(
        ACCESS_EXPIRES_AT_STORAGE_KEY,
        String(connection.expiresAt),
      );
      if (connection.deviceId) {
        await this.secureStore.setItemAsync(DEVICE_ID_STORAGE_KEY, connection.deviceId);
      } else {
        await this.secureStore.deleteItemAsync(DEVICE_ID_STORAGE_KEY);
      }
      refreshTokenKey = createRefreshTokenKey();
      await this.secureStore.setItemAsync(
        refreshTokenKey,
        connection.refreshToken,
        PROTECTED_REFRESH_TOKEN_OPTIONS,
      );
      await this.secureStore.setItemAsync(
        REFRESH_TOKEN_POINTER_STORAGE_KEY,
        refreshTokenKey,
      );
      await this.secureStore.deleteItemAsync(REFRESH_TOKEN_STORAGE_KEY);
    } catch {
      await this.deleteAll(refreshTokenKey);
      throw new Error('Unable to save Hermes credentials');
    }
  }

  async saveSessionTokens(
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
  ): Promise<void> {
    const normalizedToken = accessToken.trim();
    const normalizedRefreshToken = refreshToken.trim();
    if (
      !normalizedToken
      || !normalizedRefreshToken
      || !Number.isFinite(expiresAt)
      || expiresAt <= 0
    ) {
      throw new Error('Invalid Hermes token session');
    }
    const previousKey = await this.secureStore.getItemAsync(
      REFRESH_TOKEN_POINTER_STORAGE_KEY,
    );
    const nextKey = createRefreshTokenKey();
    try {
      // A fresh Keychain item keeps Face ID protection without prompting again
      // during background token rotation. Face ID is requested only when the
      // protected token is read on a later app unlock.
      await this.secureStore.setItemAsync(
        nextKey,
        normalizedRefreshToken,
        PROTECTED_REFRESH_TOKEN_OPTIONS,
      );
      await this.secureStore.setItemAsync(
        REFRESH_TOKEN_POINTER_STORAGE_KEY,
        nextKey,
      );
      await this.secureStore.setItemAsync(ACCESS_TOKEN_STORAGE_KEY, normalizedToken);
      await this.secureStore.setItemAsync(
        ACCESS_EXPIRES_AT_STORAGE_KEY,
        String(expiresAt),
      );
      if (isRefreshTokenKey(previousKey) && previousKey !== nextKey) {
        await this.secureStore.deleteItemAsync(previousKey);
      }
      await this.secureStore.deleteItemAsync(REFRESH_TOKEN_STORAGE_KEY);
    } catch {
      throw new Error('Unable to update Hermes token session');
    }
  }

  async saveDeviceId(deviceId: string): Promise<void> {
    const normalized = deviceId.trim();
    if (!normalized) throw new Error('Invalid Hermes device id');
    await this.secureStore.setItemAsync(DEVICE_ID_STORAGE_KEY, normalized);
  }

  async clear(): Promise<void> {
    const currentKey = await this.secureStore.getItemAsync(
      REFRESH_TOKEN_POINTER_STORAGE_KEY,
    ).catch(() => null);
    const results = await this.deleteAll(
      isRefreshTokenKey(currentKey) ? currentKey : '',
    );
    if (results.some(({ status }) => status === 'rejected')) {
      throw new Error('Unable to clear Hermes credentials');
    }
  }

  async clearSession(): Promise<void> {
    const [currentKey, rememberedLogin] = await Promise.all([
      this.secureStore.getItemAsync(REFRESH_TOKEN_POINTER_STORAGE_KEY).catch(() => null),
      this.readRememberedLogin().catch(() => ({
        enabled: false,
        password: '',
        username: '',
      })),
    ]);
    const keys = [
      BASE_URL_STORAGE_KEY,
      ACCESS_TOKEN_STORAGE_KEY,
      REFRESH_TOKEN_STORAGE_KEY,
      REFRESH_TOKEN_POINTER_STORAGE_KEY,
      ACCESS_EXPIRES_AT_STORAGE_KEY,
      DEVICE_ID_STORAGE_KEY,
      ...(rememberedLogin.enabled
        ? []
        : [
            USERNAME_STORAGE_KEY,
            REMEMBER_LOGIN_STORAGE_KEY,
            REMEMBERED_PASSWORD_STORAGE_KEY,
          ]),
      ...(isRefreshTokenKey(currentKey) ? [currentKey] : []),
    ];
    const results = await Promise.allSettled(
      keys.map((key) => this.secureStore.deleteItemAsync(key)),
    );
    if (results.some(({ status }) => status === 'rejected')) {
      throw new Error('Unable to clear Hermes session');
    }
  }

  private deleteAll(refreshTokenKey = ''): Promise<PromiseSettledResult<void>[]> {
    const keys = refreshTokenKey
      ? [...CREDENTIAL_STORAGE_KEYS, refreshTokenKey]
      : [...CREDENTIAL_STORAGE_KEYS];
    return Promise.allSettled(
      keys.map((key) => this.secureStore.deleteItemAsync(key)),
    );
  }
}

function createRefreshTokenKey(): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${REFRESH_TOKEN_KEY_PREFIX}${suffix}`;
}

function isRefreshTokenKey(value: string | null | undefined): value is string {
  return typeof value === 'string'
    && value.startsWith(REFRESH_TOKEN_KEY_PREFIX)
    && value.length > REFRESH_TOKEN_KEY_PREFIX.length;
}

export async function provisionConnection(
  input: SavedConnection,
  dependencies: {
    store: CredentialWriter;
    verify(connection: SavedConnection): Promise<void>;
  },
): Promise<SavedConnection> {
  const connection = normalizeConnection(input);
  await dependencies.verify(connection);
  await dependencies.store.save(connection);
  return connection;
}

function normalizeConnection(input: SavedConnection): SavedConnection {
  const connection = {
    baseUrl: normalizeBaseUrl(input.baseUrl),
    username: input.username.trim(),
    accessToken: input.accessToken.trim(),
    refreshToken: input.refreshToken.trim(),
    expiresAt: input.expiresAt,
    ...(input.deviceId?.trim() ? { deviceId: input.deviceId.trim() } : {}),
  };
  if (!connection.username) throw new Error('Hermes username is required');
  if (!connection.accessToken) throw new Error('Hermes access token is required');
  if (!connection.refreshToken) throw new Error('Hermes refresh token is required');
  if (!Number.isFinite(connection.expiresAt) || connection.expiresAt <= 0) {
    throw new Error('Hermes access-token expiry is invalid');
  }
  return connection;
}
