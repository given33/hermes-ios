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
const runtimeSupplementPaths = [
  '300Light/SpaceGrotesk_300Light.ttf',
  '400Regular/SpaceGrotesk_400Regular.ttf',
  '500Medium/SpaceGrotesk_500Medium.ttf',
  '600SemiBold/SpaceGrotesk_600SemiBold.ttf',
  '700Bold/SpaceGrotesk_700Bold.ttf',
].map((path) => resolve(
  projectRoot,
  'node_modules',
  '@expo-google-fonts',
  'space-grotesk',
  path,
));
const runtimeSupplementHashes = new Set(
  runtimeSupplementPaths.map((path) => sha256(readFileSync(path))),
);
const expectedExportHashes = new Set([
  ...expectedHashes,
  ...runtimeSupplementHashes,
]);
const exportedHashes = new Set(
  exportedFontAssets.map((asset) =>
    sha256(readFileSync(resolve(exportDirectory, asset.path))),
  ),
);

assert.equal(provenance.faces.length, 50);
assert.equal(expectedHashes.size, 50, 'font outputs must have unique hashes');
assert.equal(runtimeSupplementHashes.size, 5, 'Space Grotesk assets must have unique hashes');
assert.equal(
  exportedFontAssets.length,
  expectedExportHashes.size,
  'iOS export must contain only the tracked catalog and runtime supplement fonts',
);
assert.deepEqual(exportedHashes, expectedExportHashes);

console.log(
  `Verified ${expectedHashes.size} tracked and ${runtimeSupplementHashes.size} runtime font assets`,
);
