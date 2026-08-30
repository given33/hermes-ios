import type { HermesCloudApi } from '../../api/HermesCloudApi';
import {
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  type HermesSwiftUIRouteAction,
  type HermesSwiftUIRouteActionPayload,
} from '../swiftui-route-contract';
import { stringValue } from '../route-snapshots/support';

export type ProviderOauthActionResult = 'reload' | 'none' | {
  message: string;
  reload?: boolean;
  url?: string;
  oauthProvider?: string;
  oauthSessionId?: string;
};

/** Bridge the complete provider OAuth lifecycle to the canonical backend API. */
export async function performProviderOauthAction(
  api: HermesCloudApi,
  action: HermesSwiftUIRouteAction,
  payload: HermesSwiftUIRouteActionPayload,
  profile: string,
  chinese: boolean,
): Promise<ProviderOauthActionResult | undefined> {
  switch (action) {
    case HERMES_SWIFTUI_ROUTE_ACTIONS.providerOauthStart: {
      if (!payload.id) return 'none';
      const result = await api.startProviderOauth(
        payload.id,
        payload.fields ? { ...payload.fields } : {},
        profile,
      );
      const url = stringValue(result.authorization_url) || stringValue(result.url);
      const sessionId = stringValue(result.session_id) || stringValue(result.sessionId);
      return {
        message: url
          ? (chinese ? 'Provider OAuth 页面已打开' : 'Provider OAuth page opened')
          : (chinese ? 'Provider OAuth 已启动' : 'Provider OAuth started'),
        url,
        oauthProvider: payload.id,
        oauthSessionId: sessionId,
      };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.providerOauthSubmit:
      if (!payload.id) return 'none';
      await api.submitProviderOauth(payload.id, payload.fields || {}, profile);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.providerOauthCancel: {
      const sessionId = payload.value?.trim() || payload.name?.trim() || '';
      if (!sessionId) return 'none';
      await api.cancelProviderOauth(sessionId, profile);
      return 'reload';
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.providerOauthDisconnect: {
      const provider = payload.id?.trim() || payload.value?.trim() || payload.name?.trim() || '';
      if (!provider) return 'none';
      const result = await api.deleteModelCredential(provider, profile);
      return {
        message: result.ok
          ? (chinese ? `已断开 ${provider}` : `${provider} disconnected`)
          : (chinese
              ? `${provider} 没有可移除的托管凭据`
              : `${provider} had no managed credential to remove`),
        reload: true,
      };
    }
    default:
      return undefined;
  }
}
