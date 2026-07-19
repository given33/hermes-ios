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
  requireIncludes(
    config.apple?.appDelegateSubscribers,
    'HermesIOSContextAppDelegateSubscriber',
    'app delegate subscriber registration',
  );

  const podspec = read(join(moduleRoot, 'ios', 'HermesIOSContext.podspec'));
  requireMatch(podspec, /s\.name\s*=\s*['"]HermesIOSContext['"]/, 'HermesIOSContext pod name');
  requireMatch(podspec, /s\.source_files\s*=\s*['"]\*\*\/\*\.\{h,m,mm,swift\}['"]/, 'Swift source discovery');

  const nativeModule = read(join(moduleRoot, 'ios', 'HermesIOSContextModule.swift'));
  requireMatch(nativeModule, /Function\("getNativeViewContract"\)/, 'native view build contract');
  requireMatch(nativeModule, /View\(HermesStandardMapView\.self\)/, 'standard map view definition');
  requireMatch(nativeModule, /View\(HermesScreenTimeReportView\.self\)/, 'screen time view definition');
  read(join(moduleRoot, 'ios', 'HermesStandardMapView.swift'));
  read(join(moduleRoot, 'ios', 'HermesScreenTimeReportView.swift'));
  read(join(moduleRoot, 'ios', 'HermesPermissionCollectionGate.swift'));

  const bridge = read(join(moduleRoot, 'index.ts'));
  requireMatch(
    bridge,
    /requireNativeView<P>\('HermesIOSContext', viewName\)/,
    'two-argument Expo requireNativeView contract',
  );
  requireMatch(bridge, /getNativeViewContract/, 'old-build native view guard');
}

function verifyPods(iosDirectory) {
  const lock = read(join(iosDirectory, 'Podfile.lock'));
  requireMatch(lock, /(?:^|\n)\s*- HermesIOSContext\b/, 'Podfile.lock HermesIOSContext entry');

  const providers = findFiles(join(iosDirectory, 'Pods'), (path) => (
    basename(path) === 'ExpoModulesProvider.swift'
  ));
  if (!providers.length) fail('Generated ExpoModulesProvider.swift was not found after pod install.');
  const providerSource = providers.map(read).join('\n');
  requireMatch(providerSource, /HermesIOSContextModule\.self/, 'generated Expo module provider');
  requireMatch(
    providerSource,
    /HermesIOSContextAppDelegateSubscriber\.self/,
    'generated Expo app delegate subscriber provider',
  );

  const podsProject = read(join(iosDirectory, 'Pods', 'Pods.xcodeproj', 'project.pbxproj'));
  requireMatch(podsProject, /HermesIOSContextModule\.swift/, 'Pods project native module source');
  requireMatch(podsProject, /HermesStandardMapView\.swift/, 'Pods project standard map source');
  requireMatch(podsProject, /HermesScreenTimeReportView\.swift/, 'Pods project Screen Time view source');
  requireMatch(
    podsProject,
    /HermesPermissionCollectionGate\.swift/,
    'Pods project permission collection gate source',
  );
}

function verifyCompiledObjects(derivedRoot) {
  const intermediates = join(derivedRoot, 'Build', 'Intermediates.noindex');
  const buildDirectories = findDirectories(intermediates, (path) => (
    basename(path).startsWith('HermesIOSContext.build')
  ));
  if (!buildDirectories.length) fail('HermesIOSContext build intermediates were not produced.');
  const buildFiles = buildDirectories.flatMap((directory) => findFiles(directory, () => true));
  const evidence = buildFiles.some((path) => /HermesStandardMapView\.(?:o|d|swiftdeps)$/i.test(path))
    || buildFiles.some((path) => {
      if (!/(?:output-file-map\.json|HermesIOSContext\.SwiftFileList)$/i.test(path)) return false;
      return read(path).includes('HermesStandardMapView.swift');
    });
  if (!evidence) {
    fail('Xcode did not emit compile evidence for HermesStandardMapView.swift.');
  }
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

function fail(message) {
  console.error(`native-context verification failed: ${message}`);
  process.exit(1);
}
