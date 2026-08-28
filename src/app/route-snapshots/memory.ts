import type { HermesSwiftUIMemorySnapshot } from '../swiftui-route-contract';
import { isRecord, numberValue, stringValue } from './support';

export function memorySnapshot(source: unknown): HermesSwiftUIMemorySnapshot {
  const root = isRecord(source) ? source : {};
  const builtin = isRecord(root.builtin_files) ? root.builtin_files : {};
  const providers = Array.isArray(root.providers) ? root.providers : [];
  return {
    active: stringValue(root.active),
    memoryBytes: numberValue(builtin.memory),
    userBytes: numberValue(builtin.user),
    providers: providers.filter(isRecord).map((provider, index) => ({
      id: stringValue(provider.name) || `provider-${index}`,
      label: stringValue(provider.label) || stringValue(provider.name) || `Provider ${index + 1}`,
      status: stringValue(provider.status) || stringValue(provider.state),
      detail: stringValue(provider.detail) || stringValue(provider.reason),
      active: provider.active === true || stringValue(provider.name) === stringValue(root.active),
      ready: provider.ready === true || provider.available === true,
    })),
  };
}
