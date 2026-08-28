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
import { drainApnsUnregister } from './apns-unregister-outbox';
import {
  buildSmartWeatherFeedbackEvent,
  notificationDedupeKey,
  notificationMatchesAccount,
  parseHermesNotificationResponse,
  type HermesNotificationTarget,
} from './notification-target';
import {
  bindNotificationTarget,
  notificationAccountKey,
  notificationTargetForAccount,
  type AccountBoundNotificationTarget,
} from './notification-account-state';
import {
  processSmartWeatherNotificationResponse,
  type NotificationResponseOutcome,
} from './notification-response-processing';
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
const HANDLED_NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_HANDLED_NOTIFICATIONS = 256;

function pruneHandledNotifications(items: Map<string, number>, now: number): void {
  for (const [key, handledAt] of items) {
    if (now - handledAt > HANDLED_NOTIFICATION_TTL_MS) items.delete(key);
  }
  while (items.size > MAX_HANDLED_NOTIFICATIONS) {
    const oldest = items.keys().next().value;
    if (oldest === undefined) break;
    items.delete(oldest);
  }
}

function markNotificationHandled(items: Map<string, number>, key: string): void {
  items.delete(key);
  items.set(key, Date.now());
  pruneHandledNotifications(items, Date.now());
}

export function NotificationProvider({ children }: PropsWithChildren) {
  const { client, rememberDeviceId, state } = useAuth();
  const runtime = useMemo(createExpoNotificationRuntime, []);
  const [target, setTarget] = useState<AccountBoundNotificationTarget | null>(null);
  const [notificationHealth, setNotificationHealth] = useState<HermesNotificationHealth>('idle');
  const handledNotifications = useRef(new Map<string, number>());
  const processingNotifications = useRef(new Map<string, Promise<NotificationResponseOutcome>>());
  const authenticatedConnection = state.status === 'authenticated' ? state.connection : null;
  const activeAccountKey = notificationAccountKey(authenticatedConnection);
  const notificationAccountRef = useRef(authenticatedConnection);
  const deviceIdRef = useRef(authenticatedConnection?.deviceId || '');
  const rememberDeviceIdRef = useRef(rememberDeviceId);
  notificationAccountRef.current = authenticatedConnection;
  deviceIdRef.current = authenticatedConnection?.deviceId || '';
  rememberDeviceIdRef.current = rememberDeviceId;

  const publishTarget = useCallback((
    nextTarget: HermesNotificationTarget,
    acceptedConnection: NonNullable<typeof authenticatedConnection>,
  ) => {
    const bound = bindNotificationTarget(nextTarget, acceptedConnection);
    if (
      !bound
      || bound.accountKey !== notificationAccountKey(notificationAccountRef.current)
    ) return;
    setTarget(bound);
  }, []);

  const acceptResponse = useCallback(async (
    response: unknown,
  ): Promise<NotificationResponseOutcome> => {
    const connection = notificationAccountRef.current;
    if (!connection || !client) return 'deferred';
    const parsed = parseHermesNotificationResponse(response);
    if (!parsed) return 'discarded';
    if (!notificationMatchesAccount(
      parsed,
      connection.username,
      connection.accountGeneration,
    )) return 'discarded';
    const acceptedAccountKey = notificationAccountKey(connection);
    if (!acceptedAccountKey) return 'deferred';
    const isCurrentAccount = () => (
      notificationAccountKey(notificationAccountRef.current) === acceptedAccountKey
    );
    const dedupeKey = notificationDedupeKey(parsed);
    const scopedDedupeKey = `${acceptedAccountKey}\u0000${dedupeKey}`;
    pruneHandledNotifications(handledNotifications.current, Date.now());
    if (handledNotifications.current.has(scopedDedupeKey)) return 'processed';
    const activeProcessing = processingNotifications.current.get(scopedDedupeKey);
    if (activeProcessing) return activeProcessing;
    const processing = (async (): Promise<NotificationResponseOutcome> => {
      if (!isCurrentAccount()) return 'discarded';
      if (parsed.routePath !== '/smart-weather') {
        markNotificationHandled(handledNotifications.current, scopedDedupeKey);
        publishTarget(parsed, connection);
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
      return processSmartWeatherNotificationResponse({
        fallback,
        isCurrentAccount,
        markHandled: () => markNotificationHandled(
          handledNotifications.current,
          scopedDedupeKey,
        ),
        persistNative: hasNativeIOSContext
          ? async () => {
            const event = buildSmartWeatherFeedbackEvent(
              sourceID,
              connection.deviceId || '',
              parsed,
              Date.now(),
            );
            if (!event) return null;
            return await HermesIOSContext.enqueueContextEvents([
              event as unknown as Record<string, unknown>,
            ]) > 0;
          }
          : undefined,
        publishTarget: () => publishTarget(parsed, connection),
      });
    })();
    processingNotifications.current.set(scopedDedupeKey, processing);
    try {
      return await processing;
    } finally {
      if (processingNotifications.current.get(scopedDedupeKey) === processing) {
        processingNotifications.current.delete(scopedDedupeKey);
      }
    }
  }, [client, publishTarget]);

  const accountLifecycleInitialized = useRef(false);
  const previousAccountKey = useRef<string | null>(null);
  useEffect(() => {
    const firstRun = !accountLifecycleInitialized.current;
    const accountChanged = accountLifecycleInitialized.current
      && previousAccountKey.current !== activeAccountKey;
    accountLifecycleInitialized.current = true;
    previousAccountKey.current = activeAccountKey;
    if ((!firstRun && !accountChanged) || (firstRun && activeAccountKey !== null)) {
      return undefined;
    }

    setTarget(null);
    handledNotifications.current.clear();
    processingNotifications.current.clear();
    if (!runtime.available) return undefined;

    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const clearNotifications = () => {
      void runtime.clearAccountNotifications().catch(() => {
        if (!active) return;
        setNotificationHealth('error');
        if (activeAccountKey === null) {
          retryTimer = setTimeout(clearNotifications, 30_000);
        }
      });
    };
    clearNotifications();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [activeAccountKey, runtime]);

  useEffect(() => {
    if (!runtime.available) return undefined;
    let active = true;
    let unsubscribe: () => void = () => undefined;
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();
    const processResponse = async (response: unknown, clearOnSettle = false) => {
      const outcome = await acceptResponse(response);
      if (!active) return;
      if (clearOnSettle && outcome !== 'retry' && outcome !== 'deferred') {
        await runtime.clearLastResponse().catch(() => undefined);
      }
      if (outcome === 'retry') {
        const retryTimer = setTimeout(() => {
          retryTimers.delete(retryTimer);
          if (active) void processResponse(response, clearOnSettle);
        }, 30_000);
        retryTimers.add(retryTimer);
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
      for (const retryTimer of retryTimers) clearTimeout(retryTimer);
      retryTimers.clear();
      unsubscribe();
    };
  }, [acceptResponse, runtime]);

  useEffect(() => {
    if (!authenticatedConnection || !client || !runtime.available) {
      setNotificationHealth(runtime.available ? 'idle' : 'unavailable');
      return undefined;
    }
    let active = true;
    let unsubscribeTokens: () => void = () => undefined;
    let queue = Promise.resolve();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const api = new HermesMobileNotificationApi(client);
    const config = currentApnsRegistrationConfig();
    const ownerScope = accountOwnerScope(authenticatedConnection);
    const accountGeneration = authenticatedConnection.accountGeneration;
    const enqueueSynchronization = (token?: NativePushToken) => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      queue = queue.then(async () => {
        if (!active) return;
        setNotificationHealth('syncing');
        if (hasNativeIOSContext) {
          await HermesIOSContext.setOwnerScope(
            ownerScope,
            accountGeneration,
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
          deviceIdRef.current,
          runtime,
          config,
          token,
          {
            // The unified iOS coordinator owns the system sheet. Expo only
            // reads the resulting APNs status so parent/child effects cannot
            // race two notification permission requests after login. When
            // the native context bridge is degraded (resigned build without
            // entitlements, circuit breaker open) the coordinator marks the
            // permission 'unavailable' — it can never show the sheet, so
            // expo must request it itself instead of silently unregistering
            // APNs for a user who never saw a prompt.
            requestUndeterminedPermission: !coordinated
              || coordinated.permissions.notification === 'unavailable',
          },
        );
        if (!active) return;
        if (active) setNotificationHealth(result.status);
        if (
          active
          && 'deviceId' in result
          && result.deviceId !== deviceIdRef.current
        ) {
          deviceIdRef.current = result.deviceId;
          await rememberDeviceIdRef.current(result.deviceId);
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
    void drainApnsUnregister(authenticatedConnection.username, async (item) => {
      if (item.baseUrl !== authenticatedConnection.baseUrl) return false;
      await client.request(
        `/api/mobile/v1/devices/${encodeURIComponent(item.deviceId)}/apns`,
        { method: 'DELETE' },
      );
      return true;
    });
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
  }, [
    authenticatedConnection?.accountGeneration,
    authenticatedConnection?.baseUrl,
    authenticatedConnection?.username,
    client,
    runtime,
  ]);

  return (
    <TaskNotificationContext.Provider
      value={notificationTargetForAccount(target, authenticatedConnection)}
    >
      <NotificationHealthContext.Provider value={notificationHealth}>
        {children}
      </NotificationHealthContext.Provider>
    </TaskNotificationContext.Provider>
  );
}

export function useTaskNotificationTarget(): HermesNotificationTarget | null {
  return useContext(TaskNotificationContext);
}

export function useNotificationHealth(): HermesNotificationHealth {
  return useContext(NotificationHealthContext);
}
