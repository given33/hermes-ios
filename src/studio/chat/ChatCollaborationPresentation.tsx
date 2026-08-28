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
  const latestForMember = (avatarRole: NonNullable<ChatMessage['avatarRole']>) => (
    [...messages].reverse().find((message) => message.avatarRole === avatarRole)
  );
  const canonicalMember = (
    id: string,
    stage: NonNullable<ChatMessage['roleStage']>,
    avatarRole: NonNullable<ChatMessage['avatarRole']>,
    fallback: ChatMessage,
  ): ChatMessage => ({
    ...fallback,
    ...latestForMember(avatarRole),
    id,
    avatarRole,
    roleStage: stage,
  });
  return [
    canonicalMember('dispatcher', 'dispatcher', 'dispatcher', {
      avatarRole: 'dispatcher', content: '', id: 'collaboration-manager',
      name: isChinese ? 'Hermes 调度员' : 'Hermes Dispatcher',
      role: 'assistant', roleStage: 'dispatcher',
    }),
    canonicalMember('dbb3-worker', 'worker', 'dbb3-worker', {
      avatarRole: 'dbb3-worker', content: '', id: 'collaboration-worker',
      name: isChinese ? 'DBB3 执行员' : 'DBB3 Worker', role: 'assistant', roleStage: 'worker',
    }),
    canonicalMember('pc-worker', 'worker', 'pc-worker', {
      avatarRole: 'pc-worker', content: '', id: 'collaboration-pc-worker',
      name: isChinese ? 'PC/WSL 执行员' : 'PC/WSL Worker', role: 'assistant', roleStage: 'worker',
    }),
    canonicalMember('hk-worker', 'worker', 'hk-worker', {
      avatarRole: 'hk-worker', content: '', id: 'collaboration-hk-worker',
      name: isChinese ? 'HK 执行员' : 'Hong Kong Worker', role: 'assistant', roleStage: 'worker',
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
    <View accessibilityLabel={isChinese ? '4 位协作成员' : '4 collaboration members'} style={styles.collaborationAvatarStack}>
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
            ? (isChinese ? 'Hermes 调度员 · DBB3 · PC/WSL · HK 执行员' : 'Hermes Dispatcher · DBB3 · PC/WSL · Hong Kong workers')
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
