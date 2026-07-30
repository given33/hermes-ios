import type { SavedConnection } from '../auth/credential-contract';
import {
  notificationMatchesAccount,
  type HermesNotificationTarget,
} from './notification-target';

type NotificationAccount = Pick<
  SavedConnection,
  'accountGeneration' | 'baseUrl' | 'username'
>;

export interface AccountBoundNotificationTarget {
  accountKey: string;
  target: HermesNotificationTarget;
}

export function notificationAccountKey(
  connection: NotificationAccount | null | undefined,
): string | null {
  if (!connection) return null;
  const baseUrl = connection.baseUrl.trim().toLowerCase();
  const username = connection.username.trim().toLowerCase();
  const accountGeneration = connection.accountGeneration.trim();
  if (!baseUrl || !username || !accountGeneration) return null;
  return JSON.stringify([baseUrl, username, accountGeneration]);
}

export function bindNotificationTarget(
  target: HermesNotificationTarget,
  connection: NotificationAccount | null | undefined,
): AccountBoundNotificationTarget | null {
  const accountKey = notificationAccountKey(connection);
  if (!accountKey || !connection || !notificationMatchesAccount(
    target,
    connection.username,
    connection.accountGeneration,
  )) return null;
  return { accountKey, target };
}

export function notificationTargetForAccount(
  bound: AccountBoundNotificationTarget | null,
  connection: NotificationAccount | null | undefined,
): HermesNotificationTarget | null {
  return bound?.accountKey === notificationAccountKey(connection)
    ? bound.target
    : null;
}
