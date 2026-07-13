import type { NativeThemeTokens } from './theme-types';

const SYSTEM_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';
const SYSTEM_SERIF = 'Georgia, Cambria, "Times New Roman", Times, serif';

export type FontCategory = 'sans' | 'serif' | 'mono';

export interface FontChoice {
  id: string;
  label: string;
  category: FontCategory;
  stack: string;
  fontUrl?: string;
}

export interface ThemeNamedFontRequirement {
  family: string;
  themes: string[];
  styles: string[];
  weights: number[];
}

export const THEME_DEFAULT_FONT_ID = 'theme';

const googleFonts = (family: string): string =>
  `https://fonts.googleapis.com/css2?family=${family}&display=swap`;

export const FONT_CHOICES: FontChoice[] = [
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
];

export const THEME_NAMED_FONT_REQUIREMENTS: ThemeNamedFontRequirement[] = [
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
];

const FONT_BY_ID: Record<string, FontChoice> = Object.fromEntries(
  FONT_CHOICES.map((choice) => [choice.id, choice]),
);

export function getFontChoice(
  id: string | null | undefined,
): FontChoice | undefined {
  if (!id || id === THEME_DEFAULT_FONT_ID) return undefined;
  return FONT_BY_ID[id];
}

export function isOverrideFont(id: string | null | undefined): boolean {
  return getFontChoice(id) !== undefined;
}

export function isFontPreference(
  id: string | null | undefined,
): id is string {
  return id === THEME_DEFAULT_FONT_ID || isOverrideFont(id);
}

export function applyFontPreference(
  tokens: NativeThemeTokens,
  id: string | null | undefined,
): NativeThemeTokens {
  const choice = getFontChoice(id);
  if (!choice) return tokens;

  return {
    ...tokens,
    typography: {
      ...tokens.typography,
      fontSans: choice.stack,
      fontDisplay: choice.stack,
    },
  };
}
