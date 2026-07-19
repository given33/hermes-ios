import { normalizeBaseUrl } from '../api/HermesApiClient';
import {
  ACCESS_EXPIRES_AT_STORAGE_KEY,
  ACCESS_TOKEN_STORAGE_KEY,
  BASE_URL_STORAGE_KEY,
  CREDENTIAL_STORAGE_KEYS,
  DEVICE_ID_STORAGE_KEY,
  LEGACY_ACCESS_EXPIRES_AT_STORAGE_KEY,
  LEGACY_ACCESS_TOKEN_STORAGE_KEY,
  LEGACY_BASE_URL_STORAGE_KEY,
  LEGACY_REFRESH_TOKEN_KEY_PREFIX,
  LEGACY_REFRESH_TOKEN_POINTER_STORAGE_KEY,
  LEGACY_REFRESH_TOKEN_STORAGE_KEY,
  LEGACY_REMEMBERED_PASSWORD_STORAGE_KEY,
  LEGACY_REMEMBER_LOGIN_STORAGE_KEY,
  LEGACY_USERNAME_STORAGE_KEY,
  REFRESH_TOKEN_KEY_PREFIX,
  REFRESH_TOKEN_POINTER_STORAGE_KEY,
  REFRESH_TOKEN_STORAGE_KEY,
  REMEMBER_LOGIN_STORAGE_KEY,
  REMEMBERED_PASSWORD_STORAGE_KEY,
  SESSION_STORAGE_VERSION,
  SESSION_STORAGE_VERSION_KEY,
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

export class CredentialStore implements CredentialWriter, SessionTokenWriter {
  constructor(private readonly secureStore: SecureStoreAdapter) {}

  async clearLegacySession(): Promise<void> {
    const version = await this.secureStore.getItemAsync(SESSION_STORAGE_VERSION_KEY)
      .catch(() => null);
    if (version === SESSION_STORAGE_VERSION) return;

    // Older builds stored tokens and the optional remembered password behind
    // a biometric ACL. Delete those items without reading their values. Any
    // deletion failure is deliberately ignored: v2 uses different names, so
    // a stale ACL can never block the next normal login.
    const legacyKey = await this.secureStore.getItemAsync(
      LEGACY_REFRESH_TOKEN_POINTER_STORAGE_KEY,
    ).catch(() => null);
    const keys = [
      LEGACY_BASE_URL_STORAGE_KEY,
      LEGACY_USERNAME_STORAGE_KEY,
      LEGACY_ACCESS_TOKEN_STORAGE_KEY,
      LEGACY_REFRESH_TOKEN_STORAGE_KEY,
      LEGACY_REFRESH_TOKEN_POINTER_STORAGE_KEY,
      LEGACY_ACCESS_EXPIRES_AT_STORAGE_KEY,
      LEGACY_REMEMBER_LOGIN_STORAGE_KEY,
      LEGACY_REMEMBERED_PASSWORD_STORAGE_KEY,
      ...(isLegacyRefreshTokenKey(legacyKey) ? [legacyKey] : []),
    ];
    await Promise.allSettled(keys.map((key) => this.secureStore.deleteItemAsync(key)));
  }

  async readBaseUrl(): Promise<string | null> {
    const version = await this.secureStore.getItemAsync(SESSION_STORAGE_VERSION_KEY);
    if (version !== SESSION_STORAGE_VERSION) return null;
    return this.secureStore.getItemAsync(BASE_URL_STORAGE_KEY);
  }

  async readRefreshToken(): Promise<string | null> {
    const currentKey = await this.secureStore.getItemAsync(
      REFRESH_TOKEN_POINTER_STORAGE_KEY,
    );
    if (isRefreshTokenKey(currentKey)) {
      return this.secureStore.getItemAsync(currentKey);
    }
    return this.secureStore.getItemAsync(REFRESH_TOKEN_STORAGE_KEY);
  }

  readUsername(): Promise<string | null> {
    return this.secureStore.getItemAsync(USERNAME_STORAGE_KEY);
  }

  /**
   * Preference + username only — never touches the biometric-protected
   * password item, so the Face ID lock screen can show username without
   * unlocking secrets.
   */
  async readRememberedLoginPreference(): Promise<RememberedLogin> {
    const [username, preference] = await Promise.all([
      this.readUsername(),
      this.secureStore.getItemAsync(REMEMBER_LOGIN_STORAGE_KEY),
    ]);
    return {
      enabled: preference === '1',
      password: '',
      username: username ?? '',
    };
  }

  async readRememberedLogin(): Promise<RememberedLogin> {
    const preference = await this.readRememberedLoginPreference();
    if (!preference.enabled) {
      return {
        enabled: false,
        password: '',
        username: preference.username,
      };
    }
    const password = await this.secureStore.getItemAsync(REMEMBERED_PASSWORD_STORAGE_KEY);
    const enabled = Boolean(password);
    return {
      enabled,
      password: enabled ? password ?? '' : '',
      username: preference.username,
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
      this.secureStore.setItemAsync(
        REMEMBERED_PASSWORD_STORAGE_KEY,
        password,
      ),
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
      await this.secureStore.setItemAsync(
        ACCESS_TOKEN_STORAGE_KEY,
        connection.accessToken,
      );
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
      );
      await this.secureStore.setItemAsync(
        REFRESH_TOKEN_POINTER_STORAGE_KEY,
        refreshTokenKey,
      );
      await this.secureStore.deleteItemAsync(REFRESH_TOKEN_STORAGE_KEY);
      await this.secureStore.setItemAsync(
        SESSION_STORAGE_VERSION_KEY,
        SESSION_STORAGE_VERSION,
      );
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
      await this.secureStore.setItemAsync(
        nextKey,
        normalizedRefreshToken,
      );
      await this.secureStore.setItemAsync(
        REFRESH_TOKEN_POINTER_STORAGE_KEY,
        nextKey,
      );
      await this.secureStore.setItemAsync(
        ACCESS_TOKEN_STORAGE_KEY,
        normalizedToken,
      );
      await this.secureStore.setItemAsync(
        ACCESS_EXPIRES_AT_STORAGE_KEY,
        String(expiresAt),
      );
      if (isRefreshTokenKey(previousKey) && previousKey !== nextKey) {
        await this.secureStore.deleteItemAsync(previousKey);
      }
      await this.secureStore.deleteItemAsync(REFRESH_TOKEN_STORAGE_KEY);
      await this.secureStore.setItemAsync(
        SESSION_STORAGE_VERSION_KEY,
        SESSION_STORAGE_VERSION,
      );
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
    const [currentKey, rememberPreference] = await Promise.all([
      this.secureStore.getItemAsync(REFRESH_TOKEN_POINTER_STORAGE_KEY).catch(() => null),
      // Preference flag only — never prompt for the protected password on logout.
      this.secureStore.getItemAsync(REMEMBER_LOGIN_STORAGE_KEY).catch(() => null),
    ]);
    const rememberEnabled = rememberPreference === '1';
    const legacyKey = await this.secureStore.getItemAsync(
      LEGACY_REFRESH_TOKEN_POINTER_STORAGE_KEY,
    ).catch(() => null);
    const keys = [
      BASE_URL_STORAGE_KEY,
      ACCESS_TOKEN_STORAGE_KEY,
      REFRESH_TOKEN_STORAGE_KEY,
      REFRESH_TOKEN_POINTER_STORAGE_KEY,
      ACCESS_EXPIRES_AT_STORAGE_KEY,
      DEVICE_ID_STORAGE_KEY,
      SESSION_STORAGE_VERSION_KEY,
      ...(rememberEnabled
        ? []
        : [
            USERNAME_STORAGE_KEY,
            REMEMBER_LOGIN_STORAGE_KEY,
            REMEMBERED_PASSWORD_STORAGE_KEY,
          ]),
      ...(isRefreshTokenKey(currentKey) ? [currentKey] : []),
      LEGACY_BASE_URL_STORAGE_KEY,
      LEGACY_USERNAME_STORAGE_KEY,
      LEGACY_ACCESS_TOKEN_STORAGE_KEY,
      LEGACY_REFRESH_TOKEN_STORAGE_KEY,
      LEGACY_REFRESH_TOKEN_POINTER_STORAGE_KEY,
      LEGACY_ACCESS_EXPIRES_AT_STORAGE_KEY,
      LEGACY_REMEMBER_LOGIN_STORAGE_KEY,
      LEGACY_REMEMBERED_PASSWORD_STORAGE_KEY,
      ...(isLegacyRefreshTokenKey(legacyKey) ? [legacyKey] : []),
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

function isLegacyRefreshTokenKey(value: string | null | undefined): value is string {
  return typeof value === 'string'
    && value.startsWith(LEGACY_REFRESH_TOKEN_KEY_PREFIX)
    && value.length > LEGACY_REFRESH_TOKEN_KEY_PREFIX.length;
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
