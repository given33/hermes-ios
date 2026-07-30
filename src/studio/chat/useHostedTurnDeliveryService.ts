import { useMemo } from 'react';

import { HermesIOSContext } from '../../../modules/hermes-ios-context';
import type { HermesCloudApi } from '../../api/HermesCloudApi';
import type { ConversationLocalStore } from '../../api/conversation-local-store';
import { withDecryptedAttachment } from '../../api/attachment-outbox-crypto';
import { hydrateOutboxInput, persistPendingAttachments } from './chat-attachments';
import { isRecord } from './chat-domain';
import { createHostedTurnDeliveryService } from './hosted-turn-delivery-service';

interface HostedTurnDeliveryServiceOptions {
  cacheOwner: string;
  cloudApi: HermesCloudApi | null;
  isChinese: boolean;
  localStore: ConversationLocalStore | null;
  profile: string;
  requestTimeoutMs: number;
}

/** Compose the durable hosted-turn delivery service outside the chat screen. */
export function useHostedTurnDeliveryService({
  cacheOwner,
  cloudApi,
  isChinese,
  localStore,
  profile,
  requestTimeoutMs,
}: HostedTurnDeliveryServiceOptions) {
  return useMemo(() => (
    cloudApi && localStore && cacheOwner
      ? createHostedTurnDeliveryService({
          attachments: {
            hydrate: hydrateOutboxInput,
            persist: persistPendingAttachments,
            upload: async (item, attachment, signal) => {
              const result = await withDecryptedAttachment(
                HermesIOSContext,
                cacheOwner,
                attachment.uri,
                attachment.name,
                (plaintextUri) => cloudApi.uploadConversationAttachment(
                  item.conversationId,
                  {
                    mimeType: attachment.mimeType,
                    name: attachment.name,
                    sha256: attachment.sha256,
                    size: attachment.size,
                    uri: plaintextUri,
                  },
                  {
                    messageId: item.input.message.id,
                    profile: item.conversationProfile || profile,
                    turnId: item.input.turnId,
                    uploadId: attachment.id,
                  },
                  signal,
                ),
              );
              if (!isRecord(result.attachment)) {
                throw new Error('Attachment upload was not persisted');
              }
              return result.attachment;
            },
          },
          cacheOwner,
          cloud: cloudApi,
          isChinese,
          outbox: localStore,
          profile,
          requestTimeoutMs,
        })
      : null
  ), [cacheOwner, cloudApi, isChinese, localStore, profile, requestTimeoutMs]);
}
