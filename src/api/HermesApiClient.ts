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
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey.trim();
    if (!this.apiKey) throw new Error('Hermes API key is required');
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
    this.assertUrlHasNoApiKey(url);

    const headers = new Headers(callerHeaders);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${this.apiKey}`);

    // React Native's whatwg-fetch ignores RequestInit.redirect. Its iOS native
    // transport follows redirects while rebuilding the redirected request
    // without the Authorization header, so validate the final URL before the
    // response body is consumed instead of claiming manual redirect handling.
    const response = await this.fetchImpl(url.toString(), { ...requestInit, headers });
    this.assertResponseSameOrigin(response);
    const body = await response.text();

    if (!response.ok) {
      throw new HermesApiError(
        response.status,
        safeResponseDetail(body, response, this.apiKey),
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

  createAttachmentUrl(path: string, query?: HermesQuery): string {
    const url = this.createSameOriginUrl(path);
    mergeQuery(url, query);
    this.assertUrlHasNoApiKey(url);
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
    this.assertUrlHasNoApiKey(url);
    return url;
  }

  private assertUrlHasNoApiKey(url: URL): void {
    const serialized = url.toString();
    const serializedLeak =
      this.apiKey.length >= 8 &&
      secretEncodings(this.apiKey).some((encoded) => serialized.includes(encoded));
    const decodedLeak = urlComponents(url).some((component) =>
      this.apiKey.length < 8
        ? component === this.apiKey
        : component.includes(this.apiKey),
    );
    if (serializedLeak || decodedLeak) {
      throw new Error('Hermes credentials must not appear in request URLs');
    }
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

function safeResponseDetail(body: string, response: Response, apiKey: string): string | undefined {
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
  return redactSecret(detail, apiKey).slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

function redactSecret(value: string, apiKey: string): string {
  let redacted = value;
  for (const encoded of secretEncodings(apiKey).sort(
    (left, right) => right.length - left.length,
  )) {
    redacted = redacted.split(encoded).join('[redacted]');
  }
  return redacted.replace(/\bauthorization\s*[:=][^\r\n]*/gi, '[redacted header]');
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
