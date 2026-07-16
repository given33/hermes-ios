import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import type {
  ApnsEnvironment,
  ApnsRegistrationConfig,
  ApnsRegistrationRuntime,
  NativePushToken,
  NotificationPermission,
} from './mobile-notifications';

export interface ExpoNotificationRuntime extends ApnsRegistrationRuntime {
  configureForegroundPresentation(): Promise<void>;
  getLastResponse(): Promise<unknown>;
  clearLastResponse(): Promise<void>;
  subscribeResponses(listener: (response: unknown) => void): Promise<() => void>;
  subscribePushTokens(listener: (token: NativePushToken) => void): Promise<() => void>;
}

export function createExpoNotificationRuntime(): ExpoNotificationRuntime {
  const available = Platform.OS === 'ios'
    && Device.isDevice
    && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
  return {
    available,
    async configureForegroundPresentation() {
      if (!available) return;
      const Notifications = await import('expo-notifications');
      Notifications.setNotificationHandler({
        async handleNotification() {
          return {
            shouldPlaySound: true,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          };
        },
      });
    },
    async getPermission() {
      if (!available) return 'denied';
      const Notifications = await import('expo-notifications');
      return permissionFromStatus(await Notifications.getPermissionsAsync());
    },
    async requestPermission() {
      if (!available) return 'denied';
      const Notifications = await import('expo-notifications');
      return permissionFromStatus(await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      }));
    },
    async getDevicePushToken() {
      if (!available) throw new Error('Native APNs is unavailable in this runtime');
      const Notifications = await import('expo-notifications');
      return Notifications.getDevicePushTokenAsync();
    },
    async getLastResponse() {
      if (!available) return null;
      const Notifications = await import('expo-notifications');
      return Notifications.getLastNotificationResponseAsync();
    },
    async clearLastResponse() {
      if (!available) return;
      const Notifications = await import('expo-notifications');
      await Notifications.clearLastNotificationResponseAsync();
    },
    async subscribeResponses(listener) {
      if (!available) return () => undefined;
      const Notifications = await import('expo-notifications');
      const subscription = Notifications.addNotificationResponseReceivedListener(listener);
      return () => subscription.remove();
    },
    async subscribePushTokens(listener) {
      if (!available) return () => undefined;
      const Notifications = await import('expo-notifications');
      const subscription = Notifications.addPushTokenListener(listener);
      return () => subscription.remove();
    },
  };
}

export function currentApnsRegistrationConfig(): ApnsRegistrationConfig {
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier
    ?? 'com.given33.hermesagent.nativebeta';
  const environment: ApnsEnvironment = __DEV__ ? 'sandbox' : 'production';
  return { bundleId, environment };
}

function permissionFromStatus(status: {
  granted?: boolean;
  canAskAgain?: boolean;
  ios?: { status?: number };
}): NotificationPermission {
  if (status.granted || [2, 3, 4].includes(status.ios?.status ?? -1)) {
    return 'granted';
  }
  if ((status.ios?.status ?? 0) === 0 && status.canAskAgain !== false) {
    return 'undetermined';
  }
  return 'denied';
}
