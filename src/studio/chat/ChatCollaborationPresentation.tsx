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
import { latestMemberMessages } from './chat-member-model';

const IOS_STANDARD_EASING = Easing.bezier(...IOS_MOTION.curve.standard);
const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);

function collaborationMembers(
  messages: readonly ChatMessage[],
  isChinese: boolean,
): ChatMessage[] {
  return latestMemberMessages(messages);
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
    <View accessibilityLabel={isChinese ? `${members.length} 位协作成员` : `${members.length} collaboration members`} style={styles.collaborationAvatarStack}>
      {members.map((member, index) => (
        <IOSPressable
          accessibilityLabel={isChinese ? `长按 @${member.name}` : `Long press to mention ${member.name}`}
          delayLongPress={220}
          haptic="selection"
          key={member.id}
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
              ? (isChinese ? '任务协作' : 'Task collaboration')
              : (isChinese ? '正在安排协作' : 'Preparing collaboration')}
          </Text>
          {!lifted ? (
            <View style={styles.collaborationLiftDots}>
              {[0, 1, 2].map((dot) => <PendingDot delay={dot * 120} key={dot} />)}
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.collaborationLiftMeta, { color: tokens.colors.textTertiary }]}>
          {lifted
            ? (isChinese ? '成员向 Hermes 回报，由 Hermes 给出最终答复' : 'Members report to Hermes for the final response')
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
