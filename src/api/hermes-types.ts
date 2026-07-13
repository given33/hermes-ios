export type HermesQueryValue = string | number | boolean | undefined;
export type HermesQuery = Record<string, HermesQueryValue>;

export interface MobileHandshake {
  api_version: number;
  hermes_version: string;
  profiles: string[];
  capabilities: string[];
  server_time: string;
}

export function assertMobileHandshake(value: unknown): MobileHandshake {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as Partial<MobileHandshake>).api_version !== 1 ||
    typeof (value as Partial<MobileHandshake>).hermes_version !== 'string' ||
    !isStringArray((value as Partial<MobileHandshake>).profiles) ||
    !isStringArray((value as Partial<MobileHandshake>).capabilities) ||
    typeof (value as Partial<MobileHandshake>).server_time !== 'string'
  ) {
    throw new Error('Hermes returned an incompatible mobile handshake');
  }
  return value as MobileHandshake;
}

export interface WebSocketTicketResponse {
  ticket: string;
  ttl_seconds: number;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
