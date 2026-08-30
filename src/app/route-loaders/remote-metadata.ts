import type { HermesCloudApi } from '../../api/HermesCloudApi';
import type { HermesSwiftUIToolsetSnapshot } from '../swiftui-route-contract';

export async function loadCronMetadata(api: HermesCloudApi, profile = 'default', source?: unknown) {
  const [blueprints, deliveryTargets] = await Promise.all([
    typeof api.getCronBlueprints === 'function' ? api.getCronBlueprints().catch(() => undefined) : undefined,
    typeof api.getDeliveryTargets === 'function' ? api.getDeliveryTargets().catch(() => undefined) : undefined,
  ]);
  const rows = source && typeof source === 'object' && !Array.isArray(source) && Array.isArray((source as { jobs?: unknown }).jobs)
    ? (source as { jobs: unknown[] }).jobs.filter((job): job is Record<string, unknown> => typeof job === 'object' && job !== null)
    : [];
  const runEntries = await Promise.all(rows.map(async (job) => {
    const id = typeof job.id === 'string' ? job.id : '';
    if (!id || typeof api.getCronJobRuns !== 'function') return undefined;
    const runs = await api.getCronJobRuns(id, profile, 20).catch(() => undefined);
    return runs === undefined ? undefined : [id, runs] as const;
  }));
  const cronRuns = Object.fromEntries(runEntries.filter((entry) => entry !== undefined));
  return {
    ...(blueprints !== undefined ? { cronBlueprintsJSON: JSON.stringify(blueprints) } : {}),
    ...(deliveryTargets !== undefined ? { cronDeliveryTargetsJSON: JSON.stringify(deliveryTargets) } : {}),
    ...(Object.keys(cronRuns).length ? { cronRunsJSON: JSON.stringify(cronRuns) } : {}),
  };
}

export async function hydrateToolsetConfigs(
  api: HermesCloudApi,
  toolsets: readonly HermesSwiftUIToolsetSnapshot[],
  profile: string,
) {
  return Promise.all(toolsets.map(async (toolset) => {
    if (typeof api.getToolsetConfig !== 'function') return toolset;
    try {
      const [config, models, providers] = await Promise.all([
        api.getToolsetConfig(toolset.id, profile),
        typeof api.getToolsetModels === 'function' ? api.getToolsetModels(toolset.id, undefined, profile).catch(() => undefined) : undefined,
        typeof api.getToolsetProviders === 'function' ? api.getToolsetProviders(toolset.id, profile).catch(() => undefined) : undefined,
      ]);
      return {
        ...toolset,
        configJSON: JSON.stringify(config),
        ...(models !== undefined ? { modelsJSON: JSON.stringify(models) } : {}),
        ...(providers !== undefined ? { providersJSON: JSON.stringify(providers) } : {}),
      };
    } catch {
      return toolset;
    }
  }));
}

export async function loadToolRuntimeMetadata(api: HermesCloudApi, profile: string) {
  const [terminal, computerUse] = await Promise.all([
    typeof api.getTerminalBackends === 'function' ? api.getTerminalBackends(profile).catch(() => undefined) : undefined,
    typeof api.getComputerUseStatus === 'function' ? api.getComputerUseStatus(profile).catch(() => undefined) : undefined,
  ]);
  return {
    ...(terminal !== undefined ? { terminalBackendsJSON: JSON.stringify(terminal) } : {}),
    ...(computerUse !== undefined ? { computerUseJSON: JSON.stringify(computerUse) } : {}),
  };
}

export async function loadSkillHubMetadata(api: HermesCloudApi, profile: string) {
  const sources = typeof api.getSkillHubSources === 'function'
    ? await api.getSkillHubSources(profile).catch(() => undefined)
    : undefined;
  return sources === undefined ? {} : { skillHubSourcesJSON: JSON.stringify(sources) };
}

export async function loadLearningMetadata(api: HermesCloudApi, profile: string) {
  const graph = typeof api.getLearningGraph === 'function'
    ? await api.getLearningGraph(profile).catch(() => undefined)
    : undefined;
  return graph === undefined ? {} : { learningGraphJSON: JSON.stringify(graph) };
}

export async function loadModelProviderMetadata(api: HermesCloudApi, profile: string) {
  const [oauth, custom, credentialPool] = await Promise.all([
    typeof api.getProviderOauth === 'function' ? api.getProviderOauth(profile).catch(() => undefined) : undefined,
    typeof api.getCustomProviderEndpoints === 'function' ? api.getCustomProviderEndpoints(profile).catch(() => undefined) : undefined,
    typeof api.getCredentialPool === 'function' ? api.getCredentialPool(profile).catch(() => undefined) : undefined,
  ]);
  const safeCredentialPool = sanitizeCredentialPoolMetadata(credentialPool);
  return {
    ...(oauth !== undefined ? { providerOauthJSON: JSON.stringify(oauth) } : {}),
    ...(custom !== undefined ? { customProviderEndpointsJSON: JSON.stringify(custom) } : {}),
    ...(safeCredentialPool !== undefined
      ? { credentialPoolJSON: JSON.stringify(safeCredentialPool) }
      : {}),
  };
}

/** The credential-pool endpoint is metadata-only today, but keep an explicit
 * allowlist at the native bridge so a future/legacy backend cannot accidentally
 * serialize an API key or refresh token into route state. */
export function sanitizeCredentialPoolMetadata(value: unknown): { providers: unknown[] } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const providers = (value as { providers?: unknown }).providers;
  if (!Array.isArray(providers)) return { providers: [] };
  return {
    providers: providers.flatMap((provider) => {
      if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return [];
      const row = provider as Record<string, unknown>;
      if (typeof row.provider !== 'string' || !row.provider.trim()) return [];
      const entries = Array.isArray(row.entries) ? row.entries : [];
      return [{
        provider: row.provider,
        entries: entries.flatMap((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
          const item = entry as Record<string, unknown>;
          const index = typeof item.index === 'number' && Number.isSafeInteger(item.index)
            && item.index > 0 ? item.index : undefined;
          if (index === undefined) return [];
          return [{
            index,
            ...(typeof item.id === 'string' ? { id: item.id } : {}),
            ...(typeof item.label === 'string' ? { label: item.label } : {}),
            ...(typeof item.auth_type === 'string' ? { auth_type: item.auth_type } : {}),
            ...(typeof item.source === 'string' ? { source: item.source } : {}),
            ...(typeof item.priority === 'number' && Number.isFinite(item.priority)
              ? { priority: item.priority }
              : {}),
            ...(typeof item.last_status === 'string' ? { last_status: item.last_status } : {}),
            ...(typeof item.request_count === 'number' && Number.isFinite(item.request_count)
              ? { request_count: item.request_count }
              : {}),
            ...(typeof item.token_preview === 'string'
              ? { token_preview: item.token_preview.slice(0, 64) }
              : {}),
            ...(typeof item.has_refresh === 'boolean' ? { has_refresh: item.has_refresh } : {}),
          }];
        }),
      }];
    }),
  };
}

export function mergeRouteField(dataJson: string, key: string, value: string): string {
  try {
    const source: unknown = JSON.parse(dataJson);
    if (typeof source !== 'object' || source === null || Array.isArray(source)) return dataJson;
    return JSON.stringify({ ...source, [key]: value });
  } catch {
    return dataJson;
  }
}
