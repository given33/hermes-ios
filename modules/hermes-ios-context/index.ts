import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { createElement, forwardRef, type ComponentType } from 'react';
import {
  Platform,
  View,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';

export type IOSAuthorizationState =
  | 'authorized'
  | 'denied'
  | 'limited'
  | 'notDetermined'
  | 'restricted'
  | 'unavailable';

export interface IOSContextCapabilities {
  calendar: boolean;
  health: boolean;
  location: boolean;
  locationAlways: boolean;
  locationPrecise: boolean;
  motion: boolean;
  notesShare: boolean;
  reminders: boolean;
  screenTime: boolean;
  watch: boolean;
  liveActivity: boolean;
  backgroundTasks: boolean;
  apns: boolean;
}

export interface IOSCoordinate {
  latitude: number;
  longitude: number;
  timestamp?: number;
}

export interface IOSLocationSnapshot extends IOSCoordinate {
  accuracy: number;
  altitude: number;
  course: number;
  speed: number;
  authorization: IOSAuthorizationState;
  precision: 'full' | 'reduced';
}

export interface IOSVisitEvent extends IOSCoordinate {
  arrivedAt: number | null;
  departedAt: number | null;
  accuracy: number;
}

export interface IOSMotionSnapshot {
  activity: 'automotive' | 'cycling' | 'running' | 'stationary' | 'unknown' | 'walking';
  confidence: 'high' | 'low' | 'medium' | 'unknown';
  timestamp: number;
}

export interface IOSPowerSnapshot {
  batteryLevel: number | null;
  batteryState: 'charging' | 'full' | 'unknown' | 'unplugged';
  lowPowerMode: boolean;
  thermalState?: string;
  availableDiskBytes?: number | null;
}

export interface IOSContextEvent {
  id: string;
  kind: 'health' | 'location' | 'motion' | 'place-visit' | 'power' | string;
  payload: Record<string, unknown>;
  source_device_id?: string;
  sequence: number;
  timestamp: number;
}

export interface IOSHealthSummary {
  authorization: IOSAuthorizationState;
  heartRateBpm: number | null;
  oxygenSaturation: number | null;
  restingHeartRateBpm?: number | null;
  sleepMinutes: number | null;
  steps: number | null;
  activeEnergyKcal?: number | null;
  exerciseMinutes?: number | null;
  distanceWalkingRunningMeters?: number | null;
  workouts?: Array<Record<string, unknown>>;
}

export interface IOSCalendarItem {
  calendar: string;
  end: number;
  id: string;
  location: string | null;
  start: number;
  title: string;
}

export interface IOSReminderItem {
  completed: boolean;
  due: number | null;
  id: string;
  list: string;
  title: string;
}

export interface IOSContextNativeModule {
  addListener(
    eventName: 'onLocation',
    listener: (event: IOSLocationSnapshot) => void,
  ): { remove(): void };
  addListener(
    eventName: 'onMotion',
    listener: (event: IOSMotionSnapshot) => void,
  ): { remove(): void };
  addListener(
    eventName: 'onVisit',
    listener: (event: IOSVisitEvent) => void,
  ): { remove(): void };
  addListener(
    eventName: 'onBackgroundWake',
    listener: (event: { reason?: string; timestamp?: number; wakeId?: string }) => void,
  ): { remove(): void };
  getCapabilities(): Promise<IOSContextCapabilities>;
  getLocationAuthorization(): Promise<IOSAuthorizationState>;
  requestLocationAuthorization(): Promise<IOSAuthorizationState>;
  requestPreciseLocation(): Promise<boolean>;
  getLocationAuthorizationDetails(): Promise<Record<string, unknown>>;
  startAdaptiveLocation(): Promise<boolean>;
  stopAdaptiveLocation(): Promise<void>;
  requestCurrentLocation(): Promise<IOSLocationSnapshot | null>;
  setPredictedDeparture(timestamp?: number | null): Promise<boolean>;
  getLocationMode(): Promise<string>;
  getMotionAuthorization(): Promise<IOSAuthorizationState>;
  startMotionUpdates(): Promise<boolean>;
  stopMotionUpdates(): Promise<void>;
  getMotionSnapshot(): Promise<IOSMotionSnapshot | null>;
  getPowerSnapshot(): Promise<IOSPowerSnapshot>;
  getDeviceSnapshot(): Promise<Record<string, unknown>>;
  openDeviceSettings(): Promise<boolean>;
  getInstallationIdentifier(): Promise<string>;
  enqueueContextEvents(events: readonly Record<string, unknown>[]): Promise<number>;
  readPendingEvents(limit: number, scope?: string): Promise<IOSContextEvent[]>;
  readPendingEventsByKind(
    limit: number,
    kinds: readonly string[],
    scope?: string,
  ): Promise<IOSContextEvent[]>;
  acknowledgeEvents(ids: readonly string[], cursor?: number, scope?: string): Promise<number>;
  setOwnerScope(scope: string): Promise<void>;
  activateOwnerScope(scope: string): Promise<number>;
  deleteOwnerScope(scope: string): Promise<number>;
  getCommandCursor(): Promise<string>;
  hasCompletedCommand(id: string): Promise<boolean>;
  recordCommandCompletion(id: string, cursor: string): Promise<void>;
  storePendingCommand(command: Record<string, unknown>): Promise<void>;
  readPendingCommands(): Promise<Array<Record<string, unknown>>>;
  removePendingCommand(id: string): Promise<void>;
  requestHealthAuthorization(): Promise<IOSAuthorizationState>;
  getHealthSummary(start: number, end: number): Promise<IOSHealthSummary>;
  requestCalendarAuthorization(): Promise<IOSAuthorizationState>;
  requestReminderAuthorization(): Promise<IOSAuthorizationState>;
  listCalendarEvents(start: number, end: number): Promise<IOSCalendarItem[]>;
  createCalendarEvent(input: {
    end: number;
    location?: string;
    notes?: string;
    start: number;
    title: string;
  }): Promise<string>;
  listReminders(completed?: boolean): Promise<IOSReminderItem[]>;
  createReminder(input: {
    due?: number;
    notes?: string;
    title: string;
  }): Promise<string>;
  shareTextToNotes(text: string, title?: string): Promise<boolean>;
  requestNotificationAuthorization(): Promise<IOSAuthorizationState>;
  scheduleLocalNotification(
    title: string,
    body: string,
    fireAt?: number | null,
    data?: Record<string, unknown>,
  ): Promise<string>;
  cancelLocalNotification(identifier: string): Promise<void>;
  getWatchCapabilities(): Promise<Record<string, unknown>>;
  getWatchSnapshot(): Promise<Record<string, unknown>>;
  sendWatchMessage(payload: Record<string, unknown>): Promise<boolean>;
  getScreenTimeCapabilities(): Promise<Record<string, unknown>>;
  getScreenTimeSnapshot(): Promise<Record<string, unknown>>;
  requestScreenTimeAuthorization(): Promise<IOSAuthorizationState>;
  startScreenTimeMonitoring(identifier: string, startHour: number, endHour: number): Promise<string>;
  stopScreenTimeMonitoring(identifier: string): Promise<void>;
  updateLiveActivity(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  scheduleBackgroundTasks(): Promise<void>;
  listPendingRelayWakes(): Promise<Array<{ reason: string; wakeId: string }>>;
  completeBackgroundRelay(wakeId: string, success: boolean): Promise<void>;
}

const nativeModule = requireOptionalNativeModule<IOSContextNativeModule>('HermesIOSContext');

function requireContextModule(): IOSContextNativeModule {
  if (!nativeModule) {
    throw new Error('Hermes iOS context requires an iOS development or signed build.');
  }
  return nativeModule;
}

export const hasNativeIOSContext = Platform.OS === 'ios' && nativeModule !== null;

export const HermesIOSContext = {
  getCapabilities: () => requireContextModule().getCapabilities(),
  getLocationAuthorization: () => requireContextModule().getLocationAuthorization(),
  requestLocationAuthorization: () => requireContextModule().requestLocationAuthorization(),
  requestPreciseLocation: () => requireContextModule().requestPreciseLocation(),
  getLocationAuthorizationDetails: () => requireContextModule().getLocationAuthorizationDetails(),
  startAdaptiveLocation: () => requireContextModule().startAdaptiveLocation(),
  stopAdaptiveLocation: () => requireContextModule().stopAdaptiveLocation(),
  requestCurrentLocation: () => requireContextModule().requestCurrentLocation(),
  setPredictedDeparture: (timestamp?: number | null) =>
    requireContextModule().setPredictedDeparture(timestamp),
  getLocationMode: () => requireContextModule().getLocationMode(),
  getMotionAuthorization: () => requireContextModule().getMotionAuthorization(),
  startMotionUpdates: () => requireContextModule().startMotionUpdates(),
  stopMotionUpdates: () => requireContextModule().stopMotionUpdates(),
  getMotionSnapshot: () => requireContextModule().getMotionSnapshot(),
  getPowerSnapshot: () => requireContextModule().getPowerSnapshot(),
  getDeviceSnapshot: () => requireContextModule().getDeviceSnapshot(),
  openDeviceSettings: () => requireContextModule().openDeviceSettings(),
  getInstallationIdentifier: () => requireContextModule().getInstallationIdentifier(),
  enqueueContextEvents: (events: readonly Record<string, unknown>[]) =>
    requireContextModule().enqueueContextEvents(events),
  readPendingEvents: (limit = 100, scope?: string) => requireContextModule().readPendingEvents(limit, scope),
  readPendingEventsByKind: (limit = 100, kinds: readonly string[] = [], scope?: string) =>
    requireContextModule().readPendingEventsByKind(limit, kinds, scope),
  acknowledgeEvents: (ids: readonly string[], cursor?: number, scope?: string) =>
    requireContextModule().acknowledgeEvents(ids, cursor, scope),
  setOwnerScope: (scope: string) => requireContextModule().setOwnerScope(scope),
  activateOwnerScope: (scope: string) => requireContextModule().activateOwnerScope(scope),
  deleteOwnerScope: (scope: string) => requireContextModule().deleteOwnerScope(scope),
  getCommandCursor: () => requireContextModule().getCommandCursor(),
  hasCompletedCommand: (id: string) => requireContextModule().hasCompletedCommand(id),
  recordCommandCompletion: (id: string, cursor: string) =>
    requireContextModule().recordCommandCompletion(id, cursor),
  storePendingCommand: (command: Record<string, unknown>) =>
    requireContextModule().storePendingCommand(command),
  readPendingCommands: () => requireContextModule().readPendingCommands(),
  removePendingCommand: (id: string) => requireContextModule().removePendingCommand(id),
  requestHealthAuthorization: () => requireContextModule().requestHealthAuthorization(),
  getHealthSummary: (start: number, end: number) =>
    requireContextModule().getHealthSummary(start, end),
  requestCalendarAuthorization: () => requireContextModule().requestCalendarAuthorization(),
  requestReminderAuthorization: () => requireContextModule().requestReminderAuthorization(),
  listCalendarEvents: (start: number, end: number) =>
    requireContextModule().listCalendarEvents(start, end),
  createCalendarEvent: (input: Parameters<IOSContextNativeModule['createCalendarEvent']>[0]) =>
    requireContextModule().createCalendarEvent(input),
  listReminders: (completed?: boolean) => requireContextModule().listReminders(completed),
  createReminder: (input: Parameters<IOSContextNativeModule['createReminder']>[0]) =>
    requireContextModule().createReminder(input),
  shareTextToNotes: (text: string, title?: string) =>
    requireContextModule().shareTextToNotes(text, title),
  requestNotificationAuthorization: () => requireContextModule().requestNotificationAuthorization(),
  scheduleLocalNotification: (
    title: string,
    body: string,
    fireAt?: number | null,
    data?: Record<string, unknown>,
  ) => requireContextModule().scheduleLocalNotification(title, body, fireAt, data),
  cancelLocalNotification: (identifier: string) => requireContextModule().cancelLocalNotification(identifier),
  getWatchCapabilities: () => requireContextModule().getWatchCapabilities(),
  getWatchSnapshot: () => requireContextModule().getWatchSnapshot(),
  sendWatchMessage: (payload: Record<string, unknown>) => requireContextModule().sendWatchMessage(payload),
  getScreenTimeCapabilities: () => requireContextModule().getScreenTimeCapabilities(),
  getScreenTimeSnapshot: () => requireContextModule().getScreenTimeSnapshot(),
  requestScreenTimeAuthorization: () => requireContextModule().requestScreenTimeAuthorization(),
  startScreenTimeMonitoring: (identifier: string, startHour: number, endHour: number) =>
    requireContextModule().startScreenTimeMonitoring(identifier, startHour, endHour),
  stopScreenTimeMonitoring: (identifier: string) => requireContextModule().stopScreenTimeMonitoring(identifier),
  updateLiveActivity: (payload: Record<string, unknown>) => requireContextModule().updateLiveActivity(payload),
  scheduleBackgroundTasks: () => requireContextModule().scheduleBackgroundTasks(),
  listPendingRelayWakes: () => requireContextModule().listPendingRelayWakes(),
  completeBackgroundRelay: (wakeId: string, success: boolean) =>
    requireContextModule().completeBackgroundRelay(wakeId, success),
  subscribeLocation: (listener: (event: IOSLocationSnapshot) => void) =>
    requireContextModule().addListener('onLocation', listener),
  subscribeMotion: (listener: (event: IOSMotionSnapshot) => void) =>
    requireContextModule().addListener('onMotion', listener),
  subscribeVisit: (listener: (event: IOSVisitEvent) => void) =>
    requireContextModule().addListener('onVisit', listener),
  subscribeBackgroundWake: (
    listener: (event: { reason?: string; timestamp?: number; wakeId?: string }) => void,
  ) =>
    requireContextModule().addListener('onBackgroundWake', listener),
};

export interface IOSTodayPlace {
  arrivedAt: number;
  departedAt?: number;
  id: string;
  latitude: number;
  longitude: number;
  name: string;
}

export interface HermesStandardMapProps extends ViewProps {
  centerOnUserRequest?: number;
  onLocationPress?(event: NativeSyntheticEvent<Record<string, never>>): void;
  places: readonly IOSTodayPlace[];
  showsUserLocation?: boolean;
  track: readonly IOSCoordinate[];
}

export interface HermesScreenTimeReportProps extends ViewProps {
  refreshToken: number;
}

const mapModuleAvailable = requireOptionalNativeModule('HermesIOSContext') !== null;
const NativeMap = mapModuleAvailable
  ? requireNativeView<HermesStandardMapProps>('HermesIOSContext', 'HermesStandardMapView')
  : null;
const NativeScreenTimeReport = mapModuleAvailable
  ? requireNativeView<HermesScreenTimeReportProps>(
      'HermesIOSContext',
      'HermesScreenTimeReportView',
    )
  : null;

export const HermesStandardMapView = forwardRef<View, HermesStandardMapProps>(
  function HermesStandardMapView({ places, track, ...props }, ref) {
    const nativeProps = { ...props, places, ref, track };
    return NativeMap
      ? createElement(NativeMap as ComponentType<HermesStandardMapProps>, nativeProps)
      : createElement(View, nativeProps);
  },
);

export const HermesScreenTimeReportView = forwardRef<View, HermesScreenTimeReportProps>(
  function HermesScreenTimeReportView(props, ref) {
    const nativeProps = { ...props, ref };
    return NativeScreenTimeReport
      ? createElement(
          NativeScreenTimeReport as ComponentType<HermesScreenTimeReportProps>,
          nativeProps,
        )
      : createElement(View, nativeProps);
  },
);
