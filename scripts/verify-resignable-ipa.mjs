#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, extname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [ipaArgument, ...arguments_] = process.argv.slice(2);
if (!ipaArgument) fail('usage: verify-resignable-ipa.mjs <ipa-path> [--bundle-id <main-bundle-id>]');

const ipaPath = resolve(ipaArgument);
if (!existsSync(ipaPath) || !lstatSync(ipaPath).isFile()) {
  fail(`IPA file is missing: ${ipaPath}`);
}

const expectedBundleId = optionValue(arguments_, '--bundle-id') || readDefaultBundleId();
if (!expectedBundleId) {
  fail('main bundle identifier is required; pass --bundle-id or run from the iOS repository');
}

const zipEntries = listZipEntries(ipaPath);
validateZipEntries(zipEntries);

const extractionRoot = mkdtempSync(join(tmpdir(), 'hermes-resignable-'));
try {
  runCommand('unzip', ['-qq', '-o', ipaPath, '-d', extractionRoot]);
  const payloadRoot = resolve(extractionRoot, 'Payload');
  if (!existsSync(payloadRoot) || !lstatSync(payloadRoot).isDirectory()) {
    fail('IPA does not contain a Payload directory');
  }

  rejectSymlinks(extractionRoot);
  const appRoots = readdirSync(payloadRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => resolve(payloadRoot, entry.name));
  if (appRoots.length !== 1) {
    fail(`IPA must contain exactly one root Payload/*.app (found ${appRoots.length})`);
  }

  rejectSigningArtifacts(payloadRoot);
  const codeBundles = findCodeBundles(appRoots[0]);
  const bundleRecords = codeBundles.map((bundlePath) => readBundleRecord(bundlePath, appRoots[0]));
  rejectEmbeddedCodeSignatures(bundleRecords, appRoots[0]);
  assertUniqueBundleIds(bundleRecords);
  assertExpectedBundles(bundleRecords, expectedBundleId);
  assertApplicationVersions(bundleRecords, expectedBundleId);

  const rootRecord = bundleRecords.find((record) => record.path === appRoots[0]);
  console.log(
    `Resignable IPA verified: ${basename(ipaPath)}; `
    + `${bundleRecords.length} code bundles; main ${rootRecord.bundleId}; `
    + 'no existing signatures or provisioning profiles.',
  );
  for (const record of bundleRecords) {
    console.log(`  ${record.packageType} ${record.bundleId} (${relative(extractionRoot, record.path)})`);
  }
} finally {
  rmSync(extractionRoot, { recursive: true, force: true });
}

function optionValue(values, option) {
  const index = values.indexOf(option);
  if (index < 0) return '';
  const value = values[index + 1];
  if (!value || value.startsWith('--')) fail(`${option} requires a value`);
  return value;
}

function readDefaultBundleId() {
  const configPath = resolve(process.cwd(), 'app.base.json');
  if (!existsSync(configPath)) return '';
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return String(config?.expo?.ios?.bundleIdentifier || '').trim();
  } catch (error) {
    fail(`could not read app.base.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function listZipEntries(path) {
  const result = runCommand('unzip', ['-Z1', path]);
  return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function validateZipEntries(entries) {
  if (!entries.length) fail('IPA archive is empty');
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    const segments = normalized.split('/');
    if (
      normalized.startsWith('/')
      || entry.includes('\\')
      || segments.includes('..')
      || !normalized.startsWith('Payload/')
    ) {
      fail(`IPA contains an unsafe or unexpected archive entry: ${entry}`);
    }
  }
  if (!entries.some((entry) => entry === 'Payload/' || entry.startsWith('Payload/'))) {
    fail('IPA archive does not contain Payload entries');
  }
}

function rejectSymlinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
      fail(`IPA contains a symbolic link; external signers must receive regular files: ${relative(directory, path)}`);
    }
    if (entry.isDirectory()) rejectSymlinks(path);
  }
}

function rejectSigningArtifacts(payloadRoot) {
  const forbiddenNames = new Set(['_CodeSignature', 'embedded.mobileprovision', 'CodeResources']);
  const pending = [payloadRoot];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (forbiddenNames.has(entry.name)) {
        fail(`unsigned IPA already contains signing output ${entry.name}: ${relative(payloadRoot, path)}`);
      }
      if (entry.isDirectory()) pending.push(path);
    }
  }
}

function findCodeBundles(rootApp) {
  const bundles = [];
  const pending = [rootApp];
  while (pending.length) {
    const directory = pending.pop();
    const extension = extname(directory).toLowerCase();
    if (['.app', '.appex', '.framework', '.xpc'].includes(extension)) bundles.push(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) pending.push(resolve(directory, entry.name));
    }
  }
  return bundles.sort((left, right) => left.localeCompare(right));
}

function readBundleRecord(bundlePath, rootApp) {
  const plistPath = resolve(bundlePath, 'Info.plist');
  if (!existsSync(plistPath) || !lstatSync(plistPath).isFile()) {
    fail(`code bundle is missing Info.plist: ${relative(rootApp, bundlePath)}`);
  }
  let plist;
  try {
    const output = runCommand('plutil', ['-convert', 'json', '-o', '-', '--', plistPath]);
    plist = JSON.parse(output.stdout);
  } catch (error) {
    fail(`could not parse Info.plist: ${relative(rootApp, bundlePath)}`);
  }
  const bundleId = String(plist.CFBundleIdentifier || '').trim();
  const packageType = String(plist.CFBundlePackageType || '').trim();
  const executable = String(plist.CFBundleExecutable || '').trim();
  if (!bundleId || !packageType || !executable) {
    fail(`code bundle has incomplete identity metadata: ${relative(rootApp, bundlePath)}`);
  }
  const executablePath = resolve(bundlePath, executable);
  const relativeExecutable = relative(bundlePath, executablePath);
  if (relativeExecutable.startsWith('..') || relativeExecutable.includes('\\') || !existsSync(executablePath)) {
    fail(`code bundle executable escapes or is missing: ${relative(rootApp, bundlePath)}`);
  }
  if (!lstatSync(executablePath).isFile()) {
    fail(`code bundle executable is not a regular file: ${relative(rootApp, bundlePath)}`);
  }
  if (
    (lstatSync(executablePath).mode & 0o111) === 0
    && !isStaticFrameworkArchive(packageType, executablePath)
  ) {
    fail(`code bundle executable is not marked executable: ${relative(rootApp, executablePath)}`);
  }
  return {
    path: bundlePath,
    executablePath,
    bundleId,
    packageType,
    executable,
    shortVersion: String(plist.CFBundleShortVersionString || ''),
    buildVersion: String(plist.CFBundleVersion || ''),
  };
}

function rejectEmbeddedCodeSignatures(records, rootApp) {
  for (const record of records) {
    const result = runCommand('otool', ['-l', record.executablePath], { allowFailure: true });
    if (result.status === 0 && /\bcmd LC_CODE_SIGNATURE\b/.test(result.stdout)) {
      fail(`code bundle executable still contains an embedded signature: ${relative(rootApp, record.executablePath)}`);
    }
  }
}

function isStaticFrameworkArchive(packageType, executablePath) {
  if (packageType !== 'FMWK') return false;
  const archiveMagic = readFileSync(executablePath).subarray(0, 8).toString('ascii');
  return archiveMagic === '!<arch>\n';
}

function assertUniqueBundleIds(records) {
  const seen = new Map();
  for (const record of records) {
    const previous = seen.get(record.bundleId);
    if (previous) {
      fail(`duplicate CFBundleIdentifier ${record.bundleId}: ${previous} and ${record.path}`);
    }
    seen.set(record.bundleId, record.path);
  }
}

function assertExpectedBundles(records, mainBundleId) {
  const expected = [
    mainBundleId,
    `${mainBundleId}.weather-widget`,
    `${mainBundleId}.device-activity-monitor`,
    `${mainBundleId}.device-activity-report`,
    `${mainBundleId}.file-provider`,
    `${mainBundleId}.share-extension`,
    `${mainBundleId}.watchapp`,
    `${mainBundleId}.watchapp.watchkitextension`,
  ];
  const actual = new Set(records.map((record) => record.bundleId));
  for (const bundleId of expected) {
    if (!actual.has(bundleId)) fail(`IPA is missing required code bundle ${bundleId}`);
  }
}

function assertApplicationVersions(records, mainBundleId) {
  const main = records.find((record) => record.bundleId === mainBundleId);
  if (!main?.buildVersion) fail('main app is missing CFBundleVersion');
  const appFamily = records.filter((record) => (
    record.bundleId === mainBundleId || record.bundleId.startsWith(`${mainBundleId}.`)
  ));
  for (const record of appFamily) {
    if (record.buildVersion !== main.buildVersion) {
      fail(`nested app build version mismatch for ${record.bundleId}: ${record.buildVersion} != ${main.buildVersion}`);
    }
  }
}

function runCommand(command, args, { allowFailure = false } = {}) {
  let result;
  try {
    result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    fail(`required command ${command} is unavailable; run this verifier on macOS with Xcode command-line tools`);
  }
  if (result.error) {
    fail(`required command ${command} is unavailable; run this verifier on macOS with Xcode command-line tools`);
  }
  if (result.status !== 0 && !allowFailure) {
    const details = String(result.stderr || result.stdout || '').trim().replace(/\s+/g, ' ');
    fail(`${command} failed${details ? `: ${details}` : ''}`);
  }
  return result;
}

function fail(message) {
  console.error(`resignable-ipa verification failed: ${message}`);
  process.exit(1);
}
