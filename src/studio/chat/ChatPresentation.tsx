import * as Clipboard from 'expo-clipboard';
import {
  Check,
  Copy,
  Cpu,
  File,
  UserRound,
  Volume2,
  VolumeX,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Reanimated, {
  Easing,
  FadeIn,
  FadeInUp,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Markdown from 'react-native-markdown-display';
import {
  activityDisplayContent,
  formatActivitySummary,
  formatMessageLocalTime,
  messageHasExecutionTiming,
  messageIsRunning,
  type HermesChatAttachment as StoredChatAttachment,
  type HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import { StudioOfficialAvatar } from '../../components/studio/StudioOfficialAvatar';
import { StudioRoleAvatar } from '../../components/studio/StudioRoleAvatar';
import { IOSContextMenu } from '../../components/ios/IOSContextMenu';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { multiplyAlpha } from '../../design/control-contracts';
import { resolveNativeFontStack } from '../../design/native-font-faces';
import { IOS_MOTION } from '../../design/ios-motion';
import { MOTION, useMotion } from '../../design/motion';
import { useTheme } from '../../design/ThemeProvider';
import { ReasoningSection } from '../ReasoningSection';
import { AnimatedChevron, WorkflowTimeline } from '../WorkflowTimeline';
import {
  reasoningElapsedLabel,
  turnPhaseChip,
  turnTimingLine,
} from '../workflow-timeline-model';
import { formatAttachmentSize } from './chat-attachments';
import { styles } from './chat-presentation-styles';
import type { PendingPhase } from './chat-types';

export { styles } from './chat-presentation-styles';
export { ModelToolsDrawer } from './ChatModelToolsDrawer';
export {
  AttachmentItem,
  ComposerSurface,
  OpenMinisVoiceWaveform,
} from './ChatComposerPresentation';
export { ConversationHistory } from './ConversationHistory';

const BODY_REGULAR = 'HermesGoogle-IBMPlexSans-400-Normal';
const BODY_SEMIBOLD = 'HermesGoogle-IBMPlexSans-600-Normal';
const BODY_BOLD = 'HermesGoogle-IBMPlexSans-700-Normal';
const MONO_REGULAR = 'HermesTerminal-JetBrainsMono-400-Normal';
const IOS_STANDARD_EASING = Easing.bezier(...IOS_MOTION.curve.standard);
const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);
const RECONNECT_MAX_ATTEMPTS = 5;



export function UnifiedMessage({
  index,
  isChinese,
  message,
  onBranch,
  onOpenAttachment,
  onInspectActivity,
  onMentionMember,
  onToggleSpeech,
  speaking,
}: {
  index: number;
  isChinese: boolean;
  message: ChatMessage;
  onBranch(message: ChatMessage): void;
  onOpenAttachment(attachment: StoredChatAttachment, share?: boolean): void;
  onInspectActivity(): void;
  onMentionMember(message: ChatMessage): void;
  onToggleSpeech(message: ChatMessage): void;
  speaking: boolean;
}) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const [copied, setCopied] = useState<'message' | 'model' | 'sender' | null>(null);
  const isUser = message.role === 'user';
  const metadata = isUser
    ? formatMessageLocalTime(message.createdAt, isChinese)
    : '';
  const messageForeground = tokens.colors.foreground;
  const bubbleBackground = message.status === 'failed'
    ? multiplyAlpha(tokens.colors.destructive, 0.06)
    : tokens.colors.card;
  const bubbleBorder = message.status === 'failed'
    ? multiplyAlpha(tokens.colors.destructive, 0.2)
    : multiplyAlpha('#192320', 0.11);
  const senderCopy = [
    message.name,
    message.roleLabel,
    message.profile,
    message.senderId,
  ].filter(Boolean).join(' · ');
  const copyValue = useCallback(async (
    target: 'message' | 'model' | 'sender',
    value: string,
  ) => {
    if (!value.trim()) return;
    await Clipboard.setStringAsync(value);
    setCopied(target);
    setTimeout(() => setCopied((current) => current === target ? null : current), 1_200);
  }, []);
  const markdownStyles = createMessageMarkdownStyles(
    messageForeground,
    tokens.colors.primary,
    multiplyAlpha(tokens.colors.foreground, 0.055),
    tokens.colors.border,
    resolveNativeFontStack(tokens.typography.fontSans, 400) || BODY_REGULAR,
    resolveNativeFontStack(tokens.typography.fontSans, 600) || BODY_SEMIBOLD,
    resolveNativeFontStack(tokens.typography.fontSans, 700) || BODY_BOLD,
    resolveNativeFontStack(tokens.typography.fontMono, 400) || MONO_REGULAR,
  );
  const metadataNode = metadata ? (
    <Text numberOfLines={1} style={[styles.messageTime, { color: tokens.colors.textTertiary }]}>
      {metadata}
    </Text>
  ) : null;
  const hasBubble = Boolean(isUser || message.content.trim() || message.attachments?.length);
  const messageBody = (
    <View
      style={[
        styles.messageBody,
        isUser ? styles.userMessageBody : styles.agentMessageBody,
        {
          backgroundColor: bubbleBackground,
          borderColor: bubbleBorder,
        },
      ]}
    >
      {message.content.trim() ? <Markdown style={markdownStyles}>{message.content}</Markdown> : null}
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
  const messageActions = [
    {
      id: 'copy-message',
      onPress: () => { void copyValue('message', message.content); },
      systemImage: 'doc.on.doc',
      title: isChinese ? '复制消息' : 'Copy message',
    },
    {
      id: 'copy-sender',
      onPress: () => { void copyValue('sender', senderCopy); },
      systemImage: 'person.crop.circle',
      title: isChinese ? '复制发送者信息' : 'Copy sender information',
    },
    ...(message.model ? [{
      id: 'copy-model',
      onPress: () => { void copyValue('model', message.model || ''); },
      systemImage: 'cpu',
      title: isChinese ? '复制模型信息' : 'Copy model information',
    }] : []),
    ...(canBranch ? [{
      id: 'branch',
      onPress: () => onBranch(message),
      systemImage: 'arrow.triangle.branch',
      title: isChinese ? '从这里分支' : 'Branch from here',
    }] : []),
  ];
  return (
    <Reanimated.View
      entering={motion.fade(
        FadeInUp
          .delay(Math.min(index, 8) * 35)
          .duration(IOS_MOTION.duration.content)
          .easing(IOS_DECELERATE_EASING),
        FadeIn.duration(MOTION.fade.reduced),
      )}
      style={[
        styles.messageEnvelope,
        isUser ? styles.userMessageEnvelope : styles.agentMessageEnvelope,
      ]}
    >
      {hasBubble || (!isUser && shouldShowMessageTiming(message)) ? (
        <View style={[styles.messageRow, isUser && styles.userMessageRow]}>
        <MessageAvatar
          isUser={isUser}
          message={message}
          onLongPress={isUser ? undefined : () => onMentionMember(message)}
        />
        <View style={[styles.messageStack, isUser && styles.userMessageStack]}>
          {!isUser && shouldShowMessageTiming(message) ? (
            <RoleActivityGroup
              isChinese={isChinese}
              message={message}
              onInspectActivity={onInspectActivity}
            />
          ) : null}
          <View style={[styles.messageMeta, isUser && styles.userMessageMeta]}>
            {isUser ? metadataNode : null}
            <View style={[styles.senderMeta, isUser && styles.userSenderMeta]}>
              <Text numberOfLines={1} style={[styles.messageName, { color: tokens.colors.textSecondary }]}>{message.name}</Text>
              {!isUser && message.roleStage !== 'chat' ? (
                <Text numberOfLines={1} style={[styles.roleLabel, { color: tokens.colors.textTertiary }]}>{message.roleLabel}</Text>
              ) : null}
            </View>
          </View>
          {hasBubble ? <IOSContextMenu
            accessibilityLabel={isChinese ? '会话消息操作' : 'Conversation message actions'}
            actions={messageActions}
          >
            {messageBody}
          </IOSContextMenu> : null}
          {hasBubble ? <View style={[styles.messageFooter, isUser && styles.userMessageFooter]}>
            <View style={[styles.messageActions, isUser && styles.userMessageActions]}>
            <IOSPressable
              accessibilityLabel={isChinese ? '复制消息' : 'Copy message'}
              onPress={() => { void copyValue('message', message.content); }}
              style={styles.messageAction}
            >
              {copied === 'message'
                ? <Check color={tokens.colors.success} size={13} />
                : <Copy color={tokens.colors.textTertiary} size={13} />}
            </IOSPressable>
            <IOSPressable
              accessibilityLabel={isChinese ? '复制发送者信息' : 'Copy sender information'}
              onPress={() => { void copyValue('sender', senderCopy); }}
              style={styles.messageAction}
            >
              {copied === 'sender'
                ? <Check color={tokens.colors.success} size={13} />
                : <UserRound color={tokens.colors.textTertiary} size={13} />}
            </IOSPressable>
            {message.model ? (
              <IOSPressable
                accessibilityLabel={isChinese ? '复制模型信息' : 'Copy model information'}
                onPress={() => { void copyValue('model', message.model || ''); }}
                style={styles.messageAction}
              >
                {copied === 'model'
                  ? <Check color={tokens.colors.success} size={13} />
                  : <Cpu color={tokens.colors.textTertiary} size={13} />}
              </IOSPressable>
            ) : null}
            {!isUser && message.content.trim() ? (
              <IOSPressable
                accessibilityLabel={speaking
                  ? isChinese ? '停止朗读' : 'Stop reading'
                  : isChinese ? '朗读消息' : 'Read message aloud'}
                haptic="light"
                onPress={() => onToggleSpeech(message)}
                style={styles.messageAction}
              >
                {speaking
                  ? <VolumeX color={tokens.colors.primary} size={13} />
                  : <Volume2 color={tokens.colors.textTertiary} size={13} />}
              </IOSPressable>
            ) : null}
            </View>
          </View> : null}
        </View>
        </View>
      ) : null}
    </Reanimated.View>
  );
}

function MessageAvatar({
  compact = false,
  isUser,
  message,
  onLongPress,
}: {
  compact?: boolean;
  isUser: boolean;
  message: ChatMessage;
  onLongPress?: () => void;
}) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const avatarRole = message.avatarRole || (isUser ? 'user' : 'hermes');
  const remoteAvatar = message.avatarUrl && /^(?:data:|file:|https?:)/.test(message.avatarUrl);
  const size = compact ? 24 : 30;
  return (
    <IOSPressable
      accessibilityLabel={onLongPress ? `Long press to mention ${message.name}` : undefined}
      delayLongPress={220}
      haptic={onLongPress ? 'selection' : 'none'}
      onLongPress={onLongPress}
      style={[
        styles.messageAvatar,
        compact && styles.messageAvatarCompact,
        { backgroundColor: tokens.colors.secondary },
      ]}
    >
      {isUser && remoteAvatar ? (
        <Image resizeMode="cover" source={{ uri: message.avatarUrl }} style={styles.avatarImage} />
      ) : (
        <StudioRoleAvatar role={avatarRole} size={size} />
      )}
    </IOSPressable>
  );
}

export function PendingMessage({
  index,
  isChinese,
  phase,
  reconnectAttempt,
  startedAt,
}: {
  index: number;
  isChinese: boolean;
  phase: PendingPhase;
  reconnectAttempt: number;
  startedAt: number;
}) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const executionStartedAt = (
    phase === 'thinking' || phase === 'responding' || phase === 'executing'
  ) && startedAt > 0
    ? startedAt
    : undefined;
  const pendingStatusText = phase === 'cancel_requested'
    ? (isChinese ? '正在取消' : 'Cancelling')
    : phase === 'reconnecting'
    ? (isChinese
        ? `正在重新连接 (${reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS})`
        : `Reconnecting (${reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS})`)
    : phase === 'executing'
      ? (isChinese ? '正在执行' : 'The model is running')
      : phase === 'responding'
        ? (isChinese ? '正在回复' : 'Responding')
      : phase === 'thinking'
        ? (isChinese ? '正在思考' : 'Thinking')
        : (isChinese ? '正在连接模型' : 'Connecting to model');
  const statusText = phase === 'connecting' ? '' : pendingStatusText;
  const statusColor = phase === 'cancel_requested'
    ? tokens.colors.textTertiary
    : phase === 'connecting'
      ? tokens.colors.primary
      : '#D28B22';
  return (
    <Reanimated.View
      entering={motion.fade(
        FadeInUp
          .delay(index * 35)
          .duration(IOS_MOTION.duration.content)
          .easing(IOS_DECELERATE_EASING),
        FadeIn.duration(MOTION.fade.reduced),
      )}
      style={[styles.messageEnvelope, styles.agentMessageEnvelope]}
    >
      <View style={[styles.message, styles.agentMessage]}>
        <View style={[styles.messageAvatar, styles.hermesAvatar]}>
          <StudioOfficialAvatar size={30} />
        </View>
        <View style={styles.messageStack}>
          {statusText ? (
            <View style={styles.activitySummary}>
              <View style={[styles.turnPhaseChip, { backgroundColor: multiplyAlpha(statusColor, 0.12) }]}>
                <View style={[styles.turnPhaseDot, { backgroundColor: statusColor }]} />
                <Text numberOfLines={1} style={[styles.turnPhaseLabel, { color: statusColor }]}>
                  {statusText}
                </Text>
              </View>
              {executionStartedAt ? (
                <PendingElapsedTime color={tokens.colors.textSecondary} startedAt={executionStartedAt} />
              ) : null}
            </View>
          ) : null}
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

export function formatPendingElapsedTime(startedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function PendingElapsedTime({ color, startedAt }: { color: string; startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);
  return (
    <Text style={[styles.pendingElapsed, { color }]}>
      {formatPendingElapsedTime(startedAt, now)}
    </Text>
  );
}

export function PendingDot({ delay }: { delay: number }) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const scale = useSharedValue(0.7);
  useEffect(() => {
    cancelAnimation(scale);
    if (motion.reduceMotion) {
      scale.value = 0.85;
      return undefined;
    }
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
  }, [delay, motion.reduceMotion, scale]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Reanimated.View style={[styles.pendingDot, { backgroundColor: tokens.colors.primary }, animatedStyle]} />;
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
  const motion = useMotion();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const activities = message.activities || [];
  const reasoningActivities = activities.filter(
    (activity) => activity.category === 'reasoning',
  );
  const stepActivities = activities.filter(
    (activity) => activity.category !== 'reasoning',
  );
  const reasoningText = reasoningActivities
    .map((activity) => activityDisplayContent(activity))
    .filter(Boolean)
    .join('\n\n');
  const reasoningRunning = reasoningActivities.some(
    (activity) => activity.status === 'queued' || activity.status === 'running',
  );
  const running = messageIsRunning(message);
  useEffect(() => {
    if (!running) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [running]);
  const phase = turnPhaseChip(message, isChinese);
  const phaseColor = phase.tone === 'failed'
    ? tokens.colors.destructive
    : phase.tone === 'running'
      ? '#D28B22'
      : phase.tone === 'cancelled'
        ? tokens.colors.textTertiary
        : tokens.colors.success;
  const summary = (
    <>
      <View style={[styles.turnPhaseChip, { backgroundColor: multiplyAlpha(phaseColor, 0.12) }]}>
        <View style={[styles.turnPhaseDot, { backgroundColor: phaseColor }]} />
        <Text numberOfLines={1} style={[styles.turnPhaseLabel, { color: phaseColor }]}>
          {phase.label}
        </Text>
      </View>
      <Text numberOfLines={1} style={[styles.activityTitle, { color: tokens.colors.textSecondary }]}>
        {turnTimingLine(message, isChinese, now)}
      </Text>
      {stepActivities.length ? (
        <Text style={[styles.activityCount, { color: tokens.colors.textTertiary }]}>
          {isChinese ? `${stepActivities.length} 项` : `${stepActivities.length} steps`}
        </Text>
      ) : null}
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
            .duration(motion.fadeDuration(IOS_MOTION.duration.control))
            .easing(IOS_DECELERATE_EASING)}
          exiting={FadeOut
            .duration(motion.fadeDuration(IOS_MOTION.duration.press))
            .easing(IOS_STANDARD_EASING)}
          style={styles.activityTimeline}
        >
          {reasoningText ? (
            <ReasoningSection
              detailStyle={styles.reasoningActivityDetail}
              durationLabel={reasoningElapsedLabel(reasoningActivities, now)}
              isChinese={isChinese}
              onInspectActivity={onInspectActivity}
              running={reasoningRunning}
              text={reasoningText}
            />
          ) : null}
          {stepActivities.length ? (
            <WorkflowTimeline
              activities={stepActivities}
              isChinese={isChinese}
              now={now}
              onInspectActivity={onInspectActivity}
            />
          ) : null}
        </Reanimated.View>
      ) : null}
    </View>
  );
}

function shouldShowMessageTiming(message: ChatMessage): boolean {
  if (
    message.roleStage === 'chat'
    && messageIsRunning(message)
    && !message.firstTokenAt
    && !(message.activities || []).some((activity) => (
      activity.id === 'model-connection-retry'
      || (
        activity.category !== 'reasoning'
        && activity.id !== 'model-runtime-status'
        && (activity.status === 'queued' || activity.status === 'running')
      )
    ))
  ) return false;
  return messageHasExecutionTiming(message);
}

function createMessageMarkdownStyles(
  foreground: string,
  accent: string,
  codeBackground: string,
  border: string,
  bodyFont: string,
  semiboldFont: string,
  boldFont: string,
  monoFont: string,
): Record<string, object> {
  return {
    body: {
      color: foreground,
      fontFamily: bodyFont,
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
      fontFamily: monoFont,
      fontSize: 11.5,
      lineHeight: 17,
      marginBottom: 9,
      padding: 9,
    },
    code_inline: {
      backgroundColor: codeBackground,
      borderRadius: 4,
      color: foreground,
      fontFamily: monoFont,
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
      fontFamily: monoFont,
      fontSize: 11.5,
      lineHeight: 17,
      marginBottom: 9,
      padding: 9,
    },
    heading1: { color: foreground, fontFamily: boldFont, fontSize: 18, lineHeight: 25, marginBottom: 6, marginTop: 2 },
    heading2: { color: foreground, fontFamily: boldFont, fontSize: 16, lineHeight: 23, marginBottom: 5, marginTop: 5 },
    heading3: { color: foreground, fontFamily: semiboldFont, fontSize: 14.5, lineHeight: 21, marginBottom: 4, marginTop: 4 },
    link: { color: accent, textDecorationLine: 'none' },
    list_item: { marginBottom: 2 },
    ordered_list: { marginBottom: 7, marginTop: 1 },
    paragraph: { marginBottom: 8, marginTop: 0 },
    table: { borderColor: border, borderWidth: StyleSheet.hairlineWidth, marginBottom: 9 },
    td: { borderColor: border, borderWidth: StyleSheet.hairlineWidth, padding: 6 },
    th: { borderColor: border, borderWidth: StyleSheet.hairlineWidth, fontFamily: semiboldFont, padding: 6 },
  };
}

export function LiveDot({ busy }: { busy: boolean }) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(pulse);
    pulse.value = busy && !motion.reduceMotion
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
  }, [busy, motion.reduceMotion, pulse]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return <Reanimated.View style={[styles.liveDot, { backgroundColor: tokens.colors.success }, animatedStyle]} />;
}
