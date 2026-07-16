export const BASE_URL_STORAGE_KEY = 'hermes.native.baseUrl';
export const USERNAME_STORAGE_KEY = 'hermes.native.username';
export const ACCESS_TOKEN_STORAGE_KEY = 'hermes.native.accessToken';
export const REFRESH_TOKEN_STORAGE_KEY = 'hermes.native.refreshToken';
export const REFRESH_TOKEN_POINTER_STORAGE_KEY = 'hermes.native.refreshTokenKey';
export const REFRESH_TOKEN_KEY_PREFIX = 'hermes.native.refreshToken.';
export const ACCESS_EXPIRES_AT_STORAGE_KEY = 'hermes.native.accessExpiresAt';
export const DEVICE_ID_STORAGE_KEY = 'hermes.native.deviceId';
export const INSTALLATION_ID_STORAGE_KEY = 'hermes.native.installationId';
export const FACE_ID_PROMPT = '使用 Face ID 登录 Hermes';

export const CREDENTIAL_STORAGE_KEYS = [
  BASE_URL_STORAGE_KEY,
  USERNAME_STORAGE_KEY,
  ACCESS_TOKEN_STORAGE_KEY,
  REFRESH_TOKEN_STORAGE_KEY,
  REFRESH_TOKEN_POINTER_STORAGE_KEY,
  ACCESS_EXPIRES_AT_STORAGE_KEY,
  DEVICE_ID_STORAGE_KEY,
] as const;

export interface SavedConnection {
  baseUrl: string;
  username: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** Authentication/APNs metadata only; never a cloud-workspace partition key. */
  deviceId?: string;
}
