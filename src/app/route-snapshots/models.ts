import type { HermesSwiftUIModelSnapshot } from '../swiftui-route-contract';
import {
  customApiMode,
  customModelApiKeyAction,
  customReasoningEffort,
  type CustomModelConfiguration,
} from '../../api/HermesCloudApi';
import {
  formatContextLength,
  isRecord,
  numberValue,
  stringValue,
  type HermesRouteLocalizer,
} from './support';
import { encodeModelSelection } from './model-selection';

export function customModelOperationError(
  action: string,
  result: { message: string; reachable: boolean; status: number },
  localizer: HermesRouteLocalizer,
): string {
  const chinese = localizer.isChinese;
  if (chinese) {
    if (result.status === 401) return `${action}失败：API 密钥被拒绝（HTTP 401）`;
    if (result.status === 403) return `${action}失败：密钥权限不足（HTTP 403）`;
    if (result.status === 404) return `${action}失败：接口路径不存在（HTTP 404）`;
    if (result.status === 429) return `${action}失败：请求过多（HTTP 429）`;
    if (result.status >= 400) return `${action}失败：模型服务返回 HTTP ${result.status}`;
    if (!result.reachable) return `${action}失败：模型服务连接超时或不可达`;
    return `${action}失败：${result.message || '模型服务没有返回有效结果'}`;
  }
  if (result.status === 401) return `${action} failed: API key rejected (HTTP 401)`;
  if (result.status === 403) return `${action} failed: key lacks permission (HTTP 403)`;
  if (result.status === 404) return `${action} failed: endpoint path not found (HTTP 404)`;
  if (result.status === 429) return `${action} failed: too many requests (HTTP 429)`;
  if (result.status >= 400) return `${action} failed: model service returned HTTP ${result.status}`;
  if (!result.reachable) return `${action} failed: model service timed out or is unreachable`;
  return `${action} failed: ${result.message || 'model service returned no usable result'}`;
}

export function modelsSnapshot(source: unknown): HermesSwiftUIModelSnapshot[] {
  if (!isRecord(source)) return [];
  const info = isRecord(source.info) ? source.info : {};
  const options = isRecord(source.options) ? source.options : {};
  const custom = isRecord(source.custom) ? source.custom : {};
  const currentProvider = stringValue(info.provider) || stringValue(options.provider);
  const currentModel = stringValue(info.model) || stringValue(options.model);
  const currentContextLength = numberValue(info.effective_context_length);
  const snapshots: HermesSwiftUIModelSnapshot[] = [];
  const indexes = new Map<string, number>();

  const add = (snapshot: HermesSwiftUIModelSnapshot) => {
    const existing = indexes.get(snapshot.id);
    if (existing === undefined) {
      indexes.set(snapshot.id, snapshots.length);
      snapshots.push(snapshot);
    } else {
      snapshots[existing] = snapshot;
    }
  };

  const providers = Array.isArray(options.providers) ? options.providers : [];
  for (const providerEntry of providers) {
    if (!isRecord(providerEntry)) continue;
    const provider = stringValue(providerEntry.slug);
    if (!provider || !Array.isArray(providerEntry.models)) continue;
    const authenticated = providerEntry.authenticated !== false;
    const warning = stringValue(providerEntry.warning);
    const freeTier = providerEntry.free_tier === true;
    const unavailableModels = new Set(
      Array.isArray(providerEntry.unavailable_models)
        ? providerEntry.unavailable_models.filter((value): value is string => typeof value === 'string')
        : [],
    );
    const pricing = isRecord(providerEntry.pricing) ? providerEntry.pricing : {};
    const capabilities = isRecord(providerEntry.capabilities) ? providerEntry.capabilities : {};
    for (const modelEntry of providerEntry.models) {
      const model = typeof modelEntry === 'string'
        ? modelEntry
        : isRecord(modelEntry)
          ? stringValue(modelEntry.id) || stringValue(modelEntry.model) || stringValue(modelEntry.name)
          : '';
      if (!model) continue;
      const active = provider === currentProvider && model === currentModel;
      const contextLength = active
        ? currentContextLength
        : isRecord(modelEntry) ? numberValue(modelEntry.context_length) : 0;
      const modelPricing = isRecord(pricing[model]) ? pricing[model] : {};
      const modelCapabilities = isRecord(capabilities[model]) ? capabilities[model] : {};
      add({
        active,
        apiKeyConfigured: false,
        apiKeyPreview: '',
        apiMode: 'chat_completions',
        baseUrl: '',
        context: formatContextLength(contextLength),
        contextLength,
        id: encodeModelSelection(provider, model),
        model,
        provider,
        reasoningEffort: 'none',
        authenticated,
        selectable: authenticated && !unavailableModels.has(model),
        warning,
        priceInput: stringValue(modelPricing.input),
        priceOutput: stringValue(modelPricing.output),
        priceCache: stringValue(modelPricing.cache),
        free: modelPricing.free === true,
        freeTier,
        supportsFast: modelCapabilities.fast === true,
        supportsReasoning: modelCapabilities.reasoning === true,
      });
    }
  }

  if (currentProvider && currentModel) {
    const currentId = encodeModelSelection(currentProvider, currentModel);
    const providerEntry = providers.find((value) => (
      isRecord(value) && stringValue(value.slug) === currentProvider
    ));
    const providerRecord = isRecord(providerEntry) ? providerEntry : {};
    const authenticated = providerEntry === undefined || providerRecord.authenticated !== false;
    const unavailable = Array.isArray(providerRecord.unavailable_models)
      && providerRecord.unavailable_models.includes(currentModel);
    const pricing = isRecord(providerRecord.pricing) && isRecord(providerRecord.pricing[currentModel])
      ? providerRecord.pricing[currentModel] : {};
    const capabilities = isRecord(providerRecord.capabilities)
      && isRecord(providerRecord.capabilities[currentModel])
      ? providerRecord.capabilities[currentModel] : {};
    if (!indexes.has(currentId)) add({
      active: true,
      apiKeyConfigured: false,
      apiKeyPreview: '',
      apiMode: 'chat_completions',
      baseUrl: '',
      context: formatContextLength(currentContextLength),
      contextLength: currentContextLength,
      id: currentId,
      model: currentModel,
      provider: currentProvider,
      reasoningEffort: 'none',
      authenticated,
      selectable: authenticated && !unavailable,
      warning: stringValue(providerRecord.warning),
      priceInput: stringValue(pricing.input),
      priceOutput: stringValue(pricing.output),
      priceCache: stringValue(pricing.cache),
      free: pricing.free === true,
      freeTier: providerRecord.free_tier === true,
      supportsFast: capabilities.fast === true,
      supportsReasoning: capabilities.reasoning === true,
    });
  }

  const customModel = stringValue(custom.model);
  if (customModel) {
    const customId = encodeModelSelection('custom', customModel);
    const existingCustomIndex = indexes.get(customId);
    const existingCustom = existingCustomIndex === undefined
      ? undefined : snapshots[existingCustomIndex];
    const contextLength = numberValue(custom.contextLength)
      || (currentProvider === 'custom' && customModel === currentModel ? currentContextLength : 0);
    add({
      active: currentProvider === 'custom' && customModel === currentModel,
      apiKeyConfigured: custom.apiKeyConfigured === true,
      apiKeyPreview: stringValue(custom.apiKeyPreview),
      apiMode: customApiMode(stringValue(custom.apiMode)),
      baseUrl: stringValue(custom.baseUrl),
      context: formatContextLength(contextLength),
      contextLength,
      id: customId,
      model: customModel,
      provider: 'custom',
      reasoningEffort: customReasoningEffort(stringValue(custom.reasoningEffort)),
      authenticated: custom.apiKeyConfigured === true || stringValue(custom.baseUrl).length > 0,
      selectable: custom.apiKeyConfigured === true || stringValue(custom.baseUrl).length > 0,
      warning: existingCustom?.warning || '',
      priceInput: existingCustom?.priceInput || '',
      priceOutput: existingCustom?.priceOutput || '',
      priceCache: existingCustom?.priceCache || '',
      free: existingCustom?.free || false,
      freeTier: existingCustom?.freeTier || false,
      supportsFast: existingCustom?.supportsFast || false,
      supportsReasoning: existingCustom?.supportsReasoning ?? true,
    });
  }

  return snapshots;
}

export function customModelConfiguration(
  fields: Readonly<Record<string, string>> | undefined,
): CustomModelConfiguration {
  const source = fields || {};
  const contextLength = Number.parseInt(source.contextLength || '', 10);
  const configuration: CustomModelConfiguration = {
    apiKeyAction: customModelApiKeyAction(source.apiKey, {
      deleteRequested: source.apiKeyAction === 'delete',
      preview: source.apiKeyPreview,
    }),
    apiMode: customApiMode(source.apiMode),
    baseUrl: source.baseUrl?.trim() || '',
    contextLength: Number.isFinite(contextLength) ? contextLength : 0,
    model: source.model?.trim() || '',
    reasoningEffort: customReasoningEffort(source.reasoningEffort),
  };
  if (source.apiKey?.trim()) configuration.apiKey = source.apiKey.trim();
  return configuration;
}
