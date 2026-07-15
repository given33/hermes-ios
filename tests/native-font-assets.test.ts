import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FONT_CHOICES,
  THEME_NAMED_FONT_REQUIREMENTS,
} from '../src/design/font-catalog';
import { BUILTIN_THEMES } from '../src/design/theme-presets';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface GoogleFamilySource {
  family: string;
  slug: string;
  cssUrl: string;
  weights: number[];
  styles: string[];
}

interface TrackedFontSource {
  cssFamily: string;
  weight: number;
  style: string;
  runtimeFamily: string;
  sourceFile: string;
  sourceSha256: string;
  outputFile: string;
  outputSha256?: string;
  metadataWeight?: number;
  metadataStyle?: string;
  metadataSubfamily?: string;
}

interface FontSourceManifest {
  schemaVersion: number;
  canonicalCommit: string;
  googleCssUserAgent: string;
  trackedWebUi: TrackedFontSource[];
  googleFamilies: GoogleFamilySource[];
  trackedTerminal: TrackedFontSource[];
  googleLicense: {
    id: string;
    urlTemplate: string;
    outputTemplate: string;
  };
  terminalLicense: {
    id: string;
    url: string;
    outputFile: string;
  };
}

const sources = JSON.parse(
  readFileSync(resolve(projectRoot, 'scripts', 'font-sources.json'), 'utf8'),
) as FontSourceManifest;

const expectedGoogleWeights = new Map<string, number[]>([
  ['Inter', [400, 500, 600, 700]],
  ['IBM Plex Sans', [400, 500, 600, 700]],
  ['Work Sans', [400, 500, 600, 700]],
  ['Atkinson Hyperlegible', [400, 700]],
  ['DM Sans', [400, 500, 600, 700]],
  ['Spectral', [400, 500, 600, 700]],
  ['Fraunces', [400, 500, 600]],
  ['Source Serif 4', [400, 500, 600, 700]],
  ['JetBrains Mono', [400, 500, 700]],
  ['IBM Plex Mono', [400, 500, 700]],
  ['Space Mono', [400, 700]],
  ['Share Tech Mono', [400]],
  ['DM Mono', [400, 500]],
]);

function primaryFamily(stack: string): string | undefined {
  return /^"([^"]+)"/.exec(stack)?.[1];
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test('font source manifest freezes 7 UI, 40 Google, and 3 terminal faces', () => {
  assert.equal(sources.schemaVersion, 1);
  assert.equal(
    sources.canonicalCommit,
    '4272ccd44651b679ce57f4c516b831644926fb03',
  );
  assert.equal(sources.googleCssUserAgent, 'Mozilla/5.0');
  assert.equal(sources.trackedWebUi.length, 7);
  assert.equal(sources.trackedTerminal.length, 3);
  assert.equal(sources.googleLicense.id, 'OFL-1.1');
  assert.equal(sources.terminalLicense.id, 'OFL-1.1');
  assert.match(sources.terminalLicense.url, /JetBrainsMono.+OFL\.txt$/);
  assert.deepEqual(
    new Map(
      sources.googleFamilies.map((family) => [family.family, family.weights]),
    ),
    expectedGoogleWeights,
  );
  assert.equal(
    sources.googleFamilies.reduce(
      (count, family) => count + family.weights.length * family.styles.length,
      0,
    ),
    40,
  );
  for (const source of [
    ...sources.trackedWebUi,
    ...sources.trackedTerminal,
  ]) {
    assert.match(source.sourceSha256, /^[a-f0-9]{64}$/);
  }
});

test('source CSS URLs exactly match the picker and combined theme declarations', () => {
  for (const choice of FONT_CHOICES.filter((choice) => choice.fontUrl)) {
    const family = primaryFamily(choice.stack);
    const source = sources.googleFamilies.find(
      (candidate) => candidate.family === family,
    );
    assert.ok(source, `${family} must have a Google source declaration`);
    assert.equal(source.cssUrl, choice.fontUrl);
  }
  assert.equal(
    sources.googleFamilies.find(
      (source) => source.family === 'Share Tech Mono',
    )?.cssUrl,
    BUILTIN_THEMES.cyberpunk.typography.fontUrl,
  );
  assert.equal(
    sources.googleFamilies.find((source) => source.family === 'DM Mono')
      ?.cssUrl,
    BUILTIN_THEMES.rose.typography.fontUrl,
  );
});

test('generated native catalog gives every face a unique runtime family', async () => {
  const { NATIVE_FONT_FACES } = await import(
    '../src/design/native-font-faces'
  );

  assert.equal(NATIVE_FONT_FACES.length, 50);
  assert.equal(
    new Set(NATIVE_FONT_FACES.map((face) => face.runtimeFamily)).size,
    50,
  );
  assert.equal(
    new Set(NATIVE_FONT_FACES.map((face) => face.assetFile)).size,
    50,
  );
  assert.deepEqual(
    Object.fromEntries(
      ['tracked-ui', 'google', 'tracked-terminal'].map((source) => [
        source,
        NATIVE_FONT_FACES.filter((face) => face.source === source).length,
      ]),
    ),
    { 'tracked-ui': 7, google: 40, 'tracked-terminal': 3 },
  );
});

test('pure resolver separates Google theme faces from tracked terminal faces', async () => {
  const { resolveNativeFontFamily } = await import(
    '../src/design/native-font-faces'
  );

  const googleRegular = resolveNativeFontFamily(
    'JetBrains Mono',
    400,
    'normal',
    'google',
  );
  const terminalRegular = resolveNativeFontFamily(
    'JetBrains Mono',
    400,
    'normal',
    'tracked-terminal',
  );
  assert.equal(googleRegular, 'HermesGoogle-JetBrainsMono-400-Normal');
  assert.equal(
    terminalRegular,
    'HermesTerminal-JetBrainsMono-400-Normal',
  );
  assert.notEqual(googleRegular, terminalRegular);
  assert.equal(
    resolveNativeFontFamily(
      'JetBrains Mono',
      400,
      'italic',
      'tracked-terminal',
    ),
    'HermesTerminal-JetBrainsMono-400-Italic',
  );
  assert.equal(
    resolveNativeFontFamily('Inter', 900, 'normal', 'google'),
    undefined,
  );
});

test('native CSS stacks select bundled faces before exact iOS fallbacks', async () => {
  const { resolveNativeFontStack } = await import(
    '../src/design/native-font-faces'
  );
  assert.equal(
    resolveNativeFontStack('"JetBrains Mono", ui-monospace, monospace', 700),
    'HermesGoogle-JetBrainsMono-700-Normal',
  );
  assert.equal(
    resolveNativeFontStack('"DM Mono", ui-monospace, monospace', 700),
    'HermesGoogle-DMMono-500-Normal',
  );
  assert.equal(
    resolveNativeFontStack('ui-monospace, "SF Mono", Menlo, monospace', 700),
    'Menlo',
  );
  assert.equal(
    resolveNativeFontStack('system-ui, -apple-system, sans-serif', 400),
    undefined,
  );
});

test('every non-system picker and theme-only named face resolves natively', async () => {
  const { resolveNativeFontFamily } = await import(
    '../src/design/native-font-faces'
  );

  for (const choice of FONT_CHOICES.filter((choice) => choice.fontUrl)) {
    const family = primaryFamily(choice.stack);
    assert.ok(family, `${choice.id} must declare a primary CSS family`);
    for (const weight of expectedGoogleWeights.get(family) ?? []) {
      assert.ok(
        resolveNativeFontFamily(family, weight, 'normal', 'google'),
        `${family} ${weight} normal must resolve`,
      );
    }
  }

  for (const requirement of THEME_NAMED_FONT_REQUIREMENTS) {
    for (const style of requirement.styles) {
      for (const weight of requirement.weights) {
        assert.ok(
          resolveNativeFontFamily(
            requirement.family,
            weight,
            style as 'normal' | 'italic',
            'google',
          ),
          `${requirement.family} ${weight} ${style} must resolve`,
        );
      }
    }
  }
});

test('provenance pins every source, output, outline, name, and license field', async () => {
  const { NATIVE_FONT_FACES } = await import(
    '../src/design/native-font-faces'
  );
  const provenance = JSON.parse(
    readFileSync(
      resolve(projectRoot, 'assets', 'fonts', 'PROVENANCE.json'),
      'utf8',
    ),
  ) as {
    schemaVersion: number;
    canonicalCommit: string;
    googleCssUserAgent: string;
    faces: Array<{
      source: 'tracked-ui' | 'google' | 'tracked-terminal';
      cssFamily: string;
      weight: number;
      style: 'normal' | 'italic';
      runtimeFamily: string;
      sourceFile?: string;
      cssUrl?: string;
      assetUrl?: string;
      sourceSha256: string;
      outputFile: string;
      outputSha256: string;
      outlineTable: string;
      sourceOutlineSha256: string;
      outputOutlineSha256: string;
      glyphCount: number;
      nameMetadata: {
        family: string;
        subfamily: string;
        postscriptName: string;
        copyright: string;
        license?: string;
        licenseUrl?: string;
      };
      license: {
        id: string;
        url?: string;
        file?: string;
        sha256?: string;
        embedded?: string;
        metadataUrl?: string;
        metadataFile?: string;
        metadataSha256?: string;
      };
    }>;
  };

  assert.equal(provenance.schemaVersion, 2);
  assert.equal(provenance.canonicalCommit, sources.canonicalCommit);
  assert.equal(provenance.googleCssUserAgent, sources.googleCssUserAgent);
  assert.equal(provenance.faces.length, 50);
  assert.deepEqual(
    provenance.faces.map((face) => ({
      source: face.source,
      cssFamily: face.cssFamily,
      weight: face.weight,
      style: face.style,
      runtimeFamily: face.runtimeFamily,
      assetFile: face.outputFile,
    })),
    NATIVE_FONT_FACES,
  );

  for (const face of provenance.faces) {
    const bytes = readFileSync(
      resolve(projectRoot, 'assets', 'fonts', face.outputFile),
    );
    const header = bytes.subarray(0, 4);
    assert.ok(
      header.equals(Buffer.from([0, 1, 0, 0])) ||
        header.toString('ascii') === 'OTTO',
      `${face.outputFile} must be an iOS-compatible sfnt`,
    );
    assert.equal(sha256(bytes), face.outputSha256);
    assert.match(face.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(face.sourceOutlineSha256, /^[a-f0-9]{64}$/);
    assert.equal(face.sourceOutlineSha256, face.outputOutlineSha256);
    assert.ok(face.glyphCount > 0);
    assert.ok(face.nameMetadata.family);
    assert.ok(face.nameMetadata.subfamily);
    assert.ok(face.nameMetadata.postscriptName);
    assert.ok(face.nameMetadata.copyright);

    if (face.source === 'google') {
      assert.match(face.cssUrl ?? '', /^https:\/\/fonts\.googleapis\.com\/css2/);
      assert.match(face.assetUrl ?? '', /^https:\/\/fonts\.gstatic\.com\/.+\.ttf$/);
      assert.equal(face.license.id, 'OFL-1.1');
    }
  }
});

test('license files and attribution are bundled for every open font family', () => {
  const provenance = JSON.parse(
    readFileSync(
      resolve(projectRoot, 'assets', 'fonts', 'PROVENANCE.json'),
      'utf8',
    ),
  ) as {
    faces: Array<{
      source: string;
      cssFamily: string;
      license: {
        id: string;
        url?: string;
        file?: string;
        sha256?: string;
        embedded?: string;
        metadataUrl?: string;
        metadataFile?: string;
        metadataSha256?: string;
      };
      nameMetadata: {
        copyright: string;
        license?: string;
        licenseUrl?: string;
      };
    }>;
  };
  const openFaces = provenance.faces.filter(
    (face) => face.source === 'google' || face.source === 'tracked-terminal',
  );
  const licenseFiles = new Set(openFaces.map((face) => face.license.file));

  assert.equal(licenseFiles.size, 14);
  for (const face of openFaces) {
    assert.equal(face.license.id, 'OFL-1.1');
    assert.ok(face.license.url);
    assert.ok(face.license.file);
    assert.match(face.license.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.ok(face.nameMetadata.copyright);
    const bytes = readFileSync(
      resolve(projectRoot, 'assets', 'fonts', face.license.file!),
    );
    assert.equal(sha256(bytes), face.license.sha256);
    assert.match(bytes.toString('utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
    if (face.source === 'google') {
      assert.match(face.license.metadataUrl ?? '', /\/METADATA\.pb$/);
      assert.ok(face.license.metadataFile);
      assert.match(face.license.metadataSha256 ?? '', /^[a-f0-9]{64}$/);
      const metadata = readFileSync(
        resolve(projectRoot, 'assets', 'fonts', face.license.metadataFile!),
      );
      assert.equal(sha256(metadata), face.license.metadataSha256);
      assert.match(metadata.toString('utf8'), /^license:\s*"OFL"\s*$/m);
      if (face.nameMetadata.license) {
        assert.match(face.nameMetadata.license, /Open Font License/i);
      }
      if (face.nameMetadata.licenseUrl) {
        assert.match(face.nameMetadata.licenseUrl, /openfontlicense|scripts\.sil/i);
      }
    }
  }
});

test('original login assets and runtime families remain byte-for-byte stable', async () => {
  const { NATIVE_FONT_FACES } = await import(
    '../src/design/native-font-faces'
  );

  for (const source of sources.trackedWebUi) {
    const bytes = readFileSync(
      resolve(projectRoot, 'assets', 'fonts', source.outputFile),
    );
    assert.equal(sha256(bytes), source.outputSha256);
    assert.ok(
      NATIVE_FONT_FACES.some(
        (face) =>
          face.source === 'tracked-ui' &&
          face.runtimeFamily === source.runtimeFamily &&
          face.assetFile === source.outputFile,
      ),
    );
  }
});

test('tracked terminal faces retain source hashes, outlines, and embedded OFL', () => {
  const provenance = JSON.parse(
    readFileSync(
      resolve(projectRoot, 'assets', 'fonts', 'PROVENANCE.json'),
      'utf8',
    ),
  ) as {
    faces: Array<{
      source: string;
      sourceFile?: string;
      sourceSha256: string;
      outputFile: string;
      sourceOutlineSha256: string;
      outputOutlineSha256: string;
      actualWeight: number;
      actualStyle: string;
      nameMetadata: { license?: string; licenseUrl?: string };
      license: { id: string };
    }>;
  };

  for (const source of sources.trackedTerminal) {
    const face = provenance.faces.find(
      (candidate) => candidate.outputFile === source.outputFile,
    );
    assert.ok(face, `${source.outputFile} must have provenance`);
    assert.equal(face.source, 'tracked-terminal');
    assert.equal(face.sourceFile, `hermes-agent/${source.sourceFile}`);
    assert.equal(face.sourceSha256, source.sourceSha256);
    assert.equal(face.sourceOutlineSha256, face.outputOutlineSha256);
    assert.equal(face.actualWeight, source.metadataWeight);
    assert.equal(face.actualStyle, source.metadataStyle);
    assert.equal(
      (face.nameMetadata as { subfamily?: string }).subfamily,
      source.metadataSubfamily,
    );
    assert.equal(face.license.id, sources.terminalLicense.id);
    assert.match(face.nameMetadata.license ?? '', /Open Font License/i);
    assert.match(face.nameMetadata.licenseUrl ?? '', /openfontlicense\.org/);
  }
});

test('Expo config and static useFonts requires cover exactly the 50-face catalog', async () => {
  const { NATIVE_FONT_FACES } = await import(
    '../src/design/native-font-faces'
  );
  const appConfig = JSON.parse(
    readFileSync(resolve(projectRoot, 'app.json'), 'utf8'),
  );
  const fontPlugin = appConfig.expo.plugins.find(
    (plugin: string | [string, unknown]) =>
      Array.isArray(plugin) && plugin[0] === 'expo-font',
  ) as [string, { fonts: string[] }] | undefined;
  const existingSource = readFileSync(
    resolve(projectRoot, 'src', 'app', 'webui-fonts.ts'),
    'utf8',
  );
  const generatedSource = readFileSync(
    resolve(projectRoot, 'src', 'app', 'native-font-assets.generated.ts'),
    'utf8',
  );

  assert.ok(fontPlugin);
  assert.deepEqual(
    fontPlugin[1].fonts,
    NATIVE_FONT_FACES.map((face) => `./assets/fonts/${face.assetFile}`),
  );
  assert.equal(fontPlugin[1].fonts.length, 50);
  for (const face of NATIVE_FONT_FACES) {
    assert.match(
      `${existingSource}\n${generatedSource}`,
      new RegExp(face.assetFile.replaceAll('.', '\\.')),
    );
  }
  assert.equal((generatedSource.match(/require\(/g) ?? []).length, 43);
  assert.match(existingSource, /GENERATED_NATIVE_FONT_ASSETS/);
  assert.match(existingSource, /useFonts\(WEBUI_FONT_ASSETS\)/);
  assert.doesNotMatch(existingSource, /https?:\/\//);
});
