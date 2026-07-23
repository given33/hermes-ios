import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fontNames = [
  'Collapse-Bold.otf',
  'Collapse-Regular.otf',
  'Mondwest-Regular.ttf',
  'RulesCompressed-Medium.ttf',
  'RulesCompressed-Regular.ttf',
  'RulesExpanded-Bold.ttf',
  'RulesExpanded-Regular.ttf',
] as const;

test('bundles every canonical WebUI font as a native sfnt asset', () => {
  for (const fontName of fontNames) {
    const bytes = readFileSync(resolve(projectRoot, 'assets', 'fonts', fontName));
    const sfntHeader = bytes.subarray(0, 4);
    const isTrueType = sfntHeader.equals(Buffer.from([0x00, 0x01, 0x00, 0x00]));
    const isOpenType = sfntHeader.toString('ascii') === 'OTTO';

    assert.ok(bytes.length > 10_000, `${fontName} must contain the source glyph data`);
    assert.ok(isTrueType || isOpenType, `${fontName} must be an iOS-compatible sfnt`);
  }
});

test('font provenance pins source and output hashes plus the conversion toolchain', () => {
  const provenance = JSON.parse(
    readFileSync(resolve(projectRoot, 'assets', 'fonts', 'PROVENANCE.json'), 'utf8'),
  ) as {
    command: string;
    fontToolsVersion: string;
    brotliVersion: string;
    sourcePackageLicense: string;
    fonts: Array<{
      outputFile: string;
      outputSha256: string;
      sourceFile: string;
      sourceSha256: string;
    }>;
  };

  assert.match(provenance.command, /scripts\/sync-native-fonts\.py/);
  assert.equal(provenance.fontToolsVersion, '4.63.0');
  assert.equal(provenance.brotliVersion, '1.2.0');
  assert.match(provenance.sourcePackageLicense, /fonts retain embedded EULAs/);
  assert.equal(provenance.fonts.length, fontNames.length);
  for (const entry of provenance.fonts) {
    assert.match(entry.sourceFile, /^hermes-agent\/web\/public\/fonts\/.+\.woff2$/);
    assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/);
    const output = readFileSync(resolve(projectRoot, 'assets', 'fonts', entry.outputFile));
    assert.equal(createHash('sha256').update(output).digest('hex'), entry.outputSha256);
  }
});

test('Expo embeds the exact font assets and runtime maps each file explicitly', () => {
  const packageConfig = JSON.parse(
    readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
  );
  const appConfig = JSON.parse(readFileSync(resolve(projectRoot, 'app.base.json'), 'utf8'));
  const fontPlugin = appConfig.expo.plugins.find(
    (plugin: string | [string, Record<string, unknown>]) =>
      Array.isArray(plugin) && plugin[0] === 'expo-font',
  );
  const fontSource = readFileSync(
    resolve(projectRoot, 'src', 'app', 'webui-fonts.ts'),
    'utf8',
  );

  assert.match(packageConfig.dependencies['expo-font'], /^~14\./);
  assert.ok(Array.isArray(fontPlugin));
  const configuredFonts = (fontPlugin[1] as { fonts: string[] }).fonts;
  assert.equal(configuredFonts.length, 50);
  for (const fontName of fontNames) {
    assert.ok(configuredFonts.includes(`./assets/fonts/${fontName}`));
  }
  for (const fontName of fontNames) {
    assert.match(fontSource, new RegExp(fontName.replace('.', '\\.')));
  }
  assert.match(fontSource, /CollapseRegular:\s*'Collapse'/);
  assert.match(fontSource, /CollapseBold:\s*'Collapse-Bold'/);
  assert.match(fontSource, /RulesCompressedRegular:\s*'Rules Compressed'/);
  assert.match(fontSource, /RulesCompressedMedium:\s*'Rules Compressed-Medium'/);
  assert.match(fontSource, /RulesExpandedRegular:\s*'Rules Expanded'/);
  assert.match(fontSource, /RulesExpandedBold:\s*'Rules Expanded-Bold'/);
  assert.match(fontSource, /MondwestRegular:\s*'Mondwest'/);
  assert.match(fontSource, /GENERATED_NATIVE_FONT_ASSETS/);
});

test('LoginScreen uses the canonical display and body font mappings without weight guessing', () => {
  const loginSource = readFileSync(
    resolve(projectRoot, 'src', 'auth', 'LoginScreen.tsx'),
    'utf8',
  );

  assert.match(loginSource, /WEBUI_FONT_FAMILIES\.CollapseRegular/);
  assert.match(loginSource, /WEBUI_FONT_FAMILIES\.CollapseBold/);
  assert.match(loginSource, /WEBUI_FONT_FAMILIES\.RulesCompressedMedium/);
  assert.doesNotMatch(loginSource, /fontFamily:[^\n]+fontWeight/);
});
