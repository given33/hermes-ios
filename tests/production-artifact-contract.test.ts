import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const verifier = resolve(projectRoot, 'scripts/verify-production-bundle.mjs');
const requiredMarkers = [
  '/single/conversations',
  'HermesStandardMap',
  'hermes.native.conversations.v3',
].join('\n');

function verifyBundle(extraContent: string) {
  const root = mkdtempSync(join(tmpdir(), 'hermes-production-contract-'));
  try {
    mkdirSync(join(root, '_expo', 'static', 'js', 'ios'), { recursive: true });
    const bundle = '_expo/static/js/ios/index.js';
    writeFileSync(
      join(root, 'metadata.json'),
      JSON.stringify({ fileMetadata: { ios: { bundle } } }),
    );
    writeFileSync(join(root, bundle), `${requiredMarkers}\n${extraContent}\n`);
    return spawnSync(process.execPath, [verifier, root], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a PEM parser marker in a compiled dependency is not treated as a private key', () => {
  const result = verifyBundle('-----BEGIN PRIVATE KEY-----');
  assert.equal(result.status, 0, result.stderr);
});

test('a complete embedded PEM private key remains blocked from production', () => {
  const result = verifyBundle([
    '-----BEGIN PRIVATE KEY-----',
    'A'.repeat(160),
    '-----END PRIVATE KEY-----',
  ].join('\n'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private key leaked into production artifact/);
});
