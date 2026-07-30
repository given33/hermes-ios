export type NotificationResponseOutcome = 'deferred' | 'discarded' | 'processed' | 'retry';

interface SmartWeatherNotificationProcessing {
  fallback(): Promise<unknown>;
  isCurrentAccount(): boolean;
  markHandled(): void;
  persistNative?: () => Promise<boolean | null>;
  publishTarget(): void;
}

export async function processSmartWeatherNotificationResponse({
  fallback,
  isCurrentAccount,
  markHandled,
  persistNative,
  publishTarget,
}: SmartWeatherNotificationProcessing): Promise<NotificationResponseOutcome> {
  if (!isCurrentAccount()) return 'discarded';
  try {
    let persisted = false;
    if (persistNative) {
      const result = await persistNative();
      if (!isCurrentAccount()) return 'discarded';
      if (result === null) return 'discarded';
      persisted = result;
    }
    if (!persisted) {
      if (!isCurrentAccount()) return 'discarded';
      await fallback();
      if (!isCurrentAccount()) return 'discarded';
    }
    markHandled();
    publishTarget();
    return 'processed';
  } catch {
    return isCurrentAccount() ? 'retry' : 'discarded';
  }
}
