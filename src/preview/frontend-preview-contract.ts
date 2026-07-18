import type { HermesApiClient } from '../api/HermesApiClient';
import type { HermesNotificationTarget } from '../notifications/notification-target';

export interface FrontendPreviewAppProps {
  account?: {
    deleteAccount(): Promise<void>;
    logout(): Promise<void>;
    username: string;
  };
  cacheOwner?: string;
  client?: HermesApiClient;
  notificationTarget?: HermesNotificationTarget | null;
}
