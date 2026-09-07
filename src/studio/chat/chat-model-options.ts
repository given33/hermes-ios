import type { ModelOptionsResult } from '../../api/cloud/models';

export interface ChatModelOption { provider: string; providerName: string; model: string; key: string }

export function configuredChatModels(options: ModelOptionsResult): ChatModelOption[] {
  const choices = new Map<string, ChatModelOption>();
  for (const provider of options.providers || []) {
    if (!provider.is_current && (!provider.authenticated || ['moa', 'opencode-free'].includes(provider.slug))) continue;
    for (const source of provider.models || []) {
      const model = typeof source === 'string' ? source : String(source.id || source.model || '');
      if (!model || provider.unavailable_models?.includes(model)) continue;
      const key = JSON.stringify([provider.slug, model]);
      choices.set(key, { key, model, provider: provider.slug, providerName: provider.name || provider.slug });
    }
  }
  if (options.model && options.provider) {
    const key = JSON.stringify([options.provider, options.model]);
    if (!choices.has(key)) choices.set(key, {
      key, model: options.model, provider: options.provider, providerName: options.provider,
    });
  }
  return [...choices.values()];
}
