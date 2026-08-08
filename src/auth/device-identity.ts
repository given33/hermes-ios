import { INSTALLATION_ID_STORAGE_KEY } from './credential-contract';
import type { MobileDeviceIdentity } from './mobile-auth';

export interface InstallationIdStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

export interface NativeDeviceMetadata {
  appVersion?: string | null;
  deviceName?: string | null;
  modelId?: string | null;
  modelName?: string | null;
  osName?: string | null;
  osVersion?: string | null;
}

// A re-signed iOS build can lose access to the original Keychain container
// even though the app itself is otherwise usable. The installation ID is
// useful for device/session management, but it is not an authentication
// secret and must never make a correct password login fail. Keep a process
// fallback so repeated login attempts in that environment do not create a
// new device on every attempt.
let volatileInstallationId = '';

export async function getMobileDeviceIdentity(
  store: InstallationIdStore,
  metadata: NativeDeviceMetadata,
  createId: () => string = createInstallationId,
): Promise<MobileDeviceIdentity> {
  let id = '';
  let storageReadFailed = false;
  try {
    id = normalizeInstallationId(await store.getItemAsync(INSTALLATION_ID_STORAGE_KEY));
  } catch {
    // Keychain access is an optional persistence enhancement for this value.
    // Continue with the volatile fallback below when a signing profile or
    // Keychain access group prevents the read.
    storageReadFailed = true;
  }
  if (!id) {
    id = volatileInstallationId || normalizeInstallationId(createId());
    if (!id) throw new Error('Unable to create a stable Hermes device id');
    let storageWriteFailed = false;
    try {
      await store.setItemAsync(INSTALLATION_ID_STORAGE_KEY, id);
    } catch {
      // The server only needs a valid device identifier for this session. A
      // failed persistence write must not turn successful remote auth into a
      // generic "cannot verify Hermes connection" error.
      storageWriteFailed = true;
    }
    if (storageReadFailed || storageWriteFailed) volatileInstallationId = id;
  }
  const model = [metadata.modelName, metadata.modelId]
    .map(clean)
    .filter(Boolean)
    .join(' · ');
  const osVersion = [metadata.osName, metadata.osVersion]
    .map(clean)
    .filter(Boolean)
    .join(' ');
  return {
    id,
    name: clean(metadata.deviceName) || clean(metadata.modelName) || 'Hermes iOS',
    model,
    osVersion,
    appVersion: clean(metadata.appVersion),
  };
}

export function createInstallationId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `ios_${randomUuid}`;
  const random = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `ios_${Date.now().toString(36)}_${random()}_${random()}`;
}

function normalizeInstallationId(value: string | null | undefined): string {
  const normalized = clean(value);
  if (
    normalized.length < 8
    || normalized.length > 128
    || !/^[A-Za-z0-9._:-]+$/.test(normalized)
  ) {
    return '';
  }
  return normalized;
}

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}
