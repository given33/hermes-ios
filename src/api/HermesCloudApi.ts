import type { HermesApiClient, HermesRequestOptions } from './HermesApiClient';

export type JsonRecord = Record<string, unknown>;

export interface SessionSummary {
  id: string;
  source: string | null;
  model: string | null;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  last_active: number;
  is_active: boolean;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  preview: string | null;
}

export interface PaginatedSessions {
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ManagedFileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number | null;
  mtime: number;
  mime_type: string | null;
}

export interface ManagedFilesResponse {
  root: string | null;
  path: string;
  parent: string | null;
  locked_root: string | null;
  can_change_path: boolean;
  entries: ManagedFileEntry[];
}

export interface CollaborationProfile {
  name: string;
  description: string;
  model: string;
  provider: string;
  gateway_running: boolean;
}

export interface CollaborationMessage {
  id: string;
  role: string;
  name: string;
  content: string;
  status?: string;
  kind?: string;
  created_at?: number;
  meta?: JsonRecord;
}

export interface SingleConversation {
  id: string;
  profile: string;
  title: string;
  messages: CollaborationMessage[];
  message_count?: number;
  runtime_sessions?: Record<string, string>;
  runtime_runs?: Record<string, JsonRecord>;
  hosted_turns?: Record<string, JsonRecord>;
  created_at?: number;
  updated_at?: number;
}

export interface RouteDecision {
  mode: 'chat' | 'work';
  label: string;
  title: string;
  reason: string;
  confidence: number;
  source: string;
  profiles: string[];
  artifact_required: boolean;
}

export interface NativeUpload {
  name: string;
  mimeType?: string | null;
  uri: string;
}

const COLLABORATION = '/api/plugins/collaboration';
const KANBAN = '/api/plugins/kanban';
const ACHIEVEMENTS = '/api/plugins/hermes-achievements';

/**
 * Native facade over the canonical Dashboard and modified Collaboration APIs.
 * It intentionally stores no business data: every read and mutation goes to
 * the one server-side Hermes workspace shared by all signed-in devices.
 */
export class HermesCloudApi {
  constructor(readonly client: HermesApiClient) {}

  request<T>(path: string, options?: HermesRequestOptions): Promise<T> {
    return this.client.request<T>(path, options);
  }

  getStatus() {
    return this.request<JsonRecord>('/api/status');
  }

  getSessions(limit = 50, offset = 0, profile = 'default') {
    return this.request<PaginatedSessions>('/api/sessions', {
      profile,
      query: { limit, offset, order: 'recent' },
    });
  }

  getSession(id: string, profile = 'default') {
    return this.request<JsonRecord>(`/api/sessions/${encodeURIComponent(id)}`, { profile });
  }

  getSessionMessages(id: string, profile = 'default') {
    return this.request<{ session_id: string; messages: JsonRecord[] }>(
      `/api/sessions/${encodeURIComponent(id)}/messages`,
      { profile },
    );
  }

  renameSession(id: string, title: string, profile = 'default') {
    return this.json<{ ok: boolean; title: string }>(
      `/api/sessions/${encodeURIComponent(id)}`,
      'PATCH',
      { title, profile },
    );
  }

  deleteSession(id: string, profile = 'default') {
    return this.request<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      profile,
    });
  }

  listFiles(path = '') {
    return this.request<ManagedFilesResponse>('/api/files', {
      query: { path: path || undefined },
    });
  }

  readFile(path: string) {
    return this.request<JsonRecord>('/api/files/read', { query: { path } });
  }

  createDirectory(path: string) {
    return this.json<JsonRecord>('/api/files/mkdir', 'POST', { path });
  }

  deleteFile(path: string, recursive = false) {
    return this.json<{ ok: boolean; path: string }>('/api/files', 'DELETE', {
      path,
      recursive,
    });
  }

  downloadManagedFile(path: string) {
    return this.client.download('/api/files/download', { query: { path } });
  }

  async uploadManagedFile(path: string, upload: NativeUpload, overwrite = true) {
    const form = new FormData();
    form.append('path', path);
    form.append('overwrite', String(overwrite));
    form.append('file', {
      name: upload.name,
      type: upload.mimeType || 'application/octet-stream',
      uri: upload.uri,
    } as unknown as Blob);
    return this.request<JsonRecord>('/api/files/upload-stream', {
      method: 'POST',
      body: form,
    });
  }

  getAnalytics(days = 30, profile = 'default') {
    return Promise.all([
      this.request<JsonRecord>('/api/analytics/usage', { profile, query: { days } }),
      this.request<JsonRecord>('/api/analytics/models', { profile, query: { days } }),
    ]).then(([usage, models]) => ({ usage, models }));
  }

  getModels(profile = 'default') {
    return Promise.all([
      this.request<JsonRecord>('/api/model/info', { profile }),
      this.request<JsonRecord>('/api/model/options', {
        profile,
        query: { include_unconfigured: 1 },
      }),
    ]).then(([info, options]) => ({ info, options }));
  }

  setModel(provider: string, model: string, profile = 'default') {
    return this.json<JsonRecord>('/api/model/set', 'POST', {
      scope: 'main',
      provider,
      model,
    }, { profile });
  }

  getLogs(lines = 500, level = 'ALL', component = 'all') {
    return this.request<JsonRecord>('/api/logs', {
      query: {
        lines,
        level: level === 'ALL' ? undefined : level,
        component: component === 'all' ? undefined : component,
      },
    });
  }

  getCronJobs(profile = 'all') {
    return this.request<JsonRecord[]>('/api/cron/jobs', { query: { profile } });
  }

  createCronJob(job: JsonRecord, profile = 'default') {
    return this.json<JsonRecord>('/api/cron/jobs', 'POST', job, {
      query: { profile },
    });
  }

  updateCronJob(id: string, updates: JsonRecord, profile = 'default') {
    return this.json<JsonRecord>(`/api/cron/jobs/${encodeURIComponent(id)}`, 'PUT', {
      updates,
    }, { query: { profile } });
  }

  setCronJobPaused(id: string, paused: boolean, profile = 'default') {
    return this.request<JsonRecord>(
      `/api/cron/jobs/${encodeURIComponent(id)}/${paused ? 'pause' : 'resume'}`,
      { method: 'POST', query: { profile } },
    );
  }

  triggerCronJob(id: string, profile = 'default') {
    return this.request<JsonRecord>(`/api/cron/jobs/${encodeURIComponent(id)}/trigger`, {
      method: 'POST',
      query: { profile },
    });
  }

  deleteCronJob(id: string, profile = 'default') {
    return this.request<{ ok: boolean }>(`/api/cron/jobs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      query: { profile },
    });
  }

  getSkills(profile = 'default') {
    return Promise.all([
      this.request<JsonRecord[]>('/api/skills', { profile }),
      this.request<JsonRecord[]>('/api/tools/toolsets', { profile }),
    ]).then(([skills, toolsets]) => ({ skills, toolsets }));
  }

  toggleSkill(name: string, enabled: boolean, profile = 'default') {
    return this.json<{ ok: boolean }>('/api/skills/toggle', 'PUT', {
      name,
      enabled,
      profile,
    });
  }

  getSkillContent(name: string, profile = 'default') {
    return this.request<JsonRecord>('/api/skills/content', {
      query: { name, profile },
    });
  }

  updateSkillContent(name: string, content: string, profile = 'default') {
    return this.json<JsonRecord>('/api/skills/content', 'PUT', {
      name,
      content,
      profile,
    });
  }

  getPlugins() {
    return Promise.all([
      this.request<JsonRecord[]>('/api/dashboard/plugins'),
      this.request<JsonRecord>('/api/dashboard/plugins/hub'),
    ]).then(([manifests, hub]) => ({ manifests, hub }));
  }

  setPluginEnabled(name: string, enabled: boolean) {
    return this.request<JsonRecord>(
      `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/${enabled ? 'enable' : 'disable'}`,
      { method: 'POST' },
    );
  }

  getMcp(profile = 'default') {
    return Promise.all([
      this.request<JsonRecord>('/api/mcp/servers', { query: { profile } }),
      this.request<JsonRecord>('/api/mcp/catalog', { query: { profile } }),
    ]).then(([servers, catalog]) => ({ servers, catalog }));
  }

  addMcpServer(server: JsonRecord, profile = 'default') {
    return this.json<JsonRecord>('/api/mcp/servers', 'POST', server, { query: { profile } });
  }

  setMcpServerEnabled(name: string, enabled: boolean, profile = 'default') {
    return this.json<JsonRecord>(
      `/api/mcp/servers/${encodeURIComponent(name)}/enabled`,
      'PUT',
      { enabled },
      { query: { profile } },
    );
  }

  removeMcpServer(name: string, profile = 'default') {
    return this.request<{ ok: boolean }>(`/api/mcp/servers/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      query: { profile },
    });
  }

  getPairing() {
    return this.request<JsonRecord>('/api/pairing');
  }

  approvePairing(platform: string, code: string) {
    return this.json<JsonRecord>('/api/pairing/approve', 'POST', { platform, code });
  }

  revokePairing(platform: string, userId: string) {
    return this.json<JsonRecord>('/api/pairing/revoke', 'POST', {
      platform,
      user_id: userId,
    });
  }

  clearPendingPairing() {
    return this.request<JsonRecord>('/api/pairing/clear-pending', { method: 'POST' });
  }

  getChannels(profile = 'default') {
    return this.request<JsonRecord>('/api/messaging/platforms', { query: { profile } });
  }

  updateChannel(id: string, update: JsonRecord, profile = 'default') {
    return this.json<JsonRecord>(
      `/api/messaging/platforms/${encodeURIComponent(id)}`,
      'PUT',
      { ...update, profile },
    );
  }

  getWebhooks() {
    return this.request<JsonRecord>('/api/webhooks');
  }

  createWebhook(webhook: JsonRecord) {
    return this.json<JsonRecord>('/api/webhooks', 'POST', webhook);
  }

  setWebhookEnabled(name: string, enabled: boolean) {
    return this.json<JsonRecord>(`/api/webhooks/${encodeURIComponent(name)}/enabled`, 'PUT', {
      enabled,
    });
  }

  deleteWebhook(name: string) {
    return this.request<{ ok: boolean }>(`/api/webhooks/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  async getProfiles() {
    const [profiles, active] = await Promise.all([
      this.request<{ profiles: JsonRecord[] }>('/api/profiles'),
      this.request<JsonRecord>('/api/profiles/active'),
    ]);
    const enriched = await Promise.all(profiles.profiles.map(async (entry) => {
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name) return entry;
      try {
        const soul = await this.getProfileSoul(name);
        return {
          ...entry,
          soul: typeof soul.content === 'string' ? soul.content : '',
        };
      } catch {
        return entry;
      }
    }));
    return { profiles: enriched, active };
  }

  setActiveProfile(name: string) {
    return this.json<JsonRecord>('/api/profiles/active', 'POST', { name });
  }

  createProfile(profile: JsonRecord) {
    return this.json<JsonRecord>('/api/profiles', 'POST', profile);
  }

  deleteProfile(name: string) {
    return this.request<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  getProfileSoul(name: string) {
    return this.request<JsonRecord>(`/api/profiles/${encodeURIComponent(name)}/soul`);
  }

  updateProfileSoul(name: string, content: string) {
    return this.json<JsonRecord>(`/api/profiles/${encodeURIComponent(name)}/soul`, 'PUT', {
      content,
    });
  }

  getConfig(profile = 'default') {
    return Promise.all([
      this.request<JsonRecord>('/api/config', { profile }),
      this.request<JsonRecord>('/api/config/defaults'),
      this.request<JsonRecord>('/api/config/schema'),
    ]).then(([config, defaults, schema]) => ({ config, defaults, schema }));
  }

  saveConfig(config: JsonRecord, profile = 'default') {
    return this.json<{ ok: boolean }>('/api/config', 'PUT', { config }, { profile });
  }

  getEnvironment(profile = 'default') {
    return this.request<Record<string, JsonRecord>>('/api/env', { query: { profile } });
  }

  setEnvironmentVariable(key: string, value: string, profile = 'default') {
    return this.json<{ ok: boolean }>('/api/env', 'PUT', { key, value, profile });
  }

  deleteEnvironmentVariable(key: string, profile = 'default') {
    return this.json<{ ok: boolean }>('/api/env', 'DELETE', { key, profile });
  }

  getSystem() {
    return Promise.all([
      this.request<JsonRecord>('/api/status'),
      this.request<JsonRecord>('/api/system/stats'),
    ]).then(([status, stats]) => ({ status, stats }));
  }

  restartGateway() {
    return this.request<JsonRecord>('/api/gateway/restart', { method: 'POST' });
  }

  updateHermes() {
    return this.request<JsonRecord>('/api/hermes/update', { method: 'POST' });
  }

  getAchievements() {
    return this.request<JsonRecord>(`${ACHIEVEMENTS}/achievements`);
  }

  rescanAchievements() {
    return this.request<JsonRecord>(`${ACHIEVEMENTS}/rescan`, { method: 'POST' });
  }

  getKanbanBoard() {
    return this.request<JsonRecord>(`${KANBAN}/board`);
  }

  createKanbanTask(task: JsonRecord) {
    return this.json<JsonRecord>(`${KANBAN}/tasks`, 'POST', task);
  }

  updateKanbanTask(id: string, update: JsonRecord) {
    return this.json<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(id)}`, 'PATCH', update);
  }

  getCollaborationProfiles() {
    return this.request<{ profiles: CollaborationProfile[] }>(`${COLLABORATION}/profiles`);
  }

  getCollaborationRooms() {
    return this.request<{ rooms: JsonRecord[] }>(`${COLLABORATION}/rooms`);
  }

  getCollaborationRoom(id: string) {
    return this.request<{ room: JsonRecord }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}`,
    );
  }

  sendCollaborationRoomMessage(id: string, content: string, profiles: string[] = []) {
    return this.json<JsonRecord>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}/messages`,
      'POST',
      { content, profiles },
    );
  }

  routeMessage(content: string) {
    return this.json<RouteDecision>(`${COLLABORATION}/route`, 'POST', {
      content,
      mode: 'auto',
    });
  }

  getConversations() {
    return this.request<{ conversations: SingleConversation[] }>(
      `${COLLABORATION}/single/conversations`,
    );
  }

  getConversation(id: string) {
    return this.request<{ conversation: SingleConversation }>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(id)}`,
    );
  }

  createConversation(profile = 'default', title = '新对话') {
    return this.json<{ conversation: SingleConversation }>(
      `${COLLABORATION}/single/conversations`,
      'POST',
      { profile, title },
    );
  }

  deleteConversation(id: string) {
    return this.request<{ ok: boolean }>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  recordConversationMessage(id: string, message: CollaborationMessage) {
    return this.json<{ message: CollaborationMessage }>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(id)}/record`,
      'POST',
      message as unknown as JsonRecord,
    );
  }

  saveRuntimeSession(
    conversationId: string,
    profile: string,
    sessionId: string,
    turnId: string,
    status: 'completed' | 'running',
  ) {
    return this.json<JsonRecord>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}/runtime-session`,
      'POST',
      {
        profile,
        session_id: sessionId,
        turn_id: turnId,
        status,
      },
    );
  }

  createHostedTurn(
    conversationId: string,
    input: {
      turnId: string;
      content: string;
      title: string;
      profiles: string[];
      artifactRequired: boolean;
      attachmentContext?: string;
      deliveryContext?: string;
    },
  ) {
    return this.json<JsonRecord>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}/hosted-turns`,
      'POST',
      {
        turn_id: input.turnId,
        content: input.content,
        title: input.title,
        profiles: input.profiles,
        artifact_required: input.artifactRequired,
        attachment_context: input.attachmentContext || '',
        delivery_context: input.deliveryContext || '',
      },
    );
  }

  cancelHostedTurn(conversationId: string, turnId: string, reason: string) {
    return this.json<JsonRecord>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}/hosted-turns/${encodeURIComponent(turnId)}/cancel`,
      'POST',
      { reason },
    );
  }

  async uploadConversationAttachment(conversationId: string, upload: NativeUpload) {
    const body = upload.uri.startsWith('file:')
      ? await nativeFileBody(upload.uri)
      : await fetch(upload.uri).then((response) => response.blob());
    return this.request<JsonRecord>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}/attachments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': upload.mimeType || 'application/octet-stream',
          'X-Filename': encodeURIComponent(upload.name),
        },
        body,
      },
    );
  }

  async loadRoute(routeId: string, profile = 'default', selectedId = ''): Promise<unknown> {
    switch (routeId) {
      case 'sessions': {
        const sessions = await this.getSessions(50, 0, profile);
        if (!selectedId) return sessions;
        const messages = await this.getSessionMessages(selectedId, profile);
        return { ...sessions, selectedId, selectedMessages: messages.messages };
      }
      case 'files': {
        const listing = await this.listFiles();
        if (!selectedId) return listing;
        const selected = listing.entries.find((entry) => entry.path === selectedId);
        if (!selected) return listing;
        if (selected.is_directory) {
          const children = await this.listFiles(selectedId);
          return { ...listing, selectedId, selectedChildren: children.entries };
        }
        const preview = await this.readFile(selectedId);
        return { ...listing, selectedId, selectedPreview: preview };
      }
      case 'analytics': return this.getAnalytics(30, profile);
      case 'models': return this.getModels(profile);
      case 'logs': return this.getLogs();
      case 'cron': return this.getCronJobs(profile);
      case 'skills': {
        const skills = await this.getSkills(profile);
        if (!selectedId) return skills;
        const selected = await this.getSkillContent(selectedId, profile);
        return { ...skills, selectedId, selectedContent: selected };
      }
      case 'plugins': return this.getPlugins();
      case 'mcp': return this.getMcp(profile);
      case 'pairing': return this.getPairing();
      case 'channels': return this.getChannels(profile);
      case 'webhooks': return this.getWebhooks();
      case 'profiles':
      case 'profile-new': return this.getProfiles();
      case 'config': return this.getConfig(profile);
      case 'env': return this.getEnvironment(profile);
      case 'system': return this.getSystem();
      case 'achievements': return this.getAchievements();
      case 'kanban': return this.getKanbanBoard();
      case 'collaboration': return Promise.all([
        this.getCollaborationRooms(),
        this.getCollaborationProfiles(),
      ]).then(async ([rooms, profiles]) => {
        const fallbackId = rooms.rooms.find((room) => typeof room.id === 'string')?.id;
        const roomId = selectedId || (typeof fallbackId === 'string' ? fallbackId : '');
        const selected = roomId
          ? await this.getCollaborationRoom(roomId)
          : { room: null };
        return { ...rooms, ...profiles, ...selected };
      });
      default: return Promise.resolve({});
    }
  }

  private json<T>(
    path: string,
    method: 'DELETE' | 'PATCH' | 'POST' | 'PUT',
    body: JsonRecord,
    options: HermesRequestOptions = {},
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method,
      headers: {
        ...headersToObject(options.headers),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
}

async function nativeFileBody(uri: string): Promise<Blob> {
  const { File: ExpoFile } = await import('expo-file-system');
  const file = new ExpoFile(uri);
  if (!file.exists) throw new Error('Selected attachment is no longer available');
  return file;
}

function headersToObject(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}
