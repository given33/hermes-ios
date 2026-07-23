import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { createElement, forwardRef, type ComponentType } from 'react';
import {
  Platform,
  NativeModules,
  View,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';
import { discoverRegisteredNativeView, readNativeViewContract } from './native-view-loader';

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
  getNativeViewContract?(): {
    version: number;
    views: string[];
  };
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
  requestMotionAuthorization(): Promise<IOSAuthorizationState>;
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
  setPermissionCollectionReady?(scope: string, ready: boolean): Promise<void>;
  activateOwnerScope(scope: string): Promise<number>;
  deleteOwnerScope(scope: string): Promise<number>;
  getCommandCursor(): Promise<string>;
  hasCompletedCommand(id: string): Promise<boolean>;
  getCommandExecutionResult(id: string): Promise<Record<string, unknown> | null>;
  recordCommandCompletion(id: string, cursor: string): Promise<void>;
  storePendingCommand(command: Record<string, unknown>): Promise<void>;
  readPendingCommands(): Promise<Array<Record<string, unknown>>>;
  removePendingCommand(id: string): Promise<void>;
  requestHealthAuthorization(): Promise<IOSAuthorizationState>;
  getHealthAuthorization(): Promise<IOSAuthorizationState>;
  getHealthSummary(start: number, end: number): Promise<IOSHealthSummary>;
  requestCalendarAuthorization(): Promise<IOSAuthorizationState>;
  getCalendarAuthorization(): Promise<IOSAuthorizationState>;
  requestReminderAuthorization(): Promise<IOSAuthorizationState>;
  getReminderAuthorization(): Promise<IOSAuthorizationState>;
  listCalendarEvents(start: number, end: number): Promise<IOSCalendarItem[]>;
  createCalendarEvent(input: {
    end: number;
    location?: string;
    notes?: string;
    start: number;
    title: string;
  }): Promise<string>;
  createCalendarEventForCommand(commandId: string, input: {
    end: number;
    location?: string;
    notes?: string;
    start: number;
    title: string;
  }): Promise<Record<string, unknown>>;
  listReminders(completed?: boolean): Promise<IOSReminderItem[]>;
  createReminder(input: {
    due?: number;
    notes?: string;
    title: string;
  }): Promise<string>;
  createReminderForCommand(commandId: string, input: {
    due?: number;
    notes?: string;
    title: string;
  }): Promise<Record<string, unknown>>;
  shareTextToNotes(text: string, title?: string): Promise<boolean>;
  shareTextToNotesForCommand(
    commandId: string,
    text: string,
    title?: string,
  ): Promise<Record<string, unknown>>;
  requestNotificationAuthorization(): Promise<IOSAuthorizationState>;
  getNotificationAuthorization(): Promise<IOSAuthorizationState>;
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
  encryptAttachment(
    owner: string,
    sourceUri: string,
    targetUri: string,
  ): Promise<{
    encryptedBytes: number;
    format: 'aes-gcm-v1';
    plaintextBytes: number;
  }>;
  decryptAttachmentForUpload(
    owner: string,
    encryptedUri: string,
    filename: string,
  ): Promise<string>;
  deleteDecryptedAttachment(uri: string): Promise<boolean>;
  deleteAttachmentEncryptionKey(owner: string): Promise<boolean>;
}

const nativeModule = requireOptionalNativeModule<IOSContextNativeModule>('HermesIOSContext');
export interface HermesNativeMapProviderStatus {
  activeProvider: 'amap' | 'mapkit';
  amapConfigured: boolean;
  privacyConsent: boolean;
}

interface HermesStandardMapNativeModule {
  getProviderStatus?(): HermesNativeMapProviderStatus;
  setAmapPrivacyConsent?(granted: boolean): Promise<HermesNativeMapProviderStatus>;
}

const nativeMapModule = requireOptionalNativeModule<HermesStandardMapNativeModule>(
  'HermesStandardMap',
);

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
  requestMotionAuthorization: () => requireContextModule().requestMotionAuthorization(),
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
  setPermissionCollectionReady: (scope: string, ready: boolean) => {
    const module = requireContextModule();
    return typeof module.setPermissionCollectionReady === 'function'
      ? module.setPermissionCollectionReady(scope, ready)
      : Promise.resolve();
  },
  activateOwnerScope: (scope: string) => requireContextModule().activateOwnerScope(scope),
  deleteOwnerScope: (scope: string) => requireContextModule().deleteOwnerScope(scope),
  getCommandCursor: () => requireContextModule().getCommandCursor(),
  hasCompletedCommand: (id: string) => requireContextModule().hasCompletedCommand(id),
  getCommandExecutionResult: (id: string) =>
    requireContextModule().getCommandExecutionResult(id),
  recordCommandCompletion: (id: string, cursor: string) =>
    requireContextModule().recordCommandCompletion(id, cursor),
  storePendingCommand: (command: Record<string, unknown>) =>
    requireContextModule().storePendingCommand(command),
  readPendingCommands: () => requireContextModule().readPendingCommands(),
  removePendingCommand: (id: string) => requireContextModule().removePendingCommand(id),
  requestHealthAuthorization: () => requireContextModule().requestHealthAuthorization(),
  getHealthAuthorization: () => requireContextModule().getHealthAuthorization(),
  getHealthSummary: (start: number, end: number) =>
    requireContextModule().getHealthSummary(start, end),
  requestCalendarAuthorization: () => requireContextModule().requestCalendarAuthorization(),
  getCalendarAuthorization: () => requireContextModule().getCalendarAuthorization(),
  requestReminderAuthorization: () => requireContextModule().requestReminderAuthorization(),
  getReminderAuthorization: () => requireContextModule().getReminderAuthorization(),
  listCalendarEvents: (start: number, end: number) =>
    requireContextModule().listCalendarEvents(start, end),
  createCalendarEvent: (input: Parameters<IOSContextNativeModule['createCalendarEvent']>[0]) =>
    requireContextModule().createCalendarEvent(input),
  createCalendarEventForCommand: (
    commandId: string,
    input: Parameters<IOSContextNativeModule['createCalendarEvent']>[0],
  ) => requireContextModule().createCalendarEventForCommand(commandId, input),
  listReminders: (completed?: boolean) => requireContextModule().listReminders(completed),
  createReminder: (input: Parameters<IOSContextNativeModule['createReminder']>[0]) =>
    requireContextModule().createReminder(input),
  createReminderForCommand: (
    commandId: string,
    input: Parameters<IOSContextNativeModule['createReminder']>[0],
  ) => requireContextModule().createReminderForCommand(commandId, input),
  shareTextToNotes: (text: string, title?: string) =>
    requireContextModule().shareTextToNotes(text, title),
  shareTextToNotesForCommand: (commandId: string, text: string, title?: string) =>
    requireContextModule().shareTextToNotesForCommand(commandId, text, title),
  requestNotificationAuthorization: () => requireContextModule().requestNotificationAuthorization(),
  getNotificationAuthorization: () => requireContextModule().getNotificationAuthorization(),
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
  encryptAttachment: (owner: string, sourceUri: string, targetUri: string) =>
    requireContextModule().encryptAttachment(owner, sourceUri, targetUri),
  decryptAttachmentForUpload: (owner: string, encryptedUri: string, filename: string) =>
    requireContextModule().decryptAttachmentForUpload(owner, encryptedUri, filename),
  deleteDecryptedAttachment: (uri: string) =>
    requireContextModule().deleteDecryptedAttachment(uri),
  deleteAttachmentEncryptionKey: (owner: string) =>
    requireContextModule().deleteAttachmentEncryptionKey(owner),
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
  amapPrivacyConsentGranted?: boolean;
  centerOnUserRequest?: number;
  onLocationPress?(event: NativeSyntheticEvent<Record<string, never>>): void;
  places: readonly IOSTodayPlace[];
  showsUserLocation?: boolean;
  track: readonly IOSCoordinate[];
}

export interface HermesScreenTimeReportProps extends ViewProps {
  refreshToken: number;
}

// Expo SDK 54 registers the default adapter reliably under the module name.
// Keeping MapKit in its own module avoids the unsupported named-view adapter
// that previously rendered React Native's "Unimplemented component" surface.
const NativeMap = optionalNativeView<HermesStandardMapProps>(
  nativeMapModule,
  'HermesStandardMap',
);
const NativeScreenTimeReport = optionalNativeView<HermesScreenTimeReportProps>(
  nativeModule,
  'HermesIOSContext',
  'HermesScreenTimeReportView',
);
const nativeViewContract = readNativeViewContract(nativeModule);
export const nativeIOSContextViewContractVersion = nativeViewContract.version;

// A successful registry lookup proves the component is renderable; contract
// metadata alone cannot make an absent view manager available.
export const hasNativeStandardMapView = NativeMap !== null;
export const hasNativeScreenTimeReportView = NativeScreenTimeReport !== null;

export function getNativeMapProviderStatus(): HermesNativeMapProviderStatus {
  return nativeMapModule?.getProviderStatus?.() ?? {
    activeProvider: 'mapkit',
    amapConfigured: false,
    privacyConsent: false,
  };
}

export async function setNativeMapPrivacyConsent(
  granted: boolean,
): Promise<HermesNativeMapProviderStatus> {
  return nativeMapModule?.setAmapPrivacyConsent?.(granted) ?? {
    activeProvider: 'mapkit',
    amapConfigured: false,
    privacyConsent: false,
  };
}

export const HermesStandardMapView = forwardRef<View, HermesStandardMapProps>(
  function HermesStandardMapView({ places, track, ...props }, ref) {
    const nativeProps = { ...props, places, ref, track };
    return NativeMap
      ? createElement(NativeMap as ComponentType<HermesStandardMapProps>, nativeProps)
      : createElement(View, nativeProps);
  },
);

function optionalNativeView<P extends ViewProps>(
  module: object | null,
  moduleName: string,
  viewName?: string,
): ComponentType<P> | null {
  const expoRuntime = (globalThis as typeof globalThis & {
    expo?: { getViewConfig?(moduleName: string, viewName?: string): unknown };
  }).expo;
  return discoverRegisteredNativeView(
    module,
    {
      getViewConfig: expoRuntime?.getViewConfig?.bind(expoRuntime),
      viewManagersMetadata: NativeModules.NativeUnimoduleProxy?.viewManagersMetadata,
    },
    moduleName,
    viewName,
    (registeredModuleName, registeredViewName) => registeredViewName
      ? requireNativeView<P>(registeredModuleName, registeredViewName) as ComponentType<P>
      : requireNativeView<P>(registeredModuleName) as ComponentType<P>,
  );
}

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
