#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const root = resolve(valueAfter('--root') || '.');
const iosRoot = valueAfter('--ios');
const derivedData = valueAfter('--derived-data');

verifySource(root);
if (iosRoot) verifyPods(resolve(root, iosRoot));
if (derivedData) verifyCompiledObjects(resolve(derivedData));

console.log('Hermes iOS native context registration verified.');

function verifySource(projectRoot) {
  const moduleRoot = join(projectRoot, 'modules', 'hermes-ios-context');
  const config = parseJSON(join(moduleRoot, 'expo-module.config.json'));
  requireIncludes(config.apple?.modules, 'HermesIOSContextModule', 'Expo module registration');
  requireIncludes(config.apple?.modules, 'HermesStandardMapModule', 'Expo map module registration');
  requireIncludes(
    config.apple?.appDelegateSubscribers,
    'HermesIOSContextAppDelegateSubscriber',
    'app delegate subscriber registration',
  );

  const podspec = read(join(moduleRoot, 'ios', 'HermesIOSContext.podspec'));
  requireMatch(podspec, /s\.name\s*=\s*['"]HermesIOSContext['"]/, 'HermesIOSContext pod name');
  requireMatch(podspec, /s\.source_files\s*=\s*['"]\*\*\/\*\.\{h,m,mm,swift\}['"]/, 'Swift source discovery');
  requireMatch(
    podspec,
    /s\.dependency\s+['"]AMap3DMap-NO-IDFA['"],\s*['"]11\.2\.000['"]/,
    'pinned AMap iOS SDK dependency',
  );

  const nativeModule = read(join(moduleRoot, 'ios', 'HermesIOSContextModule.swift'));
  const attachmentVault = read(join(moduleRoot, 'ios', 'HermesAttachmentVault.swift'));
  const mapModule = read(join(moduleRoot, 'ios', 'HermesStandardMapModule.swift'));
  requireMatch(nativeModule, /Function\("getNativeViewContract"\)/, 'native view build contract');
  requireMatch(mapModule, /Name\("HermesStandardMap"\)/, 'standard map module name');
  requireMatch(mapModule, /Function\("getRegistrationContract"\)/, 'standard map runtime contract');
  requireMatch(mapModule, /View\(HermesStandardMapView\.self\)/, 'standard map default view definition');
  requireNoMatch(nativeModule, /View\(HermesStandardMapView\.self\)/, 'named map view in context module');
  requireMatch(nativeModule, /View\(HermesScreenTimeReportView\.self\)/, 'screen time view definition');
  requireMatch(nativeModule, /AsyncFunction\("encryptAttachment"\)/, 'attachment encryption bridge');
  requireMatch(nativeModule, /AsyncFunction\("decryptAttachmentForUpload"\)/, 'attachment decryption bridge');
  requireMatch(attachmentVault, /AES\.GCM\.seal/, 'AES-GCM attachment encryption');
  requireMatch(attachmentVault, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/, 'device-only attachment key');
  const mapView = read(join(moduleRoot, 'ios', 'HermesStandardMapView.swift'));
  const mapKitSurface = read(join(moduleRoot, 'ios', 'HermesMapKitSurface.swift'));
  const amapSurface = read(join(moduleRoot, 'ios', 'HermesAMapSurface.swift'));
  requireMatch(mapView, /HermesAmapIOSAPIKey/, 'AMap app-bound key lookup');
  requireMatch(mapView, /amapPrivacyConsentGranted/, 'AMap privacy consent gate');
  requireMatch(mapKitSurface, /MKStandardMapConfiguration/, 'MapKit fallback');
  requireMatch(amapSurface, /MAMapView\.updatePrivacyAgree\(\.didAgree\)/, 'AMap privacy API');
  requireMatch(amapSurface, /AMapCoordinateConvert\(coordinate, \.GPS\)/, 'WGS-84 to GCJ-02 conversion');
  read(join(moduleRoot, 'ios', 'HermesScreenTimeReportView.swift'));
  read(join(moduleRoot, 'ios', 'HermesPermissionCollectionGate.swift'));

  const bridge = read(join(moduleRoot, 'index.ts'));
  requireMatch(
    bridge,
    /requireOptionalNativeModule<[\s\S]*?>\([\s\S]*?'HermesStandardMap'/,
    'standard map native module lookup',
  );
  requireMatch(bridge, /NativeUnimoduleProxy\?\.viewManagersMetadata/, 'native view metadata gate');
  requireMatch(bridge, /getViewConfig/, 'Expo runtime view config gate');
  requireMatch(bridge, /requireNativeView<P>\(registeredModuleName\)/, 'default native map view');
  requireMatch(bridge, /getNativeViewContract/, 'old-build native view guard');

  const provider = read(join(projectRoot, 'src', 'context', 'IOSContextProvider.tsx'));
  requireMatch(provider, /await ensureIOSPermissions\(/, 'OS permission coordination');
  requireMatch(
    provider,
    /if \(canCollectIOSPermission\(authorization, 'location'\)\) \{\s*await HermesIOSContext\.startAdaptiveLocation\(\)/,
    'authorized location collector startup',
  );
  requireMatch(
    provider,
    /if \(canCollectIOSPermission\(authorization, 'motion'\)\) \{\s*await HermesIOSContext\.startMotionUpdates\(\)/,
    'authorized motion collector startup',
  );
  const locationService = read(join(moduleRoot, 'ios', 'HermesLocationService.swift'));
  requireMatch(locationService, /guard HermesPermissionCollectionGate\.shared\.isReadyForCurrentOwner/, 'native permission gate');
  requireMatch(locationService, /guard status == \.authorizedAlways/, 'native Always authorization gate');

  const controlsRoot = join(projectRoot, 'modules', 'hermes-ios-controls', 'ios');
  const controlsPodspec = read(join(controlsRoot, 'HermesIOSControls.podspec'));
  requireMatch(controlsPodspec, /s\.exclude_files[\s\S]*HermesSwiftUIAdminPages\.swift[\s\S]*HermesSwiftUIAutomationPages\.swift/, 'legacy fixture source exclusion');
  read(join(controlsRoot, 'HermesSwiftUIDocsPage.swift'));
}

function verifyPods(iosDirectory) {
  const lock = read(join(iosDirectory, 'Podfile.lock'));
  requireMatch(lock, /(?:^|\n)\s*- HermesIOSContext\b/, 'Podfile.lock HermesIOSContext entry');
  requireMatch(lock, /(?:^|\n)\s*- AMap3DMap-NO-IDFA \(11\.2\.000\)/, 'Podfile.lock AMap 11.2.000 entry');
  requireMatch(lock, /(?:^|\n)\s*- AMapFoundation-NO-IDFA\b/, 'Podfile.lock AMap foundation entry');

  const providers = findFiles(join(iosDirectory, 'Pods'), (path) => (
    basename(path) === 'ExpoModulesProvider.swift'
  ));
  if (!providers.length) fail('Generated ExpoModulesProvider.swift was not found after pod install.');
  const providerSource = providers.map(read).join('\n');
  requireMatch(providerSource, /HermesIOSContextModule\.self/, 'generated Expo module provider');
  requireMatch(providerSource, /HermesStandardMapModule\.self/, 'generated Expo map module provider');
  requireMatch(
    providerSource,
    /HermesIOSContextAppDelegateSubscriber\.self/,
    'generated Expo app delegate subscriber provider',
  );

  const podsProject = read(join(iosDirectory, 'Pods', 'Pods.xcodeproj', 'project.pbxproj'));
  requireMatch(podsProject, /HermesIOSContextModule\.swift/, 'Pods project native module source');
  requireMatch(podsProject, /HermesStandardMapModule\.swift/, 'Pods project map module source');
  requireMatch(podsProject, /HermesStandardMapView\.swift/, 'Pods project standard map source');
  requireMatch(podsProject, /HermesMapKitSurface\.swift/, 'Pods project MapKit fallback source');
  requireMatch(podsProject, /HermesAMapSurface\.swift/, 'Pods project AMap source');
  requireMatch(podsProject, /HermesScreenTimeReportView\.swift/, 'Pods project Screen Time view source');
  requireMatch(podsProject, /HermesAttachmentVault\.swift/, 'Pods project attachment vault source');
  requireMatch(
    podsProject,
    /HermesPermissionCollectionGate\.swift/,
    'Pods project permission collection gate source',
  );
  requireMatch(podsProject, /HermesSwiftUIDocsPage\.swift/, 'Pods project live documentation source');
  requireNoMatch(podsProject, /HermesSwiftUIAdminPages\.swift/, 'legacy native admin fixtures');
  requireNoMatch(podsProject, /HermesSwiftUIAutomationPages\.swift/, 'legacy native automation fixtures');
}

function verifyCompiledObjects(derivedRoot) {
  const intermediates = join(derivedRoot, 'Build', 'Intermediates.noindex');
  const buildDirectories = findDirectories(intermediates, (path) => (
    basename(path).startsWith('HermesIOSContext.build')
  ));
  if (!buildDirectories.length) fail('HermesIOSContext build intermediates were not produced.');
  const buildFiles = buildDirectories.flatMap((directory) => findFiles(directory, () => true));
  const mapViewEvidence = buildFiles.some((path) => /HermesStandardMapView\.(?:o|d|swiftdeps)$/i.test(path))
    || buildFiles.some((path) => {
      if (!/(?:output-file-map\.json|HermesIOSContext\.SwiftFileList)$/i.test(path)) return false;
      return read(path).includes('HermesStandardMapView.swift');
    });
  const mapModuleEvidence = buildFiles.some((path) => /HermesStandardMapModule\.(?:o|d|swiftdeps)$/i.test(path))
    || buildFiles.some((path) => {
      if (!/(?:output-file-map\.json|HermesIOSContext\.SwiftFileList)$/i.test(path)) return false;
      return read(path).includes('HermesStandardMapModule.swift');
    });
  const mapKitEvidence = sourceCompileEvidence(buildFiles, 'HermesMapKitSurface.swift');
  const amapEvidence = sourceCompileEvidence(buildFiles, 'HermesAMapSurface.swift');
  const attachmentVaultEvidence = sourceCompileEvidence(buildFiles, 'HermesAttachmentVault.swift');
  if (!mapViewEvidence || !mapModuleEvidence || !mapKitEvidence || !amapEvidence || !attachmentVaultEvidence) {
    fail('Xcode did not emit compile evidence for every Hermes native map and attachment source.');
  }
}

function sourceCompileEvidence(buildFiles, sourceName) {
  const stem = sourceName.replace(/\.swift$/i, '');
  return buildFiles.some((path) => new RegExp(`${stem}\\.(?:o|d|swiftdeps)$`, 'i').test(path))
    || buildFiles.some((path) => {
      if (!/(?:output-file-map\.json|HermesIOSContext\.SwiftFileList)$/i.test(path)) return false;
      return read(path).includes(sourceName);
    });
}

function findFiles(directory, predicate) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) result.push(...findFiles(path, predicate));
    else if (predicate(path)) result.push(path);
  }
  return result;
}

function findDirectories(directory, predicate) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (!statSync(path).isDirectory()) continue;
    if (predicate(path)) result.push(path);
    else result.push(...findDirectories(path, predicate));
  }
  return result;
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseJSON(path) {
  return JSON.parse(read(path));
}

function read(path) {
  if (!existsSync(path)) fail(`Required file is missing: ${path}`);
  return readFileSync(path, 'utf8');
}

function requireIncludes(value, expected, label) {
  if (!Array.isArray(value) || !value.includes(expected)) {
    fail(`${label} does not include ${expected}.`);
  }
}

function requireMatch(value, pattern, label) {
  if (!pattern.test(value)) fail(`${label} is missing.`);
}

function requireNoMatch(value, pattern, label) {
  if (pattern.test(value)) fail(`${label} must be absent.`);
}

function fail(message) {
  console.error(`native-context verification failed: ${message}`);
  process.exit(1);
}
