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
  const [oauth, custom] = await Promise.all([
    typeof api.getProviderOauth === 'function' ? api.getProviderOauth().catch(() => undefined) : undefined,
    typeof api.getCustomProviderEndpoints === 'function' ? api.getCustomProviderEndpoints(profile).catch(() => undefined) : undefined,
  ]);
  return {
    ...(oauth !== undefined ? { providerOauthJSON: JSON.stringify(oauth) } : {}),
    ...(custom !== undefined ? { customProviderEndpointsJSON: JSON.stringify(custom) } : {}),
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
