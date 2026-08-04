import { ChevronDown } from 'lucide-react-native';
import { Fragment, type RefObject, useEffect } from 'react';
import { ScrollView, type ScrollViewProps, Text } from 'react-native';
import Reanimated, { Easing, FadeIn } from 'react-native-reanimated';

import {
  shouldRenderPendingMessage,
  type ConversationCollaborationState,
  type HermesChatAttachment as StoredChatAttachment,
  type HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { StudioOfficialAvatar } from '../../components/studio/StudioOfficialAvatar';
import { useTheme } from '../../design/ThemeProvider';
import { IOS_MOTION } from '../../design/ios-motion';
import { TeamParticipantsStrip } from '../TeamParticipants';
import {
  PendingMessage,
  UnifiedMessage,
} from './ChatPresentation';
import { CollaborationLiftNotice } from './ChatCollaborationPresentation';
import { styles } from './chat-presentation-styles';
import type { PendingPhase } from './chat-types';

const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);

export interface ChatMessageStreamProps {
  collaborationStartIndex: number;
  collaborationState: ConversationCollaborationState;
  compact: boolean;
  hostedRunning: boolean;
  isChinese: boolean;
  messages: ChatMessage[];
  onBranch(message: ChatMessage): void;
  onInspectActivity(): void;
  onJumpToLatest(): void;
  onMentionMember(message: ChatMessage): void;
  onOpenAttachment(attachment: StoredChatAttachment, share?: boolean): void;
  onScroll: ScrollViewProps['onScroll'];
  onToggleSpeech(message: ChatMessage): void;
  pendingPhase: PendingPhase;
  pendingStartedAt: number;
  reconnectAttempt: number;
  safeAreaBottom: number;
  sending: boolean;
  showScrollToBottom: boolean;
  slashMenuOpen: boolean;
  speakingMessageId: string;
  streamRef: RefObject<ScrollView | null>;
  keepLatestVisible(animated?: boolean, force?: boolean): void;
}

export function ChatMessageStream({
  collaborationStartIndex,
  collaborationState,
  compact,
  hostedRunning,
  isChinese,
  keepLatestVisible,
  messages,
  onBranch,
  onInspectActivity,
  onJumpToLatest,
  onMentionMember,
  onOpenAttachment,
  onScroll,
  onToggleSpeech,
  pendingPhase,
  pendingStartedAt,
  reconnectAttempt,
  safeAreaBottom,
  sending,
  showScrollToBottom,
  slashMenuOpen,
  speakingMessageId,
  streamRef,
}: ChatMessageStreamProps) {
  const { tokens } = useTheme();
  const latestMessage = messages[messages.length - 1];
  const followVersion = [
    messages.length,
    latestMessage?.id || '',
    latestMessage?.content.length || 0,
    latestMessage?.status || '',
    latestMessage?.activities?.length || 0,
    latestMessage?.activities?.reduce((total, activity) => (
      total + (activity.output?.length || 0) + (activity.preview?.length || 0)
    ), 0) || 0,
  ].join(':');

  useEffect(() => {
    keepLatestVisible(false);
  }, [followVersion, keepLatestVisible]);

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.streamContent,
          {
            paddingBottom: 22,
            paddingHorizontal: compact ? 12 : 20,
          },
          messages.length === 0 && styles.emptyStream,
        ]}
        decelerationRate="normal"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
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
            <StudioOfficialAvatar size={58} style={styles.welcomeOrb} />
            <Text style={[styles.welcomeTitle, { color: tokens.colors.foreground }]}>Hermes</Text>
            <Text style={[styles.welcomeBody, { color: tokens.colors.textSecondary }]}>
              {isChinese ? '新对话' : 'New conversation'}
            </Text>
          </Reanimated.View>
        ) : messages.map((message, index) => (
          <Fragment key={messageReactKey(message)}>
            {collaborationState === 'active' && collaborationStartIndex === index ? (
              <>
                <CollaborationLiftNotice
                  isChinese={isChinese}
                  messages={messages}
                  onMentionMember={onMentionMember}
                  state="active"
                />
                <TeamParticipantsStrip events={messages} isChinese={isChinese} />
              </>
            ) : null}
            <UnifiedMessage
              index={index}
              isChinese={isChinese}
              message={message}
              onBranch={onBranch}
              onInspectActivity={onInspectActivity}
              onMentionMember={onMentionMember}
              onOpenAttachment={onOpenAttachment}
              onToggleSpeech={onToggleSpeech}
              speaking={speakingMessageId === message.id}
            />
          </Fragment>
        ))}
        {collaborationState !== 'single'
          && (collaborationState === 'lifting' || collaborationStartIndex < 0) ? (
            <CollaborationLiftNotice
              isChinese={isChinese}
              messages={messages}
              onMentionMember={onMentionMember}
              state={collaborationState}
            />
          ) : null}
        {shouldRenderPendingMessage(messages, hostedRunning || sending) ? (
          <PendingMessage
            index={messages.length}
            isChinese={isChinese}
            phase={pendingPhase}
            reconnectAttempt={reconnectAttempt}
            startedAt={pendingStartedAt}
          />
        ) : null}
      </ScrollView>

      {showScrollToBottom && !slashMenuOpen ? (
        <Reanimated.View
          entering={FadeIn.duration(IOS_MOTION.duration.control)}
          style={[styles.scrollToBottomWrap, { bottom: 86 + safeAreaBottom }]}
        >
          <IOSPressable
            accessibilityLabel={isChinese ? '回到最新消息' : 'Jump to latest message'}
            onPress={onJumpToLatest}
            style={[
              styles.scrollToBottom,
              {
                backgroundColor: tokens.colors.card,
                borderColor: tokens.colors.border,
              },
            ]}
          >
            <ChevronDown color={tokens.colors.textSecondary} size={17} strokeWidth={1.8} />
          </IOSPressable>
        </Reanimated.View>
      ) : null}
    </>
  );
}

function messageReactKey(message: ChatMessage): string {
  if (message.runtimeTurnId) {
    return `${message.role}:${message.runtimeTurnId}:${message.roleStage || 'chat'}`;
  }
  return message.id;
}
