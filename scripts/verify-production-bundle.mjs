#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { verifyProductionBuffers } from './production-artifact-contract.mjs';

const exportRoot = resolve(process.argv[2] || '');
if (!process.argv[2]) fail('usage: verify-production-bundle.mjs <expo-export-dir>');
const metadata = JSON.parse(readFileSync(resolve(exportRoot, 'metadata.json'), 'utf8'));
const relativeBundle = metadata?.fileMetadata?.ios?.bundle;
if (typeof relativeBundle !== 'string' || !relativeBundle) {
  fail('iOS bundle metadata is missing');
}
if (isAbsolute(relativeBundle)) fail('iOS bundle metadata contains an absolute path');
const bundlePath = resolve(exportRoot, relativeBundle);
const relativePath = relative(exportRoot, bundlePath);
if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
  fail('iOS bundle metadata escapes the export directory');
}
const files = findFiles(exportRoot);
if (!files.includes(bundlePath)) fail('iOS bundle metadata points to a missing export file');
verifyProductionBuffers(readEntries(files), fail, {
  allowedSecrets: [process.env.HERMES_AMAP_IOS_API_KEY],
});
console.log('Hermes production bundle contains live sources and no preview records.');

function findFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
      fail(`symbolic link found in production export: ${relative(exportRoot, path)}`);
    }
    if (entry.isDirectory()) result.push(...findFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function* readEntries(files) {
  for (const path of files) {
    yield { bytes: readFileSync(path), name: relative(exportRoot, path) };
  }
}

function fail(message) {
  console.error(`production-bundle verification failed: ${message}`);
  process.exit(1);
}
