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

  testChannel(id: string, profile = 'default') {
    return this.transport.request<JsonRecord>(
      `/api/messaging/platforms/${encodeURIComponent(id)}/test`,
      { method: 'POST', query: { profile } },
    );
  }

  startTelegramOnboarding(botName = 'Hermes Agent', profile = 'default') {
    return this.transport.json<JsonRecord>('/api/messaging/telegram/onboarding/start', 'POST', {
      bot_name: botName,
      profile,
    });
  }

  getTelegramOnboarding(pairingId: string) {
    return this.transport.request<JsonRecord>(
      `/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}`,
    );
  }

  applyTelegramOnboarding(pairingId: string, allowedUserIds: string[], profile = 'default') {
    return this.transport.json<JsonRecord>(
      `/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}/apply`,
      'POST', { allowed_user_ids: allowedUserIds, profile },
    );
  }

  cancelTelegramOnboarding(pairingId: string) {
    return this.transport.request<JsonRecord>(
      `/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}`,
      { method: 'DELETE' },
    );
  }

  startWhatsappOnboarding(mode = 'pairing', allowedUsers = '', profile = 'default') {
    return this.transport.json<JsonRecord>('/api/messaging/whatsapp/onboarding/start', 'POST', {
      mode,
      allowed_users: allowedUsers,
      profile,
    });
  }

  getWhatsappOnboarding(pairingId: string) {
    return this.transport.request<JsonRecord>(
      `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`,
    );
  }

  applyWhatsappOnboarding(pairingId: string, body: JsonRecord, profile = 'default') {
    return this.transport.json<JsonRecord>(
      `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}/apply`,
      'POST', { ...body, profile },
    );
  }

  cancelWhatsappOnboarding(pairingId: string) {
    return this.transport.request<JsonRecord>(
      `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`,
      { method: 'DELETE' },
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

  /** Upstream Bot Mode exposes profiles as durable named bots. */
  getBots() {
    return this.transport.request<JsonRecord>('/api/bots');
  }

  /** Resolve or create the profile's title-registered Bot Chat. */
  ensureBotCanonicalChat(name: string) {
    return this.transport.json<JsonRecord>(
      `/api/bots/${encodeURIComponent(name)}/canonical-chat`,
      'POST',
      {},
    );
  }

  getBotMeta(name: string) {
    return this.transport.request<JsonRecord>(
      `/api/bots/${encodeURIComponent(name)}/meta`,
    );
  }

  updateBotMeta(name: string, patch: JsonRecord) {
    return this.transport.json<JsonRecord>(
      `/api/bots/${encodeURIComponent(name)}/meta`,
      'PATCH',
      patch,
    );
  }

  /** Full upstream Bot Mode profile capability snapshot. */
  describeBotProfile(name: string) {
    return this.transport.request<JsonRecord>(
      `/api/bots/${encodeURIComponent(name)}/describe`,
    );
  }

  /** Apply the canonical profiles.configure fields to a Bot Mode profile. */
  configureBotProfile(name: string, patch: JsonRecord) {
    return this.transport.json<JsonRecord>(
      `/api/bots/${encodeURIComponent(name)}/configure`,
      'PATCH',
      patch,
    );
  }

  getBotAsset(name: string, asset = 'avatar') {
    return this.transport.request<JsonRecord>(
      `/api/bots/${encodeURIComponent(name)}/assets/${encodeURIComponent(asset)}`,
    );
  }

  setBotAsset(name: string, data: string, asset = 'avatar') {
    return this.transport.json<JsonRecord>(
      `/api/bots/${encodeURIComponent(name)}/assets/${encodeURIComponent(asset)}`,
      'PUT',
      { data },
    );
  }

  clearBotAsset(name: string, asset = 'avatar') {
    return this.transport.request<JsonRecord>(
      `/api/bots/${encodeURIComponent(name)}/assets/${encodeURIComponent(asset)}`,
      { method: 'DELETE' },
    );
  }

  generateBotAvatar(name: string, prompt = '') {
    return this.transport.json<JsonRecord>(
      `/api/bots/${encodeURIComponent(name)}/assets/avatar/generate`,
      'POST',
      prompt.trim() ? { prompt: prompt.trim() } : {},
    );
  }

  /** Read the official Petdex gallery used by the desktop Bot avatar picker. */
  getBotPetGallery() {
    return this.transport.request<JsonRecord>('/api/bot-mode/pets/gallery');
  }

  /** Store a Petdex first-frame thumbnail through the canonical asset RPC. */
  setBotPetAvatar(name: string, slug: string, url = '') {
    return this.transport.json<JsonRecord>(
      `/api/bots/${encodeURIComponent(name)}/assets/avatar/pet`,
      'POST',
      url.trim() ? { slug, url: url.trim() } : { slug },
    );
  }

  /** Read the official Bot Mode cross-connection roster maintained by the
   * desktop relay. The server never returns connection credentials. */
  getBotRelayRoster() {
    return this.transport.request<JsonRecord>('/api/bot-mode/relay/roster');
  }

  /** Queue a cross-connection Bot Mode DM through the canonical relay helper. */
  sendBotRelayMessage(target: string, message: string, senderProfile = 'default') {
    return this.transport.json<JsonRecord>('/api/bot-mode/relay/send', 'POST', {
      target,
      message,
      sender_profile: senderProfile,
    });
  }

  setActiveProfile(name: string) {
    return this.transport.json<JsonRecord>('/api/profiles/active', 'POST', { name });
  }

  createProfile(profile: JsonRecord, bot = false) {
    return this.transport.json<JsonRecord>(bot ? '/api/bots' : '/api/profiles', 'POST', profile);
  }

  deleteProfile(name: string, bot = false) {
    return this.transport.request<{ ok: boolean }>(
      `${bot ? '/api/bots' : '/api/profiles'}/${encodeURIComponent(name)}`,
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

  renameProfile(name: string, newName: string) {
    return this.transport.json<JsonRecord>(
      `/api/profiles/${encodeURIComponent(name)}`,
      'PATCH',
      { new_name: newName },
    );
  }

  /** Bot Mode keeps a distinct REST route so the server can preserve bot
   * metadata/identity semantics while applying the same profile rename. */
  renameBot(name: string, newName: string) {
    return this.transport.json<JsonRecord>(
      `/api/bots/${encodeURIComponent(name)}`,
      'PATCH',
      { new_name: newName },
    );
  }

  updateProfileDescription(name: string, description: string) {
    return this.transport.json<JsonRecord>(
      `/api/profiles/${encodeURIComponent(name)}/description`, 'PUT', { description },
    );
  }

  updateProfileModel(name: string, provider: string, model: string) {
    return this.transport.json<JsonRecord>(
      `/api/profiles/${encodeURIComponent(name)}/model`, 'PUT', { provider, model },
    );
  }

  autoDescribeProfile(name: string) {
    return this.transport.request<JsonRecord>(
      `/api/profiles/${encodeURIComponent(name)}/describe-auto`, { method: 'POST' },
    );
  }

  getProfileSetupCommand(name: string) {
    return this.transport.request<JsonRecord>(
      `/api/profiles/${encodeURIComponent(name)}/setup-command`,
    );
  }

  exportProfile(name: string, output = '', extraFiles: string[] = []) {
    return this.transport.json<JsonRecord>(
      `/api/profiles/${encodeURIComponent(name)}/export`, 'POST',
      { output, extra_files: extraFiles },
    );
  }

  importProfiles(payload: JsonRecord) {
    return this.transport.json<JsonRecord>('/api/profiles/import', 'POST', payload);
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

  revealEnvironmentVariable(key: string, profile = 'default') {
    return this.transport.json<JsonRecord>('/api/env/reveal', 'POST', { key, profile });
  }

  getModelCredentials(profile = 'default') {
    // Hermes exposes credential status through the unified OAuth catalog;
    // older mobile code used the removed /api/model/credentials route.
    return this.transport.request<{ providers: JsonRecord[] }>('/api/providers/oauth', {
      query: { profile },
    }).then(({ providers }) => ({ credentials: providers || [] }));
  }

  deleteModelCredential(id: string, profile = 'default') {
    return this.transport.request<{ ok: boolean; removed: boolean }>(
      `/api/providers/oauth/${encodeURIComponent(id)}`,
      { method: 'DELETE', query: { profile } },
    );
  }

  enableWebhooks() {
    return this.transport.request<JsonRecord>('/api/webhooks/enable', { method: 'POST' });
  }

  openProfileTerminal(name: string) {
    return this.transport.request<JsonRecord>(
      `/api/profiles/${encodeURIComponent(name)}/open-terminal`, { method: 'POST' },
    );
  }

  getProfileDesktopOverlay(name: string) {
    return this.transport.request<JsonRecord>(
      `/api/profiles/${encodeURIComponent(name)}/desktop-overlay`,
    );
  }

  getSystem() {
    // Managed-node monitoring is an optional relay.  Older Hermes servers (and
    // a temporarily unavailable relay) may not expose it, but that must not
    // make the local /status and /system/stats snapshots disappear together.
    return Promise.all([
      this.transport.request<JsonRecord>('/api/status'),
      this.transport.request<JsonRecord>('/api/system/stats'),
      this.transport
        .request<JsonRecord>('/api/managed-nodes/status')
        .catch(() => emptyManagedNodesSnapshot()),
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

  startGateway(profile = 'default') {
    return this.transport.request<JsonRecord>('/api/gateway/start', {
      method: 'POST',
      query: { profile },
    });
  }

  stopGateway(profile = 'default') {
    return this.transport.request<JsonRecord>('/api/gateway/stop', {
      method: 'POST',
      query: { profile },
    });
  }

  drainGateway(profile = 'default') {
    return this.transport.request<JsonRecord>('/api/gateway/drain', {
      method: 'POST',
      query: { profile },
    });
  }

  updateHermes() {
    return this.transport.request<JsonRecord>('/api/hermes/update', { method: 'POST' });
  }

  checkHermesUpdate(force = false) {
    return this.transport.request<JsonRecord>('/api/hermes/update/check', {
      query: force ? { force: 'true' } : undefined,
    });
  }

  getHermesUpdateReceipt() {
    return this.transport.request<JsonRecord>('/api/hermes/update/receipt');
  }

  getHealth() {
    return this.transport.request<JsonRecord>('/api/health');
  }

  getEgressStatus() {
    return this.transport.request<JsonRecord>('/api/egress/status');
  }

  getCredentialPool() {
    return this.transport.request<JsonRecord>('/api/credentials/pool');
  }

  addCredentialPoolEntry(provider: string, apiKey: string, label = '') {
    return this.transport.json<JsonRecord>('/api/credentials/pool', 'POST', {
      provider,
      api_key: apiKey,
      label: label || undefined,
    });
  }

  removeCredentialPoolEntry(provider: string, index: number) {
    return this.transport.request<JsonRecord>(
      `/api/credentials/pool/${encodeURIComponent(provider)}/${Math.max(1, Math.trunc(index))}`,
      { method: 'DELETE' },
    );
  }

  getAchievements() {
    return this.transport.request<JsonRecord>(`${ACHIEVEMENTS}/achievements`);
  }

  rescanAchievements() {
    return this.transport.request<JsonRecord>(`${ACHIEVEMENTS}/rescan`, { method: 'POST' });
  }
}

function emptyManagedNodesSnapshot(): JsonRecord {
  return {
    configured: false,
    nodes: [],
    sources: [],
  };
}
