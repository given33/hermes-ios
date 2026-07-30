import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { ConversationLocalStore } from '../../api/conversation-local-store';
import type { HostedInterventionOutboxItem } from '../../api/conversation-store-types';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';
import type { HermesCloudApi, SingleConversation } from '../../api/HermesCloudApi';
import {
  conversationRunningHostedTurnId,
  upsertChatMessage,
  type HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import {
  chatMessageToCollaborationMessage,
  serverFailure,
  uniqueTurnId,
} from './chat-domain';
import type { HostedInterventionReplayService } from './hosted-intervention-replay-service';

interface HostedInterventionControllerOptions {
  activeConversationIdRef: MutableRefObject<string>;
  activeHostedTurnIdRef: MutableRefObject<string>;
  applyConversation(conversation: SingleConversation, expectedOwnerEpoch?: number): void;
  cacheOwner: string;
  cloudApi: HermesCloudApi | null;
  contentRef: MutableRefObject<string>;
  conversationIndexRef: MutableRefObject<SingleConversation[]>;
  deliverPendingIntervention(
    item: HostedInterventionOutboxItem,
    expectedOwnerEpoch: number,
  ): Promise<void>;
  interventionReplayService: HostedInterventionReplayService | null;
  isChinese: boolean;
  localStore: ConversationLocalStore | null;
  notify(message: string): void;
  setContent: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setSlashMenuOpen: Dispatch<SetStateAction<boolean>>;
}

export interface HostedInterventionController {
  sendIntervention(content: string): Promise<void>;
}

/**
 * Persist and deliver an @member intervention for the currently hosted turn.
 *
 * The durable write happens before the composer is cleared, so an app exit or
 * transport failure cannot make the user's intervention disappear.
 */
export function useHostedInterventionController({
  activeConversationIdRef,
  activeHostedTurnIdRef,
  applyConversation,
  cacheOwner,
  cloudApi,
  contentRef,
  conversationIndexRef,
  deliverPendingIntervention,
  interventionReplayService,
  isChinese,
  localStore,
  notify,
  setContent,
  setMessages,
  setSending,
  setSlashMenuOpen,
}: HostedInterventionControllerOptions): HostedInterventionController {
  const sendIntervention = useCallback(async (trimmed: string) => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    const conversationId = activeConversationIdRef.current;
    const activeConversation = conversationIndexRef.current.find(
      ({ id }) => id === conversationId,
    );
    const turnId = activeHostedTurnIdRef.current
      || (activeConversation ? conversationRunningHostedTurnId(activeConversation) : '');
    if (!cloudApi || !conversationId || !turnId) {
      setSending(false);
      notify(isChinese
        ? '当前群聊任务尚未准备好接收干预。'
        : 'The active group task is not ready for intervention.');
      return;
    }
    if (!localStore || !cacheOwner) {
      notify(isChinese
        ? '当前账户的持久消息队列尚未准备好。'
        : 'The durable message queue is not ready for this account.');
      return;
    }

    const createdAt = Date.now();
    const messageId = uniqueTurnId('intervention');
    const interventionMessage: ChatMessage = {
      avatarRole: 'user',
      content: trimmed,
      createdAt,
      durationMs: 0,
      id: messageId,
      name: isChinese ? '你' : 'You',
      role: 'user',
      runtimeTurnId: turnId,
      status: 'completed',
      updatedAt: createdAt,
    };
    const queuedIntervention: HostedInterventionOutboxItem = {
      attempts: 0,
      content: trimmed,
      conversationId,
      message: chatMessageToCollaborationMessage(interventionMessage),
      messageId,
      nextAttemptAt: 0,
      queuedAt: createdAt,
      turnId,
    };
    const initialization = await localStore.initializePendingIntervention(
      cacheOwner,
      queuedIntervention,
      ownerEpoch,
    ).catch((error) => {
      notify(serverFailure(error, isChinese));
      return null;
    });
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    if (!initialization) return;
    if (!initialization.item) {
      notify(isChinese
        ? '干预消息未能写入本地队列，请重试。'
        : 'The intervention could not be saved locally. Please retry.');
      return;
    }

    contentRef.current = '';
    setContent('');
    setSlashMenuOpen(false);
    setMessages((current) => upsertChatMessage(current, interventionMessage));
    try {
      await deliverPendingIntervention(initialization.item, ownerEpoch);
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    } catch (error) {
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
      const failure = serverFailure(error, isChinese);
      const outcome = await interventionReplayService?.handleFailure(
        initialization.item,
        error,
        ownerEpoch,
      ) ?? 'failed';
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
      notify(outcome === 'retry'
        ? isChinese
          ? `干预消息已保存，将自动重试：${failure}`
          : `Intervention saved for retry: ${failure}`
        : failure);
      return;
    }
    await cloudApi.getConversation(conversationId)
      .then(({ conversation }) => {
        if (isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) {
          applyConversation(conversation, ownerEpoch);
        }
      })
      .catch(() => undefined);
  }, [
    activeConversationIdRef,
    activeHostedTurnIdRef,
    applyConversation,
    cacheOwner,
    cloudApi,
    contentRef,
    conversationIndexRef,
    deliverPendingIntervention,
    interventionReplayService,
    isChinese,
    localStore,
    notify,
    setContent,
    setMessages,
    setSending,
    setSlashMenuOpen,
  ]);

  return { sendIntervention };
}
