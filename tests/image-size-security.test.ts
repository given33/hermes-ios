import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

function metroPackageJson(): string {
  const pnpmRoot = resolve(process.cwd(), 'node_modules', '.pnpm');
  const metroDir = readdirSync(pnpmRoot).find((name) => name.startsWith('metro@'));
  assert.ok(metroDir, 'Metro must be installed for the production image parser');
  return join(pnpmRoot, metroDir, 'node_modules', 'metro', 'package.json');
}

test('patched image-size rejects a zero-length ICNS entry without hanging', () => {
  const packageJson = metroPackageJson();
  const script = `
    const { createRequire } = require('node:module');
    const imageSize = createRequire(${JSON.stringify(packageJson)})('image-size').imageSize;
    const input = Buffer.from([0x69, 0x63, 0x6e, 0x73, 0, 0, 0, 16, 0x69, 0x63, 0x30, 0x37, 0, 0, 0, 0]);
    try { imageSize(input); process.stdout.write('returned'); }
    catch { process.stdout.write('rejected'); }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 2000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || 'image-size child process failed');
  assert.equal(result.stdout, 'rejected');
});
