import type { HermesApiClient, HermesRequestOptions } from './HermesApiClient';
import { normalizeOfficialSessionMessages } from './official-session-adoption';

export type JsonRecord = Record<string, unknown>;

export const RUNTIME_RUN_FRESHNESS_MS = 30 * 60 * 1_000;
export const HOSTED_TURN_FRESHNESS_MS = 36 * 60 * 60 * 1_000;

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
  profile?: string;
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

export interface AccountFileEntry {
  id: string;
  name: string;
  sha256: string;
  mime_type: string;
  extension: string;
  file_type: string;
  size: number;
  source: 'model_output' | 'user_upload';
  status: 'available' | 'failed' | 'uploading';
  conversation_id?: string;
  message_id?: string;
  turn_id?: string;
  profile?: string;
  error?: string;
  created_at: number;
  updated_at: number;
  available_at?: number;
  download_url: string;
}

export interface AccountFilesResponse {
  files: AccountFileEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AccountFilesQuery {
  dateFrom?: string;
  dateTo?: string;
  fileType?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
  source?: string;
  status?: string;
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
  activities?: JsonRecord[];
  activity_count?: number;
  attachments?: JsonRecord[];
  avatar?: string;
  avatar_symbol?: string;
  completed_at?: number | string;
  status?: string;
  kind?: string;
  created_at?: number | string;
  handoff_to?: string | string[];
  metadata?: JsonRecord;
  model?: string;
  profile?: string;
  provider?: string;
  role_label?: string;
  collaboration_role?: string;
  sender?: string;
  sender_id?: string;
  sender_name?: string;
  sender_role?: string;
  started_at?: number | string;
  timestamp?: number | string;
  updated_at?: number | string;
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
  official_session_id?: string;
  official_profile?: string;
  official_model?: string;
  preview?: string;
}

export interface RouteDecision extends JsonRecord {
  mode: 'chat' | 'work';
  label: string;
  title: string;
  reason: string;
  confidence: number;
  source: string;
  profiles: string[];
  artifact_required: boolean;
}

export interface HostedTurnEnqueueInput {
  requestId: string;
  turnId: string;
  message: CollaborationMessage;
  recentMessages: Array<Pick<CollaborationMessage, 'content' | 'role'>>;
  profiles?: string[];
  attachmentIds?: string[];
  attachmentContext?: string;
  deliveryContext?: string;
}

export interface HostedTurnEnqueueResponse {
  accepted: boolean;
  replayed: boolean;
  request_id: string;
  conversation_id: string;
  message: CollaborationMessage;
  route: RouteDecision;
  route_message?: CollaborationMessage;
  hosted_turn: JsonRecord;
}

export interface NativeUpload {
  name: string;
  mimeType?: string | null;
  uri: string;
}

export interface ConversationAttachmentUploadContext {
  messageId?: string;
  profile?: string;
  turnId?: string;
  uploadId: string;
}

export interface CustomModelConfiguration {
  apiKey?: string;
  apiKeyConfigured?: boolean;
  apiKeyPreview?: string;
  apiMode: 'anthropic_messages' | 'chat_completions' | 'codex_responses';
  baseUrl: string;
  contextLength: number;
  model: string;
  reasoningEffort: 'high' | 'low' | 'max' | 'medium' | 'minimal' | 'none' | 'ultra' | 'xhigh';
}

export interface CustomModelDiscoveryResult {
  baseUrl: string;
  models: string[];
}

export interface CustomModelConnectionResult {
  latency_ms: number;
  message: string;
  ok: boolean;
  reachable: boolean;
  status: number;
}

const COLLABORATION = '/api/plugins/collaboration';
const KANBAN = '/api/plugins/kanban';
const ACHIEVEMENTS = '/api/plugins/hermes-achievements';
const MODEL_CATALOG_MAX_BYTES = 1024 * 1024;

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

  async getAllSessions(profile = 'default', pageSize = 100) {
    const sessions: SessionSummary[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const page = await this.getSessions(pageSize, offset, profile);
      const entries = Array.isArray(page.sessions) ? page.sessions : [];
      sessions.push(...entries);
      total = Number.isFinite(page.total) ? Math.max(0, page.total) : sessions.length;
      if (!entries.length || entries.length < pageSize) break;
      offset += entries.length;
    }
    return { sessions, total: sessions.length, limit: pageSize, offset: 0 };
  }

  getProfileSessions(limit = 100, offset = 0) {
    return this.request<PaginatedSessions>('/api/profiles/sessions', {
      query: {
        archived: 'exclude',
        limit,
        min_messages: 0,
        offset,
        order: 'recent',
        profile: 'all',
      },
    });
  }

  async getAllProfileSessions(pageSize = 100) {
    const sessions: SessionSummary[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const page = await this.getProfileSessions(pageSize, offset);
      const entries = Array.isArray(page.sessions) ? page.sessions : [];
      sessions.push(...entries);
      total = Number.isFinite(page.total) ? Math.max(0, page.total) : sessions.length;
      if (!entries.length || entries.length < pageSize) break;
      offset += entries.length;
    }
    return { sessions, total: sessions.length, limit: pageSize, offset: 0 };
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
      this.getModelInfo(profile),
      this.getModelOptions(profile),
      this.getCustomModel(profile),
    ]).then(([info, options, custom]) => ({ custom, info, options }));
  }

  getModelInfo(profile = 'default') {
    return this.request<JsonRecord>('/api/model/info', { profile });
  }

  getModelOptions(profile = 'default') {
    return this.request<JsonRecord>('/api/model/options', {
      profile,
      query: { include_unconfigured: 1 },
    });
  }

  async getCustomModel(profile = 'default'): Promise<CustomModelConfiguration> {
    const value = await this.request<JsonRecord>('/api/model/custom', { profile });
    return {
      apiKeyConfigured: value.api_key_configured === true,
      apiKeyPreview: stringValue(value.api_key_preview),
      apiMode: customApiMode(value.api_mode),
      baseUrl: stringValue(value.base_url),
      contextLength: numberValue(value.context_length),
      model: stringValue(value.model),
      reasoningEffort: customReasoningEffort(value.reasoning_effort),
    };
  }

  saveCustomModel(configuration: CustomModelConfiguration, profile = 'default') {
    const baseUrl = normalizeModelCatalogBaseUrl(configuration.baseUrl);
    return this.json<JsonRecord>('/api/model/custom', 'PUT', {
      api_key: configuration.apiKey || '',
      api_mode: configuration.apiMode,
      base_url: baseUrl,
      context_length: configuration.contextLength,
      model: configuration.model,
      reasoning_effort: configuration.reasoningEffort,
      profile,
    });
  }

  testCustomModel(configuration: CustomModelConfiguration, profile = 'default') {
    const baseUrl = normalizeModelCatalogBaseUrl(configuration.baseUrl);
    return this.json<CustomModelConnectionResult>('/api/model/custom/test', 'POST', {
      api_key: configuration.apiKey || '',
      api_mode: configuration.apiMode,
      base_url: baseUrl,
      model: configuration.model,
      profile,
    });
  }

  async discoverCustomModels(
    baseUrl: string,
    apiKey = '',
  ): Promise<CustomModelDiscoveryResult> {
    const normalizedBaseUrl = normalizeModelCatalogBaseUrl(baseUrl);
    const endpoint = normalizedBaseUrl.endsWith('/models')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/models`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey.trim()) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
        headers['x-api-key'] = apiKey.trim();
      }
      const response = await fetchModelCatalog(endpoint, {
        headers,
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
      });
      // Some React Native transports have historically ignored the Fetch
      // redirect mode. Do not trust a successful response until its final URL
      // is checked: a temporary model key must never be accepted after a
      // cross-origin redirect.
      assertModelCatalogResponseOrigin(response, endpoint);
      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? '模型服务拒绝了 API 密钥'
            : `模型列表请求返回 HTTP ${response.status}`,
        );
      }
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(declaredLength) && declaredLength > MODEL_CATALOG_MAX_BYTES) {
        throw new Error('模型列表响应超过 1 MiB');
      }
      const text = await readBoundedResponseText(response, MODEL_CATALOG_MAX_BYTES);
      const payload: unknown = JSON.parse(text);
      const root = isRecord(payload) ? payload : {};
      const rows = Array.isArray(root.data)
        ? root.data
        : Array.isArray(root.models)
          ? root.models
          : [];
      const models = [...new Set(rows.flatMap((entry): string[] => {
        const model = typeof entry === 'string'
          ? entry.trim()
          : isRecord(entry)
            ? stringValue(entry.id) || stringValue(entry.name)
            : '';
        return model && model.length <= 256 ? [model] : [];
      }))].slice(0, 500);
      if (!models.length) throw new Error('模型服务没有返回可用模型');
      return { baseUrl: normalizedBaseUrl, models };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('模型列表请求超时');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
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

  getModelCredentials(profile = 'default') {
    return this.request<{ credentials: JsonRecord[] }>('/api/model/credentials', {
      query: { profile },
    });
  }

  deleteModelCredential(id: string, profile = 'default') {
    return this.request<{ ok: boolean; removed: boolean }>(
      `/api/model/credentials/${encodeURIComponent(id)}`,
      { method: 'DELETE', query: { profile } },
    );
  }

  getSystem() {
    return Promise.all([
      this.request<JsonRecord>('/api/status'),
      this.request<JsonRecord>('/api/system/stats'),
      this.request<JsonRecord>('/api/managed-nodes/status'),
    ]).then(([status, stats, managedNodes]) => ({ managedNodes, status, stats }));
  }

  recoverManagedNodes(nodeId = '') {
    return this.json<JsonRecord>('/api/managed-nodes/recover', 'POST', {
      node_id: nodeId,
    });
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

  createCollaborationRoom(name: string, profiles: string[]) {
    return this.json<{ room: JsonRecord }>(`${COLLABORATION}/rooms`, 'POST', {
      name,
      profiles,
    });
  }

  deleteCollaborationRoom(id: string) {
    return this.request<{ ok: boolean }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  getCollaborationRoom(id: string) {
    return this.request<{ room: JsonRecord }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}`,
    );
  }

  sendCollaborationRoomMessage(
    id: string,
    content: string,
    profiles: string[] = [],
    requestId = createCollaborationRoomRequestId(),
  ) {
    const stableRequestId = requestId.trim() || createCollaborationRoomRequestId();
    const turnSuffix = stableRequestId.startsWith('room-request-')
      ? stableRequestId.slice('room-request-'.length)
      : stableRequestId;
    return this.json<JsonRecord>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}/messages`,
      'POST',
      {
        content,
        profiles,
        request_id: stableRequestId,
        turn_id: `room-turn-${turnSuffix}`,
      },
    );
  }

  routeMessage(
    content: string,
    recentMessages: Array<Pick<CollaborationMessage, 'content' | 'role'>> = [],
    attachments: JsonRecord[] = [],
  ) {
    return this.json<RouteDecision>(`${COLLABORATION}/route`, 'POST', {
      attachments,
      content,
      mode: 'auto',
      recent_messages: recentMessages,
    });
  }

  getAccountFiles(query: AccountFilesQuery = {}) {
    return this.request<AccountFilesResponse>(`${COLLABORATION}/files`, {
      query: {
        date_from: query.dateFrom,
        date_to: query.dateTo,
        limit: query.limit ?? 200,
        offset: query.offset ?? 0,
        q: query.keyword,
        source: query.source,
        status: query.status,
        type: query.fileType,
      },
    });
  }

  async getAllAccountFiles(query: AccountFilesQuery = {}) {
    const pageSize = Math.max(1, Math.min(200, Math.trunc(query.limit || 200)));
    const startOffset = Math.max(0, Math.trunc(query.offset || 0));
    const files = new Map<string, AccountFileEntry>();
    let offset = startOffset;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const page = await this.getAccountFiles({ ...query, limit: pageSize, offset });
      const entries = Array.isArray(page.files) ? page.files : [];
      for (const entry of entries) {
        if (entry?.id) files.set(entry.id, entry);
      }
      total = Number.isFinite(page.total)
        ? Math.max(0, page.total)
        : offset + entries.length;
      if (!entries.length || offset + entries.length >= total) break;
      offset += entries.length;
    }
    const allFiles = [...files.values()];
    return {
      files: allFiles,
      total: allFiles.length,
      limit: pageSize,
      offset: startOffset,
    } satisfies AccountFilesResponse;
  }

  getAccountFile(id: string) {
    return this.request<{ file: AccountFileEntry }>(
      `${COLLABORATION}/files/${encodeURIComponent(id)}`,
    );
  }

  deleteAccountFile(id: string) {
    return this.request<{ id: string; ok: boolean }>(
      `${COLLABORATION}/files/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  downloadAccountFile(id: string, preview = false) {
    return this.client.download(
      `${COLLABORATION}/files/${encodeURIComponent(id)}/download`,
      { query: { preview: preview || undefined } },
    );
  }

  async uploadAccountFile(upload: NativeUpload) {
    const body = upload.uri.startsWith('file:')
      ? await nativeFileBody(upload.uri)
      : await fetch(upload.uri).then((response) => response.blob());
    return this.request<{ file: AccountFileEntry }>(`${COLLABORATION}/files`, {
      body,
      headers: {
        'Content-Type': upload.mimeType || 'application/octet-stream',
        'X-Filename': encodeURIComponent(upload.name),
      },
      method: 'POST',
    });
  }

  getConversations() {
    return this.request<{ conversations: SingleConversation[] }>(
      `${COLLABORATION}/single/conversations`,
    );
  }

  async getUnifiedConversations(profile = 'default') {
    // Profile session history is a process-wide server resource and is not
    // account-scoped on older Hermes deployments.  Merging it here leaks
    // other accounts' sessions and produces 404s when adoption is attempted.
    // Account conversations already carry their profile and runtime metadata,
    // so they are the only safe source for the default history surface.
    const cloud = await this.getConversations();
    return {
      conversations: cloud.conversations,
    };
  }

  getConversation(id: string) {
    return this.request<{ conversation: SingleConversation }>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(id)}`,
    );
  }

  createConversation(profile = 'default', title = '新对话', clientId = '') {
    return this.json<{ conversation: SingleConversation }>(
      `${COLLABORATION}/single/conversations`,
      'POST',
      { client_id: clientId || undefined, profile, title },
    );
  }

  async adoptOfficialConversation(sessionId: string, profile = 'default', title = '') {
    const placeholder = parseOfficialConversationPlaceholderId(sessionId);
    const normalizedSessionId = (
      placeholder?.sessionId || sessionId.replace(/^official:/, '')
    ).trim();
    if (!normalizedSessionId) throw new Error('Official Hermes session id is required');
    const adoptionProfile = placeholder?.profile || profile.trim() || 'default';
    const [detail, messageData] = await Promise.all([
      this.getSession(normalizedSessionId, adoptionProfile),
      this.getSessionMessages(normalizedSessionId, adoptionProfile),
    ]);
    const messages = normalizeOfficialSessionMessages(
      messageData.messages,
      adoptionProfile,
      normalizedSessionId,
    );
    const firstUser = messages.find((message) => message.role === 'user' && message.content);
    return this.json<{ conversation: SingleConversation; created: boolean }>(
      `${COLLABORATION}/single/conversations/adopt`,
      'POST',
      {
        messages,
        profile: adoptionProfile,
        session_id: normalizedSessionId,
        title: stringValue(detail.title) || title || firstUser?.content.slice(0, 36) || '历史会话',
      },
    );
  }

  deleteConversation(id: string) {
    return this.request<{ ok: boolean }>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  renameConversation(id: string, title: string) {
    return this.json<{ conversation: SingleConversation }>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(id)}`,
      'PATCH',
      { title },
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
    status: 'completed' | 'failed' | 'running',
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
      attachmentIds?: string[];
      attachmentContext?: string;
      deliveryContext?: string;
      mode: RouteDecision['mode'];
      routeMetadata: JsonRecord;
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
        attachment_ids: input.attachmentIds || [],
        attachment_context: input.attachmentContext || '',
        delivery_context: input.deliveryContext || '',
        mode: input.mode,
        route_metadata: input.routeMetadata,
      },
    );
  }

  enqueueHostedTurn(conversationId: string, input: HostedTurnEnqueueInput) {
    return this.json<HostedTurnEnqueueResponse>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}/enqueue`,
      'POST',
      {
        request_id: input.requestId,
        turn_id: input.turnId,
        message: input.message as unknown as JsonRecord,
        profiles: input.profiles,
        recent_messages: input.recentMessages,
        attachment_ids: input.attachmentIds || [],
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

  async uploadConversationAttachment(
    conversationId: string,
    upload: NativeUpload,
    context: ConversationAttachmentUploadContext,
  ) {
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
          'X-Message-ID': context.messageId || '',
          'X-Profile': context.profile || '',
          'X-Turn-ID': context.turnId || '',
          'X-Upload-ID': context.uploadId,
        },
        body,
      },
    );
  }

  downloadConversationAttachment(downloadUrl: string) {
    if (!downloadUrl.startsWith(`${COLLABORATION}/single/conversations/`)) {
      throw new Error('Invalid conversation attachment URL');
    }
    return this.client.download(downloadUrl);
  }

  async loadRoute(routeId: string, profile = 'default', selectedId = ''): Promise<unknown> {
    switch (routeId) {
      case 'sessions': {
        const result = await this.getUnifiedConversations(profile);
        const sessions = result.conversations.map(conversationSessionSummary);
        return {
          sessions,
          total: sessions.length,
          limit: sessions.length,
          offset: 0,
        };
      }
      case 'files': {
        return this.getAllAccountFiles();
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
      case 'env': return this.getModelCredentials(profile);
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

export function mergeUnifiedConversationIndex(
  conversations: readonly SingleConversation[],
  officialSessions: readonly SessionSummary[],
  profile = 'default',
): SingleConversation[] {
  const mappedSessionIds = new Set<string>();
  for (const conversation of conversations) {
    if (conversation.official_session_id) {
      mappedSessionIds.add(
        `${conversation.official_profile || conversation.profile || profile}:${conversation.official_session_id}`,
      );
    }
    for (const [sessionProfile, sessionId] of Object.entries(conversation.runtime_sessions || {})) {
      if (sessionId) mappedSessionIds.add(`${sessionProfile}:${sessionId}`);
    }
  }
  const officialConversations = officialSessions.flatMap((session): SingleConversation[] => {
    const sessionProfile = session.profile?.trim() || profile;
    if (!session.id || mappedSessionIds.has(`${sessionProfile}:${session.id}`)) return [];
    return [{
      id: officialConversationPlaceholderId(sessionProfile, session.id),
      profile: sessionProfile,
      title: session.title?.trim() || session.preview?.trim() || '官方会话',
      messages: [],
      message_count: Math.max(0, numberValue(session.message_count)),
      runtime_sessions: {},
      created_at: secondsToMilliseconds(session.started_at),
      updated_at: secondsToMilliseconds(session.last_active || session.started_at),
      official_session_id: session.id,
      official_profile: sessionProfile,
      official_model: session.model || undefined,
      preview: session.preview || undefined,
    }];
  });
  return [...conversations, ...officialConversations].sort(
    (left, right) => numberValue(right.updated_at) - numberValue(left.updated_at),
  );
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

function newClientRequestId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  const random = uuid || [0, 1, 2, 3]
    .map(() => Math.random().toString(36).slice(2, 12))
    .join('');
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function officialConversationPlaceholderId(profile: string, sessionId: string): string {
  const normalizedProfile = profile.trim() || 'default';
  const normalizedSessionId = sessionId.trim();
  const checksum = officialEnvelopeChecksum(`${normalizedProfile}\u0000${normalizedSessionId}`);
  return [
    'official:v3',
    encodeURIComponent(normalizedProfile),
    encodeURIComponent(normalizedSessionId),
    checksum,
  ].join(':');
}

export function parseOfficialConversationPlaceholderId(
  value: string,
): { profile: string; sessionId: string } | null {
  if (!value.startsWith('official:')) return null;
  const encoded = value.slice('official:'.length);
  if (!encoded.startsWith('v3:')) return { profile: '', sessionId: encoded };
  const versioned = encoded.slice('v3:'.length);
  const firstSeparator = versioned.indexOf(':');
  const lastSeparator = versioned.lastIndexOf(':');
  if (firstSeparator <= 0 || lastSeparator <= firstSeparator) {
    return { profile: '', sessionId: encoded };
  }
  const profile = decodeURIComponentSafely(versioned.slice(0, firstSeparator)).trim();
  const sessionId = decodeURIComponentSafely(
    versioned.slice(firstSeparator + 1, lastSeparator),
  ).trim();
  const checksum = versioned.slice(lastSeparator + 1);
  if (!profile || !sessionId || checksum !== officialEnvelopeChecksum(`${profile}\u0000${sessionId}`)) {
    return { profile: '', sessionId: encoded };
  }
  return {
    profile,
    sessionId,
  };
}

function officialEnvelopeChecksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createCollaborationRoomRequestId(): string {
  return newClientRequestId('room-request');
}

export function conversationSessionSummary(
  conversation: SingleConversation,
  now = Date.now(),
): SessionSummary {
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const latestVisible = [...messages].reverse().find((message) => (
    message.role === 'assistant' || message.role === 'user'
  ));
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const meta = {
    ...(isRecord(latestAssistant?.metadata) ? latestAssistant.metadata : {}),
    ...(isRecord(latestAssistant?.meta) ? latestAssistant.meta : {}),
  };
  const provider = stringValue(latestAssistant?.provider)
    || stringValue(meta.actual_provider);
  const model = stringValue(latestAssistant?.model)
    || stringValue(meta.actual_model);
  const createdAt = numberValue(conversation.created_at);
  const updatedAt = numberValue(conversation.updated_at) || createdAt;
  const running = hasRunningConversationRecord(
    conversation.runtime_runs,
    RUNTIME_RUN_FRESHNESS_MS,
    now,
  ) || hasRunningConversationRecord(
    conversation.hosted_turns,
    HOSTED_TURN_FRESHNESS_MS,
    now,
  );
  return {
    id: conversation.id,
    profile: conversation.official_profile || conversation.profile,
    source: conversation.official_session_id ? 'official' : 'ios-unified',
    model: conversation.official_model
      || [provider, model].filter(Boolean).join('/')
      || null,
    title: conversation.title || null,
    started_at: createdAt,
    ended_at: running ? null : updatedAt,
    last_active: updatedAt,
    is_active: running,
    message_count: numberValue(conversation.message_count) || messages.length,
    tool_call_count: messages.reduce((count, message) => {
      const messageMeta = {
        ...(isRecord(message.metadata) ? message.metadata : {}),
        ...(isRecord(message.meta) ? message.meta : {}),
      };
      const activities = Array.isArray(message.activities)
        ? message.activities
        : Array.isArray(messageMeta.activities)
          ? messageMeta.activities
          : [];
      return count + activities.filter((activity) => (
        isRecord(activity)
        && !['handoff', 'model', 'reasoning', 'status'].includes(
          stringValue(activity.category || activity.kind).toLowerCase(),
        )
      )).length;
    }, 0),
    input_tokens: 0,
    output_tokens: 0,
    preview: latestVisible?.content || conversation.preview || null,
  };
}

function hasRunningConversationRecord(
  value?: Record<string, JsonRecord>,
  freshnessMs = RUNTIME_RUN_FRESHNESS_MS,
  now = Date.now(),
): boolean {
  return Object.values(value || {}).some(
    (entry) => runningConversationRecordIsFresh(entry, freshnessMs, now),
  );
}

export function runningConversationRecordIsFresh(
  entry: JsonRecord,
  freshnessMs: number,
  now = Date.now(),
): boolean {
  const status = stringValue(entry.status).toLowerCase();
  if (!['pending', 'queued', 'running', 'starting', 'streaming'].includes(status)) {
    return false;
  }
  const leaseExpiresAt = recordTimestamp(entry.lease_expires_at);
  if (leaseExpiresAt > 0) return leaseExpiresAt > now;
  const latestActivity = Math.max(
    recordTimestamp(entry.heartbeat_at),
    recordTimestamp(entry.updated_at),
    recordTimestamp(entry.started_at),
    recordTimestamp(entry.created_at),
  );
  return latestActivity > 0
    && now - latestActivity < freshnessMs;
}

function customApiMode(value: unknown): CustomModelConfiguration['apiMode'] {
  return value === 'anthropic_messages' || value === 'codex_responses'
    ? value
    : 'chat_completions';
}

function customReasoningEffort(value: unknown): CustomModelConfiguration['reasoningEffort'] {
  const normalized = stringValue(value);
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(normalized)
    ? normalized as CustomModelConfiguration['reasoningEffort']
    : 'medium';
}

function normalizeModelCatalogBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Base URL 格式无效');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
  ) {
    throw new Error('Base URL 必须是不含账号信息的 HTTP(S) 地址');
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw new Error('HTTP 模型地址仅限本机回环；局域网或公网模型必须使用 HTTPS');
  }
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function assertModelCatalogResponseOrigin(response: Response, endpoint: string): void {
  // A mocked/native Response may omit `url`; in that case the transport did
  // not expose redirect information and the request's redirect:error policy
  // remains the only available guard. When present, reject any final origin
  // change, including scheme/port changes and URLs carrying userinfo.
  const finalUrl = response.url?.trim();
  if (!finalUrl) return;
  let requested: URL;
  let received: URL;
  try {
    requested = new URL(endpoint);
    received = new URL(finalUrl);
  } catch {
    throw new Error('模型列表响应地址无效');
  }
  if (
    requested.origin !== received.origin
    || received.username
    || received.password
  ) {
    throw new Error('模型列表请求重定向到不受信任的地址');
  }
}

async function fetchModelCatalog(endpoint: string, init: RequestInit): Promise<Response> {
  // Expo's native fetch is backed by URLSession and exposes a real streaming
  // body. It also enforces redirect:error in the native delegate, which closes
  // the credential-forwarding gap in React Native's legacy global fetch. Keep
  // the global implementation on web/tests where standard Fetch already has
  // these semantics and remains easy to substitute.
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    const { fetch: expoFetch } = await import('expo/fetch');
    return expoFetch(
      endpoint,
      init as Parameters<typeof expoFetch>[1],
    ) as unknown as Response;
  }
  return fetch(endpoint, init);
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  const reader = body && typeof body.getReader === 'function'
    ? body.getReader()
    : null;
  if (!reader) {
    // Older React Native releases do not expose a ReadableStream. The
    // content-length guard above still rejects honest oversized responses;
    // this fallback preserves compatibility for transports that only expose
    // Response.text().
    const text = await response.text();
    if (utf8ByteLength(text) > maxBytes) {
      throw new Error('模型列表响应超过 1 MiB');
    }
    return text;
  }

  const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const value = part.value instanceof Uint8Array
        ? part.value
        : new Uint8Array(part.value);
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('模型列表响应超过 1 MiB');
      }
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* transport already closed */ }
    throw error;
  }

  if (decoder) {
    let text = '';
    for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
    return text + decoder.decode();
  }

  // TextDecoder is absent on a few older Hermes runtimes. Preserve bytes and
  // decode through a bounded Blob when available; otherwise use the portable
  // byte-to-string fallback (JSON model ids are overwhelmingly UTF-8 ASCII).
  const blob = typeof Blob !== 'undefined'
    ? new Blob(chunks as unknown as BlobPart[], { type: 'application/json' })
    : null;
  if (blob) return blob.text();
  return String.fromCharCode(...chunks.flatMap((chunk) => Array.from(chunk)));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) || 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function secondsToMilliseconds(value: unknown): number {
  const number = numberValue(value);
  if (!number) return 0;
  return number < 10_000_000_000 ? number * 1000 : number;
}

function recordTimestamp(value: unknown): number {
  const numeric = numberValue(value);
  if (numeric > 0) return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
