import { Text, View } from 'react-native';
import Reanimated, {
  Easing,
  FadeIn,
  FadeInUp,
  LinearTransition,
} from 'react-native-reanimated';

import type {
  ConversationCollaborationState,
  HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { StudioRoleAvatar } from '../../components/studio/StudioRoleAvatar';
import { IOS_MOTION } from '../../design/ios-motion';
import { MOTION, useMotion } from '../../design/motion';
import { useTheme } from '../../design/ThemeProvider';
import { styles } from './chat-presentation-styles';
import { PendingDot } from './ChatPresentation';

const IOS_STANDARD_EASING = Easing.bezier(...IOS_MOTION.curve.standard);
const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);

function collaborationMembers(
  messages: readonly ChatMessage[],
  isChinese: boolean,
): ChatMessage[] {
  const latestForStage = (stage: NonNullable<ChatMessage['roleStage']>) => (
    [...messages].reverse().find((message) => message.roleStage === stage)
  );
  const canonicalMember = (
    stage: NonNullable<ChatMessage['roleStage']>,
    avatarRole: NonNullable<ChatMessage['avatarRole']>,
    fallback: ChatMessage,
  ): ChatMessage => ({
    ...fallback,
    ...latestForStage(stage),
    avatarRole,
    roleStage: stage,
  });
  return [
    canonicalMember('dispatcher', 'dispatcher', {
      avatarRole: 'dispatcher', content: '', id: 'collaboration-manager',
      name: isChinese ? 'Hermes 调度员' : 'Hermes Manager',
      role: 'assistant', roleStage: 'dispatcher',
    }),
    canonicalMember('worker', 'dbb3-worker', {
      avatarRole: 'dbb3-worker', content: '', id: 'collaboration-worker',
      name: 'Worker', role: 'assistant', roleStage: 'worker',
    }),
    canonicalMember('reviewer', 'reviewer', {
      avatarRole: 'reviewer', content: '', id: 'collaboration-reviewer',
      name: isChinese ? 'Hermes 审阅员' : 'Hermes Reviewer',
      role: 'assistant', roleStage: 'reviewer',
    }),
    canonicalMember('reporter', 'reporter', {
      avatarRole: 'reporter', content: '', id: 'collaboration-reporter',
      name: isChinese ? 'Hermes 汇报员' : 'Hermes Reporter',
      role: 'assistant', roleStage: 'reporter',
    }),
    canonicalMember('supervisor', 'supervisor', {
      avatarRole: 'supervisor', content: '', id: 'collaboration-supervisor',
      name: isChinese ? 'Hermes 监督者' : 'Hermes Supervisor',
      role: 'assistant', roleStage: 'supervisor',
    }),
  ];
}

export function CollaborationMemberStack({
  isChinese,
  messages,
  onMentionMember,
}: {
  isChinese: boolean;
  messages: readonly ChatMessage[];
  onMentionMember(message: ChatMessage): void;
}) {
  const { tokens } = useTheme();
  const members = collaborationMembers(messages, isChinese);
  return (
    <View accessibilityLabel={isChinese ? '5 位协作成员' : '5 collaboration members'} style={styles.collaborationAvatarStack}>
      {members.map((member, index) => (
        <IOSPressable
          accessibilityLabel={isChinese ? `长按 @${member.name}` : `Long press to mention ${member.name}`}
          delayLongPress={220}
          haptic="selection"
          key={member.roleStage}
          onLongPress={() => onMentionMember(member)}
          style={[
            styles.collaborationAvatarStackItem,
            {
              borderColor: tokens.colors.card,
              marginLeft: index === 0 ? 0 : -6,
              zIndex: members.length - index,
            },
          ]}
        >
          <StudioRoleAvatar role={member.avatarRole || 'hermes'} size={24} />
        </IOSPressable>
      ))}
    </View>
  );
}

export function CollaborationLiftNotice({
  isChinese,
  messages,
  onMentionMember,
  state,
}: {
  isChinese: boolean;
  messages: readonly ChatMessage[];
  onMentionMember(message: ChatMessage): void;
  state: Exclude<ConversationCollaborationState, 'single'>;
}) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const lifted = state === 'active';
  return (
    <Reanimated.View
      entering={motion.fade(
        FadeInUp.duration(IOS_MOTION.duration.content).easing(IOS_DECELERATE_EASING),
        FadeIn.duration(MOTION.fade.reduced),
      )}
      layout={motion.animate(
        LinearTransition.duration(IOS_MOTION.duration.control).easing(IOS_STANDARD_EASING),
      )}
      style={[
        styles.collaborationLiftNotice,
        { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border },
      ]}
    >
      <View style={styles.collaborationLiftCopy}>
        <View style={styles.collaborationLiftTitleRow}>
          <View
            style={[
              styles.collaborationLiftStateDot,
              { backgroundColor: lifted ? tokens.colors.success : tokens.colors.primary },
            ]}
          />
          <Text style={[styles.collaborationLiftTitle, { color: tokens.colors.foreground }]}>
            {lifted
              ? (isChinese ? '群聊已拉起' : 'Group chat ready')
              : (isChinese ? '群聊正在拉起' : 'Starting group chat')}
          </Text>
          {!lifted ? (
            <View style={styles.collaborationLiftDots}>
              {[0, 1, 2].map((dot) => <PendingDot delay={dot * 120} key={dot} />)}
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.collaborationLiftMeta, { color: tokens.colors.textTertiary }]}>
          {lifted
            ? (isChinese ? 'Hermes 调度员 · Worker · 审阅员 · 汇报员 · 监督者' : 'Hermes Manager · Worker · Reviewer · Reporter · Supervisor')
            : (isChinese ? 'Hermes 正在连接协作成员' : 'Hermes is connecting the collaboration members')}
        </Text>
      </View>
      {lifted ? (
        <CollaborationMemberStack
          isChinese={isChinese}
          messages={messages}
          onMentionMember={onMentionMember}
        />
      ) : null}
    </Reanimated.View>
  );
}
