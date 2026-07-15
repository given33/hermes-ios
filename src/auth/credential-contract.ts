export const BASE_URL_STORAGE_KEY = 'hermes.native.baseUrl';
export const API_KEY_STORAGE_KEY = 'hermes.native.apiKey';
export const FACE_ID_PROMPT = '使用 Face ID 登录 Hermes';

export const CREDENTIAL_STORAGE_KEYS = [
  BASE_URL_STORAGE_KEY,
  API_KEY_STORAGE_KEY,
] as const;

export interface SavedConnection {
  baseUrl: string;
  apiKey: string;
}
