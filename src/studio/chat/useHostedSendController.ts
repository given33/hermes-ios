import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from 'react';

import { hasNativeIOSContext } from '../../../modules/hermes-ios-context';
import type { HermesApiClient } from '../../api/HermesApiClient';
import {
  mergeCachedConversationUpdate,
  type ConversationLocalStore,
} from '../../api/conversation-local-store';
import type {
  HostedTurnOutboxItem,
  OptimisticPendingTurn,
} from '../../api/conversation-store-types';
import { ConversationSyncGeneration } from '../../api/conversation-sync-generation';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';
import {
  HostedTurnDeliveryClaimRegistry,
  hostedTurnDeliveryClaimKey,
  hostedTurnResponseFailure,
  hostedTurnTransportFailure,
} from '../../api/hosted-turn-delivery-state';
import type {
  CollaborationMessage,
  HostedTurnEnqueueInput,
  SingleConversation,
} from '../../api/HermesCloudApi';
import {
  upsertChatMessage,
  type ConversationCollaborationState,
  type HermesChatViewMessage as ChatMessage,
  type HostedTurnVisibilityFailure,
} from '../../api/chat-view-model';
import {
  previewDelay,
  previewNeedsCollaboration,
  previewTurnMessages,
} from '../../preview/chat-fixture-simulator';
import type { InFlightActionGate } from '../in-flight-action-gate';
import {
  cleanupPendingAttachments,
  persistPendingAttachments,
  planPendingAttachments,
  safeOutboxPathComponent,
} from './chat-attachments';
import {
  chatMessageToCollaborationMessage,
  serverFailure,
  uniqueTurnId,
} from './chat-domain';
import {
  draftClaimForComposer,
  recoverUndurableComposer,
} from './hosted-send-draft-state';
import {
  HostedTurnCancelledDuringDelivery,
  type ChatAttachment,
  type PendingChatSend,
  type PendingPhase,
} from './chat-types';
import type { HostedCancellationController } from './useHostedCancellationController';
import type { HostedInterventionController } from './useHostedInterventionController';
import type { HostedOutboxReplayController } from './useHostedOutboxReplayController';

interface HostedSendControllerOptions {
  activeConversationIdRef: MutableRefObject<string>;
  activeHostedTurnIdRef: MutableRefObject<string>;
  attachmentsRef: MutableRefObject<ChatAttachment[]>;
  autoFollowStreamRef: MutableRefObject<boolean>;
  beginOptimisticHostedTurn(conversationId: string, turnId: string): void;
  cacheOwner: string;
  cancellation: Pick<
    HostedCancellationController,
    'deliverAndReconcilePendingCancellation' | 'finalizePendingSend' | 'handleOutboxFailure'
  >;
  cancelledPendingSendKeysRef: MutableRefObject<Set<string>>;
  cancellingHostedTurn: boolean;
  cleanupAttachmentSources(items: readonly ChatAttachment[]): void;
  client?: HermesApiClient;
  cloudAvailable: boolean;
  commitConversationIndex(
    conversations: readonly SingleConversation[],
    activeId?: string,
    expectedOwnerEpoch?: number,
  ): void;
  contentRef: MutableRefObject<string>;
  conversationIndexRef: MutableRefObject<SingleConversation[]>;
  conversationSyncGenerationRef: MutableRefObject<ConversationSyncGeneration>;
  firstTokenAtRef: MutableRefObject<number>;
  fixtureMode: boolean;
  hostedRunning: boolean;
  hostedTurnDeliveryClaimsRef: MutableRefObject<HostedTurnDeliveryClaimRegistry>;
  hostedTurnVisibilityFailuresRef: MutableRefObject<Map<string, HostedTurnVisibilityFailure[]>>;
  intervention: HostedInterventionController;
  isChinese: boolean;
  keepLatestVisible(animated?: boolean, force?: boolean): void;
  loadConversation(
    conversationId: string,
    expectedGeneration?: number,
    signal?: AbortSignal,
  ): Promise<unknown>;
  localStore: ConversationLocalStore | null;
  messagesRef: MutableRefObject<ChatMessage[]>;
  notify(message: string): void;
  optimisticMessagesByConversationRef: MutableRefObject<Map<string, ChatMessage[]>>;
  optimisticMessagesRef: MutableRefObject<ChatMessage[]>;
  optimisticPendingByConversationRef: MutableRefObject<Map<string, OptimisticPendingTurn>>;
  outbox: Pick<
    HostedOutboxReplayController,
    'acceptPendingOutboxItem' | 'deliverPendingEnqueue' | 'settleAcceptedOutboxItem'
  >;
  pendingChatSendRef: MutableRefObject<PendingChatSend | null>;
  pendingTurnActiveRef: MutableRefObject<boolean>;
  profile: string;
  replaceOptimisticMessages(
    conversationId: string,
    messages: readonly ChatMessage[],
    pendingTurn?: OptimisticPendingTurn | null,
    expectedOwnerEpoch?: number,
  ): Promise<void>;
  sendOperationGenerationRef: MutableRefObject<number>;
  sendSubmissionGateRef: MutableRefObject<InFlightActionGate>;
  sending: boolean;
  setActiveConversationId: Dispatch<SetStateAction<string>>;
  setActiveHostedTurnId: Dispatch<SetStateAction<string>>;
  setContent: Dispatch<SetStateAction<string>>;
  setHostedRunning: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setReconnectAttempt(attempt: number): void;
  setSending: Dispatch<SetStateAction<boolean>>;
  setSlashMenuOpen: Dispatch<SetStateAction<boolean>>;
  updateAttachments(
    update: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[]),
  ): void;
  updateConversationCollaborationState(
    conversationId: string,
    state: ConversationCollaborationState,
  ): void;
  updatePendingPhase(phase: PendingPhase, startedAt?: number): void;
}

export interface HostedSendController {
  requestSend(): void;
  send(): Promise<void>;
}

/**
 * Own the foreground transaction that converts a composer draft into one
 * durable, idempotent hosted turn. Rendering stays optimistic, while every
 * awaited network operation is recoverable from the local outbox.
 */
export function useHostedSendController({
  activeConversationIdRef,
  activeHostedTurnIdRef,
  attachmentsRef,
  autoFollowStreamRef,
  beginOptimisticHostedTurn,
  cacheOwner,
  cancellation,
  cancelledPendingSendKeysRef,
  cancellingHostedTurn,
  cleanupAttachmentSources,
  client,
  cloudAvailable,
  commitConversationIndex,
  contentRef,
  conversationIndexRef,
  conversationSyncGenerationRef,
  firstTokenAtRef,
  fixtureMode,
  hostedRunning,
  hostedTurnDeliveryClaimsRef,
  hostedTurnVisibilityFailuresRef,
  intervention,
  isChinese,
  keepLatestVisible,
  loadConversation,
  localStore,
  messagesRef,
  notify,
  optimisticMessagesByConversationRef,
  optimisticMessagesRef,
  optimisticPendingByConversationRef,
  outbox,
  pendingChatSendRef,
  pendingTurnActiveRef,
  profile,
  replaceOptimisticMessages,
  sendOperationGenerationRef,
  sendSubmissionGateRef,
  sending,
  setActiveConversationId,
  setActiveHostedTurnId,
  setContent,
  setHostedRunning,
  setMessages,
  setReconnectAttempt,
  setSending,
  setSlashMenuOpen,
  updateAttachments,
  updateConversationCollaborationState,
  updatePendingPhase,
}: HostedSendControllerOptions): HostedSendController {
  const send = async () => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    const currentContent = contentRef.current;
    const trimmed = currentContent.trim();
    const pendingAttachments = [...attachmentsRef.current];
    const currentMessages = [...messagesRef.current];
    const attachmentCount = pendingAttachments.length;
    const interventionRequested = hostedRunning
      && attachmentCount === 0
      && trimmed.startsWith('@');
    if (
      (!trimmed && attachmentCount === 0)
      || (sending && !interventionRequested)
    ) return;
    // Attachment envelopes are intentionally owned by the iOS vault. Do not
    // create a durable outbox item that can only fail later on web, Android,
    // or Expo Go where the native module is unavailable.
    if (attachmentCount > 0 && !hasNativeIOSContext && !fixtureMode) {
      notify('Attachments require the Hermes iOS app build.');
      return;
    }
    if (interventionRequested) {
      await intervention.sendIntervention(trimmed);
      return;
    }

    const hadActiveConversation = Boolean(activeConversationIdRef.current);
    const userMessageCreatedAt = Date.now();
    const userMessageId = uniqueTurnId('user');
    const hostedTurnId = uniqueTurnId('hosted');
    const sendingConversationId = activeConversationIdRef.current
      || `chat_${safeOutboxPathComponent(userMessageId).slice(0, 251)}`;
    const conversationProfile = (
      conversationIndexRef.current.find(
        ({ id }) => id === activeConversationIdRef.current,
      )?.profile?.trim()
      || profile
    );
    const userMessage: ChatMessage = {
      avatarRole: 'user',
      content: trimmed || (isChinese
        ? `已添加 ${attachmentCount} 个附件`
        : `${attachmentCount} attachments`),
      createdAt: userMessageCreatedAt,
      durationMs: 0,
      id: userMessageId,
      name: isChinese ? '你' : 'You',
      role: 'user',
      runtimeTurnId: hostedTurnId,
      status: 'completed',
      updatedAt: userMessageCreatedAt,
    };
    const sendGeneration = ++sendOperationGenerationRef.current;
    const sendKey = hostedTurnDeliveryClaimKey(cacheOwner, userMessageId);
    cancelledPendingSendKeysRef.current.delete(sendKey);
    const isCurrentSend = () => (
      pendingTurnActiveRef.current
      && sendOperationGenerationRef.current === sendGeneration
      && !cancelledPendingSendKeysRef.current.has(sendKey)
      && isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)
    );
    pendingChatSendRef.current = {
      conversationId: sendingConversationId,
      key: sendKey,
      userMessage,
    };
    const durableOptimisticMessages = upsertChatMessage(
      optimisticMessagesByConversationRef.current.get(sendingConversationId) || [],
      userMessage,
    );
    const pendingTurnState = (
      phase: PendingPhase,
      attempt: number,
      phaseStartedAt: number,
      lastError = '',
    ): OptimisticPendingTurn => ({
      attempt,
      ...(lastError ? { lastError } : {}),
      phase,
      phaseStartedAt,
      turnId: hostedTurnId,
      updatedAt: Date.now(),
      userMessageId,
    });
    let composerCleared = false;
    const sentAttachmentIdentities = new Set(
      pendingAttachments.map(({ id, uri }) => `${id}\u0000${uri}`),
    );
    const clearQueuedComposer = () => {
      if (composerCleared) return;
      composerCleared = true;
      if (contentRef.current === currentContent) {
        contentRef.current = '';
        setContent('');
      }
      setSlashMenuOpen(false);
      updateAttachments((current) => current.filter(
        ({ id, uri }) => !sentAttachmentIdentities.has(`${id}\u0000${uri}`),
      ));
    };
    const restoreQueuedComposer = () => {
      const recovered = recoverUndurableComposer(
        { attachments: pendingAttachments, content: currentContent },
        { attachments: attachmentsRef.current, content: contentRef.current },
      );
      contentRef.current = recovered.content;
      setContent(recovered.content);
      updateAttachments(recovered.attachments);
      composerCleared = false;
      return recovered;
    };
    // Fence overlapping send/cancel callbacks while the first durable write
    // is in flight. User-visible optimistic state is committed afterwards.
    pendingTurnActiveRef.current = true;
    const plannedAttachments = planPendingAttachments(
      cacheOwner,
      userMessageId,
      pendingAttachments,
    );
    const serverUserMessage: CollaborationMessage = {
      content: userMessage.content,
      created_at: userMessageCreatedAt,
      id: userMessageId,
      kind: 'message',
      meta: {
        attachments: [],
        runtime_turn_id: hostedTurnId,
      },
      name: isChinese ? '你' : 'You',
      role: 'user',
      sender_id: 'account-owner',
      sender_name: isChinese ? '你' : 'You',
      status: 'completed',
      updated_at: userMessageCreatedAt,
    };
    const enqueueInput: HostedTurnEnqueueInput = {
      attachmentContext: '',
      attachmentIds: [],
      deliveryContext: '由服务端意图路由判断是否需要交付文件；需要时上传账户云端并在会话中返回。',
      message: serverUserMessage,
      profiles: [conversationProfile],
      recentMessages: [...currentMessages, userMessage].slice(-12).map((message) => ({
        content: message.content,
        role: message.role,
      })),
      requestId: userMessageId,
      turnId: hostedTurnId,
    };
    let enqueueAcknowledged = false;
    let hostedAccepted = false;
    let enqueuePersisted = false;
    let deliveryRetryScheduled = false;
    let queuedItem: HostedTurnOutboxItem | null = {
      attempts: 0,
      conversationId: sendingConversationId,
      conversationPending: !hadActiveConversation,
      conversationProfile,
      conversationTitle: trimmed.slice(0, 36) || (isChinese ? '新对话' : 'New conversation'),
      draftClaim: draftClaimForComposer(userMessageId, currentContent, pendingAttachments),
      input: enqueueInput,
      pendingAttachments: plannedAttachments,
      queuedAt: userMessageCreatedAt,
    };
    let deliveryClaim: symbol | null = null;
    pendingChatSendRef.current = {
      conversationId: sendingConversationId,
      key: sendKey,
      queuedItem,
      userMessage,
    };
    try {
      if (!localStore || !cacheOwner) {
        throw new Error('Durable hosted-turn outbox is unavailable');
      }
      // The outbox intent is the first awaited write. A process kill at any
      // later point can reconstruct the message and attachment paths.
      const initialPendingTurn = pendingTurnState('connecting', 0, userMessageCreatedAt);
      const initialization = await localStore.initializePendingEnqueue(
        cacheOwner,
        queuedItem,
        durableOptimisticMessages.map(chatMessageToCollaborationMessage),
        initialPendingTurn,
        ownerEpoch,
      );
      if (!isCurrentSend()) return;
      if (!initialization.durable || !initialization.item) {
        throw new Error('Hosted-turn outbox transaction conflicted with another pending send');
      }
      queuedItem = initialization.item;
      enqueuePersisted = true;
      autoFollowStreamRef.current = true;
      activeConversationIdRef.current = sendingConversationId;
      setActiveConversationId(sendingConversationId);
      if (hadActiveConversation) {
        hostedTurnVisibilityFailuresRef.current.delete(sendingConversationId);
        setMessages((current) => current.filter(
          ({ id }) => !id.startsWith('hosted-sync-failed-'),
        ));
      } else {
        commitConversationIndex([{
          created_at: userMessageCreatedAt,
          id: sendingConversationId,
          message_count: 1,
          messages: [chatMessageToCollaborationMessage(userMessage)],
          profile: conversationProfile,
          title: trimmed.slice(0, 36) || (isChinese ? '新对话' : 'New conversation'),
          updated_at: userMessageCreatedAt,
        }, ...conversationIndexRef.current], sendingConversationId, ownerEpoch);
      }
      setMessages((current) => upsertChatMessage(current, userMessage));
      keepLatestVisible(false, true);
      setSending(true);
      firstTokenAtRef.current = 0;
      setReconnectAttempt(0);
      updatePendingPhase('connecting', userMessageCreatedAt);
      clearQueuedComposer();
      // The request claim makes this idempotent across a kill between the
      // outbox commit and draft cleanup. A newer, non-matching draft survives.
      await localStore.clearDraftClaim(cacheOwner, queuedItem, ownerEpoch).catch(() => undefined);
      if (!isCurrentSend()) return;
      optimisticMessagesByConversationRef.current.set(
        sendingConversationId,
        durableOptimisticMessages,
      );
      optimisticPendingByConversationRef.current.set(sendingConversationId, initialPendingTurn);
      optimisticMessagesRef.current = durableOptimisticMessages;

      if (fixtureMode && !client) {
        enqueueAcknowledged = true;
        hostedAccepted = true;
        const collaborative = previewNeedsCollaboration(trimmed, attachmentCount);
        if (collaborative) {
          updateConversationCollaborationState(sendingConversationId, 'lifting');
          await previewDelay(700);
          if (!isCurrentSend()) return;
          updateConversationCollaborationState(sendingConversationId, 'active');
        }
        const executionStartedAt = Date.now();
        firstTokenAtRef.current = executionStartedAt;
        updatePendingPhase('thinking', executionStartedAt);
        const previewReplies = previewTurnMessages({
          collaborative,
          isChinese,
          startedAt: executionStartedAt,
          turnId: hostedTurnId,
        });
        let completedMessages = [...currentMessages, userMessage];
        for (const reply of previewReplies) {
          await previewDelay(collaborative ? 380 : 620);
          if (!isCurrentSend()) return;
          completedMessages = upsertChatMessage(completedMessages, reply);
          setMessages(completedMessages);
        }
        const completedAt = Date.now();
        const finalizedMessages = completedMessages.map((message) => (
          message.runtimeTurnId === hostedTurnId && message.role === 'assistant'
            ? {
                ...message,
                completedAt: message.completedAt || completedAt,
                durationMs: Math.max(
                  0,
                  (message.completedAt || completedAt)
                    - (message.startedAt || executionStartedAt),
                ),
                status: 'completed' as const,
                updatedAt: message.updatedAt || completedAt,
              }
            : message
        ));
        setMessages(finalizedMessages);
        const existingConversation = conversationIndexRef.current.find(
          ({ id }) => id === sendingConversationId,
        );
        const previewConversation: SingleConversation = {
          created_at: existingConversation?.created_at || userMessageCreatedAt,
          id: sendingConversationId,
          message_count: finalizedMessages.length,
          messages: finalizedMessages.map(chatMessageToCollaborationMessage),
          profile: conversationProfile,
          title: existingConversation?.title
            || trimmed.slice(0, 36)
            || (isChinese ? '新对话' : 'New conversation'),
          updated_at: completedAt,
        };
        commitConversationIndex(
          mergeCachedConversationUpdate(conversationIndexRef.current, previewConversation),
          sendingConversationId,
          ownerEpoch,
        );
        await localStore.removePendingEnqueue(cacheOwner, userMessageId, ownerEpoch);
        if (!isCurrentSend()) return;
        await replaceOptimisticMessages(sendingConversationId, [], null, ownerEpoch);
        if (!isCurrentSend()) return;
        optimisticPendingByConversationRef.current.delete(sendingConversationId);
        optimisticMessagesByConversationRef.current.delete(sendingConversationId);
        optimisticMessagesRef.current = [];
        pendingChatSendRef.current = null;
        pendingTurnActiveRef.current = false;
        setActiveHostedTurnId('');
        setHostedRunning(false);
        setSending(false);
        return;
      }

      if (!cloudAvailable || !client) {
        await cancellation.handleOutboxFailure(queuedItem, {
          certainty: 'definitive',
          code: 'HERMES_CONNECTION_UNAVAILABLE',
          message: isChinese
            ? '当前没有可用的 Hermes 服务器连接，请重新登录后重试。'
            : 'No Hermes server connection is available. Sign in again and try again.',
          retryable: false,
        }, ownerEpoch);
        return;
      }
      // The official Hermes gateway owns model readiness, retries, and
      // provider errors. A client-side /api/model preflight adds a cold-start
      // round trip and can disagree with the session that will actually run.
      let conversationId = sendingConversationId;
      const durableAttachments = await persistPendingAttachments(
        cacheOwner,
        userMessageId,
        plannedAttachments,
      );
      if (!isCurrentSend()) {
        cleanupPendingAttachments({ ...queuedItem, pendingAttachments: durableAttachments });
        return;
      }
      const durableMutation = await localStore.upsertPendingEnqueueIfActive(cacheOwner, {
        ...queuedItem,
        pendingAttachments: durableAttachments,
      }, ownerEpoch);
      if (!isCurrentSend()) return;
      if (!durableMutation.updated || !durableMutation.item) return;
      queuedItem = durableMutation.item;
      cleanupAttachmentSources(pendingAttachments);
      deliveryClaim = hostedTurnDeliveryClaimsRef.current.tryAcquire(sendKey);
      if (!deliveryClaim) {
        deliveryRetryScheduled = true;
        return;
      }
      pendingChatSendRef.current = { conversationId, key: sendKey, queuedItem, userMessage };
      clearQueuedComposer();
      const delivery = await outbox.deliverPendingEnqueue(queuedItem, ownerEpoch);
      if (!isCurrentSend()) return;
      queuedItem = delivery.item;
      conversationId = queuedItem.conversationId;
      enqueueAcknowledged = true;
      hostedAccepted = delivery.response.accepted;
      const responseFailure = hostedTurnResponseFailure(delivery.response);
      if (responseFailure) {
        const outcome = await cancellation.handleOutboxFailure(
          queuedItem,
          responseFailure,
          ownerEpoch,
        );
        if (!isCurrentSend()) return;
        deliveryRetryScheduled = outcome === 'retry';
        if (deliveryRetryScheduled) setSending(true);
        return;
      }
      clearQueuedComposer();
      queuedItem = {
        ...queuedItem,
        deliveryAcceptedAt: Date.now(),
        lastError: '',
        nextAttemptAt: 0,
      };
      const acceptedMutation = await outbox.acceptPendingOutboxItem(queuedItem, ownerEpoch);
      if (!isCurrentSend()) return;
      if (!acceptedMutation.updated || !acceptedMutation.item) {
        if (acceptedMutation.item?.cancelledAt) {
          void cancellation.deliverAndReconcilePendingCancellation(
            acceptedMutation.item,
            ownerEpoch,
          );
        }
        return;
      }
      queuedItem = acceptedMutation.item;
      activeConversationIdRef.current = conversationId;
      setActiveConversationId(conversationId);
      if (activeConversationIdRef.current === conversationId) {
        activeHostedTurnIdRef.current = hostedTurnId;
        beginOptimisticHostedTurn(conversationId, hostedTurnId);
        setActiveHostedTurnId(hostedTurnId);
        setHostedRunning(true);
        pendingTurnActiveRef.current = true;
        pendingChatSendRef.current = null;
        cancelledPendingSendKeysRef.current.delete(sendKey);
        await outbox.settleAcceptedOutboxItem(queuedItem, ownerEpoch);
        if (!isCurrentSend()) return;
        const generation = conversationSyncGenerationRef.current.advanceActive();
        await loadConversation(conversationId, generation);
        if (!isCurrentSend()) return;
      }
    } catch (error) {
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
      if (!isCurrentSend() || error instanceof HostedTurnCancelledDuringDelivery) {
        if (localStore && cacheOwner && queuedItem) {
          const cancelled = await localStore.cancelPendingEnqueue(
            cacheOwner,
            userMessageId,
            queuedItem,
            Date.now(),
            ownerEpoch,
          );
          if (cancelled && isCurrentSend()) {
            void cancellation.deliverAndReconcilePendingCancellation(cancelled, ownerEpoch);
          }
        }
        return;
      }
      if (enqueuePersisted && !enqueueAcknowledged) {
        const transportFailure = hostedTurnTransportFailure(error);
        const outcome = await cancellation.handleOutboxFailure(
          queuedItem || pendingChatSendRef.current?.queuedItem || {
            conversationId: sendingConversationId,
            input: {
              message: chatMessageToCollaborationMessage(userMessage),
              recentMessages: [],
              requestId: userMessageId,
              turnId: hostedTurnId,
            },
            queuedAt: userMessageCreatedAt,
          },
          {
            ...transportFailure,
            message: serverFailure(error, isChinese),
          },
          ownerEpoch,
        );
        if (!isCurrentSend()) return;
        deliveryRetryScheduled = outcome === 'retry';
        if (deliveryRetryScheduled) {
          notify(isChinese
            ? '消息已保存在待发送队列，将在一分钟后自动重连。'
            : 'Message queued. Hermes will retry in one minute.');
        }
      } else if (!enqueueAcknowledged) {
        const recovered = restoreQueuedComposer();
        if (localStore && cacheOwner) {
          await localStore.writeDraft(
            cacheOwner,
            sendingConversationId,
            recovered.content,
            recovered.attachments.flatMap((attachment) => (
              attachment.draftPersistent
                ? [{ ...attachment, draftPersistent: true as const }]
                : []
            )),
            ownerEpoch,
          ).catch(() => undefined);
          if (!isCurrentSend()) return;
        }
        const failure = serverFailure(error, isChinese);
        pendingChatSendRef.current = null;
        pendingTurnActiveRef.current = false;
        notify(isChinese
          ? `本地存储失败，草稿已恢复：${failure}`
          : `Local storage failed. Your draft was restored: ${failure}`);
      } else {
        const failure = serverFailure(error, isChinese);
        notify(isChinese
          ? `任务已由服务器接管，当前同步暂时失败：${failure}`
          : `The server is still running the task. Conversation sync failed temporarily: ${failure}`);
      }
    } finally {
      if (deliveryClaim) hostedTurnDeliveryClaimsRef.current.release(sendKey, deliveryClaim);
      if (!hostedAccepted && !deliveryRetryScheduled && isCurrentSend()) {
        pendingTurnActiveRef.current = false;
        setHostedRunning(false);
        setSending(false);
      }
    }
  };

  const requestSend = () => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    const interventionRequested = hostedRunning
      && attachmentsRef.current.length === 0
      && contentRef.current.trim().startsWith('@');
    if (
      cancellingHostedTurn
      || (sending && !interventionRequested)
      || (!contentRef.current.trim() && attachmentsRef.current.length === 0)
      || !sendSubmissionGateRef.current.tryAcquire()
    ) return;
    void send().finally(() => sendSubmissionGateRef.current.release());
  };

  return { requestSend, send };
}
