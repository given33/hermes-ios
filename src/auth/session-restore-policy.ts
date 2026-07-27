import {
  HERMES_CLEARTEXT_BASE_URL_ERROR_CODE,
  HermesApiError,
  HermesCleartextBaseUrlError,
} from '../api/HermesApiClient';
import { MobileAuthApiError } from './mobile-auth';

// The cleartext-HTTP hardening rejects a saved http:// base URL before any
// request leaves the device. Retrying can never change that verdict, so the
// stored session must be invalidated instead of spinning the cold-start
// restore forever.
export function savedSessionFailureIsCleartextBaseUrl(error: unknown): boolean {
  if (error instanceof HermesCleartextBaseUrlError) return true;
  if (
    error instanceof Error
    && (error as { code?: unknown }).code === HERMES_CLEARTEXT_BASE_URL_ERROR_CODE
  ) {
    return true;
  }
  // Wrapping layers may re-throw a plain copy that loses the prototype and
  // code; the message token stays unambiguous enough for a fallback match.
  const message = error instanceof Error ? error.message : String(error || '');
  return /base URL must use HTTPS outside local development/i.test(message);
}

export function savedSessionFailureInvalidatesCredentials(error: unknown): boolean {
  if (error instanceof MobileAuthApiError || error instanceof HermesApiError) {
    return error.status >= 400
      && error.status < 500
      && ![408, 425, 429].includes(error.status);
  }
  if (savedSessionFailureIsCleartextBaseUrl(error)) return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /refreshed a different account|incompatible mobile handshake/i.test(message);
}
