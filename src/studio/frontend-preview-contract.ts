import type { HermesApiClient } from '../api/HermesApiClient';
import type { HermesDeepLinkTarget } from '../app/hermes-deep-link';
import type { HermesNotificationTarget } from '../notifications/notification-target';

export interface FrontendPreviewAppProps {
  account?: {
    deleteAccount(): Promise<void>;
    logout(): Promise<void>;
    username: string;
  };
  cacheOwner?: string;
  client?: HermesApiClient;
  navigationTarget?: (HermesDeepLinkTarget & { requestId: number }) | null;
  notificationTarget?: HermesNotificationTarget | null;
}
