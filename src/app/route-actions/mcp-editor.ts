import type { HermesCloudApi } from '../../api/HermesCloudApi';
import { isRecord, parseJsonRecord } from '../route-snapshots/support';

export function mcpServersDocument(value: unknown): string {
  const envelope = isRecord(value) ? value : {};
  const config = isRecord(envelope.config) ? envelope.config : envelope;
  const servers = isRecord(config.mcp_servers) ? config.mcp_servers
    : isRecord(config.mcpServers) ? config.mcpServers
      : {};
  return JSON.stringify({
    mcpServers: Object.fromEntries(
      Object.entries(servers).filter((entry): entry is [string, Record<string, unknown>] => (
        entry[0].trim().length > 0 && isRecord(entry[1])
      )),
    ),
  }, null, 2);
}

export async function replaceMcpServers(
  api: HermesCloudApi,
  value: string,
  profile: string,
): Promise<void> {
  const configuration = parseJsonRecord(value);
  if (!configuration) throw new Error('MCP configuration must be a JSON object');
  const wrapped = Object.hasOwn(configuration, 'mcpServers')
    ? configuration.mcpServers
    : Object.hasOwn(configuration, 'mcp_servers') ? configuration.mcp_servers : configuration;
  if (!isRecord(wrapped)) throw new Error('mcpServers must be a JSON object');
  const entries = Object.entries(wrapped);
  if (entries.some(([name, entry]) => !name.trim() || !isRecord(entry))) {
    throw new Error('Every MCP server must have a name and object configuration');
  }
  const servers = Object.fromEntries(entries.map(([name, entry]) => {
    const normalized = { ...(entry as Record<string, unknown>) };
    if (typeof normalized.type === 'string' && normalized.transport === undefined) {
      normalized.transport = normalized.type;
      delete normalized.type;
    }
    return [name, normalized];
  }));
  await api.replaceMcpServers(servers, profile);
}
