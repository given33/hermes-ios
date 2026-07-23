import { HermesApiError } from './HermesApiClient';
import type { HostedTurnEnqueueResponse } from './HermesCloudApi';
import type { HostedTurnOutboxItem } from './conversation-local-store';

export const HOSTED_TURN_MAX_DELIVERY_ATTEMPTS = 5;
export const HOSTED_TURN_MAX_RECONCILIATION_ATTEMPTS = 5;
export const HOSTED_TURN_RETRY_DELAY_MS = 60_000;

export interface HostedTurnDeliveryFailure {
  certainty: 'definitive' | 'uncertain';
  code: string;
  message: string;
  retryable: boolean;
}

export interface HostedTurnDeliveryDecision {
  failure: HostedTurnDeliveryFailure;
  item: HostedTurnOutboxItem;
  terminal: boolean;
}

export class HostedTurnDeliveryClaimRegistry {
  private readonly claims = new Map<string, symbol>();

  tryAcquire(key: string): symbol | null {
    const normalized = key.trim();
    if (!normalized || this.claims.has(normalized)) return null;
    const token = Symbol(normalized);
    this.claims.set(normalized, token);
    return token;
  }

  release(key: string, token: symbol): boolean {
    const normalized = key.trim();
    if (!normalized || this.claims.get(normalized) !== token) return false;
    this.claims.delete(normalized);
    return true;
  }

  isClaimed(key: string): boolean {
    return this.claims.has(key.trim());
  }
}

export function hostedTurnDeliveryClaimKey(owner: string, requestId: string): string {
  return `${owner.trim().toLowerCase()}\u0000${requestId.trim()}`;
}

export function hostedTurnResponseFailure(
  response: HostedTurnEnqueueResponse,
): HostedTurnDeliveryFailure | null {
  if (response.accepted) return null;
  const code = response.error?.code?.trim() || 'HOSTED_TURN_REJECTED';
  const message = response.error?.message?.trim() || 'Hermes rejected the hosted turn.';
  return {
    certainty: 'definitive',
    code,
    message: message.includes(code) ? message : `${code}: ${message}`,
    retryable: response.error?.retryable === true,
  };
}

export function hostedTurnTransportFailure(error: unknown): HostedTurnDeliveryFailure {
  if (error instanceof HermesApiError) {
    const uncertain = error.status === 408 || error.status >= 500;
    return {
      certainty: uncertain ? 'uncertain' : 'definitive',
      code: `HTTP_${error.status}`,
      message: error.message,
      retryable: error.status === 408 || error.status === 425 || error.status === 429
        || error.status >= 500,
    };
  }
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'The Hermes request failed.';
  return {
    certainty: 'uncertain',
    code: 'TRANSPORT_ERROR',
    message,
    retryable: /network|fetch|offline|timed?\s*out|timeout|connection|socket/i.test(message),
  };
}

export function decideHostedTurnDeliveryFailure(
  item: HostedTurnOutboxItem,
  failure: HostedTurnDeliveryFailure,
  now = Date.now(),
): HostedTurnDeliveryDecision {
  const attempts = Math.max(0, Math.floor(item.attempts || 0)) + 1;
  const reconciliationAttempts = item.foregroundFailedAt
    ? Math.max(0, Math.floor(item.reconciliationAttempts || 0)) + 1
    : Math.max(0, Math.floor(item.reconciliationAttempts || 0));
  // A transport exception does not prove that the idempotent enqueue failed.
  // Keep it durable after the fifth visible attempt so a later replay can
  // recover a response that was lost after the server committed the turn.
  const reconciliationExhausted = failure.certainty === 'uncertain'
    && Boolean(item.foregroundFailedAt)
    && reconciliationAttempts >= HOSTED_TURN_MAX_RECONCILIATION_ATTEMPTS;
  const terminal = !failure.retryable
    || (
      failure.certainty === 'definitive'
      && attempts >= HOSTED_TURN_MAX_DELIVERY_ATTEMPTS
    )
    || reconciliationExhausted;
  return {
    failure,
    item: {
      ...item,
      attempts: Math.min(attempts, HOSTED_TURN_MAX_DELIVERY_ATTEMPTS),
      reconciliationAttempts: Math.min(
        reconciliationAttempts,
        HOSTED_TURN_MAX_RECONCILIATION_ATTEMPTS,
      ),
      ...(reconciliationExhausted ? { reconciliationExhaustedAt: now } : {}),
      lastError: failure.message,
      nextAttemptAt: terminal ? 0 : now + HOSTED_TURN_RETRY_DELAY_MS,
    },
    terminal,
  };
}

export function hostedTurnOutboxReady(
  item: HostedTurnOutboxItem,
  now = Date.now(),
): boolean {
  return !item.nextAttemptAt || item.nextAttemptAt <= now;
}
