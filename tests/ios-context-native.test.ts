import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  discoverRegisteredNativeView,
  isNativeViewRegistered,
  readNativeViewContract,
} from '../modules/hermes-ios-context/native-view-loader';

const root = process.cwd();
const moduleRoot = resolve(root, 'modules', 'hermes-ios-context');
const read = (file: string) => readFileSync(resolve(moduleRoot, file), 'utf8');

test('signed iOS builds declare native context privacy and background capabilities', () => {
  const config = JSON.parse(readFileSync(resolve(root, 'app.base.json'), 'utf8')) as {
    expo: {
      ios: {
        entitlements: Record<string, unknown>;
        infoPlist: Record<string, unknown>;
      };
    };
  };
  const { entitlements, infoPlist } = config.expo.ios;

  assert.equal(entitlements['com.apple.developer.healthkit'], true);
  assert.deepEqual(infoPlist.UIBackgroundModes, [
    'fetch',
    'location',
    'processing',
    'remote-notification',
  ]);
  for (const key of [
    'NSCalendarsFullAccessUsageDescription',
    'NSHealthShareUsageDescription',
    'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSLocationWhenInUseUsageDescription',
    'NSMotionUsageDescription',
    'NSRemindersFullAccessUsageDescription',
  ]) {
    assert.equal(typeof infoPlist[key], 'string', `${key} is declared`);
  }
  assert.equal(entitlements['com.apple.developer.family-controls'], true);
  assert.deepEqual(entitlements['com.apple.security.application-groups'], [
    'group.app.sunstone1029.fig1171.hermes',
  ]);
});

test('native context exposes independently callable collectors and event streams', () => {
  const bridge = read('index.ts');
  const module = read('ios/HermesIOSContextModule.swift');
  const background = read('ios/HermesBackgroundService.swift');
  const provider = readFileSync(resolve(root, 'src/context/IOSContextProvider.tsx'), 'utf8');

  for (const operation of [
    'startAdaptiveLocation',
    'requestCurrentLocation',
    'startMotionUpdates',
    'getPowerSnapshot',
    'requestHealthAuthorization',
    'getHealthSummary',
    'listCalendarEvents',
    'createCalendarEvent',
    'listReminders',
    'createReminder',
    'shareTextToNotes',
    'enqueueContextEvents',
    'readPendingEvents',
    'acknowledgeEvents',
  ]) {
    assert.match(bridge, new RegExp(operation));
    assert.match(module, new RegExp(`AsyncFunction\\(\"${operation}\"\\)`));
  }
  assert.match(bridge, /subscribeLocation/);
  assert.match(bridge, /subscribeMotion/);
  assert.match(module, /Events\("onLocation", "onMotion", "onVisit"\)/);
  assert.match(module, /onBackgroundWake/);
  assert.match(provider, /subscribeBackgroundWake/);
  assert.match(provider, /completeBackgroundRelay/);
  assert.match(provider, /listPendingRelayWakes/);
  assert.match(background, /notifyRelayWake/);
  assert.match(background, /pendingWakeCompletions/);
  assert.match(
    background,
    /HermesContextEventQueue\.shared\.pendingRelayWakes\(\)/,
  );
  assert.match(module, /object\(forInfoDictionaryKey: name\)/);
});

test('native callbacks persist before JS delivery and launch resumes Always location', () => {
  const queue = read('ios/HermesContextEventQueue.swift');
  const module = read('ios/HermesIOSContextModule.swift');
  const location = read('ios/HermesLocationService.swift');
  const motion = read('ios/HermesMotionService.swift');
  const subscriber = read('ios/HermesIOSContextAppDelegateSubscriber.swift');
  const lifecycle = read('ios/HermesAccountLifecycle.swift');
  const background = read('ios/HermesBackgroundService.swift');
  const expoConfig = JSON.parse(read('expo-module.config.json')) as {
    apple: { appDelegateSubscribers: string[] };
  };

  assert.match(queue, /pending-events\.encjsonl/);
  assert.match(queue, /AES\.GCM/);
  assert.match(queue, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  assert.match(queue, /relay-state\.enc/);
  assert.match(queue, /completeFileProtectionUntilFirstUserAuthentication/);
  assert.match(queue, /"sequence": sequence/);
  assert.match(queue, /func appendUnlocked/);
  assert.match(queue, /func enqueueBatch/);
  assert.match(queue, /handle\.seekToEnd\(\)/);
  assert.match(queue, /func acknowledge\(ids: Set<String>, cursor: Int\?, scope: String\? = nil\)/);
  assert.match(
    module,
    /readPendingEventsByKind"\) \{ \(limit: Int, kinds: \[String\], scope: String\?\)/,
  );
  assert.match(module, /read\(limit: limit, kinds: Set\(kinds\), scope: scope\)/);
  assert.match(queue, /previousScope\.isEmpty && !scope\.isEmpty/);
  assert.match(queue, /previousScope\.isEmpty && !scope\.isEmpty && !wasSuspended/);
  assert.match(queue, /events\[index\]\["owner_scope"\] = scope/);
  assert.match(queue, /func deleteCurrentOwnerScope\(\)/);
  assert.match(queue, /state\["pendingRelayWakes"\] = \[\]/);
  assert.ok(
    location.indexOf('HermesContextEventQueue.shared.enqueue') <
      location.indexOf('onLocation?(payload)'),
    'location reaches durable storage before JS',
  );
  assert.ok(
    motion.indexOf('HermesContextEventQueue.shared.enqueue') <
      motion.indexOf('onMotion?(payload)'),
    'motion reaches durable storage before JS',
  );
  assert.match(subscriber, /authorizationStatus == \.authorizedAlways/);
  assert.match(subscriber, /HermesLocationService\.shared\.start\(\)/);
  assert.match(subscriber, /account-deletion/);
  assert.match(subscriber, /data\["owner_scope"\]/);
  assert.match(
    subscriber,
    /HermesAccountLifecycle\.deleteOwnerScope\([\s\S]*tombstone\.ownerScope,[\s\S]*requestedAt: tombstone\.requestedAt/,
  );
  assert.doesNotMatch(subscriber, /deleteCurrentOwnerScope\(\)/);
  assert.match(queue, /state\["collectionSuspended"\] = true/);
  assert.match(queue, /guard !isCollectionSuspendedUnlocked\(\)/);
  assert.match(lifecycle, /HermesLocationService\.shared\.resetAccountState\(\)/);
  assert.match(lifecycle, /HermesMotionService\.shared\.resetAccountState\(\)/);
  assert.match(lifecycle, /HermesScreenTimeService\.shared\.stopAllMonitoring\(/);
  assert.match(lifecycle, /HermesBackgroundService\.shared\.cancelScheduledTasks\(\)/);
  assert.match(lifecycle, /HermesWatchService\.shared\.resetAccountState\(/);
  assert.match(lifecycle, /queue\.deleteOwnerScope\(ownerScope, requestedAt: requestedAt\)/);
  assert.doesNotMatch(lifecycle, /isCurrentOwnerScope/);
  assert.match(queue, /func activateOwnerScope\(_ scope: String\)/);
  assert.match(queue, /state\["accountGeneration"\]/);
  assert.match(queue, /deletedOwnerScopes/);
  assert.match(lifecycle, /HermesLiveActivityService\.shared\.endAll\(\)/);
  assert.match(background, /guard !HermesContextEventQueue\.shared\.isCollectionSuspended/);
  assert.doesNotMatch(subscriber, /apns-token|didRegisterForRemoteNotificationsWithDeviceToken/);
  assert.deepEqual(expoConfig.apple.appDelegateSubscribers, [
    'HermesIOSContextAppDelegateSubscriber',
  ]);
});

test('native power changes are durably collected across the account lifecycle', () => {
  const device = read('ios/HermesDeviceService.swift');
  const subscriber = read('ios/HermesIOSContextAppDelegateSubscriber.swift');
  const lifecycle = read('ios/HermesAccountLifecycle.swift');

  assert.match(device, /UIDevice\.batteryStateDidChangeNotification/);
  assert.match(device, /UIDevice\.batteryLevelDidChangeNotification/);
  assert.match(device, /NSProcessInfoPowerStateDidChange/);
  assert.match(device, /guard powerObservers\.isEmpty else \{ return \}/);
  assert.match(device, /powerObservers\.forEach \{ center\.removeObserver\(\$0\) \}/);
  assert.match(device, /enqueue\(type: "power", payload: payload\)/);
  assert.match(device, /enqueue\(type: "device", payload: payload\)/);
  assert.match(subscriber, /resumePowerMonitoringIfEligible\(\)/);
  assert.match(subscriber, /HermesDeviceService\.shared\.stopMonitoringPowerChanges\(\)/);
  assert.match(lifecycle, /HermesDeviceService\.shared\.startMonitoringPowerChanges\(\)/);
  assert.match(lifecycle, /HermesDeviceService\.shared\.stopMonitoringPowerChanges\(\)/);
});

test('EventKit authorization mapping remains exhaustive across legacy and full access', () => {
  const source = read('ios/HermesEventStore.swift');
  assert.match(source, /case \.authorized, \.fullAccess: return "authorized"/);
  assert.match(source, /case \.writeOnly: return "limited"/);
});

test('context startup upgrades an existing When-In-Use grant to Always', () => {
  const provider = readFileSync(resolve(root, 'src/context/IOSContextProvider.tsx'), 'utf8');
  const coordinator = readFileSync(resolve(root, 'src/context/ios-permission-coordinator.ts'), 'utf8');
  assert.match(coordinator, /getLocationAuthorizationDetails\(\)/);
  assert.match(coordinator, /!alwaysBefore/);
  assert.match(coordinator, /requestLocationAuthorization\(\)/);
  assert.match(provider, /setOwnerScope\(ownerScope\)/);
  assert.doesNotMatch(provider, /activateOwnerScope\(ownerScope\)/);
  assert.match(
    provider,
    /state === 'active'[\s\S]*permissionSettingsOpenedRef\.current = false;[\s\S]*setPermissionAttempt/,
  );
});

test('location authorization resolves when an Always upgrade remains While In Use', () => {
  const source = read('ios/HermesLocationService.swift');
  assert.match(
    source,
    /status == \.authorizedAlways \|\| status == \.authorizedWhenInUse[\s\S]*let gate = authorizationGate[\s\S]*gate\?\.resolve/,
  );
  assert.match(source, /requestedAlwaysUpgrade = false/);
  assert.match(
    source,
    /status == \.authorizedWhenInUse && !requestedAlwaysUpgrade[\s\S]*manager\.requestAlwaysAuthorization\(\)[\s\S]*scheduleAlwaysUpgradeFallback/,
  );
  assert.match(source, /authorizationGate === gate/);
  // Always-upgrade timeout must resolve as limited While-In-Use, never invent notDetermined.
  assert.match(source, /gate\.resolve\(HermesAuthorization\.location\(\.authorizedWhenInUse\)\)/);
  assert.doesNotMatch(source, /gate\.resolve\("notDetermined"\)/);
  assert.match(source, /final class HermesLocationAuthorizationGate/);
});

test('location collector is adaptive, resumable, and eligible for background delivery', () => {
  const source = read('ios/HermesLocationService.swift');
  assert.match(source, /allowsBackgroundLocationUpdates = true/);
  assert.match(source, /startMonitoringSignificantLocationChanges/);
  assert.match(source, /startMonitoringVisits/);
  assert.match(source, /didVisit visit: CLVisit/);
  assert.match(source, /type: "place-visit"/);
  assert.match(source, /startUpdatingLocation/);
  assert.match(source, /pausesLocationUpdatesAutomatically = true/);
  assert.match(source, /kCLLocationAccuracyBestForNavigation/);
  assert.match(source, /distanceFilter = 5/);
  assert.match(source, /distanceFilter = 15/);
  assert.match(source, /requestTemporaryFullAccuracyAuthorization/);
  assert.match(source, /startMonitoring\(for: region\)/);
  assert.match(source, /startMonitoring\(for: region\)[\s\S]*manager\.stopUpdatingLocation\(\)/);
  assert.match(source, /applyMotionActivity/);
  assert.match(source, /HermesPermissionCollectionGate\.shared\.isReadyForCurrentOwner/);
  assert.match(source, /date\.timeIntervalSinceNow - 30 \* 60/);
  assert.match(source, /deadline: \.now\(\) \+ 15/);
  assert.match(source, /didFailWithError[\s\S]*resolveLocationRequest\(with: bestPayload, matching: token\)/);
  assert.match(
    read('ios/HermesIOSContextAppDelegateSubscriber.swift'),
    /guard HermesPermissionCollectionGate\.shared\.isReadyForCurrentOwner else \{ return \}/,
  );
  const gate = read('ios/HermesPermissionCollectionGate.swift');
  assert.match(gate, /accountGeneration/);
  assert.match(gate, /isCurrentOwnerScope/);
});

test('weather map stays a flat standard vector map with native gestures and user location', () => {
  const source = read('ios/HermesMapKitSurface.swift');
  assert.match(source, /MKStandardMapConfiguration\([\s\S]*elevationStyle: \.flat,[\s\S]*emphasisStyle: \.default/);
  assert.match(source, /isScrollEnabled = true/);
  assert.match(source, /isZoomEnabled = true/);
  assert.match(source, /isRotateEnabled = true/);
  assert.match(source, /locationButton\.addTarget/);
  assert.match(source, /requestPreciseAuthorization\(\)/);
  assert.match(source, /requestCurrent\(forceFresh: true\)/);
  assert.match(source, /centerOnUser\(animated: self\.hasCenteredOnUser, location: location\)/);
  assert.match(source, /centerOnNextUserLocation = true/);
  assert.match(source, /didUpdate userLocation[\s\S]*!hasCenteredOnUser \|\| centerOnNextUserLocation/);
  assert.match(source, /isPitchEnabled = false/);
  assert.match(source, /func setShowsUserLocation\(_ shows: Bool\)/);
  assert.match(source, /mapView\.showsUserLocation = shows/);
  assert.match(source, /MKPolyline/);
  assert.doesNotMatch(source, /satellite|hybrid|search/i);
});

test('native relay covers durable cursors, background services, health, watch, notifications, and optional capabilities', () => {
  const module = read('ios/HermesIOSContextModule.swift');
  const provider = readFileSync(resolve(root, 'src', 'context', 'IOSContextProvider.tsx'), 'utf8');
  const background = read('ios/HermesBackgroundService.swift');
  const watch = read('ios/HermesWatchService.swift');
  const liveActivity = read('ios/HermesLiveActivityService.swift');
  for (const operation of [
    'getInstallationIdentifier',
    'getCommandCursor',
    'hasCompletedCommand',
    'getCommandExecutionResult',
    'recordCommandCompletion',
    'createCalendarEventForCommand',
    'createReminderForCommand',
    'shareTextToNotesForCommand',
    'storePendingCommand',
    'readPendingCommands',
    'removePendingCommand',
    'setOwnerScope',
    'activateOwnerScope',
    'deleteOwnerScope',
    'requestPreciseLocation',
    'requestMotionAuthorization',
    'getHealthAuthorization',
    'getCalendarAuthorization',
    'getReminderAuthorization',
    'getNotificationAuthorization',
    'setPredictedDeparture',
    'getDeviceSnapshot',
    'requestNotificationAuthorization',
    'scheduleLocalNotification',
    'getWatchSnapshot',
    'sendWatchMessage',
    'getScreenTimeCapabilities',
    'getScreenTimeSnapshot',
    'updateLiveActivity',
    'scheduleBackgroundTasks',
    'listPendingRelayWakes',
    'completeBackgroundRelay',
  ]) {
    assert.match(module, new RegExp(`AsyncFunction\\(\"${operation}\"\\)`));
  }
  for (const capability of [
    'ios-location', 'ios-trajectory', 'ios-places', 'ios-motion', 'ios-behavior',
    'qweather', 'amap-route', 'ios-map', 'ios-power', 'ios-health-sleep',
    'ios-health-heart', 'ios-health-oxygen', 'ios-health-activity', 'ios-calendar',
    'ios-reminders', 'ios-notes', 'ios-screen-time', 'ios-watch', 'ios-notification',
    'ios-live-activity', 'ios-device',
  ]) {
    assert.match(provider, new RegExp(capability.replace('-', '[-]')));
  }
  assert.match(provider, /hasCompletedCommand/);
  assert.match(provider, /recordCommandCompletion/);
  assert.match(provider, /HermesIOSContext\.getDeviceSnapshot\(\)\.catch/);
  assert.match(provider, /HermesIOSContext\.getScreenTimeSnapshot\(\)\.catch/);
  assert.match(provider, /HermesIOSContext\.getWatchSnapshot\(\)\.catch/);
  assert.match(provider, /snapshotEvent\('screen-time'/);
  assert.match(provider, /snapshotEvent\('watch'/);
  assert.doesNotMatch(provider, /payload\.place_id = payload\.place_id \?\? event\.id/);
  assert.match(provider, /_relay_execution_status: 'executing'/);
  assert.match(provider, /getCommandExecutionResult\(command\.id\)/);
  assert.ok(
    provider.indexOf('getCommandExecutionResult(command.id)') < provider.indexOf("_relay_error: 'expired'"),
    'native execution checkpoints are recovered before command expiry is evaluated',
  );
  assert.match(provider, /_relay_attempts:/);
  assert.match(provider, /createCalendarEventForCommand\(command\.id/);
  assert.match(provider, /createReminderForCommand\(command\.id/);
  assert.match(provider, /_relay_device_id: deviceId/);
  assert.match(provider, /_relay_owner_scope: ownerScope/);
  assert.match(provider, /setOwnerScope\(ownerScope\)/);
  assert.match(provider, /setPermissionCollectionReady\(ownerScope, false\)/);
  assert.match(provider, /canStartIOSCollection\(authorization\)/);
  assert.match(provider, /!canStartIOSCollection\(permissionSnapshotRef\.current\)/);
  assert.match(provider, /permissionSettingsOpenedRef\.current = true/);
  assert.match(provider, /permissionSettingsOpenedRef\.current = false/);
  assert.match(provider, /clearIOSPermissionRun\(ownerScope\)/);
  assert.match(readFileSync(resolve(root, 'src/context/ios-permission-coordinator.ts'), 'utf8'), /requestScreenTimeAuthorization/);
  assert.match(provider, /startScreenTimeMonitoring\('hermes-daily-context', 0, 24\)/);
  assert.match(provider, /readPendingEvents\(EVENT_BATCH_SIZE, ownerScope\)/);
  assert.match(provider, /enqueueContextEvents\(events/);
  assert.ok(
    provider.indexOf('enqueueContextEvents(events') < provider.indexOf('await flushPendingEvents();'),
    'snapshots are encrypted locally before upload',
  );
  assert.doesNotMatch(provider, /apiRef\.current\.uploadEvents\(\{\s*cursor: `snapshot:/);
  // Trajectory/places device commands flush pending then load the durable server snapshot.
  assert.match(
    provider,
    /executeDeviceCommand\(\s*command,\s*flushPendingEvents,\s*ownerScope,\s*permissionSnapshotRef\.current,\s*\(\)\s*=>\s*apiRef\.current\.snapshot\(\),\s*\)/,
  );
  assert.match(provider, /source: snapshot \? 'server_snapshot' : 'local_pending_after_flush'/);
  assert.match(provider, /trajectory: snapshot\?\.trajectory \|\| \[\]/);
  assert.match(provider, /places: snapshot\?\.places \|\| \[\]/);
  // Pull cursor is server-owned; command ids only dedupe completions.
  assert.match(provider, /Do not treat command ids as the server pull cursor/);
  assert.match(provider, /if \(response\.cursor\) \{\s*commandCursorRef\.current = response\.cursor;/);
  assert.doesNotMatch(
    provider,
    /await apiRef\.current\.acknowledgeCommand[\s\S]*commandCursorRef\.current = command\.id;/,
  );
  assert.match(read('ios/HermesContextEventQueue.swift'), /commandCursorsByScope/);
  assert.match(read('ios/HermesContextEventQueue.swift'), /completedCommandIDsByScope/);
  assert.match(read('ios/HermesContextEventQueue.swift'), /commandExecutionResultsByScope/);
  assert.match(read('ios/HermesEventStore.swift'), /hermes-agent/);
  assert.match(read('ios/HermesEventStore.swift'), /device-command/);
  assert.match(read('ios/HermesContextEventQueue.swift'), /pendingRelayWakes/);
  assert.match(read('ios/HermesContextEventQueue.swift'), /recordRelayWake/);
  assert.match(read('ios/HermesBackgroundService.swift'), /recordRelayWake/);
  assert.match(read('ios/HermesBackgroundService.swift'), /completeRelayWake/);
  assert.match(provider, /\['location'\],\s+ownerScope,/);
  assert.match(provider, /\['place-visit'\],\s+ownerScope,/);
  assert.match(background, /BGAppRefreshTaskRequest/);
  assert.match(background, /BGProcessingTaskRequest/);
  assert.match(watch, /WCSessionDelegate/);
  assert.match(liveActivity, /ActivityAttributes/);
});

test('HealthKit sleep totals retain generic asleep samples', () => {
  const health = read('ios/HermesHealthService.swift');
  assert.match(health, /sample\.value != HKCategoryValueSleepAnalysis\.inBed\.rawValue/);
  assert.match(health, /sample\.value != HKCategoryValueSleepAnalysis\.awake\.rawValue/);
  assert.doesNotMatch(
    health,
    /sample\.value != HKCategoryValueSleepAnalysis\.asleepUnspecified\.rawValue/,
  );
  assert.match(health, /case \.unnecessary: return "limited"/);
  assert.match(health, /interval\.start <= current\.end/);
  assert.match(health, /current\.end = max\(current\.end, interval\.end\)/);
});

test('smart weather view only renders local today data and valid alerts', () => {
  const source = readFileSync(resolve(root, 'src', 'context', 'SmartWeatherPage.tsx'), 'utf8');
  assert.match(source, /dayKey\(new Date\(\)\)/);
  assert.match(source, /todayTrajectory = snapshot\.trajectory\.filter/);
  assert.match(source, /todayPlaces = snapshot\.places\.filter/);
  // Incomplete validity windows are rejected; stale reloads are labeled, not hidden as live.
  assert.match(source, /expires === null && starts === null/);
  assert.match(source, /smart-weather-stale-banner/);
  assert.match(source, /setSnapshot\(EMPTY\)/);
  // Route readiness is one-shot and must not be a reload dependency: the
  // parent supplies an inline callback, which previously caused a 429 loop.
  assert.match(source, /readyReportedRef\.current/);
  assert.match(source, /reloadInFlightRef\.current/);
  assert.match(source, /nextAutomaticReloadAtRef\.current/);
  assert.match(source, /\}, \[api, locale, reportReady\]\)/);
  assert.doesNotMatch(source, /\[api, locale, notify, onReady\]/);
  assert.doesNotMatch(source, /notify\(message\)/);
  assert.match(source, /reloadGenerationRef/);
  assert.match(source, /requestedDay !== dayKey\(new Date\(\)\)/);
  assert.doesNotMatch(source, /now \+ 6 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(source, /LocateFixed/);
  assert.match(source, /<NativeButton/);
  assert.match(source, /NativeMapErrorBoundary/);
  assert.match(source, /smart-weather-map-error/);
  assert.match(source, /smart-weather-permission-status/);
  assert.match(source, /centerOnUserRequest=\{centerRequest\}/);
  assert.match(source, /smartWeatherLoadErrorMessage/);
  assert.doesNotMatch(source, /statusOverlay/);
  assert.match(source, /permissionBanner: \{[\s\S]*alignItems: 'stretch'/);
  assert.match(source, /permissionActions: \{[\s\S]*flexWrap: 'wrap'/);
});

test('logout keeps Always location collection; delete stops owner scope', () => {
  const auth = readFileSync(resolve(root, 'src', 'auth', 'AuthProvider.tsx'), 'utf8');
  const provider = readFileSync(resolve(root, 'src', 'context', 'IOSContextProvider.tsx'), 'utf8');
  // Product boundary: logout / session expiry clear credentials only.
  assert.match(auth, /Product boundary: logout \/ session expiry clear credentials only/);
  assert.doesNotMatch(auth, /logout[\s\S]{0,400}stopAdaptiveLocation/);
  assert.match(auth, /deleteOwnerScope\(ownerScope\)/);
  // Provider unmount stops motion but deliberately leaves adaptive location running.
  assert.match(provider, /stopMotionUpdates\(\)\.catch/);
  assert.match(provider, /Do not stopAdaptiveLocation here/);
  assert.doesNotMatch(
    provider,
    /return \(\) => \{[\s\S]*stopAdaptiveLocation\(\)/,
  );
});

test('native map registration is verified after pods and after Xcode compilation', () => {
  const module = read('ios/HermesIOSContextModule.swift');
  const mapModule = read('ios/HermesStandardMapModule.swift');
  const moduleConfig = JSON.parse(read('expo-module.config.json')) as {
    apple?: { modules?: string[] };
  };
  const bridge = readFileSync(resolve(root, 'modules/hermes-ios-context/index.ts'), 'utf8');
  const workflow = readFileSync(resolve(root, '.github/workflows/ios-unsigned.yml'), 'utf8');
  const verifier = readFileSync(resolve(root, 'scripts/verify-ios-native-context.mjs'), 'utf8');
  assert.match(module, /Function\("getNativeViewContract"\)/);
  assert.ok(moduleConfig.apple?.modules?.includes('HermesStandardMapModule'));
  assert.match(mapModule, /Name\("HermesStandardMap"\)/);
  assert.match(mapModule, /Function\("getRegistrationContract"\)/);
  assert.match(mapModule, /View\(HermesStandardMapView\.self\)/);
  assert.doesNotMatch(module, /View\(HermesStandardMapView\.self\)/);
  assert.match(bridge, /getNativeViewContract/);
  assert.match(bridge, /requireOptionalNativeModule<HermesStandardMapNativeModule>\([\s\S]*'HermesStandardMap'/);
  assert.match(bridge, /requireNativeView<P>\(registeredModuleName\)/);
  assert.match(bridge, /NativeUnimoduleProxy\?\.viewManagersMetadata/);
  assert.match(bridge, /getViewConfig/);
  assert.match(bridge, /export const hasNativeStandardMapView = NativeMap !== null;/);
  assert.doesNotMatch(
    bridge,
    /nativeViewContract\.views\.includes\('HermesStandardMapView'\)/,
  );
  assert.match(workflow, /Verify native context autolinking/);
  assert.equal((workflow.match(/verify-ios-native-context\.mjs/g) || []).length, 2);
  assert.match(workflow, /--derived-data "\$RUNNER_TEMP\/hermes-build"/);
  assert.match(verifier, /ExpoModulesProvider\.swift/);
  assert.match(verifier, /HermesStandardMapView\\\.swift/);
});

test('native map discovery requires the default Expo view manager and runtime config', () => {
  const registeredMap = { nativeComponent: 'HermesStandardMapView' };
  const mapModule = {};
  const runtime = {
    viewManagersMetadata: {
      HermesStandardMap: { propsNames: ['track', 'places'] },
    },
    getViewConfig: (moduleName: string, viewName?: string) => {
      assert.equal(moduleName, 'HermesStandardMap');
      assert.equal(viewName, undefined);
      return { validAttributes: {}, directEventTypes: {} };
    },
  };

  assert.equal(isNativeViewRegistered(runtime, 'HermesStandardMap'), true);
  assert.equal(
    discoverRegisteredNativeView(
      mapModule,
      runtime,
      'HermesStandardMap',
      undefined,
      (moduleName, viewName) => {
      assert.equal(moduleName, 'HermesStandardMap');
      assert.equal(viewName, undefined);
      return registeredMap;
      },
    ),
    registeredMap,
  );
});

test('native view discovery fails closed before Expo can render an unimplemented placeholder', () => {
  let calls = 0;
  assert.equal(
    discoverRegisteredNativeView(
      null,
      { viewManagersMetadata: {}, getViewConfig: () => null },
      'HermesStandardMap',
      undefined,
      () => {
        calls += 1;
        return {};
      },
    ),
    null,
  );
  assert.equal(calls, 0);

  const advertisedModule = {};
  assert.equal(
    discoverRegisteredNativeView(
      advertisedModule,
      { viewManagersMetadata: {}, getViewConfig: () => ({
        validAttributes: {},
        directEventTypes: {},
      }) },
      'HermesStandardMap',
      undefined,
      () => {
        calls += 1;
        return {};
      },
    ),
    null,
  );
  assert.equal(calls, 0);

  assert.equal(isNativeViewRegistered({
    viewManagersMetadata: { HermesStandardMap: { propsNames: [] } },
    getViewConfig: () => null,
  }, 'HermesStandardMap'), false);

  assert.equal(
    discoverRegisteredNativeView(
      advertisedModule,
      {
        viewManagersMetadata: { HermesStandardMap: { propsNames: [] } },
        getViewConfig: () => ({ validAttributes: {}, directEventTypes: {} }),
      },
      'HermesStandardMap',
      undefined,
      () => {
        throw new Error('view manager is not registered');
      },
    ),
    null,
  );
});
