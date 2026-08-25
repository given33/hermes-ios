import {
  createContext,
  Component,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as ImagePicker from 'expo-image-picker';

import {
  HermesIOSContext,
  HermesScreenTimeReportView,
  hasNativeScreenTimeReportView,
  isNativeIOSContextAvailable,
  markNativeIOSContextUnavailable,
  type IOSContextEvent as NativeIOSContextEvent,
} from '../../modules/hermes-ios-context';
import type { HermesApiClient } from '../api/HermesApiClient';
import { HermesCloudApi, type CollaborationMessage } from '../api/HermesCloudApi';
import { withDeadline } from '../api/async-deadline';
import {
  IOSIntelligenceApi,
  type IOSContextEvent,
  type IOSDeviceCommand,
  type IOSIntelligenceSnapshot,
} from './IOSIntelligenceApi';
import {
  hasIOSNativeActionConfirmation,
  nativeActionMetadata,
  type IOSNativeActionMetadata,
} from './ios-command-contract';
import { predictedDepartureTimestamp } from './ios-command-contract';
import {
  awaitCurrentIOSContext,
  IOSContextLifecycleCoordinator,
  type IOSContextLifecycleCapture,
} from './ios-context-lifecycle';
import { buildCollectionSnapshotEvents, snapshotEvent } from './ios-snapshot-events';
import {
  canCollectIOSPermission,
  canStartIOSCollection,
  clearIOSPermissionRun,
  ensureIOSPermissions,
  initialIOSPermissionSnapshot,
  type IOSPermissionKey,
  type IOSPermissionSnapshot,
} from './ios-permission-coordinator';

interface IOSContextProviderProps extends PropsWithChildren {
  accountGeneration: string;
  client: HermesApiClient;
  deviceId: string;
  ownerScope: string;
}

interface PersistedIOSDeviceCommand extends IOSDeviceCommand {
  _relay_device_id: string;
  _relay_owner_scope: string;
  _relay_error?: string;
  _relay_execution_status?: 'completed' | 'executing' | 'failed';
  _relay_attempts?: number;
  _relay_result?: Record<string, unknown>;
}

const EVENT_BATCH_SIZE = 200;
const MAX_EVENT_FLUSH_PAGES = 50;
const FOREGROUND_SYNC_MS = 20_000;
const SNAPSHOT_SYNC_MS = 30 * 60_000;
const NETWORK_PROBE_DEADLINE_MS = 5_000;

interface IOSPermissionContextValue {
  openSettings(): Promise<void>;
  retry(): void;
  snapshot: IOSPermissionSnapshot;
}

const IOSPermissionContext = createContext<IOSPermissionContextValue>({
  openSettings: async () => undefined,
  retry: () => undefined,
  snapshot: initialIOSPermissionSnapshot(),
});

export function useIOSPermissionCoordinator(): IOSPermissionContextValue {
  return useContext(IOSPermissionContext);
}

export function IOSContextProvider({
  accountGeneration,
  children,
  client,
  deviceId,
  ownerScope,
}: IOSContextProviderProps) {
  const apiRef = useRef(new IOSIntelligenceApi(client));
  const lifecycleRef = useRef(new IOSContextLifecycleCoordinator());
  const commandCursorRef = useRef('');
  const runningRef = useRef<symbol | null>(null);
  const commandsRunningRef = useRef<symbol | null>(null);
  const permissionSnapshotRef = useRef(initialIOSPermissionSnapshot());
  const permissionSettingsOpenedRef = useRef(false);
  const [permissionSnapshot, setPermissionSnapshot] = useState(initialIOSPermissionSnapshot);
  const [permissionAttempt, setPermissionAttempt] = useState(0);
  const [screenTimeReportRefresh, setScreenTimeReportRefresh] = useState(() => Date.now());
  const nativeContextAvailableRef = useRef(isNativeIOSContextAvailable());

  const updatePermissionSnapshot = useCallback((snapshot: IOSPermissionSnapshot) => {
    permissionSnapshotRef.current = snapshot;
    setPermissionSnapshot(snapshot);
  }, []);

  const disableNativeContext = useCallback(() => {
    nativeContextAvailableRef.current = false;
    markNativeIOSContextUnavailable();
    permissionSettingsOpenedRef.current = false;
    updatePermissionSnapshot(initialIOSPermissionSnapshot());
  }, [updatePermissionSnapshot]);

  const permissionContext = useMemo<IOSPermissionContextValue>(() => ({
    openSettings: async () => {
      if (nativeContextAvailableRef.current) {
        permissionSettingsOpenedRef.current = true;
        try {
          await HermesIOSContext.openDeviceSettings();
        } catch {
          disableNativeContext();
        }
      }
    },
    retry: () => setPermissionAttempt((value) => value + 1),
    snapshot: permissionSnapshot,
  }), [disableNativeContext, permissionSnapshot]);

  useEffect(() => {
    apiRef.current = new IOSIntelligenceApi(client);
  }, [client]);

  const flushPendingEvents = useCallback(async (capture: IOSContextLifecycleCapture) => {
    if (!nativeContextAvailableRef.current || runningRef.current) return;
    const runToken = Symbol('ios-event-flush');
    runningRef.current = runToken;
    const lifecycle = lifecycleRef.current;
    const api = apiRef.current;
    try {
      if (!await awaitCurrentIOSContext(lifecycle, capture, hasUsableNetwork)) return;
      for (let page = 0; page < MAX_EVENT_FLUSH_PAGES; page += 1) {
        const claim = await awaitCurrentIOSContext(
          lifecycle,
          capture,
          () => HermesIOSContext.claimPendingEvents(EVENT_BATCH_SIZE, ownerScope),
        );
        const pending = claim.events;
        if (!pending.length) break;
        const events = pending.map(normalizeNativeEvent);
        const cursor = String(Math.max(...pending.map((event) => event.sequence)));
        await awaitCurrentIOSContext(
          lifecycle,
          capture,
          () => api.uploadEvents({ cursor, deviceId, events }, capture.signal),
        );
        await awaitCurrentIOSContext(
          lifecycle,
          capture,
          () => HermesIOSContext.acknowledgeEventClaim(
            claim.token,
            pending.map((event) => event.id),
            Number(cursor),
            ownerScope,
          ),
        );
        if (pending.length < EVENT_BATCH_SIZE) break;
      }
    } finally {
      if (runningRef.current === runToken) runningRef.current = null;
    }
  }, [deviceId, ownerScope]);

  const syncSnapshots = useCallback(async (capture: IOSContextLifecycleCapture) => {
    if (!nativeContextAvailableRef.current) return;
    const lifecycle = lifecycleRef.current;
    const now = Date.now();
    const monthAhead = now + 31 * 24 * 60 * 60_000;
    const permission = permissionSnapshotRef.current;
    const [capabilities, power, calendar, reminders, device, watch] =
      await awaitCurrentIOSContext(lifecycle, capture, () => Promise.all([
        HermesIOSContext.getCapabilities(),
        HermesIOSContext.getPowerSnapshot(),
        canCollectIOSPermission(permission, 'calendar')
          ? HermesIOSContext.listCalendarEvents(now - 24 * 60 * 60_000, monthAhead).catch(() => [])
          : Promise.resolve([]),
        canCollectIOSPermission(permission, 'reminders')
          ? HermesIOSContext.listReminders(false).catch(() => [])
          : Promise.resolve([]),
        HermesIOSContext.getDeviceSnapshot().catch(() => null),
        HermesIOSContext.getWatchSnapshot().catch(() => null),
      ]));
    const events: IOSContextEvent[] = [
      snapshotEvent('power', now, { ...power }, '', deviceId),
      snapshotEvent('device', now, {
        ...(device || {}),
        capabilities: { ...capabilities },
        permissions: {
          ...permission.permissions,
          locationAlways: permission.locationAlways,
          locationPrecise: permission.locationPrecise,
          phase: permission.phase,
        },
      }, '', deviceId),
      ...(watch ? [snapshotEvent('watch', now, { ...watch }, '', deviceId)] : []),
      ...buildCollectionSnapshotEvents('calendar', calendar, now, deviceId),
      ...buildCollectionSnapshotEvents('reminder', reminders, now, deviceId),
    ];
    // Every context sample reaches the native AES-GCM queue before the first
    // network attempt. A failed upload therefore follows the same cursor/ACK
    // recovery path as background location and Watch events.
    await awaitCurrentIOSContext(
      lifecycle,
      capture,
      () => HermesIOSContext.enqueueContextEvents(
        events as unknown as Record<string, unknown>[],
      ),
    );
    await flushPendingEvents(capture);
  }, [deviceId, flushPendingEvents]);

  const executeCommands = useCallback(async (capture: IOSContextLifecycleCapture) => {
    if (!nativeContextAvailableRef.current
      || !canStartIOSCollection(permissionSnapshotRef.current)
      || commandsRunningRef.current) return;
    const runToken = Symbol('ios-command-run');
    commandsRunningRef.current = runToken;
    const lifecycle = lifecycleRef.current;
    const api = apiRef.current;
    const cloud = new HermesCloudApi(client);
    const runCurrent = <T,>(operation: () => Promise<T>) => (
      awaitCurrentIOSContext(lifecycle, capture, operation)
    );
    try {
      if (!await runCurrent(hasUsableNetwork)) return;
      await drainPendingTaskControls(
        runCurrent,
        api,
        capture.signal,
        () => flushPendingEvents(capture),
        ownerScope,
        accountGeneration,
      );
      const storedCommands = (await runCurrent(
        () => HermesIOSContext.readPendingCommands(),
      ))
        .filter((command) => (
          command._relay_device_id === deviceId
          && command._relay_owner_scope === ownerScope
        ))
        .map(parseStoredCommand)
        .filter((command): command is PersistedIOSDeviceCommand => command !== null);
      const response = await runCurrent(() => (
        api.pullCommands(deviceId, commandCursorRef.current, capture.signal)
          .catch((error) => {
            if (!storedCommands.length) throw error;
            return { commands: [] as IOSDeviceCommand[], cursor: commandCursorRef.current };
          })
      ));
      const serverCommands: PersistedIOSDeviceCommand[] = (response.commands || []).map((command) => ({
        ...command,
        _relay_device_id: deviceId,
        _relay_owner_scope: ownerScope,
      }));
      const commands = [...storedCommands, ...serverCommands]
        .filter((command, index, all) => all.findIndex((candidate) => candidate.id === command.id) === index);
      for (let command of commands) {
        if (await runCurrent(() => HermesIOSContext.hasCompletedCommand(command.id))) {
          // Do not treat command ids as the server pull cursor.
          await runCurrent(() => HermesIOSContext.removePendingCommand(command.id));
          continue;
        }

        const actionMetadata = nativeActionMetadata(command);

        const recoveredResult = command._relay_execution_status === 'executing'
          ? await runCurrent(() => HermesIOSContext.getCommandExecutionResult(command.id))
          : null;
        if (recoveredResult) {
          command = {
            ...command,
            _relay_error: undefined,
            _relay_execution_status: 'completed',
            _relay_result: recoveredResult,
          };
          await runCurrent(() => HermesIOSContext.storePendingCommand(
            command as unknown as Record<string, unknown>,
          ));
        } else if (command.expires_at && normalizeTimestamp(command.expires_at) <= Date.now()) {
          command = { ...command, _relay_error: 'expired', _relay_execution_status: 'failed' };
          await runCurrent(() => HermesIOSContext.storePendingCommand(
            command as unknown as Record<string, unknown>,
          ));
        } else if (
          !command._relay_execution_status
          || command._relay_execution_status === 'executing'
          || (
            command._relay_execution_status === 'failed'
            && (command._relay_attempts || 0) < actionMetadata.max_attempts
          )
        ) {
          const actionAttempt = Math.max(1, (command._relay_attempts || 0) + 1);
          const actionAuditId = `ios-action:${command.id}`;
          command = {
            ...command,
            _relay_error: undefined,
            _relay_execution_status: 'executing',
            _relay_attempts: (command._relay_attempts || 0) + 1,
          };
          await runCurrent(() => HermesIOSContext.storePendingCommand(
            command as unknown as Record<string, unknown>,
          ));
          await recordIOSActionAudit(
            runCurrent,
            command,
            actionMetadata,
            actionAuditId,
            'started',
            actionAttempt,
          );
          try {
            assertIOSNativeActionReady(command, actionMetadata);
            const result = await runCurrent(() => executeDeviceCommand(
              command,
              () => flushPendingEvents(capture),
              ownerScope,
              accountGeneration,
              permissionSnapshotRef.current,
              () => api.snapshot(undefined, capture.signal),
              cloud,
              runCurrent,
            ));
            const auditedResult = {
              ...result,
              _ios_action: {
                action_id: actionMetadata.action_id,
                audit_id: actionAuditId,
                attempt: actionAttempt,
                max_attempts: actionMetadata.max_attempts,
              },
            };
            command = {
              ...command,
              _relay_execution_status: 'completed',
              _relay_result: auditedResult,
            };
            await recordIOSActionAudit(
              runCurrent,
              command,
              actionMetadata,
              actionAuditId,
              'completed',
              actionAttempt,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            command = {
              ...command,
              _relay_error: message,
              _relay_execution_status: 'failed',
            };
            await recordIOSActionAudit(
              runCurrent,
              command,
              actionMetadata,
              actionAuditId,
              'failed',
              actionAttempt,
              message,
            );
          }
          await runCurrent(() => HermesIOSContext.storePendingCommand(
            command as unknown as Record<string, unknown>,
          ));
        }

        await runCurrent(() => api.acknowledgeCommand(
          deviceId,
          command.id,
          command._relay_execution_status === 'completed'
            ? { result: command._relay_result || {}, status: 'completed' }
            : { error: command._relay_error || 'native command failed', status: 'failed' },
          capture.signal,
        ));
        // Persist completion for dedupe only; pull cursor is server-owned.
        const retryableFailure = command._relay_execution_status === 'failed'
          && (command._relay_attempts || 0) < actionMetadata.max_attempts;
        if (!retryableFailure) {
          await runCurrent(() => HermesIOSContext.recordCommandCompletion(
            command.id,
            commandCursorRef.current || command.id,
          ));
        }
        await runCurrent(() => HermesIOSContext.removePendingCommand(command.id));
      }
      if (response.cursor) {
        commandCursorRef.current = response.cursor;
        await runCurrent(() => HermesIOSContext.recordCommandCompletion(
          `cursor:${response.cursor}`,
          response.cursor!,
        ));
      }
    } finally {
      if (commandsRunningRef.current === runToken) commandsRunningRef.current = null;
    }
  }, [accountGeneration, client, deviceId, flushPendingEvents, ownerScope]);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !nativeContextAvailableRef.current || !deviceId.trim()) return undefined;
    let active = true;
    const lifecycle = lifecycleRef.current;
    const capture = lifecycle.activate(ownerScope, accountGeneration);
    const current = () => active && lifecycle.isCurrent(capture);
    const runCurrent = <T,>(operation: () => Promise<T>) => (
      awaitCurrentIOSContext(lifecycle, capture, operation)
    );
    const cloud = new HermesCloudApi(client);
    let agentTriggersRunning = false;
    let snapshotTimer: ReturnType<typeof setInterval> | undefined;
    let eventFlushTimer: ReturnType<typeof setTimeout> | undefined;

    const drainTriggers = async () => {
      if (agentTriggersRunning || !current()) return;
      agentTriggersRunning = true;
      try {
        await drainPendingAgentTriggers(
          runCurrent,
          cloud,
          ownerScope,
          accountGeneration,
          deviceId,
        );
      } finally {
        agentTriggersRunning = false;
      }
    };

    const synchronize = () => {
      if (!current()) return;
      void flushPendingEvents(capture).catch(() => undefined);
      void executeCommands(capture).catch(() => undefined);
      void drainTriggers().catch(() => undefined);
    };
    const scheduleEventSync = () => {
      if (!current() || eventFlushTimer) return;
      eventFlushTimer = setTimeout(() => {
        eventFlushTimer = undefined;
        synchronize();
      }, 10_000);
    };
    const synchronizeFromBackgroundWake = async (event: { wakeId?: string }) => {
      let success = true;
      try {
        if (!await runCurrent(hasUsableNetwork)) throw new Error('network unavailable');
        await flushPendingEvents(capture);
        await executeCommands(capture);
        await drainTriggers();
        await syncSnapshots(capture);
      } catch {
        success = false;
      } finally {
        if (event.wakeId) {
          if (current()) {
            await runCurrent(() => HermesIOSContext.completeBackgroundRelay(
              event.wakeId!,
              success,
            )).catch(() => undefined);
          }
        }
      }
    };
    const startCollectors = async () => {
      await runCurrent(() => HermesIOSContext.setOwnerScope(ownerScope, accountGeneration));
      await runCurrent(() => HermesIOSContext.setBackgroundRelayReady(
        ownerScope,
        accountGeneration,
        true,
      ));
      const pendingWakes = await runCurrent(
        () => HermesIOSContext.listPendingRelayWakes(),
      ).catch(() => []);
      for (const wake of pendingWakes) {
        if (!current()) return;
        await synchronizeFromBackgroundWake(wake);
      }
      await runCurrent(() => HermesIOSContext.setPermissionCollectionReady(ownerScope, false));
      const commandCursor = await runCurrent(() => HermesIOSContext.getCommandCursor());
      commandCursorRef.current = commandCursor;
      const authorization = await runCurrent(() => ensureIOSPermissions(
        ownerScope,
        HermesIOSContext,
        (snapshot) => { if (current()) updatePermissionSnapshot(snapshot); },
        permissionAttempt > 0,
      ));
      updatePermissionSnapshot(authorization);
      await runCurrent(() => HermesIOSContext.setPermissionCollectionReady(
        ownerScope,
        canStartIOSCollection(authorization),
      ));
      if (canCollectIOSPermission(authorization, 'screenTime')) {
        await runCurrent(() => HermesIOSContext
          .startScreenTimeMonitoring('hermes-daily-context', 0, 24))
          .catch(() => undefined);
        if (!current()) return;
        setScreenTimeReportRefresh(Date.now());
      } else {
        await runCurrent(() => HermesIOSContext
          .stopScreenTimeMonitoring('hermes-daily-context'))
          .catch(() => undefined);
      }
      if (canCollectIOSPermission(authorization, 'location')) {
        await runCurrent(() => HermesIOSContext.startAdaptiveLocation());
      } else {
        await runCurrent(() => HermesIOSContext.stopAdaptiveLocation()).catch(() => undefined);
      }
      if (canCollectIOSPermission(authorization, 'motion')) {
        await runCurrent(() => HermesIOSContext.startMotionUpdates());
      } else {
        await runCurrent(() => HermesIOSContext.stopMotionUpdates()).catch(() => undefined);
      }
      await runCurrent(() => HermesIOSContext.scheduleBackgroundTasks()).catch(() => undefined);
      if (!current()) return;
      synchronize();
      void syncSnapshots(capture).catch(() => undefined);
    };

    void startCollectors().catch(() => {
      // A signed native module with mismatched entitlements is optional for
      // remote chat. Stop its retry loop and leave the authenticated UI alive.
      disableNativeContext();
    });
    const eventSubscriptions: Array<{ remove(): void }> = [];
    if (nativeContextAvailableRef.current) {
      try {
        eventSubscriptions.push(
          HermesIOSContext.subscribeLocation(scheduleEventSync),
          HermesIOSContext.subscribeMotion(scheduleEventSync),
          HermesIOSContext.subscribeVisit(synchronize),
          HermesIOSContext.subscribeBackgroundWake((event) => {
            void synchronizeFromBackgroundWake(event).catch(() => undefined);
          }),
        );
      } catch {
        disableNativeContext();
      }
    }
    const foregroundTimer = setInterval(() => {
      if (AppState.currentState === 'active') synchronize();
    }, FOREGROUND_SYNC_MS);
    snapshotTimer = setInterval(() => {
      if (AppState.currentState === 'active') {
        setScreenTimeReportRefresh(Date.now());
        void syncSnapshots(capture).catch(() => undefined);
      }
    }, SNAPSHOT_SYNC_MS);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // Permission grants can be revoked in Settings while the app is in
        // the background. Re-read every native status before collectors and
        // MCP commands use the cached account-scoped snapshot again.
        permissionSettingsOpenedRef.current = false;
        setPermissionAttempt((value) => value + 1);
        setScreenTimeReportRefresh(Date.now());
      }
    });

    return () => {
      if (nativeContextAvailableRef.current) {
        void HermesIOSContext.setBackgroundRelayReady(
          ownerScope,
          accountGeneration,
          false,
        ).catch(() => undefined);
      }
      active = false;
      lifecycle.invalidate(capture);
      clearInterval(foregroundTimer);
      if (snapshotTimer) clearInterval(snapshotTimer);
      if (eventFlushTimer) clearTimeout(eventFlushTimer);
      appStateSubscription.remove();
      eventSubscriptions.forEach((subscription) => {
        try {
          subscription.remove();
        } catch {
          // A partially registered optional bridge must not crash logout or
          // account switching while the remote session is still valid.
        }
      });
      clearIOSPermissionRun(ownerScope);
      if (nativeContextAvailableRef.current) {
        void HermesIOSContext.stopMotionUpdates().catch(() => undefined);
        // ScreenTime is account-scoped observation; unlike Always location it
        // has no product reason to continue after the owning session ends.
        void HermesIOSContext.stopScreenTimeMonitoring('hermes-daily-context')
          .catch(() => undefined);
      }
      // Product boundary: while the process is alive (foreground or background,
      // including after logout / session expiry back to the login screen), Always
      // location keeps collecting so the agent can read the latest path without
      // the user force-quitting the app. Account delete alone stops collectors
      // via HermesAccountLifecycle.deleteOwnerScope + local queue wipe; normal
      // operation uploads encrypted events to the cloud on the next authenticated
      // relay. Do not stopAdaptiveLocation here.
    };
  }, [
    deviceId,
    executeCommands,
    flushPendingEvents,
    ownerScope,
    accountGeneration,
    client,
    permissionAttempt,
    syncSnapshots,
    updatePermissionSnapshot,
    disableNativeContext,
  ]);

  return (
    <IOSPermissionContext.Provider value={permissionContext}>
      <SessionLockGate ownerScope={ownerScope}>
        {children}
        {Platform.OS === 'ios'
          && nativeContextAvailableRef.current
          && hasNativeScreenTimeReportView
          && canCollectIOSPermission(permissionSnapshot, 'screenTime') ? (
          <OptionalNativeViewBoundary>
            <HermesScreenTimeReportView
              pointerEvents="none"
              refreshToken={screenTimeReportRefresh}
              style={styles.screenTimeReportTrigger}
            />
          </OptionalNativeViewBoundary>
        ) : null}
      </SessionLockGate>
    </IOSPermissionContext.Provider>
  );
}

function SessionLockGate({ ownerScope, children }: PropsWithChildren<{ ownerScope: string }>) {
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (Platform.OS !== 'ios' || !isNativeIOSContextAvailable()) return;
    try {
      await HermesIOSContext.configureSessionLock(ownerScope, true, 5);
      const status = await HermesIOSContext.getSessionLockStatus(ownerScope);
      setLocked(status.locked === true);
    } catch {
      // A missing optional native bridge must not strand the authenticated root.
      setLocked(false);
    }
  }, [ownerScope]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
      else if (Platform.OS === 'ios' && isNativeIOSContextAvailable()) setLocked(true);
    });
    return () => subscription.remove();
  }, [refresh]);

  const unlock = useCallback(async () => {
    if (busy) return;
    if (!isNativeIOSContextAvailable()) {
      setLocked(false);
      return;
    }
    setBusy(true);
    try {
      await HermesIOSContext.unlockSession(ownerScope);
      setLocked(false);
    } catch {
      setLocked(true);
    } finally {
      setBusy(false);
    }
  }, [busy, ownerScope]);

  if (!locked) return <>{children}</>;
  return (
    <View accessibilityRole="alert" style={styles.sessionLockOverlay}>
      <Text style={styles.sessionLockTitle}>Hermes is locked</Text>
      <Text style={styles.sessionLockBody}>Unlock with Face ID or your device passcode to continue.</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void unlock(); }} style={styles.sessionLockButton}>
        <Text style={styles.sessionLockButtonText}>{busy ? 'Unlocking...' : 'Unlock Hermes'}</Text>
      </Pressable>
    </View>
  );
}

class OptionalNativeViewBoundary extends Component<
  PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

const styles = StyleSheet.create({
  screenTimeReportTrigger: {
    bottom: 0,
    height: 2,
    opacity: 0.01,
    position: 'absolute',
    right: 0,
    width: 2,
  },
  sessionLockOverlay: {
    alignItems: 'center',
    backgroundColor: '#0e0e0e',
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  sessionLockTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 12,
  },
  sessionLockBody: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
    textAlign: 'center',
  },
  sessionLockButton: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sessionLockButtonText: {
    color: '#0e0e0e',
    fontSize: 15,
    fontWeight: '600',
  },
});

async function hasUsableNetwork(): Promise<boolean> {
  try {
    const state = await withDeadline(
      NetInfo.fetch(),
      NETWORK_PROBE_DEADLINE_MS,
      'network reachability probe timed out',
    );
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    // An unavailable reachability probe must not strand the durable queue.
    return true;
  }
}

function normalizeNativeEvent(event: NativeIOSContextEvent): IOSContextEvent {
  const payload = { ...event.payload };
  if (event.source_device_id) payload.source_device_id = event.source_device_id;
  if (event.kind === 'place-visit') {
    payload.arrived_at = payload.arrivedAt ?? event.timestamp;
    payload.departed_at = payload.departedAt ?? null;
    delete payload.arrivedAt;
    delete payload.departedAt;
  }
  if (event.kind === 'location') {
    payload.horizontal_accuracy = payload.horizontal_accuracy ?? payload.accuracy ?? null;
    payload.motion = payload.motion ?? payload.activity ?? payload.mode ?? null;
  }
  if (event.kind === 'motion' && typeof payload.activity === 'string') {
    payload.state = payload.activity;
  }
  return {
    account_generation: event.account_generation,
    id: event.id,
    kind: event.kind,
    lifecycle_epoch: event.lifecycle_epoch,
    source_device_id: event.source_device_id,
    timestamp: event.timestamp,
    payload,
  };
}

function assertIOSNativeActionReady(
  command: IOSDeviceCommand,
  metadata: IOSNativeActionMetadata,
): void {
  if (metadata.confirmation === 'required' && !hasIOSNativeActionConfirmation(command)) {
    throw new Error(`user confirmation required for ${metadata.action_id}`);
  }
}

async function recordIOSActionAudit(
  runCurrent: <T>(operation: () => Promise<T>) => Promise<T>,
  command: IOSDeviceCommand,
  metadata: IOSNativeActionMetadata,
  auditId: string,
  status: 'started' | 'completed' | 'failed',
  attempt: number,
  error?: string,
): Promise<void> {
  try {
    await runCurrent(() => HermesIOSContext.enqueueContextEvents([{
      id: `${auditId}:${attempt}:${status}`,
      kind: metadata.audit_kind,
      timestamp: Date.now(),
      payload: {
        action_id: metadata.action_id,
        attempt,
        capability: metadata.capability,
        command_id: command.id,
        confirmation: metadata.confirmation,
        max_attempts: metadata.max_attempts,
        risk: metadata.risk,
        status,
        ...(error ? { error: error.slice(0, 512) } : {}),
      },
    }]));
  } catch {
    // Auditing must never turn a successful native action into a retry. The
    // encrypted queue will be retried by the normal context relay when ready.
  }
}

async function executeDeviceCommand(
  command: IOSDeviceCommand,
  flushPendingEvents: () => Promise<void>,
  ownerScope: string,
  accountGeneration: string,
  permissionSnapshot: IOSPermissionSnapshot,
  loadSnapshot?: () => Promise<IOSIntelligenceSnapshot>,
  cloud?: HermesCloudApi,
  runCurrent: <T>(operation: () => Promise<T>) => Promise<T> = (operation) => operation(),
): Promise<Record<string, unknown>> {
  const payload = command.payload || {};
  const key = `${command.capability}:${command.action}`;
  if (command.capability === 'qweather' || command.capability === 'amap-route') {
    return { capability: command.capability, execution: 'server', payload };
  }
  const requiredPermission = permissionForCommand(key);
  if (requiredPermission && !canCollectIOSPermission(permissionSnapshot, requiredPermission)) {
    throw new Error(`${requiredPermission} permission is not authorized`);
  }
  switch (key) {
    case 'ios-location:refresh': {
      const location = await runCurrent(() => HermesIOSContext.requestCurrentLocation());
      await runCurrent(flushPendingEvents);
      return { location };
    }
    case 'ios-location:get':
    case 'ios-location:current': {
      return { location: await HermesIOSContext.requestCurrentLocation() };
    }
    case 'ios-location:precise': {
      return { precise: await HermesIOSContext.requestPreciseLocation() };
    }
    case 'ios-location:prepare':
    case 'ios-location:set-predicted-departure': {
      return {
        scheduled: await runCurrent(() => HermesIOSContext.setPredictedDeparture(
          predictedDepartureTimestamp(payload),
        )),
        mode: await runCurrent(() => HermesIOSContext.getLocationMode()),
      };
    }
    case 'ios-trajectory:today':
    case 'ios-trajectory:read': {
      // Pending queue is for upload only. Flush first, then serve today's
      // trajectory from the durable server snapshot (post-sync truth).
      await runCurrent(flushPendingEvents);
      const pending = await runCurrent(() => HermesIOSContext.readPendingEventsByKind(
        EVENT_BATCH_SIZE,
        ['location'],
        ownerScope,
      ));
      let snapshot: IOSIntelligenceSnapshot | null = null;
      let snapshotError = '';
      if (loadSnapshot) {
        try {
          snapshot = await runCurrent(loadSnapshot);
        } catch (error) {
          snapshotError = error instanceof Error ? error.message : String(error);
        }
      }
      return {
        events: pending,
        pending_count: pending.length,
        flushed: true,
        source: snapshot ? 'server_snapshot' : 'local_pending_after_flush',
        date: snapshot?.date || '',
        timezone: snapshot?.timezone || '',
        trajectory: snapshot?.trajectory || [],
        server_time: snapshot?.server_time,
        snapshot_error: snapshotError || undefined,
      };
    }
    case 'ios-trajectory:flush': {
      await runCurrent(flushPendingEvents);
      return { flushed: true };
    }
    case 'ios-places:today':
    case 'ios-places:read': {
      await runCurrent(flushPendingEvents);
      const pending = await runCurrent(() => HermesIOSContext.readPendingEventsByKind(
        EVENT_BATCH_SIZE,
        ['place-visit'],
        ownerScope,
      ));
      let snapshot: IOSIntelligenceSnapshot | null = null;
      let snapshotError = '';
      if (loadSnapshot) {
        try {
          snapshot = await runCurrent(loadSnapshot);
        } catch (error) {
          snapshotError = error instanceof Error ? error.message : String(error);
        }
      }
      return {
        events: pending,
        pending_count: pending.length,
        flushed: true,
        source: snapshot ? 'server_snapshot' : 'local_pending_after_flush',
        date: snapshot?.date || '',
        timezone: snapshot?.timezone || '',
        places: snapshot?.places || [],
        server_time: snapshot?.server_time,
        snapshot_error: snapshotError || undefined,
      };
    }
    case 'ios-motion:snapshot':
    case 'ios-motion:get': {
      return { motion: await HermesIOSContext.getMotionSnapshot() };
    }
    case 'ios-motion:start': {
      return { started: await HermesIOSContext.startMotionUpdates() };
    }
    case 'ios-motion:stop': {
      await HermesIOSContext.stopMotionUpdates();
      return { stopped: true };
    }
    case 'ios-behavior:snapshot':
    case 'ios-behavior:evaluate': {
      const [location, mode, power, device] = await Promise.all([
        HermesIOSContext.requestCurrentLocation(),
        HermesIOSContext.getLocationMode(),
        HermesIOSContext.getPowerSnapshot(),
        HermesIOSContext.getDeviceSnapshot(),
      ]);
      return { device, location, mode, power };
    }
    case 'qweather:server':
    case 'qweather:query':
    case 'amap-route:server':
    case 'amap-route:plan': {
      return { capability: command.capability, execution: 'server', payload };
    }
    case 'ios-map:today':
    case 'ios-map:refresh': {
      return {
        location: await HermesIOSContext.requestCurrentLocation(),
        map: 'native-standard-map',
        preferredProvider: 'amap',
        fallbackProvider: 'mapkit',
        showsPredictions: false,
      };
    }
    case 'ios-power:snapshot':
    case 'ios-power:get': {
      return { power: await HermesIOSContext.getPowerSnapshot() };
    }
    case 'ios-health-sleep:latest':
    case 'ios-health-sleep:history':
    case 'ios-health-heart:latest':
    case 'ios-health-heart:history':
    case 'ios-health-oxygen:latest':
    case 'ios-health-oxygen:history':
    case 'ios-health-activity:latest':
    case 'ios-health-activity:history': {
      const start = requiredTimestamp(payload.start, Date.now() - 24 * 60 * 60_000);
      const end = requiredTimestamp(payload.end, Date.now());
      const health = await HermesIOSContext.getHealthSummary(start, end);
      const prefix = command.capability.replace('ios-health-', '');
      const field = prefix === 'sleep' ? 'sleepMinutes'
        : prefix === 'heart' ? 'heartRateBpm'
        : prefix === 'oxygen' ? 'oxygenSaturation'
        : 'steps';
      return { health, value: health[field] ?? null };
    }
    case 'ios-health-write:authorize': {
      return {
        authorization: await HermesIOSContext.requestHealthWriteAuthorization(
          requiredString(payload.identifier, 'identifier'),
        ),
      };
    }
    case 'ios-health-write:write': {
      const value = requiredNumber(payload.value, 'value');
      const start = requiredTimestamp(payload.start);
      const end = requiredTimestamp(payload.end);
      if (end <= start || end - start > 31 * 24 * 60 * 60_000) {
        throw new Error('health sample range is invalid');
      }
      return HermesIOSContext.writeHealthSampleForCommand(command.id, {
        identifier: requiredString(payload.identifier, 'identifier'),
        value,
        unit: requiredString(payload.unit, 'unit'),
        start,
        end,
      });
    }
    case 'ios-health-write:batch': {
      if (!Array.isArray(payload.samples) || payload.samples.length < 1 || payload.samples.length > 100) {
        throw new Error('health samples are invalid');
      }
      const samples = payload.samples.map((sample) => {
        if (!sample || typeof sample !== 'object') throw new Error('health sample is invalid');
        const item = sample as Record<string, unknown>;
        const start = requiredTimestamp(item.start);
        const end = requiredTimestamp(item.end);
        if (end <= start || end - start > 31 * 24 * 60 * 60_000) throw new Error('health sample range is invalid');
        return {
          identifier: requiredString(item.identifier, 'identifier'),
          value: requiredNumber(item.value, 'value'),
          unit: requiredString(item.unit, 'unit'),
          start,
          end,
        };
      });
      return HermesIOSContext.writeHealthSamplesForCommand(command.id, samples);
    }
    case 'ios-health-write:delete':
      return HermesIOSContext.deleteHealthSamplesForCommand(
        command.id,
        requiredString(payload.identifier, 'identifier'),
      );
    case 'ios-clipboard:read':
    case 'ios-clipboard:get': {
      return HermesIOSContext.readClipboardForCommand(command.id);
    }
    case 'ios-clipboard:write':
    case 'ios-clipboard:set': {
      return HermesIOSContext.writeClipboardForCommand(
        command.id,
        requiredString(payload.text, 'text'),
      );
    }
    case 'ios-calendar:create': {
      return HermesIOSContext.createCalendarEventForCommand(command.id, {
        title: requiredString(payload.title, 'title'),
        start: requiredTimestamp(payload.start),
        end: requiredTimestamp(payload.end),
        ...(typeof payload.location === 'string' ? { location: payload.location } : {}),
        ...(typeof payload.notes === 'string' ? { notes: payload.notes } : {}),
      });
    }
    case 'ios-reminders:create': {
      return HermesIOSContext.createReminderForCommand(command.id, {
        title: requiredString(payload.title, 'title'),
        ...(payload.due !== undefined ? { due: requiredTimestamp(payload.due) } : {}),
        ...(typeof payload.notes === 'string' ? { notes: payload.notes } : {}),
      });
    }
    case 'ios-notes:share-text': {
      return HermesIOSContext.shareTextToNotesForCommand(
        command.id,
        requiredString(payload.text, 'text'),
        typeof payload.title === 'string' ? payload.title : undefined,
      );
    }
    case 'ios-calendar:list': {
      const end = requiredTimestamp(payload.end, Date.now() + 7 * 24 * 60 * 60_000);
      const start = requiredTimestamp(payload.start, Date.now() - 24 * 60 * 60_000);
      return { events: await HermesIOSContext.listCalendarEvents(start, end) };
    }
    case 'ios-calendar:calendars':
      return { calendars: await HermesIOSContext.listCalendars() };
    case 'ios-calendar:freebusy': {
      const end = requiredTimestamp(payload.end, Date.now() + 7 * 24 * 60 * 60_000);
      const start = requiredTimestamp(payload.start, Date.now() - 24 * 60 * 60_000);
      return { busy: await HermesIOSContext.calendarFreeBusy(start, end) };
    }
    case 'ios-calendar:update':
      return HermesIOSContext.updateCalendarEventForCommand(command.id, requiredString(payload.eventID ?? payload.event_id, 'eventID'), {
        ...(typeof payload.title === 'string' ? { title: payload.title } : {}),
        ...(payload.start !== undefined ? { start: requiredTimestamp(payload.start) } : {}),
        ...(payload.end !== undefined ? { end: requiredTimestamp(payload.end) } : {}),
        ...(typeof payload.location === 'string' ? { location: payload.location } : {}),
        ...(typeof payload.notes === 'string' ? { notes: payload.notes } : {}),
      });
    case 'ios-calendar:delete':
      return HermesIOSContext.deleteCalendarEventForCommand(command.id, requiredString(payload.eventID ?? payload.event_id, 'eventID'));
    case 'ios-reminders:list': {
      const completed = typeof payload.completed === 'boolean' ? payload.completed : false;
      return { reminders: await HermesIOSContext.listReminders(completed) };
    }
    case 'ios-reminders:update':
      return HermesIOSContext.updateReminderForCommand(command.id, requiredString(payload.reminderID ?? payload.reminder_id, 'reminderID'), {
        ...(typeof payload.title === 'string' ? { title: payload.title } : {}),
        ...(payload.due !== undefined ? { due: requiredTimestamp(payload.due) } : {}),
        ...(typeof payload.notes === 'string' ? { notes: payload.notes } : {}),
        ...(typeof payload.completed === 'boolean' ? { completed: payload.completed } : {}),
      });
    case 'ios-reminders:complete':
      return HermesIOSContext.updateReminderForCommand(command.id, requiredString(payload.reminderID ?? payload.reminder_id, 'reminderID'), { completed: true });
    case 'ios-reminders:delete':
      return HermesIOSContext.deleteReminderForCommand(command.id, requiredString(payload.reminderID ?? payload.reminder_id, 'reminderID'));
    case 'ios-alarm:schedule': {
      const fireAt = requiredTimestamp(payload.fireAt ?? payload.fire_at ?? payload.due);
      const title = requiredString(payload.title, 'title');
      const body = typeof payload.body === 'string' && payload.body.trim()
        ? payload.body.trim()
        : title;
      const notificationAuthorization = await runCurrent(
        () => HermesIOSContext.getNotificationAuthorization(),
      );
      if (notificationAuthorization !== 'authorized' && notificationAuthorization !== 'limited') {
        throw new Error('notification permission is required');
      }
      const reminderID = await HermesIOSContext.createReminder({
        title,
        due: fireAt,
        ...(typeof payload.notes === 'string' ? { notes: payload.notes } : {}),
      });
      const notificationID = await runCurrent(() => HermesIOSContext.scheduleLocalNotification(
        title,
        body,
        fireAt,
        { capability: 'ios-alarm', reminderID },
      ));
      return { fireAt, notificationID, reminderID };
    }
    case 'ios-alarm:list':
      return { alarms: await HermesIOSContext.listReminders(false) };
    case 'ios-alarm:cancel': {
      const reminderID = typeof payload.reminderID === 'string'
        ? payload.reminderID
        : typeof payload.reminder_id === 'string' ? payload.reminder_id : '';
      const notificationID = typeof payload.notificationID === 'string'
        ? payload.notificationID
        : typeof payload.notification_id === 'string'
          ? payload.notification_id
          : typeof payload.id === 'string' ? payload.id : '';
      if (!reminderID && !notificationID) throw new Error('reminderID or notificationID is required');
      if (reminderID) await HermesIOSContext.deleteReminderForCommand(command.id, reminderID);
      if (notificationID) await HermesIOSContext.cancelLocalNotification(notificationID);
      return { cancelled: true, notificationID, reminderID };
    }
    case 'ios-contacts:list':
    case 'ios-contacts:search': {
      const authorization = await HermesIOSContext.getContactsAuthorization();
      if (authorization !== 'authorized' && authorization !== 'limited') {
        throw new Error('contacts permission is not authorized');
      }
      return {
        contacts: await HermesIOSContext.searchContacts(
          typeof payload.query === 'string' ? payload.query : undefined,
          typeof payload.limit === 'number' ? Math.trunc(payload.limit) : 50,
        ),
      };
    }
    case 'ios-contacts:create': {
      const authorization = await HermesIOSContext.getContactsAuthorization();
      if (authorization !== 'authorized' && authorization !== 'limited') {
        throw new Error('contacts permission is not authorized');
      }
      return {
        contact: await HermesIOSContext.createContactForCommand(command.id, {
          givenName: requiredString(payload.givenName ?? payload.given_name, 'givenName'),
          ...(typeof payload.familyName === 'string' ? { familyName: payload.familyName } : {}),
          ...(typeof payload.organization === 'string' ? { organization: payload.organization } : {}),
          ...(typeof payload.phone === 'string' ? { phone: payload.phone } : {}),
          ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
        }),
      };
    }
    case 'ios-photos:list':
    case 'ios-photos:search': {
      const authorization = await HermesIOSContext.getPhotosAuthorization();
      if (authorization !== 'authorized' && authorization !== 'limited') {
        throw new Error('photos permission is not authorized');
      }
      return {
        photos: await HermesIOSContext.searchPhotos({
          ...(typeof payload.query === 'string' ? { query: payload.query } : {}),
          ...(typeof payload.start === 'number' ? { start: payload.start } : {}),
          ...(typeof payload.end === 'number' ? { end: payload.end } : {}),
          ...(payload.mediaType === 'image' || payload.mediaType === 'video' ? { mediaType: payload.mediaType } : {}),
          limit: typeof payload.limit === 'number' ? Math.trunc(payload.limit) : 50,
        }),
      };
    }
    case 'ios-photos:albums': {
      const authorization = await HermesIOSContext.getPhotosAuthorization();
      if (authorization !== 'authorized' && authorization !== 'limited') throw new Error('photos permission is not authorized');
      return { albums: await HermesIOSContext.listPhotoAlbums(typeof payload.limit === 'number' ? Math.trunc(payload.limit) : 50) };
    }
    case 'ios-photos:near': {
      const authorization = await HermesIOSContext.getPhotosAuthorization();
      if (authorization !== 'authorized' && authorization !== 'limited') throw new Error('photos permission is not authorized');
      return { photos: await HermesIOSContext.searchNearbyPhotos(requiredNumber(payload.latitude, 'latitude'), requiredNumber(payload.longitude, 'longitude'), typeof payload.radiusMeters === 'number' ? payload.radiusMeters : 1_000, typeof payload.limit === 'number' ? Math.trunc(payload.limit) : 50) };
    }
    case 'ios-photos:favorite':
      if (await HermesIOSContext.getPhotosAuthorization() !== 'authorized') throw new Error('full photos permission is required');
      return HermesIOSContext.updatePhotoFavorite(requiredStringArray(payload.assetIDs ?? payload.asset_ids, 'assetIDs'), payload.favorite === true);
    case 'ios-photos:delete':
      if (await HermesIOSContext.getPhotosAuthorization() !== 'authorized') throw new Error('full photos permission is required');
      return HermesIOSContext.deletePhotos(requiredStringArray(payload.assetIDs ?? payload.asset_ids, 'assetIDs'));
    case 'ios-photos:album-create':
      if (await HermesIOSContext.getPhotosAuthorization() !== 'authorized') throw new Error('full photos permission is required');
      return HermesIOSContext.createPhotoAlbum(requiredString(payload.title, 'title'));
    case 'ios-photos:album-add':
      if (await HermesIOSContext.getPhotosAuthorization() !== 'authorized') throw new Error('full photos permission is required');
      return HermesIOSContext.addPhotosToAlbum(requiredStringArray(payload.assetIDs ?? payload.asset_ids, 'assetIDs'), requiredString(payload.albumID ?? payload.album_id, 'albumID'));
    case 'ios-photos:import':
      if (await HermesIOSContext.getPhotosAuthorization() !== 'authorized') throw new Error('full photos permission is required');
      return HermesIOSContext.importPhoto(ownerScope, requiredString(payload.imageURL ?? payload.image_url ?? payload.uri, 'imageURL'));
    case 'ios-photos:export': {
      const authorization = await HermesIOSContext.getPhotosAuthorization();
      if (authorization !== 'authorized' && authorization !== 'limited') throw new Error('photos permission is not authorized');
      if (!cloud) throw new Error('cloud file service is unavailable');
      const exported = await HermesIOSContext.exportPhoto(
        ownerScope,
        requiredString(payload.assetID ?? payload.asset_id, 'assetID'),
        payload.original === true,
      );
      const uri = requiredString(exported.uri, 'exportURI');
      const name = typeof exported.name === 'string' && exported.name.trim()
        ? exported.name.trim().slice(0, 160)
        : `photo-${requiredString(payload.assetID ?? payload.asset_id, 'assetID')}.jpg`;
      const mimeType = typeof exported.mimeType === 'string' ? exported.mimeType : 'application/octet-stream';
      try {
        const uploaded = await cloud.uploadAccountFile(
          {
            name,
            mimeType,
            size: typeof exported.bytes === 'number' ? exported.bytes : undefined,
            uri,
          },
          `ios-photo-export:${command.id}`,
        );
        return {
          ...exported,
          file: uploaded.file,
          uploaded: true,
        };
      } finally {
        await runCurrent(() => HermesIOSContext.deleteExportedPhoto(ownerScope, uri)).catch(() => false);
      }
    }
    case 'ios-photos:ocr': {
      const authorization = await HermesIOSContext.getPhotosAuthorization();
      if (authorization !== 'authorized' && authorization !== 'limited') {
        throw new Error('photos permission is not authorized');
      }
      return HermesIOSContext.ocrImage({
        imageURL: requiredString(payload.imageURL ?? payload.image_url ?? payload.uri, 'imageURL'),
        ownerScope,
        ...(payload.recognitionLevel === 'fast' || payload.recognitionLevel === 'accurate'
          ? { recognitionLevel: payload.recognitionLevel }
          : {}),
        ...(Array.isArray(payload.languages)
          ? { languages: payload.languages.filter((item): item is string => typeof item === 'string').slice(0, 8) }
          : {}),
      });
    }
    case 'ios-vision:analyze':
    case 'ios-vision:classify':
    case 'ios-vision:detect':
    case 'ios-vision:faces':
      return HermesIOSContext.analyzeVision(
        requiredString(payload.imageURL ?? payload.image_url ?? payload.uri, 'imageURL'),
        ownerScope,
        command.action as 'analyze' | 'classify' | 'detect' | 'faces',
      );
    case 'ios-photos:capture':
    case 'ios-photos:scan': {
      if (AppState.currentState !== 'active') {
        throw new Error('camera actions require the Hermes app in the foreground');
      }
      if (command.action === 'scan') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('camera permission is not authorized');
        return HermesIOSContext.scanQRCode();
      }
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error('camera permission is not authorized');
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 1,
        exif: true,
      });
      if (result.canceled) return { cancelled: true, assets: [] };
      return {
        cancelled: false,
        assets: result.assets.map((asset) => ({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          fileName: asset.fileName || null,
          type: asset.type || 'image',
          exif: asset.exif || null,
          scanRequested: command.action === 'scan',
        })),
      };
    }
    case 'ios-media:get': {
      const authorization = await HermesIOSContext.getMediaAuthorization();
      if (authorization !== 'authorized') throw new Error('media permission is not authorized');
      return { media: await HermesIOSContext.getMediaSnapshot() };
    }
    case 'ios-media:play':
    case 'ios-media:resume':
    case 'ios-media:pause':
    case 'ios-media:next':
    case 'ios-media:previous':
    case 'ios-media:stop':
    case 'ios-media:control': {
      const authorization = await HermesIOSContext.getMediaAuthorization();
      if (authorization !== 'authorized') throw new Error('media permission is not authorized');
      const action = command.action === 'control'
        ? requiredString(payload.action, 'action')
        : command.action;
      return { media: await HermesIOSContext.controlMedia(action) };
    }
    case 'ios-media:search': {
      if (await HermesIOSContext.getMediaAuthorization() !== 'authorized') throw new Error('media permission is not authorized');
      return { items: await HermesIOSContext.searchMedia(requiredString(payload.query, 'query'), typeof payload.limit === 'number' ? Math.trunc(payload.limit) : 50) };
    }
    case 'ios-media:play-search':
      if (await HermesIOSContext.getMediaAuthorization() !== 'authorized') throw new Error('media permission is not authorized');
      return HermesIOSContext.playMediaSearch(requiredString(payload.query, 'query'), typeof payload.limit === 'number' ? Math.trunc(payload.limit) : 50);
    case 'ios-media:volume':
      if (await HermesIOSContext.getMediaAuthorization() !== 'authorized') throw new Error('media permission is not authorized');
      return { media: await HermesIOSContext.setMediaVolume(requiredNumber(payload.volume, 'volume')) };
    case 'ios-bluetooth:state':
      return { state: await HermesIOSContext.getBluetoothState() };
    case 'ios-bluetooth:scan':
      return { devices: await HermesIOSContext.scanBluetooth(
        typeof payload.seconds === 'number' ? payload.seconds : 5,
      ) };
    case 'ios-bluetooth:connect':
      return HermesIOSContext.connectBluetooth(ownerScope, requiredString(payload.deviceID ?? payload.device_id, 'deviceID'));
    case 'ios-bluetooth:disconnect':
      await HermesIOSContext.disconnectBluetooth();
      return { disconnected: true };
    case 'ios-bluetooth:services':
      return HermesIOSContext.bluetoothServices(ownerScope, requiredString(payload.deviceID ?? payload.device_id, 'deviceID'));
    case 'ios-bluetooth:read':
      return HermesIOSContext.bluetoothRead(ownerScope, requiredString(payload.deviceID ?? payload.device_id, 'deviceID'), requiredString(payload.serviceUUID ?? payload.service_uuid, 'serviceUUID'), requiredString(payload.characteristicUUID ?? payload.characteristic_uuid, 'characteristicUUID'));
    case 'ios-bluetooth:write':
      return HermesIOSContext.bluetoothWrite(ownerScope, requiredString(payload.deviceID ?? payload.device_id, 'deviceID'), requiredString(payload.serviceUUID ?? payload.service_uuid, 'serviceUUID'), requiredString(payload.characteristicUUID ?? payload.characteristic_uuid, 'characteristicUUID'), requiredString(payload.dataBase64 ?? payload.data_base64, 'dataBase64'), payload.withResponse !== false);
    case 'ios-bluetooth:notify':
      return HermesIOSContext.bluetoothNotify(ownerScope, requiredString(payload.deviceID ?? payload.device_id, 'deviceID'), requiredString(payload.serviceUUID ?? payload.service_uuid, 'serviceUUID'), requiredString(payload.characteristicUUID ?? payload.characteristic_uuid, 'characteristicUUID'), typeof payload.seconds === 'number' ? payload.seconds : 10);
    case 'ios-nfc:scan':
      return HermesIOSContext.startNFCReader();
    case 'ios-nfc:write':
      return HermesIOSContext.writeNFCTag(requiredString(payload.text, 'text'));
    case 'ios-homekit:list':
    case 'ios-homekit:get':
      return { homes: await HermesIOSContext.getHomeKitSnapshot() };
    case 'ios-homekit:search':
      return { accessories: await HermesIOSContext.searchHomeKit(typeof payload.query === 'string' ? payload.query : undefined, typeof payload.limit === 'number' ? Math.trunc(payload.limit) : 50) };
    case 'ios-homekit:scenes':
      return { scenes: await HermesIOSContext.listHomeKitScenes(typeof payload.limit === 'number' ? Math.trunc(payload.limit) : 50) };
    case 'ios-homekit:trigger':
      return HermesIOSContext.triggerHomeKitScene(requiredString(payload.sceneID ?? payload.scene_id, 'sceneID'));
    case 'ios-homekit:set': {
      const value = typeof payload.value === 'string'
        ? payload.value
        : typeof payload.value === 'number' || typeof payload.value === 'boolean'
          ? String(payload.value)
          : requiredString(payload.value, 'value');
      return {
        homeKit: await HermesIOSContext.setHomeKitValue(
          requiredString(payload.accessoryId ?? payload.accessory_id, 'accessoryId'),
          requiredString(payload.characteristicId ?? payload.characteristic_id, 'characteristicId'),
          value,
        ),
      };
    }
    case 'ios-screen-time:capabilities':
      return { screenTime: await HermesIOSContext.getScreenTimeCapabilities() };
    case 'ios-screen-time:get': {
      return { screenTime: await HermesIOSContext.getScreenTimeSnapshot() };
    }
    case 'ios-screen-time:authorize': {
      return { authorization: await HermesIOSContext.requestScreenTimeAuthorization() };
    }
    case 'ios-screen-time:start': {
      const identifier = typeof payload.identifier === 'string' && payload.identifier.trim()
        ? payload.identifier.trim()
        : 'hermes-daily-context';
      return {
        identifier: await HermesIOSContext.startScreenTimeMonitoring(
          identifier,
          Math.trunc(requiredNumber(payload.startHour ?? 0, 'startHour')),
          Math.trunc(requiredNumber(payload.endHour ?? 24, 'endHour')),
        ),
      };
    }
    case 'ios-screen-time:stop': {
      const identifier = typeof payload.identifier === 'string' && payload.identifier.trim()
        ? payload.identifier.trim()
        : 'hermes-daily-context';
      await HermesIOSContext.stopScreenTimeMonitoring(identifier);
      return { stopped: true };
    }
    case 'ios-watch:capabilities':
    case 'ios-watch:get': {
      return { watch: await HermesIOSContext.getWatchSnapshot() };
    }
    case 'ios-watch:send': {
      const sent = await HermesIOSContext.sendWatchMessage(
        typeof payload.message === 'object' && payload.message
          ? payload.message as Record<string, unknown>
          : payload,
      );
      return { sent };
    }
    case 'ios-watch:start-active-relay': {
      const sent = await HermesIOSContext.sendWatchMessage({
        action: 'start-active-relay',
        activity: typeof payload.activity === 'string' ? payload.activity : 'walking',
      });
      return { sent };
    }
    case 'ios-watch:stop-active-relay': {
      const sent = await HermesIOSContext.sendWatchMessage({ action: 'stop-active-relay' });
      return { sent };
    }
    case 'ios-notification:send': {
      const authorization = await runCurrent(
        () => HermesIOSContext.getNotificationAuthorization(),
      );
      if (authorization !== 'authorized' && authorization !== 'limited') {
        throw new Error('notification permission is required');
      }
      const id = await runCurrent(() => HermesIOSContext.scheduleLocalNotification(
        typeof payload.title === 'string' ? payload.title : 'Hermes Agent',
        requiredString(payload.body, 'body'),
        payload.fireAt === undefined ? null : requiredTimestamp(payload.fireAt),
        typeof payload.data === 'object' && payload.data ? payload.data as Record<string, unknown> : {},
      ));
      return { id };
    }
    case 'ios-notification:schedule': {
      const authorization = await runCurrent(
        () => HermesIOSContext.getNotificationAuthorization(),
      );
      if (authorization !== 'authorized' && authorization !== 'limited') {
        throw new Error('notification permission is required');
      }
      const id = await runCurrent(() => HermesIOSContext.scheduleLocalNotification(
        requiredString(payload.title, 'title'),
        requiredString(payload.body, 'body'),
        requiredTimestamp(payload.fireAt),
        typeof payload.data === 'object' && payload.data ? payload.data as Record<string, unknown> : {},
      ));
      return { id };
    }
    case 'ios-notification:cancel': {
      await HermesIOSContext.cancelLocalNotification(requiredString(payload.id, 'id'));
      return { cancelled: true };
    }
    case 'ios-nlp:analyze':
      return HermesIOSContext.analyzeNaturalLanguage(requiredString(payload.text, 'text'));
    case 'ios-browser:navigate':
    case 'ios-browser:screenshot':
    case 'ios-browser:click':
    case 'ios-browser:type':
    case 'ios-browser:get_text':
    case 'ios-browser:scroll':
    case 'ios-browser:get_page_info':
    case 'ios-browser:execute_js':
    case 'ios-browser:find_elements':
    case 'ios-browser:hover':
    case 'ios-browser:get_readable':
    case 'ios-browser:set_user_agent':
    case 'ios-browser:set_viewport':
    case 'ios-browser:get_backbone':
    case 'ios-browser:fetch':
    case 'ios-browser:new_tab':
    case 'ios-browser:close_tab':
    case 'ios-browser:list_tabs':
    case 'ios-browser:get_cookies':
    case 'ios-browser:set_cookies':
    case 'ios-browser:scroll_and_collect':
    case 'ios-browser:wait_for_dom_stable': {
      return HermesIOSContext.executeBrowserForCommand(
        command.id,
        ownerScope,
        command.action,
        payload,
        payload.withBase64 === true || payload.with_base64 === true,
      );
    }
    case 'ios-live-activity:update':
    case 'ios-live-activity:start':
    case 'ios-live-activity:end': {
      return await HermesIOSContext.updateLiveActivity({
        ...payload,
        action: command.action === 'start' ? 'start' : command.action === 'end' ? 'end' : 'update',
      });
    }
    case 'ios-device:snapshot':
    case 'ios-device:get': {
      return { device: await HermesIOSContext.getDeviceSnapshot() };
    }
    case 'ios-device:settings': {
      return { opened: await HermesIOSContext.openDeviceSettings() };
    }
    case 'ios-device:open-url': {
      return HermesIOSContext.openURLForCommand(command.id, requiredString(payload.url, 'url'));
    }
    case 'ios-device:delete-account-data': {
      return {
        deletion: await HermesIOSContext.deleteOwnerScope(ownerScope, accountGeneration),
      };
    }
    default:
      throw new Error(`Unsupported native command: ${command.capability}:${command.action}`);
  }
}

async function drainPendingTaskControls(
  runCurrent: <T>(operation: () => Promise<T>) => Promise<T>,
  api: IOSIntelligenceApi,
  signal: AbortSignal,
  flushPendingEvents: () => Promise<void>,
  ownerScope: string,
  accountGeneration: string,
): Promise<void> {
  const controls = await runCurrent(() => HermesIOSContext.readPendingTaskControls());
  for (const control of controls.slice(0, 20)) {
    const requestId = typeof control.requestID === 'string' ? control.requestID : '';
    if (requestId && !queuedIntentMatchesOwner(control, ownerScope, accountGeneration)) {
      // Never execute an unbound or stale control under the current account.
      await runCurrent(() => HermesIOSContext.consumePendingTaskControl(requestId)).catch(() => false);
      continue;
    }
    const taskID = typeof control.taskID === 'string' ? control.taskID : '';
    if (requestId && taskID && control.action === 'speak-toggle') {
      // Narration is a device-local preference: the runtime control endpoint
      // only accepts run mutations, so the Live Activity Speak/Mute request is
      // applied here against the persisted native switch and never forwarded.
      let enabled = false;
      try {
        enabled = !(await runCurrent(() => HermesIOSContext.getVoiceNarrationEnabled()));
        await runCurrent(() => HermesIOSContext.setVoiceNarrationEnabled(enabled));
      } catch {
        // An externally re-signed build without the narration bridge must not
        // wedge the queue; fall through and consume below.
        enabled = false;
      }
      await runCurrent(() => HermesIOSContext.consumePendingTaskControl(requestId)).catch(() => false);
      await runCurrent(() => HermesIOSContext.enqueueContextEvents([{
        id: `ios-task-control:${requestId}`,
        kind: 'ios-task-control-audit',
        timestamp: Date.now(),
        payload: { action: 'speak-toggle', enabled, request_id: requestId, task_id: taskID, status: 'completed' },
      }]));
      await runCurrent(flushPendingEvents);
      continue;
    }
    const action = control.action === 'cancel'
      || control.action === 'retry'
      || control.action === 'pause'
      || control.action === 'resume'
      ? control.action
      : null;
    if (!requestId || !taskID || !action) {
      if (requestId) {
        await runCurrent(() => HermesIOSContext.consumePendingTaskControl(requestId)).catch(() => false);
      }
      continue;
    }
    try {
      await runCurrent(() => api.controlRuntimeTask(taskID, {
        action,
        requestId,
      }, signal));
      await runCurrent(() => HermesIOSContext.consumePendingTaskControl(requestId));
      await runCurrent(() => HermesIOSContext.enqueueContextEvents([{
        id: `ios-task-control:${requestId}`,
        kind: 'ios-task-control-audit',
        timestamp: Date.now(),
        payload: { action, request_id: requestId, task_id: taskID, status: 'completed' },
      }]));
      await runCurrent(flushPendingEvents);
    } catch {
      // Keep the request durable for the next foreground/background relay.
      // Network and server transient errors therefore do not lose a Siri or
      // Live Activity control request.
    }
  }
}

async function drainPendingAgentTriggers(
  runCurrent: <T>(operation: () => Promise<T>) => Promise<T>,
  cloud: HermesCloudApi,
  ownerScope: string,
  accountGeneration: string,
  deviceId: string,
): Promise<void> {
  const pending = await runCurrent(() => HermesIOSContext.readPendingAgentTriggers());
  let droppedUnboundShares = 0;
  // Rotate the batch window when the first ten triggers remain queued after a
  // transient failure; otherwise poison-ish network items at the head could
  // starve every later Siri/share request until app restart.
  const queueKey = `${ownerScope}\u0000${accountGeneration}\u0000${deviceId}`;
  const start = pending.length > 10
    ? (agentTriggerBatchCursors.get(queueKey) ?? 0) % pending.length
    : 0;
  const batch = pending.length > 10
    ? [...pending.slice(start), ...pending.slice(0, start)].slice(0, 10)
    : pending.slice(0, 10);
  agentTriggerBatchCursors.set(
    queueKey,
    (start + Math.max(1, batch.length)) % Math.max(1, pending.length),
  );
  if (agentTriggerBatchCursors.size > 32) agentTriggerBatchCursors.clear();
  for (const trigger of batch) {
    const requestID = typeof trigger.requestID === 'string' ? trigger.requestID.trim() : '';
    if (requestID && !queuedIntentMatchesOwner(trigger, ownerScope, accountGeneration)) {
      // A queue item from a previous account (or an old unscoped build) is
      // consumed and dropped; it must never reuse its sessionID in this one.
      if (!trigger.ownerScope && !trigger.accountGeneration) droppedUnboundShares += 1;
      // Share Extension attachments live in the shared App Group and are not
      // covered by the native account queue purge. Remove them before ACKing a
      // stale trigger, otherwise every account switch leaves the old account's
      // plaintext copies behind indefinitely.
      await deleteQueuedShareAttachments(runCurrent, trigger);
      await runCurrent(() => HermesIOSContext.consumePendingAgentTrigger(requestID)).catch(() => false);
      continue;
    }
    // One poison trigger (denied permission, missing vault, failed
    // upload) must not wedge the queue head: every earlier error here
    // threw out of the whole drain, the trigger was never consumed,
    // and every later Siri/share/Action-Button request starved until
    // restart. Isolate per trigger.
    try {
      const kind = typeof trigger.kind === 'string' ? trigger.kind.trim().toLowerCase() : '';
      const rawContent = typeof trigger.content === 'string' ? trigger.content.trim() : '';
      const sessionID = typeof trigger.sessionID === 'string' ? trigger.sessionID.trim() : '';
      const model = typeof trigger.model === 'string' ? trigger.model.trim() : '';
      const triggerAttachments = Array.isArray(trigger.attachments) ? trigger.attachments : [];
      if (!requestID) continue;
      if (kind === 'voice-start') {
        if (AppState.currentState !== 'active') continue;
        const authorization = await runCurrent(() => HermesIOSContext.requestVoiceAuthorization());
        if (authorization.microphone !== 'authorized' || authorization.speech !== 'authorized') {
          throw new Error('voice permissions are not authorized');
        }
        await runCurrent(() => HermesIOSContext.startAgentVoiceCapture());
        await runCurrent(() => HermesIOSContext.consumePendingAgentTrigger(requestID));
        continue;
      }
      let runtimeAttachments = triggerAttachments;
      if (kind === 'camera-task') {
        if (AppState.currentState !== 'active') continue;
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('camera permission is not authorized');
        const capture = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: true });
        if (capture.canceled || !capture.assets[0]?.uri) {
          await runCurrent(() => HermesIOSContext.consumePendingAgentTrigger(requestID));
          continue;
        }
        const asset = capture.assets[0];
        runtimeAttachments = [{
          attachmentID: requestID,
          bytes: asset.fileSize,
          filename: asset.fileName || `camera-${requestID}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
          uri: asset.uri,
        }];
      }
      if (!rawContent && runtimeAttachments.length === 0) continue;
      const content = kind === 'clipboard-to-email'
        ? `请把以下剪贴板内容整理成一封可发送的邮件，补全主题、收件人建议和正文：\n\n${rawContent}`
        : kind === 'summarize-meeting'
          ? rawContent
          : kind === 'daily-report'
            ? rawContent
            : `请分析以下内容，并给出结构化结论、风险和下一步行动：\n\n${rawContent}`;
      const title = kind === 'daily-report'
        ? 'Hermes daily work report'
        : kind === 'summarize-meeting'
          ? 'Hermes meeting summary'
          : kind === 'clipboard-to-email'
            ? 'Hermes clipboard email'
            : 'Hermes shared analysis';
      const messageContent = ['send-prompt', 'ask', 'quick-task', 'follow-up'].includes(kind)
        ? rawContent
        : content;
      const createdAt = Date.now();
      const messageID = `ios-trigger-${requestID}`;
      let conversationID = sessionID;
      if (!conversationID) {
        const response = await runCurrent(() => cloud.createConversation(
          'default',
          title,
          `ios-trigger-${requestID}`,
        ));
        const conversation = (response as { conversation?: { id?: string } }).conversation;
        conversationID = typeof conversation?.id === 'string' ? conversation.id.trim() : '';
      }
      if (!conversationID) throw new Error('agent trigger conversation was not created');
      const message: CollaborationMessage = {
        content: messageContent,
        created_at: createdAt,
        id: messageID,
        kind: 'message',
        meta: {
          source: 'ios-agent-trigger',
          trigger_kind: kind,
          trigger_id: requestID,
          ...(sessionID ? { session_id: sessionID } : {}),
          ...(model ? { model } : {}),
        },
        name: 'You',
        role: 'user',
        sender_id: 'ios-agent-trigger',
        sender_name: 'You',
        status: 'completed',
        updated_at: createdAt,
      };
      const uploadedAttachments: Array<Record<string, unknown>> = [];
      const uploadedAttachmentOriginals: string[] = [];
      const attachmentEntries = Array.isArray(runtimeAttachments)
        ? runtimeAttachments.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        : [];
      const shareRoot = HermesIOSContext.getAgentShareAttachmentRootUri?.();
      const encryptedRoot = HermesIOSContext.getAttachmentOutboxRootUri?.();
      const shareAttachmentRoot = shareRoot ?? '';
      const requiresShareRoot = attachmentEntries.some((attachment) => typeof attachment.uri !== 'string');
      if (attachmentEntries.length > 0 && (!encryptedRoot || (requiresShareRoot && !shareRoot))) {
        throw new Error('attachment vault is unavailable');
      }
      if (encryptedRoot && (!requiresShareRoot || shareRoot)) {
        for (const attachment of attachmentEntries.slice(0, 10)) {
          const filename = typeof attachment.attachmentPath === 'string' ? attachment.attachmentPath : '';
          const directURI = typeof attachment.uri === 'string' ? attachment.uri : '';
          if (!directURI && (!filename || filename.includes('/') || filename.includes('\\'))) continue;
          const attachmentID = typeof attachment.attachmentID === 'string' ? attachment.attachmentID : requestID;
          const name = typeof attachment.filename === 'string' && attachment.filename.trim()
            ? attachment.filename.trim().slice(0, 160)
            : `shared-${attachmentID}.bin`;
          const sourceURI = directURI || `${shareAttachmentRoot.replace(/\/$/, '')}/${encodeURIComponent(filename)}`;
          const targetURI = `${encryptedRoot.replace(/\/$/, '')}/agent-share-${encodeURIComponent(attachmentID)}.enc`;
          let plaintextURI = '';
          try {
            await runCurrent(() => HermesIOSContext.encryptAttachment(ownerScope, sourceURI, targetURI));
            plaintextURI = await runCurrent(() => HermesIOSContext.decryptAttachmentForUpload(ownerScope, targetURI, name));
            const uploaded = await runCurrent(() => cloud.uploadConversationAttachment(
              conversationID,
              { name, uri: plaintextURI, size: typeof attachment.bytes === 'number' ? attachment.bytes : undefined },
              { messageId: messageID, profile: 'default', turnId: `ios-trigger-turn-${requestID}`, uploadId: attachmentID },
            ));
            if (uploaded && typeof uploaded === 'object') {
              const record = uploaded as Record<string, unknown>;
              if (record.attachment && typeof record.attachment === 'object') uploadedAttachments.push(record.attachment as Record<string, unknown>);
            }
            await runCurrent(() => HermesIOSContext.deleteDecryptedAttachment(plaintextURI));
            // The ORIGINAL share copy stays on disk until the hosted turn is
            // durably accepted: an enqueue failure below retries the trigger,
            // and that retry must still find its attachments.
            if (filename) uploadedAttachmentOriginals.push(filename);
          } catch {
            if (plaintextURI) {
              await runCurrent(() => HermesIOSContext.deleteDecryptedAttachment(plaintextURI)).catch(() => false);
            }
            // Keep the trigger durable when an attachment upload is transient.
            throw new Error('shared attachment upload failed');
          }
        }
      }
      const attachmentIds = uploadedAttachments.flatMap((item) => typeof item.id === 'string' ? [item.id] : []);
      const attachmentContext = uploadedAttachments.length
        ? JSON.stringify(uploadedAttachments).slice(0, 8_000)
        : '';
      await runCurrent(() => cloud.enqueueHostedTurn(conversationID, {
        attachmentIds,
        attachmentContext,
        deliveryContext: '由 iPhone Siri、分享菜单或 Action Button 触发的 Hermes 任务。',
        message,
        profiles: ['default'],
        recentMessages: [],
        requestId: requestID,
        turnId: `ios-trigger-turn-${requestID}`,
      }));
      // Durable ACK received: the server owns the attachments now, so the
      // plaintext share originals can finally be removed.
      for (const filename of uploadedAttachmentOriginals) {
        await runCurrent(() => HermesIOSContext.deleteAgentShareAttachment?.(filename) ?? Promise.resolve(false)).catch(() => false);
      }
      await runCurrent(() => HermesIOSContext.consumePendingAgentTrigger(requestID));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Permanent failures (denied permissions, unavailable vault) can
      // never succeed on retry — drop the trigger so the queue drains.
      // Transient failures (network, upload) stay queued for the next
      // relay, but we still move on to the remaining triggers.
      const permanent = /permission|not authorized|vault is unavailable/.test(message);
      if (permanent) {
        await runCurrent(() => HermesIOSContext.consumePendingAgentTrigger(requestID)).catch(() => false);
        console.warn(`[ios-context] dropped agent trigger ${requestID}: ${message}`);
      }
      continue;
    }
  }
  if (droppedUnboundShares > 0) {
    // Unbound (pre-hint) share requests are never auto-claimed: surface the
    // drop so the user knows to share again while signed in.
    console.warn(
      `[ios-context] dropped ${droppedUnboundShares} unbound share request(s); `
      + 'share again while signed in to attach them to this account',
    );
  }
}

const agentTriggerBatchCursors = new Map<string, number>();

async function deleteQueuedShareAttachments(
  runCurrent: <T>(operation: () => Promise<T>) => Promise<T>,
  trigger: Record<string, unknown>,
): Promise<void> {
  const attachments = Array.isArray(trigger.attachments)
    ? trigger.attachments.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
    : [];
  for (const attachment of attachments) {
    const filename = typeof attachment.attachmentPath === 'string'
      ? attachment.attachmentPath.trim()
      : '';
    if (!filename || filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') {
      continue;
    }
    await runCurrent(() => HermesIOSContext.deleteAgentShareAttachment?.(filename) ?? Promise.resolve(false))
      .catch(() => false);
  }
}

function queuedIntentMatchesOwner(
  value: Record<string, unknown>,
  ownerScope: string,
  accountGeneration: string,
): boolean {
  const queuedOwner = typeof value.ownerScope === 'string'
    ? value.ownerScope
    : typeof value.owner_scope === 'string'
      ? value.owner_scope
      : '';
  const queuedGeneration = typeof value.accountGeneration === 'string'
    ? value.accountGeneration
    : typeof value.account_generation === 'string'
      ? value.account_generation
      : '';
  // Strict identity fence: an entry must carry the CURRENT account's
  // ownerScope and accountGeneration or it never executes. Unbound entries
  // (pre-hint legacy payloads) are dropped by the drain loop — the first
  // signed-in account must never claim another account's share silently.
  return Boolean(ownerScope && accountGeneration)
    && queuedOwner === ownerScope
    && queuedGeneration === accountGeneration;
}

function permissionForCommand(key: string): IOSPermissionKey | null {
  if (/^ios-location:(refresh|get|current|precise|prepare|set-predicted-departure)$/.test(key)) {
    return 'location';
  }
  if (/^ios-map:(today|refresh)$/.test(key)) return 'location';
  if (/^ios-motion:(snapshot|get|start)$/.test(key)) return 'motion';
  if (/^ios-health-write:/.test(key)) return null;
  if (/^ios-health-/.test(key)) return 'health';
  if (/^ios-calendar:(create|list|calendars|freebusy|update|delete)$/.test(key)) return 'calendar';
  if (/^ios-reminders:(create|list|update|complete|delete)$/.test(key)) return 'reminders';
  if (/^ios-alarm:(schedule|list|cancel)$/.test(key)) return 'reminders';
  if (/^ios-screen-time:(get|start)$/.test(key)) return 'screenTime';
  if (/^ios-notification:(send|schedule)$/.test(key)) return 'notification';
  return null;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function requiredStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} is required`);
  const values = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (!values.length) throw new Error(`${name} is required`);
  return values;
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} is required`);
  return value;
}

function requiredTimestamp(value: unknown, fallback?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error('timestamp is required');
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  throw new Error('timestamp is required');
}

function normalizeTimestamp(value: number): number {
  return value < 10_000_000_000 ? value * 1000 : value;
}

function parseStoredCommand(value: Record<string, unknown>): PersistedIOSDeviceCommand | null {
  if (typeof value.id !== 'string' || typeof value.capability !== 'string' || typeof value.action !== 'string') {
    return null;
  }
  return {
    _relay_device_id: typeof value._relay_device_id === 'string' ? value._relay_device_id : '',
    _relay_owner_scope: typeof value._relay_owner_scope === 'string' ? value._relay_owner_scope : '',
    ...(value._relay_execution_status === 'completed'
      || value._relay_execution_status === 'executing'
      || value._relay_execution_status === 'failed'
      ? { _relay_execution_status: value._relay_execution_status }
      : {}),
    ...(typeof value._relay_error === 'string' ? { _relay_error: value._relay_error } : {}),
    ...(typeof value._relay_attempts === 'number' && Number.isFinite(value._relay_attempts)
      ? { _relay_attempts: Math.max(0, Math.floor(value._relay_attempts)) }
      : {}),
    ...(typeof value._relay_result === 'object' && value._relay_result
      ? { _relay_result: value._relay_result as Record<string, unknown> }
      : {}),
    ...(typeof value.action_metadata === 'object' && value.action_metadata
      ? { action_metadata: value.action_metadata as IOSDeviceCommand['action_metadata'] }
      : {}),
    id: value.id,
    capability: value.capability,
    action: value.action,
    payload: typeof value.payload === 'object' && value.payload
      ? value.payload as Record<string, unknown>
      : {},
    created_at: typeof value.created_at === 'number' ? value.created_at : Date.now(),
    ...(typeof value.expires_at === 'number' ? { expires_at: value.expires_at } : {}),
  };
}
