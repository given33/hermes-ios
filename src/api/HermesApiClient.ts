import type {
  HermesQuery,
  HermesQueryValue,
  WebSocketTicketResponse,
} from './hermes-types';
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
  if (url.hash) {
    throw new Error('Hermes base URL must not contain a fragment');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${pathname}${url.search}`;
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
    const { headers: callerHeaders, profile, query, ...requestInit } = options;
    const url = this.createSameOriginUrl(path);
    mergeQuery(url, query);
    if (profile !== undefined) url.searchParams.set('profile', profile);
    this.assertUrlHasNoApiKey(url);

    const headers = new Headers(callerHeaders);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${this.apiKey}`);

    const response = await this.fetchImpl(url.toString(), {
      ...requestInit,
      headers,
      redirect: 'manual',
    });
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
    const encoded = encodeURIComponent(this.apiKey);
    const longKeyLeaked =
      this.apiKey.length >= 8 &&
      (serialized.includes(this.apiKey) || serialized.includes(encoded));
    const shortKeyLeaked =
      this.apiKey.length < 8 &&
      urlComponents(url).some((component) => component === this.apiKey);
    if (longKeyLeaked || shortKeyLeaked) {
      throw new Error('Hermes credentials must not appear in request URLs');
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
  let redacted = value.split(apiKey).join('[redacted]');
  const encoded = encodeURIComponent(apiKey);
  if (encoded !== apiKey) redacted = redacted.split(encoded).join('[redacted]');
  return redacted.replace(/\bauthorization\s*[:=][^\r\n]*/gi, '[redacted header]');
}
