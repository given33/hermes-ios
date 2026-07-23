#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';

import { verifyProductionBuffers } from './production-artifact-contract.mjs';

const appRoot = resolve(process.argv[2] || '');
if (!process.argv[2]) fail('usage: verify-production-app.mjs <compiled-app-dir>');
if (!existsSync(appRoot) || !lstatSync(appRoot).isDirectory()) {
  fail('compiled app directory is missing');
}
if (!existsSync(resolve(appRoot, 'Info.plist'))) fail('compiled app Info.plist is missing');

const files = findFiles(appRoot);
const forbiddenStores = files.filter((path) => (
  /\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?$/i.test(path)
  || /(?:^|[\\/])(?:Documents|Library)[\\/]/i.test(path)
));
if (forbiddenStores.length) {
  fail(`preloaded local data store found in app bundle: ${relative(appRoot, forbiddenStores[0])}`);
}

verifyProductionBuffers(readEntries(files), fail, {
  allowedSecrets: [process.env.HERMES_AMAP_IOS_API_KEY],
});

console.log(`Hermes compiled app is production-clean (${files.length} files scanned).`);

function findFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
      fail(`symbolic link found in compiled app: ${relative(appRoot, path)}`);
    }
    if (entry.isDirectory()) result.push(...findFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function* readEntries(files) {
  for (const path of files) {
    yield {
      bytes: readFileSync(path),
      name: relative(appRoot, path),
    };
  }
}

function fail(message) {
  console.error(`production-app verification failed: ${message}`);
  process.exit(1);
}
