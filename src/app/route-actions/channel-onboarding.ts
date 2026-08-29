import type { HermesCloudApi } from '../../api/HermesCloudApi';
import type { JsonRecord } from '../../api/cloud/transport';
import {
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  type HermesSwiftUIRouteAction,
  type HermesSwiftUIRouteActionPayload,
} from '../swiftui-route-contract';

export type ChannelOnboardingActionResult = 'none' | {
  channelOnboardingJSON?: string;
  message: string;
  reload?: boolean;
};

/** Bridge the native Channels page to the upstream QR onboarding contracts. */
export async function performChannelOnboardingAction(
  api: HermesCloudApi,
  action: HermesSwiftUIRouteAction,
  payload: HermesSwiftUIRouteActionPayload,
  profile: string,
  chinese: boolean,
): Promise<ChannelOnboardingActionResult> {
  if (payload.route !== 'channels') return 'none';
  const channel = normalizeChannel(payload.id);
  if (!channel) return 'none';

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.channelOnboardingStart) {
    const result = channel === 'telegram'
      ? await api.startTelegramOnboarding(payload.value?.trim() || 'Hermes Agent', profile)
      : await api.startWhatsappOnboarding(
        payload.fields?.mode?.trim() || 'pairing',
        payload.fields?.allowedUsers || '',
        profile,
      );
    return {
      channelOnboardingJSON: JSON.stringify({ channel, ...result }),
      message: chinese
        ? `${channel === 'telegram' ? 'Telegram' : 'WhatsApp'} 配对已启动`
        : `${channel === 'telegram' ? 'Telegram' : 'WhatsApp'} pairing started`,
    };
  }

  const pairingId = payload.value?.trim() || '';
  if (!pairingId) return 'none';
  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.channelOnboardingRefresh) {
    const result = channel === 'telegram'
      ? await api.getTelegramOnboarding(pairingId)
      : await api.getWhatsappOnboarding(pairingId);
    return {
      channelOnboardingJSON: JSON.stringify({ channel, pairing_id: pairingId, ...result }),
      message: '',
    };
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.channelOnboardingApply) {
    const detail = parseJsonRecord(payload.detail || '{}') || {};
    const result = channel === 'telegram'
      ? await api.applyTelegramOnboarding(pairingId, telegramIDs(detail), profile)
      : await api.applyWhatsappOnboarding(pairingId, detail, profile);
    return {
      channelOnboardingJSON: JSON.stringify({ channel, pairing_id: pairingId, ...result }),
      message: chinese
        ? `${channel === 'telegram' ? 'Telegram' : 'WhatsApp'} 配置已保存`
        : `${channel === 'telegram' ? 'Telegram' : 'WhatsApp'} configuration saved`,
      reload: true,
    };
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.channelOnboardingCancel) {
    if (channel === 'telegram') await api.cancelTelegramOnboarding(pairingId);
    else await api.cancelWhatsappOnboarding(pairingId);
    return {
      channelOnboardingJSON: '',
      message: chinese ? '渠道配对已取消' : 'Channel pairing cancelled',
    };
  }
  return 'none';
}

function normalizeChannel(value: string | undefined): 'telegram' | 'whatsapp' | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'telegram' || normalized === 'whatsapp' ? normalized : null;
}

function parseJsonRecord(value: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : null;
  } catch {
    return null;
  }
}

function telegramIDs(detail: JsonRecord): string[] {
  const raw = detail.allowed_user_ids;
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof raw === 'string') return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  return [];
}
