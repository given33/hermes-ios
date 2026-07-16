import type { HermesApiClient } from '../api/HermesApiClient';
import type { HermesNotificationTarget } from '../notifications/notification-target';

export interface FrontendPreviewAppProps {
  client?: HermesApiClient;
  notificationTarget?: HermesNotificationTarget | null;
}
