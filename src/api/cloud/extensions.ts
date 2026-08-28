import type { HermesCloudTransport, JsonRecord } from './transport';
import { ManagedResourceCatalogController } from '../managed-resource-catalog';

/**
 * Capability-extension endpoints: skills, managed installations, plugins,
 * and MCP servers (the SwiftUI `skills` / `plugins` / `mcp` routes).
 *
 * Reached only through the `HermesCloudApi` facade, which delegates the
 * identically named public methods here. Endpoint paths, verbs, and payload
 * shapes are pinned by tests/cloud-api-domains.test.ts — moving a method must
 * not change its wire contract.
 */
// A type alias (not an interface) so it keeps the implicit index signature
// the original inline parameter type had when converting to JsonRecord.
export type ManagedInstallationRequest = {
  identifier: string;
  kind: 'mcp' | 'project' | 'skill';
  locality?: 'ios-relay' | 'network' | 'node' | 'portable' | 'server' | 'workers';
  profile?: string;
  project_name?: string;
  source_ref?: string;
  request_id: string;
  scope?: 'auto' | 'fleet' | 'server' | 'workers';
  targets?: readonly ('dbb3' | 'server' | 'wsl' | 'hk')[];
};

export interface ManagedResourceRecord {
  resource_id: string;
  kind: 'mcp' | 'project' | 'skill';
  name: string;
  source_type: 'builtin' | 'git' | 'local' | 'managed' | 'npm';
  source_uri: string;
  source_ref: string;
  resolved_commit_or_version: string;
  content_hash: string;
  scope: 'account' | 'node' | 'project' | 'server';
  target_nodes: string[];
  loaded_nodes: string[];
  aggregate_state: 'failed' | 'partial' | 'pending' | 'rolled_back' | 'verified';
  node_receipts: Record<string, JsonRecord>;
  policy_version: string;
  tree_sha: string;
  tools: string[];
  permissions: string[];
  last_verified_at: string;
  rollback_available: boolean;
  enabled: boolean;
  trust_state: string;
  health: string;
  conflicts: JsonRecord[];
  installed_at: string;
  updated_at: string;
  operation_id: string;
}

export interface ManagedResourceCatalog {
  account_generation: string;
  resources: ManagedResourceRecord[];
  diagnostics: JsonRecord[];
  events: Array<{ cursor: number; resource: ManagedResourceRecord; created_at: string }>;
  cursor: number;
  reset_cursor?: boolean;
  reset_reason?: string;
  has_more: boolean;
}

export interface McpServerTestResult {
  ok: boolean;
  error?: string;
  tools: Array<{ name: string; description: string; schema_chars?: number }>;
  prompts?: number;
  resources?: number;
}

export interface McpCatalogInstallResult {
  ok: boolean;
  name: string;
  background: boolean;
  action?: string;
}

export class HermesExtensionsCloudApi {
  constructor(
    private readonly transport: HermesCloudTransport,
    private readonly managedResources = new ManagedResourceCatalogController(),
  ) {}

  bindManagedResourceOwner(owner: string): void {
    this.managedResources.bindOwner(owner);
  }

  getSkills(profile = 'default') {
    return Promise.allSettled([
      this.transport.request<JsonRecord[]>('/api/skills', { profile }),
      this.transport.request<JsonRecord[]>('/api/tools/toolsets', { profile }),
      this.getManagedInstallations('skill', profile),
    ]).then(async ([skillsResult, toolsetsResult, installationsResult]) => {
      // Read operation state first. When a background install becomes terminal,
      // this same reload observes its catalog commit instead of waiting one poll.
      const resources = await this.getManagedResourceCatalog()
        .catch(() => emptyManagedResourceCatalog());
      const skills = skillsResult.status === 'fulfilled' ? skillsResult.value : [];
      const toolsets = toolsetsResult.status === 'fulfilled' ? toolsetsResult.value : [];
      const installations = installationsResult.status === 'fulfilled'
        ? installationsResult.value
        : { operations: [] };
      return {
        skills: mergeManagedSkills(skills, resources),
        toolsets,
        installations,
        resourceCatalog: resources,
      };
    });
  }

  getManagedResources(cursor = 0, limit = 500, signal?: AbortSignal) {
    return this.transport.request<ManagedResourceCatalog>(
      '/api/plugins/collaboration/managed-resources',
      { query: { cursor: String(Math.max(0, Math.floor(cursor))), limit: String(limit) }, signal },
    );
  }

  openManagedResourceEvents(cursor = 0, signal?: AbortSignal) {
    return this.transport.openEventStream(
      '/api/plugins/collaboration/managed-resources/events',
      { query: { cursor: String(Math.max(0, Math.floor(cursor))) }, signal },
    );
  }

  private getManagedResourceCatalog(limit = 500, signal?: AbortSignal) {
    return this.managedResources.refresh(
      (cursor, pageLimit, pageSignal) => this.getManagedResources(
        cursor,
        pageLimit,
        pageSignal,
      ),
      limit,
      signal,
    );
  }

  getManagedInstallations(kind = '', profile = 'default', limit = 50) {
    return this.transport.request<{ operations: JsonRecord[] }>(
      '/api/plugins/collaboration/managed-installations', {
      query: { kind, profile, limit: String(limit) },
      },
    );
  }

  createManagedInstallation(request: ManagedInstallationRequest) {
    return this.transport.json<{ accepted: boolean; operation: JsonRecord }>(
      '/api/plugins/collaboration/managed-installations',
      'POST',
      request as JsonRecord,
    );
  }

  rollbackManagedInstallation(operationId: string, requestId: string) {
    return this.transport.json<{ accepted: boolean; operation: JsonRecord }>(
      `/api/plugins/collaboration/managed-installations/${encodeURIComponent(operationId)}/rollback`,
      'POST',
      { request_id: requestId },
    );
  }

  toggleSkill(name: string, enabled: boolean, profile = 'default') {
    return this.transport.json<{ ok: boolean }>('/api/skills/toggle', 'PUT', {
      name,
      enabled,
      profile,
    });
  }

  createSkill(
    name: string,
    content: string,
    category = '',
    profile = 'default',
  ) {
    return this.transport.json<JsonRecord>('/api/skills', 'POST', {
      name,
      content,
      category: category || undefined,
      profile,
    });
  }

  getSkillContent(name: string, profile = 'default') {
    return this.transport.request<JsonRecord>('/api/skills/content', {
      query: { name, profile },
    });
  }

  updateSkillContent(name: string, content: string, profile = 'default') {
    return this.transport.json<JsonRecord>('/api/skills/content', 'PUT', {
      name,
      content,
      profile,
    });
  }

  getPlugins() {
    return Promise.all([
      this.transport.request<JsonRecord[]>('/api/dashboard/plugins'),
      this.transport.request<JsonRecord>('/api/dashboard/plugins/hub'),
    ]).then(([manifests, hub]) => ({ manifests, hub }));
  }

  rescanPlugins() {
    return this.transport.request<JsonRecord>('/api/dashboard/plugins/rescan');
  }

  installPlugin(identifier: string, options: { force?: boolean; enable?: boolean } = {}) {
    return this.transport.json<JsonRecord>('/api/dashboard/agent-plugins/install', 'POST', {
      identifier,
      force: options.force === true,
      enable: options.enable !== false,
    });
  }

  updatePlugin(name: string) {
    return this.transport.request<JsonRecord>(
      `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/update`,
      { method: 'POST' },
    );
  }

  removePlugin(name: string) {
    return this.transport.request<JsonRecord>(
      `/api/dashboard/agent-plugins/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
  }

  setPluginVisibility(name: string, hidden: boolean) {
    return this.transport.json<JsonRecord>(
      `/api/dashboard/plugins/${encodeURIComponent(name)}/visibility`,
      'POST',
      { hidden },
    );
  }

  setPluginProviders(input: { memoryProvider?: string; contextEngine?: string }) {
    return this.transport.json<JsonRecord>('/api/dashboard/plugin-providers', 'PUT', {
      ...(input.memoryProvider !== undefined ? { memory_provider: input.memoryProvider } : {}),
      ...(input.contextEngine !== undefined ? { context_engine: input.contextEngine } : {}),
    });
  }

  setPluginEnabled(name: string, enabled: boolean) {
    return this.transport.request<JsonRecord>(
      `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/${enabled ? 'enable' : 'disable'}`,
      { method: 'POST' },
    );
  }

  getMcp(profile = 'default') {
    return Promise.allSettled([
      this.transport.request<JsonRecord>('/api/mcp/servers', { query: { profile } }),
      this.transport.request<JsonRecord>('/api/mcp/catalog', { query: { profile } }),
      this.getManagedInstallations('mcp', profile),
    ]).then(async ([serversResult, catalogResult, installationsResult]) => {
      const resources = await this.getManagedResourceCatalog()
        .catch(() => emptyManagedResourceCatalog());
      const servers = serversResult.status === 'fulfilled'
        ? serversResult.value
        : { servers: [] };
      const catalog = catalogResult.status === 'fulfilled' ? catalogResult.value : {};
      const installations = installationsResult.status === 'fulfilled'
        ? installationsResult.value
        : { operations: [] };
      return {
        servers: mergeManagedMcpServers(servers, resources),
        catalog,
        installations,
        resourceCatalog: resources,
      };
    });
  }

  addMcpServer(server: JsonRecord, profile = 'default') {
    return this.transport.json<JsonRecord>('/api/mcp/servers', 'POST', server, {
      query: { profile },
    });
  }

  setMcpServerEnabled(name: string, enabled: boolean, profile = 'default') {
    return this.transport.json<JsonRecord>(
      `/api/mcp/servers/${encodeURIComponent(name)}/enabled`,
      'PUT',
      { enabled },
      { query: { profile } },
    );
  }

  removeMcpServer(name: string, profile = 'default') {
    return this.transport.request<{ ok: boolean }>(
      `/api/mcp/servers/${encodeURIComponent(name)}`,
      {
        method: 'DELETE',
        query: { profile },
      },
    );
  }

  testMcpServer(name: string, profile = 'default') {
    return this.transport.request<McpServerTestResult>(
      `/api/mcp/servers/${encodeURIComponent(name)}/test`,
      { method: 'POST', query: { profile } },
    );
  }

  installMcpCatalogEntry(
    name: string,
    env: Record<string, string> = {},
    enable = true,
    profile = 'default',
  ) {
    return this.transport.json<McpCatalogInstallResult>(
      '/api/mcp/catalog/install',
      'POST',
      { name, env, enable, profile },
    );
  }
}

function emptyManagedResourceCatalog(): ManagedResourceCatalog {
  return {
    account_generation: '',
    resources: [],
    diagnostics: [],
    events: [],
    cursor: 0,
    has_more: false,
  };
}

export function mergeManagedSkills(
  skills: JsonRecord[],
  catalog: ManagedResourceCatalog,
): JsonRecord[] {
  const rows = Array.isArray(skills) ? skills.filter(isRecord) : [];
  const resources = Array.isArray(catalog?.resources) ? catalog.resources : [];
  const diagnostics = Array.isArray(catalog?.diagnostics) ? catalog.diagnostics : [];
  const byName = new Map(rows.map((skill) => [String(skill.name || skill.id || ''), skill]));
  for (const resource of resources.filter((resource) => (
    resource.kind === 'skill' && isVerifiedManagedResource(resource)
  ))) {
    byName.set(resource.name, {
      ...(byName.get(resource.name) || {}),
      id: resource.resource_id,
      name: resource.name,
      description: resourceDescription(resource, diagnostics),
      enabled: resource.enabled,
      notes: resource.health,
      provenance: resource.source_type,
      source: resource.source_uri,
    });
  }
  return [...byName.values()];
}

export function mergeManagedMcpServers(
  source: JsonRecord,
  catalog: ManagedResourceCatalog,
): JsonRecord {
  const current = isRecord(source) && Array.isArray(source.servers)
    ? source.servers.filter(isRecord)
    : [];
  const resources = Array.isArray(catalog?.resources) ? catalog.resources : [];
  const diagnostics = Array.isArray(catalog?.diagnostics) ? catalog.diagnostics : [];
  const byName = new Map(current.map((server) => [String(server.name || server.id || ''), server]));
  for (const resource of resources.filter((resource) => (
    resource.kind === 'mcp' && isVerifiedManagedResource(resource)
  ))) {
    byName.set(resource.name, {
      ...(byName.get(resource.name) || {}),
      id: resource.resource_id,
      name: resource.name,
      description: resourceDescription(resource, diagnostics),
      enabled: resource.enabled,
      status: resource.health,
      source: resource.source_uri,
    });
  }
  return { ...(isRecord(source) ? source : {}), servers: [...byName.values()] };
}

function isVerifiedManagedResource(resource: ManagedResourceRecord): boolean {
  return resource.aggregate_state === 'verified'
    && resource.enabled === true
    && resource.health === 'healthy'
    && Object.keys(resource.node_receipts || {}).length === resource.target_nodes.length;
}

function resourceDescription(
  resource: ManagedResourceRecord,
  diagnostics: JsonRecord[],
): string {
  const loaded = resource.loaded_nodes.length
    ? `loaded: ${resource.loaded_nodes.join(', ')}`
    : `target: ${resource.target_nodes.join(', ') || 'pending'}`;
  const collision = diagnostics.some((item) => (
    item.code === 'resource_name_collision'
    && item.name === resource.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  ));
  return [resource.health, loaded, collision ? 'name collision' : ''].filter(Boolean).join(' · ');
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
