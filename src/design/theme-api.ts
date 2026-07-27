import type { HermesApiClient } from '../api/HermesApiClient';
import type {
  DashboardFontResponse,
  ThemeListResponse,
} from './theme-types';

// Dashboard theme and font preferences are product endpoints, so they live
// with the design system that consumes them. HermesApiClient stays a pure
// transport and never depends on design payload shapes.
export class HermesThemeApi {
  constructor(private readonly client: HermesApiClient) {}

  getThemes(): Promise<ThemeListResponse> {
    return this.client.request<ThemeListResponse>('/api/dashboard/themes');
  }

  setTheme(name: string): Promise<{ ok: boolean; theme: string }> {
    return this.client.request('/api/dashboard/theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  getFontPref(): Promise<DashboardFontResponse> {
    return this.client.request<DashboardFontResponse>('/api/dashboard/font');
  }

  setFontPref(font: string): Promise<{ ok: boolean; font: string }> {
    return this.client.request('/api/dashboard/font', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ font }),
    });
  }
}
