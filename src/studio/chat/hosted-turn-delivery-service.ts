import { HermesApiError } from '../../api/HermesApiClient';
import { withAbortableDeadline } from '../../api/async-deadline';
import { assertConversationStorageEpochCurrent } from '../../api/conversation-storage-coordinator';
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
  removePendingIntervention(
    owner: string,
    messageId: string,
    expectedOwnerEpoch: number,
  ): Promise<void>;
  upsertPendingEnqueueIfActive(
    owner: string,
    item: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<PendingEnqueueMutationResult>;
  upsertPendingIntervention(
    owner: string,
    item: HostedInterventionOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<void>;
}

export interface HostedTurnAttachmentPort {
  hydrate(item: HostedTurnOutboxItem): HostedTurnOutboxItem;
  persist(
    owner: string,
    requestId: string,
    attachments: readonly HostedTurnPendingAttachment[],
    expectedOwnerEpoch: number,
  ): Promise<HostedTurnPendingAttachment[]>;
  upload(
    item: HostedTurnOutboxItem,
    attachment: HostedTurnPendingAttachment,
    signal: AbortSignal,
    expectedOwnerEpoch: number,
  ): Promise<JsonRecord>;
}

export interface HostedTurnDeliveryService {
  deliverPendingEnqueue(
    source: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<HostedTurnDelivery>;
  deliverPendingIntervention(
    item: HostedInterventionOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<void>;
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
  const assertCurrent = (expectedOwnerEpoch: number) => {
    assertConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch);
  };

  const persistIfActive = async (
    next: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ) => {
    assertCurrent(expectedOwnerEpoch);
    const mutation = await outbox.upsertPendingEnqueueIfActive(
      cacheOwner,
      next,
      expectedOwnerEpoch,
    );
    assertCurrent(expectedOwnerEpoch);
    if (!mutation.updated || !mutation.item) {
      throw new HostedTurnCancelledDuringDelivery();
    }
    return mutation.item;
  };

  const deliverOnce = async (
    source: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<HostedTurnDelivery> => {
    assertCurrent(expectedOwnerEpoch);
    let item = attachments.hydrate(source);
    if (item.cancelledAt) throw new HostedTurnCancelledDuringDelivery();
    if (item.deliveryAcceptedAt) throw new Error('Hosted turn was already accepted');

    if (item.pendingAttachments?.length) {
      const materialized = await attachments.persist(
        cacheOwner,
        item.input.requestId,
        item.pendingAttachments,
        expectedOwnerEpoch,
      );
      assertCurrent(expectedOwnerEpoch);
      item = await persistIfActive(
        { ...item, pendingAttachments: materialized },
        expectedOwnerEpoch,
      );
    }

    if (!item.conversationId) {
      item = await persistIfActive({
        ...item,
        conversationId: `chat_${safeRequestComponent(item.input.requestId).slice(0, 251)}`,
        conversationPending: true,
      }, expectedOwnerEpoch);
    }

    const createOnEnqueue = Boolean(
      item.conversationPending && !(item.pendingAttachments?.length),
    );
    if (item.conversationPending && !createOnEnqueue) {
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
      assertCurrent(expectedOwnerEpoch);
      item = await persistIfActive(
        { ...item, conversationPending: false },
        expectedOwnerEpoch,
      );
    }

    const pendingAttachments = [...(item.pendingAttachments || [])];
    for (let index = 0; index < pendingAttachments.length; index += 1) {
      const attachment = pendingAttachments[index];
      if (attachment.uploaded) continue;
      const uploaded = await withAbortableDeadline(
        (signal) => attachments.upload(item, attachment, signal, expectedOwnerEpoch),
        requestTimeoutMs,
        'Hermes attachment upload timed out',
      );
      assertCurrent(expectedOwnerEpoch);
      if (!isRecord(uploaded)) {
        throw new Error('Attachment upload was not persisted');
      }
      pendingAttachments[index] = { ...attachment, uploaded };
      item = await persistIfActive(
        attachments.hydrate({ ...item, pendingAttachments }),
        expectedOwnerEpoch,
      );
    }

    // The initial outbox transaction already durably contains a text-only
    // turn. Avoid another serialized AsyncStorage read/write before the
    // network hop; attachment metadata is the only delivery-time mutation
    // that must be persisted before enqueue.
    if (pendingAttachments.length || item.pendingAttachments?.length) {
      item = await persistIfActive(
        attachments.hydrate({ ...item, pendingAttachments }),
        expectedOwnerEpoch,
      );
    }
    const response = await withAbortableDeadline(
      (signal) => cloud.enqueueHostedTurn(item.conversationId, {
        ...item.input,
        createConversationIfMissing: createOnEnqueue,
        conversationProfile: item.conversationProfile || profile,
        conversationTitle: item.conversationTitle || (isChinese ? '新对话' : 'New conversation'),
      }, signal),
      requestTimeoutMs,
      'Hermes hosted-turn enqueue timed out',
    );
    assertCurrent(expectedOwnerEpoch);
    if (createOnEnqueue) {
      item = await persistIfActive(
        { ...item, conversationPending: false },
        expectedOwnerEpoch,
      );
    }
    return { item, response };
  };

  const deliverPendingEnqueue = async (
    source: HostedTurnOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<HostedTurnDelivery> => {
    assertCurrent(expectedOwnerEpoch);
    try {
      const delivered = await deliverOnce(source, expectedOwnerEpoch);
      assertCurrent(expectedOwnerEpoch);
      return delivered;
    } catch (error) {
      assertCurrent(expectedOwnerEpoch);
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
      await persistIfActive(replacement, expectedOwnerEpoch);
      assertCurrent(expectedOwnerEpoch);
      return deliverOnce(replacement, expectedOwnerEpoch);
    }
  };

  const deliverPendingIntervention = async (
    item: HostedInterventionOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<void> => {
    assertCurrent(expectedOwnerEpoch);
    if (!item.deliveryAcceptedAt) {
      const response = await cloud.interveneHostedTurn(
        item.conversationId,
        item.turnId,
        item.content,
        item.messageId,
      );
      assertCurrent(expectedOwnerEpoch);
      if (response.accepted !== true) {
        throw new HermesApiError(409, 'Hermes rejected the hosted intervention');
      }
      try {
        await outbox.upsertPendingIntervention(
          cacheOwner,
          {
            ...item,
            deliveryAcceptedAt: Date.now(),
            lastError: '',
            nextAttemptAt: 0,
          },
          expectedOwnerEpoch,
        );
        assertCurrent(expectedOwnerEpoch);
      } catch (error) {
        assertCurrent(expectedOwnerEpoch);
        // The stable message id makes replay server-idempotent when the local
        // acknowledgement marker cannot be persisted.
        return;
      }
    }
    try {
      await outbox.removePendingIntervention(
        cacheOwner,
        item.messageId,
        expectedOwnerEpoch,
      );
      assertCurrent(expectedOwnerEpoch);
    } catch (error) {
      assertCurrent(expectedOwnerEpoch);
    }
  };

  return { deliverPendingEnqueue, deliverPendingIntervention };
}
