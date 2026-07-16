import type { HermesApiClient } from '../api/HermesApiClient';
import type { HermesNotificationTarget } from '../notifications/notification-target';

export interface FrontendPreviewAppProps {
  cacheOwner?: string;
  client?: HermesApiClient;
  notificationTarget?: HermesNotificationTarget | null;
}
