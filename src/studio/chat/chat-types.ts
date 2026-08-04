import type { HostedTurnOutboxItem } from '../../api/conversation-local-store';
import type { HostedTurnEnqueueResponse } from '../../api/HermesCloudApi';
import type { HermesChatViewMessage as ChatMessage } from '../../api/chat-view-model';

export type PendingPhase = 'connecting' | 'thinking' | 'responding' | 'reconnecting' | 'executing' | 'cancel_requested';

export interface ChatAttachment {
  draftPersistent?: boolean;
  encryption?: 'aes-gcm-chunked-v2' | 'aes-gcm-v1';
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
  | {
      outcome:
        | 'cancel-accepted'
        | 'cleanup-pending'
        | 'completed-before-cancel'
        | 'retry-scheduled'
        | 'settled';
    }
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
