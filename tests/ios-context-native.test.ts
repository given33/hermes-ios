import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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

test('APNs entitlement follows local Debug and EAS signing environments', () => {
  const require = createRequire(import.meta.url);
  const configFactory = require(resolve(root, 'app.config.js')) as () => {
    ios: { entitlements: Record<string, unknown> };
  };
  const saved = {
    EAS_BUILD_PROFILE: process.env.EAS_BUILD_PROFILE,
    EXPO_PUBLIC_FRONTEND_PREVIEW: process.env.EXPO_PUBLIC_FRONTEND_PREVIEW,
    HERMES_DISTRIBUTABLE_BUILD: process.env.HERMES_DISTRIBUTABLE_BUILD,
    NODE_ENV: process.env.NODE_ENV,
  };
  const configure = (profile: string | undefined, nodeEnv: string) => {
    if (profile === undefined) delete process.env.EAS_BUILD_PROFILE;
    else process.env.EAS_BUILD_PROFILE = profile;
    delete process.env.HERMES_DISTRIBUTABLE_BUILD;
    process.env.EXPO_PUBLIC_FRONTEND_PREVIEW = '0';
    process.env.NODE_ENV = nodeEnv;
    return configFactory().ios.entitlements['aps-environment'];
  };
  try {
    assert.equal(configure(undefined, 'development'), 'development');
    assert.equal(configure('development', 'production'), 'development');
    assert.equal(configure('preview', 'production'), 'production');
    assert.equal(configure('production', 'production'), 'production');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

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
  assert.equal(entitlements['com.apple.developer.healthkit.background-delivery'], true);
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
    'NSMicrophoneUsageDescription',
    'NSSpeechRecognitionUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSContactsUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSHomeKitUsageDescription',
    'NSAppleMusicUsageDescription',
    'NFCReaderUsageDescription',
  ]) {
    assert.equal(typeof infoPlist[key], 'string', `${key} is declared`);
  }
  assert.equal(entitlements['com.apple.developer.family-controls'], true);
  assert.deepEqual(entitlements['com.apple.security.application-groups'], [
    'group.app.sunstone1029.fig1171.hermes',
  ]);
  assert.deepEqual(entitlements['keychain-access-groups'], [
    '$(AppIdentifierPrefix)app.sunstone1029.fig1171.hermes.shared',
  ]);
});

test('native voice input and read-aloud stay behind explicit iOS permissions', () => {
  const bridge = read('index.ts');
  const module = read('ios/HermesIOSContextModule.swift');
  const service = read('ios/HermesVoiceService.swift');
  const podspec = read('ios/HermesIOSContext.podspec');
  const chat = [
    readFileSync(resolve(root, 'src/studio/PreviewChatPage.tsx'), 'utf8'),
    readFileSync(resolve(root, 'src/studio/chat/chat-attachments.ts'), 'utf8'),
    readFileSync(resolve(root, 'src/studio/chat/useChatAttachmentController.ts'), 'utf8'),
    readFileSync(resolve(root, 'src/studio/chat/useHermesVoice.ts'), 'utf8'),
  ].join('\n');

  for (const operation of [
    'getVoiceAuthorization',
    'requestVoiceAuthorization',
    'startVoiceRecognition',
    'stopVoiceRecognition',
    'speakText',
    'stopSpeaking',
  ]) {
    assert.match(bridge, new RegExp(operation));
    assert.match(module, new RegExp(`AsyncFunction\\("${operation}"\\)`));
  }
  assert.match(module, /Events\("onVoiceTranscript", "onVoiceState"\)/);
  assert.match(bridge, /subscribeVoiceTranscript/);
  assert.match(bridge, /subscribeVoiceState/);
  assert.match(service, /SFSpeechAudioBufferRecognitionRequest/);
  assert.match(service, /AVSpeechSynthesizer/);
  assert.match(service, /AVAudioSession\.interruptionNotification/);
  assert.match(service, /requiresOnDeviceRecognition = true/);
  assert.match(service, /DispatchQueue\.main\.asyncAfter\(deadline: \.now\(\) \+ 55/);
  assert.match(service, /recognitionGeneration == generation/);
  assert.match(service, /if inputTapInstalled/);
  assert.match(service, /activeUtterance === utterance/);
  assert.ok(
    service.indexOf('try session.setActive(true, options: .notifyOthersOnDeactivation)')
      < service.indexOf('let format = input.outputFormat(forBus: 0)'),
    'the recording session is activated before querying the microphone route',
  );
  assert.match(
    service,
    /guard format\.sampleRate > 0, format\.channelCount > 0 else \{\s*deactivateAudioSession\(\)/,
  );
  assert.match(service, /stopSpeaking\(\)[\s\S]*finishSpeaking\(utterance\)/);
  assert.match(service, /catch \{[\s\S]*deactivateAudioSession\(\)[\s\S]*throw error/);
  assert.equal(module.match(/MainActor\.assumeIsolated/g)?.length, 5);
  assert.match(podspec, /'AVFoundation'/);
  assert.match(podspec, /'Speech'/);
  assert.match(chat, /requestVoiceAuthorization/);
  assert.match(chat, /startVoiceRecognition/);
  assert.match(chat, /stopVoiceRecognition/);
  assert.match(chat, /speakText/);
  assert.match(chat, /requestMediaLibraryPermissionsAsync/);
  assert.match(chat, /requestCameraPermissionsAsync/);
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
    'requestHealthWriteAuthorization',
    'writeHealthSampleForCommand',
    'listCalendarEvents',
    'createCalendarEvent',
    'listReminders',
    'createReminder',
    'readClipboard',
    'writeClipboard',
    'shareTextToNotes',
    'deleteExportedPhoto',
    'enqueueContextEvents',
    'claimPendingEvents',
    'readPendingEvents',
    'acknowledgeEventClaim',
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
  // Reads and acknowledgements demand the active owner scope; a missing or
  // stale scope must never drain another account's events.
  assert.match(queue, /func acknowledge\(ids: Set<String>, cursor: Int\?, scope: String\) throws/);
  assert.match(queue, /guard limit > 0, isCurrentOwnerScopeUnlocked\(scope\) else \{ return \[\] \}/);
  assert.match(queue, /guard isCurrentOwnerScopeUnlocked\(scope\) else \{ return 0 \}/);
  assert.match(
    module,
    /readPendingEventsByKind"\) \{ \(limit: Int, kinds: \[String\], scope: String\)/,
  );
  assert.match(module, /read\(limit: limit, kinds: Set\(kinds\), scope: scope\)/);
  assert.doesNotMatch(queue, /events\[index\]\["owner_scope"\] = scope/);
  assert.match(queue, /"account_generation": relayState\["serverAccountGeneration"\]/);
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
  assert.match(subscriber, /data\["account_generation"\]/);
  assert.match(
    subscriber,
    /HermesAccountLifecycle\.deleteOwnerScope\([\s\S]*tombstone\.ownerScope,[\s\S]*accountGeneration: tombstone\.accountGeneration,[\s\S]*requestedAt: tombstone\.requestedAt/,
  );
  assert.doesNotMatch(subscriber, /deleteCurrentOwnerScope\(\)/);
  assert.match(queue, /state\["collectionSuspended"\] = true/);
  assert.match(queue, /guard !isCollectionSuspendedUnlocked\(\)/);
  assert.match(lifecycle, /HermesLocationService\.shared\.resetAccountState\(\)/);
  assert.match(lifecycle, /HermesMotionService\.shared\.resetAccountState\(\)/);
  assert.match(lifecycle, /HermesHealthService\.shared\.resetAccountState\(\)/);
  assert.match(lifecycle, /HermesScreenTimeService\.shared\.stopAllMonitoring\(/);
  assert.match(lifecycle, /HermesBackgroundService\.shared\.cancelScheduledTasks\(\)/);
  assert.match(lifecycle, /HermesWatchService\.shared\.resetAccountState\(/);
  assert.match(lifecycle, /queue\.deleteOwnerScope\([\s\S]*ownerScope,[\s\S]*accountGeneration: accountGeneration,[\s\S]*requestedAt: requestedAt/);
  assert.doesNotMatch(lifecycle, /isCurrentOwnerScope/);
  assert.match(queue, /func activateOwnerScope\(_ scope: String, accountGeneration: String\)/);
  assert.match(queue, /state\["accountGeneration"\]/);
  assert.match(queue, /deletedOwnerScopes/);
  assert.match(lifecycle, /HermesLiveActivityService\.shared\.endAll\(\)/);
  assert.match(background, /guard !HermesContextEventQueue\.shared\.isCollectionSuspended/);
  assert.doesNotMatch(subscriber, /apns-token|didRegisterForRemoteNotificationsWithDeviceToken/);
  assert.deepEqual(expoConfig.apple.appDelegateSubscribers, [
    'HermesIOSContextAppDelegateSubscriber',
  ]);
});

test('account exports use a protected native ciphertext file and delete it after sharing', () => {
  const bridge = read('index.ts');
  const module = read('ios/HermesIOSContextModule.swift');
  const protectedFile = read('ios/HermesProtectedExportFile.swift');
  const accountPage = readFileSync(resolve(root, 'src/auth/AccountPage.tsx'), 'utf8');

  for (const operation of [
    'writeProtectedAccountExport',
    'deleteProtectedAccountExport',
  ]) {
    assert.match(bridge, new RegExp(operation));
    assert.match(module, new RegExp(`AsyncFunction\\("${operation}"\\)`));
  }
  assert.match(protectedFile, /FileProtectionType\.complete/);
  assert.match(protectedFile, /InputStream\(data:/);
  assert.match(protectedFile, /64 \* 1024/);
  assert.match(protectedFile, /candidate\.deletingLastPathComponent\(\) == directory/);
  assert.match(accountPage, /payload\.encrypted !== true/);
  assert.match(accountPage, /writeProtectedAccountExport/);
  assert.match(accountPage, /deleteProtectedAccountExport/);
  assert.doesNotMatch(accountPage, /new File\(Paths\.cache/);
});

test('remote APNs wakes are fenced and persisted before relay execution', () => {
  const subscriber = read('ios/HermesIOSContextAppDelegateSubscriber.swift');
  const queue = read('ios/HermesContextEventQueue.swift');
  const module = read('ios/HermesIOSContextModule.swift');
  assert.match(subscriber, /notificationFence\(userInfo\)/);
  assert.match(subscriber, /owner_id/);
  assert.match(subscriber, /account_generation/);
  assert.match(subscriber, /event_key/);
  assert.match(subscriber, /token\.accepts\(ownerID: fence\.ownerID/);
  const persist = subscriber.indexOf('let persisted = HermesContextEventQueue.shared.enqueue');
  const relay = subscriber.indexOf('notifyRelayWake(reason: "remote-notification")');
  assert.ok(persist >= 0 && persist < relay);
  assert.match(subscriber, /eventID: Self\.apnsEventID\(fence\)/);
  assert.match(queue, /func accepts\(ownerID candidate: String, accountGeneration: String\)/);
  assert.match(module, /hermes\["event_key"\].*local:/s);
});

test('native event outbox claims and ACKs only after durable atomic replacement', () => {
  const queue = read('ios/HermesContextEventQueue.swift');
  const provider = readFileSync(resolve(root, 'src/context/IOSContextProvider.tsx'), 'utf8');

  assert.match(queue, /func enqueue\([\s\S]*\) -> Bool \{/);
  assert.doesNotMatch(queue, /deferredEvents/);
  assert.match(queue, /"outbox_state": "pending"/);
  assert.match(queue, /func claim\(limit: Int, kinds: Set<String>\? = nil, scope: String\) throws/);
  assert.match(queue, /events\[index\]\["outbox_state"\] = "inflight"/);
  assert.match(queue, /events\[index\]\["batch_token"\] = token/);
  assert.match(queue, /func acknowledgeClaim\([\s\S]*token: String[\s\S]*\) throws -> Int/);
  assert.match(queue, /try persistUnlocked\(remaining\)[\s\S]*return events\.count - remaining\.count/);
  assert.match(queue, /try handle\.synchronize\(\)/);
  assert.match(queue, /FileManager\.default\.replaceItemAt/);
  assert.match(queue, /Darwin\.fsync\(descriptor\)/);
  assert.match(queue, /pending-events-corrupt-\\\(digest\.prefix\(20\)\)/);
  assert.match(queue, /try quarantineCorruptLinesUnlocked\(corruptLines\)[\s\S]*try persistUnlocked\(events\)/);
  assert.match(queue, /rewroteCorruptQueue = true/);
  assert.match(queue, /if !rewroteCorruptQueue \{ cachedEncryptedBytes = data\.count \}/);
  assert.doesNotMatch(queue, /catch \{[\s\S]{0,120}in-memory batch remains intact/);

  const claim = provider.indexOf('HermesIOSContext.claimPendingEvents');
  const upload = provider.indexOf('api.uploadEvents');
  const acknowledge = provider.indexOf('HermesIOSContext.acknowledgeEventClaim');
  assert.ok(claim >= 0 && claim < upload && upload < acknowledge);
});

test('attachment vault keeps a non-shared outbox root and symlink-safe containment', () => {
  const vault = read('ios/HermesAttachmentVault.swift');
  const module = read('ios/HermesIOSContextModule.swift');
  const bridge = read('index.ts');
  const chat = [
    readFileSync(resolve(root, 'src/studio/PreviewChatPage.tsx'), 'utf8'),
    readFileSync(resolve(root, 'src/studio/chat/chat-attachments.ts'), 'utf8'),
  ].join('\n');
  const purge = readFileSync(resolve(root, 'src/api/local-account-purge.ts'), 'utf8');

  // The encrypted outbox must live outside the UIFileSharingEnabled Documents
  // tree, with a one-time migration away from the legacy location, and JS asks
  // the vault for the root instead of rebuilding the path.
  assert.match(vault, /applicationSupportDirectory, in: \.userDomainMask/);
  assert.match(vault, /func migrateLegacyOutbox\(\)/);
  assert.match(vault, /legacyEncryptedOutboxRoot/);
  assert.match(module, /Function\("getAttachmentOutboxRootUri"\)/);
  assert.match(bridge, /getAttachmentOutboxRootUri/);
  assert.match(chat, /attachmentOutboxRoot\(/);
  assert.match(purge, /attachmentOutboxRoot\(/);
  assert.doesNotMatch(chat, /Paths\.document,\s*'hermes-outbox'/);
  // Containment resolves symlinks on both sides and compares whole path
  // components; encrypt only reads sources the app itself staged.
  assert.match(vault, /resolvingSymlinksInPath\(\)/);
  assert.match(vault, /candidateComponents\.prefix\(rootComponents\.count\)\) == rootComponents/);
  assert.match(vault, /try requireAllowedSource\(source\)/);
  assert.doesNotMatch(vault, /\.path\.hasPrefix\(rootPath\)/);
  // New envelopes are chunked and bounded; SHA-256 and the account token are
  // rechecked before the temporary file is atomically published. Legacy v1
  // remains read-only compatibility for already queued uploads.
  const encrypt = vault.slice(vault.indexOf('func encrypt('), vault.indexOf('func decryptForUpload('));
  assert.match(encrypt, /HATTV002|chunkedEnvelopeMagic/);
  assert.match(encrypt, /read\(upToCount: Self\.chunkBytes\)/);
  assert.match(encrypt, /maximumPlaintextBytes/);
  assert.match(encrypt, /SHA256\(\)/);
  assert.match(encrypt, /isCurrentCollectorGenerationToken\(ownerToken\)/);
  assert.match(encrypt, /installAtomically\(temporary, at: target\)/);
  assert.doesNotMatch(encrypt, /Data\(contentsOf: source/);
  assert.match(vault, /legacyEnvelopeMagic/);
  const deletion = vault.slice(vault.indexOf('func deleteKey('), vault.indexOf('func activate('));
  assert.ok(deletion.indexOf('markRevoked') < deletion.indexOf('removeItem'));

  const attachmentController = readFileSync(
    resolve(root, 'src/studio/chat/useChatAttachmentController.ts'),
    'utf8',
  );
  assert.match(attachmentController, /writeBoundedDownload/);
  assert.match(attachmentController, /AbortController/);
  assert.doesNotMatch(attachmentController, /blob\.arrayBuffer\(\)/);
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
  assert.match(provider, /setOwnerScope\(ownerScope, accountGeneration\)/);
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
  assert.match(source, /didFailWithError[\s\S]*resolveLocationRequest\(with: bestPayload, matching: requestToken\)/);
  assert.match(
    read('ios/HermesIOSContextAppDelegateSubscriber.swift'),
    /guard HermesPermissionCollectionGate\.shared\.isReadyForCurrentOwner else \{ return \}/,
  );
  const gate = read('ios/HermesPermissionCollectionGate.swift');
  assert.match(gate, /accountGeneration/);
  assert.match(gate, /isCurrentOwnerScope/);
});

test('location, geofence, and motion callbacks are fenced by account generation', () => {
  const queue = read('ios/HermesContextEventQueue.swift');
  const lifecycle = read('ios/HermesAccountLifecycle.swift');
  const location = read('ios/HermesLocationService.swift');
  const motion = read('ios/HermesMotionService.swift');

  assert.match(queue, /struct HermesCollectorGenerationToken: Equatable, Sendable/);
  assert.match(queue, /func currentCollectorGenerationToken\(\)/);
  assert.match(queue, /func isCurrentCollectorGenerationToken/);
  assert.match(queue, /startedAtMilliseconds/);
  assert.match(queue, /func accepts\(_ date: Date, futureSkew: TimeInterval = 60\)/);
  assert.match(queue, /"app\.hermes\.\\\(Self\.digest\(ownerScope\)\)\.\\\(Self\.digest\(serverAccountGeneration\)\)\.\\\(lifecycleEpoch\)"/);
  assert.match(lifecycle, /performIfCurrentCollectorGeneration/);
  assert.match(lifecycle, /HermesLocationService\.shared\.activateAccountGeneration\(token\)/);
  assert.match(lifecycle, /HermesMotionService\.shared\.activateAccountGeneration\(token\)/);

  assert.match(location, /private var manager: CLLocationManager/);
  assert.match(location, /previous\.delegate = nil[\s\S]*manager = CLLocationManager\(\)/);
  assert.match(location, /for region in previous\.monitoredRegions where isHermesRegion\(region\)/);
  assert.match(location, /for region in manager\.monitoredRegions where isHermesRegion\(region\)/);
  assert.match(location, /identifier: "\\\(token\.regionNamespace\)\.stable-place"/);
  assert.match(location, /withCurrentCollector\(manager, source: "location"\)[\s\S]*lastLocation = location/);
  assert.match(location, /withCurrentRegion\(manager, region: region, source: "region-entry"\)/);
  assert.match(location, /token\.accepts\(\$0\.timestamp\)/);
  assert.match(location, /accountGeneration: token\.lifecycleEpoch/);
  assert.match(location, /Logger\(subsystem: "app\.hermes", category: "location-collector"\)/);

  assert.match(motion, /manager\.startActivityUpdates[\s\S]*self\.handle\(activity, token: token\)/);
  assert.match(motion, /performIfCurrentCollectorGeneration\(token\)[\s\S]*storedSnapshot = payload/);
  assert.match(motion, /token\.accepts\(activity\.startDate\)/);
  assert.match(motion, /accountGeneration: token\.lifecycleEpoch/);
  assert.match(motion, /Logger\(subsystem: "app\.hermes", category: "motion-collector"\)/);
});

test('weather map stays a flat standard vector map with native gestures and user location', () => {
  const source = read('ios/HermesMapKitSurface.swift');
  const amap = read('ios/HermesAMapSurface.swift');
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
  assert.match(source, /pointOfInterestFilter = \.excludingAll/);
  assert.match(source, /func setShowsUserLocation\(_ shows: Bool\)/);
  assert.match(source, /mapView\.showsUserLocation = shows/);
  assert.match(source, /MKPolyline/);
  assert.doesNotMatch(source, /satellite|hybrid|search/i);
  assert.match(amap, /mapView\.isShowTraffic = true/);
  assert.match(amap, /mapView\.isShowsLabels = true/);
  assert.match(amap, /mapView\.isShowsBuildings = false/);
  assert.match(amap, /mapView\.isShowsIndoorMap = false/);
  assert.match(amap, /mapView\.isZoomEnabled = true/);
  assert.match(amap, /mapView\.isScrollEnabled = true/);
  assert.match(amap, /mapView\.isRotateEnabled = true/);
  assert.match(amap, /mapView\.isRotateCameraEnabled = false/);
  assert.match(amap, /mapView\.touchPOIEnabled = false/);
});

test('native relay covers durable cursors, background services, health, watch, notifications, and optional capabilities', () => {
  const module = read('ios/HermesIOSContextModule.swift');
  const provider = readFileSync(resolve(root, 'src', 'context', 'IOSContextProvider.tsx'), 'utf8');
  const background = read('ios/HermesBackgroundService.swift');
  const watch = read('ios/HermesWatchService.swift');
  const liveActivity = read('ios/HermesLiveActivityService.swift');
  const appIntents = read('ios/HermesAppIntents.swift');
  assert.match(watch, /currentCollectorGenerationToken\(\)/);
  assert.match(watch, /matches\(message, token: token\)/);
  assert.match(watch, /enqueueBatch\(events\)/);
  assert.match(watch, /accountResetAt/);
  assert.match(watch, /accountUUID/);
  for (const operation of [
    'getInstallationIdentifier',
    'getCommandCursor',
    'hasCompletedCommand',
    'getCommandExecutionResult',
    'recordCommandCompletion',
    'createCalendarEventForCommand',
    'createReminderForCommand',
    'readClipboardForCommand',
    'writeClipboardForCommand',
    'shareTextToNotesForCommand',
    'storePendingCommand',
    'readPendingCommands',
    'removePendingCommand',
    'readPendingTaskControls',
    'consumePendingTaskControl',
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
    'setBackgroundRelayReady',
    'listPendingRelayWakes',
    'completeBackgroundRelay',
  ]) {
    assert.match(module, new RegExp(`AsyncFunction\\(\"${operation}\"\\)`));
  }
  for (const capability of [
    'ios-location', 'ios-trajectory', 'ios-places', 'ios-motion', 'ios-behavior',
    'qweather', 'amap-route', 'ios-map', 'ios-power', 'ios-health-sleep',
    'ios-health-heart', 'ios-health-oxygen', 'ios-health-activity', 'ios-calendar',
    'ios-reminders', 'ios-clipboard', 'ios-notes', 'ios-screen-time', 'ios-watch', 'ios-notification',
    'ios-live-activity', 'ios-health-write', 'ios-device',
  ]) {
    assert.match(provider, new RegExp(capability.replace('-', '[-]')));
  }
  assert.match(provider, /hasCompletedCommand/);
  assert.match(provider, /recordCommandCompletion/);
  assert.match(provider, /HermesIOSContext\.getDeviceSnapshot\(\)\.catch/);
  assert.match(provider, /return \{ screenTime: await HermesIOSContext\.getScreenTimeSnapshot\(\) \};/);
  assert.match(provider, /HermesIOSContext\.getWatchSnapshot\(\)\.catch/);
  assert.doesNotMatch(provider, /snapshotEvent\('screen-time'/);
  assert.match(provider, /snapshotEvent\('watch'/);
  assert.doesNotMatch(provider, /payload\.place_id = payload\.place_id \?\? event\.id/);
  assert.match(provider, /_relay_execution_status: 'executing'/);
  assert.match(provider, /getCommandExecutionResult\(command\.id\)/);
  assert.ok(
    provider.indexOf('getCommandExecutionResult(command.id)') < provider.indexOf("_relay_error: 'expired'"),
    'native execution checkpoints are recovered before command expiry is evaluated',
  );
  assert.match(provider, /_relay_attempts:/);
  assert.match(provider, /nativeActionMetadata\(command\)/);
  assert.match(provider, /recordIOSActionAudit/);
  assert.match(provider, /user confirmation required/);
  assert.match(provider, /ios-clipboard:read/);
  assert.match(provider, /ios-clipboard:write/);
  assert.match(provider, /ios-health-write:write/);
  assert.match(provider, /ios-photos:ocr/);
  assert.match(provider, /ios-device:open-url/);
  assert.match(provider, /if \(\/\^ios-health-write:\/\.test\(key\)\) return null/);
  assert.match(provider, /createCalendarEventForCommand\(command\.id/);
  assert.match(provider, /createReminderForCommand\(command\.id/);
  assert.match(provider, /_relay_device_id: deviceId/);
  assert.match(provider, /_relay_owner_scope: ownerScope/);
  assert.match(provider, /setOwnerScope\(ownerScope, accountGeneration\)/);
  assert.match(provider, /setBackgroundRelayReady\([\s\S]*ownerScope,[\s\S]*accountGeneration,[\s\S]*true/);
  assert.match(provider, /setBackgroundRelayReady\([\s\S]*ownerScope,[\s\S]*accountGeneration,[\s\S]*false/);
  assert.match(provider, /setPermissionCollectionReady\(ownerScope, false\)/);
  assert.match(provider, /canStartIOSCollection\(authorization\)/);
  assert.match(provider, /!canStartIOSCollection\(permissionSnapshotRef\.current\)/);
  assert.match(provider, /permissionSettingsOpenedRef\.current = true/);
  assert.match(provider, /permissionSettingsOpenedRef\.current = false/);
  assert.match(provider, /clearIOSPermissionRun\(ownerScope\)/);
  assert.match(readFileSync(resolve(root, 'src/context/ios-permission-coordinator.ts'), 'utf8'), /requestScreenTimeAuthorization/);
  assert.match(provider, /startScreenTimeMonitoring\('hermes-daily-context', 0, 24\)/);
  assert.match(provider, /claimPendingEvents\(EVENT_BATCH_SIZE, ownerScope\)/);
  assert.match(provider, /enqueueContextEvents\([\s\S]*events as unknown/);
  assert.ok(
    provider.indexOf('HermesIOSContext.enqueueContextEvents(')
      < provider.indexOf('await flushPendingEvents(capture);'),
    'snapshots are encrypted locally before upload',
  );
  assert.doesNotMatch(provider, /apiRef\.current\.uploadEvents\(\{\s*cursor: `snapshot:/);
  // Trajectory/places device commands flush pending then load the durable server snapshot.
  assert.match(
    provider,
    /executeDeviceCommand\([\s\S]*command,[\s\S]*flushPendingEvents\(capture\),[\s\S]*ownerScope,[\s\S]*accountGeneration,[\s\S]*permissionSnapshotRef\.current/,
  );
  assert.match(provider, /source: snapshot \? 'server_snapshot' : 'local_pending_after_flush'/);
  assert.match(provider, /trajectory: snapshot\?\.trajectory \|\| \[\]/);
  assert.match(provider, /places: snapshot\?\.places \|\| \[\]/);
  assert.match(provider, /case 'ios-photos:export'/);
  assert.match(provider, /cloud\.uploadAccountFile\(/);
  assert.match(provider, /deleteExportedPhoto\(ownerScope, uri\)/);
  assert.match(provider, /retryableFailure/);
  assert.match(provider, /command\._relay_attempts \|\| 0\) < actionMetadata\.max_attempts/);
  assert.match(provider, /case 'ios-vision:classify'/);
  assert.match(provider, /case 'ios-vision:detect'/);
  assert.match(provider, /case 'ios-vision:faces'/);
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
  assert.match(background, /Logger\(subsystem: "app\.hermes", category: "background-tasks"\)/);
  assert.match(background, /Could not schedule app refresh/);
  assert.match(background, /Could not schedule background processing/);
  assert.doesNotMatch(background, /try\? BGTaskScheduler\.shared\.submit/);
  assert.match(background, /Task \{ \[weak self\] in\s+guard let self else \{ return \}/);
  assert.match(background, /performNativeWork\(operationID:/);
  assert.match(background, /HermesScreenTimeService\.shared\.consumeExtensionEvents\(\)/);
  assert.match(background, /HermesHealthService\.shared\.resumeBackgroundCollection\(\)/);
  assert.match(background, /MainActor\.run \{ HermesDeviceService\.shared\.recordSnapshot\(\) \}/);
  assert.match(background, /waitForRelayReady\(token, timeout: 5\)/);
  assert.match(background, /Task\.isCancelled/);
  assert.match(background, /operation\.cancel\(reason: "expired"\)/);
  assert.match(background, /persistRetryState/);
  assert.match(background, /defaults\.synchronize\(\)/);
  assert.match(background, /private var finished = false/);
  assert.match(background, /task\.setTaskCompleted\(success: success\)/);
  assert.ok(
    background.indexOf('nativeMaintenanceCompleted')
      < background.indexOf('notifyRelayWake(reason: "background-task")'),
    'BGTask executes native maintenance before handing an upload wake to JavaScript',
  );
  assert.match(watch, /WCSessionDelegate/);
  assert.match(liveActivity, /ActivityAttributes/);
  for (const field of [
    'kind', 'taskID', 'status', 'progress', 'currentTool', 'actionDeepLink',
  ]) {
    assert.match(liveActivity, new RegExp(`var ${field}:`));
  }
  assert.doesNotMatch(liveActivity, /approvalRequired/);
  assert.match(liveActivity, /safeTaskDeepLink/);
  assert.match(liveActivity, /progressValue/);
  assert.match(appIntents, /HermesTaskControlStore/);
  for (const intent of [
    'HermesResumeTaskIntent', 'HermesPauseTaskIntent', 'HermesCancelTaskIntent', 'HermesRetryTaskIntent',
  ]) {
    assert.match(appIntents, new RegExp(`struct ${intent}: AppIntent`));
  }
  assert.match(appIntents, /struct HermesTaskShortcuts: AppShortcutsProvider/);
  assert.match(appIntents, /func pending()/);
  assert.match(appIntents, /func consume\(requestID: String\)/);
  assert.match(appIntents, /allowedActions/);
  assert.match(appIntents, /HermesVoiceCaptureIntent/);
  assert.match(read('ios/HermesVoiceService.swift'), /startAgentCapture/);
  assert.match(read('ios/HermesVoiceService.swift'), /kind: "voice-capture"/);
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

test('native action bridge exposes contact, photo, media, radio, and HomeKit boundaries', () => {
  const module = read('ios/HermesIOSContextModule.swift');
  const services = read('ios/HermesNativeActionServices.swift');
  const bridge = readFileSync(resolve(moduleRoot, 'index.ts'), 'utf8');
  const provider = readFileSync(resolve(root, 'src/context/IOSContextProvider.tsx'), 'utf8');
  for (const operation of [
    'getContactsAuthorization', 'requestContactsAuthorization', 'searchContacts', 'createContact', 'createContactForCommand',
    'getPhotosAuthorization', 'requestPhotosAuthorization', 'searchPhotos', 'ocrImage',
    'requestHealthWriteAuthorization', 'writeHealthSampleForCommand', 'writeHealthSamplesForCommand', 'deleteHealthSamplesForCommand',
    'startAgentVoiceCapture', 'configureSessionLock', 'getSessionLockStatus', 'unlockSession', 'lockSession',
    'getDiagnosticsStatus', 'startDiagnostics', 'stopDiagnostics', 'openURL', 'openURLForCommand',
    'readPendingAgentTriggers', 'consumePendingAgentTrigger',
    'getMediaSnapshot', 'controlMedia', 'getBluetoothState', 'scanBluetooth',
    'getHomeKitSnapshot', 'setHomeKitValue', 'startNFCReader', 'scanQRCode', 'getNativeActionCapabilities',
  ]) {
    assert.match(module, new RegExp(`(?:AsyncFunction|Function)\\("${operation}"\\)`));
    assert.match(bridge, new RegExp(operation));
  }
  assert.match(services, /CNContactStore/);
  assert.match(services, /PHAsset.fetchAssets/);
  assert.match(services, /MPMusicPlayerController.systemMusicPlayer/);
  assert.match(services, /CBCentralManager/);
  assert.match(services, /HMHomeManager/);
  assert.match(services, /writeValue/);
  assert.match(services, /AVCaptureMetadataOutput/);
  assert.match(services, /VNRecognizeTextRequest/);
  assert.match(services, /PHImageManager/);
  assert.match(services, /creationRequestForAssetFromVideo/);
  assert.match(services, /PHAssetResourceManager/);
  assert.match(services, /requireAllowedOCRSource/);
  assert.doesNotMatch(services, /"imageURL": normalizedURL/);
  assert.match(read('ios/HermesHealthService.swift'), /HKMetadataKeyExternalUUID/);
  assert.match(read('ios/HermesAppIntents.swift'), /HermesSummarizeMeetingIntent/);
  assert.match(read('ios/HermesAppIntents.swift'), /HermesClipboardToEmailIntent/);
  assert.match(provider, /drainPendingAgentTriggers/);
  assert.match(provider, /agentTriggersRunning/);
  assert.match(services, /HermesQRScannerViewController/);
  assert.match(services, /onCancel/);
  assert.match(services, /stateWaiters/);
  assert.match(services, /characteristics/);
  assert.match(services, /func write\(text: String\)/);
  assert.match(services, /VNClassifyImageRequest/);
  assert.match(services, /VNDetectRectanglesRequest/);
  assert.match(services, /VNDetectFaceRectanglesRequest/);
  assert.match(services, /func triggerScene/);
  assert.match(services, /func playSearch/);
  assert.match(services, /func notify/);
  assert.match(module, /HermesNFCService\.shared\.scan/);
  for (const capability of [
    'ios-contacts', 'ios-photos', 'ios-media', 'ios-bluetooth', 'ios-nfc', 'ios-homekit',
  ]) assert.match(provider, new RegExp(capability.replace('-', '[-]')));
  assert.match(provider, /launchCameraAsync/);
  assert.match(provider, /camera actions require the Hermes app in the foreground/);
  const moduleSource = read('ios/HermesIOSContextModule.swift');
  assert.match(moduleSource, /private static func requireCommandID/);
  assert.match(moduleSource, /value\.count <= 256/);
  assert.match(moduleSource, /value\.allSatisfy/);
  assert.match(moduleSource, /writeHealthSamplesForCommand/);
  assert.match(moduleSource, /deleteHealthSamplesForCommand/);
  assert.match(read('ios/HermesSessionLockService.swift'), /LAContext/);
  assert.match(read('ios/HermesSessionLockService.swift'), /deviceOwnerAuthentication/);
  assert.match(read('ios/HermesIOSContextAppDelegateSubscriber.swift'), /performActionFor shortcutItem/);
  assert.match(read('ios/HermesIOSContextAppDelegateSubscriber.swift'), /app\.hermes\.quick\.camera-task/);
  assert.match(read('ios/HermesDiagnosticsService.swift'), /MXMetricManagerSubscriber/);
  assert.match(read('ios/HermesDiagnosticsService.swift'), /ios-diagnostics/);
  assert.match(read('ios/HermesLiveActivityService.swift'), /HermesAgentActivityAttributes/);
  assert.match(read('ios/HermesLiveActivityService.swift'), /sessionCount/);
  assert.match(read('ios/HermesLiveActivityService.swift'), /privacyMode/);
  assert.match(read('ios/HermesLiveActivityService.swift'), /ttsEnabled/);
  for (const operation of [
    'writeHealthSampleForCommand', 'createCalendarEventForCommand', 'createReminderForCommand',
    'shareTextToNotesForCommand', 'readClipboardForCommand', 'writeClipboardForCommand',
    'createContactForCommand', 'openURLForCommand',
  ]) {
    const operationStart = moduleSource.indexOf(`AsyncFunction("${operation}")`);
    assert.ok(operationStart >= 0, `${operation} exists`);
    const operationBody = moduleSource.slice(operationStart, operationStart + 1_200);
    assert.match(operationBody, /requireCommandID\(commandID\)/, `${operation} validates command id`);
  }
});

test('HealthKit background delivery advances generation-scoped anchors after durable writes', () => {
  const health = read('ios/HermesHealthService.swift');
  const queue = read('ios/HermesContextEventQueue.swift');
  const lifecycle = read('ios/HermesAccountLifecycle.swift');
  const subscriber = read('ios/HermesIOSContextAppDelegateSubscriber.swift');
  const module = read('ios/HermesIOSContextModule.swift');
  const provider = readFileSync(resolve(root, 'src/context/IOSContextProvider.tsx'), 'utf8');

  assert.match(health, /HKObserverQuery\(sampleType: sampleType/);
  assert.match(health, /enableBackgroundDelivery\(for: sampleType, frequency: \.immediate/);
  assert.match(health, /HKAnchoredObjectQuery\(/);
  assert.match(health, /private static let anchoredBatchLimit = 500/);
  assert.match(health, /private static let initialBackfillLimit = 5_000/);
  assert.match(health, /initialBackfillDays: TimeInterval = 7/);
  assert.match(health, /token\.regionNamespace[\s\S]*typeIdentifier/);
  assert.match(health, /NSKeyedArchiver\.archivedData/);
  assert.match(health, /NSKeyedUnarchiver\.unarchiveTopLevelObjectWithData/);
  assert.match(health, /backfill-progress/);
  assert.match(health, /backfill-complete/);
  assert.match(health, /"id": "health-sample:\\\(sample\.uuid\.uuidString\.lowercased\(\)\)"/);
  assert.match(health, /eventID: "health-aggregate:\\\(kind\):\\\(bucket\)"/);
  assert.match(health, /domainAuthorization/);
  assert.match(health, /performIfCurrentCollectorGeneration\(token\)/);
  assert.ok(
    health.indexOf('type: "health-sample"') < health.indexOf('self.saveAnchor('),
    'HealthKit anchor advances only after raw samples reach the durable queue',
  );
  assert.match(queue, /eventID: String\? = nil/);
  assert.match(queue, /cachedEventIDs\.contains/);
  assert.match(queue, /maximumEventCount = 10_000/);
  assert.match(queue, /maximumEncryptedBytes = 16 \* 1024 \* 1024/);
  assert.match(queue, /if let cachedEvents \{ return cachedEvents \}/);
  assert.match(queue, /if let cachedRelayState \{ return cachedRelayState \}/);
  assert.match(lifecycle, /HermesHealthService\.shared\.activateAccountGeneration\(token\)/);
  assert.match(subscriber, /HermesHealthService\.shared\.resumeBackgroundCollection\(\)/);
  assert.match(subscriber, /switch deletion\.outcome/);
  assert.match(subscriber, /case \.rejectedStale:[\s\S]*completionHandler\(\.noData\)/);
  assert.match(subscriber, /case \.failed:[\s\S]*completionHandler\(\.failed\)/);
  assert.doesNotMatch(subscriber, /try\? HermesAttachmentVault\.shared\.deleteKey/);
  assert.match(queue, /outcome: previouslyDeletedScopes\.contains\(scope\)[\s\S]*\.rejectedStale/);
  assert.match(queue, /guard persistRelayStateUnlocked\(state\) else/);
  assert.match(module, /guard deletion\.outcome == \.applied else/);
  assert.match(module, /throw HermesAccountDeletionError\.persistenceFailed/);
  assert.doesNotMatch(module, /eventQueue\.enqueue\(type: "health"/);
  assert.doesNotMatch(provider, /function healthEvents/);
  assert.doesNotMatch(provider, /snapshotEvent\('health-(?:sleep|heart|oxygen|activity)'/);
});

test('smart weather view only renders local today data and valid alerts', () => {
  const source = readFileSync(resolve(root, 'src', 'context', 'SmartWeatherPage.tsx'), 'utf8');
  assert.match(source, /dayKey\(new Date\(\)\)/);
  assert.match(source, /todayTrajectory = snapshot\.trajectory\.filter/);
  assert.match(source, /todayPlaces = snapshot\.places\.filter/);
  // Incomplete validity windows are rejected; stale reloads are labeled, not hidden as live.
  assert.match(source, /isForecastActive\(forecast, now\)/);
  assert.match(source, /normalizeSnapshot\(await api\.snapshot\(\)\)/);
  assert.match(source, /smart-weather-stale-warning/);
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
  assert.match(source, /smart-weather-permission-warning/);
  assert.match(source, /smart-weather-notification-warning/);
  assert.match(source, /nativePermissionRequestedRef/);
  assert.match(source, /<DailyRouteCurve/);
  assert.match(source, /timelineExpanded \? '76%' : '38%'/);
  assert.match(source, /centerOnUserRequest=\{centerRequest\}/);
  assert.match(source, /smartWeatherLoadErrorMessage/);
  assert.doesNotMatch(source, /statusOverlay/);
  assert.match(source, /warningRail: \{[\s\S]*position: 'absolute'/);
  assert.match(source, /permissionActions: \{[\s\S]*flexWrap: 'wrap'/);
});

test('logout keeps Always location collection; delete stops owner scope', () => {
  const auth = readFileSync(resolve(root, 'src', 'auth', 'AuthProvider.tsx'), 'utf8');
  const provider = readFileSync(resolve(root, 'src', 'context', 'IOSContextProvider.tsx'), 'utf8');
  // Product boundary: logout / session expiry clear credentials only.
  assert.match(auth, /Product boundary: logout \/ session expiry clear credentials only/);
  assert.doesNotMatch(auth, /logout[\s\S]{0,400}stopAdaptiveLocation/);
  assert.match(auth, /deleteOwnerScope\([\s\S]*ownerScope,[\s\S]*accountGenerationFromOwnerScope/);
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

test('distributable builds keep MapKit available when the optional AMap key is absent', () => {
  const appConfig = readFileSync(resolve(root, 'app.config.js'), 'utf8');
  const workflow = readFileSync(resolve(root, '.github/workflows/ios-unsigned.yml'), 'utf8');
  const mapView = read('ios/HermesStandardMapView.swift');
  const amap = read('ios/HermesAMapSurface.swift');

  assert.doesNotMatch(appConfig, /distributableBuild\s*&&\s*!amapIOSAPIKey/);
  assert.match(appConfig, /HermesAmapIOSAPIKey:\s*amapIOSAPIKey/);
  assert.match(appConfig, /HermesAmapIOSBundleIdentifier:\s*bundleIdentifier/);
  assert.match(appConfig, /'aps-environment': apnsEnvironment/);
  assert.match(workflow, /No app-bound AMap key is configured; native MapKit fallback is enabled/);
  assert.match(workflow, /\$\{HERMES_AMAP_IOS_API_KEY:-\}/);
  assert.match(workflow, /GENERATED_MAP_BUNDLE/);
  assert.match(
    workflow,
    /require\('\.\/app\.base\.json'\)\.expo\.ios\.bundleIdentifier/,
  );
  assert.match(
    workflow,
    /if \[ "\$GENERATED_MAP_BUNDLE" != "\$GENERATED_APP_BUNDLE" \]/,
  );
  assert.match(workflow, /BUNDLED_AMAP_BUNDLE/);
  assert.match(
    workflow,
    /if \[ "\$BUNDLED_AMAP_BUNDLE" != "\$APP_BUNDLE_IDENTIFIER" \]/,
  );
  assert.match(mapView, /static var amapConfigured:[\s\S]*!amapAPIKey\.isEmpty/);
  assert.match(mapView, /amapBundleIdentifier == Bundle\.main\.bundleIdentifier/);
  assert.match(mapView, /amapFailedForSession = true[\s\S]*installRendererIfNeeded\(force: true\)/);
  assert.match(amap, /mapViewDidFailLoadingMap[\s\S]*onProviderFailure\?\(error\)/);
  assert.match(mapView, /let mapKit = HermesMapKitSurface/);
  assert.match(mapView, /final class HermesNativeMapRuntimeState/);
  assert.match(mapView, /"bundleIdentifierMatches"/);
  assert.match(mapView, /HermesLocationService\.shared\.mapLocationStatus\(\)/);
  assert.match(mapView, /phase: "degraded"/);
  assert.match(mapView, /var providerResetRequest = 0/);
  assert.match(mapView, /onProviderStatus\(HermesNativeMapRuntimeState\.shared\.snapshot\(\)\)/);

  const module = read('ios/HermesStandardMapModule.swift');
  const location = read('ios/HermesLocationService.swift');
  const bridge = read('index.ts');
  const page = readFileSync(resolve(root, 'src/context/SmartWeatherPage.tsx'), 'utf8');
  assert.match(module, /Events\("onLocationPress", "onProviderStatus"\)/);
  assert.match(module, /Prop\("providerResetRequest"\)/);
  assert.match(location, /func mapLocationStatus\(\)/);
  assert.match(location, /"lastLocationStatus"/);
  assert.match(bridge, /phase: 'unconfigured' \| 'requestingPermission' \| 'initializing' \| 'ready' \| 'degraded' \| 'failed'/);
  assert.match(page, /providerResetRequest=\{mapAttempt\}/);
  assert.match(page, /onProviderStatus=\{\(event\) => setNativeMapProvider\(event\.nativeEvent\)\}/);
  assert.match(page, /smart-weather-provider-warning/);
});

test('foreground duration settles once and remains bound to its account generation', () => {
  const subscriber = read('ios/HermesIOSContextAppDelegateSubscriber.swift');
  const lifecycle = read('ios/HermesAccountLifecycle.swift');
  assert.match(subscriber, /activeOwnerScopeKey/);
  assert.match(subscriber, /activeAccountGenerationKey/);
  assert.match(subscriber, /activeLifecycleEpochKey/);
  assert.match(
    subscriber,
    /clearForegroundSession\(\)[\s\S]*token\.ownerScope == storedOwnerScope[\s\S]*foregroundDurationSeconds/,
  );
  assert.doesNotMatch(subscriber, /if state == "background" \{ defaults\.removeObject/);
  assert.match(lifecycle, /resetForegroundSessionForCurrentOwnerIfActive\(\)/);
  assert.match(lifecycle, /clearForegroundSession\(\)/);
});

test('native lifecycle purges dedicated plaintext previews at launch and termination', () => {
  const subscriber = read('ios/HermesIOSContextAppDelegateSubscriber.swift');
  const temporaryFiles = readFileSync(
    resolve(root, 'src/api/temporary-plaintext-files.ts'),
    'utf8',
  );
  assert.match(subscriber, /plaintextPreviewDirectory = "hermes-plaintext-previews-v1"/);
  assert.match(temporaryFiles, /PLAINTEXT_PREVIEW_DIRECTORY = 'hermes-plaintext-previews-v1'/);
  assert.match(subscriber, /subscriberDidRegister\(\)[\s\S]*purgePlaintextPreviewCache\(\)/);
  assert.match(subscriber, /applicationWillTerminate[\s\S]*purgePlaintextPreviewCache\(\)/);
  assert.match(subscriber, /FileManager\.default\.removeItem\(at: previewDirectory\)/);
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
