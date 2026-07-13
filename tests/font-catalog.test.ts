import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FONT_CHOICES,
  THEME_DEFAULT_FONT_ID,
  THEME_NAMED_FONT_REQUIREMENTS,
  applyFontPreference,
  getFontChoice,
  isFontPreference,
  isOverrideFont,
} from '../src/design/font-catalog';
import { BUILTIN_THEMES } from '../src/design/theme-presets';
import { deriveNativeThemeTokens } from '../src/design/theme-tokens';

const SYSTEM_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';
const SYSTEM_SERIF = 'Georgia, Cambria, "Times New Roman", Times, serif';
const googleFonts = (family: string) =>
  `https://fonts.googleapis.com/css2?family=${family}&display=swap`;

test('copies the exact 14-choice WebUI font catalog in display order', () => {
  assert.equal(THEME_DEFAULT_FONT_ID, 'theme');
  assert.deepEqual(FONT_CHOICES, [
    {
      id: 'system-sans',
      label: 'System Sans',
      category: 'sans',
      stack: SYSTEM_SANS,
    },
    {
      id: 'system-serif',
      label: 'System Serif',
      category: 'serif',
      stack: SYSTEM_SERIF,
    },
    {
      id: 'system-mono',
      label: 'System Mono',
      category: 'mono',
      stack: SYSTEM_MONO,
    },
    {
      id: 'inter',
      label: 'Inter',
      category: 'sans',
      stack: `"Inter", ${SYSTEM_SANS}`,
      fontUrl: googleFonts('Inter:wght@400;500;600;700'),
    },
    {
      id: 'ibm-plex-sans',
      label: 'IBM Plex Sans',
      category: 'sans',
      stack: `"IBM Plex Sans", ${SYSTEM_SANS}`,
      fontUrl: googleFonts('IBM+Plex+Sans:wght@400;500;600;700'),
    },
    {
      id: 'work-sans',
      label: 'Work Sans',
      category: 'sans',
      stack: `"Work Sans", ${SYSTEM_SANS}`,
      fontUrl: googleFonts('Work+Sans:wght@400;500;600;700'),
    },
    {
      id: 'atkinson-hyperlegible',
      label: 'Atkinson Hyperlegible',
      category: 'sans',
      stack: `"Atkinson Hyperlegible", ${SYSTEM_SANS}`,
      fontUrl: googleFonts('Atkinson+Hyperlegible:wght@400;700'),
    },
    {
      id: 'dm-sans',
      label: 'DM Sans',
      category: 'sans',
      stack: `"DM Sans", ${SYSTEM_SANS}`,
      fontUrl: googleFonts(
        'DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700',
      ),
    },
    {
      id: 'spectral',
      label: 'Spectral',
      category: 'serif',
      stack: `"Spectral", ${SYSTEM_SERIF}`,
      fontUrl: googleFonts('Spectral:wght@400;500;600;700'),
    },
    {
      id: 'fraunces',
      label: 'Fraunces',
      category: 'serif',
      stack: `"Fraunces", ${SYSTEM_SERIF}`,
      fontUrl: googleFonts(
        'Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600',
      ),
    },
    {
      id: 'source-serif',
      label: 'Source Serif 4',
      category: 'serif',
      stack: `"Source Serif 4", ${SYSTEM_SERIF}`,
      fontUrl: googleFonts(
        'Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700',
      ),
    },
    {
      id: 'jetbrains-mono',
      label: 'JetBrains Mono',
      category: 'mono',
      stack: `"JetBrains Mono", ${SYSTEM_MONO}`,
      fontUrl: googleFonts('JetBrains+Mono:wght@400;500;700'),
    },
    {
      id: 'ibm-plex-mono',
      label: 'IBM Plex Mono',
      category: 'mono',
      stack: `"IBM Plex Mono", ${SYSTEM_MONO}`,
      fontUrl: googleFonts('IBM+Plex+Mono:wght@400;500;700'),
    },
    {
      id: 'space-mono',
      label: 'Space Mono',
      category: 'mono',
      stack: `"Space Mono", ${SYSTEM_MONO}`,
      fontUrl: googleFonts('Space+Mono:wght@400;700'),
    },
  ]);
});

test('records theme-only named font requirements without adding picker choices', () => {
  assert.deepEqual(THEME_NAMED_FONT_REQUIREMENTS, [
    {
      family: 'Share Tech Mono',
      themes: ['cyberpunk'],
      styles: ['normal'],
      weights: [400],
    },
    {
      family: 'DM Mono',
      themes: ['rose'],
      styles: ['normal'],
      weights: [400, 500],
    },
  ]);
  const choiceFamilies = FONT_CHOICES.map((choice) => choice.stack);
  assert.equal(choiceFamilies.some((stack) => stack.startsWith('"Share Tech Mono"')), false);
  assert.equal(choiceFamilies.some((stack) => stack.startsWith('"DM Mono"')), false);
});

test('font helpers distinguish the theme sentinel, catalog ids, and unknown values', () => {
  assert.equal(getFontChoice('inter'), FONT_CHOICES[3]);
  assert.equal(getFontChoice(THEME_DEFAULT_FONT_ID), undefined);
  assert.equal(getFontChoice('unknown-font'), undefined);
  assert.equal(getFontChoice(null), undefined);

  assert.equal(isOverrideFont('inter'), true);
  assert.equal(isOverrideFont(THEME_DEFAULT_FONT_ID), false);
  assert.equal(isOverrideFont('unknown-font'), false);

  assert.equal(isFontPreference(THEME_DEFAULT_FONT_ID), true);
  assert.equal(isFontPreference('inter'), true);
  assert.equal(isFontPreference('unknown-font'), false);
  assert.equal(isFontPreference(undefined), false);
});

test('font preference overrides sans and display while preserving theme mono', () => {
  const themeTokens = deriveNativeThemeTokens(BUILTIN_THEMES.midnight);
  const overridden = applyFontPreference(themeTokens, 'spectral');
  const reset = applyFontPreference(themeTokens, THEME_DEFAULT_FONT_ID);

  assert.equal(overridden.typography.fontSans, FONT_CHOICES[8].stack);
  assert.equal(overridden.typography.fontDisplay, FONT_CHOICES[8].stack);
  assert.equal(overridden.typography.fontMono, themeTokens.typography.fontMono);
  assert.deepEqual(reset, themeTokens);
  assert.deepEqual(applyFontPreference(themeTokens, 'unknown-font'), themeTokens);
});
