import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => readFileSync(resolve(projectRoot, relativePath), 'utf8');

test('native extension config declares every V4 companion target', () => {
  const plugin = read('plugins/with-hermes-native-extensions.js');
  for (const target of [
    'HermesWeatherWidget',
    'HermesWatchApp',
    'HermesWatchExtension',
    'HermesDeviceActivityMonitor',
    'HermesDeviceActivityReport',
  ]) {
  assert.match(plugin, new RegExp(target));
  }
  assert.match(plugin, /objects\.PBXContainerItemProxy \?\?= \{\}/);
  assert.match(plugin, /objects\.PBXTargetDependency \?\?= \{\}/);
  assert.match(plugin, /ensureTargetDependency/);
  assert.match(plugin, /withDangerousMod/);
  assert.match(plugin, /cpSync\(source, destination, \{ recursive: true \}\)/);
  assert.match(plugin, /addPbxGroup\(sourcePaths, name, '\.'\)/);
  assert.match(plugin, /\$\(SRCROOT\)\/native-extensions/);
  assert.doesNotMatch(plugin, /\$\(SRCROOT\)\/\.\.\/native-extensions/);
  assert.match(plugin, /config\.ios\?\.buildNumber/);
  assert.match(plugin, /settings\.CURRENT_PROJECT_VERSION = buildNumber/);
  assert.match(plugin, /settings\.MARKETING_VERSION = version/);
  assert.doesNotMatch(plugin, /const BUILD_NUMBER/);
  const workflow = read('.github/workflows/ios-unsigned.yml');
  assert.match(workflow, /Verify native extension targets/);
  assert.match(workflow, /isa = PBXTargetDependency/);
  assert.match(workflow, /EXTENSION_PATH="\$APP_PATH\/PlugIns\/\$extension\.appex"/);
  assert.match(workflow, /Watch\/HermesWatchApp\.app/);
  assert.match(workflow, /PlugIns\/HermesWatchExtension\.appex/);
  assert.match(workflow, /-destination 'generic\/platform=iOS'/);
  assert.match(workflow, /-destination 'generic\/platform=iOS Simulator'/);
  assert.doesNotMatch(workflow, /-sdk iphoneos/);
  assert.match(workflow, /Verify Release entitlement build settings/);
  assert.match(workflow, /CODE_SIGN_ENTITLEMENTS = /);
  assert.match(workflow, /com\.apple\.developer\.family-controls/);
  assert.match(workflow, /expo export --platform ios --output-dir/);
  assert.match(workflow, /verify-native-font-export\.mjs/);
  assert.match(workflow, /verify-production-bundle\.mjs/);
  assert.match(workflow, /APP_BUILD_NUMBER=/);
  assert.match(workflow, /ARTIFACT_NAME="Hermes-Agent-build-\$\{APP_BUILD_NUMBER\}-\$\{SHORT_SHA\}"/);
  assert.match(workflow, /Hermes-Agent-build\.json/);
  assert.match(workflow, /"frontend_preview":%s/);
  assert.match(workflow, /"manifest_sha256":"%s"/);
  assert.match(workflow, /name: \$\{\{ steps\.package\.outputs\.artifact_name \}\}/);
  assert.match(workflow, /verify_bundle_version "\$EXTENSION_PATH"/);
  assert.match(workflow, /verify_bundle_version "\$WATCH_APP"/);
  assert.match(workflow, /verify_bundle_version "\$WATCH_EXTENSION"/);
});

test('signed native controls exclude legacy fixture-only Swift pages', () => {
  const podspec = read('modules/hermes-ios-controls/ios/HermesIOSControls.podspec');
  const docs = read('modules/hermes-ios-controls/ios/HermesSwiftUIDocsPage.swift');
  const verifier = read('scripts/verify-ios-native-context.mjs');

  assert.match(podspec, /s\.exclude_files[\s\S]*HermesSwiftUIAdminPages\.swift[\s\S]*HermesSwiftUIAutomationPages\.swift/);
  assert.match(docs, /struct HermesDocsPage: View/);
  assert.doesNotMatch(docs, /Tasks Completed.*128|Workspace backup|native-ios/);
  assert.match(verifier, /legacy fixture source exclusion/);
  assert.match(verifier, /legacy native admin fixtures/);
});

test('WidgetKit, WatchConnectivity, and DeviceActivity sources are buildable inputs', () => {
  for (const plist of [
    'native-extensions/HermesWeatherWidget/Info.plist',
    'native-extensions/HermesDeviceActivityMonitor/Info.plist',
    'native-extensions/HermesDeviceActivityReport/Info.plist',
    'native-extensions/HermesWatchApp/Info.plist',
    'native-extensions/HermesWatchApp/Extension-Info.plist',
  ]) {
    const source = read(plist);
    for (const key of [
      'CFBundleExecutable',
      'CFBundleIdentifier',
      'CFBundlePackageType',
      'CFBundleShortVersionString',
      'CFBundleVersion',
    ]) assert.match(source, new RegExp(`<key>${key}</key>`), `${plist} declares ${key}`);
  }
  const widget = read('native-extensions/HermesWeatherWidget/HermesWeatherWidget.swift');
  assert.match(widget, /ActivityConfiguration/);
  assert.match(widget, /DynamicIsland/);
  assert.ok(existsSync(resolve(projectRoot, 'native-extensions/HermesWeatherWidget/Info.plist')));

  const watch = read('native-extensions/HermesWatchApp/HermesWatchApp.swift');
  assert.match(watch, /WCSession/);
  assert.match(watch, /CLLocationManager/);
  assert.match(watch, /HKStatisticsQuery/);
  assert.match(watch, /HKWorkoutSession/);
  assert.match(watch, /replyHandler\(\["accepted": self\.handle\(message\)\]\)/);
  assert.match(watch, /HKLiveWorkoutBuilder/);
  assert.match(watch, /type as\? HKQuantityType/);
  assert.doesNotMatch(watch, /pausesLocationUpdatesAutomatically/);
  assert.match(watch, /CMMotionActivityManager/);
  assert.match(watch, /allowsBackgroundLocationUpdates = true/);
  assert.match(watch, /didReceiveUserInfo/);
  assert.match(watch, /didReceiveApplicationContext/);
  assert.match(watch, /start-active-relay/);
  assert.match(watch, /startNavigationRelay/);
  assert.match(watch, /HermesWatchAccountFence/);
  assert.match(watch, /send\(next, fence: fence\)/);
  assert.match(watch, /event\["eventID"\]/);
  assert.match(watch, /request-account-handshake/);
  assert.match(watch, /requestAuthorization\(toShare: share, read: read\)/);
  assert.ok(existsSync(resolve(projectRoot, 'native-extensions/HermesWatchApp/Extension-Info.plist')));
  const watchInfo = read('native-extensions/HermesWatchApp/Extension-Info.plist');
  assert.match(watchInfo, /<string>location<\/string>/);
  assert.match(watchInfo, /workout-processing/);

  const monitor = read('native-extensions/HermesDeviceActivityMonitor/HermesDeviceActivityMonitor.swift');
  assert.match(monitor, /DeviceActivityMonitor/);
  assert.match(read('native-extensions/HermesDeviceActivityMonitor/Info.plist'), /monitor-extension/);

  const report = read('native-extensions/HermesDeviceActivityReport/HermesDeviceActivityReport.swift');
  assert.match(report, /DeviceActivityReportScene/);
  assert.match(report, /segment\.totalActivityDuration/);
  assert.match(report, /let generation = HermesScreenTimeSpool\.captureGeneration\(\)/);
  assert.ok(
    report.indexOf('let generation = HermesScreenTimeSpool.captureGeneration()')
      < report.indexOf('for await item in data'),
    'report captures generation before its asynchronous DeviceActivity traversal',
  );
  assert.match(report, /HermesScreenTimeSpool\.append/);
  assert.match(read('native-extensions/HermesDeviceActivityReport/Info.plist'), /report-extension/);

  const spool = read('native-extensions/HermesScreenTimeSpool.swift');
  assert.match(spool, /HermesSharedKeychainAccessGroup/);
  assert.match(spool, /kSecAttrAccessGroup as String: accessGroup/);
  assert.match(spool, /AES\.GCM\.seal/);
  assert.match(spool, /Darwin\.flock/);
  assert.match(spool, /"checksum": checksum/);
  assert.match(spool, /"sequence": sequence/);
  assert.match(spool, /\.chunk/);
  assert.doesNotMatch(spool, /SecItemAdd/);
  assert.doesNotMatch(monitor, /suffix\(500\)/);
  assert.match(read('plugins/with-hermes-native-extensions.js'), /sharedSources: \['HermesScreenTimeSpool\.swift'\]/);
  for (const target of ['HermesDeviceActivityMonitor', 'HermesDeviceActivityReport']) {
    const entitlements = read(`native-extensions/${target}/${target}.entitlements`);
    const info = read(`native-extensions/${target}/Info.plist`);
    assert.match(entitlements, /<key>keychain-access-groups<\/key>[\s\S]*\$\(AppIdentifierPrefix\)app\.sunstone1029\.fig1171\.hermes\.shared/);
    assert.match(entitlements, /<key>com\.apple\.security\.application-groups<\/key>[\s\S]*group\.app\.sunstone1029\.fig1171\.hermes/);
    assert.match(info, /<key>HermesSharedKeychainAccessGroup<\/key>[\s\S]*\$\(AppIdentifierPrefix\)app\.sunstone1029\.fig1171\.hermes\.shared/);
  }
  const workflow = read('.github/workflows/ios-unsigned.yml');
  assert.match(workflow, /import plistlib/);
  assert.match(workflow, /"keychain-access-groups": \[shared_keychain_group\]/);
  assert.match(workflow, /"com\.apple\.developer\.family-controls": True/);
  assert.match(
    workflow,
    /verify_contains 'HermesScreenTimeSpool\.swift' 'shared Screen Time spool source'/,
  );
});

test('native context absorbs DeviceActivity extension events', () => {
  const service = read('modules/hermes-ios-context/ios/HermesScreenTimeService.swift');
  const spool = read('modules/hermes-ios-context/ios/HermesScreenTimeSpool.swift');
  const module = read('modules/hermes-ios-context/ios/HermesIOSContextModule.swift');
  assert.match(service, /consumeExtensionEvents/);
  assert.match(service, /result\["consumedEvents"\] = 0/);
  assert.match(service, /group\.app\.sunstone1029\.fig1171\.hermes/);
  assert.match(service, /device-activity-summary-latest/);
  assert.match(service, /Self\.generation\(of: \$0\.payload\)/);
  assert.match(service, /setAccountGeneration/);
  // The host provisions the App Group Keychain key before monitoring can arm
  // and is the only side that opens envelopes; plaintext dictionaries from
  // pre-encryption extension builds drain once through the same decode path.
  assert.match(service, /HermesScreenTimeCrypto\.open/);
  assert.match(service, /HermesScreenTimeCrypto\.provisionKey\(\)/);
  assert.match(service, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  assert.match(service, /HermesSharedKeychainAccessGroup/);
  assert.match(service, /updateSnapshotCache/);
  assert.match(spool, /HermesScreenTimeCrypto\.open\(combined\)/);
  assert.match(spool, /checksum == digest\(combined\)/);
  assert.match(spool, /static func acknowledge/);
  assert.match(spool, /appendingPathComponent\("ack"\)/);
  assert.match(spool, /static func purgeAll/);
  assert.match(module, /getScreenTimeSnapshot/);
  assert.match(module, /View\(HermesScreenTimeReportView\.self\)/);
  const provider = read('src/context/IOSContextProvider.tsx');
  assert.match(provider, /getScreenTimeSnapshot/);
  assert.doesNotMatch(provider, /snapshotEvent\('screen-time'/);
  assert.match(provider, /<HermesScreenTimeReportView/);
  assert.match(read('modules/hermes-ios-context/ios/HermesScreenTimeReportView.swift'), /DeviceActivityReport\(\.hermesSummary/);
});

test('Watch location and motion are projected into the shared behavior timeline', () => {
  const relay = read('modules/hermes-ios-context/ios/HermesWatchService.swift');
  assert.match(relay, /case "watch-location"/);
  assert.match(relay, /kind: "location"/);
  assert.match(relay, /case "watch-motion"/);
  assert.match(relay, /kind: "motion"/);
  assert.match(relay, /"source_device_id": sourceDeviceID/);
  assert.match(relay, /token\.accountUUID/);
  assert.match(relay, /token\.accepts\(occurredAt\)/);
  assert.match(relay, /normalizedEventID\(message\["eventID"\]\)/);
  assert.match(relay, /enqueueBatch\(events\)/);
  assert.ok(
    relay.indexOf('enqueueBatch(events)')
      < relay.indexOf('UserDefaults.standard.set(persistedAt, forKey: lastMessageAtKey)'),
    'lastMessageAt advances only after the complete Watch batch is durable',
  );
  assert.match(relay, /"action": "watch-event-ack"/);
  assert.match(relay, /date\.timeIntervalSinceNow <= 60/);
});

test('smart weather place rows expose arrival, departure, and dwell duration', () => {
  const page = read('src/context/SmartWeatherPage.tsx');
  const map = read('modules/hermes-ios-context/ios/HermesStandardMapView.swift');
  assert.match(page, /Stayed|停留/);
  assert.match(page, /Math\.round\(elapsed \/ 60_000\)/);
  assert.match(map, /timeFormatter\.string\(from: start\)[\s\S]*timeFormatter\.string\(from: end\)/);
  assert.match(map, /timeIntervalSince\(start\)/);
});
