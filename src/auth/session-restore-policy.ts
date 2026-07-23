import { HermesApiError } from '../api/HermesApiClient';
import { MobileAuthApiError } from './mobile-auth';

export function savedSessionFailureInvalidatesCredentials(error: unknown): boolean {
  if (error instanceof MobileAuthApiError || error instanceof HermesApiError) {
    return error.status >= 400
      && error.status < 500
      && ![408, 425, 429].includes(error.status);
  }
  const message = error instanceof Error ? error.message : String(error || '');
  return /refreshed a different account|incompatible mobile handshake/i.test(message);
}
