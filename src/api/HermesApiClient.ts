import type {
  HermesQuery,
  HermesQueryValue,
} from './hermes-types';
import { AsyncDeadlineError } from './async-deadline';

export const HERMES_REQUEST_DEADLINE_MS = 30_000;

export interface HermesRequestOptions extends RequestInit {
  deadlineMs?: number;
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

export const HERMES_CLEARTEXT_BASE_URL_ERROR_CODE = 'HERMES_CLEARTEXT_BASE_URL';

/**
 * A stored or configured base URL uses cleartext http:// for a non-local host
 * without the EXPO_PUBLIC_HERMES_ALLOW_HTTP=1 opt-in. This verdict is decided
 * entirely on-device, so retrying can never change it: session restore must
 * treat it as terminal and surface remediation instead of spinning forever.
 * The dedicated class (and stable `code`) lets callers classify it without
 * matching on the message text.
 */
export class HermesCleartextBaseUrlError extends Error {
  readonly name = 'HermesCleartextBaseUrlError';
  readonly code = HERMES_CLEARTEXT_BASE_URL_ERROR_CODE;

  constructor() {
    super(
      'Hermes base URL must use HTTPS outside local development '
      + '(use an https:// server URL, or allow cleartext HTTP in a development '
      + 'build with EXPO_PUBLIC_HERMES_ALLOW_HTTP=1)',
    );
    Object.setPrototypeOf(this, HermesCleartextBaseUrlError.prototype);
  }
}

// Hermes traffic always carries bearer tokens, so cleartext HTTP is confined
// to development targets that never cross the open network: loopback hosts,
// mDNS `.local` names, and dev builds launched with EXPO_PUBLIC_HERMES_ALLOW_HTTP=1.
export function cleartextHttpAllowed(hostname: string): boolean {
  if (process.env.EXPO_PUBLIC_HERMES_ALLOW_HTTP === '1') return true;
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized)
    || normalized.endsWith('.local');
}

/**
 * Coding Pi is an independent companion service and may intentionally be
 * reached over a private LAN address during local development. Keep this
 * allowance separate from the Hermes origin policy: bearer-token traffic to
 * the public Hermes server still requires HTTPS, while RFC1918 Pi traffic is
 * confined to the user's local network.
 */
export function companionCleartextHttpAllowed(hostname: string): boolean {
  if (cleartextHttpAllowed(hostname)) return true;
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const parts = normalized.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 169 && parts[1] === 254
    || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
    || parts[0] === 192 && parts[1] === 168;
}

export function normalizeCompanionBaseUrl(input: string): string {
  const candidate = input.trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Invalid companion service URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Companion service URL must use HTTP or HTTPS');
  }
  if (url.protocol === 'http:' && !companionCleartextHttpAllowed(url.hostname)) {
    throw new HermesCleartextBaseUrlError();
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.href !== `${url.origin}/`) {
    throw new Error('Companion service URL must be a root origin');
  }
  return url.origin;
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
  if (url.protocol === 'http:' && !cleartextHttpAllowed(url.hostname)) {
    throw new HermesCleartextBaseUrlError();
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
  private readonly streamFetchImpl?: typeof fetch;
  // Shared promises for identical GETs currently on the wire; see request().
  private readonly inflightGets = new Map<string, Promise<unknown>>();

  constructor(
    baseUrl: string,
    credential: string | HermesAccessTokenProvider,
    fetchImpl: typeof fetch = fetch,
    streamFetchImpl?: typeof fetch,
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
    this.streamFetchImpl = streamFetchImpl;
  }

  /**
   * Socket.IO cannot use HermesApiClient.request(), but it still needs the
   * same bearer credential. Keep the token lookup in this client so realtime
   * features never have to persist or put credentials in a URL.
   */
  async getAccessTokenForRealtime(): Promise<string> {
    return this.resolveAccessToken();
  }

  /**
   * Create a same-credential client for an independent companion service.
   *
   * Coding Pi is allowed to live on a different origin from Hermes. Reusing
   * the provider keeps token refresh behavior identical without putting a
   * second credential in the React Native bundle. The companion service must
   * validate that bearer credential itself (normally at its reverse proxy).
   */
  forOrigin(baseUrl: string): HermesApiClient {
    const normalized = normalizeBaseUrl(baseUrl);
    if (normalized === this.baseUrl) return this;
    return new HermesApiClient(normalized, this.credential, this.fetchImpl, this.streamFetchImpl);
  }

  /** Create a same-credential client for a local companion such as Coding Pi. */
  forCompanionOrigin(baseUrl: string): HermesApiClient {
    const normalized = normalizeCompanionBaseUrl(baseUrl);
    if (normalized === this.baseUrl) return this;
    return new HermesApiClient(normalized, this.credential, this.fetchImpl, this.streamFetchImpl);
  }

  async request<T>(path: string, options: HermesRequestOptions = {}): Promise<T> {
    const {
      deadlineMs = HERMES_REQUEST_DEADLINE_MS,
      headers: callerHeaders,
      profile,
      query,
      redirect: unsupportedRedirect,
      signal: callerSignal,
      ...requestInit
    } = options;
    void unsupportedRedirect;
    const url = this.createSameOriginUrl(path);
    mergeQuery(url, query);
    if (profile !== undefined) url.searchParams.set('profile', profile);
    this.assertUrlHasNoCredentials(url, this.currentCredentialSecrets());

    const execute = () => withRequestDeadline(async (signal) => {
      const { response, attemptedTokens } = await this.fetchAuthorizedResponse(
        url,
        callerHeaders,
        { ...requestInit, signal },
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
    }, callerSignal, deadlineMs, 'Hermes request timed out');

    // Coalesce identical in-flight GETs. Route polling, the AppState listener,
    // and pull-to-refresh routinely fire the same snapshot GET while a slower
    // copy is still on the wire; the duplicates add radio time and parse work
    // without ever producing fresher data than the shared reply. Only the
    // plain polling shape joins a flight: a caller-supplied body, header set,
    // or abort signal opts out, so requests that differ in anything but
    // timing keep their own connection and cancelling one caller can never
    // cancel a stranger's. Entries are evicted on settle, which also means a
    // failed flight is shared only by the callers that raced it — later
    // callers start a fresh request instead of inheriting the stale error.
    const method = (requestInit.method || 'GET').toUpperCase();
    const coalescible = method === 'GET'
      && !requestInit.body
      && !callerHeaders
      && !callerSignal
      && Object.keys(requestInit).every((key) => key === 'method');
    if (!coalescible) return execute();
    const key = `${deadlineMs}|${url.toString()}`;
    const active = this.inflightGets.get(key);
    if (active) return active as Promise<T>;
    const flight = execute();
    this.inflightGets.set(key, flight);
    const evict = () => {
      if (this.inflightGets.get(key) === flight) this.inflightGets.delete(key);
    };
    flight.then(evict, evict);
    return flight;
  }

  async download(path: string, options: HermesRequestOptions = {}): Promise<Blob> {
    const {
      deadlineMs = HERMES_REQUEST_DEADLINE_MS,
      headers: callerHeaders,
      profile,
      query,
      redirect: unsupportedRedirect,
      signal: callerSignal,
      ...requestInit
    } = options;
    void unsupportedRedirect;
    const url = this.createSameOriginUrl(path);
    mergeQuery(url, query);
    if (profile !== undefined) url.searchParams.set('profile', profile);
    return withRequestDeadline(async (signal) => {
      const { response, attemptedTokens } = await this.fetchAuthorizedResponse(
        url,
        callerHeaders,
        { ...requestInit, signal },
      );
      if (!response.ok) {
        const body = await response.text();
        throw new HermesApiError(
          response.status,
          safeResponseDetail(body, response, attemptedTokens),
        );
      }
      return response.blob();
    }, callerSignal, deadlineMs, 'Hermes download timed out');
  }

  async consumeDownload<T>(
    path: string,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
    options: HermesRequestOptions = {},
  ): Promise<T> {
    const {
      deadlineMs = 120_000,
      headers: callerHeaders,
      profile,
      query,
      redirect: unsupportedRedirect,
      signal: callerSignal,
      ...requestInit
    } = options;
    void unsupportedRedirect;
    const url = this.createSameOriginUrl(path);
    mergeQuery(url, query);
    if (profile !== undefined) url.searchParams.set('profile', profile);
    return withRequestDeadline(async (signal) => {
      const streamFetch = this.streamFetchImpl
        ?? (await import('expo/fetch')).fetch as unknown as typeof fetch;
      const { response, attemptedTokens } = await this.fetchAuthorizedResponse(
        url,
        callerHeaders,
        { ...requestInit, cache: 'no-store', method: 'GET', signal },
        streamFetch,
      );
      if (!response.ok) {
        const body = await response.text();
        throw new HermesApiError(
          response.status,
          safeResponseDetail(body, response, attemptedTokens),
        );
      }
      return consume(response, signal);
    }, callerSignal, deadlineMs, 'Hermes download timed out');
  }

  async openEventStream(
    path: string,
    options: HermesRequestOptions = {},
  ): Promise<Response> {
    const {
      deadlineMs = HERMES_REQUEST_DEADLINE_MS,
      headers: callerHeaders,
      profile,
      query,
      redirect: unsupportedRedirect,
      signal,
      ...requestInit
    } = options;
    void unsupportedRedirect;
    const url = this.createSameOriginUrl(path);
    mergeQuery(url, query);
    if (profile !== undefined) url.searchParams.set('profile', profile);
    this.assertUrlHasNoCredentials(url, this.currentCredentialSecrets());
    const headers = new Headers(callerHeaders);
    headers.set('Accept', 'text/event-stream');
    const eventFetch = this.streamFetchImpl
      ?? (await import('expo/fetch')).fetch as unknown as typeof fetch;
    return withEventStreamConnectionDeadline(async (deadlineSignal) => {
      const { response, attemptedTokens } = await this.fetchAuthorizedResponse(
        url,
        headers,
        { ...requestInit, cache: 'no-store', method: 'GET', signal: deadlineSignal },
        eventFetch,
      );
      if (!response.ok) {
        const body = await response.text();
        throw new HermesApiError(
          response.status,
          safeResponseDetail(body, response, attemptedTokens),
        );
      }
      const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
      if (!contentType.includes('text/event-stream')) {
        throw new Error('Hermes returned a non-streaming hosted event response');
      }
      return response;
    }, signal, deadlineMs, 'Hermes event stream connection timed out');
  }

  createAttachmentUrl(path: string, query?: HermesQuery): string {
    const url = this.createSameOriginUrl(path);
    mergeQuery(url, query);
    this.assertUrlHasNoCredentials(url, this.currentCredentialSecrets());
    return url.toString();
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
    fetchImpl: typeof fetch = this.fetchImpl,
  ): Promise<{ attemptedTokens: string[]; response: Response }> {
    const accessToken = await this.resolveAccessToken();
    this.assertUrlHasNoCredentials(url, [accessToken]);
    // React Native's transport may follow redirects without preserving the
    // Authorization header. Always validate the final response origin when
    // the runtime exposes one; empty Response.url is common on RN and must
    // not abort an otherwise successful same-origin request.
    const requestedUrl = url.toString();
    let response = await this.fetchWithAccessToken(
      url,
      accessToken,
      callerHeaders,
      requestInit,
      fetchImpl,
    );
    this.assertResponseSameOrigin(response, requestedUrl);
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
        fetchImpl,
      );
      this.assertResponseSameOrigin(response, requestedUrl);
    }
    return { attemptedTokens, response };
  }

  private fetchWithAccessToken(
    url: URL,
    accessToken: string,
    callerHeaders: HeadersInit | undefined,
    requestInit: Omit<HermesRequestOptions, 'headers' | 'profile' | 'query' | 'redirect'>,
    fetchImpl: typeof fetch = this.fetchImpl,
  ): Promise<Response> {
    const headers = new Headers(callerHeaders);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetchImpl(url.toString(), { ...requestInit, headers });
  }

  private assertResponseSameOrigin(response: Response, requestedUrl: string): void {
    const finalRaw = response.url?.trim();
    // React Native / Expo often leave Response.url empty even for a direct
    // same-origin reply. Only reject when a final URL is present and points
    // off-origin (or carries userinfo), matching HermesCloudApi's contract.
    if (!finalRaw) return;
    let finalUrl: URL;
    try {
      finalUrl = new URL(finalRaw, requestedUrl);
    } catch {
      throw new Error('Hermes response origin could not be verified');
    }
    if (
      finalUrl.origin !== new URL(this.baseUrl).origin
      || finalUrl.username
      || finalUrl.password
    ) {
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
      // Reverse proxies commonly return an HTML error document for 429/5xx.
      // Never render that document in native banners or chat toasts.
      if (!looksLikeMarkup(body)) detail = body;
    }
  }
  detail = detail ?? (response.statusText || undefined);
  if (!detail) return undefined;
  return redactSecrets(detail, secrets).slice(0, 240);
}

function looksLikeMarkup(value: string): boolean {
  return /<\s*(?:!doctype|html|head|body|title|center|h1|hr)\b/i.test(value);
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

async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number,
  message: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AsyncDeadlineError(message);
  }
  if (callerSignal?.aborted) throw abortError();

  const controller = new AbortController();
  let rejectInterruption: (reason: Error) => void = () => undefined;
  const interruption = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const onCallerAbort = () => {
    rejectInterruption(abortError());
    controller.abort();
  };
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    rejectInterruption(new AsyncDeadlineError(message));
    controller.abort();
  }, timeoutMs);

  try {
    return await Promise.race([operation(controller.signal), interruption]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

async function withEventStreamConnectionDeadline(
  operation: (signal: AbortSignal) => Promise<Response>,
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number,
  message: string,
): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AsyncDeadlineError(message);
  }
  if (callerSignal?.aborted) throw abortError();

  const controller = new AbortController();
  let rejectInterruption: (reason: Error) => void = () => undefined;
  const interruption = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const onCallerAbort = () => {
    rejectInterruption(abortError());
    controller.abort();
  };
  const cleanupCallerAbort = () => {
    callerSignal?.removeEventListener('abort', onCallerAbort);
  };
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    rejectInterruption(new AsyncDeadlineError(message));
    controller.abort();
  }, timeoutMs);

  try {
    const response = await Promise.race([operation(controller.signal), interruption]);
    clearTimeout(timer);
    if (!response.body) {
      cleanupCallerAbort();
      return response;
    }
    return responseWithStreamingLifetime(
      response,
      controller,
      cleanupCallerAbort,
    );
  } catch (error) {
    clearTimeout(timer);
    cleanupCallerAbort();
    controller.abort();
    throw error;
  }
}

function responseWithStreamingLifetime(
  response: Response,
  requestController: AbortController,
  cleanup: () => void,
): Response {
  const source = response.body;
  if (!source) return response;
  const reader = source.getReader();
  let settled = false;
  let released = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    cleanup();
  };
  const release = () => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          settle();
          release();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        settle();
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      settle();
      requestController.abort();
      try {
        await reader.cancel(reason);
      } finally {
        release();
      }
    },
  });
  const wrapped = new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
  if (response.url) {
    Object.defineProperty(wrapped, 'url', { configurable: true, value: response.url });
  }
  return wrapped;
}

function abortError(): Error {
  const error = new Error('Hermes request was aborted');
  error.name = 'AbortError';
  return error;
}
