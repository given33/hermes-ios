import { normalizeBaseUrl } from '../api/HermesApiClient';

export type MobileAuthMode = 'register' | 'login';

export interface MobileAuthStatus {
  registrationOpen: boolean;
  accountConfigured: boolean;
  emailVerificationRequired: boolean;
  ownerEmailConfigured: boolean;
}

export interface RegistrationCodeDelivery {
  expiresIn: number;
  resendAfter: number;
}

export interface MobileAuthAccount {
  username: string;
  displayName: string;
}

export interface MobileDeviceIdentity {
  id: string;
  name: string;
  model: string;
  osVersion: string;
  appVersion: string;
}

export interface MobileAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  deviceId: string;
  account: MobileAuthAccount;
}

export class MobileAuthApiError extends Error {
  readonly name = 'MobileAuthApiError';

  constructor(
    readonly status: number,
    detail?: string,
  ) {
    super(
      detail
        ? `Hermes authentication failed (${status}): ${detail}`
        : `Hermes authentication failed (${status})`,
    );
    Object.setPrototypeOf(this, MobileAuthApiError.prototype);
  }

  toJSON(): { name: string; status: number; message: string } {
    return { name: this.name, status: this.status, message: this.message };
  }
}

export class MobileAuthApiClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async getStatus(): Promise<MobileAuthStatus> {
    const body = await this.request('/auth/mobile/status');
    if (!isRecord(body)) throw new Error('Hermes returned an invalid authentication status');
    const {
      registration_open: registrationOpen,
      account_configured: accountConfigured,
      email_verification_required: emailVerificationRequired,
      owner_email_configured: ownerEmailConfigured,
    } = body;
    if (
      typeof registrationOpen !== 'boolean'
      || typeof accountConfigured !== 'boolean'
      || typeof emailVerificationRequired !== 'boolean'
      || typeof ownerEmailConfigured !== 'boolean'
    ) {
      throw new Error('Hermes returned an invalid authentication status');
    }
    return {
      registrationOpen,
      accountConfigured,
      emailVerificationRequired,
      ownerEmailConfigured,
    };
  }

  register(
    email: string,
    verificationCode: string,
    username: string,
    password: string,
    device?: MobileDeviceIdentity,
  ): Promise<MobileAuthSession> {
    const normalizedEmail = email.trim().toLowerCase();
    const code = verificationCode.trim();
    if (!normalizedEmail) throw new Error('Hermes registration email is required');
    if (!/^\d{6}$/.test(code)) throw new Error('Hermes verification code must contain 6 digits');
    return this.exchangeCredentials(
      '/auth/mobile/register',
      username,
      password,
      device,
      { email: normalizedEmail, verification_code: code },
      [code],
    );
  }

  async requestRegistrationCode(email: string): Promise<RegistrationCodeDelivery> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Hermes registration email is required');
    const body = await this.request('/auth/mobile/registration-code', {
      method: 'POST',
      body: JSON.stringify({ email: normalizedEmail }),
    });
    if (!isRecord(body)) throw new Error('Hermes returned an invalid verification delivery');
    const { expires_in: expiresIn, resend_after: resendAfter, ok } = body;
    if (
      ok !== true
      || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0
      || typeof resendAfter !== 'number' || !Number.isFinite(resendAfter) || resendAfter < 0
    ) {
      throw new Error('Hermes returned an invalid verification delivery');
    }
    return { expiresIn, resendAfter };
  }

  login(
    username: string,
    password: string,
    device?: MobileDeviceIdentity,
  ): Promise<MobileAuthSession> {
    return this.exchangeCredentials('/auth/mobile/token', username, password, device);
  }

  async refresh(refreshToken: string): Promise<MobileAuthSession> {
    const token = refreshToken.trim();
    if (!token) throw new Error('Hermes refresh token is required');
    const body = await this.request(
      '/auth/mobile/refresh',
      {
        method: 'POST',
        body: JSON.stringify({ refresh_token: token }),
      },
      [token],
    );
    return parseSession(body);
  }

  async logout(refreshToken = '', accessToken = ''): Promise<void> {
    const headers = new Headers();
    if (accessToken.trim()) {
      headers.set('Authorization', `Bearer ${accessToken.trim()}`);
    }
    await this.request(
      '/auth/mobile/logout',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ refresh_token: refreshToken.trim() }),
      },
      [refreshToken, accessToken],
    );
  }

  private async exchangeCredentials(
    path: '/auth/mobile/register' | '/auth/mobile/token',
    username: string,
    password: string,
    device?: MobileDeviceIdentity,
    extraBody: Record<string, string> = {},
    extraSecrets: string[] = [],
  ): Promise<MobileAuthSession> {
    const normalizedUsername = username.trim();
    if (!normalizedUsername) throw new Error('Hermes username is required');
    if (!password) throw new Error('Hermes password is required');
    const body = await this.request(
      path,
      {
        method: 'POST',
        body: JSON.stringify({
          ...extraBody,
          username: normalizedUsername,
          password,
          ...(device ? { device: serializeDevice(device) } : {}),
        }),
      },
      [password, ...extraSecrets],
    );
    return parseSession(body);
  }

  private async request(
    path: string,
    init: RequestInit = {},
    secrets: string[] = [],
  ): Promise<unknown> {
    const url = new URL(path, `${this.baseUrl}/`);
    if (url.origin !== this.baseUrl) {
      throw new Error('Hermes authentication requests must remain same-origin');
    }
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');

    const response = await this.fetchImpl(url.toString(), { ...init, headers });
    assertSameOriginResponse(response, this.baseUrl);
    const text = await response.text();
    if (!response.ok) {
      throw new MobileAuthApiError(
        response.status,
        safeResponseDetail(text, response.statusText, secrets),
      );
    }
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('Hermes returned invalid authentication JSON');
    }
  }
}

export function resolveMobileAuthMode(status: MobileAuthStatus): MobileAuthMode {
  if (status.registrationOpen) return 'register';
  if (status.accountConfigured) return 'login';
  throw new Error('Hermes owner account is unavailable');
}

function parseSession(value: unknown): MobileAuthSession {
  if (!isRecord(value) || !isRecord(value.account)) {
    throw new Error('Hermes returned an invalid authentication session');
  }
  const accessToken = value.access_token;
  const refreshToken = value.refresh_token;
  const expiresAt = value.expires_at;
  const tokenType = value.token_type;
  const username = value.account.username;
  const displayName = value.account.display_name;
  const deviceId = value.device_id;
  if (
    typeof accessToken !== 'string' || !accessToken.trim()
    || typeof refreshToken !== 'string' || !refreshToken.trim()
    || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0
    || typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer'
    || typeof username !== 'string' || !username.trim()
    || typeof displayName !== 'string'
    || typeof deviceId !== 'string' || !deviceId.trim()
  ) {
    throw new Error('Hermes returned an invalid authentication session');
  }
  return {
    accessToken: accessToken.trim(),
    refreshToken: refreshToken.trim(),
    expiresAt,
    deviceId: deviceId.trim(),
    account: { username: username.trim(), displayName },
  };
}

function serializeDevice(device: MobileDeviceIdentity): Record<string, string> {
  const id = device.id.trim();
  if (!id) throw new Error('Hermes device id is required');
  return {
    id,
    name: device.name.trim(),
    model: device.model.trim(),
    os_version: device.osVersion.trim(),
    app_version: device.appVersion.trim(),
  };
}

function assertSameOriginResponse(response: Response, baseUrl: string): void {
  if (!response.url) throw new Error('Hermes authentication response origin could not be verified');
  let finalUrl: URL;
  try {
    finalUrl = new URL(response.url);
  } catch {
    throw new Error('Hermes authentication response origin could not be verified');
  }
  if (finalUrl.origin !== baseUrl) {
    throw new Error('Hermes authentication responses must remain same-origin');
  }
}

function safeResponseDetail(
  body: string,
  statusText: string,
  secrets: string[],
): string | undefined {
  let detail: string | undefined;
  if (body) {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (isRecord(parsed)) {
        detail = [parsed.detail, parsed.error, parsed.message]
          .find((value): value is string => typeof value === 'string');
      }
    } catch {
      detail = body;
    }
  }
  detail = detail ?? (statusText || undefined);
  if (!detail) return undefined;
  for (const secret of secrets.filter(Boolean)) {
    for (const encoded of [secret, encodeURIComponent(secret)]) {
      detail = detail.split(encoded).join('[redacted]');
    }
  }
  return detail.slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
