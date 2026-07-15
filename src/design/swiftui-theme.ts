import type { NativeThemeTokens } from './theme-types';

function colorChannels(value: string): [number, number, number] | null {
  const hex = value.trim().match(/^#([0-9a-f]{6})/i)?.[1];
  if (hex) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }

  const rgba = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  return rgba
    ? [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])]
    : null;
}

function resolveColorScheme(background: string): 'dark' | 'light' {
  const channels = colorChannels(background);
  if (!channels) return 'dark';
  const [red, green, blue] = channels.map((channel) => channel / 255);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return luminance > 0.62 ? 'light' : 'dark';
}

export function resolveSwiftUIThemeProps(tokens: NativeThemeTokens) {
  return {
    themeAccentColor: tokens.colors.primary,
    themeBackgroundColor: tokens.colors.background,
    themeBorderColor: tokens.colors.border,
    themeColorScheme: resolveColorScheme(tokens.colors.background),
    themeDestructiveColor: tokens.colors.destructive,
    themeElevatedColor: tokens.colors.popover,
    themeForegroundColor: tokens.colors.foreground,
    themePrimaryColor: tokens.colors.primary,
    themeSecondaryColor: tokens.colors.textSecondary,
    themeSuccessColor: tokens.colors.success,
    themeSurfaceColor: tokens.colors.card,
    themeTertiaryColor: tokens.colors.textTertiary,
    themeWarningColor: tokens.colors.warning,
  } as const;
}
