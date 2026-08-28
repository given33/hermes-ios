import type { HermesCloudTransport, JsonRecord } from './transport';

/** Miscellaneous upstream Dashboard/Operations surfaces kept off the facade. */
export class HermesOperationsCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}
  getMedia(path = '') { return this.transport.request<JsonRecord>('/api/media', { query: { path: path || undefined } }); }
  uploadChatImage(dataUrl: string, mimeType: string, filename = 'image') { return this.transport.json<JsonRecord>('/api/chat/image-upload', 'POST', { data_url: dataUrl, mime_type: mimeType, filename }); }
  getPortal() { return this.transport.request<JsonRecord>('/api/portal'); }
  getCurator() { return this.transport.request<JsonRecord>('/api/curator'); }
  setCuratorPaused(paused: boolean) { return this.transport.json<JsonRecord>('/api/curator/paused', 'PUT', { paused }); }
  runCurator() { return this.transport.request<JsonRecord>('/api/curator/run', { method: 'POST' }); }
  getLearningGraph(profile = 'default') { return this.transport.request<JsonRecord>('/api/learning/graph', { query: { profile } }); }
  getLearningNode(id: string, profile = 'default') { return this.transport.request<JsonRecord>('/api/learning/node', { query: { id, profile } }); }
  updateLearningNode(node: JsonRecord, profile = 'default') { return this.transport.json<JsonRecord>('/api/learning/node', 'PUT', { ...node, profile }); }
  deleteLearningNode(id: string, profile = 'default') { return this.transport.json<JsonRecord>('/api/learning/node', 'DELETE', { id, profile }); }
  promptSize(_payload: JsonRecord = {}) { return this.transport.request<JsonRecord>('/api/ops/prompt-size', { method: 'POST' }); }
  dumpDiagnostics(_payload: JsonRecord = {}) { return this.transport.request<JsonRecord>('/api/ops/dump', { method: 'POST' }); }
  migrateConfig(_payload: JsonRecord = {}) { return this.transport.request<JsonRecord>('/api/ops/config-migrate', { method: 'POST' }); }
  createDebugShare(payload: JsonRecord = {}) { return this.transport.json<JsonRecord>('/api/ops/debug-share', 'POST', payload); }
  runDoctor(payload: JsonRecord = {}) { return this.transport.json<JsonRecord>('/api/ops/doctor', 'POST', payload); }
  runSecurityAudit(payload: JsonRecord = {}) { return this.transport.json<JsonRecord>('/api/ops/security-audit', 'POST', payload); }
  createBackup(payload: JsonRecord = {}) { return this.transport.json<JsonRecord>('/api/ops/backup', 'POST', payload); }
  downloadBackup(archive: string) { return this.transport.download('/api/ops/backup/download', { query: { archive } }); }
  importBackup(payload: JsonRecord) { return this.transport.json<JsonRecord>('/api/ops/import', 'POST', payload); }
  uploadImport(upload: { uri: string; name: string; mimeType?: string }, force = false) {
    const form = new FormData();
    form.append('force', String(force));
    form.append('file', { name: upload.name, type: upload.mimeType || 'application/zip', uri: upload.uri } as unknown as Blob);
    return this.transport.request<JsonRecord>('/api/ops/import-upload', { method: 'POST', body: form });
  }
  getHooks() { return this.transport.request<JsonRecord>('/api/ops/hooks'); }
  createHook(payload: JsonRecord) { return this.transport.json<JsonRecord>('/api/ops/hooks', 'POST', payload); }
  deleteHook(payload: JsonRecord) { return this.transport.json<JsonRecord>('/api/ops/hooks', 'DELETE', payload); }
  getCheckpoints() { return this.transport.request<JsonRecord>('/api/ops/checkpoints'); }
  pruneCheckpoints(payload: JsonRecord = {}) { return this.transport.json<JsonRecord>('/api/ops/checkpoints/prune', 'POST', payload); }
  getRawConfig(profile = 'default') { return this.transport.request<JsonRecord>('/api/config/raw', { query: { profile } }); }
  saveRawConfig(yamlText: string, profile = 'default') { return this.transport.json<JsonRecord>('/api/config/raw', 'PUT', { yaml_text: yamlText, profile }, { query: { profile } }); }
  getDashboardThemes() { return this.transport.request<JsonRecord>('/api/dashboard/themes'); }
  setDashboardTheme(theme: string) { return this.transport.json<JsonRecord>('/api/dashboard/theme', 'PUT', { name: theme }); }
  getDashboardFont() { return this.transport.request<JsonRecord>('/api/dashboard/font'); }
  setDashboardFont(font: string) { return this.transport.json<JsonRecord>('/api/dashboard/font', 'PUT', { font }); }
  getUsageAnalytics(days = 30, profile = 'default') { return this.transport.request<JsonRecord>('/api/analytics/usage', { query: { days, profile } }); }
  getModelAnalytics(days = 30, profile = 'default') { return this.transport.request<JsonRecord>('/api/analytics/models', { query: { days, profile } }); }
  getActionStatus(name: string, lines = 200, profile = '') {
    return this.transport.request<JsonRecord>(`/api/actions/${encodeURIComponent(name)}/status`, {
      query: { lines: String(Math.max(1, Math.floor(lines))), profile: profile || undefined },
    });
  }
}
