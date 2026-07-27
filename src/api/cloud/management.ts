import type { HermesCloudTransport, JsonRecord } from './transport';

const ACHIEVEMENTS = '/api/plugins/hermes-achievements';

/** Profiles, configuration, credentials, channels, and system administration. */
export class HermesManagementCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  getPairing() {
    return this.transport.request<JsonRecord>('/api/pairing');
  }

  approvePairing(platform: string, code: string) {
    return this.transport.json<JsonRecord>('/api/pairing/approve', 'POST', { platform, code });
  }

  revokePairing(platform: string, userId: string) {
    return this.transport.json<JsonRecord>('/api/pairing/revoke', 'POST', {
      platform,
      user_id: userId,
    });
  }

  clearPendingPairing() {
    return this.transport.request<JsonRecord>('/api/pairing/clear-pending', { method: 'POST' });
  }

  getChannels(profile = 'default') {
    return this.transport.request<JsonRecord>('/api/messaging/platforms', {
      query: { profile },
    });
  }

  updateChannel(id: string, update: JsonRecord, profile = 'default') {
    return this.transport.json<JsonRecord>(
      `/api/messaging/platforms/${encodeURIComponent(id)}`,
      'PUT',
      { ...update, profile },
    );
  }

  getWebhooks() {
    return this.transport.request<JsonRecord>('/api/webhooks');
  }

  createWebhook(webhook: JsonRecord) {
    return this.transport.json<JsonRecord>('/api/webhooks', 'POST', webhook);
  }

  setWebhookEnabled(name: string, enabled: boolean) {
    return this.transport.json<JsonRecord>(
      `/api/webhooks/${encodeURIComponent(name)}/enabled`,
      'PUT',
      { enabled },
    );
  }

  deleteWebhook(name: string) {
    return this.transport.request<{ ok: boolean }>(
      `/api/webhooks/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
  }

  async getProfiles() {
    const [profiles, active] = await Promise.all([
      this.transport.request<{ profiles: JsonRecord[] }>('/api/profiles'),
      this.transport.request<JsonRecord>('/api/profiles/active'),
    ]);
    const enriched = await Promise.all(profiles.profiles.map(async (entry) => {
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name) return entry;
      try {
        const soul = await this.getProfileSoul(name);
        return { ...entry, soul: typeof soul.content === 'string' ? soul.content : '' };
      } catch {
        return entry;
      }
    }));
    return { profiles: enriched, active };
  }

  setActiveProfile(name: string) {
    return this.transport.json<JsonRecord>('/api/profiles/active', 'POST', { name });
  }

  createProfile(profile: JsonRecord) {
    return this.transport.json<JsonRecord>('/api/profiles', 'POST', profile);
  }

  deleteProfile(name: string) {
    return this.transport.request<{ ok: boolean }>(
      `/api/profiles/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
  }

  getProfileSoul(name: string) {
    return this.transport.request<JsonRecord>(
      `/api/profiles/${encodeURIComponent(name)}/soul`,
    );
  }

  updateProfileSoul(name: string, content: string) {
    return this.transport.json<JsonRecord>(
      `/api/profiles/${encodeURIComponent(name)}/soul`,
      'PUT',
      { content },
    );
  }

  getConfig(profile = 'default') {
    return Promise.all([
      this.transport.request<JsonRecord>('/api/config', { profile }),
      this.transport.request<JsonRecord>('/api/config/defaults'),
      this.transport.request<JsonRecord>('/api/config/schema'),
    ]).then(([config, defaults, schema]) => ({ config, defaults, schema }));
  }

  saveConfig(config: JsonRecord, profile = 'default') {
    return this.transport.json<{ ok: boolean }>('/api/config', 'PUT', { config }, { profile });
  }

  getEnvironment(profile = 'default') {
    return this.transport.request<Record<string, JsonRecord>>('/api/env', {
      query: { profile },
    });
  }

  setEnvironmentVariable(key: string, value: string, profile = 'default') {
    return this.transport.json<{ ok: boolean }>('/api/env', 'PUT', { key, value, profile });
  }

  deleteEnvironmentVariable(key: string, profile = 'default') {
    return this.transport.json<{ ok: boolean }>('/api/env', 'DELETE', { key, profile });
  }

  getModelCredentials(profile = 'default') {
    return this.transport.request<{ credentials: JsonRecord[] }>('/api/model/credentials', {
      query: { profile },
    });
  }

  deleteModelCredential(id: string, profile = 'default') {
    return this.transport.request<{ ok: boolean; removed: boolean }>(
      `/api/model/credentials/${encodeURIComponent(id)}`,
      { method: 'DELETE', query: { profile } },
    );
  }

  getSystem() {
    return Promise.all([
      this.transport.request<JsonRecord>('/api/status'),
      this.transport.request<JsonRecord>('/api/system/stats'),
      this.transport.request<JsonRecord>('/api/managed-nodes/status'),
    ]).then(([status, stats, managedNodes]) => ({ managedNodes, status, stats }));
  }

  recoverManagedNodes(nodeId = '') {
    return this.transport.json<JsonRecord>('/api/managed-nodes/recover', 'POST', {
      node_id: nodeId,
    });
  }

  restartGateway() {
    return this.transport.request<JsonRecord>('/api/gateway/restart', { method: 'POST' });
  }

  updateHermes() {
    return this.transport.request<JsonRecord>('/api/hermes/update', { method: 'POST' });
  }

  getAchievements() {
    return this.transport.request<JsonRecord>(`${ACHIEVEMENTS}/achievements`);
  }

  rescanAchievements() {
    return this.transport.request<JsonRecord>(`${ACHIEVEMENTS}/rescan`, { method: 'POST' });
  }
}
