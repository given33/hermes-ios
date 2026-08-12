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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TextInput,
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
  type HermesChatActivity as ChatActivity,
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
import { TodoSection } from './TodoSection';
import { AnimatedChevron, WorkflowTimeline } from '../WorkflowTimeline';
import {
  activityElapsedLabel,
  activityIsRunning,
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



export const UnifiedMessage = memo(function UnifiedMessage({
  index,
  isChinese,
  message,
  onBranch,
  onOpenAttachment,
  onInspectActivity,
  onMentionMember,
  onRespondToChoice,
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
  onRespondToChoice?(text: string): void;
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
          {!isUser && message.todos?.length ? (
            <TodoSection
              isChinese={isChinese}
              running={messageIsRunning(message)}
              todos={message.todos}
            />
          ) : null}
          {!isUser && shouldShowMessageTiming(message) ? (
            <RoleActivityGroup
              isChinese={isChinese}
              message={message}
              onInspectActivity={onInspectActivity}
              onRespondToChoice={onRespondToChoice}
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
});

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

/**
 * Choice card rendered when a team member (manager/worker) needs the user
 * to pick a direction. Options A/B/C come from the worker's needs_input
 * block; the custom input row is always available. Tapping an option (or
 * submitting custom text) delivers the answer through the hosted
 * intervention channel, which steers the awaiting member back to work.
 */
const AwaitingChoiceCard = memo(function AwaitingChoiceCard({
  activity,
  isChinese,
  onRespondToChoice,
}: {
  activity: ChatActivity;
  isChinese: boolean;
  onRespondToChoice?(text: string): void;
}) {
  const { tokens } = useTheme();
  const [custom, setCustom] = useState('');
  const options = activity.options || [];
  const question = activity.question || activity.preview || activity.name;
  const answered = activity.status === 'completed' && !options.length;
  return (
    <View
      style={[
        styles.subagentCard,
        {
          backgroundColor: multiplyAlpha('#D28B22', 0.07),
          borderColor: multiplyAlpha('#D28B22', 0.4),
        },
      ]}
    >
      <View style={styles.subagentHeader}>
        <View style={[styles.subagentIcon, { backgroundColor: multiplyAlpha('#D28B22', 0.16) }]}>
          <Text style={{ fontSize: 11, lineHeight: 14 }}>❓</Text>
        </View>
        <Text style={[styles.subagentName, { color: tokens.colors.textSecondary }]}>
          {isChinese ? '需要你决定方向' : 'Needs your decision'}
        </Text>
      </View>
      <Text numberOfLines={6} style={[styles.subagentSummary, { color: tokens.colors.textSecondary }]}>
        {question}
      </Text>
      {!answered && options.length ? (
        <View style={styles.choiceOptions}>
          {options.map((option) => (
            <IOSPressable
              accessibilityLabel={option.label}
              haptic="selection"
              key={option.id}
              onPress={() => onRespondToChoice?.(`${option.id}. ${option.label}`)}
              style={[styles.choiceOption, { borderColor: multiplyAlpha(tokens.colors.primary, 0.4) }]}
            >
              <Text style={[styles.choiceOptionKey, { color: tokens.colors.primary }]}>{option.id}</Text>
              <Text numberOfLines={2} style={[styles.choiceOptionLabel, { color: tokens.colors.textSecondary }]}>
                {option.label}
              </Text>
            </IOSPressable>
          ))}
        </View>
      ) : null}
      {!answered ? (
        <View style={styles.choiceCustomRow}>
          <TextInput
            onChangeText={setCustom}
            placeholder={isChinese ? '或输入你自己的回答…' : 'Or type your own answer…'}
            placeholderTextColor={tokens.colors.textTertiary}
            style={[styles.choiceCustomInput, { borderColor: multiplyAlpha(tokens.colors.primary, 0.3), color: tokens.colors.textSecondary }]}
            value={custom}
          />
          <IOSPressable
            accessibilityLabel={isChinese ? '发送自定义回答' : 'Send custom answer'}
            disabled={!custom.trim()}
            onPress={() => {
              const text = custom.trim();
              if (text) onRespondToChoice?.(text);
            }}
            style={[styles.choiceCustomSend, { backgroundColor: custom.trim() ? tokens.colors.primary : tokens.colors.textDisabled }]}
          >
            <Text style={{ color: tokens.colors.primaryForeground, fontSize: 12, fontWeight: '600' }}>
              {isChinese ? '发送' : 'Send'}
            </Text>
          </IOSPressable>
        </View>
      ) : null}
    </View>
  );
});

/**
 * Supervisor verdict card: green for PASS, red for CORRECTIVE_ACTION.
 * Rework state chips ("正在打回给 worker" → "已打回给 worker 重做") render
 * below the verdict text.
 */
const SupervisorVerdictCard = memo(function SupervisorVerdictCard({
  activity,
  isChinese,
}: {
  activity: ChatActivity;
  isChinese: boolean;
}) {
  const { tokens } = useTheme();
  const corrective = activity.severity === 'corrective';
  const color = corrective ? tokens.colors.destructive : tokens.colors.success;
  return (
    <View
      style={[
        styles.subagentCard,
        {
          backgroundColor: multiplyAlpha(color, 0.06),
          borderColor: multiplyAlpha(color, 0.35),
        },
      ]}
    >
      <View style={styles.subagentHeader}>
        <View style={[styles.subagentIcon, { backgroundColor: multiplyAlpha(color, 0.14) }]}>
          <Text style={{ fontSize: 11, lineHeight: 14 }}>{corrective ? '⚠️' : '✅'}</Text>
        </View>
        <Text style={[styles.subagentName, { color: tokens.colors.textSecondary }]}>
          {isChinese ? '监督检查' : 'Supervision check'}
        </Text>
        <Text style={[styles.subagentStatus, { color }]}>
          {corrective ? (isChinese ? '需整改' : 'corrective') : (isChinese ? '通过' : 'pass')}
        </Text>
      </View>
      {activity.output || activity.preview ? (
        <Text numberOfLines={6} style={[styles.subagentSummary, { color: tokens.colors.textSecondary }]}>
          {activity.output || activity.preview}
        </Text>
      ) : null}
    </View>
  );
});

/**
 * Agent roster: every subagent spawned during the conversation (live or
 * historical), grouped by name — the mobile equivalent of the pi Agent Hub
 * side list. Each row shows the agent's name, live state and latest
 * activity; the creator (manager/worker) is the one who steers/kills/waits,
 * so this list is informational and drillable.
 */
export function AgentRoster({
  isChinese,
  messages,
}: {
  isChinese: boolean;
  messages: ChatMessage[];
}) {
  const { tokens } = useTheme();
  const roster = useMemo(() => {
    const seen = new Map<string, ChatActivity>();
    for (const message of messages) {
      for (const activity of message.activities || []) {
        if (activity.category !== 'subagent') continue;
        const key = activity.agentName
          || activity.name
          || activity.id.split(':')[0]
          || activity.id;
        const existing = seen.get(key);
        if (!existing || (activity.completedAt || 0) >= (existing.completedAt || 0)) {
          seen.set(key, activity);
        }
      }
    }
    return Array.from(seen.values());
  }, [messages]);
  if (!roster.length) return null;
  return (
    <View style={[styles.rosterPanel, { borderColor: multiplyAlpha(tokens.colors.textTertiary, 0.25) }]}>
      <Text style={[styles.subagentSummaryLabel, { color: tokens.colors.textTertiary }]}>
        {isChinese ? '智能体名册' : 'Agent roster'}
      </Text>
      {roster.map((activity) => {
        const running = activityIsRunning(activity);
        const failed = activity.status === 'failed' || activity.status === 'cancelled';
        const color = failed ? tokens.colors.destructive : running ? '#D28B22' : tokens.colors.success;
        return (
          <View key={activity.id} style={styles.rosterRow}>
            <View style={[styles.rosterDot, { backgroundColor: color }]} />
            <Text numberOfLines={1} style={[styles.rosterName, { color: tokens.colors.textSecondary }]}>
              {activity.agentName || activity.name || (isChinese ? '子 Agent' : 'Subagent')}
            </Text>
            <Text numberOfLines={1} style={[styles.rosterState, { color }]}>
              {failed
                ? (isChinese ? '已终止' : 'dead')
                : running
                  ? (isChinese ? '运行中' : 'running')
                  : (isChinese ? '已完成' : 'done')}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Context-window usage ring shown beside the composer (honest `—` placeholder). */
export function ContextUsageRing({ isChinese }: { isChinese: boolean }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.contextRing, { borderColor: multiplyAlpha(tokens.colors.textTertiary, 0.4) }]}>
      <Text style={[styles.contextRingText, { color: tokens.colors.textTertiary }]}>—</Text>
      <Text style={[styles.contextRingLabel, { color: tokens.colors.textTertiary }]}>
        {isChinese ? '上下文' : 'ctx'}
      </Text>
    </View>
  );
}

/**
 * Team status bar: one glanceable line summarizing member states —
 * how many are working, how many finished, how many need attention.
 */
export function TeamStatusBar({
  isChinese,
  messages,
}: {
  isChinese: boolean;
  messages: ChatMessage[];
}) {
  const { tokens } = useTheme();
  const [rosterOpen, setRosterOpen] = useState(false);
  const { working, done, awaiting, corrective, subagents } = useMemo(() => {
    let workingCount = 0;
    let doneCount = 0;
    let awaitingCount = 0;
    let correctiveCount = 0;
    let subagentCount = 0;
    for (const message of messages) {
      if (message.role === 'user') continue;
      if (message.status === 'running' || message.status === 'streaming') {
        workingCount += 1;
      } else if (message.status === 'completed') {
        doneCount += 1;
      }
      for (const activity of message.activities || []) {
        if (activity.category === 'awaiting' && activity.status !== 'completed') {
          awaitingCount += 1;
        }
        if (activity.category === 'supervisor' && activity.severity === 'corrective') {
          correctiveCount += 1;
        }
        if (activity.category === 'subagent') {
          subagentCount += 1;
        }
      }
    }
    return {
      working: workingCount,
      done: doneCount,
      awaiting: awaitingCount,
      corrective: correctiveCount,
      subagents: subagentCount,
    };
  }, [messages]);
  if (!working && !done && !awaiting && !subagents) return null;
  const parts: string[] = [];
  if (working) parts.push(`${working} ${isChinese ? '成员干活' : 'working'}`);
  if (done) parts.push(`${done} ${isChinese ? '成员完成' : 'done'}`);
  if (awaiting) parts.push(`${awaiting} ${isChinese ? '等你决定' : 'awaiting you'}`);
  if (corrective) parts.push(`${corrective} ${isChinese ? '需整改' : 'corrective'}`);
  return (
    <View style={[styles.teamStatusBar, { backgroundColor: tokens.colors.card, borderColor: multiplyAlpha(tokens.colors.textTertiary, 0.25) }]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: working ? '#D28B22' : tokens.colors.success }} />
      <Text style={[styles.teamStatusText, { color: tokens.colors.textSecondary }]}>
        {parts.join(' · ')}
      </Text>
      {subagents ? (
        <IOSPressable
          accessibilityLabel={isChinese ? '展开智能体名册' : 'Open agent roster'}
          haptic="selection"
          onPress={() => setRosterOpen((current) => !current)}
          style={[styles.rosterToggle, { borderColor: multiplyAlpha(tokens.colors.textTertiary, 0.35) }]}
        >
          <Text style={[styles.rosterToggleText, { color: tokens.colors.textSecondary }]}>
            {isChinese ? `智能体 ${subagents}` : `agents ${subagents}`}
          </Text>
        </IOSPressable>
      ) : null}
      {rosterOpen ? <AgentRoster isChinese={isChinese} messages={messages} /> : null}
    </View>
  );
}

/**
 * Full-width card for one delegated subagent (agent team member). Rendered
 * alongside the parent role's message — same visual weight as the manager /
 * worker cards — instead of being buried in the collapsible tool timeline.
 */
/**
 * Full-width card for one delegated subagent (agent team member). Rendered
 * alongside the parent role's message — same visual weight as the manager /
 * worker cards — instead of being buried in the collapsible tool timeline.
 */
const SubagentCard = memo(function SubagentCard({
  activity,
  isChinese,
  now,
}: {
  activity: ChatActivity;
  isChinese: boolean;
  now: number;
}) {
  const { tokens } = useTheme();
  const running = activityIsRunning(activity);
  const failed = activity.status === 'failed' || activity.status === 'cancelled';
  const statusColor = failed
    ? tokens.colors.destructive
    : running
      ? '#D28B22'
      : tokens.colors.success;
  const elapsed = activityElapsedLabel(activity, now);
  const detail = activity.output || activity.detail || activity.preview || '';
  return (
    <View
      style={[
        styles.subagentCard,
        {
          backgroundColor: multiplyAlpha(statusColor, 0.05),
          borderColor: multiplyAlpha(statusColor, 0.35),
        },
      ]}
    >
      <View style={styles.subagentHeader}>
        <View style={[styles.subagentIcon, { backgroundColor: multiplyAlpha(statusColor, 0.14) }]}>
          <Text style={{ fontSize: 11, lineHeight: 14 }}>
            {running ? '🔬' : failed ? '⚠️' : '✅'}
          </Text>
        </View>
        <Text numberOfLines={2} style={[styles.subagentName, { color: tokens.colors.textSecondary }]}>
          {activity.agentName || activity.name || (isChinese ? '子 Agent' : 'Subagent')}
        </Text>
        <Text style={[styles.subagentStatus, { color: statusColor }]}>
          {activity.status === 'failed'
            ? (isChinese ? '失败' : 'failed')
            : activity.status === 'cancelled'
              ? (isChinese ? '已取消' : 'cancelled')
              : running
                ? (isChinese ? '创建智能体…' : 'Creating agent…')
                : (isChinese ? '智能体创建成功' : 'Agent created')}
        </Text>
        {elapsed ? (
          <Text style={[styles.subagentTiming, { color: tokens.colors.textTertiary }]}>{elapsed}</Text>
        ) : null}
      </View>
      {detail ? (
        <>
          <Text style={[styles.subagentSummaryLabel, { color: tokens.colors.textTertiary }]}>
            {isChinese ? '子代理结果' : 'Subagent result'}
          </Text>
          <Text numberOfLines={4} style={[styles.subagentSummary, { color: tokens.colors.textSecondary }]}>
            {detail}
          </Text>
        </>
      ) : null}
      {activity.files && activity.files.length ? (
        <View style={styles.fileChips}>
          {activity.files.slice(0, 4).map((file) => (
            <Text
              key={file}
              numberOfLines={1}
              style={[styles.fileChip, { backgroundColor: multiplyAlpha(tokens.colors.textTertiary, 0.1), color: tokens.colors.textTertiary }]}
            >
              📄 {file}
            </Text>
          ))}
          {activity.files.length > 4 ? (
            <Text style={[styles.fileChip, { backgroundColor: multiplyAlpha(tokens.colors.textTertiary, 0.1), color: tokens.colors.textTertiary }]}>
              +{activity.files.length - 4}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const RoleActivityGroup = memo(function RoleActivityGroup({  isChinese,
  message,
  onInspectActivity,
  onRespondToChoice,
}: {
  isChinese: boolean;
  message: ChatMessage;
  onInspectActivity(): void;
  onRespondToChoice?(text: string): void;
}) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const [open, setOpen] = useState(false);
  const manualPinRef = useRef(false);
  const [now, setNow] = useState(Date.now());
  const activities = message.activities || [];
  const reasoningActivities = activities.filter(
    (activity) => activity.category === 'reasoning',
  );
  const subagentActivities = activities.filter(
    (activity) => activity.category === 'subagent',
  );
  const awaitingActivities = activities.filter(
    (activity) => activity.category === 'awaiting',
  );
  const supervisorActivities = activities.filter(
    (activity) => activity.category === 'supervisor',
  );
  const reworkActivities = activities.filter(
    (activity) => activity.category === 'rework',
  );
  const stepActivities = activities.filter(
    (activity) => (
      activity.category !== 'reasoning'
      && activity.category !== 'subagent'
      && activity.category !== 'awaiting'
      && activity.category !== 'supervisor'
      && activity.category !== 'rework'
    ),
  );
  const reasoningText = reasoningActivities
    .map((activity) => activityDisplayContent(activity))
    .filter(Boolean)
    .join('\n\n');
  const reasoningRunning = reasoningActivities.some(
    (activity) => activity.status === 'queued' || activity.status === 'running',
  );
  const running = messageIsRunning(message);
  // Live workflow display: while the turn runs the activity group stays
  // open so tool calls / searches appear in real time; once the turn ends it
  // collapses by default. A manual tap pins the state until the next turn.
  useEffect(() => {
    if (manualPinRef.current) return;
    setOpen(running);
  }, [running]);
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
          {isChinese ? `${stepActivities.length} 个工具调用` : `${stepActivities.length} tool calls`}
        </Text>
      ) : null}
      {activities.length ? (
        <AnimatedChevron
          color={tokens.colors.textTertiary}
          open={open}
          size={14}
        />
      ) : null}
    </>
  );
  return (
    <View style={styles.activityGroup}>
      {awaitingActivities.length ? (
        <View style={styles.subagentCards}>
          {awaitingActivities.map((activity) => (
            <AwaitingChoiceCard
              activity={activity}
              isChinese={isChinese}
              key={activity.id}
              onRespondToChoice={onRespondToChoice}
            />
          ))}
        </View>
      ) : null}
      {supervisorActivities.length ? (
        <View style={styles.subagentCards}>
          {supervisorActivities.map((activity) => (
            <SupervisorVerdictCard
              activity={activity}
              isChinese={isChinese}
              key={activity.id}
            />
          ))}
        </View>
      ) : null}
      {reworkActivities.length ? (
        <View style={styles.subagentCards}>
          {reworkActivities.map((activity) => (
            <View
              key={activity.id}
              style={[styles.subagentCard, { backgroundColor: multiplyAlpha('#D28B22', 0.06), borderColor: multiplyAlpha('#D28B22', 0.35) }]}
            >
              <View style={styles.subagentHeader}>
                <View style={[styles.subagentIcon, { backgroundColor: multiplyAlpha('#D28B22', 0.14) }]}>
                  <Text style={{ fontSize: 11, lineHeight: 14 }}>🔁</Text>
                </View>
                <Text style={[styles.subagentName, { color: tokens.colors.textSecondary }]}>
                  {isChinese ? '返工流程' : 'Rework'}
                </Text>
                <Text style={[styles.subagentStatus, { color: '#D28B22' }]}>
                  {activity.preview === 'started'
                    ? (isChinese ? '正在打回给 worker' : 'sending back to worker')
                    : (isChinese ? '已打回给 worker 重做' : 'worker redoing')}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {subagentActivities.length ? (
        <View style={styles.subagentCards}>
          {subagentActivities.map((activity) => (
            <SubagentCard
              activity={activity}
              isChinese={isChinese}
              key={activity.id}
              now={now}
            />
          ))}
        </View>
      ) : null}
      {stepActivities.length || reasoningActivities.length ? (
        <IOSPressable
          accessibilityLabel={formatActivitySummary(message, isChinese, now)}
          haptic="selection"
          onPress={() => {
            manualPinRef.current = true;
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
});

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
