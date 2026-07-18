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
  const workflow = read('.github/workflows/ios-unsigned.yml');
  assert.match(workflow, /Verify native extension targets/);
  assert.match(workflow, /isa = PBXTargetDependency/);
  assert.match(workflow, /EXTENSION_PATH="\$APP_PATH\/PlugIns\/\$extension\.appex"/);
  assert.match(workflow, /Watch\/HermesWatchApp\.app/);
  assert.match(workflow, /PlugIns\/HermesWatchExtension\.appex/);
  assert.match(workflow, /-destination 'generic\/platform=iOS'/);
  assert.doesNotMatch(workflow, /-sdk iphoneos/);
  assert.match(workflow, /expo export --platform ios --output-dir/);
  assert.match(workflow, /verify-native-font-export\.mjs/);
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
  assert.match(watch, /replyHandler\(\["accepted": true\]\)/);
  assert.match(watch, /HKLiveWorkoutBuilder/);
  assert.match(watch, /CMMotionActivityManager/);
  assert.match(watch, /allowsBackgroundLocationUpdates = true/);
  assert.match(watch, /didReceiveUserInfo/);
  assert.match(watch, /start-active-relay/);
  assert.match(watch, /requestAuthorization\(toShare: share, read: read\)/);
  assert.ok(existsSync(resolve(projectRoot, 'native-extensions/HermesWatchApp/Extension-Info.plist')));
  assert.match(read('native-extensions/HermesWatchApp/Extension-Info.plist'), /workout-processing/);

  const monitor = read('native-extensions/HermesDeviceActivityMonitor/HermesDeviceActivityMonitor.swift');
  assert.match(monitor, /DeviceActivityMonitor/);
  assert.match(read('native-extensions/HermesDeviceActivityMonitor/Info.plist'), /monitor-extension/);

  const report = read('native-extensions/HermesDeviceActivityReport/HermesDeviceActivityReport.swift');
  assert.match(report, /DeviceActivityReportScene/);
  assert.match(report, /segment\.totalActivityDuration/);
  assert.match(report, /device-activity-summary-latest/);
  assert.match(report, /accountGenerationKey/);
  assert.match(report, /let accountGeneration = suite\?\.integer/);
  assert.match(read('native-extensions/HermesDeviceActivityReport/Info.plist'), /report-extension/);
});

test('native context absorbs DeviceActivity extension events', () => {
  const service = read('modules/hermes-ios-context/ios/HermesScreenTimeService.swift');
  const module = read('modules/hermes-ios-context/ios/HermesIOSContextModule.swift');
  assert.match(service, /consumeExtensionEvents/);
  assert.match(service, /result\["consumedEvents"\] = consumeExtensionEvents\(\)/);
  assert.match(service, /group\.app\.sunstone1029\.fig1171\.hermes/);
  assert.match(service, /device-activity-summary-latest/);
  assert.match(service, /Self\.generation\(of: \$0\)/);
  assert.match(service, /setAccountGeneration/);
  assert.match(module, /getScreenTimeSnapshot/);
  assert.match(module, /View\(HermesScreenTimeReportView\.self\)/);
  const provider = read('src/context/IOSContextProvider.tsx');
  assert.match(provider, /getScreenTimeSnapshot/);
  assert.match(provider, /<HermesScreenTimeReportView/);
  assert.match(read('modules/hermes-ios-context/ios/HermesScreenTimeReportView.swift'), /DeviceActivityReport\(\.hermesSummary/);
});

test('Watch location and motion are projected into the shared behavior timeline', () => {
  const relay = read('modules/hermes-ios-context/ios/HermesWatchService.swift');
  assert.match(relay, /case "watch-location"/);
  assert.match(relay, /type: "location"/);
  assert.match(relay, /case "watch-motion"/);
  assert.match(relay, /type: "motion"/);
  assert.match(relay, /sourceDeviceID: sourceDeviceID/);
  assert.match(relay, /accountGeneration/);
  assert.match(relay, /occurredAt\.timeIntervalSince1970 \* 1000 > defaults\.double/);
});

test('smart weather place rows expose arrival, departure, and dwell duration', () => {
  const page = read('src/context/SmartWeatherPage.tsx');
  const map = read('modules/hermes-ios-context/ios/HermesStandardMapView.swift');
  assert.match(page, /Stayed|停留/);
  assert.match(page, /Math\.round\(elapsed \/ 60_000\)/);
  assert.match(map, /rangeText\(start: start, end: end\)/);
  assert.match(map, /timeIntervalSince\(start\)/);
});
