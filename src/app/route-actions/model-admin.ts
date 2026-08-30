import type { HermesCloudApi } from '../../api/HermesCloudApi';
import {
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  type HermesSwiftUIRouteAction,
  type HermesSwiftUIRouteActionPayload,
} from '../swiftui-route-contract';
import { parseJsonRecord } from '../route-snapshots/support';

export async function performModelAdminAction(
  api: HermesCloudApi,
  action: HermesSwiftUIRouteAction,
  payload: HermesSwiftUIRouteActionPayload,
  profile: string,
  chinese: boolean,
): Promise<'reload' | 'none' | undefined> {
  switch (action) {
    case HERMES_SWIFTUI_ROUTE_ACTIONS.modelMoaSave: {
      const config = parseJsonRecord(payload.detail || payload.value || '');
      if (!config) throw new Error(chinese ? 'MoA 配置必须是 JSON 对象' : 'MoA configuration must be a JSON object');
      await api.saveMoaModels(config, profile);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.credentialPoolAdd: {
      const provider = payload.id?.trim() || payload.fields?.provider?.trim() || '';
      const apiKey = payload.detail || '';
      if (!provider || !apiKey.trim()) return 'none';
      await api.addCredentialPoolEntry(provider, apiKey, payload.name?.trim() || '', profile);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.credentialPoolDelete: {
      const provider = payload.id?.trim() || payload.fields?.provider?.trim() || '';
      const index = payload.position;
      if (!provider || index === undefined || !Number.isSafeInteger(index) || index < 1) return 'none';
      await api.removeCredentialPoolEntry(provider, index, profile);
      return 'reload';
    }
    default:
      return undefined;
  }
}
