import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HermesApiClient } from '../api/HermesApiClient';
import type { SidebarGatewayStatus } from '../app/NativeShell';
import {
  hermesCloudApiFor,
  sharedConversationLocalStore,
} from '../api/hermes-api-registry';
import {
  HOSTED_TURN_RETRY_DELAY_MS,
} from '../api/hosted-turn-delivery-state';
import {
  type HermesChatViewMessage as ChatMessage,
  type ConversationCollaborationState,
} from '../api/chat-view-model';
import { applyHostedLifecycleEvents } from '../api/hosted-lifecycle-view-model';
import { useTheme } from '../design/ThemeProvider';
import type { HermesNotificationTarget } from '../notifications/notification-target';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  resolveComposerFontSize,
} from './chat/chat-attachments';
import {
  serverFailure,
} from './chat/chat-domain';
import { ChatPageShell } from './chat/ChatPageShell';
import { useChatPageState } from './chat/useChatPageState';
import { useHostedTurnDeliveryService } from './chat/useHostedTurnDeliveryService';
import { useHermesVoice } from './chat/useHermesVoice';
import { useHostedConversationStream } from './chat/useHostedConversationStream';
import { useConversationIndexLifecycle } from './chat/useConversationIndexLifecycle';
import { useChatScrollController } from './chat/useChatScrollController';
import { useOptimisticConversationState } from './chat/useOptimisticConversationState';
import { useConversationSnapshotController } from './chat/useConversationSnapshotController';
import { useConversationDraftPersistence } from './chat/useConversationDraftPersistence';
import { useConversationIndexController } from './chat/useConversationIndexController';
import { useHostedCancellationController } from './chat/useHostedCancellationController';
import { useHostedOutboxReplayController } from './chat/useHostedOutboxReplayController';
import { useChatAttachmentController } from './chat/useChatAttachmentController';
import { isLargePaste } from './chat/composer-draft-policy';
import { useHostedInterventionController } from './chat/useHostedInterventionController';
import { useHostedSendController } from './chat/useHostedSendController';
import { latestChatPlan } from './chat/chat-plan-model';
import { useConversationActionsController } from './chat/useConversationActionsController';
import { useChatComposerNavigationController } from './chat/useChatComposerNavigationController';
import { useMobileConsoleController } from './chat/useMobileConsoleController';
import {
  useChatSendAction,
  useCollaborationStateUpdater,
  useMentionMemberAction,
  useRelayCheckAction,
} from './chat/useChatPageActions';
import { useChatAttachmentLifecycle } from './chat/useChatAttachmentLifecycle';
const HOSTED_TURN_VISIBILITY_GRACE_MS = 20_000;
const RECONNECT_MAX_ATTEMPTS = 5;
const HOSTED_TURN_REQUEST_TIMEOUT_MS = 20_000;
const HOSTED_TURN_CANCEL_TIMEOUT_MS = 5_000;
interface ChatPreviewPageProps {
  cacheOwner?: string;
  client?: HermesApiClient;
  fixtureMode?: boolean;
  gatewayStatuses?: readonly SidebarGatewayStatus[];
  locale?: 'en' | 'zh';
  notify(message: string): void;
  notificationTarget?: HermesNotificationTarget | null;
  openNavigation?(): void;
  onPreferredConversationConsumed?(conversationId: string): void;
  preferredConversationId?: string;
  profile?: string;
}
export function ChatPreviewPage({
  cacheOwner = '',
  client,
  fixtureMode = false,
  gatewayStatuses = [],
  locale = 'zh',
  notify,
  notificationTarget,
  openNavigation,
  onPreferredConversationConsumed,
  preferredConversationId = '',
  profile = 'default',
}: ChatPreviewPageProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { tokens } = useTheme();
  const cloudApi = useMemo(() => client ? hermesCloudApiFor(client) : null, [client]);
  const localStore = useMemo(
    () => cacheOwner ? sharedConversationLocalStore() : null,
    [cacheOwner],
  );
  const hostedTurnDeliveryService = useHostedTurnDeliveryService({
    cacheOwner,
    cloudApi,
    isChinese: locale === 'zh',
    localStore,
    profile,
    requestTimeoutMs: HOSTED_TURN_REQUEST_TIMEOUT_MS,
  });
  const {
    activeConversationId, activeConversationIdRef, activeHostedTurnIdRef,
    attachmentOwnerRef, attachments, attachmentsOpen, attachmentsRef,
    cancelHostedTurnInFlightRef, cancelledPendingSendKeysRef, cancellingHostedTurn,
    collaborationState, collaborationStateByConversationRef, composerInputRef,
    composerRevisionRef, content, contentRef, conversationIndexRef, conversations,
    conversationSyncGenerationRef, historyCollapsed, historyModalOpen,
    hostedAccountGenerationRef, hostedEventCursorRef, hostedRunning,
    hostedTurnDeliveryClaimsRef, messages, messagesRef,
    mountedRef, pendingAttachmentCleanup, pendingChatSendRef, pendingTurn,
    sendOperationGenerationRef, sendSubmissionGateRef, sending,
    setActiveConversationId, setActiveHostedTurnId, setAttachments,
    setAttachmentsOpen, setCancellingHostedTurn, setCollaborationState,
    setContent, setConversations, setHistoryCollapsed, setHistoryModalOpen,
    setHostedRunning, setMessages, setSending,
  } = useChatPageState(cacheOwner);
  const pendingPhase = pendingTurn.state.phase;
  const pendingPhaseStartedAt = pendingTurn.state.phaseStartedAt;
  const reconnectAttempt = pendingTurn.state.reconnectAttempt;
  const setReconnectAttempt = pendingTurn.setReconnectAttempt;
  const pendingPhaseRef = pendingTurn.phaseRef;
  const firstTokenAtRef = pendingTurn.firstTokenAtRef;
  const pendingTurnActiveRef = pendingTurn.activeRef;
  const isChinese = locale === 'zh';
  const voiceInterruptAgentRef = useRef<(() => Promise<void> | void) | null>(null);
  const {
    beginOptimisticHostedTurn,
    clearOptimisticHostedTurn,
    clearOptimisticPendingTurn,
    hostedTurnVisibilityFailuresRef,
    optimisticHostedTurnConfirmedRef,
    optimisticHostedTurnDeadlineRef,
    optimisticHostedTurnIdRef,
    optimisticHostedTurnTimeoutRef,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    replaceOptimisticMessages,
  } = useOptimisticConversationState({
    activeConversationIdRef,
    activeHostedTurnIdRef,
    cacheOwner,
    isChinese,
    localStore,
    profile,
    setActiveHostedTurnId,
    setHostedRunning,
    setMessages,
    setSending,
    visibilityGraceMs: HOSTED_TURN_VISIBILITY_GRACE_MS,
  });
  const compact = width <= 560;
  const mentionMember = useMentionMemberAction({
    composerInputRef,
    contentRef,
    setContent,
  });
  const shellSplit = width >= 768;
  const showHistory = width > 900;
  const showCollaborationHeaderCount = width >= 1_180;
  const safeAreaBottom = insets.bottom;
  const safeAreaLeft = shellSplit ? 0 : insets.left;
  const safeAreaRight = shellSplit ? 0 : insets.right;
  const safeAreaTop = shellSplit ? 0 : insets.top;
  const {
    autoFollowStreamRef,
    composerKeyboardStyle,
    handleStreamScroll,
    keepLatestVisible,
    keyboardAvoidanceEnabled,
    keyboardRootStyle,
    pauseStreamAutoFollow,
    showScrollToBottom,
    streamRef,
  } = useChatScrollController(safeAreaBottom);
  const {
    filteredSlashCommands,
    openNavigationAfterKeyboard,
    selectSlashCommand,
    setSlashMenuOpen,
    slashMenuOpen,
  } = useChatComposerNavigationController({
    cloudApi,
    composerInputRef,
    content,
    contentRef,
    keyboardAvoidanceEnabled,
    openNavigation,
    profile,
    setContent,
  });
  const attachmentCount = attachments.length;
  const composingIntervention = hostedRunning
    && attachmentCount === 0
    && content.trim().startsWith('@');
  const canCancelHostedTurn = (hostedRunning || sending)
    && !composingIntervention
    && !cancellingHostedTurn
    && pendingPhase !== 'cancel_requested';
  const pendingStartedAt = pendingPhaseStartedAt;
  const displayMessages = messages;
  const chatPlan = useMemo(() => latestChatPlan(displayMessages), [displayMessages]);
  const collaborationStartIndex = collaborationState === 'active'
    ? displayMessages.findIndex((message) => (
        message.role !== 'user' && message.roleStage && message.roleStage !== 'chat'
      ))
    : -1;
  const inputFontSize = resolveComposerFontSize(content);
  const { cleanupAttachmentSources, updateAttachments } = useChatAttachmentLifecycle({
    attachmentOwnerRef,
    attachmentsRef,
    cacheOwner,
    composerRevisionRef,
    clearOptimisticHostedTurn,
    mountedRef,
    pendingAttachmentCleanup,
    setAttachments,
  });
  useConversationDraftPersistence({
    activeConversationId,
    attachments,
    attachmentsRef,
    cacheOwner,
    cleanupAttachmentSources,
    content,
    contentRef,
    composerRevisionRef,
    localStore,
    setContent,
    updateAttachments,
  });
  const updatePendingPhase = pendingTurn.updatePhase;
  const resetPendingStateMachine = pendingTurn.reset;
  const updateConversationCollaborationState = useCollaborationStateUpdater({
    activeConversationIdRef,
    collaborationStateByConversationRef,
    setCollaborationState,
  });
  const {
    applyConversation,
    commitConversationIndex,
    loadConversation,
  } = useConversationSnapshotController({
    activeConversationIdRef,
    activeHostedTurnIdRef,
    cacheOwner,
    clearOptimisticHostedTurn,
    clearOptimisticPendingTurn,
    cloudApi,
    conversationIndexRef,
    conversationSyncGenerationRef,
    firstTokenAtRef,
    hostedEventCursorRef,
    hostedTurnVisibilityFailuresRef,
    isChinese,
    localStore,
    optimisticHostedTurnConfirmedRef,
    optimisticHostedTurnDeadlineRef,
    optimisticHostedTurnIdRef,
    optimisticHostedTurnTimeoutRef,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    pendingPhaseRef,
    pendingTurnActiveRef,
    reconnectAttempt,
    replaceOptimisticMessages,
    setActiveConversationId,
    setActiveHostedTurnId,
    setConversations,
    setHostedRunning,
    setMessages,
    setReconnectAttempt,
    setSending,
    updateConversationCollaborationState,
    updatePendingPhase,
  });

  const {
    cancelPendingSend,
    deliverAndReconcilePendingCancellation,
    finalizePendingSend,
    handleOutboxFailure,
  } = useHostedCancellationController({
    activeConversationIdRef,
    activeHostedTurnIdRef,
    applyConversation,
    cacheOwner,
    cancelTimeoutMs: HOSTED_TURN_CANCEL_TIMEOUT_MS,
    cancelledKeysRef: cancelledPendingSendKeysRef,
    cloudApi,
    isChinese,
    localStore,
    maxReconnectAttempts: RECONNECT_MAX_ATTEMPTS,
    mountedRef,
    notify,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    pendingChatSendRef,
    pendingTurnActiveRef,
    replaceOptimisticMessages,
    resetPendingStateMachine,
    sendOperationGenerationRef,
    setActiveHostedTurnId,
    setHostedRunning,
    setMessages,
    setReconnectAttempt,
    setSending,
    updatePendingPhase,
  });

  const {
    acceptPendingOutboxItem,
    deliverPendingEnqueue,
    deliverPendingIntervention,
    interventionReplayService,
    replayDurableOutboxes,
    settleAcceptedOutboxItem,
  } = useHostedOutboxReplayController({
    acceptFailureCleanupDelayMs: HOSTED_TURN_RETRY_DELAY_MS,
    activeConversationIdRef,
    activeHostedTurnIdRef,
    attachmentsRef,
    beginOptimisticHostedTurn,
    cacheOwner,
    cloudApi,
    conversationSyncGenerationRef,
    deliverAndReconcilePendingCancellation,
    finalizePendingSend,
    handleOutboxFailure,
    hostedTurnDeliveryClaimsRef,
    hostedTurnDeliveryService,
    isChinese,
    loadConversation,
    localStore,
    maxReconnectAttempts: RECONNECT_MAX_ATTEMPTS,
    mountedRef,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    pendingTurnActiveRef,
    profile,
    setActiveConversationId,
    setActiveHostedTurnId,
    setHostedRunning,
    setMessages,
    setReconnectAttempt,
    setSending,
    updateConversationCollaborationState,
    updatePendingPhase,
  });

  const { sendIntervention } = useHostedInterventionController({
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
  });

  const hostedSend = useHostedSendController({
    activeConversationIdRef,
    activeHostedTurnIdRef,
    attachmentsRef,
    autoFollowStreamRef,
    beginOptimisticHostedTurn,
    cacheOwner,
    cancellation: {
      deliverAndReconcilePendingCancellation,
      finalizePendingSend,
      handleOutboxFailure,
    },
    cancelledPendingSendKeysRef,
    cancellingHostedTurn,
    client,
    cloudAvailable: Boolean(cloudApi),
    cleanupAttachmentSources,
    commitConversationIndex,
    contentRef,
    conversationIndexRef,
    firstTokenAtRef,
    fixtureMode,
    hostedRunning,
    hostedTurnDeliveryClaimsRef,
    hostedTurnVisibilityFailuresRef,
    intervention: { sendIntervention },
    isChinese,
    keepLatestVisible,
    localStore,
    messagesRef,
    notify,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    outbox: {
      acceptPendingOutboxItem,
      deliverPendingEnqueue,
      settleAcceptedOutboxItem,
    },
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
  });

  const { consoleConfirmation, consoleRunning, executeConsoleCommand } = useMobileConsoleController({
    activeConversationId,
    activeConversationIdRef,
    applyConversation,
    cacheOwner,
    cloudApi,
    conversationSyncGenerationRef,
    contentRef,
    isChinese,
    notify,
    profile,
    setActiveConversationId,
    setContent,
    setMessages,
    setSlashMenuOpen,
  });
  const canSend = Boolean(content.trim() || attachmentCount > 0)
    && (!sending || composingIntervention)
    && !cancellingHostedTurn
    && !consoleRunning;
  const {
    openConversation,
    refreshConversationHistory,
    refreshConversationIndex,
    resetHydration,
  } = useConversationIndexController({
    activeConversationIdRef,
    activeHostedTurnIdRef,
    applyConversation,
    cacheOwner,
    clearOptimisticHostedTurn,
    cloudApi,
    commitConversationIndex,
    conversationIndexRef,
    conversationSyncGenerationRef,
    fixtureMode,
    isChinese,
    loadConversation,
    localStore,
    notify,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    pendingTurnActiveRef,
    profile,
    requestTimeoutMs: HOSTED_TURN_REQUEST_TIMEOUT_MS,
    setActiveConversationId,
    setActiveHostedTurnId,
    setCollaborationState,
    setConversations,
    setHostedRunning,
    setMessages,
    setSending,
  });

  const {
    cancelVoiceInput,
    readRepliesAloud,
    speakingMessageId,
    startVoiceInput,
    stopVoiceInput,
    toggleMessageSpeech,
    toggleReadRepliesAloud,
    voiceDurationMs,
    voiceError,
    voicePreview,
    voiceState,
  } = useHermesVoice({
    agentTurnActive: hostedRunning || sending,
    applyTranscript: useCallback((next: string) => {
      contentRef.current = next;
      setContent(next);
    }, []),
    describeError: useCallback(
      (error: unknown) => serverFailure(error, isChinese),
      [isChinese],
    ),
    cloudApi,
    focusComposer: useCallback(() => composerInputRef.current?.focus(), []),
    getDraft: useCallback(() => contentRef.current, []),
    isChinese,
    messages,
    notify,
    onInterruptAgent: useCallback(
      () => voiceInterruptAgentRef.current?.(),
      [],
    ),
  });
  const checkApiRelay = useRelayCheckAction({ cloudApi, isChinese, notify });
  useEffect(() => {
    conversationSyncGenerationRef.current.invalidateAll();
    resetHydration();
    conversationIndexRef.current = [];
    collaborationStateByConversationRef.current = new Map();
    hostedEventCursorRef.current = new Map();
    hostedAccountGenerationRef.current = new Map();
    optimisticMessagesByConversationRef.current = new Map();
    optimisticPendingByConversationRef.current = new Map();
    optimisticMessagesRef.current = [];
    activeConversationIdRef.current = '';
    activeHostedTurnIdRef.current = '';
    clearOptimisticHostedTurn();
    resetPendingStateMachine();
    setConversations([]);
    setActiveConversationId('');
    setActiveHostedTurnId('');
    setMessages([]);
    setCollaborationState('single');
    setHostedRunning(false);
    setSending(false);
  }, [cacheOwner, clearOptimisticHostedTurn, resetHydration, resetPendingStateMachine]);

  const notifyConversationLifecycleError = useCallback((error: unknown) => {
    notify(serverFailure(error, isChinese));
  }, [isChinese, notify]);

  const openNotificationConversation = useCallback((conversationId: string) => {
    const generation = conversationSyncGenerationRef.current.advanceActive();
    return openConversation(conversationId, generation);
  }, [conversationSyncGenerationRef, openConversation]);

  useConversationIndexLifecycle({
    activeConversationIdRef,
    notificationConversationId: notificationTarget?.conversationId,
    notificationIdentity: notificationTarget?.notificationId,
    onError: notifyConversationLifecycleError,
    openNotificationConversation,
    onPreferredConversationConsumed,
    preferredConversationId,
    refreshConversationIndex,
    replayDurableOutboxes,
  });

  const applyLiveHostedEvents = useCallback((events: Parameters<typeof applyHostedLifecycleEvents>[1]) => {
    const result = applyHostedLifecycleEvents(messagesRef.current, events, isChinese);
    setMessages(result.messages);
    for (const notice of result.notices) notify(notice);
    if (result.firstTokenAt && !firstTokenAtRef.current) {
      firstTokenAtRef.current = result.firstTokenAt;
    }
    if (result.reconnectAttempt !== undefined) {
      setReconnectAttempt(result.reconnectAttempt);
    } else if (result.phase && result.phase !== 'reconnecting') {
      setReconnectAttempt(0);
    }
    if (result.phase) {
      updatePendingPhase(result.phase, result.phaseStartedAt || Date.now());
    }
    if (result.completed || result.failed) {
      pendingTurnActiveRef.current = false;
      setHostedRunning(false);
      setSending(false);
    } else if (result.turnActive) {
      pendingTurnActiveRef.current = true;
      setHostedRunning(true);
    }
  }, [
    firstTokenAtRef,
    isChinese,
    messagesRef,
    notify,
    pendingTurnActiveRef,
    setHostedRunning,
    setMessages,
    setReconnectAttempt,
    setSending,
    updatePendingPhase,
  ]);

  useHostedConversationStream({
    accountGenerationRef: hostedAccountGenerationRef,
    activeConversationId,
    activeConversationIdRef,
    applyConversation,
    applyLifecycleEvents: applyLiveHostedEvents,
    cacheOwner,
    cloudApi,
    cursorRef: hostedEventCursorRef,
    generation: conversationSyncGenerationRef.current,
    hostedRunning,
    loadConversation,
    requestTimeoutMs: HOSTED_TURN_REQUEST_TIMEOUT_MS,
  });

  const {
    branchFromMessage,
    cancelActiveHostedTurn,
    createConversation,
    selectConversation,
  } = useConversationActionsController({
    activeConversationIdRef,
    activeHostedTurnIdRef,
    applyConversation,
    autoFollowStreamRef,
    cacheOwner,
    cancelHostedTurnInFlightRef,
    cancelTimeoutMs: HOSTED_TURN_CANCEL_TIMEOUT_MS,
    cancellation: {
      cancelPendingSend,
      deliverAndReconcilePendingCancellation,
    },
    clearOptimisticHostedTurn,
    clearOptimisticPendingTurn,
    cloudApi,
    collaborationStateByConversationRef,
    commitConversationIndex,
    conversationIndexRef,
    conversationSyncGenerationRef,
    hostedRunning,
    isChinese,
    localStore,
    notify,
    openConversation,
    optimisticMessagesByConversationRef,
    optimisticMessagesRef,
    optimisticPendingByConversationRef,
    pendingChatSendRef,
    pendingTurnActiveRef,
    profile,
    resetPendingStateMachine,
    sendOperationGenerationRef,
    sending,
    setActiveConversationId,
    setActiveHostedTurnId,
    setCancellingHostedTurn,
    setCollaborationState,
    setHostedRunning,
    setMessages,
    setSending,
    setSlashMenuOpen,
    updatePendingPhase,
  });

  useEffect(() => {
    const interrupt = async () => {
      if (canCancelHostedTurn) await cancelActiveHostedTurn();
    };
    voiceInterruptAgentRef.current = interrupt;
    return () => {
      if (voiceInterruptAgentRef.current === interrupt) {
        voiceInterruptAgentRef.current = null;
      }
    };
  }, [canCancelHostedTurn, cancelActiveHostedTurn]);

  const requestSend = useChatSendAction({
    attachmentsRef,
    canCancelHostedTurn,
    cancelActiveHostedTurn,
    contentRef,
    executeConsoleCommand,
    hostedRequestSend: hostedSend.requestSend,
    isChinese,
    notify,
    setContent,
    setSlashMenuOpen,
  });

  const {
    appendLargePastedText,
    openAttachmentPicker,
    openStoredAttachment,
    pickFile,
    pickPhoto,
    previewAttachment,
    removeAttachment,
    shareAttachment,
  } = useChatAttachmentController({
    cacheOwner,
    cleanupAttachmentSources,
    cloudApi,
    composerInputRef,
    isChinese,
    keepLatestVisible,
    keyboardAvoidanceEnabled,
    notify,
    pendingAttachmentCleanup,
    setAttachmentsOpen,
    updateAttachments,
  });

  return (
    <>
      <ChatPageShell
      attachmentsOpen={attachmentsOpen}
      backgroundColor={tokens.colors.background}
      compact={compact}
      composerKeyboardStyle={composerKeyboardStyle}
      composerProps={{
        actions: {
          onCancelHostedTurn: () => { void cancelActiveHostedTurn(); },
          onContentChange: (next) => {
            const previous = contentRef.current;
            if (isLargePaste(previous, next)) {
              const conversationId = activeConversationIdRef.current;
              try {
                const prepared = appendLargePastedText(next);
                if (!prepared) return;
                if (
                  contentRef.current !== previous
                  || activeConversationIdRef.current !== conversationId
                ) {
                  cleanupAttachmentSources([prepared.attachment]);
                  return;
                }
                updateAttachments((current) => [...current, prepared.attachment]);
                contentRef.current = prepared.marker;
                setContent(prepared.marker);
                setSlashMenuOpen(false);
              } catch (error) {
                notify(serverFailure(error, isChinese));
              }
              return;
            }
            contentRef.current = next;
            setContent(next);
            setSlashMenuOpen(next.trimStart().startsWith('/'));
          },
          onFocus: () => {
            keyboardAvoidanceEnabled.value = 1;
            autoFollowStreamRef.current = true;
            keepLatestVisible(true, true);
          },
          onOpenAttachmentPicker: openAttachmentPicker,
          onPreviewAttachment: (attachment) => { void previewAttachment(attachment); },
          onRemoveAttachment: removeAttachment,
          onSelectSlashCommand: selectSlashCommand,
          onSend: requestSend,
          onShareAttachment: (attachment) => { void shareAttachment(attachment); },
          onTakePhoto: () => { void pickPhoto(true); },
          onCancelVoiceInput: () => { void cancelVoiceInput(); },
          onStartVoiceInput: () => { void startVoiceInput(); },
          onStopVoiceInput: () => { void stopVoiceInput(); },
          onToggleReadRepliesAloud: toggleReadRepliesAloud,
        },
        inputRef: composerInputRef,
        model: {
          attachments,
          canCancelHostedTurn,
          canSend,
          cancellingHostedTurn,
          collaborationState,
          content,
          filteredSlashCommands,
          hostedRunning,
          inputFontSize,
          isChinese,
          pendingPhase,
          readRepliesAloud,
          reconnectAttempt,
          sending,
          slashMenuOpen,
          voiceDurationMs,
          voiceError,
          voicePreview,
          voiceState,
        },
      }}
      headerProps={{
        collaborationState,
        compact,
        gatewayStatuses,
        isChinese,
        messages: displayMessages,
        onMentionMember: mentionMember,
        onOpenConversations: () => {
          keyboardAvoidanceEnabled.value = 0;
          composerInputRef.current?.blur();
          Keyboard.dismiss();
          if (showHistory) setHistoryCollapsed((current) => !current);
          else setHistoryModalOpen(true);
        },
        onOpenNavigation: openNavigationAfterKeyboard,
        safeAreaLeft,
        safeAreaRight,
        safeAreaTop,
        sending,
        showCollaborationHeaderCount,
      }}
      historyCollapsed={historyCollapsed}
      historyModalOpen={historyModalOpen}
      historyProps={{
        activeId: activeConversationId,
        conversations,
        isChinese,
        onCheckRelay: checkApiRelay,
        onNew: createConversation,
        onRefresh: refreshConversationHistory,
        onSelect: (id) => { void selectConversation(id); },
      }}
      isChinese={isChinese}
      keyboardRootStyle={keyboardRootStyle}
      modalHistoryProps={{
        activeId: activeConversationId,
        conversations,
        isChinese,
        onCheckRelay: checkApiRelay,
        onClose: () => setHistoryModalOpen(false),
        onNew: () => {
          void createConversation();
          setHistoryModalOpen(false);
        },
        onRefresh: refreshConversationHistory,
        onSelect: (id) => {
          void selectConversation(id);
          setHistoryModalOpen(false);
        },
      }}
      onCloseAttachments={() => setAttachmentsOpen(false)}
      onCloseHistory={() => setHistoryModalOpen(false)}
      onPickFile={() => { void pickFile(); }}
      onPickPhoto={(camera) => { void pickPhoto(camera); }}
      plan={chatPlan}
      safeAreaLeft={safeAreaLeft}
      safeAreaRight={safeAreaRight}
      showHistory={showHistory}
      streamProps={{
        collaborationStartIndex,
        collaborationState,
        compact,
        hostedRunning,
        isChinese,
        keepLatestVisible,
        messages: displayMessages,
        onBranch: branchFromMessage,
        onInspectActivity: pauseStreamAutoFollow,
        onJumpToLatest: () => {
          autoFollowStreamRef.current = true;
          keepLatestVisible(true, true);
        },
        onMentionMember: mentionMember,
        onOpenAttachment: openStoredAttachment,
        onScroll: handleStreamScroll,
        onToggleSpeech: toggleMessageSpeech,
        pendingPhase,
        pendingStartedAt,
        reconnectAttempt,
        safeAreaBottom,
        sending,
        showScrollToBottom,
        slashMenuOpen,
        speakingMessageId,
        streamRef,
      }}
      />
      <ConfirmDialog
        cancelLabel={isChinese ? '取消' : 'Cancel'}
        confirmLabel={isChinese ? '执行' : 'Run'}
        description={consoleConfirmation?.message}
        onCancel={() => consoleConfirmation?.onCancel()}
        onConfirm={() => consoleConfirmation?.onConfirm()}
        open={consoleConfirmation !== null}
        title={isChinese ? '确认执行命令' : 'Confirm command'}
      />
    </>
  );
}

// Component structure ported from OpenMinis AIChatView.inputBar at
// OpenMinis/OpenMinis@9cf3a855. See THIRD_PARTY_NOTICES.md (GPL-3.0).
