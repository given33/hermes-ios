import { HermesApiError } from '../../api/HermesApiClient';
import { withAbortableDeadline } from '../../api/async-deadline';
import type {
  HostedInterventionOutboxItem,
  HostedTurnOutboxItem,
  HostedTurnPendingAttachment,
  PendingEnqueueMutationResult,
} from '../../api/conversation-local-store';
import type {
  HostedTurnEnqueueInput,
  HostedTurnEnqueueResponse,
  JsonRecord,
} from '../../api/HermesCloudApi';
import {
  HostedTurnCancelledDuringDelivery,
  type HostedTurnDelivery,
} from './chat-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConversationNotFoundError(error: unknown): boolean {
  return isRecord(error) && (error.status === 404 || error.statusCode === 404);
}

function safeRequestComponent(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+|\.+$/g, '');
  return safe.slice(0, 120) || 'pending';
}

export interface HostedTurnCloudPort {
  createConversation(
    profile: string,
    title: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<unknown>;
  enqueueHostedTurn(
    conversationId: string,
    input: HostedTurnEnqueueInput,
    signal?: AbortSignal,
  ): Promise<HostedTurnEnqueueResponse>;
  interveneHostedTurn(
    conversationId: string,
    turnId: string,
    content: string,
    messageId: string,
  ): Promise<{ accepted?: boolean }>;
  uploadConversationAttachment(
    conversationId: string,
    attachment: {
      mimeType?: string | null;
      name: string;
      uri: string;
    },
    identity: {
      messageId: string;
      profile: string;
      turnId: string;
      uploadId: string;
    },
    signal?: AbortSignal,
  ): Promise<{ attachment?: JsonRecord }>;
}

export interface HostedTurnOutboxPort {
  removePendingIntervention(owner: string, messageId: string): Promise<void>;
  upsertPendingEnqueueIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
  ): Promise<PendingEnqueueMutationResult>;
  upsertPendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
  ): Promise<void>;
}

export interface HostedTurnAttachmentPort {
  hydrate(item: HostedTurnOutboxItem): HostedTurnOutboxItem;
  persist(
    owner: string,
    requestId: string,
    attachments: readonly HostedTurnPendingAttachment[],
  ): Promise<HostedTurnPendingAttachment[]>;
  upload(
    item: HostedTurnOutboxItem,
    attachment: HostedTurnPendingAttachment,
    signal: AbortSignal,
  ): Promise<JsonRecord>;
}

export interface HostedTurnDeliveryService {
  deliverPendingEnqueue(source: HostedTurnOutboxItem): Promise<HostedTurnDelivery>;
  deliverPendingIntervention(item: HostedInterventionOutboxItem): Promise<void>;
}

interface HostedTurnDeliveryOptions {
  attachments: HostedTurnAttachmentPort;
  cacheOwner: string;
  cloud: HostedTurnCloudPort;
  isChinese: boolean;
  outbox: HostedTurnOutboxPort;
  profile: string;
  requestTimeoutMs: number;
}

export function createHostedTurnDeliveryService({
  attachments,
  cacheOwner,
  cloud,
  isChinese,
  outbox,
  profile,
  requestTimeoutMs,
}: HostedTurnDeliveryOptions): HostedTurnDeliveryService {
  const persistIfActive = async (next: HostedTurnOutboxItem) => {
    const mutation = await outbox.upsertPendingEnqueueIfActive(cacheOwner, next);
    if (!mutation.updated || !mutation.item) {
      throw new HostedTurnCancelledDuringDelivery();
    }
    return mutation.item;
  };

  const deliverOnce = async (source: HostedTurnOutboxItem): Promise<HostedTurnDelivery> => {
    let item = attachments.hydrate(source);
    if (item.cancelledAt) throw new HostedTurnCancelledDuringDelivery();
    if (item.deliveryAcceptedAt) throw new Error('Hosted turn was already accepted');

    if (item.pendingAttachments?.length) {
      const materialized = await attachments.persist(
        cacheOwner,
        item.input.requestId,
        item.pendingAttachments,
      );
      item = await persistIfActive({ ...item, pendingAttachments: materialized });
    }

    if (!item.conversationId) {
      item = await persistIfActive({
        ...item,
        conversationId: `chat_${safeRequestComponent(item.input.requestId).slice(0, 251)}`,
        conversationPending: true,
      });
    }

    if (item.conversationPending) {
      await withAbortableDeadline(
        (signal) => cloud.createConversation(
          item.conversationProfile || profile,
          item.conversationTitle || (isChinese ? '新对话' : 'New conversation'),
          item.conversationId,
          signal,
        ),
        requestTimeoutMs,
        'Hermes conversation creation timed out',
      );
      item = await persistIfActive({ ...item, conversationPending: false });
    }

    const pendingAttachments = [...(item.pendingAttachments || [])];
    for (let index = 0; index < pendingAttachments.length; index += 1) {
      const attachment = pendingAttachments[index];
      if (attachment.uploaded) continue;
      const uploaded = await withAbortableDeadline(
        (signal) => attachments.upload(item, attachment, signal),
        requestTimeoutMs,
        'Hermes attachment upload timed out',
      );
      if (!isRecord(uploaded)) {
        throw new Error('Attachment upload was not persisted');
      }
      pendingAttachments[index] = { ...attachment, uploaded };
      item = await persistIfActive(attachments.hydrate({ ...item, pendingAttachments }));
    }

    item = await persistIfActive(attachments.hydrate({ ...item, pendingAttachments }));
    const response = await withAbortableDeadline(
      (signal) => cloud.enqueueHostedTurn(item.conversationId, item.input, signal),
      requestTimeoutMs,
      'Hermes hosted-turn enqueue timed out',
    );
    return { item, response };
  };

  const deliverPendingEnqueue = async (
    source: HostedTurnOutboxItem,
  ): Promise<HostedTurnDelivery> => {
    try {
      return await deliverOnce(source);
    } catch (error) {
      if (
        !isConversationNotFoundError(error)
        || source.conversationPending
        || !source.input.requestId
      ) throw error;

      const replacementId = `chat_${safeRequestComponent(source.input.requestId).slice(0, 251)}`;
      if (replacementId === source.conversationId) throw error;
      const replacement: HostedTurnOutboxItem = {
        ...source,
        conversationId: replacementId,
        conversationPending: true,
        pendingAttachments: source.pendingAttachments?.map(
          ({ uploaded: _uploaded, ...attachment }) => attachment,
        ),
      };
      await persistIfActive(replacement);
      return deliverOnce(replacement);
    }
  };

  const deliverPendingIntervention = async (
    item: HostedInterventionOutboxItem,
  ): Promise<void> => {
    if (!item.deliveryAcceptedAt) {
      const response = await cloud.interveneHostedTurn(
        item.conversationId,
        item.turnId,
        item.content,
        item.messageId,
      );
      if (response.accepted !== true) {
        throw new HermesApiError(409, 'Hermes rejected the hosted intervention');
      }
      try {
        await outbox.upsertPendingIntervention(cacheOwner, {
          ...item,
          deliveryAcceptedAt: Date.now(),
          lastError: '',
          nextAttemptAt: 0,
        });
      } catch {
        // The stable message id makes replay server-idempotent when the local
        // acknowledgement marker cannot be persisted.
        return;
      }
    }
    await outbox.removePendingIntervention(cacheOwner, item.messageId).catch(() => undefined);
  };

  return { deliverPendingEnqueue, deliverPendingIntervention };
}
