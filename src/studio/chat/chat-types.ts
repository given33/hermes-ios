import type { HostedTurnOutboxItem } from '../../api/conversation-local-store';
import type { HostedTurnEnqueueResponse } from '../../api/HermesCloudApi';
import type { HermesChatViewMessage as ChatMessage } from '../../api/chat-view-model';

export type PendingPhase = 'thinking' | 'reconnecting' | 'executing';

export interface ChatAttachment {
  id: string;
  kind: 'file' | 'image';
  mimeType?: string | null;
  name: string;
  ownedTemporary?: boolean;
  size?: number | null;
  uri: string;
}

export interface HostedTurnDelivery {
  item: HostedTurnOutboxItem;
  response: HostedTurnEnqueueResponse;
}

export type PendingCancellationDeliveryResult =
  | { outcome: 'cleanup-pending' | 'retry-scheduled' | 'settled' }
  | { error: string; outcome: 'failed' };

export interface PendingChatSend {
  conversationId: string;
  key: string;
  queuedItem?: HostedTurnOutboxItem;
  userMessage: ChatMessage;
}

export class HostedTurnCancelledDuringDelivery extends Error {
  constructor() {
    super('Hosted turn delivery was cancelled');
    this.name = 'HostedTurnCancelledDuringDelivery';
  }
}
