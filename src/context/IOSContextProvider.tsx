import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Platform, StyleSheet } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import {
  HermesIOSContext,
  HermesScreenTimeReportView,
  hasNativeIOSContext,
  type IOSContextEvent as NativeIOSContextEvent,
  type IOSHealthSummary,
} from '../../modules/hermes-ios-context';
import type { HermesApiClient } from '../api/HermesApiClient';
import { IOSIntelligenceApi, type IOSContextEvent, type IOSDeviceCommand } from './IOSIntelligenceApi';
import { predictedDepartureTimestamp } from './ios-command-contract';
import { buildCollectionSnapshotEvents, snapshotEvent } from './ios-snapshot-events';

interface IOSContextProviderProps extends PropsWithChildren {
  client: HermesApiClient;
  deviceId: string;
  ownerScope: string;
}

interface PersistedIOSDeviceCommand extends IOSDeviceCommand {
  _relay_device_id: string;
  _relay_owner_scope: string;
  _relay_error?: string;
  _relay_execution_status?: 'completed' | 'executing' | 'failed';
  _relay_result?: Record<string, unknown>;
}

const EVENT_BATCH_SIZE = 200;
const FOREGROUND_SYNC_MS = 20_000;
const SNAPSHOT_SYNC_MS = 30 * 60_000;

export function IOSContextProvider({ children, client, deviceId, ownerScope }: IOSContextProviderProps) {
  const apiRef = useRef(new IOSIntelligenceApi(client));
  const commandCursorRef = useRef('');
  const runningRef = useRef(false);
  const commandsRunningRef = useRef(false);
  const [screenTimeReportRefresh, setScreenTimeReportRefresh] = useState(() => Date.now());

  useEffect(() => {
    apiRef.current = new IOSIntelligenceApi(client);
  }, [client]);

  const flushPendingEvents = useCallback(async () => {
    if (!hasNativeIOSContext || runningRef.current) return;
    runningRef.current = true;
    try {
      if (!await hasUsableNetwork()) return;
      while (true) {
        const pending = await HermesIOSContext.readPendingEvents(EVENT_BATCH_SIZE, ownerScope);
        if (!pending.length) break;
        const events = pending.map(normalizeNativeEvent);
        const cursor = String(Math.max(...pending.map((event) => event.sequence)));
        await apiRef.current.uploadEvents({ cursor, deviceId, events });
        await HermesIOSContext.acknowledgeEvents(
          pending.map((event) => event.id),
          Number(cursor),
          ownerScope,
        );
        if (pending.length < EVENT_BATCH_SIZE) break;
      }
    } finally {
      runningRef.current = false;
    }
  }, [deviceId, ownerScope]);

  const syncSnapshots = useCallback(async () => {
    if (!hasNativeIOSContext) return;
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60_000;
    const monthAhead = now + 31 * 24 * 60 * 60_000;
    const [capabilities, power, health, calendar, reminders, device, screenTime, watch] = await Promise.all([
      HermesIOSContext.getCapabilities(),
      HermesIOSContext.getPowerSnapshot(),
      HermesIOSContext.getHealthSummary(dayAgo, now).catch(() => null),
      HermesIOSContext.listCalendarEvents(now - 24 * 60 * 60_000, monthAhead).catch(() => []),
      HermesIOSContext.listReminders(false).catch(() => []),
      HermesIOSContext.getDeviceSnapshot().catch(() => null),
      HermesIOSContext.getScreenTimeSnapshot().catch(() => null),
      HermesIOSContext.getWatchSnapshot().catch(() => null),
    ]);
    const events: IOSContextEvent[] = [
      snapshotEvent('power', now, { ...power }, '', deviceId),
      snapshotEvent('device', now, {
        ...(device || {}),
        capabilities: { ...capabilities },
      }, '', deviceId),
      ...(screenTime ? [snapshotEvent('screen-time', now, { ...screenTime }, '', deviceId)] : []),
      ...(watch ? [snapshotEvent('watch', now, { ...watch }, '', deviceId)] : []),
      ...healthEvents(now, health).map((event) => ({
        ...event,
        source_device_id: deviceId,
        payload: { ...event.payload, source_device_id: deviceId },
      })),
      ...buildCollectionSnapshotEvents('calendar', calendar, now, deviceId),
      ...buildCollectionSnapshotEvents('reminder', reminders, now, deviceId),
    ];
    // Every context sample reaches the native AES-GCM queue before the first
    // network attempt. A failed upload therefore follows the same cursor/ACK
    // recovery path as background location and Watch events.
    await HermesIOSContext.enqueueContextEvents(events as unknown as Record<string, unknown>[]);
    await flushPendingEvents();
  }, [deviceId, flushPendingEvents]);

  const executeCommands = useCallback(async () => {
    if (!hasNativeIOSContext || commandsRunningRef.current) return;
    commandsRunningRef.current = true;
    try {
      if (!await hasUsableNetwork()) return;
      const storedCommands = (await HermesIOSContext.readPendingCommands())
        .filter((command) => (
          command._relay_device_id === deviceId
          && command._relay_owner_scope === ownerScope
        ))
        .map(parseStoredCommand)
        .filter((command): command is PersistedIOSDeviceCommand => command !== null);
      const response = await apiRef.current.pullCommands(deviceId, commandCursorRef.current).catch((error) => {
        if (!storedCommands.length) throw error;
        return { commands: [] as IOSDeviceCommand[], cursor: commandCursorRef.current };
      });
      const serverCommands: PersistedIOSDeviceCommand[] = (response.commands || []).map((command) => ({
        ...command,
        _relay_device_id: deviceId,
        _relay_owner_scope: ownerScope,
      }));
      const commands = [...storedCommands, ...serverCommands]
        .filter((command, index, all) => all.findIndex((candidate) => candidate.id === command.id) === index);
      for (let command of commands) {
        if (await HermesIOSContext.hasCompletedCommand(command.id)) {
          commandCursorRef.current = command.id;
          await HermesIOSContext.removePendingCommand(command.id);
          continue;
        }

        if (command.expires_at && normalizeTimestamp(command.expires_at) <= Date.now()) {
          command = { ...command, _relay_error: 'expired', _relay_execution_status: 'failed' };
          await HermesIOSContext.storePendingCommand(command as unknown as Record<string, unknown>);
        } else if (command._relay_execution_status === 'executing') {
          command = {
            ...command,
            _relay_error: 'interrupted during native execution',
            _relay_execution_status: 'failed',
          };
          await HermesIOSContext.storePendingCommand(command as unknown as Record<string, unknown>);
        } else if (!command._relay_execution_status) {
          command = { ...command, _relay_execution_status: 'executing' };
          await HermesIOSContext.storePendingCommand(command as unknown as Record<string, unknown>);
          try {
            const result = await executeDeviceCommand(command, flushPendingEvents, ownerScope);
            command = { ...command, _relay_execution_status: 'completed', _relay_result: result };
          } catch (error) {
            command = {
              ...command,
              _relay_error: error instanceof Error ? error.message : String(error),
              _relay_execution_status: 'failed',
            };
          }
          await HermesIOSContext.storePendingCommand(command as unknown as Record<string, unknown>);
        }

        await apiRef.current.acknowledgeCommand(deviceId, command.id, command._relay_execution_status === 'completed'
          ? { result: command._relay_result || {}, status: 'completed' }
          : { error: command._relay_error || 'native command failed', status: 'failed' });
        commandCursorRef.current = command.id;
        await HermesIOSContext.recordCommandCompletion(command.id, command.id);
        await HermesIOSContext.removePendingCommand(command.id);
      }
      if (response.cursor) {
        commandCursorRef.current = response.cursor;
        await HermesIOSContext.recordCommandCompletion(`cursor:${response.cursor}`, response.cursor);
      }
    } finally {
      commandsRunningRef.current = false;
    }
  }, [deviceId, flushPendingEvents, ownerScope]);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !hasNativeIOSContext || !deviceId.trim()) return undefined;
    let active = true;
    let snapshotTimer: ReturnType<typeof setInterval> | undefined;
    let eventFlushTimer: ReturnType<typeof setTimeout> | undefined;

    const synchronize = () => {
      if (!active) return;
      void flushPendingEvents().catch(() => undefined);
      void executeCommands().catch(() => undefined);
    };
    const scheduleEventSync = () => {
      if (!active || eventFlushTimer) return;
      eventFlushTimer = setTimeout(() => {
        eventFlushTimer = undefined;
        synchronize();
      }, 10_000);
    };
    const synchronizeFromBackgroundWake = async (event: { wakeId?: string }) => {
      let success = true;
      try {
        if (!await hasUsableNetwork()) throw new Error('network unavailable');
        await flushPendingEvents();
        await executeCommands();
        await syncSnapshots();
      } catch {
        success = false;
      } finally {
        if (event.wakeId) {
          await HermesIOSContext.completeBackgroundRelay(event.wakeId, success).catch(() => undefined);
        }
      }
    };
    const startCollectors = async () => {
      await HermesIOSContext.activateOwnerScope(ownerScope);
      await HermesIOSContext.setOwnerScope(ownerScope);
      commandCursorRef.current = await HermesIOSContext.getCommandCursor();
      const locationState = await HermesIOSContext.getLocationAuthorization();
      const locationDetails: Record<string, unknown> = await HermesIOSContext
        .getLocationAuthorizationDetails()
        .catch(() => ({} as Record<string, unknown>));
      // An existing When-In-Use grant is reported as "authorized" too, but it
      // cannot sustain the background collector. Ask the native manager to
      // perform its Always-upgrade flow whenever the detailed status says it
      // has not been granted yet.
      if (locationState === 'notDetermined' || locationDetails['always'] !== true) {
        await HermesIOSContext.requestLocationAuthorization();
      }
      await HermesIOSContext.requestPreciseLocation().catch(() => false);
      await HermesIOSContext.requestHealthAuthorization().catch(() => 'denied' as const);
      await HermesIOSContext.requestCalendarAuthorization().catch(() => 'denied' as const);
      await HermesIOSContext.requestReminderAuthorization().catch(() => 'denied' as const);
      const screenTimeAuthorization = await HermesIOSContext
        .requestScreenTimeAuthorization()
        .catch(() => 'denied' as const);
      if (screenTimeAuthorization === 'authorized') {
        await HermesIOSContext
          .startScreenTimeMonitoring('hermes-daily-context', 0, 24)
          .catch(() => undefined);
        setScreenTimeReportRefresh(Date.now());
      }
      await HermesIOSContext.startAdaptiveLocation();
      await HermesIOSContext.startMotionUpdates();
      await HermesIOSContext.scheduleBackgroundTasks().catch(() => undefined);
      synchronize();
      void syncSnapshots().catch(() => undefined);
      const pendingWakes = await HermesIOSContext.listPendingRelayWakes().catch(() => []);
      for (const wake of pendingWakes) {
        await synchronizeFromBackgroundWake(wake);
      }
    };

    void startCollectors().catch(() => undefined);
    const eventSubscriptions = [
      HermesIOSContext.subscribeLocation(scheduleEventSync),
      HermesIOSContext.subscribeMotion(scheduleEventSync),
      HermesIOSContext.subscribeVisit(synchronize),
      HermesIOSContext.subscribeBackgroundWake((event) => {
        void synchronizeFromBackgroundWake(event);
      }),
    ];
    const foregroundTimer = setInterval(() => {
      if (AppState.currentState === 'active') synchronize();
    }, FOREGROUND_SYNC_MS);
    snapshotTimer = setInterval(() => {
      if (AppState.currentState === 'active') {
        setScreenTimeReportRefresh(Date.now());
        void syncSnapshots().catch(() => undefined);
      }
    }, SNAPSHOT_SYNC_MS);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setScreenTimeReportRefresh(Date.now());
        synchronize();
        void syncSnapshots().catch(() => undefined);
      }
    });

    return () => {
      active = false;
      clearInterval(foregroundTimer);
      if (snapshotTimer) clearInterval(snapshotTimer);
      if (eventFlushTimer) clearTimeout(eventFlushTimer);
      appStateSubscription.remove();
      eventSubscriptions.forEach((subscription) => subscription.remove());
      void HermesIOSContext.stopMotionUpdates().catch(() => undefined);
      // Location monitoring intentionally remains active for background collection.
    };
  }, [deviceId, executeCommands, flushPendingEvents, ownerScope, syncSnapshots]);

  return (
    <>
      {children}
      {Platform.OS === 'ios' && hasNativeIOSContext ? (
        <HermesScreenTimeReportView
          pointerEvents="none"
          refreshToken={screenTimeReportRefresh}
          style={styles.screenTimeReportTrigger}
        />
      ) : null}
    </>
  );
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
});

async function hasUsableNetwork(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
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
    id: event.id,
    kind: event.kind,
    source_device_id: event.source_device_id,
    timestamp: event.timestamp,
    payload,
  };
}

function healthEvents(
  timestamp: number,
  summary: IOSHealthSummary | null,
): IOSContextEvent[] {
  if (!summary) return [];
  return [
    snapshotEvent('health-sleep', timestamp, {
      authorization: summary.authorization,
      sleepMinutes: summary.sleepMinutes,
    }),
    snapshotEvent('health-heart', timestamp, {
      authorization: summary.authorization,
      heartRateBpm: summary.heartRateBpm,
      restingHeartRateBpm: summary.restingHeartRateBpm,
    }),
    snapshotEvent('health-oxygen', timestamp, {
      authorization: summary.authorization,
      oxygenSaturation: summary.oxygenSaturation,
    }),
    snapshotEvent('health-activity', timestamp, {
      activeEnergyKcal: summary.activeEnergyKcal,
      authorization: summary.authorization,
      distanceWalkingRunningMeters: summary.distanceWalkingRunningMeters,
      exerciseMinutes: summary.exerciseMinutes,
      steps: summary.steps,
      workouts: summary.workouts || [],
    }),
  ];
}

async function executeDeviceCommand(
  command: IOSDeviceCommand,
  flushPendingEvents: () => Promise<void>,
  ownerScope: string,
): Promise<Record<string, unknown>> {
  const payload = command.payload || {};
  const key = `${command.capability}:${command.action}`;
  if (command.capability === 'qweather' || command.capability === 'amap-route') {
    return { capability: command.capability, execution: 'server', payload };
  }
  switch (key) {
    case 'ios-location:refresh': {
      const location = await HermesIOSContext.requestCurrentLocation();
      await flushPendingEvents();
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
        scheduled: await HermesIOSContext.setPredictedDeparture(
          predictedDepartureTimestamp(payload),
        ),
        mode: await HermesIOSContext.getLocationMode(),
      };
    }
    case 'ios-trajectory:today':
    case 'ios-trajectory:read': {
      const events = await HermesIOSContext.readPendingEventsByKind(
        EVENT_BATCH_SIZE,
        ['location'],
        ownerScope,
      );
      return { events };
    }
    case 'ios-trajectory:flush': {
      await flushPendingEvents();
      return { flushed: true };
    }
    case 'ios-places:today':
    case 'ios-places:read': {
      const events = await HermesIOSContext.readPendingEventsByKind(
        EVENT_BATCH_SIZE,
        ['place-visit'],
        ownerScope,
      );
      return { events };
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
        map: 'MKMapView.standard.flat',
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
    case 'ios-calendar:create': {
      const id = await HermesIOSContext.createCalendarEvent({
        title: requiredString(payload.title, 'title'),
        start: requiredTimestamp(payload.start),
        end: requiredTimestamp(payload.end),
        ...(typeof payload.location === 'string' ? { location: payload.location } : {}),
        ...(typeof payload.notes === 'string' ? { notes: payload.notes } : {}),
      });
      return { id };
    }
    case 'ios-reminders:create': {
      const id = await HermesIOSContext.createReminder({
        title: requiredString(payload.title, 'title'),
        ...(payload.due !== undefined ? { due: requiredTimestamp(payload.due) } : {}),
        ...(typeof payload.notes === 'string' ? { notes: payload.notes } : {}),
      });
      return { id };
    }
    case 'ios-notes:share-text': {
      const shown = await HermesIOSContext.shareTextToNotes(
        requiredString(payload.text, 'text'),
        typeof payload.title === 'string' ? payload.title : undefined,
      );
      return { shown };
    }
    case 'ios-calendar:list': {
      const end = requiredTimestamp(payload.end, Date.now() + 7 * 24 * 60 * 60_000);
      const start = requiredTimestamp(payload.start, Date.now() - 24 * 60 * 60_000);
      return { events: await HermesIOSContext.listCalendarEvents(start, end) };
    }
    case 'ios-reminders:list': {
      const completed = typeof payload.completed === 'boolean' ? payload.completed : false;
      return { reminders: await HermesIOSContext.listReminders(completed) };
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
      const authorization = await HermesIOSContext.requestNotificationAuthorization();
      if (authorization !== 'authorized') throw new Error('notification permission is required');
      const id = await HermesIOSContext.scheduleLocalNotification(
        typeof payload.title === 'string' ? payload.title : 'Hermes Agent',
        requiredString(payload.body, 'body'),
        payload.fireAt === undefined ? null : requiredTimestamp(payload.fireAt),
        typeof payload.data === 'object' && payload.data ? payload.data as Record<string, unknown> : {},
      );
      return { id };
    }
    case 'ios-notification:schedule': {
      const authorization = await HermesIOSContext.requestNotificationAuthorization();
      if (authorization !== 'authorized') throw new Error('notification permission is required');
      const id = await HermesIOSContext.scheduleLocalNotification(
        requiredString(payload.title, 'title'),
        requiredString(payload.body, 'body'),
        requiredTimestamp(payload.fireAt),
        typeof payload.data === 'object' && payload.data ? payload.data as Record<string, unknown> : {},
      );
      return { id };
    }
    case 'ios-notification:cancel': {
      await HermesIOSContext.cancelLocalNotification(requiredString(payload.id, 'id'));
      return { cancelled: true };
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
    case 'ios-device:delete-account-data': {
      return { deletedEvents: await HermesIOSContext.deleteOwnerScope(ownerScope) };
    }
    default:
      throw new Error(`Unsupported native command: ${command.capability}:${command.action}`);
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
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
    ...(typeof value._relay_result === 'object' && value._relay_result
      ? { _relay_result: value._relay_result as Record<string, unknown> }
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
