import type { HermesChatViewMessage as ChatMessage } from '../api/chat-view-model';
import type { SingleConversation } from '../api/HermesCloudApi';

export function previewConversationHistory(
  _isChinese: boolean,
  _accountGeneration: string,
): SingleConversation[] {
  return [];
}

export function previewNeedsCollaboration(_content: string, _attachmentCount: number): boolean {
  return false;
}

export function previewDelay(_ms: number): Promise<void> {
  return Promise.resolve();
}

export function previewTurnMessages(): ChatMessage[] {
  return [];
}
