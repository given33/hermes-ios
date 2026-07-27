import type { HermesRequestOptions } from '../HermesApiClient';

export type CloudJsonMethod = 'DELETE' | 'PATCH' | 'POST' | 'PUT';
export type JsonRecord = Record<string, unknown>;

/**
 * The minimal transport surface a `cloud/<domain>` module receives from the
 * `HermesCloudApi` facade (audit finding H8: the facade stays the single
 * public entry point, domain modules own the endpoint bodies).
 *
 * Domain modules must never construct this themselves: the only
 * implementation is the closure the facade builds over its private
 * `request`/`json` shims, so every call still flows through the one
 * authenticated `HermesApiClient` owned by `hermes-api-registry.ts`.
 */
export interface HermesCloudTransport {
  download(path: string, options?: HermesRequestOptions): Promise<Blob>;
  json<T>(
    path: string,
    method: CloudJsonMethod,
    body: Record<string, unknown>,
    options?: HermesRequestOptions,
  ): Promise<T>;
  openEventStream(
    path: string,
    options?: Omit<HermesRequestOptions, 'deadlineMs'>,
  ): Promise<Response>;
  request<T>(path: string, options?: HermesRequestOptions): Promise<T>;
}
