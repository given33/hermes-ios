#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const exportRoot = resolve(process.argv[2] || '');
if (!process.argv[2]) fail('usage: verify-production-bundle.mjs <expo-export-dir>');
const metadata = JSON.parse(readFileSync(resolve(exportRoot, 'metadata.json'), 'utf8'));
const relativeBundle = metadata?.fileMetadata?.ios?.bundle;
if (typeof relativeBundle !== 'string' || !relativeBundle) {
  fail('iOS bundle metadata is missing');
}
const bundle = readFileSync(resolve(exportRoot, relativeBundle));
const forbidden = [
  'Mapped the customized WebUI route ownership',
  'Deployment is healthy. The gateway is listening',
  'HMS-138',
  'HMS-142',
  'Complete frontend fixture routes',
  'Given iPhone 16 Pro',
  'Gateway deployment audit',
  'Research digest automation',
  'Workspace backup',
  'Tasks Completed',
  'native-ios',
  'HERMES AGENT  v0.9.3',
];
for (const marker of forbidden) {
  if (bundle.includes(Buffer.from(marker))) {
    fail(`preview fixture leaked into the production bundle: ${marker}`);
  }
}
for (const required of [
  '/single/conversations',
  'HermesStandardMap',
  'hermes.native.conversations.v3',
]) {
  if (!bundle.includes(Buffer.from(required))) {
    fail(`required production marker is missing: ${required}`);
  }
}
console.log('Hermes production bundle contains live sources and no preview records.');

function fail(message) {
  console.error(`production-bundle verification failed: ${message}`);
  process.exit(1);
}
