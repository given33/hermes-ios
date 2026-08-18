import type {
  CollaborationMessage,
  HostedTurnEnqueueInput,
  JsonRecord,
  SingleConversation,
} from './HermesCloudApi';

export interface ConversationCacheSnapshot {
  version: 4;
  owner: string;
  activeConversationId: string;
  conversations: SingleConversation[];
  syncedAt: number;
}

export interface ConversationCacheReconciliation {
  conversations: SingleConversation[];
  downloadIds: string[];
}

/**
 * A conversation/session deletion that has been applied locally but still
 * needs to be acknowledged by the remote service.  The row is intentionally
 * small: it contains only the remote identity and enough retry metadata for
 * a later foreground replay.
 */
export interface ConversationDeleteOutboxItem {
  attempts?: number;
  conversationId: string;
  kind: 'conversation' | 'session' | 'room';
  lastError?: string;
  leaseExpiresAt?: number;
  leaseOwner?: string;
  leaseToken?: string;
  nextAttemptAt?: number;
  profile?: string;
  /** Remote room identity when the local tombstone uses a synthetic row id. */
  remoteId?: string;
  queuedAt: number;
}

export interface HostedTurnOutboxItem {
  attempts?: number;
  cancelledAt?: number;
  deliveryAcceptedAt?: number;
  deliveryLeaseExpiresAt?: number;
  deliveryLeaseOwner?: string;
  deliveryLeaseToken?: string;
  deliveryTerminalAt?: number;
  foregroundFailedAt?: number;
  reconciliationAttempts?: number;
  reconciliationExhaustedAt?: number;
  conversationId: string;
  conversationPending?: boolean;
  conversationProfile?: string;
  conversationTitle?: string;
  draftClaim?: ConversationDraftClaim;
  input: HostedTurnEnqueueInput;
  lastError?: string;
  nextAttemptAt?: number;
  purpose?: 'hosted-turn-cancel' | 'message';
  pendingAttachments?: HostedTurnPendingAttachment[];
  queuedAt: number;
}

export interface ConversationDraftClaim {
  attachments: ConversationDraftClaimAttachment[];
  content: string;
  requestId: string;
}

export interface ConversationDraftClaimAttachment {
  id: string;
  uri: string;
}

export type PendingEnqueueInitializationRecovery =
  | 'none'
  | 'optimistic-ledger-replay';

export interface PendingEnqueueInitializationResult
  extends PendingEnqueueMutationResult {
  durable: boolean;
  recovery: PendingEnqueueInitializationRecovery;
}

export interface PendingEnqueueMutationResult {
  item: HostedTurnOutboxItem | null;
  updated: boolean;
}

export interface HostedTurnPendingAttachment {
  encryption?: 'aes-gcm-chunked-v2' | 'aes-gcm-v1';
  id: string;
  kind: 'file' | 'image';
  mimeType?: string | null;
  name: string;
  ownedTemporary?: boolean;
  sha256?: string;
  size?: number | null;
  sourceUri?: string;
  uri: string;
  uploaded?: JsonRecord;
}

export interface CollaborationRoomOutboxItem {
  content: string;
  profiles: string[];
  queuedAt: number;
  requestId: string;
  roomId: string;
}

export interface HostedInterventionOutboxItem {
  attempts?: number;
  content: string;
  conversationId: string;
  deliveryAcceptedAt?: number;
  lastError?: string;
  message: CollaborationMessage;
  messageId: string;
  nextAttemptAt?: number;
  queuedAt: number;
  turnId: string;
}

export interface PendingInterventionMutationResult {
  item: HostedInterventionOutboxItem | null;
  updated: boolean;
}

export interface OptimisticConversationLedgerItem {
  conversationId: string;
  messages: CollaborationMessage[];
  pendingTurn?: OptimisticPendingTurn;
  updatedAt: number;
}

export interface OptimisticPendingTurn {
  attempt: number;
  lastError?: string;
  phase: 'cancel_requested' | 'connecting' | 'executing' | 'reconnecting' | 'responding' | 'thinking';
  phaseStartedAt: number;
  turnId?: string;
  updatedAt: number;
  userMessageId: string;
}

export interface ConversationStorageAdapter {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}
