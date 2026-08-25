import { requireNativeView, requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { createElement, forwardRef, type ComponentType } from 'react';
import {
  Platform,
  NativeModules,
  View,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';
import { discoverRegisteredNativeView, readNativeViewContract } from './native-view-loader';
import { isExpoGoParityBuild } from '../build-flags';

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
  clipboard?: boolean;
  photos?: boolean;
  contacts?: boolean;
  media?: boolean;
  bluetooth?: boolean;
  nfc?: boolean;
  homekit?: boolean;
  browser?: boolean;
  voiceInput?: boolean;
  voiceOutput?: boolean;
}

export interface IOSVoiceTranscript {
  isFinal: boolean;
  text: string;
  timestamp: number;
}

export interface IOSVoiceState {
  error?: string;
  state: 'failed' | 'idle' | 'interrupted' | 'listening' | 'speaking';
  timestamp: number;
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
  account_generation: string;
  id: string;
  kind: 'health' | 'location' | 'motion' | 'place-visit' | 'power' | string;
  payload: Record<string, unknown>;
  source_device_id?: string;
  lifecycle_epoch: number;
  sequence: number;
  timestamp: number;
}

export interface IOSContextEventClaim {
  token: string;
  events: IOSContextEvent[];
}

export interface IOSOwnerScopeDeletionResult {
  accountGeneration: string;
  deletedCount: number;
  deletedWasCurrent: boolean;
  lifecycleEpoch: number;
}

export interface IOSHealthSummary {
  authorization: IOSAuthorizationState;
  domainAuthorization?: Partial<Record<
    'activity' | 'heart' | 'oxygen' | 'sleep',
    'available' | 'limited' | 'unavailable'
  >>;
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

export interface IOSContactItem {
  emails: string[];
  familyName: string;
  givenName: string;
  id: string;
  organization: string;
  phones: string[];
}

export interface IOSPhotoItem {
  createdAt: number;
  favorite: boolean;
  filename: string;
  height: number;
  id: string;
  location?: { latitude: number; longitude: number } | null;
  width: number;
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
  addListener(
    eventName: 'onVoiceTranscript',
    listener: (event: IOSVoiceTranscript) => void,
  ): { remove(): void };
  addListener(
    eventName: 'onVoiceState',
    listener: (event: IOSVoiceState) => void,
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
  openURL(url: string): Promise<{ opened: boolean; url: string }>;
  getVoiceAuthorization(): Promise<Record<'microphone' | 'speech', IOSAuthorizationState>>;
  requestVoiceAuthorization(): Promise<Record<'microphone' | 'speech', IOSAuthorizationState>>;
  startVoiceRecognition(locale?: string | null): Promise<boolean>;
  startAgentVoiceCapture(locale?: string | null): Promise<boolean>;
  stopVoiceRecognition(): Promise<string>;
  speakText(text: string, locale?: string | null, rate?: number | null): Promise<boolean>;
  startStreamingSpeech(locale?: string | null, rate?: number | null): Promise<boolean>;
  appendStreamingSpeech(text: string): Promise<boolean>;
  finishStreamingSpeech(): Promise<boolean>;
  interruptSpeaking(): Promise<boolean>;
  stopSpeaking(): Promise<boolean>;
  getVoiceState(): Promise<{ recording: boolean; speaking: boolean }>;
  configureSessionLock(ownerScope: string, enabled: boolean, timeoutMinutes?: number | null): Promise<Record<string, unknown>>;
  getSessionLockStatus(ownerScope: string): Promise<Record<string, unknown>>;
  unlockSession(ownerScope: string): Promise<Record<string, unknown>>;
  lockSession(ownerScope: string): Promise<Record<string, unknown>>;
  getDiagnosticsStatus(): Promise<Record<string, unknown>>;
  startDiagnostics(): Promise<void>;
  stopDiagnostics(): Promise<void>;
  getInstallationIdentifier(): Promise<string>;
  enqueueContextEvents(events: readonly Record<string, unknown>[]): Promise<number>;
  claimPendingEvents(limit: number, scope: string): Promise<IOSContextEventClaim>;
  readPendingEvents(limit: number, scope: string): Promise<IOSContextEvent[]>;
  readPendingEventsByKind(
    limit: number,
    kinds: readonly string[],
    scope: string,
  ): Promise<IOSContextEvent[]>;
  acknowledgeEvents(ids: readonly string[], cursor: number | undefined, scope: string): Promise<number>;
  acknowledgeEventClaim(
    token: string,
    ids: readonly string[],
    cursor: number | undefined,
    scope: string,
  ): Promise<number>;
  setOwnerScope(scope: string, accountGeneration: string): Promise<void>;
  setPermissionCollectionReady?(scope: string, ready: boolean): Promise<void>;
  activateOwnerScope(scope: string, accountGeneration: string): Promise<number>;
  deleteOwnerScope(
    scope: string,
    accountGeneration: string,
  ): Promise<IOSOwnerScopeDeletionResult>;
  getCommandCursor(): Promise<string>;
  hasCompletedCommand(id: string): Promise<boolean>;
  getCommandExecutionResult(id: string): Promise<Record<string, unknown> | null>;
  recordCommandCompletion(id: string, cursor: string): Promise<void>;
  storePendingCommand(command: Record<string, unknown>): Promise<void>;
  readPendingCommands(): Promise<Array<Record<string, unknown>>>;
  removePendingCommand(id: string): Promise<void>;
  readPendingTaskControls?(): Promise<Array<Record<string, unknown>>>;
  enqueueTaskControl?(taskID: string, action: string): Promise<string | null>;
  consumePendingTaskControl?(requestId: string): Promise<boolean>;
  clearPendingTaskControls?(): Promise<boolean>;
  getVoiceNarrationEnabled?(): Promise<boolean>;
  setVoiceNarrationEnabled?(enabled: boolean): Promise<boolean>;
  requestHealthAuthorization(): Promise<IOSAuthorizationState>;
  getHealthAuthorization(): Promise<IOSAuthorizationState>;
  getHealthSummary(start: number, end: number): Promise<IOSHealthSummary>;
  requestHealthWriteAuthorization(identifier: string): Promise<IOSAuthorizationState>;
  writeHealthSampleForCommand(
    commandId: string,
    input: { end: number; identifier: string; start: number; unit: string; value: number },
  ): Promise<Record<string, unknown>>;
  writeHealthSamplesForCommand(commandId: string, samples: readonly Record<string, unknown>[]): Promise<Record<string, unknown>>;
  deleteHealthSamplesForCommand(commandId: string, identifier: string): Promise<Record<string, unknown>>;
  requestCalendarAuthorization(): Promise<IOSAuthorizationState>;
  getCalendarAuthorization(): Promise<IOSAuthorizationState>;
  requestReminderAuthorization(): Promise<IOSAuthorizationState>;
  getReminderAuthorization(): Promise<IOSAuthorizationState>;
  listCalendarEvents(start: number, end: number): Promise<IOSCalendarItem[]>;
  listCalendars(): Promise<Array<Record<string, unknown>>>;
  calendarFreeBusy(start: number, end: number): Promise<Array<Record<string, unknown>>>;
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
  updateCalendarEventForCommand(commandId: string, eventID: string, input: {
    end?: number;
    location?: string;
    notes?: string;
    start?: number;
    title?: string;
  }): Promise<Record<string, unknown>>;
  deleteCalendarEventForCommand(commandId: string, eventID: string): Promise<Record<string, unknown>>;
  readClipboard(): Promise<{ text: string; hasText: boolean }>;
  readClipboardForCommand(commandId: string): Promise<Record<string, unknown>>;
  writeClipboard(text: string): Promise<boolean>;
  writeClipboardForCommand(commandId: string, text: string): Promise<Record<string, unknown>>;
  getContactsAuthorization(): Promise<IOSAuthorizationState>;
  requestContactsAuthorization(): Promise<IOSAuthorizationState>;
  searchContacts(query?: string | null, limit?: number): Promise<IOSContactItem[]>;
  createContact(input: {
    email?: string;
    familyName?: string;
    givenName: string;
    organization?: string;
    phone?: string;
  }): Promise<IOSContactItem>;
  createContactForCommand(
    commandId: string,
    input: Parameters<IOSContextNativeModule['createContact']>[0],
  ): Promise<Record<string, unknown>>;
  getPhotosAuthorization(): Promise<IOSAuthorizationState>;
  requestPhotosAuthorization(): Promise<IOSAuthorizationState>;
  searchPhotos(input?: {
    end?: number;
    limit?: number;
    mediaType?: 'image' | 'video';
    query?: string;
    start?: number;
  }): Promise<IOSPhotoItem[]>;
  listPhotoAlbums(limit?: number): Promise<Array<Record<string, unknown>>>;
  searchNearbyPhotos(latitude: number, longitude: number, radiusMeters?: number, limit?: number): Promise<Array<Record<string, unknown>>>;
  updatePhotoFavorite(assetIDs: string[], favorite: boolean): Promise<Record<string, unknown>>;
  deletePhotos(assetIDs: string[]): Promise<Record<string, unknown>>;
  createPhotoAlbum(title: string): Promise<Record<string, unknown>>;
  addPhotosToAlbum(assetIDs: string[], albumID: string): Promise<Record<string, unknown>>;
  importPhoto(ownerScope: string, imageURL: string): Promise<Record<string, unknown>>;
  exportPhoto(ownerScope: string, assetID: string, original?: boolean): Promise<Record<string, unknown>>;
  deleteExportedPhoto(ownerScope: string, uri: string): Promise<boolean>;
  ocrImage(input: {
    imageURL: string;
    ownerScope: string;
    languages?: string[];
    recognitionLevel?: 'accurate' | 'fast';
  }): Promise<Record<string, unknown>>;
  updateReminderForCommand(commandId: string, reminderID: string, input: {
    completed?: boolean;
    due?: number;
    notes?: string;
    title?: string;
  }): Promise<Record<string, unknown>>;
  deleteReminderForCommand(commandId: string, reminderID: string): Promise<Record<string, unknown>>;
  analyzeVision(imageURL: string, ownerScope: string, mode?: 'analyze' | 'classify' | 'detect' | 'faces'): Promise<Record<string, unknown>>;
  analyzeNaturalLanguage(text: string): Promise<Record<string, unknown>>;
  getMediaAuthorization(): Promise<IOSAuthorizationState>;
  requestMediaAuthorization(): Promise<IOSAuthorizationState>;
  getMediaSnapshot(): Promise<Record<string, unknown>>;
  controlMedia(action: string): Promise<Record<string, unknown>>;
  searchMedia(query: string, limit?: number): Promise<Array<Record<string, unknown>>>;
  playMediaSearch(query: string, limit?: number): Promise<Record<string, unknown>>;
  setMediaVolume(volume: number): Promise<Record<string, unknown>>;
  getBluetoothState(): Promise<string>;
  scanBluetooth(seconds?: number): Promise<Array<Record<string, unknown>>>;
  connectBluetooth(ownerScope: string, deviceID: string): Promise<Record<string, unknown>>;
  disconnectBluetooth(): Promise<void>;
  bluetoothServices(ownerScope: string, deviceID: string): Promise<Record<string, unknown>>;
  bluetoothRead(ownerScope: string, deviceID: string, serviceUUID: string, characteristicUUID: string): Promise<Record<string, unknown>>;
  bluetoothWrite(ownerScope: string, deviceID: string, serviceUUID: string, characteristicUUID: string, dataBase64: string, withResponse?: boolean): Promise<Record<string, unknown>>;
  bluetoothNotify(ownerScope: string, deviceID: string, serviceUUID: string, characteristicUUID: string, seconds?: number): Promise<Record<string, unknown>>;
  getHomeKitSnapshot(): Promise<Array<Record<string, unknown>>>;
  searchHomeKit(query?: string, limit?: number): Promise<Array<Record<string, unknown>>>;
  listHomeKitScenes(limit?: number): Promise<Array<Record<string, unknown>>>;
  triggerHomeKitScene(sceneID: string): Promise<Record<string, unknown>>;
  setHomeKitValue(
    accessoryId: string,
    characteristicId: string,
    value: string,
  ): Promise<Record<string, unknown>>;
  startNFCReader(): Promise<Record<string, unknown>>;
  writeNFCTag(text: string): Promise<Record<string, unknown>>;
  scanQRCode(): Promise<Record<string, unknown>>;
  getBrowserCapabilities?(): Promise<Record<string, unknown>>;
  executeBrowserForCommand(
    commandId: string,
    ownerScope: string,
    action: string,
    payload?: Record<string, unknown>,
    includeBase64?: boolean,
  ): Promise<Record<string, unknown>>;
  openURLForCommand(commandId: string, url: string): Promise<Record<string, unknown>>;
  readPendingAgentTriggers(): Promise<Array<Record<string, unknown>>>;
  consumePendingAgentTrigger(requestId: string): Promise<boolean>;
  clearPendingAgentTriggers?(): Promise<boolean>;
  getAgentShareAttachmentRootUri?(): string | null;
  deleteAgentShareAttachment?(filename: string): Promise<boolean>;
  getNativeActionCapabilities?(): Array<Record<string, unknown>>;
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
  setBackgroundRelayReady(
    scope: string,
    accountGeneration: string,
    ready: boolean,
  ): Promise<boolean>;
  listPendingRelayWakes(): Promise<Array<{ reason: string; wakeId: string }>>;
  completeBackgroundRelay(wakeId: string, success: boolean): Promise<void>;
  encryptAttachment(
    owner: string,
    sourceUri: string,
    targetUri: string,
  ): Promise<{
    encryptedBytes: number;
    format: 'aes-gcm-chunked-v2';
    plaintextBytes: number;
    sha256: string;
  }>;
  decryptAttachmentForUpload(
    owner: string,
    encryptedUri: string,
    filename: string,
  ): Promise<string>;
  deleteDecryptedAttachment(uri: string): Promise<boolean>;
  deleteAttachmentEncryptionKey(owner: string): Promise<boolean>;
  writeProtectedAccountExport(contents: string, filename: string): Promise<string>;
  deleteProtectedAccountExport(uri: string): Promise<boolean>;
  getAttachmentOutboxRootUri?(): string;
}

const nativeModule = isExpoGoParityBuild
  ? null
  : requireOptionalNativeModule<IOSContextNativeModule>('HermesIOSContext');
const resignCompatibleBuild = Constants.expoConfig?.extra?.hermesResignCompatible === true;
// A module can be present in an unsigned or externally re-signed IPA while
// its Keychain/App Group entitlements are not. Keep the capability decision
// process-local: one failed optional native call must not keep retrying from
// every foreground timer and eventually take down the authenticated surface.
let nativeContextFaulted = false;
/** The context bridge was marked unusable; any call is a no-op error. */
class NativeContextUnavailableError extends Error {
  constructor() {
    super('Hermes iOS context is unavailable for this process (entitlements missing or bridge faulted)');
    this.name = 'NativeContextUnavailableError';
  }
}

function requireContextModule(): IOSContextNativeModule {
  if (nativeContextFaulted || !nativeModule) {
    throw new NativeContextUnavailableError();
  }
  return nativeModule;
}
export interface HermesNativeMapProviderStatus {
  activeProvider: 'amap' | 'mapkit';
  amapConfigured: boolean;
  apiKeyConfigured: boolean;
  backgroundLocation: boolean;
  bundleIdentifier: string;
  bundleIdentifierMatches: boolean;
  configuredBundleIdentifier: string;
  error?: string;
  lastLocationAccuracy?: number;
  lastLocationAt?: number;
  lastLocationStatus: 'available' | 'stale' | 'unavailable';
  locationAuthorization: IOSAuthorizationState;
  phase: 'unconfigured' | 'requestingPermission' | 'initializing' | 'ready' | 'degraded' | 'failed';
  preciseLocation: boolean;
  privacyConsent: boolean;
}

interface HermesStandardMapNativeModule {
  getProviderStatus?(): HermesNativeMapProviderStatus;
  setAmapPrivacyConsent?(granted: boolean): Promise<HermesNativeMapProviderStatus>;
}

const nativeMapModule = isExpoGoParityBuild
  ? null
  : requireOptionalNativeModule<HermesStandardMapNativeModule>('HermesStandardMap');

export const hasNativeIOSContext = Platform.OS === 'ios'
  && nativeModule !== null
  && !resignCompatibleBuild
  && !isExpoGoParityBuild;

/** True while the optional native context bridge is both present and usable. */
export function isNativeIOSContextAvailable(): boolean {
  return hasNativeIOSContext && !nativeContextFaulted;
}

/** Disable only the optional native context for this process. */
export function markNativeIOSContextUnavailable(): void {
  nativeContextFaulted = true;
}

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
  openURL: (url: string) => requireContextModule().openURL(url),
  getVoiceAuthorization: () => requireContextModule().getVoiceAuthorization(),
  requestVoiceAuthorization: () => requireContextModule().requestVoiceAuthorization(),
  startVoiceRecognition: (locale?: string | null) =>
    requireContextModule().startVoiceRecognition(locale),
  startAgentVoiceCapture: (locale?: string | null) =>
    requireContextModule().startAgentVoiceCapture(locale),
  stopVoiceRecognition: () => requireContextModule().stopVoiceRecognition(),
  speakText: (text: string, locale?: string | null, rate?: number | null) =>
    requireContextModule().speakText(text, locale, rate),
  startStreamingSpeech: (locale?: string | null, rate?: number | null) =>
    requireContextModule().startStreamingSpeech(locale, rate),
  appendStreamingSpeech: (text: string) => requireContextModule().appendStreamingSpeech(text),
  finishStreamingSpeech: () => requireContextModule().finishStreamingSpeech(),
  interruptSpeaking: () => requireContextModule().interruptSpeaking(),
  stopSpeaking: () => requireContextModule().stopSpeaking(),
  getVoiceState: () => requireContextModule().getVoiceState(),
  configureSessionLock: (ownerScope: string, enabled: boolean, timeoutMinutes?: number | null) =>
    requireContextModule().configureSessionLock(ownerScope, enabled, timeoutMinutes),
  getSessionLockStatus: (ownerScope: string) => requireContextModule().getSessionLockStatus(ownerScope),
  unlockSession: (ownerScope: string) => requireContextModule().unlockSession(ownerScope),
  lockSession: (ownerScope: string) => requireContextModule().lockSession(ownerScope),
  getDiagnosticsStatus: () => requireContextModule().getDiagnosticsStatus(),
  startDiagnostics: () => requireContextModule().startDiagnostics(),
  stopDiagnostics: () => requireContextModule().stopDiagnostics(),
  getInstallationIdentifier: () => requireContextModule().getInstallationIdentifier(),
  enqueueContextEvents: (events: readonly Record<string, unknown>[]) =>
    requireContextModule().enqueueContextEvents(events),
  claimPendingEvents: (limit: number, scope: string) =>
    requireContextModule().claimPendingEvents(limit, scope),
  // The native queue rejects reads and acknowledgements whose scope is not
  // the active owner scope, so every caller must say which account it is
  // draining rather than implicitly touching all of them.
  readPendingEvents: (limit: number, scope: string) =>
    requireContextModule().readPendingEvents(limit, scope),
  readPendingEventsByKind: (limit: number, kinds: readonly string[], scope: string) =>
    requireContextModule().readPendingEventsByKind(limit, kinds, scope),
  acknowledgeEvents: (ids: readonly string[], cursor: number | undefined, scope: string) =>
    requireContextModule().acknowledgeEvents(ids, cursor, scope),
  acknowledgeEventClaim: (
    token: string,
    ids: readonly string[],
    cursor: number | undefined,
    scope: string,
  ) => requireContextModule().acknowledgeEventClaim(token, ids, cursor, scope),
  setOwnerScope: (scope: string, accountGeneration: string) =>
    requireContextModule().setOwnerScope(scope, accountGeneration),
  setPermissionCollectionReady: (scope: string, ready: boolean) => {
    const module = requireContextModule();
    return typeof module.setPermissionCollectionReady === 'function'
      ? module.setPermissionCollectionReady(scope, ready)
      : Promise.resolve();
  },
  activateOwnerScope: (scope: string, accountGeneration: string) =>
    requireContextModule().activateOwnerScope(scope, accountGeneration),
  deleteOwnerScope: (scope: string, accountGeneration: string) =>
    requireContextModule().deleteOwnerScope(scope, accountGeneration),
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
  readPendingTaskControls: () => requireContextModule().readPendingTaskControls?.() ?? Promise.resolve([]),
  enqueueTaskControl: (taskID: string, action: string) =>
    requireContextModule().enqueueTaskControl?.(taskID, action) ?? Promise.resolve(null),
  consumePendingTaskControl: (requestId: string) =>
    requireContextModule().consumePendingTaskControl?.(requestId) ?? Promise.resolve(false),
  clearPendingTaskControls: () =>
    requireContextModule().clearPendingTaskControls?.() ?? Promise.resolve(false),
  getVoiceNarrationEnabled: () =>
    requireContextModule().getVoiceNarrationEnabled?.() ?? Promise.resolve(false),
  setVoiceNarrationEnabled: (enabled: boolean) =>
    requireContextModule().setVoiceNarrationEnabled?.(enabled) ?? Promise.resolve(enabled),
  requestHealthAuthorization: () => requireContextModule().requestHealthAuthorization(),
  getHealthAuthorization: () => requireContextModule().getHealthAuthorization(),
  getHealthSummary: (start: number, end: number) =>
    requireContextModule().getHealthSummary(start, end),
  requestHealthWriteAuthorization: (identifier: string) =>
    requireContextModule().requestHealthWriteAuthorization(identifier),
  writeHealthSampleForCommand: (
    commandId: string,
    input: Parameters<IOSContextNativeModule['writeHealthSampleForCommand']>[1],
  ) => requireContextModule().writeHealthSampleForCommand(commandId, input),
  writeHealthSamplesForCommand: (commandId: string, samples: readonly Record<string, unknown>[]) =>
    requireContextModule().writeHealthSamplesForCommand(commandId, samples),
  deleteHealthSamplesForCommand: (commandId: string, identifier: string) =>
    requireContextModule().deleteHealthSamplesForCommand(commandId, identifier),
  requestCalendarAuthorization: () => requireContextModule().requestCalendarAuthorization(),
  getCalendarAuthorization: () => requireContextModule().getCalendarAuthorization(),
  requestReminderAuthorization: () => requireContextModule().requestReminderAuthorization(),
  getReminderAuthorization: () => requireContextModule().getReminderAuthorization(),
  listCalendarEvents: (start: number, end: number) =>
    requireContextModule().listCalendarEvents(start, end),
  listCalendars: () => requireContextModule().listCalendars(),
  calendarFreeBusy: (start: number, end: number) => requireContextModule().calendarFreeBusy(start, end),
  createCalendarEvent: (input: Parameters<IOSContextNativeModule['createCalendarEvent']>[0]) =>
    requireContextModule().createCalendarEvent(input),
  createCalendarEventForCommand: (
    commandId: string,
    input: Parameters<IOSContextNativeModule['createCalendarEvent']>[0],
  ) => requireContextModule().createCalendarEventForCommand(commandId, input),
  updateCalendarEventForCommand: (commandId: string, eventID: string, input: Parameters<IOSContextNativeModule['updateCalendarEventForCommand']>[2]) =>
    requireContextModule().updateCalendarEventForCommand(commandId, eventID, input),
  deleteCalendarEventForCommand: (commandId: string, eventID: string) => requireContextModule().deleteCalendarEventForCommand(commandId, eventID),
  listReminders: (completed?: boolean) => requireContextModule().listReminders(completed),
  createReminder: (input: Parameters<IOSContextNativeModule['createReminder']>[0]) =>
    requireContextModule().createReminder(input),
  createReminderForCommand: (
    commandId: string,
    input: Parameters<IOSContextNativeModule['createReminder']>[0],
  ) => requireContextModule().createReminderForCommand(commandId, input),
  updateReminderForCommand: (commandId: string, reminderID: string, input: Parameters<IOSContextNativeModule['updateReminderForCommand']>[2]) =>
    requireContextModule().updateReminderForCommand(commandId, reminderID, input),
  deleteReminderForCommand: (commandId: string, reminderID: string) => requireContextModule().deleteReminderForCommand(commandId, reminderID),
  readClipboard: () => requireContextModule().readClipboard(),
  readClipboardForCommand: (commandId: string) =>
    requireContextModule().readClipboardForCommand(commandId),
  writeClipboard: (text: string) => requireContextModule().writeClipboard(text),
  writeClipboardForCommand: (commandId: string, text: string) =>
    requireContextModule().writeClipboardForCommand(commandId, text),
  getContactsAuthorization: () => requireContextModule().getContactsAuthorization(),
  requestContactsAuthorization: () => requireContextModule().requestContactsAuthorization(),
  searchContacts: (query?: string | null, limit?: number) =>
    requireContextModule().searchContacts(query, limit),
  createContact: (input: Parameters<IOSContextNativeModule['createContact']>[0]) =>
    requireContextModule().createContact(input),
  createContactForCommand: (
    commandId: string,
    input: Parameters<IOSContextNativeModule['createContact']>[0],
  ) => requireContextModule().createContactForCommand(commandId, input),
  getPhotosAuthorization: () => requireContextModule().getPhotosAuthorization(),
  requestPhotosAuthorization: () => requireContextModule().requestPhotosAuthorization(),
  searchPhotos: (input?: Parameters<IOSContextNativeModule['searchPhotos']>[0]) =>
    requireContextModule().searchPhotos(input),
  listPhotoAlbums: (limit?: number) => requireContextModule().listPhotoAlbums(limit),
  searchNearbyPhotos: (latitude: number, longitude: number, radiusMeters?: number, limit?: number) =>
    requireContextModule().searchNearbyPhotos(latitude, longitude, radiusMeters, limit),
  updatePhotoFavorite: (assetIDs: string[], favorite: boolean) =>
    requireContextModule().updatePhotoFavorite(assetIDs, favorite),
  deletePhotos: (assetIDs: string[]) => requireContextModule().deletePhotos(assetIDs),
  createPhotoAlbum: (title: string) => requireContextModule().createPhotoAlbum(title),
  addPhotosToAlbum: (assetIDs: string[], albumID: string) => requireContextModule().addPhotosToAlbum(assetIDs, albumID),
  importPhoto: (ownerScope: string, imageURL: string) => requireContextModule().importPhoto(ownerScope, imageURL),
  exportPhoto: (ownerScope: string, assetID: string, original?: boolean) => requireContextModule().exportPhoto(ownerScope, assetID, original),
  deleteExportedPhoto: (ownerScope: string, uri: string) => requireContextModule().deleteExportedPhoto(ownerScope, uri),
  ocrImage: (input: Parameters<IOSContextNativeModule['ocrImage']>[0]) =>
    requireContextModule().ocrImage(input),
  analyzeVision: (imageURL: string, ownerScope: string, mode?: 'analyze' | 'classify' | 'detect' | 'faces') => requireContextModule().analyzeVision(imageURL, ownerScope, mode),
  analyzeNaturalLanguage: (text: string) => requireContextModule().analyzeNaturalLanguage(text),
  openURLForCommand: (commandId: string, url: string) =>
    requireContextModule().openURLForCommand(commandId, url),
  getMediaAuthorization: () => requireContextModule().getMediaAuthorization(),
  requestMediaAuthorization: () => requireContextModule().requestMediaAuthorization(),
  getMediaSnapshot: () => requireContextModule().getMediaSnapshot(),
  controlMedia: (action: string) => requireContextModule().controlMedia(action),
  searchMedia: (query: string, limit?: number) => requireContextModule().searchMedia(query, limit),
  playMediaSearch: (query: string, limit?: number) => requireContextModule().playMediaSearch(query, limit),
  setMediaVolume: (volume: number) => requireContextModule().setMediaVolume(volume),
  getBluetoothState: () => requireContextModule().getBluetoothState(),
  scanBluetooth: (seconds?: number) => requireContextModule().scanBluetooth(seconds),
  connectBluetooth: (ownerScope: string, deviceID: string) => requireContextModule().connectBluetooth(ownerScope, deviceID),
  disconnectBluetooth: () => requireContextModule().disconnectBluetooth(),
  bluetoothServices: (ownerScope: string, deviceID: string) => requireContextModule().bluetoothServices(ownerScope, deviceID),
  bluetoothRead: (ownerScope: string, deviceID: string, serviceUUID: string, characteristicUUID: string) =>
    requireContextModule().bluetoothRead(ownerScope, deviceID, serviceUUID, characteristicUUID),
  bluetoothWrite: (ownerScope: string, deviceID: string, serviceUUID: string, characteristicUUID: string, dataBase64: string, withResponse?: boolean) =>
    requireContextModule().bluetoothWrite(ownerScope, deviceID, serviceUUID, characteristicUUID, dataBase64, withResponse),
  bluetoothNotify: (ownerScope: string, deviceID: string, serviceUUID: string, characteristicUUID: string, seconds?: number) =>
    requireContextModule().bluetoothNotify(ownerScope, deviceID, serviceUUID, characteristicUUID, seconds),
  getHomeKitSnapshot: () => requireContextModule().getHomeKitSnapshot(),
  searchHomeKit: (query?: string, limit?: number) => requireContextModule().searchHomeKit(query, limit),
  listHomeKitScenes: (limit?: number) => requireContextModule().listHomeKitScenes(limit),
  triggerHomeKitScene: (sceneID: string) => requireContextModule().triggerHomeKitScene(sceneID),
  setHomeKitValue: (accessoryId: string, characteristicId: string, value: string) =>
    requireContextModule().setHomeKitValue(accessoryId, characteristicId, value),
  startNFCReader: () => requireContextModule().startNFCReader(),
  writeNFCTag: (text: string) => requireContextModule().writeNFCTag(text),
  scanQRCode: () => requireContextModule().scanQRCode(),
  getBrowserCapabilities: () => requireContextModule().getBrowserCapabilities?.() ?? Promise.resolve({ available: false }),
  executeBrowserForCommand: (
    commandId: string,
    ownerScope: string,
    action: string,
    payload?: Record<string, unknown>,
    includeBase64?: boolean,
  ) => requireContextModule().executeBrowserForCommand(commandId, ownerScope, action, payload, includeBase64),
  readPendingAgentTriggers: () => requireContextModule().readPendingAgentTriggers(),
  consumePendingAgentTrigger: (requestId: string) =>
    requireContextModule().consumePendingAgentTrigger(requestId),
  clearPendingAgentTriggers: () =>
    requireContextModule().clearPendingAgentTriggers?.() ?? Promise.resolve(false),
  getAgentShareAttachmentRootUri: (): string | null => {
    const module = requireContextModule();
    return typeof module.getAgentShareAttachmentRootUri === 'function'
      ? module.getAgentShareAttachmentRootUri()
      : null;
  },
  deleteAgentShareAttachment: (filename: string): Promise<boolean> => {
    const module = requireContextModule();
    return typeof module.deleteAgentShareAttachment === 'function'
      ? module.deleteAgentShareAttachment(filename)
      : Promise.resolve(false);
  },
  getNativeActionCapabilities: () => requireContextModule().getNativeActionCapabilities?.() ?? [],
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
  setBackgroundRelayReady: (scope: string, accountGeneration: string, ready: boolean) =>
    requireContextModule().setBackgroundRelayReady(scope, accountGeneration, ready),
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
  writeProtectedAccountExport: (contents: string, filename: string) =>
    requireContextModule().writeProtectedAccountExport(contents, filename),
  deleteProtectedAccountExport: (uri: string) =>
    requireContextModule().deleteProtectedAccountExport(uri),
  getAttachmentOutboxRootUri: (): string | null => {
    const module = requireContextModule();
    return typeof module.getAttachmentOutboxRootUri === 'function'
      ? module.getAttachmentOutboxRootUri()
      : null;
  },
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
  subscribeVoiceTranscript: (listener: (event: IOSVoiceTranscript) => void) =>
    requireContextModule().addListener('onVoiceTranscript', listener),
  subscribeVoiceState: (listener: (event: IOSVoiceState) => void) =>
    requireContextModule().addListener('onVoiceState', listener),
};

// Circuit-breaker wrapper: after `markNativeIOSContextUnavailable()` (a
// re-signed IPA without Keychain/App Group entitlements, or one bridge fault),
// every HermesIOSContext method must degrade to a safe no-op result instead
// of throwing into JS. Unprotected call sites — button handlers, foreground
// timers, voice toggles — would otherwise crash the authenticated surface.
// The remote session is authoritative; local native capability loss must
// never take the chat UI down.
const NATIVE_CONTEXT_DEGRADED: Record<string, unknown> = {
  getCapabilities: {},
  getDeviceSnapshot: {},
  getWatchSnapshot: {},
  getPowerSnapshot: {},
  getLocationAuthorizationDetails: {},
  getMotionSnapshot: {},
  getLocationMode: {},
  getPendingEvents: { events: [], cursor: '' },
  claimPendingEvents: { events: [], token: '' },
  readPendingCommands: [],
  getAuthorizationStatus: 'notDetermined',
  getNotificationAuthorizationStatus: 'notDetermined',
  getClipboardSnapshot: {},
};
// Subscribers must return an object with a no-op remove() so useEffect
// cleanups (`transcript.remove()` / `state.remove()`) never crash on a
// faulted bridge.
const NATIVE_CONTEXT_NOOP_SUBSCRIBER = { remove: () => undefined };
function nativeContextDegradedResult(methodName: string): unknown {
  if (methodName.startsWith('subscribe')) return NATIVE_CONTEXT_NOOP_SUBSCRIBER;
  const degraded = NATIVE_CONTEXT_DEGRADED[methodName];
  if (degraded !== undefined) return degraded;
  return null;
}

const HermesIOSContextMethods = HermesIOSContext as Record<string, (...args: unknown[]) => unknown>;

export const HermesIOSContextSafe = new Proxy(HermesIOSContextMethods, {
  get(target, property: string | symbol, receiver) {
    const method = Reflect.get(target, property, receiver);
    if (typeof method !== 'function') return method;
    return (...args: unknown[]) => {
      if (nativeContextFaulted) {
        return nativeContextDegradedResult(String(property));
      }
      let result: unknown;
      try {
        result = method.apply(target, args);
      } catch (error) {
        // One bad sync call marks the bridge unusable for the rest of the
        // process; subsequent calls return degraded results instead of
        // re-throwing the same native failure everywhere.
        if (error instanceof NativeContextUnavailableError) {
          nativeContextFaulted = true;
          return nativeContextDegradedResult(String(property));
        }
        throw error;
      }
      // Native bridges reject asynchronously. A rejected promise must also
      // degrade instead of surfacing as an unhandled rejection that crashes
      // the JS surface (re-signed IPA without Keychain/App Group support).
      if (result instanceof Promise) {
        return result.catch((error: unknown) => {
          if (
            error instanceof NativeContextUnavailableError
            || (typeof error === 'object'
              && error !== null
              && (error as { name?: unknown }).name === 'NativeContextUnavailableError')
          ) {
            nativeContextFaulted = true;
            return nativeContextDegradedResult(String(property));
          }
          throw error;
        });
      }
      return result;
    };
  },
});

// Replace the exported object with the safe wrapper so existing call sites
// keep their imports and stop throwing on a faulted bridge.
Object.assign(HermesIOSContext, HermesIOSContextSafe);

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
  onProviderStatus?(event: NativeSyntheticEvent<HermesNativeMapProviderStatus>): void;
  places: readonly IOSTodayPlace[];
  providerResetRequest?: number;
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
export const hasNativeStandardMapView = !isExpoGoParityBuild && NativeMap !== null;
export const hasNativeScreenTimeReportView = !isExpoGoParityBuild && NativeScreenTimeReport !== null;

export function getNativeMapProviderStatus(): HermesNativeMapProviderStatus {
  return nativeMapModule?.getProviderStatus?.() ?? {
    activeProvider: 'mapkit',
    amapConfigured: false,
    apiKeyConfigured: false,
    backgroundLocation: false,
    bundleIdentifier: '',
    bundleIdentifierMatches: false,
    configuredBundleIdentifier: '',
    lastLocationStatus: 'unavailable',
    locationAuthorization: 'notDetermined',
    phase: 'unconfigured',
    preciseLocation: false,
    privacyConsent: false,
  };
}

export async function setNativeMapPrivacyConsent(
  granted: boolean,
): Promise<HermesNativeMapProviderStatus> {
  return nativeMapModule?.setAmapPrivacyConsent?.(granted) ?? {
    activeProvider: 'mapkit',
    amapConfigured: false,
    apiKeyConfigured: false,
    backgroundLocation: false,
    bundleIdentifier: '',
    bundleIdentifierMatches: false,
    configuredBundleIdentifier: '',
    lastLocationStatus: 'unavailable',
    locationAuthorization: 'notDetermined',
    phase: 'unconfigured',
    preciseLocation: false,
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
