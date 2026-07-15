import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const exportDirectory = resolve(process.argv[2] ?? 'dist');
const provenance = JSON.parse(
  readFileSync(resolve(projectRoot, 'assets', 'fonts', 'PROVENANCE.json'), 'utf8'),
);
const metadata = JSON.parse(
  readFileSync(resolve(exportDirectory, 'metadata.json'), 'utf8'),
);
const exportedFontAssets = metadata.fileMetadata.ios.assets.filter(
  (asset) => asset.ext === 'ttf' || asset.ext === 'otf',
);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expectedHashes = new Set(provenance.faces.map((face) => face.outputSha256));
const exportedHashes = new Set(
  exportedFontAssets.map((asset) =>
    sha256(readFileSync(resolve(exportDirectory, asset.path))),
  ),
);

assert.equal(provenance.faces.length, 50);
assert.equal(expectedHashes.size, 50, 'font outputs must have unique hashes');
assert.equal(exportedFontAssets.length, 50, 'iOS export must contain 50 font assets');
assert.deepEqual(exportedHashes, expectedHashes);

console.log(`Verified ${exportedFontAssets.length} font assets in the iOS export`);
