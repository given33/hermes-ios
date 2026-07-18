import { AppState } from 'react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { useAuth } from '../auth/AuthProvider';
import {
  createExpoNotificationRuntime,
  currentApnsRegistrationConfig,
} from './expo-notification-runtime';
import {
  HermesMobileNotificationApi,
  synchronizeApnsRegistration,
  type NativePushToken,
} from './mobile-notifications';
import {
  buildSmartWeatherFeedbackEvent,
  parseHermesNotificationResponse,
  type HermesNotificationTarget,
} from './notification-target';
import { IOSIntelligenceApi } from '../context/IOSIntelligenceApi';
import { HermesIOSContext, hasNativeIOSContext } from '../../modules/hermes-ios-context';

const TaskNotificationContext = createContext<HermesNotificationTarget | null>(null);

export function NotificationProvider({ children }: PropsWithChildren) {
  const { client, rememberDeviceId, state } = useAuth();
  const runtime = useMemo(createExpoNotificationRuntime, []);
  const [target, setTarget] = useState<HermesNotificationTarget | null>(null);
  const handledNotifications = useRef(new Set<string>());

  const acceptResponse = useCallback((response: unknown) => {
    const parsed = parseHermesNotificationResponse(response);
    if (!parsed || handledNotifications.current.has(parsed.notificationId)) return;
    handledNotifications.current.add(parsed.notificationId);
    setTarget(parsed);
    if (client && parsed.routePath === '/smart-weather') {
      const sourceID = parsed.sourceNotificationId || parsed.notificationId;
      const fallback = () => new IOSIntelligenceApi(client).feedback({
        label: 'notification-value',
        feedbackId: parsed.sourceNotificationId
          ? `notification:${parsed.sourceNotificationId}`
          : `notification-response:${parsed.notificationId}`,
        payload: {
          action: 'opened',
          notification_id: sourceID,
          useful: true,
        },
      });
      if (hasNativeIOSContext && state.status === 'authenticated') {
        const timestamp = Date.now();
        const event = buildSmartWeatherFeedbackEvent(
          sourceID,
          state.connection.deviceId || '',
          timestamp,
        );
        if (!event) return;
        void HermesIOSContext.enqueueContextEvents([
          event as unknown as Record<string, unknown>,
        ])
          .catch(() => fallback().catch(() => undefined));
      } else {
        void fallback().catch(() => undefined);
      }
    }
  }, [client, state]);

  useEffect(() => {
    if (!runtime.available) return undefined;
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void runtime.configureForegroundPresentation().catch(() => undefined);
    void runtime.getLastResponse()
      .then((response) => {
        if (active && response) acceptResponse(response);
        if (response) return runtime.clearLastResponse();
        return undefined;
      })
      .catch(() => undefined);
    void runtime.subscribeResponses((response) => {
      if (active) acceptResponse(response);
    }).then((remove) => {
      if (active) unsubscribe = remove;
      else remove();
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [acceptResponse, runtime]);

  useEffect(() => {
    if (state.status !== 'authenticated' || !client || !runtime.available) {
      return undefined;
    }
    let active = true;
    let unsubscribeTokens: () => void = () => undefined;
    let queue = Promise.resolve();
    const api = new HermesMobileNotificationApi(client);
    const config = currentApnsRegistrationConfig();
    const enqueueSynchronization = (token?: NativePushToken) => {
      queue = queue.then(async () => {
        const result = await synchronizeApnsRegistration(
          api,
          state.connection.deviceId,
          runtime,
          config,
          token,
        );
        if (
          active
          && 'deviceId' in result
          && result.deviceId !== state.connection.deviceId
        ) {
          await rememberDeviceId(result.deviceId);
        }
      }).catch(() => undefined);
    };
    enqueueSynchronization();
    void runtime.subscribePushTokens((token) => {
      if (active) enqueueSynchronization(token);
    }).then((remove) => {
      if (active) unsubscribeTokens = remove;
      else remove();
    }).catch(() => undefined);
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (active && nextState === 'active') enqueueSynchronization();
    });
    return () => {
      active = false;
      unsubscribeTokens();
      appStateSubscription.remove();
    };
  }, [client, rememberDeviceId, runtime, state]);

  return (
    <TaskNotificationContext.Provider value={target}>
      {children}
    </TaskNotificationContext.Provider>
  );
}

export function useTaskNotificationTarget(): HermesNotificationTarget | null {
  return useContext(TaskNotificationContext);
}
