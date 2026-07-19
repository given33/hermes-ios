// v2 uses new Keychain item names so an old item carrying a biometric ACL can
// never be updated in-place and accidentally re-enable an authentication UI.
export const BASE_URL_STORAGE_KEY = 'hermes.native.v2.baseUrl';
export const USERNAME_STORAGE_KEY = 'hermes.native.v2.username';
export const ACCESS_TOKEN_STORAGE_KEY = 'hermes.native.v2.accessToken';
export const REFRESH_TOKEN_STORAGE_KEY = 'hermes.native.v2.refreshToken';
export const REFRESH_TOKEN_POINTER_STORAGE_KEY = 'hermes.native.v2.refreshTokenKey';
export const REFRESH_TOKEN_KEY_PREFIX = 'hermes.native.v2.refreshToken.';
export const ACCESS_EXPIRES_AT_STORAGE_KEY = 'hermes.native.v2.accessExpiresAt';
export const DEVICE_ID_STORAGE_KEY = 'hermes.native.deviceId';
export const SESSION_STORAGE_VERSION_KEY = 'hermes.native.v2.sessionVersion';
export const SESSION_STORAGE_VERSION = '2';
export const REMEMBER_LOGIN_STORAGE_KEY = 'hermes.native.v2.rememberLogin';
export const REMEMBERED_PASSWORD_STORAGE_KEY = 'hermes.native.v2.rememberedPassword';

// Names used by releases before the non-interactive session migration. They
// are intentionally not part of CREDENTIAL_STORAGE_KEYS and are never read
// as values.
export const LEGACY_BASE_URL_STORAGE_KEY = 'hermes.native.baseUrl';
export const LEGACY_USERNAME_STORAGE_KEY = 'hermes.native.username';
export const LEGACY_ACCESS_TOKEN_STORAGE_KEY = 'hermes.native.accessToken';
export const LEGACY_REFRESH_TOKEN_STORAGE_KEY = 'hermes.native.refreshToken';
export const LEGACY_REFRESH_TOKEN_POINTER_STORAGE_KEY = 'hermes.native.refreshTokenKey';
export const LEGACY_REFRESH_TOKEN_KEY_PREFIX = 'hermes.native.refreshToken.';
export const LEGACY_ACCESS_EXPIRES_AT_STORAGE_KEY = 'hermes.native.accessExpiresAt';
export const LEGACY_REMEMBER_LOGIN_STORAGE_KEY = 'hermes.native.rememberLogin';
export const LEGACY_REMEMBERED_PASSWORD_STORAGE_KEY = 'hermes.native.rememberedPassword';
export const INSTALLATION_ID_STORAGE_KEY = 'hermes.native.installationId';

export const CREDENTIAL_STORAGE_KEYS = [
  BASE_URL_STORAGE_KEY,
  USERNAME_STORAGE_KEY,
  ACCESS_TOKEN_STORAGE_KEY,
  REFRESH_TOKEN_STORAGE_KEY,
  REFRESH_TOKEN_POINTER_STORAGE_KEY,
  ACCESS_EXPIRES_AT_STORAGE_KEY,
  DEVICE_ID_STORAGE_KEY,
  SESSION_STORAGE_VERSION_KEY,
  REMEMBER_LOGIN_STORAGE_KEY,
  REMEMBERED_PASSWORD_STORAGE_KEY,
] as const;

export interface RememberedLogin {
  enabled: boolean;
  password: string;
  username: string;
}

export interface SavedConnection {
  baseUrl: string;
  username: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** Authentication/APNs metadata only; never a cloud-workspace partition key. */
  deviceId?: string;
}
