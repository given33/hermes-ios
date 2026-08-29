import type { HermesCloudApi } from '../../api/HermesCloudApi';
import { isRecord, stringValue } from '../route-snapshots/support';

export type BotModeActionResult = 'reload' | 'none' | {
  confirmMessage?: string;
  confirmRequired?: boolean;
  message: string;
};

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function describeBot(api: HermesCloudApi, id: string, chinese: boolean): Promise<BotModeActionResult> {
  if (!id || typeof api.describeBotProfile !== 'function') return 'none';
  const result = await api.describeBotProfile(id);
  const skills = isRecord(result) && Array.isArray(result.skills) ? result.skills.length : 0;
  const toolsets = isRecord(result) && Array.isArray(result.toolsets) ? result.toolsets.length : 0;
  const mcp = isRecord(result) && Array.isArray(result.mcp_servers) ? result.mcp_servers.length : 0;
  return { message: chinese ? `能力已读取：${skills} 个技能、${toolsets} 个 Toolset、${mcp} 个 MCP` : `Capabilities loaded: ${skills} skills, ${toolsets} toolsets, ${mcp} MCP servers` };
}

export async function configureBot(api: HermesCloudApi, id: string, raw: string, chinese: boolean): Promise<BotModeActionResult> {
  if (!id || typeof api.configureBotProfile !== 'function') return 'none';
  const patch = parseRecord(raw);
  if (!patch) return 'none';
  const result = await api.configureBotProfile(id, patch);
  if (isRecord(result) && result.confirm_required === true) {
    return {
      confirmMessage: stringValue(result.confirm_message) || (chinese ? '该模型需要确认后才能保存。' : 'This model requires confirmation before saving.'),
      confirmRequired: true,
      message: '',
    };
  }
  return 'reload';
}

export async function uploadBotAvatar(api: HermesCloudApi, id: string, raw: string): Promise<BotModeActionResult> {
  if (!id || !raw || typeof api.setBotAsset !== 'function') return 'none';
  await api.setBotAsset(id, raw, 'avatar');
  return 'reload';
}

export async function sendBotRelay(
  api: HermesCloudApi,
  target: string,
  message: string,
  senderProfile: string,
  chinese: boolean,
): Promise<BotModeActionResult> {
  if (!target.trim() || !message.trim() || typeof api.sendBotRelayMessage !== 'function') return 'none';
  const result = await api.sendBotRelayMessage(target.trim(), message.trim(), senderProfile.trim() || 'default');
  const envelope = isRecord(result) ? stringValue(result.envelope_id) : '';
  return {
    message: chinese
      ? `跨连接消息已排队${envelope ? `（${envelope.slice(0, 8)}）` : ''}`
      : `Cross-connection message queued${envelope ? ` (${envelope.slice(0, 8)})` : ''}`,
  };
}
