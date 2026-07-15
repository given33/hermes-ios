import { normalizeBaseUrl } from '../api/HermesApiClient';
import {
  API_KEY_STORAGE_KEY,
  BASE_URL_STORAGE_KEY,
  FACE_ID_PROMPT,
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

const PROTECTED_API_KEY_OPTIONS = Object.freeze({
  requireAuthentication: true,
  authenticationPrompt: FACE_ID_PROMPT,
});

export class CredentialStore implements CredentialWriter {
  constructor(private readonly secureStore: SecureStoreAdapter) {}

  readBaseUrl(): Promise<string | null> {
    return this.secureStore.getItemAsync(BASE_URL_STORAGE_KEY);
  }

  readApiKey(): Promise<string | null> {
    return this.secureStore.getItemAsync(API_KEY_STORAGE_KEY, PROTECTED_API_KEY_OPTIONS);
  }

  async save(connection: SavedConnection): Promise<void> {
    try {
      await this.secureStore.setItemAsync(BASE_URL_STORAGE_KEY, connection.baseUrl);
      await this.secureStore.setItemAsync(
        API_KEY_STORAGE_KEY,
        connection.apiKey,
        PROTECTED_API_KEY_OPTIONS,
      );
    } catch {
      await Promise.allSettled([
        this.secureStore.deleteItemAsync(API_KEY_STORAGE_KEY),
        this.secureStore.deleteItemAsync(BASE_URL_STORAGE_KEY),
      ]);
      throw new Error('Unable to save Hermes credentials');
    }
  }

  async clear(): Promise<void> {
    const results = await Promise.allSettled([
      this.secureStore.deleteItemAsync(API_KEY_STORAGE_KEY),
      this.secureStore.deleteItemAsync(BASE_URL_STORAGE_KEY),
    ]);
    if (results.some(({ status }) => status === 'rejected')) {
      throw new Error('Unable to clear Hermes credentials');
    }
  }
}

export async function provisionConnection(
  input: SavedConnection,
  dependencies: {
    store: CredentialWriter;
    verify(connection: SavedConnection): Promise<void>;
  },
): Promise<SavedConnection> {
  const connection = {
    baseUrl: normalizeBaseUrl(input.baseUrl),
    apiKey: input.apiKey.trim(),
  };
  if (!connection.apiKey) throw new Error('Hermes API key is required');

  await dependencies.verify(connection);
  await dependencies.store.save(connection);
  return connection;
}
