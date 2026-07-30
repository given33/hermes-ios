export interface NotificationCleanupOperations {
  cancelAllScheduledNotifications(): Promise<void>;
  clearLastResponse(): Promise<void>;
  dismissAllNotifications(): Promise<void>;
  clearBadge(): Promise<void>;
}

export async function clearNotificationState(
  operations: NotificationCleanupOperations,
): Promise<void> {
  const results = await Promise.allSettled([
    operations.cancelAllScheduledNotifications(),
    operations.clearLastResponse(),
    operations.dismissAllNotifications(),
    operations.clearBadge(),
  ]);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (!failure) return;
  if (failure.reason instanceof Error) throw failure.reason;
  throw new Error('Hermes could not clear account notifications');
}
