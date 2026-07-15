import type { WebSocketTicketResponse } from './hermes-types';

export type HermesWebSocketPath = '/api/ws' | '/api/events';

const WEB_SOCKET_PATHS = new Set<string>(['/api/ws', '/api/events']);

export function assertWebSocketPath(path: string): asserts path is HermesWebSocketPath {
  if (!WEB_SOCKET_PATHS.has(path)) {
    throw new Error('Unsupported Hermes WebSocket path');
  }
}

export async function mintWebSocketTicket(
  requestTicket: () => Promise<WebSocketTicketResponse>,
): Promise<string> {
  const response = await requestTicket();
  if (
    typeof response?.ticket !== 'string' ||
    response.ticket.length === 0 ||
    !Number.isFinite(response.ttl_seconds) ||
    response.ttl_seconds <= 0
  ) {
    throw new Error('Hermes returned an invalid WebSocket ticket');
  }
  return response.ticket;
}

export function buildWebSocketUrl(
  baseUrl: string,
  path: HermesWebSocketPath,
  ticket: string,
  profile?: string,
): string {
  assertWebSocketPath(path);
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = path;
  url.search = '';
  url.hash = '';
  url.searchParams.set('ticket', ticket);
  if (profile !== undefined) url.searchParams.set('profile', profile);
  return url.toString();
}
