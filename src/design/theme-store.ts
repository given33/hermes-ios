export const THEME_STORAGE_KEYS = {
  theme: 'hermes-dashboard-theme',
  font: 'hermes-dashboard-font',
} as const;

export interface AsyncStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface StoredThemePreferences {
  theme: string | null;
  font: string | null;
}

export class ThemePreferenceStore {
  constructor(private readonly storage: AsyncStorageAdapter) {}

  async read(): Promise<StoredThemePreferences> {
    const theme = await this.storage.getItem(THEME_STORAGE_KEYS.theme);
    const font = await this.storage.getItem(THEME_STORAGE_KEYS.font);
    return { theme, font };
  }

  writeTheme(theme: string): Promise<void> {
    return this.storage.setItem(THEME_STORAGE_KEYS.theme, theme);
  }

  writeFont(font: string): Promise<void> {
    return this.storage.setItem(THEME_STORAGE_KEYS.font, font);
  }
}
