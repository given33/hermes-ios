import type {
  HermesQuery,
  HermesQueryValue,
  WebSocketTicketResponse,
} from './hermes-types';
import type {
  DashboardFontResponse,
  ThemeListResponse,
} from '../design/theme-types';
import {
  assertWebSocketPath,
  buildWebSocketUrl,
  mintWebSocketTicket,
  type HermesWebSocketPath,
} from './ws-ticket';

export interface HermesRequestOptions extends RequestInit {
  profile?: string;
  query?: HermesQuery;
}

export interface HermesAccessTokenRequest {
  forceRefresh?: boolean;
  rejectedToken?: string;
}

export interface HermesAccessTokenProvider {
  getAccessToken(request?: HermesAccessTokenRequest): Promise<string>;
  getCurrentAccessToken(): string | null;
}

export class HermesApiError extends Error {
  readonly name = 'HermesApiError';

  constructor(
    readonly status: number,
    detail?: string,
  ) {
    super(detail ? `Hermes request failed (${status}): ${detail}` : `Hermes request failed (${status})`);
    Object.setPrototypeOf(this, HermesApiError.prototype);
  }

  toJSON(): { name: string; status: number; message: string } {
    return { name: this.name, status: this.status, message: this.message };
  }
}

export function normalizeBaseUrl(input: string): string {
  const candidate = input.trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Invalid Hermes base URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Hermes base URL must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('Hermes base URL must not contain user information');
  }
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.href !== `${url.origin}/`
  ) {
    throw new Error('Hermes base URL must be a root origin');
  }

  return url.origin;
}

export class HermesApiClient {
  readonly baseUrl: string;
  private readonly credential: string | HermesAccessTokenProvider;
  private readonly fetchImpl: typeof fetch;

  constructor(
    baseUrl: string,
    credential: string | HermesAccessTokenProvider,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    if (typeof credential === 'string') {
      const accessToken = credential.trim();
      if (!accessToken) throw new Error('Hermes access token is required');
      this.credential = accessToken;
    } else {
      if (
        typeof credential?.getAccessToken !== 'function'
        || typeof credential.getCurrentAccessToken !== 'function'
      ) {
        throw new Error('Hermes access-token provider is required');
      }
      this.credential = credential;
    }
    this.fetchImpl = fetchImpl;
  }

  async request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
    const {
      headers: callerHeaders,
      profile,
      query,
      redirect: unsupportedRedirect,
      ...requestInit
    } = options;
    void unsupportedRedirect;
    const url = this.createSameOriginUrl(path);
    mergeQuery(url, query);
    if (profile !== undefined) url.searchParams.set('profile', profile);
    this.assertUrlHasNoCredentials(url, this.currentCredentialSecrets());

    const { response, attemptedTokens } = await this.fetchAuthorizedResponse(
      url,
      callerHeaders,
      requestInit,
    );
    const body = await response.text();

    if (!response.ok) {
      throw new HermesApiError(
        response.status,
        safeResponseDetail(body, response, attemptedTokens),
      );
    }
    if (!body) return undefined as T;

    const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
    if (contentType.includes('/json') || contentType.includes('+json')) {
      try {
        return JSON.parse(body) as T;
      } catch {
        throw new Error('Hermes returned invalid JSON');
      }
    }
    return body as T;
  }

  async download(path: string, options: HermesRequestOptions = {}): Promise<Blob> {
    const {
      headers: callerHeaders,
      profile,
      query,
      redirect: unsupportedRedirect,
      ...requestInit
    } = options;
    void unsupportedRedirect;
    const url = this.createSameOriginUrl(path);
    mergeQuery(url, query);
    if (profile !== undefined) url.searchParams.set('profile', profile);
    const { response, attemptedTokens } = await this.fetchAuthorizedResponse(
      url,
      callerHeaders,
      requestInit,
    );
    if (!response.ok) {
      const body = await response.text();
      throw new HermesApiError(
        response.status,
        safeResponseDetail(body, response, attemptedTokens),
      );
    }
    return response.blob();
  }

  createAttachmentUrl(path: string, query?: HermesQuery): string {
    const url = this.createSameOriginUrl(path);
    mergeQuery(url, query);
    this.assertUrlHasNoCredentials(url, this.currentCredentialSecrets());
    return url.toString();
  }

  async createWebSocketUrl(path: HermesWebSocketPath, profile?: string): Promise<string> {
    assertWebSocketPath(path);
    const ticket = await mintWebSocketTicket(() =>
      this.request<WebSocketTicketResponse>('/api/auth/ws-ticket', { method: 'POST' }),
    );
    return buildWebSocketUrl(this.baseUrl, path, ticket, profile);
  }

  getThemes(): Promise<ThemeListResponse> {
    return this.request<ThemeListResponse>('/api/dashboard/themes');
  }

  setTheme(name: string): Promise<{ ok: boolean; theme: string }> {
    return this.request('/api/dashboard/theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  getFontPref(): Promise<DashboardFontResponse> {
    return this.request<DashboardFontResponse>('/api/dashboard/font');
  }

  setFontPref(font: string): Promise<{ ok: boolean; font: string }> {
    return this.request('/api/dashboard/font', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ font }),
    });
  }

  private createSameOriginUrl(path: string): URL {
    let url: URL;
    try {
      url = new URL(path, `${this.baseUrl}/`);
    } catch {
      throw new Error('Invalid Hermes request URL');
    }
    if (url.origin !== new URL(this.baseUrl).origin) {
      throw new Error('Hermes requests must remain same-origin');
    }
    this.assertUrlHasNoCredentials(url, this.currentCredentialSecrets());
    return url;
  }

  private assertUrlHasNoCredentials(url: URL, secrets: string[]): void {
    const serialized = url.toString();
    for (const secret of secrets.filter(Boolean)) {
      const serializedLeak =
        secret.length >= 8
        && secretEncodings(secret).some((encoded) => serialized.includes(encoded));
      const decodedLeak = urlComponents(url).some((component) =>
        secret.length < 8 ? component === secret : component.includes(secret),
      );
      if (serializedLeak || decodedLeak) {
        throw new Error('Hermes credentials must not appear in request URLs');
      }
    }
  }

  private currentCredentialSecrets(): string[] {
    if (typeof this.credential === 'string') return [this.credential];
    const accessToken = this.credential.getCurrentAccessToken();
    return accessToken ? [accessToken] : [];
  }

  private async resolveAccessToken(): Promise<string> {
    return typeof this.credential === 'string'
      ? this.credential
      : normalizeAccessToken(await this.credential.getAccessToken());
  }

  private async fetchAuthorizedResponse(
    url: URL,
    callerHeaders: HeadersInit | undefined,
    requestInit: Omit<HermesRequestOptions, 'headers' | 'profile' | 'query' | 'redirect'>,
  ): Promise<{ attemptedTokens: string[]; response: Response }> {
    const accessToken = await this.resolveAccessToken();
    this.assertUrlHasNoCredentials(url, [accessToken]);
    // React Native's transport may follow redirects without preserving the
    // Authorization header. Always validate the final response origin.
    let response = await this.fetchWithAccessToken(
      url,
      accessToken,
      callerHeaders,
      requestInit,
    );
    this.assertResponseSameOrigin(response);
    const attemptedTokens = [accessToken];
    if (response.status === 401 && typeof this.credential !== 'string') {
      const refreshedToken = normalizeAccessToken(
        await this.credential.getAccessToken({
          forceRefresh: true,
          rejectedToken: accessToken,
        }),
      );
      attemptedTokens.push(refreshedToken);
      this.assertUrlHasNoCredentials(url, [refreshedToken]);
      response = await this.fetchWithAccessToken(
        url,
        refreshedToken,
        callerHeaders,
        requestInit,
      );
      this.assertResponseSameOrigin(response);
    }
    return { attemptedTokens, response };
  }

  private fetchWithAccessToken(
    url: URL,
    accessToken: string,
    callerHeaders: HeadersInit | undefined,
    requestInit: Omit<HermesRequestOptions, 'headers' | 'profile' | 'query' | 'redirect'>,
  ): Promise<Response> {
    const headers = new Headers(callerHeaders);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${accessToken}`);
    return this.fetchImpl(url.toString(), { ...requestInit, headers });
  }

  private assertResponseSameOrigin(response: Response): void {
    if (!response.url) {
      throw new Error('Hermes response origin could not be verified');
    }
    let finalUrl: URL;
    try {
      finalUrl = new URL(response.url);
    } catch {
      throw new Error('Hermes response origin could not be verified');
    }
    if (finalUrl.origin !== new URL(this.baseUrl).origin) {
      throw new Error('Hermes responses must remain same-origin');
    }
  }
}

function mergeQuery(url: URL, query?: Record<string, HermesQueryValue>): void {
  if (!query) return;
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
}

function urlComponents(url: URL): string[] {
  const pathSegments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  return [
    url.username,
    url.password,
    url.hash.slice(1),
    ...pathSegments,
    ...[...url.searchParams.entries()].flat(),
  ];
}

function safeResponseDetail(
  body: string,
  response: Response,
  secrets: string[],
): string | undefined {
  let detail: string | undefined;
  if (body) {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (isRecord(parsed)) {
        detail = firstString(parsed.detail, parsed.error, parsed.message);
      }
    } catch {
      detail = body;
    }
  }
  detail = detail ?? (response.statusText || undefined);
  if (!detail) return undefined;
  return redactSecrets(detail, secrets).slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

function redactSecrets(value: string, secrets: string[]): string {
  let redacted = value;
  for (const secret of secrets.filter(Boolean)) {
    for (const encoded of secretEncodings(secret).sort(
      (left, right) => right.length - left.length,
    )) {
      redacted = redacted.split(encoded).join('[redacted]');
    }
  }
  return redacted.replace(/\bauthorization\s*[:=][^\r\n]*/gi, '[redacted header]');
}

function normalizeAccessToken(value: string): string {
  const accessToken = value.trim();
  if (!accessToken) throw new Error('Hermes access-token provider returned an empty token');
  return accessToken;
}

function secretEncodings(secret: string): string[] {
  const uriEncoded = encodeURIComponent(secret);
  const formEncoded = new URLSearchParams([['secret', secret]])
    .toString()
    .slice('secret='.length);
  return [...new Set([
    secret,
    uriEncoded,
    percentEscapesToLowerCase(uriEncoded),
    formEncoded,
    percentEscapesToLowerCase(formEncoded),
  ])];
}

function percentEscapesToLowerCase(value: string): string {
  return value.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());
}
