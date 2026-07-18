import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const moduleRoot = resolve(root, 'modules', 'hermes-ios-context');
const read = (file: string) => readFileSync(resolve(moduleRoot, file), 'utf8');

test('signed iOS builds declare native context privacy and background capabilities', () => {
  const config = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')) as {
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
  assert.match(module, /SecTaskCopyValueForEntitlement/);
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
  assert.match(subscriber, /HermesAccountLifecycle\.deleteOwnerScope\(ownerScope\)/);
  assert.doesNotMatch(subscriber, /deleteCurrentOwnerScope\(\)/);
  assert.match(queue, /state\["collectionSuspended"\] = true/);
  assert.match(queue, /guard !isCollectionSuspendedUnlocked\(\)/);
  assert.match(lifecycle, /HermesLocationService\.shared\.resetAccountState\(\)/);
  assert.match(lifecycle, /HermesMotionService\.shared\.resetAccountState\(\)/);
  assert.match(lifecycle, /HermesScreenTimeService\.shared\.stopAllMonitoring\(/);
  assert.match(lifecycle, /HermesBackgroundService\.shared\.cancelScheduledTasks\(\)/);
  assert.match(lifecycle, /HermesWatchService\.shared\.resetAccountState\(/);
  assert.match(lifecycle, /queue\.deleteOwnerScope\(ownerScope\)/);
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

test('context startup upgrades an existing When-In-Use grant to Always', () => {
  const provider = readFileSync(resolve(root, 'src/context/IOSContextProvider.tsx'), 'utf8');
  assert.match(provider, /getLocationAuthorizationDetails\(\)/);
  assert.match(provider, /locationDetails\['always'\] !== true/);
  assert.match(provider, /requestLocationAuthorization\(\)/);
  assert.match(provider, /activateOwnerScope\(ownerScope\)/);
});

test('location authorization resolves when an Always upgrade remains While In Use', () => {
  const source = read('ios/HermesLocationService.swift');
  assert.match(
    source,
    /status == \.authorizedAlways \|\| status == \.authorizedWhenInUse[\s\S]*authorizationContinuation\?\.resume/,
  );
  assert.match(source, /requestedAlwaysUpgrade = false/);
  assert.match(
    source,
    /status == \.authorizedWhenInUse && !requestedAlwaysUpgrade[\s\S]*manager\.requestAlwaysAuthorization\(\)[\s\S]*authorizationContinuation\?\.resume\(returning: HermesAuthorization\.location\(status\)\)/,
  );
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
});

test('weather map stays a flat standard vector map with native gestures and user location', () => {
  const source = read('ios/HermesStandardMapView.swift');
  assert.match(source, /MKStandardMapConfiguration\(elevationStyle: \.flat\)/);
  assert.match(source, /isScrollEnabled = true/);
  assert.match(source, /isZoomEnabled = true/);
  assert.match(source, /isRotateEnabled = true/);
  assert.match(source, /locationButton\.addTarget/);
  assert.match(source, /requestPreciseAuthorization\(\)/);
  assert.match(source, /requestCurrent\(\)/);
  assert.match(source, /centerOnUser\(animated: true\)/);
  assert.match(source, /isPitchEnabled = false/);
  assert.match(source, /showsUserLocation = true/);
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
    'recordCommandCompletion',
    'storePendingCommand',
    'readPendingCommands',
    'removePendingCommand',
    'setOwnerScope',
    'activateOwnerScope',
    'deleteOwnerScope',
    'requestPreciseLocation',
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
  assert.match(provider, /_relay_device_id: deviceId/);
  assert.match(provider, /_relay_owner_scope: ownerScope/);
  assert.match(provider, /setOwnerScope\(ownerScope\)/);
  assert.match(provider, /requestScreenTimeAuthorization/);
  assert.match(provider, /startScreenTimeMonitoring\('hermes-daily-context', 0, 24\)/);
  assert.match(provider, /readPendingEvents\(EVENT_BATCH_SIZE, ownerScope\)/);
  assert.match(provider, /enqueueContextEvents\(events/);
  assert.ok(
    provider.indexOf('enqueueContextEvents(events') < provider.indexOf('await flushPendingEvents();'),
    'snapshots are encrypted locally before upload',
  );
  assert.doesNotMatch(provider, /apiRef\.current\.uploadEvents\(\{\s*cursor: `snapshot:/);
  assert.match(provider, /executeDeviceCommand\(command, flushPendingEvents, ownerScope\)/);
  assert.match(read('ios/HermesContextEventQueue.swift'), /commandCursorsByScope/);
  assert.match(read('ios/HermesContextEventQueue.swift'), /completedCommandIDsByScope/);
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
});

test('smart weather view only renders local today data and valid alerts', () => {
  const source = readFileSync(resolve(root, 'src', 'context', 'SmartWeatherPage.tsx'), 'utf8');
  assert.match(source, /dayKey\(new Date\(\)\)/);
  assert.match(source, /todayTrajectory = snapshot\.trajectory\.filter/);
  assert.match(source, /todayPlaces = snapshot\.places\.filter/);
  assert.match(source, /expires_at\) > Date\.now\(\)/);
  assert.doesNotMatch(source, /normalizeTimestamp\(forecast\.starts_at\) <= Date\.now\(\)/);
  assert.doesNotMatch(source, /LocateFixed|IOSPressable/);
});
