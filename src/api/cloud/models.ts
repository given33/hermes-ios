import type { HermesCloudTransport, JsonRecord } from './transport';

export interface CustomModelConfiguration {
  apiKey?: string;
  apiKeyAction?: 'delete' | 'preserve' | 'replace';
  apiKeyConfigured?: boolean;
  apiKeyPreview?: string;
  apiMode: 'anthropic_messages' | 'chat_completions' | 'codex_responses';
  baseUrl: string;
  contextLength: number;
  model: string;
  reasoningEffort: 'high' | 'low' | 'max' | 'medium' | 'minimal' | 'none' | 'ultra' | 'xhigh';
}

export function customModelApiKeyAction(
  value: string | undefined,
  options: {
    deleteRequested?: boolean;
    preview?: string;
  } = {},
): NonNullable<CustomModelConfiguration['apiKeyAction']> {
  if (options.deleteRequested) return 'delete';
  const normalized = stringValue(value);
  if (!normalized) return 'preserve';
  const preview = stringValue(options.preview);
  if (normalized === preview || /^[*\u2022\u00b7]+$/.test(normalized)) return 'preserve';
  return 'replace';
}

export interface CustomModelDiscoveryResult {
  baseUrl: string;
  latency_ms: number;
  message: string;
  models: string[];
  ok: boolean;
  reachable: boolean;
  status: number;
}

export interface CustomModelConnectionResult {
  latency_ms: number;
  message: string;
  ok: boolean;
  reachable: boolean;
  status: number;
}

export interface ModelOptionCapabilities {
  fast?: boolean;
  reasoning?: boolean;
}

export interface ModelOptionPricing {
  cache?: string | null;
  free?: boolean;
  input?: string;
  output?: string;
}

export interface ModelOptionProvider {
  authenticated?: boolean;
  capabilities?: Record<string, ModelOptionCapabilities>;
  free_tier?: boolean;
  is_current?: boolean;
  is_user_defined?: boolean;
  models?: Array<string | JsonRecord>;
  name?: string;
  pricing?: Record<string, ModelOptionPricing>;
  slug: string;
  source?: string;
  total_models?: number;
  unavailable_models?: string[];
  warning?: string;
}

export interface ModelInfoResult extends JsonRecord {
  capabilities?: JsonRecord;
  effective_context_length?: number;
  model?: string;
  provider?: string;
}

export interface ModelOptionsResult extends JsonRecord {
  model?: string;
  provider?: string;
  providers?: ModelOptionProvider[];
}

export interface ModelsResult {
  custom: CustomModelConfiguration;
  info: ModelInfoResult;
  options: ModelOptionsResult;
}

export interface ModelAssignmentResult {
  confirmMessage?: string;
  confirmRequired: boolean;
  model: string;
  ok: boolean;
  provider: string;
  scope: string;
}

export function customApiMode(value: unknown): CustomModelConfiguration['apiMode'] {
  return value === 'anthropic_messages' || value === 'codex_responses'
    ? value
    : 'chat_completions';
}

export function customReasoningEffort(value: unknown): CustomModelConfiguration['reasoningEffort'] {
  const normalized = stringValue(value);
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(normalized)
    ? normalized as CustomModelConfiguration['reasoningEffort']
    : 'medium';
}

/** Model catalog, custom-provider validation, and active model assignment. */
export class HermesModelsCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  getModels(profile = 'default'): Promise<ModelsResult> {
    return Promise.all([
      this.getModelInfo(profile),
      this.getModelOptions(profile),
      this.getCustomModel(profile),
    ]).then(([info, options, custom]) => ({ custom, info, options }));
  }

  getModelInfo(profile = 'default') {
    return this.transport.request<ModelInfoResult>('/api/model/info', { profile });
  }

  getModelOptions(profile = 'default') {
    return this.transport.request<ModelOptionsResult>('/api/model/options', {
      profile,
      query: { include_unconfigured: 1 },
    });
  }

  async getCustomModel(profile = 'default'): Promise<CustomModelConfiguration> {
    const value = await this.transport.request<JsonRecord>('/api/model/custom', { profile });
    return {
      apiKeyAction: 'preserve',
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
    const apiKeyAction = configuration.apiKeyAction
      ?? customModelApiKeyAction(configuration.apiKey);
    const apiKey = apiKeyAction === 'replace' ? stringValue(configuration.apiKey) : '';
    if (apiKeyAction === 'replace' && !apiKey) {
      throw new Error('A new API key is required to replace the saved key');
    }
    return this.transport.json<JsonRecord>('/api/model/custom', 'PUT', {
      api_key: apiKey,
      api_key_action: apiKeyAction,
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
    return this.transport.json<CustomModelConnectionResult>('/api/model/custom/test', 'POST', {
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
    profile = 'default',
  ): Promise<CustomModelDiscoveryResult> {
    const normalizedBaseUrl = normalizeModelCatalogBaseUrl(baseUrl);
    const result = await this.transport.json<Omit<CustomModelDiscoveryResult, 'baseUrl'>>(
      '/api/model/custom/discover',
      'POST',
      {
        api_key: apiKey.trim(),
        base_url: normalizedBaseUrl,
        profile,
      },
    );
    return { ...result, baseUrl: normalizedBaseUrl };
  }

  async setModel(
    provider: string,
    model: string,
    profile = 'default',
    confirmExpensiveModel = false,
  ): Promise<ModelAssignmentResult> {
    const value = await this.transport.json<JsonRecord>('/api/model/set', 'POST', {
      confirm_expensive_model: confirmExpensiveModel,
      scope: 'main',
      provider,
      model,
    }, { profile });
    const result: ModelAssignmentResult = {
      confirmMessage: stringValue(value.confirm_message) || undefined,
      confirmRequired: value.confirm_required === true,
      model: stringValue(value.model) || model,
      ok: value.ok === true,
      provider: stringValue(value.provider) || provider,
      scope: stringValue(value.scope) || 'main',
    };
    if (!result.ok && !result.confirmRequired) {
      throw new Error(stringValue(value.detail) || 'The server rejected the model assignment');
    }
    return result;
  }
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
