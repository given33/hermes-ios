import * as DocumentPicker from 'expo-document-picker';
import { BlurView } from 'expo-blur';
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
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActionSheetIOS,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  HermesSwiftUIFrostedSurfaceView,
  HermesSwiftUIModelToolsView,
  hasNativeSwiftUIPartialFrontend,
} from '../../modules/hermes-ios-controls';
import { presentQuickLook } from '../../modules/hermes-quick-look';
import { WEBUI_FONT_FAMILIES } from '../app/webui-fonts';
import { NativeButton } from '../components/ui/NativeButton';
import { IOSContextMenu } from '../components/ios/IOSContextMenu';
import { IOSPressable } from '../components/ios/IOSPressable';
import { multiplyAlpha } from '../design/control-contracts';
import { resolveSwiftUIThemeProps } from '../design/swiftui-theme';
import { useTheme } from '../design/ThemeProvider';
import { IOS_MOTION } from '../design/ios-motion';
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

type ActivityStatus = 'completed' | 'running' | 'failed';

interface ChatActivity {
  id: string;
  category: 'command' | 'reasoning' | 'file';
  duration: string;
  input?: string;
  name: string;
  output?: string;
  preview: string;
  status: ActivityStatus;
}

interface ChatMessage {
  activities?: ChatActivity[];
  content: string;
  id: string;
  model?: string;
  name: string;
  role: 'assistant' | 'user';
  roleLabel?: string;
  roleStage?: 'chat' | 'worker';
}

interface ChatAttachment {
  id: string;
  kind: 'file' | 'image';
  mimeType?: string | null;
  name: string;
  size?: number | null;
  uri: string;
}

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    content: '帮我检查当前项目的状态。',
    id: 'user-1',
    name: '你',
    role: 'user',
  },
  {
    activities: [
      {
        category: 'command',
        duration: '0.4 s',
        id: 'activity-1',
        input: 'git status --short',
        name: 'git status --short',
        output: 'M src/preview/PreviewChatPage.tsx',
        preview: '检查工作区状态',
        status: 'completed',
      },
    ],
    content: '当前项目有未提交的前端修改，我会保留这些改动并继续处理单聊界面。',
    id: 'assistant-1',
    model: 'anthropic · claude-sonnet-4',
    name: 'Hermes Agent',
    role: 'assistant',
    roleLabel: 'Hermes Agent',
    roleStage: 'chat',
  },
];

interface ChatPreviewPageProps {
  locale?: 'en' | 'zh';
  notify(message: string): void;
  openNavigation?(): void;
}

export function ChatPreviewPage({
  locale = 'zh',
  notify,
  openNavigation,
}: ChatPreviewPageProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { tokens } = useTheme();
  const [content, setContent] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [sending, setSending] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const streamRef = useRef<ScrollView>(null);
  const composerInputRef = useRef<TextInput>(null);
  const contentRef = useRef('');
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAttachmentCleanup = useRef<(() => void) | null>(null);
  const pendingNavigationCleanup = useRef<(() => void) | null>(null);
  const pendingSendFrame = useRef<number | null>(null);
  const pendingScrollFrame = useRef<number | null>(null);
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
  const inputFontSize = resolveComposerFontSize(content);
  const keepLatestVisible = useCallback((animated = false) => {
    if (pendingScrollFrame.current !== null) return;
    pendingScrollFrame.current = requestAnimationFrame(() => {
      pendingScrollFrame.current = null;
      streamRef.current?.scrollToEnd({ animated });
    });
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

  useEffect(() => () => {
    if (replyTimer.current) clearTimeout(replyTimer.current);
    if (pendingScrollFrame.current !== null) {
      cancelAnimationFrame(pendingScrollFrame.current);
    }
    if (pendingSendFrame.current !== null) {
      cancelAnimationFrame(pendingSendFrame.current);
    }
    pendingAttachmentCleanup.current?.();
    pendingNavigationCleanup.current?.();
  }, []);

  const createConversation = () => {
    setMessages([]);
    contentRef.current = '';
    setContent('');
    setAttachments([]);
    notify(isChinese ? '已新建会话' : 'New conversation created');
  };

  const send = () => {
    const currentContent = contentRef.current;
    const trimmed = currentContent.trim();
    if ((!trimmed && attachmentCount === 0) || sending) return;
    const userMessage: ChatMessage = {
      content: trimmed || (isChinese ? `已添加 ${attachmentCount} 个附件` : `${attachmentCount} attachments`),
      id: `user-${Date.now()}`,
      name: isChinese ? '你' : 'You',
      role: 'user',
    };
    setMessages((current) => [...current, userMessage]);
    contentRef.current = '';
    setContent('');
    setAttachments([]);
    setSending(true);
    replyTimer.current = setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          content: isChinese
            ? '已收到。在后端迁移完成后，这里会持续显示 Hermes 的完整执行过程和结果。'
            : 'Received. The complete Hermes execution process and result will stream here after backend migration.',
          id: `assistant-${Date.now()}`,
          model: 'anthropic · claude-sonnet-4',
          name: 'Hermes Agent',
          role: 'assistant',
          roleLabel: 'Hermes Agent',
          roleStage: 'chat',
        },
      ]);
      setSending(false);
      replyTimer.current = null;
    }, 650);
  };
  const requestSend = () => {
    if (pendingSendFrame.current !== null) {
      cancelAnimationFrame(pendingSendFrame.current);
    }
    pendingSendFrame.current = requestAnimationFrame(() => {
      pendingSendFrame.current = null;
      send();
    });
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
            onSelect={() => notify(isChinese ? '已切换会话' : 'Conversation selected')}
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
              <UnifiedMessage index={index} key={message.id} message={message} />
            ))}
            {sending ? <PendingMessage index={messages.length} /> : null}
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
                accessibilityLabel={isChinese ? '发送消息' : 'Send message'}
                disabled={sending}
                haptic={canSend ? 'light' : 'none'}
                hitSlop={8}
                onPress={requestSend}
                opacityTo={0.78}
                pressRetentionOffset={12}
                scaleTo={0.91}
                style={[
                  styles.send,
                  {
                    backgroundColor: tokens.colors.primary,
                    opacity: canSend ? 1 : 0.38,
                  },
                ]}
              >
                <SymbolView
                  fallback={(
                    <Text style={[styles.sendGlyph, { color: tokens.colors.primaryForeground }]}>
                      {sending ? '…' : '↑'}
                    </Text>
                  )}
                  name={sending ? 'ellipsis' : 'arrow.up'}
                  size={sending ? 18 : 17}
                  tintColor={tokens.colors.primaryForeground}
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
  const nativeTheme = resolveSwiftUIThemeProps(tokens);
  const usesNativeFrostedSurface =
    Platform.OS === 'ios' && hasNativeSwiftUIPartialFrontend;
  const surfaceStyle = [
    styles.inputShell,
    {
      backgroundColor: 'transparent',
      borderColor: usesNativeFrostedSurface
        ? 'transparent'
        : tokens.colors.border,
      borderWidth: usesNativeFrostedSurface ? 0 : 1,
    },
  ];

  return (
    <View style={surfaceStyle}>
      {usesNativeFrostedSurface ? (
        <HermesSwiftUIFrostedSurfaceView
          colorScheme={nativeTheme.themeColorScheme}
          cornerRadius={15}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.composerFrostedBackground]}
          tintColor={tokens.colors.background}
        />
      ) : (
        <BlurView
          intensity={48}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.composerFrostedBackground]}
          tint={nativeTheme.themeColorScheme}
        />
      )}
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

function ConversationHistory({ onNew, onSelect }: { onNew(): void; onSelect(): void }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.history, { backgroundColor: tokens.colors.card, borderRightColor: tokens.colors.border }]}>
      <View style={styles.historyBrand}>
        <View style={styles.roomIcon}><Text style={styles.roomIconText}>H</Text></View>
        <View>
          <Text style={[styles.historyTitle, { color: tokens.colors.foreground }]}>{'智能会话'}</Text>
          <Text style={[styles.historyKicker, { color: tokens.colors.textTertiary }]}>DBB3 CONTROL PLANE</Text>
        </View>
      </View>
      <IOSPressable onPress={onNew} style={[styles.newChat, { backgroundColor: '#192320' }]}>
        <Text style={styles.newChatText}>{'＋ 新建会话'}</Text>
      </IOSPressable>
      <Text style={[styles.historyLabel, { color: tokens.colors.textTertiary }]}>{'最近会话'}</Text>
      <IOSPressable onPress={onSelect} style={[styles.historyItem, { backgroundColor: tokens.colors.accent }]}> 
        <Text numberOfLines={1} style={[styles.historyItemTitle, { color: tokens.colors.foreground }]}>{'检查当前项目状态'}</Text>
        <Text style={[styles.historyItemMeta, { color: tokens.colors.textSecondary }]}>2 {'条记录'}</Text>
      </IOSPressable>
    </View>
  );
}

function UnifiedMessage({ index, message }: { index: number; message: ChatMessage }) {
  const { tokens } = useTheme();
  const isUser = message.role === 'user';
  return (
    <Reanimated.View
      entering={FadeInUp
        .delay(Math.min(index, 8) * 35)
        .duration(IOS_MOTION.duration.content)
        .easing(IOS_DECELERATE_EASING)}
      layout={LinearTransition
        .duration(IOS_MOTION.duration.control)
        .easing(IOS_STANDARD_EASING)}
      style={[styles.message, isUser ? styles.userMessage : styles.agentMessage]}
    >
      <View
        style={[
          styles.messageAvatar,
          isUser ? styles.userAvatar : styles.hermesAvatar,
          { borderColor: multiplyAlpha('#192320', 0.1) },
        ]}
      >
        {isUser ? (
          <Text style={styles.userAvatarText}>{'你'}</Text>
        ) : (
          <Image resizeMode="contain" source={HERMES_AVATAR} style={styles.avatarImage} />
        )}
      </View>
      <View style={[styles.messageStack, isUser && styles.userMessageStack]}>
        <View style={[styles.messageMeta, isUser && styles.userMessageMeta]}>
          <Text style={[styles.messageName, { color: tokens.colors.textSecondary }]}>{message.name}</Text>
          {!isUser && message.roleStage !== 'chat' ? (
            <Text style={[styles.roleLabel, { color: tokens.colors.textTertiary }]}>{message.roleLabel}</Text>
          ) : null}
          {!isUser && message.model ? (
            <Text numberOfLines={1} style={[styles.runtimeModel, { color: tokens.colors.textTertiary }]}>{message.model}</Text>
          ) : null}
        </View>
        {message.activities?.length ? (
          <RoleActivityGroup activities={message.activities} roleLabel={message.roleLabel ?? message.name} />
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
          <Text style={[styles.messageText, { color: tokens.colors.foreground }]}>{message.content}</Text>
        </View>
      </View>
    </Reanimated.View>
  );
}

function PendingMessage({ index }: { index: number }) {
  const { tokens } = useTheme();
  return (
    <Reanimated.View
      entering={FadeInUp
        .delay(index * 35)
        .duration(IOS_MOTION.duration.content)
        .easing(IOS_DECELERATE_EASING)}
      style={[styles.message, styles.agentMessage]}
    >
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
  activities,
  roleLabel,
}: {
  activities: ChatActivity[];
  roleLabel: string;
}) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.activityGroup, { backgroundColor: multiplyAlpha(tokens.colors.card, 0.62), borderColor: tokens.colors.border }]}>
      <IOSPressable haptic="selection" onPress={() => setOpen((current) => !current)} style={styles.activitySummary}>
        <View style={styles.activityStatus} />
        <Text numberOfLines={1} style={[styles.activityTitle, { color: tokens.colors.foreground }]}>{`${roleLabel} · 详情`}</Text>
        <Text style={[styles.activityCount, { color: tokens.colors.textSecondary }]}>{`${activities.length} 条动态`}</Text>
        <AnimatedChevron
          color={tokens.colors.textSecondary}
          open={open}
          size={14}
        />
      </IOSPressable>
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
          {activities.map((activity) => <ActivityCard activity={activity} key={activity.id} />)}
        </Reanimated.View>
      ) : null}
    </View>
  );
}

function ActivityCard({ activity }: { activity: ChatActivity }) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const label = activity.category === 'command' ? '命令' : activity.category === 'file' ? '文件' : '思考';
  return (
    <View style={[styles.activityCard, { backgroundColor: multiplyAlpha(tokens.colors.card, 0.62), borderColor: tokens.colors.border }]}>
      <IOSPressable haptic="selection" onPress={() => setOpen((current) => !current)} style={styles.activityCardSummary}>
        <View style={styles.activityStatusSmall} />
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
          {activity.input ? <ActivityDetail label={'输入'} value={activity.input} /> : null}
          {activity.output ? <ActivityDetail label={'输出'} value={activity.output} /> : null}
        </Reanimated.View>
      ) : null}
    </View>
  );
}

function ActivityDetail({ label, value }: { label: string; value: string }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.activityDetailSection}>
      <Text style={[styles.activityDetailLabel, { color: tokens.colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.activityCode, { backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.05), color: tokens.colors.foreground }]}>{value}</Text>
    </View>
  );
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

  if (Platform.OS === 'ios' && hasNativeSwiftUIPartialFrontend) {
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
  avatarImage: { height: '100%', width: '100%' },
  headingCopy: { flex: 1, minWidth: 0 },
  headingTitle: { fontFamily: DISPLAY_BOLD, fontSize: 15, lineHeight: 19 },
  headingTitleCompact: { fontSize: 12, lineHeight: 16 },
  headingSubtitle: { fontFamily: BODY_REGULAR, fontSize: 10, lineHeight: 14 },
  headerControls: { alignItems: 'center', flexDirection: 'row', gap: 4, justifyContent: 'flex-end' },
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
  userMessage: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  messageAvatar: { alignItems: 'center', borderRadius: 9, borderWidth: 1, height: 27, justifyContent: 'center', overflow: 'hidden', width: 27 },
  hermesAvatar: { backgroundColor: '#192320' },
  userAvatar: { backgroundColor: '#ffffff' },
  userAvatarText: { color: '#0d7164', fontFamily: BODY_BOLD, fontSize: 9 },
  messageStack: { alignItems: 'flex-start', flexShrink: 1, maxWidth: '88%', minWidth: 0 },
  userMessageStack: { alignItems: 'flex-end', maxWidth: '82%' },
  messageMeta: { alignItems: 'center', flexDirection: 'row', gap: 5, marginBottom: 4, marginHorizontal: 3, minHeight: 17 },
  userMessageMeta: { flexDirection: 'row-reverse' },
  messageName: { fontFamily: BODY_BOLD, fontSize: 11, lineHeight: 15 },
  roleLabel: { fontFamily: BODY_SEMIBOLD, fontSize: 9, lineHeight: 13 },
  runtimeModel: { flexShrink: 1, fontFamily: MONO_REGULAR, fontSize: 9, lineHeight: 13, maxWidth: 180 },
  messageBody: { borderRadius: 13, borderWidth: 1, maxWidth: '100%', minWidth: 38, paddingHorizontal: 11, paddingVertical: 9 },
  agentMessageBody: { borderTopLeftRadius: 5 },
  userMessageBody: { borderTopRightRadius: 5 },
  messageText: { fontFamily: BODY_REGULAR, fontSize: 14, lineHeight: 22 },
  pendingDots: { alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: 16 },
  pendingDot: { backgroundColor: '#0d7164', borderRadius: 3, height: 5, width: 5 },
  activityGroup: { borderRadius: 10, borderWidth: 1, marginBottom: 6, maxWidth: 720, overflow: 'hidden', width: '100%' },
  activitySummary: { alignItems: 'center', flexDirection: 'row', gap: 7, minHeight: 34, paddingHorizontal: 9, paddingVertical: 6 },
  activityStatus: { backgroundColor: '#20a879', borderRadius: 4, height: 8, width: 8 },
  activityTitle: { flex: 1, fontFamily: BODY_SEMIBOLD, fontSize: 10, lineHeight: 14 },
  activityCount: { fontFamily: BODY_REGULAR, fontSize: 9, lineHeight: 13 },
  activityTimeline: { gap: 6, paddingBottom: 8, paddingHorizontal: 8 },
  activityCard: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  activityCardSummary: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 30, paddingHorizontal: 8, paddingVertical: 6 },
  activityStatusSmall: { backgroundColor: '#20a879', borderRadius: 3, height: 7, width: 7 },
  activityKind: { backgroundColor: 'rgba(13,113,100,0.10)', borderRadius: 5, color: '#0d7164', fontFamily: BODY_BOLD, fontSize: 8, overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 2 },
  activityName: { flex: 1, fontFamily: BODY_SEMIBOLD, fontSize: 9 },
  activityDuration: { fontFamily: MONO_REGULAR, fontSize: 8 },
  activityDetail: { gap: 7, paddingBottom: 8, paddingHorizontal: 8, paddingLeft: 22 },
  activityDetailSection: { gap: 3 },
  activityDetailLabel: { fontFamily: BODY_BOLD, fontSize: 8 },
  activityCode: { fontFamily: MONO_REGULAR, fontSize: 9, lineHeight: 13, padding: 6 },
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
  inputShell: { alignItems: 'flex-end', alignSelf: 'center', borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 4, maxWidth: 920, overflow: 'hidden', paddingBottom: 5, paddingLeft: 5, paddingRight: 5, paddingTop: 5, position: 'relative', width: '100%' },
  composerFrostedBackground: { zIndex: 0 },
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
