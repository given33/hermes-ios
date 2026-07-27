import type { HermesCloudTransport, JsonRecord } from './transport';

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
  request_id: string;
  scope?: 'auto' | 'fleet' | 'server' | 'workers';
  targets?: readonly ('dbb3' | 'server' | 'wsl')[];
};

export class HermesExtensionsCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  getSkills(profile = 'default') {
    return Promise.all([
      this.transport.request<JsonRecord[]>('/api/skills', { profile }),
      this.transport.request<JsonRecord[]>('/api/tools/toolsets', { profile }),
      this.getManagedInstallations('skill', profile),
    ]).then(([skills, toolsets, installations]) => ({ skills, toolsets, installations }));
  }

  getManagedInstallations(kind = '', profile = 'default', limit = 50) {
    return this.transport.request<{ operations: JsonRecord[] }>('/api/managed-installations', {
      query: { kind, profile, limit: String(limit) },
    });
  }

  createManagedInstallation(request: ManagedInstallationRequest) {
    return this.transport.json<{ accepted: boolean; operation: JsonRecord }>(
      '/api/managed-installations',
      'POST',
      request as JsonRecord,
    );
  }

  toggleSkill(name: string, enabled: boolean, profile = 'default') {
    return this.transport.json<{ ok: boolean }>('/api/skills/toggle', 'PUT', {
      name,
      enabled,
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

  setPluginEnabled(name: string, enabled: boolean) {
    return this.transport.request<JsonRecord>(
      `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/${enabled ? 'enable' : 'disable'}`,
      { method: 'POST' },
    );
  }

  getMcp(profile = 'default') {
    return Promise.all([
      this.transport.request<JsonRecord>('/api/mcp/servers', { query: { profile } }),
      this.transport.request<JsonRecord>('/api/mcp/catalog', { query: { profile } }),
      this.getManagedInstallations('mcp', profile),
    ]).then(([servers, catalog, installations]) => ({ servers, catalog, installations }));
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
}
