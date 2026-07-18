import type { HermesApiClient } from '../api/HermesApiClient';

const IOS_INTELLIGENCE = '/api/plugins/ios-intelligence';

export interface IOSContextEvent {
  id: string;
  kind: string;
  source_device_id?: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface IOSIntelligenceSnapshot {
  date: string;
  timezone: string;
  server_time?: number;
  current_location?: {
    observed_at?: number;
    data?: Record<string, unknown>;
  } | null;
  trajectory: Array<{
    observed_at: number;
    latitude: number;
    longitude: number;
    horizontal_accuracy?: number | null;
    speed?: number | null;
    motion?: string;
  }>;
  places: Array<{
    place_id: string;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    arrived_at: number;
    departed_at?: number | null;
    indoor?: boolean | null;
  }>;
  active_forecast?: IOSActiveForecast[];
  active_forecasts?: IOSActiveForecast[];
}

export interface IOSActiveForecast {
  id?: string;
  title?: string;
  summary?: string;
  starts_at?: number;
  valid_from?: number;
  expires_at?: number;
  valid_until?: number;
  severity?: string;
  data?: {
    body?: string;
    id?: string;
    title?: string;
    summary?: string;
    starts_at?: number;
    expires_at?: number;
    severity?: string;
  };
}

export interface IOSDeviceCommand {
  id: string;
  capability: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: number;
  expires_at?: number | null;
}

export class IOSIntelligenceApi {
  constructor(private readonly client: HermesApiClient) {}

  snapshot(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai') {
    return this.client.request<IOSIntelligenceSnapshot>(
      `${IOS_INTELLIGENCE}/snapshot?timezone=${encodeURIComponent(timezone)}`,
    );
  }

  uploadEvents(input: {
    cursor: string;
    deviceId: string;
    events: readonly IOSContextEvent[];
    timezone?: string;
  }) {
    return this.json<{ accepted: number; duplicates: number; next_cursor: string }>(
      `${IOS_INTELLIGENCE}/events/batch`,
      {
        cursor: input.cursor,
        device_id: input.deviceId,
        events: input.events,
        timezone: input.timezone
          || Intl.DateTimeFormat().resolvedOptions().timeZone
          || 'Asia/Shanghai',
      },
    );
  }

  recordCapabilities(deviceId: string, capabilities: Record<string, unknown>) {
    return this.json(`${IOS_INTELLIGENCE}/capabilities`, {
      device_id: deviceId,
      capabilities,
      observed_at: Date.now(),
    });
  }

  pullCommands(deviceId: string, cursor = '') {
    return this.json<{ commands: IOSDeviceCommand[]; cursor?: string }>(
      `${IOS_INTELLIGENCE}/commands/pull`,
      { device_id: deviceId, cursor, limit: 50 },
    );
  }

  acknowledgeCommand(
    deviceId: string,
    commandId: string,
    input: { error?: string; result?: Record<string, unknown>; status: 'completed' | 'failed' },
  ) {
    return this.json(`${IOS_INTELLIGENCE}/commands/${encodeURIComponent(commandId)}/ack`, {
      device_id: deviceId,
      status: input.status,
      result: input.result || {},
      error: input.error || '',
    });
  }

  evaluate() {
    return this.json<Record<string, unknown>>(`${IOS_INTELLIGENCE}/evaluate`, {});
  }

  feedback(input: {
    label: string;
    payload?: Record<string, unknown>;
    feedbackId?: string;
    observedAt?: number;
  }) {
    return this.json<Record<string, unknown>>(`${IOS_INTELLIGENCE}/feedback`, {
      label: input.label,
      payload: input.payload || {},
      feedback_id: input.feedbackId || '',
      observed_at: input.observedAt || Date.now(),
    });
  }

  exportAccount(exportPassphrase: string) {
    return this.json<{
      algorithm: string;
      blob_base64: string;
      bytes: number;
      encrypted: true;
      format: string;
      kdf: string;
      owner_id: string;
    }>(`${IOS_INTELLIGENCE}/account/export`, {
      encrypt: true,
      export_passphrase: exportPassphrase,
      include_cold: true,
    });
  }

  deleteAccount(ownerScope: string) {
    return this.json<{
      owner_id: string;
      deleted: Record<string, number>;
      cold_files_removed: number;
    }>(`${IOS_INTELLIGENCE}/account/delete`, {
      confirm: true,
      owner_scope: ownerScope,
    });
  }

  private json<T = Record<string, unknown>>(path: string, body: Record<string, unknown>) {
    return this.client.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
