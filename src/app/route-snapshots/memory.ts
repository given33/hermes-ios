import type { HermesSwiftUIMemorySnapshot } from '../swiftui-route-contract';
import { isRecord, numberValue, stringValue } from './support';

export function memorySnapshot(
  source: unknown,
  oauthStatuses: readonly (unknown | undefined)[] = [],
  providerConfigs: readonly (unknown | undefined)[] = [],
): HermesSwiftUIMemorySnapshot {
  const root = isRecord(source) ? source : {};
  const builtin = isRecord(root.builtin_files) ? root.builtin_files : {};
  const providers = Array.isArray(root.providers) ? root.providers : [];
  return {
    active: stringValue(root.active),
    memoryBytes: numberValue(builtin.memory),
    userBytes: numberValue(builtin.user),
    providers: providers.filter(isRecord).map((provider, index) => {
      const oauth = isRecord(oauthStatuses[index]) ? oauthStatuses[index] : {};
      const oauthState = stringValue(oauth.state);
      const config = isRecord(providerConfigs[index]) ? providerConfigs[index] : undefined;
      return {
        id: stringValue(provider.name) || `provider-${index}`,
        label: stringValue(provider.label) || stringValue(provider.name) || `Provider ${index + 1}`,
        status: stringValue(provider.status) || stringValue(provider.state),
        detail: stringValue(provider.detail) || stringValue(provider.reason),
        active: provider.active === true || stringValue(provider.name) === stringValue(root.active),
        ready: provider.ready === true || provider.available === true,
        oauthAvailable: oauthStatuses[index] !== undefined,
        oauthConnected: oauth.connected === true,
        oauthState,
        configJSON: config ? JSON.stringify(config, null, 2) : undefined,
      };
    }),
  };
}
