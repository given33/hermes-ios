import type { HermesApiClient } from '../api/HermesApiClient';

export type ApnsEnvironment = 'sandbox' | 'production';
export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export interface NativePushToken {
  type: string;
  data: unknown;
}

export interface ApnsRegistrationRuntime {
  readonly available: boolean;
  getPermission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  getDevicePushToken(): Promise<NativePushToken>;
}

export interface ApnsRegistrationConfig {
  bundleId: string;
  environment: ApnsEnvironment;
}

export interface MobileNotificationDevice {
  id: string;
  name: string;
  model: string;
  osVersion: string;
  appVersion: string;
  createdAt: number;
  lastSeenAt: number;
  active: boolean;
  current: boolean;
  apns: Array<{
    id: string;
    environment: string;
    bundleId: string;
    tokenSuffix: string;
    updatedAt: number;
  }>;
}

export interface MobileNotificationApi {
  resolveCurrentDeviceId(preferredDeviceId?: string): Promise<string>;
  registerApns(
    deviceId: string,
    token: string,
    config: ApnsRegistrationConfig,
  ): Promise<void>;
  unregisterApns(deviceId: string): Promise<void>;
}

export type ApnsSynchronizationResult =
  | { status: 'unavailable' }
  | { status: 'denied'; deviceId: string }
  | { status: 'registered'; deviceId: string; token: string };

/**
 * Auth/device delivery metadata only. All conversations and settings continue
 * to use the one account-owned server workspace through their canonical APIs.
 */
export class HermesMobileNotificationApi implements MobileNotificationApi {
  constructor(private readonly client: HermesApiClient) {}

  /** Read the account-scoped mobile sessions through the official owner API. */
  async listDevices(): Promise<MobileNotificationDevice[]> {
    const response = await this.client.request<unknown>('/api/mobile/v1/devices');
    if (!isRecord(response) || !Array.isArray(response.devices)) {
      throw new Error('Hermes returned an invalid device list');
    }
    return response.devices
      .map(normalizeMobileDevice)
      .filter((device): device is MobileNotificationDevice => device !== null);
  }

  /** Revoke every refresh/access session owned by one account device. */
  async revokeDevice(deviceId: string): Promise<void> {
    await this.client.request(
      `/api/mobile/v1/devices/${encodeURIComponent(requireDeviceId(deviceId))}`,
      { method: 'DELETE' },
    );
  }

  async resolveCurrentDeviceId(preferredDeviceId = ''): Promise<string> {
    const preferred = preferredDeviceId.trim();
    if (preferred) return preferred;
    const response = await this.client.request<unknown>('/api/mobile/v1/devices');
    if (!isRecord(response) || !Array.isArray(response.devices)) {
      throw new Error('Hermes returned an invalid device list');
    }
    const current = response.devices.find(
      (value): value is Record<string, unknown> =>
        isRecord(value) && value.current === true && typeof value.id === 'string',
    );
    const deviceId = typeof current?.id === 'string' ? current.id.trim() : '';
    if (!deviceId) throw new Error('Hermes current device was not found');
    return deviceId;
  }

  async registerApns(
    deviceId: string,
    token: string,
    config: ApnsRegistrationConfig,
  ): Promise<void> {
    await this.client.request(
      `/api/mobile/v1/devices/${encodeURIComponent(requireDeviceId(deviceId))}/apns`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: normalizeApnsToken(token),
          environment: config.environment,
          bundle_id: config.bundleId,
        }),
      },
    );
  }

  async unregisterApns(deviceId: string): Promise<void> {
    await this.client.request(
      `/api/mobile/v1/devices/${encodeURIComponent(requireDeviceId(deviceId))}/apns`,
      { method: 'DELETE' },
    );
  }
}

export async function synchronizeApnsRegistration(
  api: MobileNotificationApi,
  preferredDeviceId: string | undefined,
  runtime: ApnsRegistrationRuntime,
  config: ApnsRegistrationConfig,
  suppliedToken?: NativePushToken,
  options: { requestUndeterminedPermission?: boolean } = {},
): Promise<ApnsSynchronizationResult> {
  if (!runtime.available) return { status: 'unavailable' };
  const deviceId = await api.resolveCurrentDeviceId(preferredDeviceId);
  let permission = await runtime.getPermission();
  if (permission === 'undetermined' && options.requestUndeterminedPermission !== false) {
    permission = await runtime.requestPermission();
  }
  if (permission !== 'granted') {
    await api.unregisterApns(deviceId).catch(() => undefined);
    return { status: 'denied', deviceId };
  }
  const nativeToken = suppliedToken ?? await runtime.getDevicePushToken();
  if (nativeToken.type !== 'ios' || typeof nativeToken.data !== 'string') {
    throw new Error('Hermes requires a native iOS APNs token');
  }
  const token = normalizeApnsToken(nativeToken.data);
  await api.registerApns(deviceId, token, config);
  return { status: 'registered', deviceId, token };
}

export function normalizeApnsToken(value: string): string {
  let token = value.trim();
  if (token.startsWith('<') && token.endsWith('>')) token = token.slice(1, -1);
  token = token.replace(/\s+/g, '').toLowerCase();
  if (
    token.length < 32
    || token.length > 256
    || token.length % 2 !== 0
    || !/^[0-9a-f]+$/.test(token)
  ) {
    throw new Error('Invalid native APNs token');
  }
  return token;
}

function requireDeviceId(value: string): string {
  const deviceId = value.trim();
  if (!deviceId) throw new Error('Hermes device id is required');
  return deviceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMobileDevice(value: unknown): MobileNotificationDevice | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null;
  const rawApns = Array.isArray(value.apns) ? value.apns : [];
  return {
    id: value.id.trim(),
    name: typeof value.name === 'string' ? value.name.trim() : '',
    model: typeof value.model === 'string' ? value.model.trim() : '',
    osVersion: typeof value.os_version === 'string' ? value.os_version.trim() : '',
    appVersion: typeof value.app_version === 'string' ? value.app_version.trim() : '',
    createdAt: finiteNumber(value.created_at),
    lastSeenAt: finiteNumber(value.last_seen_at),
    active: value.active === true,
    current: value.current === true,
    apns: rawApns
      .filter(isRecord)
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        environment: typeof item.environment === 'string' ? item.environment : '',
        bundleId: typeof item.bundle_id === 'string' ? item.bundle_id : '',
        tokenSuffix: typeof item.token_suffix === 'string' ? item.token_suffix : '',
        updatedAt: finiteNumber(item.updated_at),
      })),
  };
}

function finiteNumber(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}
