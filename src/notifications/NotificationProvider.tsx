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
import { accountOwnerScope } from '../auth/account-identity';
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
  notificationDedupeKey,
  notificationMatchesAccount,
  parseHermesNotificationResponse,
  type HermesNotificationTarget,
} from './notification-target';
import { IOSIntelligenceApi } from '../context/IOSIntelligenceApi';
import { HermesIOSContext, hasNativeIOSContext } from '../../modules/hermes-ios-context';
import {
  canCollectIOSPermission,
  canStartIOSCollection,
  ensureIOSPermissions,
} from '../context/ios-permission-coordinator';

const TaskNotificationContext = createContext<HermesNotificationTarget | null>(null);
export type HermesNotificationHealth =
  | 'idle'
  | 'syncing'
  | 'registered'
  | 'denied'
  | 'unavailable'
  | 'error';
const NotificationHealthContext = createContext<HermesNotificationHealth>('idle');

export function NotificationProvider({ children }: PropsWithChildren) {
  const { client, rememberDeviceId, state } = useAuth();
  const runtime = useMemo(createExpoNotificationRuntime, []);
  const [target, setTarget] = useState<HermesNotificationTarget | null>(null);
  const [notificationHealth, setNotificationHealth] = useState<HermesNotificationHealth>('idle');
  const handledNotifications = useRef(new Set<string>());
  const processingNotifications = useRef(new Map<string, Promise<NotificationResponseOutcome>>());

  const acceptResponse = useCallback(async (
    response: unknown,
  ): Promise<NotificationResponseOutcome> => {
    if (state.status !== 'authenticated' || !client) return 'deferred';
    const parsed = parseHermesNotificationResponse(response);
    if (!parsed) return 'discarded';
    if (!notificationMatchesAccount(
      parsed,
      state.connection.username,
      state.connection.accountGeneration,
    )) return 'discarded';
    const dedupeKey = notificationDedupeKey(parsed);
    if (handledNotifications.current.has(dedupeKey)) return 'processed';
    const activeProcessing = processingNotifications.current.get(dedupeKey);
    if (activeProcessing) return activeProcessing;
    const processing = (async (): Promise<NotificationResponseOutcome> => {
      if (parsed.routePath !== '/smart-weather') {
        handledNotifications.current.add(dedupeKey);
        setTarget(parsed);
        return 'processed';
      }
      const sourceID = parsed.sourceNotificationId || parsed.notificationId;
      const fallback = () => new IOSIntelligenceApi(client).feedback({
        label: 'notification-value',
        feedbackId: parsed.sourceNotificationId
          ? `notification:${parsed.sourceNotificationId}`
          : `notification-response:${parsed.notificationId}`,
        payload: {
          action: 'opened',
          account_generation: parsed.accountGeneration,
          event_key: parsed.eventKey,
          notification_id: sourceID,
          owner_id: parsed.ownerId,
          useful: true,
        },
      });
      try {
        let persisted = false;
        if (hasNativeIOSContext) {
        const timestamp = Date.now();
        const event = buildSmartWeatherFeedbackEvent(
          sourceID,
          state.connection.deviceId || '',
          parsed,
          timestamp,
        );
          if (!event) return 'discarded';
          persisted = await HermesIOSContext.enqueueContextEvents([
          event as unknown as Record<string, unknown>,
          ]) > 0;
        }
        if (!persisted) await fallback();
        handledNotifications.current.add(dedupeKey);
        setTarget(parsed);
        return 'processed';
      } catch {
        return 'retry';
      }
    })();
    processingNotifications.current.set(dedupeKey, processing);
    try {
      return await processing;
    } finally {
      if (processingNotifications.current.get(dedupeKey) === processing) {
        processingNotifications.current.delete(dedupeKey);
      }
    }
  }, [client, state]);

  useEffect(() => {
    if (!runtime.available) return undefined;
    let active = true;
    let unsubscribe: () => void = () => undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const processResponse = async (response: unknown, clearOnSettle = false) => {
      const outcome = await acceptResponse(response);
      if (!active) return;
      if (clearOnSettle && outcome !== 'retry' && outcome !== 'deferred') {
        await runtime.clearLastResponse().catch(() => undefined);
      }
      if (outcome === 'retry') {
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          if (active) void processResponse(response, clearOnSettle);
        }, 30_000);
      }
    };
    void runtime.configureForegroundPresentation().catch(() => undefined);
    void runtime.getLastResponse()
      .then((response) => {
        if (active && response) return processResponse(response, true);
        return undefined;
      })
      .catch(() => undefined);
    void runtime.subscribeResponses((response) => {
      if (active) void processResponse(response);
    }).then((remove) => {
      if (active) unsubscribe = remove;
      else remove();
    }).catch(() => undefined);
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe();
    };
  }, [acceptResponse, runtime]);

  useEffect(() => {
    if (state.status !== 'authenticated' || !client || !runtime.available) {
      setNotificationHealth(runtime.available ? 'idle' : 'unavailable');
      return undefined;
    }
    let active = true;
    let unsubscribeTokens: () => void = () => undefined;
    let queue = Promise.resolve();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const api = new HermesMobileNotificationApi(client);
    const config = currentApnsRegistrationConfig();
    const enqueueSynchronization = (token?: NativePushToken) => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      queue = queue.then(async () => {
        if (!active) return;
        setNotificationHealth('syncing');
        const ownerScope = accountOwnerScope(state.connection);
        if (hasNativeIOSContext) {
          await HermesIOSContext.setOwnerScope(
            ownerScope,
            state.connection.accountGeneration,
          );
          if (!active) return;
          await HermesIOSContext.setPermissionCollectionReady(ownerScope, false);
          if (!active) return;
        }
        const coordinated = hasNativeIOSContext
          ? await ensureIOSPermissions(ownerScope, HermesIOSContext)
          : null;
        if (!active) return;
        if (coordinated) {
          await HermesIOSContext.setPermissionCollectionReady(
            ownerScope,
            canStartIOSCollection(coordinated),
          );
          if (!active) return;
        }
        const result = await synchronizeApnsRegistration(
          api,
          state.connection.deviceId,
          runtime,
          config,
          token,
          {
            // The unified iOS coordinator owns the system sheet. Expo only
            // reads the resulting APNs status so parent/child effects cannot
            // race two notification permission requests after login.
            requestUndeterminedPermission: !coordinated,
          },
        );
        if (!active) return;
        if (active) setNotificationHealth(result.status);
        if (
          active
          && 'deviceId' in result
          && result.deviceId !== state.connection.deviceId
        ) {
          await rememberDeviceId(result.deviceId);
          if (!active) return;
        }
        if (coordinated && !canCollectIOSPermission(coordinated, 'notification')) {
          return;
        }
      }).catch(() => {
        if (!active) return;
        setNotificationHealth('error');
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          if (active) enqueueSynchronization();
        }, 30_000);
      });
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
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribeTokens();
      appStateSubscription.remove();
    };
  }, [client, rememberDeviceId, runtime, state]);

  return (
    <TaskNotificationContext.Provider value={target}>
      <NotificationHealthContext.Provider value={notificationHealth}>
        {children}
      </NotificationHealthContext.Provider>
    </TaskNotificationContext.Provider>
  );
}

type NotificationResponseOutcome = 'deferred' | 'discarded' | 'processed' | 'retry';

export function useTaskNotificationTarget(): HermesNotificationTarget | null {
  return useContext(TaskNotificationContext);
}

export function useNotificationHealth(): HermesNotificationHealth {
  return useContext(NotificationHealthContext);
}
