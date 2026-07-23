import * as DocumentPicker from 'expo-document-picker';
import { Directory as ExpoDirectory, File as ExpoFile, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { SymbolView } from 'expo-symbols';
import {
  Check,
  ChevronDown,
  File,
  Image as ImageIcon,
  Menu,
  X,
} from 'lucide-react-native';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActionSheetIOS,
  AppState,
  Image,
  Keyboard,
  Modal,
  Platform,
  PlatformColor,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
} from 'react-native';
import Reanimated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeInUp,
  FadeOut,
  LinearTransition,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useAnimatedKeyboard,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Markdown from 'react-native-markdown-display';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  HermesSwiftUIModelToolsView,
  hasNativeSwiftUIModelTools,
} from '../../modules/hermes-ios-controls';
import { HermesIOSContext } from '../../modules/hermes-ios-context';
import { HermesLiveBlurView } from '../../modules/hermes-live-blur';
import { presentQuickLook } from '../../modules/hermes-quick-look';
import { WEBUI_FONT_FAMILIES } from '../app/webui-fonts';
import { HermesApiError, type HermesApiClient } from '../api/HermesApiClient';
import { withAbortableDeadline } from '../api/async-deadline';
import { AsyncSingleFlight } from '../api/async-single-flight';
import {
  cleanupOwnedTemporaryAttachments,
  isUriInsideDirectory,
} from '../api/attachment-draft-lifecycle';
import {
  ATTACHMENT_ENCRYPTION_FORMAT,
  attachmentOutboxOwnerComponent,
  encryptedAttachmentUri,
  withAttachmentPersistenceRollback,
  withDecryptedAttachment,
} from '../api/attachment-outbox-crypto';
import {
  MAX_CONVERSATION_ATTACHMENT_BYTES,
  partitionAttachmentsBySize,
} from '../api/attachment-size-policy';
import type { SidebarGatewayStatus } from '../app/NativeShell';
import {
  HermesCloudApi,
  parseOfficialConversationPlaceholderId,
  type CollaborationMessage,
  type HostedTurnEnqueueInput,
  type HostedTurnEnqueueResponse,
  type SingleConversation,
} from '../api/HermesCloudApi';
import {
  ConversationLocalStore,
  type HostedTurnOutboxItem,
  type HostedTurnPendingAttachment,
  type OptimisticConversationLedgerItem,
  type OptimisticPendingTurn,
  isCompleteConversation,
  mergeDownloadedConversations,
  mergeOptimisticConversationLedgers,
  reconcileConversationCache,
  upsertCachedConversation,
} from '../api/conversation-local-store';
import {
  decideHostedTurnDeliveryFailure,
  HOSTED_TURN_RETRY_DELAY_MS,
  HostedTurnDeliveryClaimRegistry,
  hostedTurnDeliveryClaimKey,
  hostedTurnOutboxReady,
  hostedTurnResponseFailure,
  hostedTurnTransportFailure,
  type HostedTurnDeliveryFailure,
} from '../api/hosted-turn-delivery-state';
import { consumeHostedConversationEvents } from '../api/hosted-conversation-events';
import {
  activityCategoryLabel,
  activityDisplayContent,
  attachmentContext,
  conversationHasRunningWork,
  conversationHostedTurnState,
  conversationMessagesToView,
  conversationRunningHostedTurnId,
  formatActivitySummary,
  formatMessageLocalTime,
  hostedTurnVisibilityFailure,
  messageStatusLabel,
  messageIsRunning,
  messageHasExecutionTiming,
  reconcileOptimisticMessages,
  reconcileHostedTurnVisibilityFailures,
  shouldRenderPendingMessage,
  upsertChatMessage,
  type HermesChatActivity as ChatActivity,
  type HermesChatAttachment as StoredChatAttachment,
  type HermesChatViewMessage as ChatMessage,
  type HostedTurnVisibilityFailure,
} from '../api/chat-view-model';
import { NativeButton } from '../components/ui/NativeButton';
import { IOSContextMenu } from '../components/ios/IOSContextMenu';
import { IOSPressable } from '../components/ios/IOSPressable';
import { multiplyAlpha } from '../design/control-contracts';
import { resolveSwiftUIThemeProps } from '../design/swiftui-theme';
import { useTheme } from '../design/ThemeProvider';
import { IOS_MOTION } from '../design/ios-motion';
import type { HermesNotificationTarget } from '../notifications/notification-target';
import {
  PreviewBadge,
  PreviewModal,
  PreviewSegmented,
} from './PreviewPrimitives';
import { createInFlightActionGate } from './in-flight-action-gate';

const HERMES_AVATAR = require('../../assets/icon.png');
const BODY_REGULAR = 'HermesGoogle-IBMPlexSans-400-Normal';
const BODY_MEDIUM = 'HermesGoogle-IBMPlexSans-500-Normal';
const BODY_SEMIBOLD = 'HermesGoogle-IBMPlexSans-600-Normal';
const BODY_BOLD = 'HermesGoogle-IBMPlexSans-700-Normal';
const DISPLAY_BOLD = 'SpaceGrotesk_700Bold';
const MONO_REGULAR = 'HermesTerminal-JetBrainsMono-400-Normal';
const IOS_STANDARD_EASING = Easing.bezier(...IOS_MOTION.curve.standard);
const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);
const HOSTED_TURN_VISIBILITY_GRACE_MS = 20_000;
const RECONNECT_MAX_ATTEMPTS = 5;
const HOSTED_TURN_REQUEST_TIMEOUT_MS = 20_000;
const HOSTED_TURN_CANCEL_TIMEOUT_MS = 5_000;
const HOSTED_EVENT_RECONNECT_MS = 1_500;
const HOSTED_EVENT_POLL_FALLBACK_MS = 15_000;
const HOSTED_EVENT_POLL_DISCONNECTED_MS = 1_000;

type PendingPhase = 'thinking' | 'reconnecting' | 'executing';

interface ChatAttachment {
  id: string;
  kind: 'file' | 'image';
  mimeType?: string | null;
  name: string;
  ownedTemporary?: boolean;
  size?: number | null;
  uri: string;
}

interface HostedTurnDelivery {
  item: HostedTurnOutboxItem;
  response: HostedTurnEnqueueResponse;
}

interface PendingChatSend {
  conversationId: string;
  key: string;
  queuedItem?: HostedTurnOutboxItem;
  userMessage: ChatMessage;
}

class HostedTurnCancelledDuringDelivery extends Error {
  constructor() {
    super('Hosted turn delivery was cancelled');
    this.name = 'HostedTurnCancelledDuringDelivery';
  }
}

const cancelledPendingSendKeys = new Set<string>();
const hostedTurnDeliveryClaims = new HostedTurnDeliveryClaimRegistry();

interface ChatPreviewPageProps {
  cacheOwner?: string;
  client?: HermesApiClient;
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
  const cloudApi = useMemo(() => client ? new HermesCloudApi(client) : null, [client]);
  const localStore = useMemo(
    () => cacheOwner ? new ConversationLocalStore() : null,
    [cacheOwner],
  );
  const [content, setContent] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<SingleConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [activeHostedTurnId, setActiveHostedTurnId] = useState('');
  const [hostedRunning, setHostedRunning] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingPhase, setPendingPhase] = useState<PendingPhase>('thinking');
  const [pendingPhaseStartedAt, setPendingPhaseStartedAt] = useState(Date.now());
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [cancellingHostedTurn, setCancellingHostedTurn] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const streamRef = useRef<ScrollView>(null);
  const composerInputRef = useRef<TextInput>(null);
  const contentRef = useRef('');
  const activeConversationIdRef = useRef('');
  const activeHostedTurnIdRef = useRef('');
  const optimisticHostedTurnIdRef = useRef('');
  const optimisticHostedTurnConfirmedRef = useRef(false);
  const optimisticHostedTurnDeadlineRef = useRef(0);
  const optimisticHostedTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostedTurnVisibilityFailuresRef = useRef(
    new Map<string, HostedTurnVisibilityFailure[]>(),
  );
  const cancelHostedTurnInFlightRef = useRef(false);
  const conversationIndexRef = useRef<SingleConversation[]>([]);
  const hostedEventCursorRef = useRef(new Map<string, number>());
  const conversationSyncGenerationRef = useRef(0);
  const conversationIndexRefreshGateRef = useRef(new AsyncSingleFlight());
  const hydratedCacheOwnerRef = useRef('');
  const cacheWriteRef = useRef<Promise<void>>(Promise.resolve());
  const pendingAttachmentCleanup = useRef<(() => void) | null>(null);
  const pendingNavigationCleanup = useRef<(() => void) | null>(null);
  const pendingScrollFrame = useRef<number | null>(null);
  const autoFollowStreamRef = useRef(true);
  const outboxReplayRef = useRef<Promise<void> | null>(null);
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const attachmentOwnerRef = useRef(cacheOwner);
  const sendSubmissionGateRef = useRef(createInFlightActionGate());
  const pendingPhaseRef = useRef<PendingPhase>('thinking');
  const pendingPhaseStartedAtRef = useRef(Date.now());
  const firstTokenAtRef = useRef(0);
  const pendingTurnActiveRef = useRef(false);
  const sendOperationGenerationRef = useRef(0);
  const pendingChatSendRef = useRef<PendingChatSend | null>(null);
  const mountedRef = useRef(true);
  const optimisticMessagesRef = useRef<ChatMessage[]>([]);
  const optimisticMessagesByConversationRef = useRef(new Map<string, ChatMessage[]>());
  const optimisticPendingByConversationRef = useRef(new Map<string, OptimisticPendingTurn>());
  const keyboard = useAnimatedKeyboard();
  const keyboardAvoidanceEnabled = useSharedValue(1);
  const isChinese = locale === 'zh';
  const compact = width <= 560;
  const shellSplit = width >= 768;
  const showHistory = width > 900;
  const safeAreaBottom = insets.bottom;
  const safeAreaLeft = shellSplit ? 0 : insets.left;
  const safeAreaRight = shellSplit ? 0 : insets.right;
  const safeAreaTop = shellSplit ? 0 : insets.top;
  const attachmentCount = attachments.length;
  const canSend = !sending && Boolean(content.trim() || attachmentCount > 0);
  const canCancelHostedTurn = hostedRunning || sending;
  const pendingStartedAt = pendingPhaseStartedAt;
  const displayMessages = messages;
  const inputFontSize = resolveComposerFontSize(content);
  const updateAttachments = useCallback((
    update: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[]),
  ) => {
    setAttachments((current) => {
      const next = typeof update === 'function' ? update(current) : update;
      attachmentsRef.current = next;
      return next;
    });
  }, []);
  const cleanupAttachmentSources = useCallback((
    items: readonly ChatAttachment[] | readonly HostedTurnPendingAttachment[],
  ) => {
    cleanupOwnedTemporaryAttachments(items.flatMap((item) => {
      const uri = 'sourceUri' in item ? item.sourceUri?.trim() : item.uri;
      return uri ? [{ ownedTemporary: item.ownedTemporary, uri }] : [];
    }), Paths.cache.uri, (uri) => {
      const file = new ExpoFile(uri);
      if (file.exists) file.delete();
    });
  }, []);
  const keepLatestVisible = useCallback((animated = false, force = false) => {
    if (!force && !autoFollowStreamRef.current) return;
    if (pendingScrollFrame.current !== null) return;
    pendingScrollFrame.current = requestAnimationFrame(() => {
      pendingScrollFrame.current = null;
      streamRef.current?.scrollToEnd({ animated });
    });
  }, []);
  const pauseStreamAutoFollow = useCallback(() => {
    autoFollowStreamRef.current = false;
    if (pendingScrollFrame.current !== null) {
      cancelAnimationFrame(pendingScrollFrame.current);
      pendingScrollFrame.current = null;
    }
  }, []);
  const handleStreamScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    autoFollowStreamRef.current = (
      contentSize.height - (contentOffset.y + layoutMeasurement.height)
    ) <= 72;
  }, []);
  const keyboardRootStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboard.height.value * keyboardAvoidanceEnabled.value,
  }));
  const composerKeyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(
      keyboard.height.value * keyboardAvoidanceEnabled.value,
      [0, Math.max(1, safeAreaBottom)],
      [7 + safeAreaBottom, 3],
      Extrapolation.CLAMP,
    ),
  }));

  const replaceOptimisticMessages = useCallback((
    conversationId: string,
    nextMessages: readonly ChatMessage[],
    pendingTurn?: OptimisticPendingTurn | null,
  ): Promise<void> => {
    if (!conversationId) return Promise.resolve();
    const previous = optimisticMessagesByConversationRef.current.get(conversationId) || [];
    const next = nextMessages.map((message) => ({ ...message }));
    if (next.length) {
      optimisticMessagesByConversationRef.current.set(conversationId, next);
    } else {
      optimisticMessagesByConversationRef.current.delete(conversationId);
    }
    if (activeConversationIdRef.current === conversationId) {
      optimisticMessagesRef.current = next;
    }
    if (pendingTurn !== undefined) {
      if (pendingTurn) {
        optimisticPendingByConversationRef.current.set(conversationId, pendingTurn);
      } else {
        optimisticPendingByConversationRef.current.delete(conversationId);
      }
    }
    if (!localStore || !cacheOwner) return Promise.resolve();
    return localStore.replaceOptimisticMessages(
      cacheOwner,
      conversationId,
      next.map(chatMessageToCollaborationMessage),
      pendingTurn,
      previous.map(({ id }) => id),
    ).then(async (committed) => {
      if (committed) return;
      // Another mounted page or a background retry worker published a newer
      // terminal state. Restore that durable state instead of leaving this
      // component's stale optimistic snapshot in memory.
      const durableLedgers = await localStore.readOptimisticConversations(cacheOwner);
      const durable = durableLedgers.find(
        ({ conversationId: currentId }) => currentId === conversationId,
      );
      if (!durable) {
        optimisticMessagesByConversationRef.current.delete(conversationId);
        optimisticPendingByConversationRef.current.delete(conversationId);
        if (activeConversationIdRef.current === conversationId) {
          optimisticMessagesRef.current = [];
        }
        return;
      }
      const durableMessages = conversationMessagesToView({
        id: durable.conversationId,
        messages: durable.messages,
        profile,
        title: optimisticConversationTitle(durable.messages, isChinese),
      }, isChinese);
      optimisticMessagesByConversationRef.current.set(conversationId, durableMessages);
      if (durable.pendingTurn) {
        optimisticPendingByConversationRef.current.set(conversationId, durable.pendingTurn);
      } else {
        optimisticPendingByConversationRef.current.delete(conversationId);
      }
      if (activeConversationIdRef.current === conversationId) {
        optimisticMessagesRef.current = durableMessages;
        setMessages((current) => durableMessages.reduce(upsertChatMessage, current));
      }
    });
  }, [cacheOwner, isChinese, localStore, profile]);

  const clearOptimisticPendingTurn = useCallback((conversationId: string): Promise<void> => {
    if (!conversationId) return Promise.resolve();
    optimisticPendingByConversationRef.current.delete(conversationId);
    return replaceOptimisticMessages(
      conversationId,
      optimisticMessagesByConversationRef.current.get(conversationId) || [],
      null,
    );
  }, [replaceOptimisticMessages]);

  const clearOptimisticHostedTurn = useCallback(() => {
    optimisticHostedTurnIdRef.current = '';
    optimisticHostedTurnConfirmedRef.current = false;
    optimisticHostedTurnDeadlineRef.current = 0;
    if (optimisticHostedTurnTimeoutRef.current) {
      clearTimeout(optimisticHostedTurnTimeoutRef.current);
      optimisticHostedTurnTimeoutRef.current = null;
    }
  }, []);

  const beginOptimisticHostedTurn = useCallback((conversationId: string, turnId: string) => {
    clearOptimisticHostedTurn();
    optimisticHostedTurnIdRef.current = turnId;
    optimisticHostedTurnConfirmedRef.current = false;
    optimisticHostedTurnDeadlineRef.current = Date.now() + HOSTED_TURN_VISIBILITY_GRACE_MS;
    optimisticHostedTurnTimeoutRef.current = setTimeout(() => {
      optimisticHostedTurnTimeoutRef.current = null;
      if (
        optimisticHostedTurnIdRef.current !== turnId
        || activeConversationIdRef.current !== conversationId
      ) return;
      optimisticHostedTurnIdRef.current = '';
      optimisticHostedTurnDeadlineRef.current = 0;
      const failure = hostedTurnVisibilityFailure(turnId, isChinese);
      hostedTurnVisibilityFailuresRef.current.set(
        conversationId,
        [
          ...(hostedTurnVisibilityFailuresRef.current.get(conversationId) || [])
            .filter((current) => current.turnId !== turnId),
          failure,
        ],
      );
      activeHostedTurnIdRef.current = '';
      setActiveHostedTurnId('');
      const nextMessages = upsertChatMessage(
        optimisticMessagesByConversationRef.current.get(conversationId) || [],
        failure.message,
      );
      void replaceOptimisticMessages(conversationId, nextMessages);
      void clearOptimisticPendingTurn(conversationId);
      setMessages((current) => upsertChatMessage(current, failure.message));
      setHostedRunning(false);
      setSending(false);
    }, HOSTED_TURN_VISIBILITY_GRACE_MS);
  }, [
    clearOptimisticHostedTurn,
    clearOptimisticPendingTurn,
    isChinese,
    replaceOptimisticMessages,
  ]);

  const updatePendingPhase = useCallback((phase: PendingPhase, startedAt = Date.now()) => {
    pendingPhaseRef.current = phase;
    pendingPhaseStartedAtRef.current = startedAt;
    setPendingPhase(phase);
    setPendingPhaseStartedAt(startedAt);
  }, []);

  const resetPendingStateMachine = useCallback(() => {
    pendingTurnActiveRef.current = false;
    firstTokenAtRef.current = 0;
    setReconnectAttempt(0);
    updatePendingPhase('thinking');
  }, [updatePendingPhase]);

  const finalizePendingSend = useCallback(async (
    pending: PendingChatSend,
    content: string,
    status: 'cancelled' | 'failed',
    idPrefix: string,
    roleLabel: string,
    terminalOutbox?: HostedTurnOutboxItem,
  ): Promise<boolean> => {
    const completedAt = Date.now();
    const terminalMessage: ChatMessage = {
      avatarRole: 'hermes',
      completedAt,
      content,
      createdAt: completedAt,
      durationMs: 0,
      id: `${idPrefix}-${pending.userMessage.id}`,
      name: 'Hermes Agent',
      role: 'assistant',
      roleLabel,
      roleStage: 'chat',
      runtimeTurnId: pending.queuedItem?.input.turnId,
      status,
      updatedAt: completedAt,
    };
    const current = optimisticMessagesByConversationRef.current.get(pending.conversationId) || [];
    const finalMessages = upsertChatMessage(
      upsertChatMessage(current, pending.userMessage),
      terminalMessage,
    );
    if (localStore && cacheOwner) {
      const terminalMessages = [pending.userMessage, terminalMessage]
        .map(chatMessageToCollaborationMessage);
      if (status === 'cancelled') {
        const cancelled = await localStore.cancelPendingEnqueueAndFinalize(
          cacheOwner,
          pending.userMessage.id,
          pending.queuedItem,
          terminalMessages,
        );
        if (!cancelled?.cancelledAt) return false;
        pending.queuedItem = cancelled;
      } else if (terminalOutbox) {
        const transition = terminalOutbox.deliveryTerminalAt
          ? await localStore.transitionPendingEnqueueTerminal(
              cacheOwner,
              terminalOutbox,
              terminalMessages,
            )
          : await localStore.transitionPendingEnqueueForegroundFailure(
              cacheOwner,
              terminalOutbox,
              terminalMessages,
            );
        if (!transition.updated) return false;
      } else {
        await localStore.finalizeOptimisticTurn(
          cacheOwner,
          pending.conversationId,
          terminalMessages,
        );
      }
    } else {
      await replaceOptimisticMessages(pending.conversationId, finalMessages, null);
    }
    optimisticMessagesByConversationRef.current.set(pending.conversationId, finalMessages);
    optimisticPendingByConversationRef.current.delete(pending.conversationId);
    if (mountedRef.current && activeConversationIdRef.current === pending.conversationId) {
      optimisticMessagesRef.current = finalMessages;
      setMessages((messages) => upsertChatMessage(
        upsertChatMessage(messages, pending.userMessage),
        terminalMessage,
      ));
      resetPendingStateMachine();
      setHostedRunning(false);
      setSending(false);
    }
    if (pendingChatSendRef.current?.key === pending.key) {
      pendingChatSendRef.current = null;
    }
    return true;
  }, [cacheOwner, localStore, replaceOptimisticMessages, resetPendingStateMachine]);

  const handleOutboxFailure = useCallback(async (
    source: HostedTurnOutboxItem,
    failure: HostedTurnDeliveryFailure,
  ): Promise<'retry' | 'retry-background' | 'terminal'> => {
    if (!localStore || !cacheOwner) return 'terminal';
    const decision = decideHostedTurnDeliveryFailure(source, failure);
    const pending = pendingChatSendFromOutbox(decision.item, cacheOwner);
    if (decision.terminal) {
      const terminalItem = {
        ...decision.item,
        deliveryTerminalAt: Date.now(),
      };
      const finalized = await finalizePendingSend(
        pending,
        decision.failure.message,
        'failed',
        'send-failed',
        isChinese ? '模型连接错误' : 'Model connection error',
        terminalItem,
      );
      if (!finalized) return 'terminal';
      try {
        cleanupPendingAttachments(terminalItem);
        await localStore.removePendingEnqueueIfActive(
          cacheOwner,
          source.input.requestId,
        );
      } catch {
        // Keep the terminal row as a cleanup intent. It must never be replayed
        // as another model request.
      }
      return 'terminal';
    }
    const foregroundFailed = failure.certainty === 'uncertain'
      && (decision.item.attempts || 0) >= RECONNECT_MAX_ATTEMPTS;
    const retryItem = {
      ...decision.item,
      ...(foregroundFailed && !decision.item.foregroundFailedAt
        ? { foregroundFailedAt: Date.now() }
        : {}),
    };
    if (foregroundFailed) {
      const finalized = await finalizePendingSend(
        pendingChatSendFromOutbox(retryItem, cacheOwner),
        decision.failure.message,
        'failed',
        'send-failed',
        isChinese ? '连接错误' : 'Connection error',
        retryItem,
      );
      if (!finalized) return 'terminal';
      return 'retry-background';
    }
    const reconnecting: OptimisticPendingTurn = {
      attempt: retryItem.attempts || 1,
      lastError: decision.failure.message,
      phase: 'reconnecting',
      phaseStartedAt: Date.now(),
      updatedAt: Date.now(),
      userMessageId: retryItem.input.message.id,
    };
    const transition = await localStore.transitionPendingEnqueueRetry(
      cacheOwner,
      retryItem,
      reconnecting,
    );
    if (!transition.updated || !transition.item) return 'terminal';
    const claimKey = hostedTurnDeliveryClaimKey(cacheOwner, source.input.requestId);
    if (cancelledPendingSendKeys.has(claimKey)) return 'terminal';
    optimisticPendingByConversationRef.current.set(transition.item.conversationId, reconnecting);
    if (mountedRef.current && activeConversationIdRef.current === transition.item.conversationId) {
      pendingTurnActiveRef.current = true;
      setReconnectAttempt(reconnecting.attempt);
      updatePendingPhase('reconnecting', reconnecting.phaseStartedAt);
      setHostedRunning(false);
      setSending(true);
    }
    return 'retry';
  }, [cacheOwner, finalizePendingSend, isChinese, localStore, updatePendingPhase]);

  const deliverPendingCancellation = useCallback(async (
    item: HostedTurnOutboxItem,
  ): Promise<boolean> => {
    if (!localStore || !cacheOwner || !cloudApi || !item.cancelledAt) return false;
    try {
      await withAbortableDeadline(
        (signal) => cloudApi.cancelHostedTurn(
          item.conversationId,
          item.input.turnId,
          'Cancelled before hosted-turn delivery completed',
          signal,
        ),
        HOSTED_TURN_CANCEL_TIMEOUT_MS,
        'Hermes hosted-turn cancellation timed out',
      );
      cleanupPendingAttachments(item);
      await localStore.removePendingEnqueue(cacheOwner, item.input.requestId);
      return true;
    } catch (error) {
      await localStore.upsertPendingEnqueue(cacheOwner, {
        ...item,
        cancelledAt: item.cancelledAt || Date.now(),
        lastError: serverFailure(error, isChinese),
        nextAttemptAt: Date.now() + HOSTED_TURN_RETRY_DELAY_MS,
      }).catch(() => undefined);
      return false;
    }
  }, [cacheOwner, cloudApi, isChinese, localStore]);

  const cancelPendingSend = useCallback(async (): Promise<boolean> => {
    const conversationId = activeConversationIdRef.current;
    const persistedPending = optimisticPendingByConversationRef.current.get(conversationId);
    const userMessageId = pendingChatSendRef.current?.userMessage.id
      || persistedPending?.userMessageId
      || '';
    const userMessage = pendingChatSendRef.current?.userMessage
      || (optimisticMessagesByConversationRef.current.get(conversationId) || [])
        .find(({ id, role }) => id === userMessageId && role === 'user');
    if (!conversationId || !userMessageId || !userMessage) return false;
    const key = pendingChatSendRef.current?.key
      || hostedTurnDeliveryClaimKey(cacheOwner, userMessageId);
    cancelledPendingSendKeys.add(key);
    let queuedItem = pendingChatSendRef.current?.queuedItem;
    const pending = { conversationId, key, queuedItem, userMessage };
    const finalized = await finalizePendingSend(
      pending,
      isChinese ? '任务已取消。' : 'Task cancelled.',
      'cancelled',
      'cancelled',
      isChinese ? '已取消' : 'Cancelled',
    );
    if (!finalized) {
      cancelledPendingSendKeys.delete(key);
      return false;
    }
    queuedItem = pending.queuedItem;
    sendOperationGenerationRef.current += 1;
    resetPendingStateMachine();
    if (mountedRef.current && activeConversationIdRef.current === conversationId) {
      setSending(false);
      setHostedRunning(false);
    }
    if (queuedItem?.cancelledAt) void deliverPendingCancellation(queuedItem);
    return true;
  }, [
    cacheOwner,
    deliverPendingCancellation,
    finalizePendingSend,
    isChinese,
    localStore,
    resetPendingStateMachine,
  ]);

  useAnimatedReaction(
    () => keyboard.height.value * keyboardAvoidanceEnabled.value,
    (height, previousHeight) => {
      if (
        previousHeight === null
        || Math.abs(height - previousHeight) >= 0.5
      ) {
        runOnJS(keepLatestVisible)(false);
      }
    },
    [keepLatestVisible],
  );

  const persistConversationCache = useCallback((
    conversations: readonly SingleConversation[],
    activeId: string,
  ) => {
    if (!localStore || !cacheOwner) return;
    cacheWriteRef.current = cacheWriteRef.current
      .catch(() => undefined)
      .then(() => localStore.write(cacheOwner, conversations, activeId));
  }, [cacheOwner, localStore]);

  const commitConversationIndex = useCallback((
    conversations: readonly SingleConversation[],
    activeId = activeConversationIdRef.current,
  ) => {
    const next = [...conversations];
    conversationIndexRef.current = next;
    setConversations(next);
    persistConversationCache(next, activeId);
  }, [persistConversationCache]);

  const applyConversation = useCallback((incomingConversation: SingleConversation) => {
    const incomingCursor = Math.max(0, Number(incomingConversation.event_cursor) || 0);
    const currentCursor = hostedEventCursorRef.current.get(incomingConversation.id) || 0;
    if (incomingCursor < currentCursor) return;
    hostedEventCursorRef.current.set(
      incomingConversation.id,
      Math.max(currentCursor, incomingCursor),
    );
    const conversation = upsertCachedConversation(
      conversationIndexRef.current,
      incomingConversation,
    ).find(({ id }) => id === incomingConversation.id) || incomingConversation;
    activeConversationIdRef.current = conversation.id;
    setActiveConversationId(conversation.id);
    const persistedPendingTurn = optimisticPendingByConversationRef.current.get(conversation.id);
    const persistedTurnState = persistedPendingTurn?.turnId
      ? conversationHostedTurnState(conversation, persistedPendingTurn.turnId)
      : 'missing';
    const activePersistedPendingTurn = persistedTurnState === 'terminal'
      ? undefined
      : persistedPendingTurn;
    if (persistedTurnState === 'terminal') {
      optimisticPendingByConversationRef.current.delete(conversation.id);
      void clearOptimisticPendingTurn(conversation.id);
    }
    if (activePersistedPendingTurn) {
      pendingTurnActiveRef.current = true;
      setReconnectAttempt(activePersistedPendingTurn.attempt);
      updatePendingPhase(
        activePersistedPendingTurn.phase,
        activePersistedPendingTurn.phaseStartedAt,
      );
    } else {
      pendingTurnActiveRef.current = false;
    }
    let nextMessages = conversationMessagesToView(conversation, isChinese);
    let running = conversationHasRunningWork(conversation);
    let runningHostedTurnId = conversationRunningHostedTurnId(conversation);
    const optimisticTurnId = optimisticHostedTurnIdRef.current;
    if (optimisticTurnId) {
      const optimisticState = conversationHostedTurnState(conversation, optimisticTurnId);
      if (optimisticState === 'terminal') {
        clearOptimisticHostedTurn();
      } else if (optimisticState === 'running') {
        optimisticHostedTurnConfirmedRef.current = true;
        optimisticHostedTurnDeadlineRef.current = 0;
        if (optimisticHostedTurnTimeoutRef.current) {
          clearTimeout(optimisticHostedTurnTimeoutRef.current);
          optimisticHostedTurnTimeoutRef.current = null;
        }
        running = true;
        runningHostedTurnId ||= optimisticTurnId;
      } else if (optimisticHostedTurnConfirmedRef.current) {
        // A later poll can hit an older replica after the turn was already
        // observed running. Never regress the UI back to idle/missing.
        running = true;
        runningHostedTurnId ||= optimisticTurnId;
      } else if (Date.now() <= optimisticHostedTurnDeadlineRef.current) {
        running = true;
        runningHostedTurnId ||= optimisticTurnId;
      } else {
        clearOptimisticHostedTurn();
        const failure = hostedTurnVisibilityFailure(optimisticTurnId, isChinese);
        hostedTurnVisibilityFailuresRef.current.set(
          conversation.id,
          [
            ...(hostedTurnVisibilityFailuresRef.current.get(conversation.id) || [])
              .filter(({ turnId }) => turnId !== optimisticTurnId),
            failure,
          ],
        );
      }
    }
    const visibilityFailures = reconcileHostedTurnVisibilityFailures(
      conversation,
      nextMessages,
      hostedTurnVisibilityFailuresRef.current.get(conversation.id) || [],
    );
    nextMessages = visibilityFailures.messages;
    if (visibilityFailures.failures.length) {
      hostedTurnVisibilityFailuresRef.current.set(
        conversation.id,
        visibilityFailures.failures,
      );
    } else {
      hostedTurnVisibilityFailuresRef.current.delete(conversation.id);
    }
    const trackedTurnId = activeHostedTurnIdRef.current
      || activePersistedPendingTurn?.turnId
      || runningHostedTurnId;
    if (trackedTurnId && pendingTurnActiveRef.current) {
      const trackedTurnState = conversationHostedTurnState(conversation, trackedTurnId);
      const trackedMessages = nextMessages.filter(
        (message) => message.runtimeTurnId === trackedTurnId,
      );
      if (trackedTurnState === 'terminal') {
        pendingTurnActiveRef.current = false;
        void clearOptimisticPendingTurn(conversation.id);
        const tokenStartedAt = firstTokenAtRef.current;
        if (tokenStartedAt > 0) {
          nextMessages = nextMessages.map((message) => {
            if (
              message.runtimeTurnId !== trackedTurnId
              || message.role !== 'assistant'
              || !['completed', 'failed'].includes(message.status || '')
            ) return message;
            const completedAt = message.completedAt || message.updatedAt || Date.now();
            return {
              ...message,
              durationMs: Math.max(0, completedAt - tokenStartedAt),
              startedAt: tokenStartedAt,
            };
          });
        }
      } else if (pendingPhaseRef.current !== 'executing') {
        const latestRuntimeStatus = trackedMessages
          .flatMap((message) => message.activities || [])
          .filter((activity) => {
            const text = `${activity.output || ''} ${activity.preview || ''}`;
            return activity.name === '运行状态'
              || activity.name === 'Runtime status'
              || /(?:正在重连|reconnecting)\s*[（(]\d+\s*\/\s*5[）)]/i.test(text);
          })
          .sort((left, right) => (right.startedAt || 0) - (left.startedAt || 0))[0];
        const runtimeStatus = latestRuntimeStatus?.output || latestRuntimeStatus?.preview || '';
        const reconnectMatch = runtimeStatus.match(/(?:正在重连|reconnecting)\s*[（(](\d+)\s*\/\s*5[）)]/i);
        if (reconnectMatch) {
          const attempt = Number(reconnectMatch[1]);
          if (pendingPhaseRef.current !== 'reconnecting' || reconnectAttempt !== attempt) {
            setReconnectAttempt(attempt);
            updatePendingPhase('reconnecting', latestRuntimeStatus?.startedAt || Date.now());
          }
        } else if (/正在思考|thinking/i.test(runtimeStatus) && pendingPhaseRef.current !== 'thinking') {
          updatePendingPhase('thinking', latestRuntimeStatus?.startedAt || Date.now());
        }
        const hasAssistantContent = trackedMessages.some(
          (message) => message.role === 'assistant'
            && Boolean(message.content)
            && message.status !== 'failed',
        );
        const persistedFirstTokenAt = trackedMessages.reduce((earliest, message) => {
          const candidate = message.firstTokenAt || 0;
          if (candidate <= 0) return earliest;
          return earliest <= 0 ? candidate : Math.min(earliest, candidate);
        }, 0);
        if (persistedFirstTokenAt > 0 || hasAssistantContent) {
          const firstTokenAt = firstTokenAtRef.current || persistedFirstTokenAt || Date.now();
          firstTokenAtRef.current = firstTokenAt;
          updatePendingPhase('executing', firstTokenAt);
        }
      }
    }
    const currentOptimistic = optimisticMessagesByConversationRef.current.get(
      conversation.id,
    ) || [];
    const reconciledOptimistic = reconcileOptimisticMessages(
      nextMessages,
      currentOptimistic,
      Date.now(),
      activePersistedPendingTurn
        ? new Set([activePersistedPendingTurn.userMessageId])
        : new Set(),
    );
    if (!sameOptimisticMessages(currentOptimistic, reconciledOptimistic.pending)) {
      void replaceOptimisticMessages(conversation.id, reconciledOptimistic.pending);
    } else {
      optimisticMessagesRef.current = reconciledOptimistic.pending;
    }
    nextMessages = reconciledOptimistic.messages;
    setMessages(nextMessages);
    activeHostedTurnIdRef.current = runningHostedTurnId;
    setActiveHostedTurnId(runningHostedTurnId);
    setHostedRunning(running);
    // A stale conversation snapshot can arrive while the client is still
    // validating/reconnecting the model. It has no hosted turn yet, so it
    // must not collapse the pending bubble or re-enable the composer.
    setSending(running || pendingTurnActiveRef.current);
    commitConversationIndex(
      upsertCachedConversation(conversationIndexRef.current, conversation),
      conversation.id,
    );
  }, [
    clearOptimisticHostedTurn,
    clearOptimisticPendingTurn,
    commitConversationIndex,
    isChinese,
    reconnectAttempt,
    replaceOptimisticMessages,
    updatePendingPhase,
  ]);

  const loadConversation = useCallback(async (
    conversationId: string,
    expectedGeneration = 0,
    signal?: AbortSignal,
  ) => {
    if (!cloudApi || !conversationId) return null;
    const result = await cloudApi.getConversation(conversationId, signal);
    if (
      expectedGeneration
      && expectedGeneration !== conversationSyncGenerationRef.current
    ) {
      return result.conversation;
    }
    if (activeConversationIdRef.current && activeConversationIdRef.current !== conversationId) {
      return result.conversation;
    }
    applyConversation(result.conversation);
    return result.conversation;
  }, [applyConversation, cloudApi]);

  const deliverPendingEnqueueOnce = useCallback(async (
    source: HostedTurnOutboxItem,
  ): Promise<HostedTurnDelivery> => {
    if (!cloudApi || !localStore || !cacheOwner) {
      throw new Error('Durable outbox is unavailable');
    }
    let item = hydrateOutboxInput(source);
    if (item.cancelledAt) throw new HostedTurnCancelledDuringDelivery();
    if (item.deliveryAcceptedAt) {
      throw new Error('Hosted turn was already accepted');
    }
    const persistIfActive = async (next: HostedTurnOutboxItem) => {
      const mutation = await localStore.upsertPendingEnqueueIfActive(cacheOwner, next);
      if (!mutation.updated || !mutation.item) {
        throw new HostedTurnCancelledDuringDelivery();
      }
      return mutation.item;
    };
    if (item.pendingAttachments?.length) {
      const materialized = await persistPendingAttachments(
        cacheOwner,
        item.input.requestId,
        item.pendingAttachments,
      );
      item = await persistIfActive({ ...item, pendingAttachments: materialized });
    }
    if (!item.conversationId) {
      item = {
        ...item,
        conversationId: `chat_${safeOutboxPathComponent(item.input.requestId).slice(0, 251)}`,
        conversationPending: true,
      };
      item = await persistIfActive(item);
    }
    if (item.conversationPending) {
      await withAbortableDeadline(
        (signal) => cloudApi.createConversation(
          item.conversationProfile || profile,
          item.conversationTitle || (isChinese ? '新对话' : 'New conversation'),
          item.conversationId,
          signal,
        ),
        HOSTED_TURN_REQUEST_TIMEOUT_MS,
        'Hermes conversation creation timed out',
      );
      item = { ...item, conversationPending: false };
      item = await persistIfActive(item);
    }
    const pendingAttachments = [...(item.pendingAttachments || [])];
    for (let index = 0; index < pendingAttachments.length; index += 1) {
      const attachment = pendingAttachments[index];
      if (attachment.uploaded) continue;
      const result = await withAbortableDeadline(
        (signal) => withDecryptedAttachment(
          HermesIOSContext,
          cacheOwner,
          attachment.uri,
          attachment.name,
          (plaintextUri) => cloudApi.uploadConversationAttachment(
            item.conversationId,
            {
              mimeType: attachment.mimeType,
              name: attachment.name,
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
        ),
        HOSTED_TURN_REQUEST_TIMEOUT_MS,
        'Hermes attachment upload timed out',
      );
      if (!isRecord(result.attachment)) {
        throw new Error('Attachment upload was not persisted');
      }
      pendingAttachments[index] = {
        ...attachment,
        uploaded: result.attachment,
      };
      item = hydrateOutboxInput({ ...item, pendingAttachments });
      item = await persistIfActive(item);
    }
    item = hydrateOutboxInput({ ...item, pendingAttachments });
    item = await persistIfActive(item);
    const response = await withAbortableDeadline(
      (signal) => cloudApi.enqueueHostedTurn(item.conversationId, item.input, signal),
      HOSTED_TURN_REQUEST_TIMEOUT_MS,
      'Hermes hosted-turn enqueue timed out',
    );
    return { item, response };
  }, [cacheOwner, cloudApi, isChinese, localStore, profile]);

  const deliverPendingEnqueue = useCallback(async (
    source: HostedTurnOutboxItem,
  ): Promise<HostedTurnDelivery> => {
    try {
      return await deliverPendingEnqueueOnce(source);
    } catch (error) {
      // A conversation may be deleted on another device between the index
      // read and enqueue.  Re-home this same idempotent request once rather
      // than surfacing a permanent 404 or sending the user message twice.
      if (
        !isConversationNotFoundError(error)
        || source.conversationPending
        || !source.input.requestId
      ) {
        throw error;
      }
      const replacementId = `chat_${safeOutboxPathComponent(source.input.requestId).slice(0, 251)}`;
      if (replacementId === source.conversationId) throw error;
      const replacement: HostedTurnOutboxItem = {
        ...source,
        conversationId: replacementId,
        conversationPending: true,
        pendingAttachments: source.pendingAttachments?.map(({ uploaded: _uploaded, ...attachment }) => attachment),
      };
      if (localStore && cacheOwner) {
        const mutation = await localStore.upsertPendingEnqueueIfActive(cacheOwner, replacement);
        if (!mutation.updated || !mutation.item) {
          throw new HostedTurnCancelledDuringDelivery();
        }
      }
      return deliverPendingEnqueueOnce(replacement);
    }
  }, [cacheOwner, deliverPendingEnqueueOnce, localStore]);

  const acceptPendingOutboxItem = useCallback(async (
    item: HostedTurnOutboxItem,
  ) => {
    if (!localStore || !cacheOwner) return { item: null, updated: false };
    const acceptedAt = item.deliveryAcceptedAt || Date.now();
    const pendingTurn: OptimisticPendingTurn = {
      attempt: 0,
      phase: 'thinking',
      phaseStartedAt: acceptedAt,
      turnId: item.input.turnId,
      updatedAt: acceptedAt,
      userMessageId: item.input.message.id,
    };
    const transition = await localStore.acceptPendingEnqueueIfActive(
      cacheOwner,
      { ...item, deliveryAcceptedAt: acceptedAt },
      pendingTurn,
    );
    if (!transition.updated || !transition.item) return transition;
    const failureIds = new Set([
      `send-failed-${item.input.message.id}`,
      `connection-unavailable-${item.input.message.id}`,
    ]);
    const optimistic = (optimisticMessagesByConversationRef.current.get(item.conversationId) || [])
      .filter(({ id }) => !failureIds.has(id));
    optimisticMessagesByConversationRef.current.set(item.conversationId, optimistic);
    optimisticPendingByConversationRef.current.set(item.conversationId, pendingTurn);
    if (mountedRef.current && activeConversationIdRef.current === item.conversationId) {
      optimisticMessagesRef.current = optimistic;
      setMessages((current) => current.filter(({ id }) => !failureIds.has(id)));
      pendingTurnActiveRef.current = true;
      updatePendingPhase('thinking', acceptedAt);
      setReconnectAttempt(0);
    }
    return transition;
  }, [cacheOwner, localStore, updatePendingPhase]);

  const settleAcceptedOutboxItem = useCallback(async (
    item: HostedTurnOutboxItem,
  ): Promise<'cancelled' | 'cleanup-pending' | 'settled'> => {
    if (!localStore || !cacheOwner) return 'cleanup-pending';
    try {
      cleanupPendingAttachments(item);
    } catch (error) {
      await localStore.upsertPendingEnqueueIfActive(cacheOwner, {
        ...item,
        lastError: serverFailure(error, isChinese),
        nextAttemptAt: Date.now() + HOSTED_TURN_RETRY_DELAY_MS,
      });
      return 'cleanup-pending';
    }
    if (await localStore.removePendingEnqueueIfActive(cacheOwner, item.input.requestId)) {
      return 'settled';
    }
    const cancelled = (await localStore.readPendingEnqueues(cacheOwner)).find(
      ({ input }) => input.requestId === item.input.requestId,
    );
    if (cancelled?.cancelledAt) {
      void deliverPendingCancellation(cancelled);
      return 'cancelled';
    }
    return 'settled';
  }, [cacheOwner, deliverPendingCancellation, isChinese, localStore]);

  const replayPendingEnqueues = useCallback(async () => {
    if (!cloudApi || !localStore || !cacheOwner) return;
    if (outboxReplayRef.current) return outboxReplayRef.current;
    const replay = (async () => {
      const pending = await localStore.readPendingEnqueues(cacheOwner);
      try {
        for (const pendingItem of pending.sort((left, right) => left.queuedAt - right.queuedAt)) {
          if (pendingItem.cancelledAt) {
            if (!hostedTurnOutboxReady(pendingItem)) break;
            if (pendingItem.purpose === 'hosted-turn-cancel') {
              const delivered = await deliverPendingCancellation(pendingItem);
              if (!delivered) break;
              continue;
            }
            const repaired = await finalizePendingSend(
              pendingChatSendFromOutbox(pendingItem, cacheOwner),
              isChinese ? '任务已取消。' : 'Task cancelled.',
              'cancelled',
              'cancelled',
              isChinese ? '已取消' : 'Cancelled',
            );
            if (!repaired) continue;
            const delivered = await deliverPendingCancellation(pendingItem);
            if (!delivered) break;
            continue;
          }
          if (!hostedTurnOutboxReady(pendingItem)) break;
          if (pendingItem.deliveryTerminalAt) {
            await finalizePendingSend(
              pendingChatSendFromOutbox(pendingItem, cacheOwner),
              pendingItem.lastError || (isChinese ? '消息发送失败。' : 'Message delivery failed.'),
              'failed',
              'send-failed',
              isChinese ? '连接错误' : 'Connection error',
              pendingItem,
            );
            const settled = await settleAcceptedOutboxItem(pendingItem);
            if (settled === 'cleanup-pending') break;
            continue;
          }
          if (pendingItem.deliveryAcceptedAt) {
            const acceptedMutation = await acceptPendingOutboxItem(pendingItem);
            if (!acceptedMutation.updated || !acceptedMutation.item) {
              if (acceptedMutation.item?.cancelledAt) {
                await deliverPendingCancellation(acceptedMutation.item);
              }
              continue;
            }
            activeHostedTurnIdRef.current = acceptedMutation.item.input.turnId;
            beginOptimisticHostedTurn(
              acceptedMutation.item.conversationId,
              acceptedMutation.item.input.turnId,
            );
            setActiveHostedTurnId(acceptedMutation.item.input.turnId);
            setHostedRunning(true);
            setSending(true);
            const settled = await settleAcceptedOutboxItem(acceptedMutation.item);
            if (settled === 'cleanup-pending') break;
            continue;
          }
          const claimKey = hostedTurnDeliveryClaimKey(cacheOwner, pendingItem.input.requestId);
          const claim = hostedTurnDeliveryClaims.tryAcquire(claimKey);
          if (!claim) break;
          try {
            const { item, response } = await deliverPendingEnqueue(pendingItem);
            const responseFailure = hostedTurnResponseFailure(response);
            if (responseFailure) {
              const outcome = await handleOutboxFailure(item, responseFailure);
              if (outcome === 'retry' || outcome === 'retry-background') break;
              continue;
            }
            const acceptedItem = {
              ...item,
              deliveryAcceptedAt: Date.now(),
              lastError: '',
              nextAttemptAt: 0,
            };
            const acceptedMutation = await acceptPendingOutboxItem(acceptedItem);
            if (!acceptedMutation.updated || !acceptedMutation.item) {
              const cancelled = acceptedMutation.item;
              if (cancelled?.cancelledAt) await deliverPendingCancellation(cancelled);
              continue;
            }
            if (!activeConversationIdRef.current) {
              activeConversationIdRef.current = item.conversationId;
              setActiveConversationId(item.conversationId);
            }
            if (activeConversationIdRef.current === item.conversationId) {
              activeHostedTurnIdRef.current = item.input.turnId;
              beginOptimisticHostedTurn(item.conversationId, item.input.turnId);
              setActiveHostedTurnId(item.input.turnId);
              setHostedRunning(true);
              setSending(true);
              const generation = ++conversationSyncGenerationRef.current;
              await loadConversation(item.conversationId, generation);
            }
            const settled = await settleAcceptedOutboxItem(acceptedMutation.item);
            if (settled === 'cleanup-pending') break;
          } catch (error) {
            if (error instanceof HostedTurnCancelledDuringDelivery) {
              const cancelled = (await localStore.readPendingEnqueues(cacheOwner)).find(
                ({ input }) => input.requestId === pendingItem.input.requestId,
              );
              if (cancelled?.cancelledAt) await deliverPendingCancellation(cancelled);
              continue;
            }
            const failure = hostedTurnTransportFailure(error);
            const outcome = await handleOutboxFailure(pendingItem, {
              ...failure,
              message: serverFailure(error, isChinese),
            });
            if (outcome === 'retry' || outcome === 'retry-background') break;
          } finally {
            hostedTurnDeliveryClaims.release(claimKey, claim);
          }
        }
      } finally {
        cleanupUnreferencedPickerCacheFiles([
          ...attachmentsRef.current,
          ...pending.flatMap((item) => (item.pendingAttachments || []).flatMap((attachment) => (
            attachment.sourceUri
              ? [{ ownedTemporary: attachment.ownedTemporary, uri: attachment.sourceUri }]
              : []
          ))),
        ]);
      }
    })();
    outboxReplayRef.current = replay;
    try {
      await replay;
    } finally {
      if (outboxReplayRef.current === replay) outboxReplayRef.current = null;
    }
  }, [
    acceptPendingOutboxItem,
    beginOptimisticHostedTurn,
    cacheOwner,
    clearOptimisticHostedTurn,
    cloudApi,
    deliverPendingEnqueue,
    deliverPendingCancellation,
    handleOutboxFailure,
    isChinese,
    loadConversation,
    localStore,
    settleAcceptedOutboxItem,
  ]);

  const openConversation = useCallback(async (
    conversationId: string,
    expectedGeneration = 0,
  ) => {
    if (!cloudApi || !conversationId) return null;
    if (conversationId.startsWith('official:')) {
      const placeholder = conversationIndexRef.current.find(({ id }) => id === conversationId);
      const result = await cloudApi.adoptOfficialConversation(
        conversationId,
        // Prefer the cache entry's profile, otherwise the active shell profile —
        // never silently fall back to "default" while managing another profile.
        placeholder?.profile || profile,
        placeholder?.title || '',
      );
      if (
        expectedGeneration
        && expectedGeneration !== conversationSyncGenerationRef.current
      ) {
        return result.conversation;
      }
      const next = upsertCachedConversation(
        conversationIndexRef.current,
        result.conversation,
        conversationId,
      );
      conversationIndexRef.current = next;
      applyConversation(result.conversation);
      return result.conversation;
    }
    const cached = conversationIndexRef.current.find(({ id }) => id === conversationId);
    if (cached && isCompleteConversation(cached)) {
      if (
        expectedGeneration
        && expectedGeneration !== conversationSyncGenerationRef.current
      ) {
        return cached;
      }
      applyConversation(cached);
      return cached;
    }
    return loadConversation(conversationId, expectedGeneration);
  }, [applyConversation, cloudApi, loadConversation, profile]);

  const loadConversationIndex = useCallback(async (
    preferredId = '',
    signal?: AbortSignal,
  ) => {
    const syncGeneration = ++conversationSyncGenerationRef.current;
    let localConversations = conversationIndexRef.current;
    let rememberedId = activeConversationIdRef.current;
    const shouldHydrateCache = Boolean(
      localStore && cacheOwner && hydratedCacheOwnerRef.current !== cacheOwner,
    );
    if (localStore && cacheOwner) {
      const [cached, optimisticLedgers] = await Promise.all([
        shouldHydrateCache ? localStore.read(cacheOwner) : Promise.resolve(null),
        localStore.readOptimisticConversations(cacheOwner),
      ]);
      if (syncGeneration !== conversationSyncGenerationRef.current) return;
      if (shouldHydrateCache) hydratedCacheOwnerRef.current = cacheOwner;
      const liveOptimisticLedgers = [
        ...optimisticMessagesByConversationRef.current.entries(),
      ].map(([conversationId, liveMessages]) => {
        const pendingTurn = optimisticPendingByConversationRef.current.get(conversationId);
        return {
          conversationId,
          messages: liveMessages.map(chatMessageToCollaborationMessage),
          ...(pendingTurn ? { pendingTurn } : {}),
          updatedAt: Math.max(
            pendingTurn?.updatedAt || 0,
            ...liveMessages.map((message) => message.updatedAt || message.createdAt || 0),
          ),
        };
      });
      const mergedOptimisticLedgers = mergeOptimisticConversationLedgers(
        optimisticLedgers,
        liveOptimisticLedgers,
      );
      optimisticMessagesByConversationRef.current = new Map(
        mergedOptimisticLedgers.map((entry) => [
          entry.conversationId,
          conversationMessagesToView({
            id: entry.conversationId,
            messages: entry.messages,
            profile,
            title: optimisticConversationTitle(entry.messages, isChinese),
          }, isChinese),
        ]),
      );
      optimisticPendingByConversationRef.current = new Map(
        mergedOptimisticLedgers.flatMap((entry) => (
          entry.pendingTurn ? [[entry.conversationId, entry.pendingTurn] as const] : []
        )),
      );
      if (cached) {
        localConversations = mergeOptimisticConversationSummaries(
          cached.conversations,
          mergedOptimisticLedgers,
          profile,
          isChinese,
        );
        rememberedId = cached.activeConversationId;
        conversationIndexRef.current = localConversations;
        setConversations(localConversations);
        const immediateId = resolveConversationId(
          preferredId || rememberedId || localConversations[0]?.id || '',
          localConversations,
        );
        const immediate = localConversations.find(({ id }) => id === immediateId);
        if (immediate && isCompleteConversation(immediate)) applyConversation(immediate);
      } else if (shouldHydrateCache && mergedOptimisticLedgers.length) {
        localConversations = mergeOptimisticConversationSummaries(
          [],
          mergedOptimisticLedgers,
          profile,
          isChinese,
        );
        rememberedId = localConversations[0]?.id || '';
        conversationIndexRef.current = localConversations;
        setConversations(localConversations);
        const immediate = localConversations[0];
        if (immediate) applyConversation(immediate);
      }
    }
    if (!cloudApi) {
      const activeId = resolveConversationId(
        preferredId || rememberedId || localConversations[0]?.id || '',
        localConversations,
      );
      const active = localConversations.find(({ id }) => id === activeId);
      if (active) {
        applyConversation(active);
      } else {
        activeConversationIdRef.current = '';
        activeHostedTurnIdRef.current = '';
        setActiveConversationId('');
        setActiveHostedTurnId('');
        setMessages([]);
        setHostedRunning(false);
        setSending(false);
      }
      return;
    }
    const result = await cloudApi.getUnifiedConversations(profile, signal);
    if (syncGeneration !== conversationSyncGenerationRef.current) return;
    const reconciliation = reconcileConversationCache(
      localConversations,
      result.conversations,
    );
    const selectableConversations = mergeOptimisticConversationSummaries(
      reconciliation.conversations,
      [...optimisticMessagesByConversationRef.current.entries()].map(
        ([conversationId, optimisticMessages]) => ({
          conversationId,
          messages: optimisticMessages.map(chatMessageToCollaborationMessage),
          updatedAt: Math.max(
            0,
            ...optimisticMessages.map((message) => message.updatedAt || message.createdAt || 0),
          ),
        }),
      ),
      profile,
      isChinese,
    );
    const requestedActiveId = resolveConversationId(
      preferredId
        || activeConversationIdRef.current
        || rememberedId
        || reconciliation.conversations[0]?.id
        || '',
      selectableConversations,
    );
    const missingIds = new Set<string>();
    const downloaded = await mapWithConcurrency(
      reconciliation.downloadIds.filter((id) => id === requestedActiveId),
      1,
      async (id) => {
        try {
          return (await cloudApi.getConversation(id, signal)).conversation;
        } catch (error) {
          // The index and detail endpoints are eventually consistent.  A
          // deleted row must not blank the whole history or trigger a toast.
          if (isConversationNotFoundError(error)) {
            missingIds.add(id);
            return null;
          }
          throw error;
        }
      },
    );
    if (syncGeneration !== conversationSyncGenerationRef.current) return;
    const synchronized = mergeOptimisticConversationSummaries(
      mergeDownloadedConversations(
        reconciliation.conversations.filter(({ id }) => !missingIds.has(id)),
        downloaded.filter((conversation): conversation is SingleConversation => conversation !== null),
      ),
      [...optimisticMessagesByConversationRef.current.entries()].map(
        ([conversationId, optimisticMessages]) => ({
          conversationId,
          messages: optimisticMessages.map(chatMessageToCollaborationMessage),
          updatedAt: Math.max(
            0,
            ...optimisticMessages.map((message) => message.updatedAt || message.createdAt || 0),
          ),
        }),
      ),
      profile,
      isChinese,
    );
    const activeId = resolveConversationId(
      requestedActiveId || synchronized[0]?.id || '',
      synchronized,
    );
    commitConversationIndex(synchronized, activeId);
    if (!activeId) {
      activeConversationIdRef.current = '';
      activeHostedTurnIdRef.current = '';
      clearOptimisticHostedTurn();
      setActiveConversationId('');
      setActiveHostedTurnId('');
      setMessages([...optimisticMessagesRef.current]);
      setHostedRunning(false);
      if (!pendingTurnActiveRef.current) setSending(false);
      return;
    }
    await openConversation(activeId, syncGeneration);
  }, [
    applyConversation,
    cacheOwner,
    clearOptimisticHostedTurn,
    cloudApi,
    commitConversationIndex,
    isChinese,
    localStore,
    openConversation,
    profile,
  ]);

  useEffect(() => {
    conversationSyncGenerationRef.current += 1;
    hydratedCacheOwnerRef.current = '';
    conversationIndexRef.current = [];
    hostedEventCursorRef.current = new Map();
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
    setHostedRunning(false);
    setSending(false);
  }, [cacheOwner, clearOptimisticHostedTurn, resetPendingStateMachine]);

  useEffect(() => {
    let disposed = false;
    const requestedConversationId = preferredConversationId || notificationTarget?.conversationId;
    const refreshConversationIndex = (preferredId = '') => (
      conversationIndexRefreshGateRef.current.run(() => withAbortableDeadline(
        (signal) => loadConversationIndex(preferredId, signal),
        HOSTED_TURN_REQUEST_TIMEOUT_MS,
        'Hermes conversation index refresh timed out',
      ))
    );
    void replayPendingEnqueues()
      .catch(() => undefined)
      .then(() => refreshConversationIndex(requestedConversationId))
      .then(() => {
        if (!disposed && preferredConversationId) {
          onPreferredConversationConsumed?.(preferredConversationId);
        }
      })
      .catch((error) => {
        if (!disposed) notify(serverFailure(error, isChinese));
      });
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void replayPendingEnqueues()
        .catch(() => undefined)
        .then(() => refreshConversationIndex(activeConversationIdRef.current))
        .catch((error) => {
          if (!disposed) notify(serverFailure(error, isChinese));
        });
    });
    let indexTimer: ReturnType<typeof setTimeout> | null = null;
    let indexRefreshStopped = false;
    const refreshIndex = async () => {
      if (indexRefreshStopped) return;
      if (AppState.currentState === 'active') {
        await replayPendingEnqueues().catch(() => undefined);
        await refreshConversationIndex(activeConversationIdRef.current).catch(() => undefined);
      }
      if (!indexRefreshStopped) {
        indexTimer = setTimeout(() => void refreshIndex(), 15_000);
      }
    };
    indexTimer = setTimeout(() => void refreshIndex(), 15_000);
    return () => {
      disposed = true;
      indexRefreshStopped = true;
      appState.remove();
      if (indexTimer) clearTimeout(indexTimer);
    };
  }, [
    cloudApi,
    isChinese,
    loadConversationIndex,
    notificationTarget?.conversationId,
    notificationTarget?.notificationId,
    notify,
    onPreferredConversationConsumed,
    preferredConversationId,
    replayPendingEnqueues,
  ]);

  useEffect(() => {
    if (!cloudApi || !activeConversationId || !hostedRunning) {
      return undefined;
    }
    let disposed = false;
    let streamActive = false;
    let streamHealthy = false;
    let streamController: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const generation = ++conversationSyncGenerationRef.current;

    const scheduleStream = () => {
      if (
        disposed
        || streamActive
        || reconnectTimer
        || AppState.currentState !== 'active'
      ) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startStream();
      }, HOSTED_EVENT_RECONNECT_MS);
    };
    const startStream = () => {
      if (disposed || streamActive || AppState.currentState !== 'active') return;
      streamActive = true;
      streamController = new AbortController();
      void consumeHostedConversationEvents(
        cloudApi,
        activeConversationId,
        hostedEventCursorRef.current.get(activeConversationId) || 0,
        streamController.signal,
        ({ conversation, cursor }) => {
          if (
            disposed
            || generation !== conversationSyncGenerationRef.current
            || activeConversationIdRef.current !== activeConversationId
          ) return;
          streamHealthy = true;
          hostedEventCursorRef.current.set(activeConversationId, cursor);
          applyConversation(conversation);
        },
      ).catch(() => {
        if (!streamController?.signal.aborted) streamHealthy = false;
      }).finally(() => {
        streamActive = false;
        streamController = null;
        scheduleStream();
      });
    };
    const poll = async () => {
      if (disposed) return;
      if (AppState.currentState === 'active') {
        await withAbortableDeadline(
          (signal) => loadConversation(activeConversationId, generation, signal),
          HOSTED_TURN_REQUEST_TIMEOUT_MS,
          'Hermes conversation polling timed out',
        ).catch(() => undefined);
      }
      if (!disposed) {
        pollTimer = setTimeout(
          () => void poll(),
          streamHealthy
            ? HOSTED_EVENT_POLL_FALLBACK_MS
            : HOSTED_EVENT_POLL_DISCONNECTED_MS,
        );
      }
    };
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        startStream();
        return;
      }
      streamHealthy = false;
      streamController?.abort();
    });
    startStream();
    void poll();
    return () => {
      disposed = true;
      streamController?.abort();
      appState.remove();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [
    activeConversationId,
    applyConversation,
    cloudApi,
    hostedRunning,
    loadConversation,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupAttachmentSources(attachmentsRef.current);
      attachmentsRef.current = [];
      clearOptimisticHostedTurn();
      if (pendingScrollFrame.current !== null) {
        cancelAnimationFrame(pendingScrollFrame.current);
      }
      pendingAttachmentCleanup.current?.();
      pendingNavigationCleanup.current?.();
    };
  }, [cleanupAttachmentSources, clearOptimisticHostedTurn]);

  useEffect(() => {
    if (attachmentOwnerRef.current === cacheOwner) return;
    cleanupAttachmentSources(attachmentsRef.current);
    attachmentOwnerRef.current = cacheOwner;
    updateAttachments([]);
  }, [cacheOwner, cleanupAttachmentSources, updateAttachments]);

  const createConversation = async () => {
    autoFollowStreamRef.current = true;
    clearOptimisticHostedTurn();
    optimisticMessagesRef.current = [];
    resetPendingStateMachine();
    contentRef.current = '';
    setContent('');
    cleanupAttachmentSources(attachmentsRef.current);
    updateAttachments([]);
    if (cloudApi) {
      try {
        const result = await cloudApi.createConversation(profile, isChinese ? '新对话' : 'New conversation');
        applyConversation(result.conversation);
        contentRef.current = '';
        setContent('');
        cleanupAttachmentSources(attachmentsRef.current);
        updateAttachments([]);
      } catch (error) {
        notify(serverFailure(error, isChinese));
      }
      return;
    }
    setMessages([]);
    notify(isChinese ? '已新建会话' : 'New conversation created');
  };

  const send = async () => {
    const currentContent = contentRef.current;
    const trimmed = currentContent.trim();
    if ((!trimmed && attachmentCount === 0) || sending) return;
    const pendingAttachments = [...attachments];
    const hadActiveConversation = Boolean(activeConversationIdRef.current);
    const userMessageCreatedAt = Date.now();
    const userMessageId = uniqueTurnId('user');
    const hostedTurnId = uniqueTurnId('hosted');
    const sendingConversationId = activeConversationIdRef.current
      || `chat_${safeOutboxPathComponent(userMessageId).slice(0, 251)}`;
    if (hadActiveConversation) {
      hostedTurnVisibilityFailuresRef.current.delete(sendingConversationId);
      setMessages((current) => current.filter(
        ({ id }) => !id.startsWith('hosted-sync-failed-'),
      ));
    }
    const conversationProfile = (
      conversationIndexRef.current.find(
        ({ id }) => id === activeConversationIdRef.current,
      )?.profile?.trim()
      || profile
    );
    const userMessage: ChatMessage = {
      avatarRole: 'user',
      content: trimmed || (isChinese ? `已添加 ${attachmentCount} 个附件` : `${attachmentCount} attachments`),
      createdAt: userMessageCreatedAt,
      durationMs: 0,
      id: userMessageId,
      name: isChinese ? '你' : 'You',
      role: 'user',
      status: 'completed',
      updatedAt: userMessageCreatedAt,
    };
    const sendGeneration = ++sendOperationGenerationRef.current;
    const sendKey = hostedTurnDeliveryClaimKey(cacheOwner, userMessageId);
    cancelledPendingSendKeys.delete(sendKey);
    const isCurrentSend = () => (
      pendingTurnActiveRef.current
      && sendOperationGenerationRef.current === sendGeneration
      && !cancelledPendingSendKeys.has(sendKey)
    );
    pendingChatSendRef.current = {
      conversationId: sendingConversationId,
      key: sendKey,
      userMessage,
    };
    autoFollowStreamRef.current = true;
    activeConversationIdRef.current = sendingConversationId;
    setActiveConversationId(sendingConversationId);
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
    if (!hadActiveConversation) {
      commitConversationIndex([{
        created_at: userMessageCreatedAt,
        id: sendingConversationId,
        message_count: 1,
        messages: [chatMessageToCollaborationMessage(userMessage)],
        profile: conversationProfile,
        title: trimmed.slice(0, 36) || (isChinese ? '新对话' : 'New conversation'),
        updated_at: userMessageCreatedAt,
      }, ...conversationIndexRef.current], sendingConversationId);
    }
    setMessages((current) => [...current, userMessage]);
    let composerCleared = false;
    const clearQueuedComposer = () => {
      if (composerCleared) return;
      composerCleared = true;
      contentRef.current = '';
      setContent('');
      updateAttachments([]);
    };
    clearQueuedComposer();
    setSending(true);
    pendingTurnActiveRef.current = true;
    firstTokenAtRef.current = 0;
    setReconnectAttempt(0);
    updatePendingPhase('thinking', userMessageCreatedAt);
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
      meta: { attachments: [] },
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
      recentMessages: [...messages, userMessage].slice(-12).map((message) => ({
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
    let attachmentSourcesReleased = false;
    let queuedItem: HostedTurnOutboxItem | null = {
      attempts: 0,
      conversationId: sendingConversationId,
      conversationPending: !hadActiveConversation,
      conversationProfile,
      conversationTitle: trimmed.slice(0, 36) || (isChinese ? '新对话' : 'New conversation'),
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
      // later point can therefore reconstruct both the user message and every
      // planned attachment path without inventing a second request id.
      const initialPendingTurn = pendingTurnState('thinking', 0, userMessageCreatedAt);
      const initialization = await localStore.initializePendingEnqueue(
        cacheOwner,
        queuedItem,
        durableOptimisticMessages.map(chatMessageToCollaborationMessage),
        initialPendingTurn,
      );
      if (!initialization.updated || !initialization.item) return;
      queuedItem = initialization.item;
      enqueuePersisted = true;
      if (!isCurrentSend()) return;
      optimisticMessagesByConversationRef.current.set(
        sendingConversationId,
        durableOptimisticMessages,
      );
      optimisticPendingByConversationRef.current.set(sendingConversationId, initialPendingTurn);
      optimisticMessagesRef.current = durableOptimisticMessages;
      if (!cloudApi || !client) {
        await handleOutboxFailure(queuedItem, {
          certainty: 'definitive',
          code: 'HERMES_CONNECTION_UNAVAILABLE',
          message: isChinese
            ? '当前没有可用的 Hermes 服务器连接，请重新登录后重试。'
            : 'No Hermes server connection is available. Sign in again and try again.',
          retryable: false,
        });
        return;
      }
      let conversationId = sendingConversationId;
      const durableAttachments = await persistPendingAttachments(
        cacheOwner,
        userMessageId,
        plannedAttachments,
      );
      const durableMutation = await localStore.upsertPendingEnqueueIfActive(cacheOwner, {
        ...queuedItem,
        pendingAttachments: durableAttachments,
      });
      if (!durableMutation.updated || !durableMutation.item) return;
      queuedItem = durableMutation.item;
      cleanupAttachmentSources(pendingAttachments);
      attachmentSourcesReleased = true;
      deliveryClaim = hostedTurnDeliveryClaims.tryAcquire(sendKey);
      if (!deliveryClaim) {
        deliveryRetryScheduled = true;
        return;
      }
      pendingChatSendRef.current = { conversationId, key: sendKey, queuedItem, userMessage };
      if (localStore && cacheOwner) {
        clearQueuedComposer();
        const delivery = await deliverPendingEnqueue(queuedItem);
        queuedItem = delivery.item;
        conversationId = queuedItem.conversationId;
        enqueueAcknowledged = true;
        hostedAccepted = delivery.response.accepted;
        if (!isCurrentSend()) {
          const cancelled = await localStore.cancelPendingEnqueue(
            cacheOwner,
            userMessageId,
            queuedItem,
          );
          if (cancelled) void deliverPendingCancellation(cancelled);
          return;
        }
        const responseFailure = hostedTurnResponseFailure(delivery.response);
        if (responseFailure) {
          const outcome = await handleOutboxFailure(queuedItem, responseFailure);
          deliveryRetryScheduled = outcome === 'retry';
          if (deliveryRetryScheduled) {
            setSending(true);
          }
          return;
        }
      }
      clearQueuedComposer();
      queuedItem = {
        ...queuedItem,
        deliveryAcceptedAt: Date.now(),
        lastError: '',
        nextAttemptAt: 0,
      };
      const acceptedMutation = await acceptPendingOutboxItem(queuedItem);
      if (!acceptedMutation.updated || !acceptedMutation.item) {
        if (acceptedMutation.item?.cancelledAt) {
          void deliverPendingCancellation(acceptedMutation.item);
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
        cancelledPendingSendKeys.delete(sendKey);
        await settleAcceptedOutboxItem(queuedItem);
        const generation = ++conversationSyncGenerationRef.current;
        await loadConversation(conversationId, generation);
      }
    } catch (error) {
      if (!isCurrentSend() || error instanceof HostedTurnCancelledDuringDelivery) {
        if (localStore && cacheOwner && queuedItem) {
          const cancelled = await localStore.cancelPendingEnqueue(
            cacheOwner,
            userMessageId,
            queuedItem,
          );
          if (cancelled) void deliverPendingCancellation(cancelled);
        }
        return;
      }
      if (enqueuePersisted && !enqueueAcknowledged) {
        const transportFailure = hostedTurnTransportFailure(error);
        const outcome = await handleOutboxFailure(
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
        );
        deliveryRetryScheduled = outcome === 'retry';
        if (deliveryRetryScheduled) {
          notify(isChinese
            ? '消息已保存在待发送队列，将在一分钟后自动重连。'
            : 'Message queued. Hermes will retry in one minute.');
        }
      } else if (!enqueueAcknowledged) {
        if (queuedItem) {
          try {
            cleanupPendingAttachments(queuedItem);
          } catch {
            // The user-visible terminal state must not depend on best-effort
            // attachment garbage collection.
          }
        }
        const failure = serverFailure(error, isChinese);
        await finalizePendingSend(
          pendingChatSendRef.current || {
            conversationId: sendingConversationId,
            key: sendKey,
            queuedItem: queuedItem || undefined,
            userMessage,
          },
          failure,
          'failed',
          'send-failed',
          enqueuePersisted
            ? (isChinese ? '连接错误' : 'Connection error')
            : (isChinese ? '本地存储错误' : 'Local storage error'),
        );
      } else {
        const failure = serverFailure(error, isChinese);
        notify(isChinese
          ? `任务已由服务器接管，当前同步暂时失败：${failure}`
          : `The server is still running the task. Conversation sync failed temporarily: ${failure}`);
      }
    } finally {
      if (!enqueuePersisted || attachmentSourcesReleased) {
        cleanupAttachmentSources(pendingAttachments);
      }
      if (deliveryClaim) hostedTurnDeliveryClaims.release(sendKey, deliveryClaim);
      if (!hostedAccepted && !deliveryRetryScheduled && isCurrentSend()) {
        pendingTurnActiveRef.current = false;
        setHostedRunning(false);
        setSending(false);
      }
    }
  };
  const requestSend = () => {
    if (
      sending
      || (!contentRef.current.trim() && attachmentsRef.current.length === 0)
      || !sendSubmissionGateRef.current.tryAcquire()
    ) return;
    setSending(true);
    void send().finally(() => sendSubmissionGateRef.current.release());
  };

  const cancelActiveHostedTurn = async () => {
    const conversationId = activeConversationIdRef.current;
    if (cancelHostedTurnInFlightRef.current) return;
    if (
      pendingTurnActiveRef.current
      && !hostedRunning
      && !activeHostedTurnIdRef.current
    ) {
      await cancelPendingSend();
      notify(isChinese ? '已取消任务' : 'Task cancelled');
      return;
    }
    if (!cloudApi || !conversationId) return;
    cancelHostedTurnInFlightRef.current = true;
    setCancellingHostedTurn(true);
    try {
      let turnId = activeHostedTurnIdRef.current
        || optimisticPendingByConversationRef.current.get(conversationId)?.turnId
        || '';
      if (!turnId) {
        const refreshed = await withAbortableDeadline(
          (signal) => cloudApi.getConversation(conversationId, signal),
          HOSTED_TURN_CANCEL_TIMEOUT_MS,
          'Hermes hosted-turn lookup timed out',
        );
        turnId = conversationRunningHostedTurnId(refreshed.conversation);
      }
      if (!turnId) {
        notify(isChinese ? '当前任务已经结束。' : 'The current task has already ended.');
        if (activeConversationIdRef.current === conversationId) {
          activeHostedTurnIdRef.current = '';
          clearOptimisticHostedTurn();
          setActiveHostedTurnId('');
          setHostedRunning(false);
          setSending(false);
          resetPendingStateMachine();
          await clearOptimisticPendingTurn(conversationId);
        }
        return;
      }
      const cancelledAt = Date.now();
      const cancellationItem: HostedTurnOutboxItem = {
        attempts: 0,
        cancelledAt,
        conversationId,
        conversationPending: false,
        conversationProfile: profile,
        input: {
          message: {
            content: isChinese ? '取消任务' : 'Cancel task',
            created_at: cancelledAt,
            id: `cancel-${turnId}`,
            name: isChinese ? '你' : 'You',
            role: 'user',
            status: 'completed',
          },
          recentMessages: [],
          requestId: `cancel-${turnId}`,
          turnId,
        },
        purpose: 'hosted-turn-cancel',
        queuedAt: cancelledAt,
      };
      if (localStore && cacheOwner) {
        await localStore.upsertPendingEnqueue(cacheOwner, cancellationItem);
      }
      if (activeConversationIdRef.current === conversationId) {
        activeHostedTurnIdRef.current = '';
        clearOptimisticHostedTurn();
        setActiveHostedTurnId('');
        setHostedRunning(false);
        setSending(false);
        resetPendingStateMachine();
        await clearOptimisticPendingTurn(conversationId);
      }
      notify(isChinese ? '已取消任务' : 'Task cancelled');
      void deliverPendingCancellation(cancellationItem);
    } catch (error) {
      try {
        const refreshed = await withAbortableDeadline(
          (signal) => cloudApi.getConversation(conversationId, signal),
          HOSTED_TURN_CANCEL_TIMEOUT_MS,
          'Hermes hosted-turn reconciliation timed out',
        );
        if (activeConversationIdRef.current === conversationId) {
          applyConversation(refreshed.conversation);
        }
        if (!conversationRunningHostedTurnId(refreshed.conversation)) {
          notify(isChinese ? '任务已结束' : 'Task already finished');
          return;
        }
      } catch {
        // Keep the original cancellation error when the reconciliation read also fails.
      }
      notify(serverFailure(error, isChinese));
    } finally {
      cancelHostedTurnInFlightRef.current = false;
      setCancellingHostedTurn(false);
    }
  };

  const selectConversation = async (conversationId: string) => {
    if (!conversationId || conversationId === activeConversationIdRef.current) return;
    if (
      pendingTurnActiveRef.current
      && !hostedRunning
      && !activeHostedTurnIdRef.current
    ) {
      await cancelPendingSend();
    }
    autoFollowStreamRef.current = true;
    activeHostedTurnIdRef.current = '';
    clearOptimisticHostedTurn();
    setActiveHostedTurnId('');
    setCancellingHostedTurn(false);
    setSending(false);
    setHostedRunning(false);
    resetPendingStateMachine();
    optimisticMessagesRef.current = [
      ...(optimisticMessagesByConversationRef.current.get(conversationId) || []),
    ];
    setContent('');
    contentRef.current = '';
    cleanupAttachmentSources(attachmentsRef.current);
    updateAttachments([]);
    const generation = ++conversationSyncGenerationRef.current;
    try {
      await openConversation(conversationId, generation);
    } catch (error) {
      if (isConversationNotFoundError(error)) {
        const remaining = conversationIndexRef.current.filter(
          ({ id }) => id !== conversationId,
        );
        const fallbackId = remaining[0]?.id || '';
        commitConversationIndex(remaining, fallbackId);
        if (fallbackId) {
          await openConversation(fallbackId, generation);
        } else {
          activeConversationIdRef.current = '';
          setActiveConversationId('');
          setMessages([]);
        }
        return;
      }
      notify(serverFailure(error, isChinese));
    }
  };

  const branchFromMessage = useCallback(async (message: ChatMessage) => {
    const conversationId = activeConversationIdRef.current;
    if (
      !cloudApi
      || !conversationId
      || !message.runtimeMessageId
      || !message.runtimeSessionId
    ) return;
    if (sending || hostedRunning) {
      notify(isChinese ? '当前任务结束后再创建分支。' : 'Wait for the current run before branching.');
      return;
    }
    try {
      const response = await cloudApi.forkConversationFromMessage(
        conversationId,
        message.id,
        {
          idempotencyKey: `ios-branch-${Date.now().toString(36)}-${message.id}`,
          profile: message.profile || profile,
        },
      );
      applyConversation(response.conversation);
      notify(isChinese ? '已从所选消息创建分支。' : 'Created a branch from this message.');
    } catch (error) {
      notify(serverFailure(error, isChinese));
    }
  }, [
    applyConversation,
    cloudApi,
    hostedRunning,
    isChinese,
    notify,
    profile,
    sending,
  ]);

  const pickPhoto = async (camera: boolean) => {
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({
          allowsMultipleSelection: true,
          mediaTypes: ['images'],
          quality: 1,
          selectionLimit: 0,
        });
    if (!result.canceled) {
      const stamp = Date.now();
      appendPickedAttachments(
        result.assets.map((asset, index): ChatAttachment => ({
          id: `image-${stamp}-${index}-${asset.assetId ?? asset.uri}`,
          kind: 'image',
          mimeType: asset.mimeType,
          ownedTemporary: isUriInsideDirectory(asset.uri, Paths.cache.uri),
          name: asset.fileName ?? (isChinese ? `照片 ${index + 1}` : `Photo ${index + 1}`),
          size: asset.fileSize,
          uri: asset.uri,
        })),
      );
      setAttachmentsOpen(false);
    }
    keepLatestVisible(false);
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: false,
      multiple: true,
    });
    if (!result.canceled) {
      const stamp = Date.now();
      appendPickedAttachments(
        result.assets.map((asset, index): ChatAttachment => ({
          id: `file-${stamp}-${index}-${asset.uri}`,
          kind: asset.mimeType?.startsWith('image/') ? 'image' : 'file',
          mimeType: asset.mimeType,
          ownedTemporary: isUriInsideDirectory(asset.uri, Paths.cache.uri),
          name: asset.name,
          size: asset.size,
          uri: asset.uri,
        })),
      );
      setAttachmentsOpen(false);
    }
    keepLatestVisible(false);
  };

  const appendPickedAttachments = (candidates: readonly ChatAttachment[]) => {
    const { accepted, rejected } = partitionAttachmentsBySize(
      candidates,
      (attachment) => {
        try {
          return new ExpoFile(attachment.uri).size;
        } catch {
          return 0;
        }
      },
    );
    if (accepted.length) updateAttachments((current) => [...current, ...accepted]);
    if (rejected.length) {
      cleanupAttachmentSources(rejected);
      const limit = Math.floor(MAX_CONVERSATION_ATTACHMENT_BYTES / (1024 * 1024));
      notify(isChinese
        ? `单个附件不能超过 ${limit} MB：${rejected.map(({ name }) => name).join('、')}`
        : `Each attachment must be ${limit} MB or smaller: ${rejected.map(({ name }) => name).join(', ')}`);
    }
  };

  const showIOSAttachmentPicker = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: 3,
        options: isChinese
          ? ['照片图库', '拍照', '系统文件', '取消']
          : ['Photo Library', 'Take Photo', 'Choose File', 'Cancel'],
        title: isChinese ? '添加附件' : 'Add Attachment',
      },
      (index) => {
        if (index === 0) void pickPhoto(false);
        if (index === 1) void pickPhoto(true);
        if (index === 2) void pickFile();
      },
    );
  };

  const openAttachmentPicker = () => {
    if (Platform.OS !== 'ios') {
      setAttachmentsOpen(true);
      return;
    }

    pendingAttachmentCleanup.current?.();
    keyboardAvoidanceEnabled.value = 0;
    const keyboardWasVisible = Keyboard.isVisible();
    composerInputRef.current?.blur();
    if (!keyboardWasVisible) {
      requestAnimationFrame(showIOSAttachmentPicker);
      return;
    }

    let completed = false;
    const present = () => {
      if (completed) return;
      completed = true;
      pendingAttachmentCleanup.current?.();
      showIOSAttachmentPicker();
    };
    const subscription = Keyboard.addListener('keyboardDidHide', present);
    const fallback = setTimeout(present, 450);
    pendingAttachmentCleanup.current = () => {
      subscription.remove();
      clearTimeout(fallback);
      pendingAttachmentCleanup.current = null;
    };
    Keyboard.dismiss();
  };

  const shareAttachment = async (attachment: ChatAttachment) => {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(attachment.uri, {
        dialogTitle: attachment.name,
        mimeType: attachment.mimeType ?? undefined,
      });
      return;
    }
    notify(isChinese ? '当前设备无法打开系统分享' : 'System sharing is unavailable');
  };

  const previewAttachment = async (attachment: ChatAttachment) => {
    if (
      Platform.OS === 'ios'
      && await presentQuickLook(attachment.uri, attachment.name)
    ) {
      return;
    }
    await shareAttachment(attachment);
  };

  const removeAttachment = (attachment: ChatAttachment) => {
    cleanupAttachmentSources([attachment]);
    updateAttachments((current) => (
      current.filter((item) => item.id !== attachment.id)
    ));
  };

  const openNavigationAfterKeyboard = () => {
    if (!openNavigation) return;
    pendingNavigationCleanup.current?.();
    if (Platform.OS !== 'ios' || !Keyboard.isVisible()) {
      openNavigation();
      return;
    }

    let completed = false;
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      if (completed) return;
      completed = true;
      pendingNavigationCleanup.current?.();
      openNavigation();
    });
    const fallback = setTimeout(() => {
      if (completed) return;
      completed = true;
      pendingNavigationCleanup.current?.();
      openNavigation();
    }, 650);
    pendingNavigationCleanup.current = () => {
      subscription.remove();
      clearTimeout(fallback);
      pendingNavigationCleanup.current = null;
    };
    keyboardAvoidanceEnabled.value = 0;
    composerInputRef.current?.blur();
    Keyboard.dismiss();
  };

  const openStoredAttachment = async (
    attachment: StoredChatAttachment,
    share = false,
  ) => {
    if (!cloudApi) return;
    try {
      const target = new ExpoFile(
        Paths.cache,
        `${stableStringHash(attachment.downloadUrl)}-${attachment.name.replace(/[\\/:*?"<>|]+/g, '_')}`,
      );
      try {
        if (!target.exists) {
          const blob = await cloudApi.downloadConversationAttachment(attachment.downloadUrl);
          target.write(new Uint8Array(await blob.arrayBuffer()));
        }
        if (!share && await presentQuickLook(target.uri, attachment.name)) return;
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(target.uri, {
            dialogTitle: attachment.name,
            mimeType: attachment.mimeType,
          });
        }
      } finally {
        if (target.exists) target.delete();
      }
    } catch (error) {
      notify(serverFailure(error, isChinese));
    }
  };

  return (
    <Reanimated.View
      style={[
        styles.root,
        { backgroundColor: tokens.colors.background },
        keyboardRootStyle,
      ]}
    >
      <View style={styles.chat}>
        {showHistory ? (
          <ConversationHistory
            onNew={createConversation}
            onSelect={(id) => { void selectConversation(id); }}
            conversations={conversations}
            activeId={activeConversationId}
            isChinese={isChinese}
          />
        ) : null}

        <View style={styles.main}>
          <View
            style={[
              styles.header,
              {
                backgroundColor: multiplyAlpha(tokens.colors.background, 0.92),
                borderBottomColor: tokens.colors.border,
                minHeight: 52 + safeAreaTop,
                paddingLeft: 8 + safeAreaLeft,
                paddingRight: 8 + safeAreaRight,
                paddingTop: safeAreaTop + 7,
              },
            ]}
          >
            <View style={[styles.heading, compact && styles.headingCompact]}>
              <IOSPressable
                accessibilityLabel={isChinese ? '打开导航' : 'Open navigation'}
                onPress={openNavigationAfterKeyboard}
                opacityTo={0.72}
                scaleTo={0.92}
                style={[
                  styles.navToggle,
                  {
                    backgroundColor: tokens.colors.card,
                    borderColor: tokens.colors.border,
                  },
                ]}
              >
                <Menu color={tokens.colors.foreground} size={compact ? 14 : 16} strokeWidth={1.7} />
              </IOSPressable>
              <View style={[styles.headerAvatar, compact && styles.headerAvatarCompact]}>
                <Image
                  defaultSource={HERMES_AVATAR}
                  resizeMode="contain"
                  source={HERMES_AVATAR}
                  style={styles.avatarImage}
                />
              </View>
              <View style={styles.headingCopy}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.headingTitle,
                    { color: tokens.colors.foreground },
                    compact && styles.headingTitleCompact,
                  ]}
                >
                  Hermes Agent
                </Text>
                {!compact ? (
                  <Text numberOfLines={1} style={[styles.headingSubtitle, { color: tokens.colors.textTertiary }]}>
                    {isChinese ? '当前窗口持续使用同一个会话' : 'This window keeps using the same conversation'}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.headerControls}>
              <View style={styles.gatewayStatuses}>
                {gatewayStatuses.map((gateway) => (
                  <View key={gateway.id} style={styles.gatewayStatusRow}>
                    <View
                      accessibilityLabel={`${gateway.label} ${gateway.state}`}
                      style={[
                        styles.gatewayStatusDot,
                        {
                          backgroundColor: gateway.state === 'online'
                            ? tokens.colors.success
                            : gateway.state === 'degraded'
                              ? tokens.colors.warning
                              : tokens.colors.destructive,
                        },
                      ]}
                    />
                    <Text
                      numberOfLines={1}
                      style={[styles.gatewayStatusLabel, { color: tokens.colors.textSecondary }]}
                    >
                      {gateway.label}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.gatewayStatusVersion, { color: tokens.colors.textTertiary }]}
                    >
                      {gateway.version?.split(' ')[0] || '—'}
                    </Text>
                  </View>
                ))}
              </View>
              <IOSPressable
                accessibilityLabel={isChinese ? '模型与工具' : 'Model and tools'}
                onPress={() => {
                  keyboardAvoidanceEnabled.value = 0;
                  composerInputRef.current?.blur();
                  Keyboard.dismiss();
                  setToolsOpen(true);
                }}
                pressedStyle={{ backgroundColor: tokens.colors.accent }}
                style={[
                  styles.modelTools,
                  {
                    backgroundColor: tokens.colors.card,
                    borderColor: tokens.colors.border,
                  },
                ]}
              >
                <Text style={[styles.modelToolsText, { color: tokens.colors.foreground }]}>
                  {isChinese ? '模型与工具' : 'Model & tools'}
                </Text>
              </IOSPressable>
              {!compact ? <LiveDot busy={sending} /> : null}
            </View>
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.streamContent,
              {
                paddingBottom: 22,
                paddingHorizontal: compact ? 10 : Math.min(54, width * 0.04),
              },
              messages.length === 0 && styles.emptyStream,
            ]}
            decelerationRate="normal"
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => keepLatestVisible(true)}
            onLayout={() => keepLatestVisible(false)}
            onScroll={handleStreamScroll}
            ref={streamRef}
            scrollEventThrottle={8}
            showsVerticalScrollIndicator={false}
            style={styles.stream}
          >
            {displayMessages.length === 0 ? (
              <Reanimated.View
                entering={FadeIn
                  .duration(IOS_MOTION.duration.content)
                  .easing(IOS_DECELERATE_EASING)}
                style={styles.welcome}
              >
                <View style={[styles.welcomeOrb, { backgroundColor: '#192320' }]}>
                  <Text style={styles.welcomeOrbText}>H</Text>
                </View>
                <Text style={[styles.welcomeTitle, { color: tokens.colors.foreground }]}>
                  {isChinese ? '直接告诉 Hermes 你想做什么' : 'Tell Hermes what you want to do'}
                </Text>
                <Text style={[styles.welcomeBody, { color: tokens.colors.textSecondary }]}>
                  {isChinese
                    ? '闲聊自动走单 Profile；需要执行的任务自动进入多 Profile 协作与官方工作流。'
                    : 'Chat uses one profile; execution tasks enter multi-profile collaboration and the official workflow.'}
                </Text>
              </Reanimated.View>
            ) : displayMessages.map((message, index) => (
              <UnifiedMessage
                index={index}
                isChinese={isChinese}
                key={message.id}
                message={message}
                onOpenAttachment={openStoredAttachment}
                onInspectActivity={pauseStreamAutoFollow}
                onBranch={branchFromMessage}
              />
            ))}
            {shouldRenderPendingMessage(displayMessages, hostedRunning || sending)
              ? (
                  <PendingMessage
                    index={displayMessages.length}
                    isChinese={isChinese}
                    onInspectActivity={pauseStreamAutoFollow}
                    phase={pendingPhase}
                    reconnectAttempt={reconnectAttempt}
                    startedAt={pendingStartedAt}
                  />
                )
              : null}
          </ScrollView>

          <Reanimated.View
            onLayout={() => keepLatestVisible(false)}
            style={[
              styles.composer,
              {
                backgroundColor: 'transparent',
                paddingLeft: (compact ? 4 : 8) + safeAreaLeft,
                paddingRight: (compact ? 4 : 8) + safeAreaRight,
              },
              composerKeyboardStyle,
            ]}
          >
            {attachmentCount > 0 ? (
              <ScrollView
                contentContainerStyle={styles.attachmentStripContent}
                decelerationRate="normal"
                directionalLockEnabled
                horizontal
                keyboardShouldPersistTaps="handled"
                scrollEventThrottle={8}
                showsHorizontalScrollIndicator={false}
                style={styles.attachmentStrip}
              >
                {attachments.map((attachment) => (
                  <AttachmentItem
                    attachment={attachment}
                    isChinese={isChinese}
                    key={attachment.id}
                    onPreview={() => void previewAttachment(attachment)}
                    onRemove={() => removeAttachment(attachment)}
                    onShare={() => void shareAttachment(attachment)}
                  />
                ))}
              </ScrollView>
            ) : null}
            <ComposerSurface>
              <IOSPressable
                accessibilityLabel={isChinese ? '上传图片或文件' : 'Upload image or file'}
                disabled={sending}
                onPress={openAttachmentPicker}
                opacityTo={0.7}
                scaleTo={0.9}
                style={styles.attachButton}
              >
                <SymbolView
                  fallback={(
                    <Text style={[styles.attachGlyph, { color: tokens.colors.textSecondary }]}>+</Text>
                  )}
                  name="plus.circle.fill"
                  size={27}
                  tintColor={Platform.OS === 'ios'
                    ? PlatformColor('systemGray2')
                    : tokens.colors.textSecondary}
                  type="hierarchical"
                />
              </IOSPressable>
              <TextInput
                blurOnSubmit={false}
                multiline
                onChangeText={(next) => {
                  contentRef.current = next;
                  setContent(next);
                }}
                onFocus={() => {
                  keyboardAvoidanceEnabled.value = 1;
                  keepLatestVisible(false);
                }}
                onSubmitEditing={requestSend}
                placeholder={isChinese ? '输入消息' : 'Type a message'}
                placeholderTextColor={tokens.colors.textDisabled}
                returnKeyType="send"
                ref={composerInputRef}
                selectionColor={tokens.colors.foreground}
                style={[
                  styles.input,
                  {
                    color: tokens.colors.foreground,
                    fontSize: inputFontSize,
                  },
                ]}
                submitBehavior="submit"
                value={content}
              />
              <IOSPressable
                accessibilityLabel={canCancelHostedTurn
                  ? isChinese ? '取消当前任务' : 'Cancel current task'
                  : isChinese ? '发送消息' : 'Send message'}
                disabled={canCancelHostedTurn ? cancellingHostedTurn : !canSend}
                haptic={canCancelHostedTurn ? 'medium' : canSend ? 'light' : 'none'}
                hitSlop={8}
                onPress={canCancelHostedTurn ? () => void cancelActiveHostedTurn() : requestSend}
                opacityTo={0.78}
                pressRetentionOffset={12}
                scaleTo={0.91}
                style={[
                  styles.send,
                  {
                    backgroundColor: canCancelHostedTurn
                      ? tokens.colors.destructive
                      : tokens.colors.primary,
                    opacity: canCancelHostedTurn ? (cancellingHostedTurn ? 0.55 : 1) : canSend ? 1 : 0.38,
                  },
                ]}
              >
                <SymbolView
                  fallback={(
                    <Text style={[
                      styles.sendGlyph,
                      {
                        color: canCancelHostedTurn
                          ? tokens.colors.destructiveForeground
                          : tokens.colors.primaryForeground,
                      },
                    ]}>
                      {cancellingHostedTurn ? '…' : canCancelHostedTurn ? '■' : sending ? '…' : '↑'}
                    </Text>
                  )}
                  name={cancellingHostedTurn
                    ? 'ellipsis'
                    : canCancelHostedTurn
                      ? 'stop.fill'
                      : sending
                        ? 'ellipsis'
                        : 'arrow.up'}
                  size={cancellingHostedTurn
                    ? 18
                    : canCancelHostedTurn
                      ? 14
                      : sending
                        ? 18
                        : 17}
                  tintColor={canCancelHostedTurn
                    ? tokens.colors.destructiveForeground
                    : tokens.colors.primaryForeground}
                  weight="bold"
                />
              </IOSPressable>
            </ComposerSurface>
          </Reanimated.View>
        </View>
      </View>

      <ModelToolsDrawer
        isChinese={isChinese}
        onClose={() => setToolsOpen(false)}
        onNewConversation={() => {
          createConversation();
        }}
        open={toolsOpen}
      />

      <PreviewModal
        onClose={() => setAttachmentsOpen(false)}
        open={attachmentsOpen}
        title={isChinese ? '添加附件' : 'Add attachment'}
      >
        <NativeButton onPress={() => void pickPhoto(false)} outlined prefix={<ImageIcon />}>
          {isChinese ? '照片图库' : 'Photo library'}
        </NativeButton>
        <NativeButton onPress={() => void pickPhoto(true)} outlined prefix={<ImageIcon />}>
          {isChinese ? '拍照' : 'Take photo'}
        </NativeButton>
        <NativeButton onPress={() => void pickFile()} outlined prefix={<File />}>
          {isChinese ? '系统文件' : 'System files'}
        </NativeButton>
      </PreviewModal>
    </Reanimated.View>
  );
}

function ComposerSurface({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  const surfaceStyle = [
    styles.inputShell,
    {
      backgroundColor: 'transparent',
      borderColor: tokens.colors.border,
      borderWidth: StyleSheet.hairlineWidth,
    },
  ];

  return (
    <View style={surfaceStyle}>
      <HermesLiveBlurView
        blurRadius={18}
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.composerFrostedBackground]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.composerFrostedTint,
          { backgroundColor: multiplyAlpha(tokens.colors.background, 0.68) },
        ]}
      />
      {children}
    </View>
  );
}

function AttachmentItem({
  attachment,
  isChinese,
  onPreview,
  onRemove,
  onShare,
}: {
  attachment: ChatAttachment;
  isChinese: boolean;
  onPreview(): void;
  onRemove(): void;
  onShare(): void;
}) {
  const { tokens } = useTheme();
  const isImage = attachment.kind === 'image';
  const backgroundColor = Platform.OS === 'ios'
    ? PlatformColor('secondarySystemBackground')
    : multiplyAlpha(tokens.colors.card, 0.92);
  const borderColor = Platform.OS === 'ios'
    ? PlatformColor('separator')
    : multiplyAlpha(tokens.colors.foreground, 0.14);
  const labelColor = Platform.OS === 'ios'
    ? PlatformColor('label')
    : tokens.colors.foreground;
  const secondaryLabelColor = Platform.OS === 'ios'
    ? PlatformColor('secondaryLabel')
    : tokens.colors.textSecondary;
  const systemBlue = Platform.OS === 'ios'
    ? PlatformColor('systemBlue')
    : tokens.colors.primary;
  return (
    <Reanimated.View
      entering={FadeInUp
        .duration(IOS_MOTION.duration.content)
        .easing(IOS_DECELERATE_EASING)}
      exiting={FadeOut
        .duration(IOS_MOTION.duration.control)
        .easing(IOS_STANDARD_EASING)}
      layout={LinearTransition
        .duration(IOS_MOTION.duration.control)
        .easing(IOS_STANDARD_EASING)}
      style={[
        styles.attachmentItem,
        isImage ? styles.attachmentImageItem : styles.attachmentFileItem,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.attachmentSurface,
          { backgroundColor, borderColor },
        ]}
      />
      <IOSContextMenu
        accessibilityLabel={isChinese
          ? `快速查看 ${attachment.name}`
          : `Quick Look ${attachment.name}`}
        actions={[
          {
            id: 'preview',
            onPress: onPreview,
            systemImage: 'doc.text.magnifyingglass',
            title: isChinese ? '快速查看' : 'Quick Look',
          },
          {
            id: 'share',
            onPress: onShare,
            systemImage: 'square.and.arrow.up',
            title: isChinese ? '分享' : 'Share',
          },
          {
            destructive: true,
            id: 'remove',
            onPress: onRemove,
            systemImage: 'trash',
            title: isChinese ? '移除附件' : 'Remove Attachment',
          },
        ]}
        onPress={onPreview}
        style={isImage ? styles.attachmentImagePreview : styles.attachmentFilePreview}
      >
        {isImage ? (
          <Image resizeMode="cover" source={{ uri: attachment.uri }} style={styles.attachmentThumbnail} />
        ) : (
          <>
            <View style={styles.attachmentFileIcon}>
              <SymbolView
                fallback={<File color={systemBlue} size={27} strokeWidth={1.6} />}
                name="doc.fill"
                size={28}
                tintColor={systemBlue}
                type="hierarchical"
              />
            </View>
            <View style={styles.attachmentFileCopy}>
              <Text numberOfLines={1} style={[styles.attachmentName, { color: labelColor }]}>
                {attachment.name}
              </Text>
              <Text style={[styles.attachmentSize, { color: secondaryLabelColor }]}>
                {formatAttachmentSize(attachment.size)}
              </Text>
            </View>
          </>
        )}
      </IOSContextMenu>
      <IOSPressable
        accessibilityLabel={isChinese
          ? `移除 ${attachment.name}`
          : `Remove ${attachment.name}`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onRemove}
        opacityTo={0.72}
        scaleTo={0.86}
        style={styles.attachmentRemove}
      >
        <SymbolView
          fallback={(
            <View style={styles.attachmentRemoveFallback}>
              <X color="#ffffff" size={12} strokeWidth={2.4} />
            </View>
          )}
          name="xmark.circle.fill"
          size={22}
          tintColor={Platform.OS === 'ios'
            ? PlatformColor('systemGray')
            : '#636366'}
        />
      </IOSPressable>
    </Reanimated.View>
  );
}

function formatAttachmentSize(size?: number | null): string {
  if (!size || size < 1) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function cleanupUnreferencedPickerCacheFiles(
  protectedSources: readonly { ownedTemporary?: boolean; uri: string }[],
): void {
  const protectedUris = new Set(protectedSources.flatMap((source) => {
    if (
      !source.ownedTemporary
      || !isUriInsideDirectory(source.uri, Paths.cache.uri)
    ) return [];
    try {
      return [new URL(source.uri).href];
    } catch {
      return [];
    }
  }));
  const sweep = (directory: ExpoDirectory) => {
    if (!directory.exists) return;
    for (const entry of directory.list()) {
      try {
        if (entry instanceof ExpoDirectory) {
          sweep(entry);
          if (entry.exists && entry.list().length === 0) entry.delete();
          continue;
        }
        const normalized = new URL(entry.uri).href;
        if (!protectedUris.has(normalized) && entry.exists) entry.delete();
      } catch {
        // A later replay or account cleanup will retry inaccessible entries.
      }
    }
  };
  for (const name of ['DocumentPicker', 'ImagePicker']) {
    try {
      sweep(new ExpoDirectory(Paths.cache, name));
    } catch {
      // Picker caches are ephemeral; cleanup remains best-effort.
    }
  }
}

function resolveComposerFontSize(value: string): number {
  const glyphCount = Array.from(value).length;
  if (glyphCount <= 28 || /\s/u.test(value)) return 16;
  return Math.max(12, 16 - (Math.min(glyphCount, 40) - 28) / 3);
}

function planPendingAttachments(
  owner: string,
  requestId: string,
  attachments: readonly ChatAttachment[],
): HostedTurnPendingAttachment[] {
  if (!attachments.length) return [];
  const directory = new ExpoDirectory(
    Paths.document,
    'hermes-outbox',
    attachmentOutboxOwnerComponent(owner),
    safeOutboxPathComponent(requestId),
  );
  return attachments.map((attachment, index) => ({
    encryption: ATTACHMENT_ENCRYPTION_FORMAT,
    id: uniqueTurnId(`upload-${index}`),
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    name: attachment.name,
    ownedTemporary: attachment.ownedTemporary,
    size: attachment.size,
    sourceUri: attachment.uri,
    uri: new ExpoFile(
      directory,
      `${index}-${safeOutboxPathComponent(attachment.name)}.hermes-encrypted`,
    ).uri,
  }));
}

async function persistPendingAttachments(
  owner: string,
  requestId: string,
  attachments: readonly HostedTurnPendingAttachment[],
): Promise<HostedTurnPendingAttachment[]> {
  if (!attachments.length) return [];
  const directory = new ExpoDirectory(
    Paths.document,
    'hermes-outbox',
    attachmentOutboxOwnerComponent(owner),
    safeOutboxPathComponent(requestId),
  );
  directory.create({ idempotent: true, intermediates: true });
  const installedTargets = new Set<string>();
  return withAttachmentPersistenceRollback(async () => {
    const persisted: HostedTurnPendingAttachment[] = [];
    for (const attachment of attachments) {
      const targetUri = attachment.encryption === ATTACHMENT_ENCRYPTION_FORMAT
        ? attachment.uri
        : encryptedAttachmentUri(attachment.uri);
      const target = new ExpoFile(targetUri);
      const legacyPlaintext = attachment.encryption ? null : new ExpoFile(attachment.uri);
      const sourceUri = legacyPlaintext?.exists
          ? legacyPlaintext.uri
          : attachment.sourceUri?.trim();
      if (!target.exists) {
        if (!sourceUri) throw new Error(`Attachment source is unavailable: ${attachment.name}`);
        await HermesIOSContext.encryptAttachment(owner, sourceUri, targetUri);
        installedTargets.add(targetUri);
      }
      persisted.push({
        ...attachment,
        encryption: ATTACHMENT_ENCRYPTION_FORMAT,
        sourceUri: sourceUri || '',
        uri: targetUri,
      });
    }
    return persisted;
  }, () => {
    for (const uri of installedTargets) {
      const file = new ExpoFile(uri);
      if (file.exists) file.delete();
    }
  });
}

function cleanupPendingAttachments(item: HostedTurnOutboxItem): void {
  const root = new ExpoDirectory(Paths.document, 'hermes-outbox');
  const rootUri = root.uri.endsWith('/') ? root.uri : `${root.uri}/`;
  cleanupOwnedTemporaryAttachments(
    (item.pendingAttachments || []).flatMap((attachment) => (
      attachment.sourceUri
        ? [{ ownedTemporary: attachment.ownedTemporary, uri: attachment.sourceUri }]
        : []
    )),
    Paths.cache.uri,
    (uri) => {
      const source = new ExpoFile(uri);
      if (source.exists) source.delete();
    },
  );
  for (const attachment of item.pendingAttachments || []) {
    if (!attachment.uri.startsWith(rootUri)) continue;
    const file = new ExpoFile(attachment.uri);
    if (file.exists) file.delete();
  }
  const firstTarget = item.pendingAttachments?.find(({ uri }) => uri.startsWith(rootUri));
  if (firstTarget) {
    const requestDirectoryUri = firstTarget.uri.slice(0, firstTarget.uri.lastIndexOf('/') + 1);
    const requestDirectory = new ExpoDirectory(requestDirectoryUri);
    if (requestDirectory.exists) requestDirectory.delete();
  }
}

function hydrateOutboxInput(item: HostedTurnOutboxItem): HostedTurnOutboxItem {
  const uploaded = (item.pendingAttachments || []).flatMap((attachment) => (
    attachment.uploaded ? [attachment.uploaded] : []
  ));
  return {
    ...item,
    input: {
      ...item.input,
      attachmentContext: attachmentContext(uploaded),
      attachmentIds: uploaded.flatMap((attachment) => (
        typeof attachment.id === 'string' ? [attachment.id] : []
      )),
      message: {
        ...item.input.message,
        meta: {
          ...(isRecord(item.input.message.meta) ? item.input.message.meta : {}),
          attachments: uploaded,
        },
      },
    },
  };
}

function safeOutboxPathComponent(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+|\.+$/g, '');
  return safe.slice(0, 120) || 'pending';
}

function pendingChatSendFromOutbox(
  item: HostedTurnOutboxItem,
  owner: string,
): PendingChatSend {
  const source = item.input.message;
  const createdAt = typeof source.created_at === 'number' ? source.created_at : item.queuedAt;
  const userMessage: ChatMessage = {
    avatarRole: 'user',
    content: source.content,
    createdAt,
    durationMs: 0,
    id: source.id,
    name: source.name || 'You',
    role: 'user',
    status: source.status || 'completed',
    updatedAt: typeof source.updated_at === 'number' ? source.updated_at : createdAt,
  };
  return {
    conversationId: item.conversationId,
    key: hostedTurnDeliveryClaimKey(owner, source.id),
    queuedItem: item,
    userMessage,
  };
}

function chatMessageToCollaborationMessage(message: ChatMessage): CollaborationMessage {
  return {
    completed_at: message.completedAt,
    content: message.content,
    created_at: message.createdAt,
    id: message.id,
    meta: {
      client_optimistic: true,
      ...(message.optimisticConfirmedAt
        ? { optimistic_confirmed_at: message.optimisticConfirmedAt }
        : {}),
      ...(message.roleStage ? { role_stage: message.roleStage } : {}),
      ...(message.runtimeTurnId ? { runtime_turn_id: message.runtimeTurnId } : {}),
    },
    model: message.model,
    name: message.name,
    profile: message.profile,
    provider: message.provider,
    role: message.role,
    role_label: message.roleLabel,
    sender_id: message.senderId,
    sender_role: message.avatarRole,
    started_at: message.startedAt,
    status: message.status,
    updated_at: message.updatedAt,
  };
}

function sameOptimisticMessages(
  left: readonly ChatMessage[],
  right: readonly ChatMessage[],
): boolean {
  return left.length === right.length && left.every((message, index) => {
    const other = right[index];
    return Boolean(other)
      && message.id === other.id
      && message.content === other.content
      && message.status === other.status
      && message.optimisticConfirmedAt === other.optimisticConfirmedAt
      && message.updatedAt === other.updatedAt;
  });
}

function optimisticConversationTitle(
  messages: readonly CollaborationMessage[],
  chinese: boolean,
): string {
  const firstUserContent = messages.find(({ role }) => role === 'user')?.content?.trim();
  return firstUserContent?.slice(0, 36) || (chinese ? '新对话' : 'New conversation');
}

function numericTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function mergeOptimisticConversationSummaries(
  conversations: readonly SingleConversation[],
  ledgers: readonly OptimisticConversationLedgerItem[],
  profile: string,
  chinese: boolean,
): SingleConversation[] {
  const existingIds = new Set(conversations.map(({ id }) => id));
  const optimisticOnly = ledgers.flatMap((entry) => {
    if (existingIds.has(entry.conversationId) || !entry.messages.length) return [];
    const createdAt = Math.min(
      ...entry.messages.map((message) => numericTimestamp(message.created_at) || entry.updatedAt),
    );
    return [{
      created_at: createdAt,
      id: entry.conversationId,
      message_count: entry.messages.length,
      messages: entry.messages.map((message) => ({
        ...message,
        ...(message.meta ? { meta: { ...message.meta } } : {}),
      })),
      profile,
      title: optimisticConversationTitle(entry.messages, chinese),
      updated_at: entry.updatedAt,
    } as SingleConversation];
  });
  return [...conversations, ...optimisticOnly].sort(
    (left, right) => (right.updated_at || 0) - (left.updated_at || 0),
  );
}

function uniqueTurnId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  const random = uuid || [0, 1, 2, 3]
    .map(() => Math.random().toString(36).slice(2, 12))
    .join('');
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function stableStringHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function resolveConversationId(
  requestedId: string,
  conversations: readonly SingleConversation[],
): string {
  if (!requestedId) return conversations[0]?.id || '';
  if (conversations.some(({ id }) => id === requestedId)) return requestedId;
  if (requestedId.startsWith('official:')) {
    const placeholder = parseOfficialConversationPlaceholderId(requestedId);
    const sessionId = placeholder?.sessionId || requestedId.slice('official:'.length);
    const adopted = conversations.find((conversation) => (
      (
        conversation.official_session_id === sessionId
        && (
          !placeholder?.profile
          || (conversation.official_profile || conversation.profile) === placeholder.profile
        )
      )
      || (
        placeholder?.profile
          ? conversation.runtime_sessions?.[placeholder.profile] === sessionId
          : Object.values(conversation.runtime_sessions || {}).includes(sessionId)
      )
    ));
    if (adopted) return adopted.id;
  }
  return conversations[0]?.id || '';
}

function isConversationNotFoundError(error: unknown): boolean {
  return isRecord(error)
    && (error.status === 404 || error.statusCode === 404);
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!values.length) return [];
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, worker),
  );
  return results;
}

function serverFailure(error: unknown, chinese: boolean): string {
  if (error instanceof HermesApiError) {
    if (error.status === 401 || error.status === 403) {
      return chinese
        ? `HTTP ${error.status}：Hermes 登录状态已失效，请重新登录。`
        : `HTTP ${error.status}: Your Hermes session has expired. Sign in again.`;
    }
    if (error.status === 429) {
      return chinese
        ? 'HTTP 429：服务器请求过于频繁，请稍后重试。'
        : 'HTTP 429: The server is receiving too many requests. Try again shortly.';
    }
    if (error.status >= 500) {
      return chinese
        ? `HTTP ${error.status}：Hermes 服务暂时不可用，请稍后重试。`
        : `HTTP ${error.status}: Hermes is temporarily unavailable. Try again shortly.`;
    }
  }
  if (error instanceof Error && error.message) {
    return chinese ? `服务器操作失败：${error.message}` : `Server operation failed: ${error.message}`;
  }
  return chinese ? '服务器操作失败，请稍后重试。' : 'Server operation failed. Try again.';
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'status' in error
    && (error as { status?: unknown }).status === 404;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ConversationHistory({
  activeId,
  conversations,
  isChinese,
  onNew,
  onSelect,
}: {
  activeId: string;
  conversations: SingleConversation[];
  isChinese: boolean;
  onNew(): void;
  onSelect(id: string): void;
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.history, { backgroundColor: tokens.colors.card, borderRightColor: tokens.colors.border }]}>
      <View style={styles.historyBrand}>
        <View style={styles.roomIcon}><Text style={styles.roomIconText}>H</Text></View>
        <View>
          <Text style={[styles.historyTitle, { color: tokens.colors.foreground }]}>{isChinese ? '智能会话' : 'Conversations'}</Text>
          <Text style={[styles.historyKicker, { color: tokens.colors.textTertiary }]}>HERMES CLOUD</Text>
        </View>
      </View>
      <IOSPressable onPress={onNew} style={[styles.newChat, { backgroundColor: '#192320' }]}>
        <Text style={styles.newChatText}>{isChinese ? '＋ 新建会话' : '+ New conversation'}</Text>
      </IOSPressable>
      <Text style={[styles.historyLabel, { color: tokens.colors.textTertiary }]}>{isChinese ? '最近会话' : 'Recent conversations'}</Text>
      {conversations.map((conversation) => (
        <IOSPressable
          key={conversation.id}
          onPress={() => onSelect(conversation.id)}
          style={[
            styles.historyItem,
            activeId === conversation.id && { backgroundColor: tokens.colors.accent },
          ]}
        >
          <Text numberOfLines={1} style={[styles.historyItemTitle, { color: tokens.colors.foreground }]}>
            {conversation.title || (isChinese ? '新对话' : 'New conversation')}
          </Text>
          <Text style={[styles.historyItemMeta, { color: tokens.colors.textSecondary }]}>
            {conversation.message_count ?? conversation.messages?.length ?? 0} {isChinese ? '条记录' : 'messages'}
          </Text>
        </IOSPressable>
      ))}
    </View>
  );
}

function UnifiedMessage({
  index,
  isChinese,
  message,
  onBranch,
  onOpenAttachment,
  onInspectActivity,
}: {
  index: number;
  isChinese: boolean;
  message: ChatMessage;
  onBranch(message: ChatMessage): void;
  onOpenAttachment(attachment: StoredChatAttachment, share?: boolean): void;
  onInspectActivity(): void;
}) {
  const { tokens } = useTheme();
  const isUser = message.role === 'user';
  const metadataTimestamp = isUser
    ? message.createdAt
    : message.completedAt || message.updatedAt || message.createdAt;
  const timestamp = formatMessageLocalTime(
    metadataTimestamp,
    isChinese,
  );
  const status = !isUser || message.status === 'failed'
    ? messageStatusLabel(message.status, isChinese)
    : '';
  const metadata = [timestamp, status].filter(Boolean).join(' · ');
  const runtime = [
    message.model,
    message.handoffTarget
      ? isChinese
        ? `交接给 ${message.handoffTarget}`
        : `Handoff to ${message.handoffTarget}`
      : '',
  ].filter(Boolean).join(' · ');
  const messageForeground = tokens.colors.foreground;
  const markdownStyles = createMessageMarkdownStyles(
    messageForeground,
    tokens.colors.primary,
    multiplyAlpha(tokens.colors.foreground, 0.055),
    tokens.colors.border,
  );
  const metadataNode = metadata ? (
    <Text numberOfLines={1} style={[styles.messageTime, { color: tokens.colors.textTertiary }]}>
      {metadata}
    </Text>
  ) : null;
  const messageBody = (
    <View
      style={[
        styles.messageBody,
        isUser ? styles.userMessageBody : styles.agentMessageBody,
        {
          backgroundColor: tokens.colors.card,
          borderColor: multiplyAlpha('#192320', 0.11),
        },
      ]}
    >
      <Markdown style={markdownStyles}>{message.content || ' '}</Markdown>
      {message.attachments?.length ? (
        <View style={styles.storedAttachments}>
          {message.attachments.map((attachment) => (
            <IOSContextMenu
              accessibilityLabel={`Open attachment ${attachment.name}`}
              actions={[
                {
                  id: 'preview',
                  onPress: () => onOpenAttachment(attachment),
                  systemImage: 'doc.text.magnifyingglass',
                  title: isChinese ? '快速查看' : 'Quick Look',
                },
                {
                  id: 'share',
                  onPress: () => onOpenAttachment(attachment, true),
                  systemImage: 'square.and.arrow.up',
                  title: isChinese ? '分享' : 'Share',
                },
              ]}
              key={attachment.id}
              onPress={() => onOpenAttachment(attachment)}
              style={styles.storedAttachment}
            >
              <File color={tokens.colors.primary} size={18} strokeWidth={1.7} />
              <View style={styles.storedAttachmentCopy}>
                <Text
                  numberOfLines={1}
                  style={[styles.storedAttachmentName, { color: messageForeground }]}
                >
                  {attachment.name}
                </Text>
                <Text style={[styles.storedAttachmentSize, { color: tokens.colors.textSecondary }]}>
                  {formatAttachmentSize(attachment.size)}
                </Text>
              </View>
            </IOSContextMenu>
          ))}
        </View>
      ) : null}
    </View>
  );
  const canBranch = Boolean(message.runtimeSessionId && message.runtimeMessageId);
  return (
    <Reanimated.View
      entering={FadeInUp
        .delay(Math.min(index, 8) * 35)
        .duration(IOS_MOTION.duration.content)
        .easing(IOS_DECELERATE_EASING)}
      layout={LinearTransition
        .duration(IOS_MOTION.duration.control)
        .easing(IOS_STANDARD_EASING)}
      style={[
        styles.messageEnvelope,
        isUser ? styles.userMessageEnvelope : styles.agentMessageEnvelope,
      ]}
    >
      {!isUser && shouldShowMessageTiming(message) ? (
        <RoleActivityGroup
          isChinese={isChinese}
          message={message}
          onInspectActivity={onInspectActivity}
        />
      ) : null}
      {isUser || message.content.trim() || message.attachments?.length ? (
        <View style={[styles.messageRow, isUser && styles.userMessageRow]}>
        <MessageAvatar isUser={isUser} message={message} />
        <View style={[styles.messageStack, isUser && styles.userMessageStack]}>
          <View style={[styles.messageMeta, isUser && styles.userMessageMeta]}>
            {isUser ? metadataNode : null}
            <View style={[styles.senderMeta, isUser && styles.userSenderMeta]}>
              <Text numberOfLines={1} style={[styles.messageName, { color: tokens.colors.textSecondary }]}>{message.name}</Text>
              {!isUser && message.roleStage !== 'chat' ? (
                <Text numberOfLines={1} style={[styles.roleLabel, { color: tokens.colors.textTertiary }]}>{message.roleLabel}</Text>
              ) : null}
            </View>
            {!isUser ? metadataNode : null}
          </View>
          {!isUser && runtime ? (
            <Text numberOfLines={2} style={[styles.runtimeModel, { color: tokens.colors.textTertiary }]}>
              {runtime}
            </Text>
          ) : null}
          {canBranch ? (
            <IOSContextMenu
              accessibilityLabel={isChinese ? '会话消息操作' : 'Conversation message actions'}
              actions={[
                {
                  id: 'branch',
                  onPress: () => onBranch(message),
                  systemImage: 'arrow.triangle.branch',
                  title: isChinese ? '从这里分支' : 'Branch from here',
                },
              ]}
            >
              {messageBody}
            </IOSContextMenu>
          ) : messageBody}
        </View>
        </View>
      ) : null}
    </Reanimated.View>
  );
}

function MessageAvatar({
  isUser,
  message,
}: {
  isUser: boolean;
  message: ChatMessage;
}) {
  const { tokens } = useTheme();
  const avatarRole = message.avatarRole || (isUser ? 'user' : 'hermes');
  const officialHermes = ['dispatcher', 'hermes', 'reporter'].includes(avatarRole);
  const remoteAvatar = message.avatarUrl && /^(?:data:|file:|https?:)/.test(message.avatarUrl);
  const symbols: Partial<Record<NonNullable<ChatMessage['avatarRole']>, string>> = {
    'dbb3-worker': 'server.rack',
    'pc-worker': 'desktopcomputer',
    reviewer: 'checkmark.shield.fill',
  };
  const fallbacks: Partial<Record<NonNullable<ChatMessage['avatarRole']>, string>> = {
    'dbb3-worker': 'D',
    'pc-worker': 'P',
    reviewer: 'R',
  };
  const backgrounds: Partial<Record<NonNullable<ChatMessage['avatarRole']>, string>> = {
    'dbb3-worker': '#2F6B62',
    'pc-worker': '#426A8C',
    reviewer: '#8A5B24',
    user: '#FFFFFF',
  };
  const symbol = message.avatarSymbol || symbols[avatarRole];
  const fallback = fallbacks[avatarRole] || 'H';
  const backgroundColor = backgrounds[avatarRole] || '#192320';
  const badgeSymbol = avatarRole === 'dispatcher'
    ? 'arrow.triangle.branch'
    : avatarRole === 'reporter'
      ? 'checkmark.seal.fill'
      : '';
  return (
    <View
      style={[
        styles.messageAvatar,
        { backgroundColor, borderColor: multiplyAlpha('#192320', 0.12) },
      ]}
    >
      {isUser ? (
        <Text style={styles.userAvatarText}>{'你'}</Text>
      ) : officialHermes ? (
        <Image
          defaultSource={HERMES_AVATAR}
          resizeMode="contain"
          source={HERMES_AVATAR}
          style={styles.avatarImage}
        />
      ) : remoteAvatar ? (
        <Image resizeMode="cover" source={{ uri: message.avatarUrl }} style={styles.avatarImage} />
      ) : (
        <SymbolView
          fallback={<Text style={styles.roleAvatarFallback}>{fallback}</Text>}
          name={symbol as never}
          size={17}
          tintColor="#FFFFFF"
          type="hierarchical"
          weight="semibold"
        />
      )}
      {badgeSymbol ? (
        <View style={[styles.roleAvatarBadge, { borderColor: tokens.colors.background }]}>
          <SymbolView
            fallback={<Text style={styles.roleAvatarBadgeFallback}>{avatarRole === 'dispatcher' ? 'D' : 'R'}</Text>}
            name={badgeSymbol as never}
            size={8}
            tintColor="#FFFFFF"
            weight="bold"
          />
        </View>
      ) : null}
    </View>
  );
}

function PendingMessage({
  index,
  isChinese,
  onInspectActivity,
  phase,
  reconnectAttempt,
  startedAt,
}: {
  index: number;
  isChinese: boolean;
  onInspectActivity(): void;
  phase: PendingPhase;
  reconnectAttempt: number;
  startedAt: number;
}) {
  const { tokens } = useTheme();
  const statusText = phase === 'reconnecting'
    ? (isChinese
        ? `正在重连 (${reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS})`
        : `Reconnecting (${reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS})`)
    : phase === 'executing'
      ? (isChinese ? '正在执行' : 'The model is running')
      : (isChinese ? '正在思考' : 'Thinking');
  const pendingMessage: ChatMessage = {
    activities: [{
      category: 'other',
      duration: '',
      id: 'pending-status',
      name: isChinese ? '运行状态' : 'Runtime status',
      output: statusText,
      preview: statusText,
      startedAt,
      status: 'running',
    }],
    avatarRole: 'hermes',
    content: '',
    id: 'pending-turn-status',
    name: 'Hermes Agent',
    role: 'assistant',
    roleStage: 'chat',
    startedAt,
    status: 'running',
    timingLabel: statusText,
  };
  return (
    <Reanimated.View
      entering={FadeInUp
        .delay(index * 35)
        .duration(IOS_MOTION.duration.content)
        .easing(IOS_DECELERATE_EASING)}
      style={[styles.messageEnvelope, styles.agentMessageEnvelope]}
    >
      <RoleActivityGroup
        isChinese={isChinese}
        message={pendingMessage}
        onInspectActivity={onInspectActivity}
      />
      <View style={[styles.message, styles.agentMessage]}>
        <View style={[styles.messageAvatar, styles.hermesAvatar]}>
          <Image
            defaultSource={HERMES_AVATAR}
            resizeMode="contain"
            source={HERMES_AVATAR}
            style={styles.avatarImage}
          />
        </View>
        <View style={styles.messageStack}>
          <View style={styles.messageMeta}>
            <Text style={[styles.messageName, { color: tokens.colors.textSecondary }]}>Hermes Agent</Text>
          </View>
          <View style={[styles.messageBody, styles.agentMessageBody, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
            <View style={styles.pendingDots}>
              {[0, 1, 2].map((dot) => <PendingDot delay={dot * 120} key={dot} />)}
            </View>
          </View>
        </View>
      </View>
    </Reanimated.View>
  );
}

function PendingDot({ delay }: { delay: number }) {
  const scale = useSharedValue(0.7);
  useEffect(() => {
    cancelAnimation(scale);
    scale.value = withRepeat(
      withSequence(
        withTiming(0.7, {
          duration: delay,
          easing: IOS_STANDARD_EASING,
        }),
        withTiming(1, {
          duration: IOS_MOTION.duration.control,
          easing: IOS_DECELERATE_EASING,
        }),
        withTiming(0.7, {
          duration: IOS_MOTION.duration.drawer,
          easing: IOS_STANDARD_EASING,
        }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(scale);
  }, [delay, scale]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Reanimated.View style={[styles.pendingDot, animatedStyle]} />;
}

function RoleActivityGroup({
  isChinese,
  message,
  onInspectActivity,
}: {
  isChinese: boolean;
  message: ChatMessage;
  onInspectActivity(): void;
}) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const activities = message.activities || [];
  const running = messageIsRunning(message);
  useEffect(() => {
    if (!running) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [running]);
  const summary = (
    <>
      <Text numberOfLines={1} style={[styles.activityTitle, { color: tokens.colors.textSecondary }]}>
        {formatActivitySummary(message, isChinese, now)}
      </Text>
      {activities.length ? (
        <AnimatedChevron
          color={tokens.colors.textSecondary}
          open={open}
          size={14}
        />
      ) : null}
    </>
  );
  return (
    <View style={styles.activityGroup}>
      {activities.length ? (
        <IOSPressable
          accessibilityLabel={formatActivitySummary(message, isChinese, now)}
          haptic="selection"
          onPress={() => {
            onInspectActivity();
            setOpen((current) => !current);
          }}
          style={styles.activitySummary}
        >
          {summary}
        </IOSPressable>
      ) : (
        <View style={styles.activitySummary}>{summary}</View>
      )}
      {open ? (
        <Reanimated.View
          entering={FadeIn
            .duration(IOS_MOTION.duration.control)
            .easing(IOS_DECELERATE_EASING)}
          exiting={FadeOut
            .duration(IOS_MOTION.duration.press)
            .easing(IOS_STANDARD_EASING)}
          style={styles.activityTimeline}
        >
          {activities.map((activity) => (
            <ActivityCard
              activity={activity}
              isChinese={isChinese}
              key={activity.id}
              onInspectActivity={onInspectActivity}
            />
          ))}
        </Reanimated.View>
      ) : null}
      <View style={[styles.activityDivider, { backgroundColor: tokens.colors.border }]} />
    </View>
  );
}

function shouldShowMessageTiming(message: ChatMessage): boolean {
  return messageHasExecutionTiming(message);
}

function ActivityCard({
  activity,
  isChinese,
  onInspectActivity,
}: {
  activity: ChatActivity;
  isChinese: boolean;
  onInspectActivity(): void;
}) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const label = activityCategoryLabel(activity.category, isChinese);
  const statusColor = activity.status === 'failed'
    ? tokens.colors.destructive
    : activity.status === 'running' || activity.status === 'queued'
      ? '#D28B22'
      : '#20A879';
  const detailContent = activityDisplayContent(activity);
  return (
    <View style={[styles.activityCard, { backgroundColor: multiplyAlpha(tokens.colors.card, 0.62), borderColor: tokens.colors.border }]}>
      <IOSPressable
        haptic="selection"
        onPress={() => {
          onInspectActivity();
          setOpen((current) => !current);
        }}
        style={styles.activityCardSummary}
      >
        <View style={[styles.activityStatusSmall, { backgroundColor: statusColor }]} />
        <Text style={styles.activityKind}>{label}</Text>
        <Text numberOfLines={1} style={[styles.activityName, { color: tokens.colors.foreground }]}>{activity.name}</Text>
        <Text style={[styles.activityDuration, { color: tokens.colors.textTertiary }]}>{activity.duration}</Text>
        <AnimatedChevron color={tokens.colors.textSecondary} open={open} size={12} />
      </IOSPressable>
      {open ? (
        <Reanimated.View
          entering={FadeIn
            .duration(IOS_MOTION.duration.control)
            .easing(IOS_DECELERATE_EASING)}
          exiting={FadeOut
            .duration(IOS_MOTION.duration.press)
            .easing(IOS_STANDARD_EASING)}
          style={styles.activityDetail}
        >
          {detailContent ? <ActivityDetail value={detailContent} /> : null}
        </Reanimated.View>
      ) : null}
    </View>
  );
}

function ActivityDetail({ value }: { value: string }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.activityDetailSection}>
      <ScrollView
        nestedScrollEnabled
        scrollEventThrottle={8}
        style={[
          styles.activityCodeScroll,
          { backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.05) },
        ]}
      >
        <Text style={[styles.activityCode, { color: tokens.colors.foreground }]}>{value}</Text>
      </ScrollView>
    </View>
  );
}

function createMessageMarkdownStyles(
  foreground: string,
  accent: string,
  codeBackground: string,
  border: string,
): Record<string, object> {
  return {
    body: {
      color: foreground,
      fontFamily: BODY_REGULAR,
      fontSize: 14,
      letterSpacing: 0,
      lineHeight: 22,
      margin: 0,
      padding: 0,
    },
    blockquote: {
      borderLeftColor: accent,
      borderLeftWidth: 3,
      marginBottom: 8,
      marginTop: 2,
      paddingLeft: 9,
    },
    bullet_list: { marginBottom: 7, marginTop: 1 },
    code_block: {
      backgroundColor: codeBackground,
      borderColor: border,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      color: foreground,
      fontFamily: MONO_REGULAR,
      fontSize: 11.5,
      lineHeight: 17,
      marginBottom: 9,
      padding: 9,
    },
    code_inline: {
      backgroundColor: codeBackground,
      borderRadius: 4,
      color: foreground,
      fontFamily: MONO_REGULAR,
      fontSize: 12,
      paddingHorizontal: 4,
      paddingVertical: 1,
    },
    fence: {
      backgroundColor: codeBackground,
      borderColor: border,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      color: foreground,
      fontFamily: MONO_REGULAR,
      fontSize: 11.5,
      lineHeight: 17,
      marginBottom: 9,
      padding: 9,
    },
    heading1: { color: foreground, fontFamily: BODY_BOLD, fontSize: 18, lineHeight: 25, marginBottom: 6, marginTop: 2 },
    heading2: { color: foreground, fontFamily: BODY_BOLD, fontSize: 16, lineHeight: 23, marginBottom: 5, marginTop: 5 },
    heading3: { color: foreground, fontFamily: BODY_SEMIBOLD, fontSize: 14.5, lineHeight: 21, marginBottom: 4, marginTop: 4 },
    link: { color: accent, textDecorationLine: 'none' },
    list_item: { marginBottom: 2 },
    ordered_list: { marginBottom: 7, marginTop: 1 },
    paragraph: { marginBottom: 8, marginTop: 0 },
    table: { borderColor: border, borderWidth: StyleSheet.hairlineWidth, marginBottom: 9 },
    td: { borderColor: border, borderWidth: StyleSheet.hairlineWidth, padding: 6 },
    th: { borderColor: border, borderWidth: StyleSheet.hairlineWidth, fontFamily: BODY_SEMIBOLD, padding: 6 },
  };
}

function AnimatedChevron({
  color,
  open,
  size,
}: {
  color: string;
  open: boolean;
  size: number;
}) {
  const rotation = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    rotation.value = withTiming(open ? 1 : 0, {
      duration: IOS_MOTION.duration.control,
      easing: IOS_STANDARD_EASING,
    });
  }, [open, rotation]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 180}deg` }],
  }));
  return (
    <Reanimated.View style={animatedStyle}>
      <ChevronDown color={color} size={size} />
    </Reanimated.View>
  );
}

function LiveDot({ busy }: { busy: boolean }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(pulse);
    pulse.value = busy
      ? withRepeat(withSequence(
          withTiming(1.28, {
            duration: 700,
            easing: IOS_STANDARD_EASING,
          }),
          withTiming(1, {
            duration: 700,
            easing: IOS_STANDARD_EASING,
          }),
        ), -1)
      : withTiming(1, {
          duration: IOS_MOTION.duration.press,
          easing: IOS_STANDARD_EASING,
        });
    return () => cancelAnimation(pulse);
  }, [busy, pulse]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return <Reanimated.View style={[styles.liveDot, animatedStyle]} />;
}

function ModelToolsDrawer({
  isChinese,
  onClose,
  onNewConversation,
  open,
}: {
  isChinese: boolean;
  onClose(): void;
  onNewConversation(): void;
  open: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const [mounted, setMounted] = useState(open);
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState('claude-sonnet-4');
  const [reasoning, setReasoning] = useState<'low' | 'medium' | 'high'>('medium');
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const translateX = useSharedValue(256);
  const openModelPicker = () => {
    const models = ['claude-sonnet-4', 'gpt-5.6-sol'] as const;
    if (Platform.OS !== 'ios') {
      setModelOpen((current) => !current);
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: models.length,
        options: [...models, isChinese ? '取消' : 'Cancel'],
        title: isChinese ? '选择模型' : 'Choose Model',
      },
      (index) => {
        const next = models[index];
        if (next) setModel(next);
      },
    );
  };

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => {
        translateX.value = withSpring(0, {
          damping: IOS_MOTION.spring.damping,
          mass: IOS_MOTION.spring.mass,
          overshootClamping: true,
          stiffness: IOS_MOTION.spring.stiffness,
        });
      });
    } else if (mounted) {
      translateX.value = withSpring(256, {
        damping: IOS_MOTION.spring.damping,
        mass: IOS_MOTION.spring.mass,
        overshootClamping: true,
        stiffness: IOS_MOTION.spring.stiffness,
      }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [mounted, open, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [0, 256],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  if (Platform.OS === 'ios' && hasNativeSwiftUIModelTools) {
    return (
      <Modal
        animationType="none"
        onRequestClose={onClose}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={open}
      >
        <HermesSwiftUIModelToolsView
          {...resolveSwiftUIThemeProps(tokens)}
          locale={isChinese ? 'zh' : 'en'}
          model={model}
          onModelChange={(event) => setModel(event.nativeEvent.model)}
          onNewConversation={onNewConversation}
          onReasoningChange={(event) => {
            const next = event.nativeEvent.reasoning;
            if (next === 'low' || next === 'medium' || next === 'high') {
              setReasoning(next);
            }
          }}
          onRequestClose={onClose}
          onToolsChange={(event) => setToolsEnabled(event.nativeEvent.enabled)}
          open={open}
          reasoning={reasoning}
          style={styles.drawerRoot}
          toolsEnabled={toolsEnabled}
        />
      </Modal>
    );
  }

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <View style={styles.drawerRoot}>
        <Reanimated.View
          style={[StyleSheet.absoluteFill, styles.drawerBackdrop, backdropStyle]}
        >
          <IOSPressable haptic="none" onPress={onClose} opacityTo={1} scaleTo={1} style={StyleSheet.absoluteFill} />
        </Reanimated.View>
        <Reanimated.View
          style={[
            styles.drawer,
            {
              backgroundColor: 'transparent',
              borderLeftColor: tokens.colors.border,
              paddingBottom: insets.bottom,
              paddingTop: insets.top,
            },
            animatedStyle,
          ]}
        >
          <View style={[styles.drawerHeader, { borderBottomColor: tokens.colors.border }]}>
            <Text style={[styles.drawerTitle, { color: tokens.colors.foreground }]}>
              {isChinese ? '模型\n与工具' : 'MODEL\n& TOOLS'}
            </Text>
            <IOSPressable accessibilityLabel="Close" onPress={onClose} scaleTo={0.9} style={styles.drawerClose}>
              <X color={tokens.colors.textSecondary} size={18} />
            </IOSPressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.drawerContent}
            decelerationRate="normal"
            scrollEventThrottle={8}
            showsVerticalScrollIndicator={false}
          >
            <NativeButton
              onPress={() => {
                onNewConversation();
                onClose();
              }}
              outlined
              style={styles.drawerNewChat}
            >
              {isChinese ? '新建对话' : 'New chat'}
            </NativeButton>
            <View style={[styles.drawerCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
              <View style={styles.drawerCardRow}>
                <View style={styles.drawerCardCopy}>
                  <Text style={[styles.drawerLabel, { color: tokens.colors.textTertiary }]}>{isChinese ? '模型' : 'MODEL'}</Text>
                  <IOSPressable haptic="selection" onPress={openModelPicker} style={styles.modelPicker}>
                    <Text numberOfLines={1} style={[styles.modelName, { color: tokens.colors.foreground }]}>{model}</Text>
                    <AnimatedChevron color={tokens.colors.textSecondary} open={modelOpen} size={14} />
                  </IOSPressable>
                </View>
                <PreviewBadge tone="success">{isChinese ? '在线' : 'LIVE'}</PreviewBadge>
              </View>
              {Platform.OS !== 'ios' && modelOpen ? (
                <Reanimated.View
                  entering={FadeIn
                    .duration(IOS_MOTION.duration.control)
                    .easing(IOS_DECELERATE_EASING)}
                  style={[styles.modelOptions, { borderTopColor: tokens.colors.border }]}
                >
                  {['claude-sonnet-4', 'gpt-5.6-sol'].map((option) => (
                    <IOSPressable
                      haptic="selection"
                      key={option}
                      onPress={() => {
                        setModel(option);
                        setModelOpen(false);
                      }}
                      style={styles.modelOption}
                    >
                      <Text style={[styles.modelOptionText, { color: tokens.colors.foreground }]}>{option}</Text>
                      {model === option ? <Check color={tokens.colors.success} size={14} /> : null}
                    </IOSPressable>
                  ))}
                </Reanimated.View>
              ) : null}
            </View>
            <View style={[styles.drawerCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
              <View style={styles.drawerCardRow}>
                <View style={styles.drawerCardCopy}>
                  <Text style={[styles.drawerLabel, { color: tokens.colors.textTertiary }]}>{isChinese ? '工具事件流' : 'TOOL EVENTS'}</Text>
                  <Text numberOfLines={1} style={[styles.drawerDetail, { color: tokens.colors.textSecondary }]}>
                    {isChinese ? '等待下一次工具调用' : 'Waiting for the next tool call'}
                  </Text>
                </View>
                <PreviewBadge tone="success">{isChinese ? '在线' : 'LIVE'}</PreviewBadge>
              </View>
            </View>
            <View style={[styles.reasoningCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
              <Text style={[styles.reasoningTitle, { color: tokens.colors.foreground }]}>{isChinese ? '推理强度' : 'Reasoning effort'}</Text>
              <View style={[styles.reasoningBody, { borderTopColor: tokens.colors.border }]}>
                <PreviewSegmented<'low' | 'medium' | 'high'>
                  onChange={setReasoning}
                  options={[
                    { label: isChinese ? '低' : 'Low', value: 'low' },
                    { label: isChinese ? '中' : 'Medium', value: 'medium' },
                    { label: isChinese ? '高' : 'High', value: 'high' },
                  ]}
                  value={reasoning}
                />
              </View>
            </View>
          </ScrollView>
        </Reanimated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, overflow: 'hidden' },
  chat: { flex: 1, flexDirection: 'row', minHeight: 0 },
  main: { flex: 1, minHeight: 0, overflow: 'hidden' },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 5, justifyContent: 'space-between', paddingBottom: 7 },
  heading: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 9, minWidth: 112 },
  headingCompact: { gap: 4, minWidth: 116 },
  navToggle: { alignItems: 'center', borderRadius: 8, borderWidth: 1, height: 28, justifyContent: 'center', width: 28 },
  headerAvatar: { alignItems: 'center', backgroundColor: '#192320', borderRadius: 11, height: 34, justifyContent: 'center', overflow: 'hidden', width: 34 },
  headerAvatarCompact: { borderRadius: 9, height: 28, width: 28 },
  avatarImage: { borderRadius: 8, height: '100%', width: '100%' },
  headingCopy: { flex: 1, minWidth: 0 },
  headingTitle: { fontFamily: DISPLAY_BOLD, fontSize: 15, lineHeight: 19 },
  headingTitleCompact: { fontSize: 12, lineHeight: 16 },
  headingSubtitle: { fontFamily: BODY_REGULAR, fontSize: 10, lineHeight: 14 },
  headerControls: { alignItems: 'center', flexDirection: 'row', gap: 4, justifyContent: 'flex-end' },
  gatewayStatuses: { gap: 2, justifyContent: 'center', width: 94 },
  gatewayStatusRow: { alignItems: 'center', flexDirection: 'row', gap: 4, height: 13, width: 94 },
  gatewayStatusDot: { borderRadius: 3, height: 6, width: 6 },
  gatewayStatusLabel: { flexShrink: 0, fontFamily: MONO_REGULAR, fontSize: 7.5, lineHeight: 10, width: 36 },
  gatewayStatusVersion: { flexShrink: 0, fontFamily: MONO_REGULAR, fontSize: 7.5, lineHeight: 10, textAlign: 'left', width: 42 },
  modelTools: { alignItems: 'center', borderRadius: 8, borderWidth: 1, height: 32, justifyContent: 'center', paddingHorizontal: 7 },
  modelToolsText: { fontFamily: BODY_BOLD, fontSize: 9, lineHeight: 12 },
  liveDot: { backgroundColor: '#20a879', borderRadius: 4, height: 8, marginHorizontal: 5, width: 8 },
  stream: { flex: 1, minHeight: 0 },
  streamContent: { flexGrow: 1, gap: 13, paddingTop: 15 },
  emptyStream: { alignItems: 'center', justifyContent: 'center' },
  welcome: { alignItems: 'center', maxWidth: 480, paddingHorizontal: 24 },
  welcomeOrb: { alignItems: 'center', borderRadius: 18, height: 58, justifyContent: 'center', marginBottom: 16, width: 58 },
  welcomeOrbText: { color: '#ffffff', fontFamily: DISPLAY_BOLD, fontSize: 25 },
  welcomeTitle: { fontFamily: DISPLAY_BOLD, fontSize: 21, lineHeight: 29, textAlign: 'center' },
  welcomeBody: { fontFamily: BODY_REGULAR, fontSize: 13, lineHeight: 21, marginTop: 7, textAlign: 'center' },
  message: { alignItems: 'flex-start', flexDirection: 'row', gap: 9, maxWidth: '96%' },
  agentMessage: { alignSelf: 'flex-start' },
  messageEnvelope: { maxWidth: 820 },
  agentMessageEnvelope: { alignSelf: 'flex-start', width: '96%' },
  userMessageEnvelope: { alignItems: 'flex-end', alignSelf: 'flex-end', maxWidth: '88%' },
  messageRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 9, maxWidth: '100%' },
  userMessageRow: { flexDirection: 'row-reverse' },
  messageAvatar: { alignItems: 'center', borderRadius: 9, borderWidth: 1, height: 30, justifyContent: 'center', overflow: 'visible', position: 'relative', width: 30 },
  hermesAvatar: { backgroundColor: '#192320' },
  userAvatarText: { color: '#0d7164', fontFamily: BODY_BOLD, fontSize: 9 },
  roleAvatarFallback: { color: '#FFFFFF', fontFamily: BODY_BOLD, fontSize: 11, lineHeight: 15 },
  roleAvatarBadge: { alignItems: 'center', backgroundColor: '#0D7164', borderRadius: 7, borderWidth: 1.5, bottom: -4, height: 14, justifyContent: 'center', position: 'absolute', right: -4, width: 14 },
  roleAvatarBadgeFallback: { color: '#FFFFFF', fontFamily: BODY_BOLD, fontSize: 6, lineHeight: 8 },
  messageStack: { alignItems: 'flex-start', flexShrink: 1, maxWidth: '88%', minWidth: 0 },
  userMessageStack: { alignItems: 'flex-end', maxWidth: '82%' },
  messageMeta: { alignItems: 'center', flexDirection: 'row', gap: 5, marginBottom: 3, marginHorizontal: 3, minHeight: 16 },
  userMessageMeta: { alignSelf: 'flex-end' },
  senderMeta: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 5 },
  userSenderMeta: { flexShrink: 0 },
  messageName: { flexShrink: 1, fontFamily: BODY_BOLD, fontSize: 11, lineHeight: 15 },
  roleLabel: { flexShrink: 1, fontFamily: BODY_SEMIBOLD, fontSize: 9, lineHeight: 13 },
  messageTime: { flexShrink: 0, fontFamily: BODY_REGULAR, fontSize: 8.5, lineHeight: 12 },
  runtimeModel: { fontFamily: MONO_REGULAR, fontSize: 8.5, lineHeight: 12, marginBottom: 4, marginHorizontal: 3, maxWidth: '100%' },
  messageBody: { borderRadius: 8, borderWidth: 1, maxWidth: '100%', minWidth: 38, overflow: 'hidden', paddingHorizontal: 11, paddingTop: 9 },
  agentMessageBody: { borderTopLeftRadius: 3 },
  userMessageBody: { borderTopRightRadius: 3 },
  pendingDots: { alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: 16 },
  pendingDot: { backgroundColor: '#0d7164', borderRadius: 3, height: 5, width: 5 },
  activityGroup: { maxWidth: 720, width: '100%' },
  activitySummary: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 27, paddingHorizontal: 2, paddingVertical: 4 },
  activityTitle: { flexShrink: 1, fontFamily: BODY_REGULAR, fontSize: 11, lineHeight: 15 },
  activityDivider: { height: StyleSheet.hairlineWidth, marginBottom: 7, marginTop: 6, width: '100%' },
  activityTimeline: { gap: 6, paddingBottom: 2, paddingHorizontal: 2 },
  activityCard: { borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  activityCardSummary: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 30, paddingHorizontal: 8, paddingVertical: 6 },
  activityStatusSmall: { borderRadius: 3, height: 7, width: 7 },
  activityKind: { backgroundColor: 'rgba(13,113,100,0.10)', borderRadius: 4, color: '#0d7164', fontFamily: BODY_BOLD, fontSize: 8, overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 2 },
  activityName: { flex: 1, fontFamily: BODY_SEMIBOLD, fontSize: 9 },
  activityDuration: { fontFamily: MONO_REGULAR, fontSize: 8 },
  activityDetail: { gap: 7, paddingBottom: 8, paddingHorizontal: 8, paddingLeft: 22 },
  activityDetailSection: { gap: 3 },
  activityCodeScroll: { borderRadius: 5, maxHeight: 260 },
  activityCode: { fontFamily: MONO_REGULAR, fontSize: 9, lineHeight: 13, padding: 7 },
  composer: { paddingTop: 7 },
  attachmentStrip: { alignSelf: 'center', marginBottom: 8, maxHeight: 76, maxWidth: 920, width: '100%' },
  attachmentStripContent: { gap: 10, paddingHorizontal: 7, paddingTop: 7 },
  attachmentItem: { borderRadius: 13, height: 64, position: 'relative' },
  attachmentSurface: { borderRadius: 13, borderWidth: StyleSheet.hairlineWidth },
  attachmentImageItem: { overflow: 'visible', width: 64 },
  attachmentFileItem: { width: 224 },
  attachmentImagePreview: { borderRadius: 12, height: 62, overflow: 'hidden', width: 62 },
  attachmentThumbnail: { height: '100%', width: '100%' },
  attachmentFilePreview: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 10, paddingHorizontal: 10, paddingRight: 30 },
  attachmentFileIcon: { alignItems: 'center', height: 40, justifyContent: 'center', width: 36 },
  attachmentFileCopy: { flex: 1, minWidth: 0 },
  attachmentName: { fontFamily: BODY_MEDIUM, fontSize: 13, lineHeight: 17 },
  attachmentSize: { fontFamily: BODY_REGULAR, fontSize: 11, lineHeight: 15, marginTop: 2 },
  attachmentRemove: { alignItems: 'center', height: 30, justifyContent: 'center', position: 'absolute', right: -8, top: -8, width: 30, zIndex: 3 },
  attachmentRemoveFallback: { alignItems: 'center', backgroundColor: '#636366', borderRadius: 11, height: 22, justifyContent: 'center', width: 22 },
  storedAttachments: { gap: 6, marginTop: 10 },
  storedAttachment: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 38 },
  storedAttachmentCopy: { flex: 1, minWidth: 0 },
  storedAttachmentName: { fontFamily: BODY_MEDIUM, fontSize: 12, lineHeight: 16 },
  storedAttachmentSize: { fontFamily: BODY_REGULAR, fontSize: 10, lineHeight: 13 },
  inputShell: { alignItems: 'flex-end', alignSelf: 'center', borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 4, maxWidth: 920, overflow: 'hidden', paddingBottom: 5, paddingLeft: 5, paddingRight: 5, paddingTop: 5, position: 'relative', width: '100%' },
  composerFrostedBackground: { zIndex: 0 },
  composerFrostedTint: { zIndex: 0 },
  attachButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 34, zIndex: 1 },
  attachGlyph: { fontFamily: BODY_REGULAR, fontSize: 24, lineHeight: 30 },
  input: { flex: 1, fontFamily: BODY_REGULAR, fontSize: 16, letterSpacing: 0, lineHeight: 23, maxHeight: 120, minHeight: 38, paddingBottom: 5, paddingHorizontal: 0, paddingTop: 8, textAlignVertical: 'top', zIndex: 1 },
  send: { alignItems: 'center', borderRadius: 11, height: 38, justifyContent: 'center', width: 38, zIndex: 1 },
  sendGlyph: { fontFamily: BODY_SEMIBOLD, fontSize: 19, lineHeight: 23 },
  history: { borderRightWidth: 1, gap: 9, minWidth: 220, paddingHorizontal: 12, paddingVertical: 14, width: 260 },
  historyBrand: { alignItems: 'center', flexDirection: 'row', gap: 11, paddingBottom: 4, paddingHorizontal: 4, paddingTop: 3 },
  roomIcon: { alignItems: 'center', backgroundColor: '#192320', borderRadius: 11, height: 38, justifyContent: 'center', width: 38 },
  roomIconText: { color: '#ffffff', fontFamily: DISPLAY_BOLD, fontSize: 16 },
  historyTitle: { fontFamily: DISPLAY_BOLD, fontSize: 14 },
  historyKicker: { fontFamily: MONO_REGULAR, fontSize: 8, letterSpacing: 1.1 },
  newChat: { alignItems: 'center', borderRadius: 10, minHeight: 38, justifyContent: 'center', paddingHorizontal: 12 },
  newChatText: { color: '#ffffff', fontFamily: BODY_SEMIBOLD, fontSize: 12 },
  historyLabel: { fontFamily: MONO_REGULAR, fontSize: 9, letterSpacing: 1.2, marginTop: 3 },
  historyItem: { borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9 },
  historyItemTitle: { fontFamily: BODY_SEMIBOLD, fontSize: 11 },
  historyItemMeta: { fontFamily: BODY_REGULAR, fontSize: 9, marginTop: 3 },
  drawerRoot: { flex: 1 },
  drawerBackdrop: { backgroundColor: 'rgba(0,0,0,0.60)', right: 256 },
  drawer: { borderLeftWidth: 1, bottom: 0, overflow: 'hidden', position: 'absolute', right: 0, top: 0, width: 256 },
  drawerHeader: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: 20 },
  drawerTitle: { fontFamily: WEBUI_FONT_FAMILIES.MondwestRegular, fontSize: 18, letterSpacing: 0.84, lineHeight: 17 },
  drawerClose: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  drawerContent: { gap: 12, paddingBottom: 12, paddingHorizontal: 4, paddingTop: 8 },
  drawerNewChat: { alignSelf: 'stretch', justifyContent: 'flex-start', marginHorizontal: 0 },
  drawerCard: { borderRadius: 8, borderWidth: 1, marginHorizontal: 0, overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 10 },
  drawerCardRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  drawerCardCopy: { flex: 1, minWidth: 0 },
  drawerLabel: { fontFamily: WEBUI_FONT_FAMILIES.RulesExpandedRegular, fontSize: 10, letterSpacing: 1.1, lineHeight: 14 },
  drawerDetail: { fontFamily: BODY_REGULAR, fontSize: 10, lineHeight: 14, marginTop: 2 },
  modelPicker: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 2 },
  modelName: { flex: 1, fontFamily: BODY_MEDIUM, fontSize: 13, lineHeight: 18 },
  modelOptions: { borderTopWidth: 1, marginTop: 8, paddingTop: 5 },
  modelOption: { alignItems: 'center', flexDirection: 'row', minHeight: 34, paddingHorizontal: 2 },
  modelOptionText: { flex: 1, fontFamily: BODY_REGULAR, fontSize: 11 },
  reasoningCard: { borderRadius: 8, borderWidth: 1, marginHorizontal: 0, overflow: 'hidden' },
  reasoningTitle: { fontFamily: DISPLAY_BOLD, fontSize: 14, lineHeight: 20, padding: 12 },
  reasoningBody: { borderTopWidth: 1, padding: 12 },
});
