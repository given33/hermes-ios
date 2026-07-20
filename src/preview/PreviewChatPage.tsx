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
import { HermesLiveBlurView } from '../../modules/hermes-live-blur';
import { presentQuickLook } from '../../modules/hermes-quick-look';
import { WEBUI_FONT_FAMILIES } from '../app/webui-fonts';
import { HermesApiError, type HermesApiClient } from '../api/HermesApiClient';
import { withDeadline } from '../api/async-deadline';
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
  isCompleteConversation,
  mergeDownloadedConversations,
  reconcileConversationCache,
  upsertCachedConversation,
} from '../api/conversation-local-store';
import {
  activityCategoryLabel,
  activityDisplayContent,
  attachmentContext,
  chatModelConfigurationError,
  conversationHasRunningWork,
  conversationHostedTurnState,
  conversationMessagesToView,
  conversationRunningHostedTurnId,
  formatActivitySummary,
  formatMessageLocalTime,
  hostedTurnVisibilityFailure,
  messageStatusLabel,
  messageIsRunning,
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

const HERMES_AVATAR = require('../../assets/icon.png');
const BODY_REGULAR = 'HermesGoogle-IBMPlexSans-400-Normal';
const BODY_MEDIUM = 'HermesGoogle-IBMPlexSans-500-Normal';
const BODY_SEMIBOLD = 'HermesGoogle-IBMPlexSans-600-Normal';
const BODY_BOLD = 'HermesGoogle-IBMPlexSans-700-Normal';
const DISPLAY_BOLD = 'SpaceGrotesk_700Bold';
const MONO_REGULAR = 'HermesTerminal-JetBrainsMono-400-Normal';
const IOS_STANDARD_EASING = Easing.bezier(...IOS_MOTION.curve.standard);
const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);
const MODEL_CONFIGURATION_TIMEOUT_MS = 12_000;
const HOSTED_TURN_VISIBILITY_GRACE_MS = 20_000;

interface ChatAttachment {
  id: string;
  kind: 'file' | 'image';
  mimeType?: string | null;
  name: string;
  size?: number | null;
  uri: string;
}

interface HostedTurnDelivery {
  item: HostedTurnOutboxItem;
  response: HostedTurnEnqueueResponse;
}

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
  const optimisticHostedTurnDeadlineRef = useRef(0);
  const optimisticHostedTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostedTurnVisibilityFailuresRef = useRef(
    new Map<string, HostedTurnVisibilityFailure[]>(),
  );
  const cancelHostedTurnInFlightRef = useRef(false);
  const conversationIndexRef = useRef<SingleConversation[]>([]);
  const conversationSyncGenerationRef = useRef(0);
  const hydratedCacheOwnerRef = useRef('');
  const cacheWriteRef = useRef<Promise<void>>(Promise.resolve());
  const pendingAttachmentCleanup = useRef<(() => void) | null>(null);
  const pendingNavigationCleanup = useRef<(() => void) | null>(null);
  const pendingSendFrame = useRef<number | null>(null);
  const pendingScrollFrame = useRef<number | null>(null);
  const autoFollowStreamRef = useRef(true);
  const outboxReplayRef = useRef<Promise<void> | null>(null);
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
  const canCancelHostedTurn = hostedRunning && Boolean(activeConversationId);
  const pendingStartedAt = [...messages].reverse().find(({ role }) => role === 'user')
    ?.createdAt || Date.now();
  const inputFontSize = resolveComposerFontSize(content);
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

  const clearOptimisticHostedTurn = useCallback(() => {
    optimisticHostedTurnIdRef.current = '';
    optimisticHostedTurnDeadlineRef.current = 0;
    if (optimisticHostedTurnTimeoutRef.current) {
      clearTimeout(optimisticHostedTurnTimeoutRef.current);
      optimisticHostedTurnTimeoutRef.current = null;
    }
  }, []);

  const beginOptimisticHostedTurn = useCallback((conversationId: string, turnId: string) => {
    clearOptimisticHostedTurn();
    optimisticHostedTurnIdRef.current = turnId;
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
      setMessages((current) => upsertChatMessage(current, failure.message));
      setHostedRunning(false);
      setSending(false);
    }, HOSTED_TURN_VISIBILITY_GRACE_MS);
  }, [clearOptimisticHostedTurn, isChinese]);
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

  const applyConversation = useCallback((conversation: SingleConversation) => {
    activeConversationIdRef.current = conversation.id;
    setActiveConversationId(conversation.id);
    let nextMessages = conversationMessagesToView(conversation, isChinese);
    let running = conversationHasRunningWork(conversation);
    let runningHostedTurnId = conversationRunningHostedTurnId(conversation);
    const optimisticTurnId = optimisticHostedTurnIdRef.current;
    if (optimisticTurnId) {
      const optimisticState = conversationHostedTurnState(conversation, optimisticTurnId);
      if (optimisticState === 'terminal') {
        clearOptimisticHostedTurn();
      } else if (optimisticState === 'running') {
        clearOptimisticHostedTurn();
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
    setMessages(nextMessages);
    activeHostedTurnIdRef.current = runningHostedTurnId;
    setActiveHostedTurnId(runningHostedTurnId);
    setHostedRunning(running);
    setSending(running);
    commitConversationIndex(
      upsertCachedConversation(conversationIndexRef.current, conversation),
      conversation.id,
    );
  }, [clearOptimisticHostedTurn, commitConversationIndex, isChinese]);

  const loadConversation = useCallback(async (
    conversationId: string,
    expectedGeneration = 0,
  ) => {
    if (!cloudApi || !conversationId) return null;
    const result = await cloudApi.getConversation(conversationId);
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
    if (!item.conversationId) {
      item = {
        ...item,
        conversationId: `chat_${safeOutboxPathComponent(item.input.requestId).slice(0, 251)}`,
        conversationPending: true,
      };
      await localStore.upsertPendingEnqueue(cacheOwner, item);
    }
    if (item.conversationPending) {
      await cloudApi.createConversation(
        item.conversationProfile || profile,
        item.conversationTitle || (isChinese ? '新对话' : 'New conversation'),
        item.conversationId,
      );
      item = { ...item, conversationPending: false };
      await localStore.upsertPendingEnqueue(cacheOwner, item);
    }
    const pendingAttachments = [...(item.pendingAttachments || [])];
    for (let index = 0; index < pendingAttachments.length; index += 1) {
      const attachment = pendingAttachments[index];
      if (attachment.uploaded) continue;
      const result = await cloudApi.uploadConversationAttachment(
        item.conversationId,
        {
          mimeType: attachment.mimeType,
          name: attachment.name,
          uri: attachment.uri,
        },
        {
          messageId: item.input.message.id,
          profile: item.conversationProfile || profile,
          turnId: item.input.turnId,
          uploadId: attachment.id,
        },
      );
      if (!isRecord(result.attachment)) {
        throw new Error('Attachment upload was not persisted');
      }
      pendingAttachments[index] = {
        ...attachment,
        uploaded: result.attachment,
      };
      item = hydrateOutboxInput({ ...item, pendingAttachments });
      await localStore.upsertPendingEnqueue(cacheOwner, item);
    }
    item = hydrateOutboxInput({ ...item, pendingAttachments });
    await localStore.upsertPendingEnqueue(cacheOwner, item);
    const response = await cloudApi.enqueueHostedTurn(item.conversationId, item.input);
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
        await localStore.upsertPendingEnqueue(cacheOwner, replacement);
      }
      return deliverPendingEnqueueOnce(replacement);
    }
  }, [cacheOwner, deliverPendingEnqueueOnce, localStore]);

  const replayPendingEnqueues = useCallback(async () => {
    if (!cloudApi || !localStore || !cacheOwner) return;
    if (outboxReplayRef.current) return outboxReplayRef.current;
    const replay = (async () => {
      const pending = await localStore.readPendingEnqueues(cacheOwner);
      for (const pendingItem of pending.sort((left, right) => left.queuedAt - right.queuedAt)) {
        try {
          const { item, response } = await deliverPendingEnqueue(pendingItem);
          await localStore.removePendingEnqueue(cacheOwner, item.input.requestId);
          cleanupPendingAttachments(item);
          if (!activeConversationIdRef.current) {
            activeConversationIdRef.current = item.conversationId;
            setActiveConversationId(item.conversationId);
          }
          if (activeConversationIdRef.current === item.conversationId) {
            if (response.accepted) {
              activeHostedTurnIdRef.current = item.input.turnId;
              beginOptimisticHostedTurn(item.conversationId, item.input.turnId);
              setActiveHostedTurnId(item.input.turnId);
              setHostedRunning(true);
              setSending(true);
            } else {
              activeHostedTurnIdRef.current = '';
              clearOptimisticHostedTurn();
              setActiveHostedTurnId('');
              setHostedRunning(false);
              setSending(false);
            }
            const generation = ++conversationSyncGenerationRef.current;
            await loadConversation(item.conversationId, generation);
          }
        } catch {
          // Preserve FIFO ordering; the same idempotency key is retried on the next foreground pass.
          break;
        }
      }
    })();
    outboxReplayRef.current = replay;
    try {
      await replay;
    } finally {
      if (outboxReplayRef.current === replay) outboxReplayRef.current = null;
    }
  }, [
    beginOptimisticHostedTurn,
    cacheOwner,
    clearOptimisticHostedTurn,
    cloudApi,
    deliverPendingEnqueue,
    loadConversation,
    localStore,
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

  const loadConversationIndex = useCallback(async (preferredId = '') => {
    if (!cloudApi) return;
    const syncGeneration = ++conversationSyncGenerationRef.current;
    let localConversations = conversationIndexRef.current;
    let rememberedId = activeConversationIdRef.current;
    if (localStore && cacheOwner && hydratedCacheOwnerRef.current !== cacheOwner) {
      const cached = await localStore.read(cacheOwner);
      if (syncGeneration !== conversationSyncGenerationRef.current) return;
      hydratedCacheOwnerRef.current = cacheOwner;
      if (cached) {
        localConversations = cached.conversations;
        rememberedId = cached.activeConversationId;
        conversationIndexRef.current = localConversations;
        setConversations(localConversations);
        const immediateId = resolveConversationId(
          preferredId || rememberedId || localConversations[0]?.id || '',
          localConversations,
        );
        const immediate = localConversations.find(({ id }) => id === immediateId);
        if (immediate && isCompleteConversation(immediate)) applyConversation(immediate);
      }
    }
    const result = await cloudApi.getUnifiedConversations(profile);
    if (syncGeneration !== conversationSyncGenerationRef.current) return;
    const reconciliation = reconcileConversationCache(
      localConversations,
      result.conversations,
    );
    const requestedActiveId = resolveConversationId(
      preferredId
        || activeConversationIdRef.current
        || rememberedId
        || reconciliation.conversations[0]?.id
        || '',
      reconciliation.conversations,
    );
    const missingIds = new Set<string>();
    const downloaded = await mapWithConcurrency(
      reconciliation.downloadIds.filter((id) => id === requestedActiveId),
      1,
      async (id) => {
        try {
          return (await cloudApi.getConversation(id)).conversation;
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
    const synchronized = mergeDownloadedConversations(
      reconciliation.conversations.filter(({ id }) => !missingIds.has(id)),
      downloaded.filter((conversation): conversation is SingleConversation => conversation !== null),
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
      setMessages([]);
      setHostedRunning(false);
      setSending(false);
      return;
    }
    await openConversation(activeId, syncGeneration);
  }, [
    applyConversation,
    cacheOwner,
    clearOptimisticHostedTurn,
    cloudApi,
    commitConversationIndex,
    localStore,
    openConversation,
    profile,
  ]);

  useEffect(() => {
    if (!cloudApi) return undefined;
    let disposed = false;
    const requestedConversationId = preferredConversationId || notificationTarget?.conversationId;
    void replayPendingEnqueues()
      .catch(() => undefined)
      .then(() => loadConversationIndex(requestedConversationId))
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
        .then(() => loadConversationIndex(activeConversationIdRef.current))
        .catch((error) => {
          if (!disposed) notify(serverFailure(error, isChinese));
        });
    });
    const indexTimer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      void replayPendingEnqueues()
        .catch(() => undefined)
        .then(() => loadConversationIndex(activeConversationIdRef.current))
        .catch(() => {});
    }, 15_000);
    return () => {
      disposed = true;
      appState.remove();
      clearInterval(indexTimer);
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
    const interval = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      const generation = ++conversationSyncGenerationRef.current;
      void loadConversation(activeConversationId, generation).catch(() => {});
    }, 1_000);
    return () => clearInterval(interval);
  }, [activeConversationId, cloudApi, hostedRunning, loadConversation]);

  useEffect(() => () => {
    clearOptimisticHostedTurn();
    if (pendingScrollFrame.current !== null) {
      cancelAnimationFrame(pendingScrollFrame.current);
    }
    if (pendingSendFrame.current !== null) {
      cancelAnimationFrame(pendingSendFrame.current);
    }
    pendingAttachmentCleanup.current?.();
    pendingNavigationCleanup.current?.();
  }, [clearOptimisticHostedTurn]);

  const createConversation = async () => {
    autoFollowStreamRef.current = true;
    clearOptimisticHostedTurn();
    if (cloudApi) {
      try {
        const result = await cloudApi.createConversation(profile, isChinese ? '新对话' : 'New conversation');
        applyConversation(result.conversation);
      } catch (error) {
        notify(serverFailure(error, isChinese));
      }
      return;
    }
    setMessages([]);
    contentRef.current = '';
    setContent('');
    setAttachments([]);
    notify(isChinese ? '已新建会话' : 'New conversation created');
  };

  const send = async () => {
    const currentContent = contentRef.current;
    const trimmed = currentContent.trim();
    if ((!trimmed && attachmentCount === 0) || sending) return;
    const pendingAttachments = [...attachments];
    const sendingConversationId = activeConversationIdRef.current;
    if (sendingConversationId) {
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
    const userMessageCreatedAt = Date.now();
    const userMessageId = uniqueTurnId('user');
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
    autoFollowStreamRef.current = true;
    setMessages((current) => [...current, userMessage]);
    let composerCleared = false;
    const clearQueuedComposer = () => {
      if (composerCleared) return;
      composerCleared = true;
      contentRef.current = '';
      setContent('');
      setAttachments([]);
    };
    clearQueuedComposer();
    setSending(true);
    const configurationErrorId = `model-configuration-${activeConversationIdRef.current || 'new'}`;
    if (cloudApi && client) {
      try {
        const modelConfiguration = await withDeadline(
          cloudApi.getModels(conversationProfile),
          MODEL_CONFIGURATION_TIMEOUT_MS,
          isChinese
            ? '模型配置检查超时，请检查网络后重试。'
            : 'The model configuration check timed out. Check the network and try again.',
        );
        const configurationError = chatModelConfigurationError(
          modelConfiguration,
          isChinese,
        );
        if (configurationError) {
          const failedAt = Date.now();
          setMessages((current) => upsertChatMessage(current, {
            avatarRole: 'hermes',
            content: configurationError,
            createdAt: failedAt,
            durationMs: 0,
            id: configurationErrorId,
            name: 'Hermes Agent',
            role: 'assistant',
            roleLabel: isChinese ? '配置错误' : 'Configuration error',
            roleStage: 'chat',
            status: 'failed',
            updatedAt: failedAt,
          }));
          notify(configurationError);
          setSending(false);
          return;
        }
        setMessages((current) => current.filter(({ id }) => id !== configurationErrorId));
      } catch (error) {
        const failure = serverFailure(error, isChinese);
        const failedAt = Date.now();
        setMessages((current) => upsertChatMessage(current, {
          avatarRole: 'hermes',
          content: failure,
          createdAt: failedAt,
          durationMs: 0,
          id: configurationErrorId,
          name: 'Hermes Agent',
          role: 'assistant',
          roleLabel: isChinese ? '配置检查失败' : 'Configuration check failed',
          roleStage: 'chat',
          status: 'failed',
          updatedAt: failedAt,
        }));
        notify(failure);
        setSending(false);
        return;
      }
    }
    if (!cloudApi || !client) {
      const failedAt = Date.now();
      setMessages((current) => upsertChatMessage(current, {
        avatarRole: 'hermes',
        completedAt: failedAt,
        content: isChinese
          ? '当前没有可用的 Hermes 服务器连接，请重新登录后重试。'
          : 'No Hermes server connection is available. Sign in again and try again.',
        createdAt: failedAt,
        durationMs: 0,
        id: `connection-unavailable-${userMessageId}`,
        name: 'Hermes Agent',
        role: 'assistant',
        roleLabel: isChinese ? '连接错误' : 'Connection error',
        roleStage: 'chat',
        status: 'failed',
        updatedAt: failedAt,
      }));
      setSending(false);
      return;
    }

    let enqueueAcknowledged = false;
    let hostedAccepted = false;
    let enqueuePersisted = false;
    const hostedTurnId = uniqueTurnId('hosted');
    let queuedItem: HostedTurnOutboxItem | null = null;
    try {
      let conversationId = activeConversationIdRef.current
        || `chat_${safeOutboxPathComponent(userMessageId).slice(0, 251)}`;
      const conversationPending = !activeConversationIdRef.current;
      const durableAttachments = await persistPendingAttachments(
        userMessageId,
        pendingAttachments,
      );

      const uploaded: Record<string, unknown>[] = [];
      const filesContext = attachmentContext(uploaded);
      const serverUserMessage: CollaborationMessage = {
        content: userMessage.content,
        created_at: userMessageCreatedAt,
        id: userMessageId,
        kind: 'message',
        meta: { attachments: uploaded },
        name: isChinese ? '你' : 'You',
        role: 'user',
        sender_id: 'account-owner',
        sender_name: isChinese ? '你' : 'You',
        status: 'completed',
        updated_at: userMessageCreatedAt,
      };
      const enqueueInput: HostedTurnEnqueueInput = {
        attachmentContext: filesContext,
        attachmentIds: uploaded.flatMap((attachment) => (
          typeof attachment.id === 'string' ? [attachment.id] : []
        )),
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
      queuedItem = {
        conversationId,
        conversationPending,
        conversationProfile,
        conversationTitle: trimmed.slice(0, 36) || (isChinese ? '新对话' : 'New conversation'),
        input: enqueueInput,
        pendingAttachments: durableAttachments,
        queuedAt: userMessageCreatedAt,
      };
      if (localStore && cacheOwner) {
        await localStore.upsertPendingEnqueue(cacheOwner, queuedItem);
        enqueuePersisted = true;
        clearQueuedComposer();
        const delivery = await deliverPendingEnqueue(queuedItem);
        queuedItem = delivery.item;
        conversationId = queuedItem.conversationId;
        enqueueAcknowledged = true;
        hostedAccepted = delivery.response.accepted;
      } else {
        if (conversationPending) {
          await cloudApi.createConversation(
            conversationProfile,
            queuedItem.conversationTitle,
            conversationId,
          );
        }
        const fallbackAttachments = [...durableAttachments];
        for (let index = 0; index < fallbackAttachments.length; index += 1) {
          const attachment = fallbackAttachments[index];
          const result = await cloudApi.uploadConversationAttachment(
            conversationId,
            {
              mimeType: attachment.mimeType,
              name: attachment.name,
              uri: attachment.uri,
            },
            {
              messageId: userMessageId,
              profile: conversationProfile,
              turnId: hostedTurnId,
              uploadId: attachment.id,
            },
          );
          if (!isRecord(result.attachment)) {
            throw new Error('Attachment upload was not persisted');
          }
          fallbackAttachments[index] = { ...attachment, uploaded: result.attachment };
        }
        queuedItem = hydrateOutboxInput({
          ...queuedItem,
          conversationPending: false,
          pendingAttachments: fallbackAttachments,
        });
        const response = await cloudApi.enqueueHostedTurn(conversationId, queuedItem.input);
        enqueueAcknowledged = true;
        hostedAccepted = response.accepted;
      }
      clearQueuedComposer();
      if (enqueuePersisted && localStore && cacheOwner) {
        await localStore.removePendingEnqueue(cacheOwner, userMessageId).catch(() => undefined);
      }
      if (queuedItem) cleanupPendingAttachments(queuedItem);
      activeConversationIdRef.current = conversationId;
      setActiveConversationId(conversationId);
      if (activeConversationIdRef.current === conversationId) {
        if (hostedAccepted) {
          activeHostedTurnIdRef.current = hostedTurnId;
          beginOptimisticHostedTurn(conversationId, hostedTurnId);
          setActiveHostedTurnId(hostedTurnId);
          setHostedRunning(true);
        } else {
          activeHostedTurnIdRef.current = '';
          clearOptimisticHostedTurn();
          setActiveHostedTurnId('');
          setHostedRunning(false);
        }
        const generation = ++conversationSyncGenerationRef.current;
        await loadConversation(conversationId, generation);
      }
    } catch (error) {
      if (enqueuePersisted && !enqueueAcknowledged) {
        notify(isChinese
          ? '消息已保存在待发送队列，连接恢复后会自动继续。'
          : 'Message queued and will continue automatically when the connection returns.');
        void replayPendingEnqueues();
      } else if (!enqueueAcknowledged) {
        if (queuedItem) cleanupPendingAttachments(queuedItem);
        const failure = serverFailure(error, isChinese);
        notify(failure);
        const failedAt = Date.now();
        setMessages((current) => upsertChatMessage(current, {
          ...userMessage,
          status: 'failed',
          updatedAt: failedAt,
        }));
      } else {
        notify(serverFailure(error, isChinese));
      }
    } finally {
      if (!hostedAccepted) {
        setHostedRunning(false);
        setSending(false);
      }
    }
  };
  const requestSend = () => {
    if (pendingSendFrame.current !== null) {
      cancelAnimationFrame(pendingSendFrame.current);
    }
    pendingSendFrame.current = requestAnimationFrame(() => {
      pendingSendFrame.current = null;
      void send();
    });
  };

  const cancelActiveHostedTurn = async () => {
    const conversationId = activeConversationIdRef.current;
    if (!cloudApi || !conversationId || cancelHostedTurnInFlightRef.current) return;
    cancelHostedTurnInFlightRef.current = true;
    setCancellingHostedTurn(true);
    try {
      let turnId = activeHostedTurnIdRef.current;
      if (!turnId) {
        const refreshed = await cloudApi.getConversation(conversationId);
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
        }
        return;
      }
      await cloudApi.cancelHostedTurn(
        conversationId,
        turnId,
        isChinese ? '用户在 iOS 会话中取消任务' : 'Cancelled by the user in the iOS chat',
      );
      if (activeConversationIdRef.current === conversationId) {
        activeHostedTurnIdRef.current = '';
        clearOptimisticHostedTurn();
        setActiveHostedTurnId('');
        setHostedRunning(false);
        setSending(false);
        const generation = ++conversationSyncGenerationRef.current;
        await loadConversation(conversationId, generation);
      }
      notify(isChinese ? '已取消任务' : 'Task cancelled');
    } catch (error) {
      try {
        const refreshed = await cloudApi.getConversation(conversationId);
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
    autoFollowStreamRef.current = true;
    activeHostedTurnIdRef.current = '';
    clearOptimisticHostedTurn();
    setActiveHostedTurnId('');
    setCancellingHostedTurn(false);
    setSending(false);
    setHostedRunning(false);
    setContent('');
    contentRef.current = '';
    setAttachments([]);
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
      setAttachments((current) => [
        ...current,
        ...result.assets.map((asset, index): ChatAttachment => ({
          id: `image-${stamp}-${index}-${asset.assetId ?? asset.uri}`,
          kind: 'image',
          mimeType: asset.mimeType,
          name: asset.fileName ?? (isChinese ? `照片 ${current.length + index + 1}` : `Photo ${current.length + index + 1}`),
          size: asset.fileSize,
          uri: asset.uri,
        })),
      ]);
      setAttachmentsOpen(false);
    }
    keepLatestVisible(false);
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true });
    if (!result.canceled) {
      const stamp = Date.now();
      setAttachments((current) => [
        ...current,
        ...result.assets.map((asset, index): ChatAttachment => ({
          id: `file-${stamp}-${index}-${asset.uri}`,
          kind: asset.mimeType?.startsWith('image/') ? 'image' : 'file',
          mimeType: asset.mimeType,
          name: asset.name,
          size: asset.size,
          uri: asset.uri,
        })),
      ]);
      setAttachmentsOpen(false);
    }
    keepLatestVisible(false);
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
    setAttachments((current) => (
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
                <Image resizeMode="contain" source={HERMES_AVATAR} style={styles.avatarImage} />
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
            {messages.length === 0 ? (
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
            ) : messages.map((message, index) => (
              <UnifiedMessage
                index={index}
                isChinese={isChinese}
                key={message.id}
                message={message}
                onOpenAttachment={openStoredAttachment}
                onInspectActivity={pauseStreamAutoFollow}
              />
            ))}
            {shouldRenderPendingMessage(messages, hostedRunning)
              ? (
                  <PendingMessage
                    index={messages.length}
                    isChinese={isChinese}
                    onInspectActivity={pauseStreamAutoFollow}
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

function resolveComposerFontSize(value: string): number {
  const glyphCount = Array.from(value).length;
  if (glyphCount <= 28 || /\s/u.test(value)) return 16;
  return Math.max(12, 16 - (Math.min(glyphCount, 40) - 28) / 3);
}

async function persistPendingAttachments(
  requestId: string,
  attachments: readonly ChatAttachment[],
): Promise<HostedTurnPendingAttachment[]> {
  if (!attachments.length) return [];
  const directory = new ExpoDirectory(
    Paths.document,
    'hermes-outbox',
    safeOutboxPathComponent(requestId),
  );
  directory.create({ idempotent: true, intermediates: true });
  try {
    return attachments.map((attachment, index) => {
      const uploadId = uniqueTurnId(`upload-${index}`);
      const target = new ExpoFile(
        directory,
        `${index}-${safeOutboxPathComponent(attachment.name)}`,
      );
      if (target.exists) target.delete();
      new ExpoFile(attachment.uri).copy(target);
      return {
        id: uploadId,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        name: attachment.name,
        size: attachment.size,
        uri: target.uri,
      };
    });
  } catch (error) {
    if (directory.exists) directory.delete();
    throw error;
  }
}

function cleanupPendingAttachments(item: HostedTurnOutboxItem): void {
  const root = new ExpoDirectory(Paths.document, 'hermes-outbox');
  const rootUri = root.uri.endsWith('/') ? root.uri : `${root.uri}/`;
  for (const attachment of item.pendingAttachments || []) {
    if (!attachment.uri.startsWith(rootUri)) continue;
    const file = new ExpoFile(attachment.uri);
    if (file.exists) file.delete();
  }
  const directory = new ExpoDirectory(root, safeOutboxPathComponent(item.input.requestId));
  if (directory.exists) directory.delete();
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
        ? 'Hermes 登录状态已失效，请重新登录。'
        : 'Your Hermes session has expired. Sign in again.';
    }
    if (error.status === 429) {
      return chinese
        ? '服务器请求过于频繁，请稍后重试。'
        : 'The server is receiving too many requests. Try again shortly.';
    }
    if (error.status >= 500) {
      return chinese
        ? 'Hermes 服务暂时不可用，请稍后重试。'
        : 'Hermes is temporarily unavailable. Try again shortly.';
    }
  }
  if (error instanceof Error && error.message) {
    return chinese ? `服务器操作失败：${error.message}` : `Server operation failed: ${error.message}`;
  }
  return chinese ? '服务器操作失败，请稍后重试。' : 'Server operation failed. Try again.';
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
  onOpenAttachment,
  onInspectActivity,
}: {
  index: number;
  isChinese: boolean;
  message: ChatMessage;
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
                  accessibilityLabel={`打开附件 ${attachment.name}`}
                  actions={[
                    {
                      id: 'preview',
                      onPress: () => onOpenAttachment(attachment),
                      systemImage: 'doc.text.magnifyingglass',
                      title: '快速查看',
                    },
                    {
                      id: 'share',
                      onPress: () => onOpenAttachment(attachment, true),
                      systemImage: 'square.and.arrow.up',
                      title: '分享',
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
      ) : remoteAvatar ? (
        <Image resizeMode="cover" source={{ uri: message.avatarUrl }} style={styles.avatarImage} />
      ) : officialHermes ? (
        <Image resizeMode="contain" source={HERMES_AVATAR} style={styles.avatarImage} />
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
  startedAt,
}: {
  index: number;
  isChinese: boolean;
  onInspectActivity(): void;
  startedAt: number;
}) {
  const { tokens } = useTheme();
  const pendingMessage: ChatMessage = {
    activities: [{
      category: 'other',
      duration: '',
      id: `pending-status-${startedAt}`,
      name: isChinese ? '\u8fd0\u884c\u72b6\u6001' : 'Runtime status',
      output: isChinese ? '\u6a21\u578b\u6b63\u5728\u6267\u884c' : 'The model is running',
      preview: isChinese ? '\u6a21\u578b\u6b63\u5728\u6267\u884c' : 'The model is running',
      startedAt,
      status: 'running',
    }],
    avatarRole: 'hermes',
    content: '',
    id: `pending-${startedAt}`,
    name: 'Hermes Agent',
    role: 'assistant',
    roleStage: 'chat',
    startedAt,
    status: 'running',
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
          <Image resizeMode="contain" source={HERMES_AVATAR} style={styles.avatarImage} />
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
  return Boolean(
    message.startedAt
    || message.completedAt
    || message.updatedAt
    || message.durationMs
    || message.status,
  );
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
