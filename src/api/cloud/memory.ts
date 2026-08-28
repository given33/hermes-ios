import type { HermesCloudTransport, JsonRecord } from './transport';

export interface StudioMemoryContent {
  memory: string;
  memoryMtime: string;
  soul: string;
  soulMtime: string;
  user: string;
  userMtime: string;
}

function normalizeStudioMemory(value: JsonRecord): StudioMemoryContent {
  const text = (key: string) => typeof value[key] === 'string' ? value[key] as string : '';
  const timestamp = (key: string) => {
    const raw = value[key];
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return new Date(raw < 10_000_000_000 ? raw * 1_000 : raw).toLocaleString();
    }
    return '';
  };
  return {
    memory: text('memory'),
    memoryMtime: timestamp('memory_mtime'),
    soul: text('soul'),
    soulMtime: timestamp('soul_mtime'),
    user: text('user'),
    userMtime: timestamp('user_mtime'),
  };
}

/** Editable MEMORY.md, SOUL.md, and USER.md for one Hermes profile. */
export class HermesMemoryCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  async getStudioMemory(profile: string): Promise<StudioMemoryContent> {
    const value = await this.transport.request<JsonRecord>('/api/hermes/memory', {
      profile,
    });
    return normalizeStudioMemory(value);
  }

  async saveStudioMemory(
    profile: string,
    section: 'memory' | 'soul' | 'user',
    content: string,
  ): Promise<StudioMemoryContent> {
    const value = await this.transport.json<JsonRecord>('/api/hermes/memory', 'PUT', {
      content,
      section,
    }, { profile });
    return normalizeStudioMemory(value);
  }

  getMemoryStatus() {
    return this.transport.request<JsonRecord>('/api/memory');
  }

  setMemoryProvider(provider: string) {
    return this.transport.json<JsonRecord>('/api/memory/provider', 'PUT', { provider });
  }

  resetMemory(target: 'all' | 'memory' | 'user' = 'all') {
    return this.transport.json<JsonRecord>('/api/memory/reset', 'POST', { target });
  }

  getMemoryProviderConfig(name: string, profile = 'default', surface = '') {
    return this.transport.request<JsonRecord>(
      `/api/memory/providers/${encodeURIComponent(name)}/config`,
      { query: { profile, surface: surface || undefined } },
    );
  }

  setupMemoryProvider(name: string, values: JsonRecord = {}) {
    return this.transport.json<JsonRecord>(
      `/api/memory/providers/${encodeURIComponent(name)}/setup`, 'POST', { values },
    );
  }

  updateMemoryProviderConfig(name: string, values: JsonRecord, profile = 'default', surface = '') {
    return this.transport.json<JsonRecord>(
      `/api/memory/providers/${encodeURIComponent(name)}/config`, 'PUT', { values },
      { query: { profile, surface: surface || undefined } },
    );
  }
}
