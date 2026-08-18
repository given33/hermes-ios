import { ChevronDown } from 'lucide-react-native';
import { Fragment, type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollView, type ScrollViewProps, Text, View } from 'react-native';
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
  TeamStatusBar,
} from './ChatPresentation';
import { CollaborationLiftNotice } from './ChatCollaborationPresentation';
import { styles } from './chat-presentation-styles';
import type { PendingPhase } from './chat-types';
import type { HostedRuntimeProjection } from '../../api/hosted-runtime-types';

const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);

export interface ChatMessageStreamProps {
  collaborationStartIndex: number;
  collaborationState: ConversationCollaborationState;
  compact: boolean;
  hostedRunning: boolean;
  isChinese: boolean;
  messages: ChatMessage[];
  onBranch(message: ChatMessage): void;
  onChoiceInputFocus(): void;
  onCloseActivity(): void;
  onInspectActivity(): void;
  onJumpToLatest(): void;
  onMentionMember(message: ChatMessage): void;
  onOpenAttachment(attachment: StoredChatAttachment, share?: boolean): void;
  onRespondToChoice?(activityId: string, text: string): void;
  onSteerSubagent?(subagentId: string, message: string): void;
  onStopSubagent?(subagentId: string): void;
  onScroll: ScrollViewProps['onScroll'];
  onToggleSpeech(message: ChatMessage): void;
  pendingPhase: PendingPhase;
  pendingStartedAt: number;
  reconnectAttempt: number;
  runtime?: HostedRuntimeProjection;
  safeAreaBottom: number;
  safeAreaLeft?: number;
  safeAreaRight?: number;
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
  onChoiceInputFocus,
  onCloseActivity,
  onInspectActivity,
  onJumpToLatest,
  onMentionMember,
  onOpenAttachment,
  onRespondToChoice,
  onSteerSubagent,
  onStopSubagent,
  onScroll,
  onToggleSpeech,
  pendingPhase,
  pendingStartedAt,
  reconnectAttempt,
  runtime,
  safeAreaBottom,
  safeAreaLeft = 0,
  safeAreaRight = 0,
  sending,
  showScrollToBottom,
  slashMenuOpen,
  speakingMessageId,
  streamRef,
}: ChatMessageStreamProps) {
  // Only the newest todo snapshot renders a checklist; every older
  // assistant message that carried one stays quiet so history cannot show
  // several stale lists or double-count the same tasks.
  let lastTodoIndex = -1;
  for (let position = messages.length - 1; position >= 0; position -= 1) {
    const message = messages[position];
    if (message.role !== 'user' && message.todos?.length) {
      lastTodoIndex = position;
      break;
    }
  }
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

  const userTurns = useMemo(
    () => messages
      .map((message, index) => ({ id: message.id, index, isUser: message.role === 'user' }))
      .filter((item) => item.isUser),
    [messages],
  );
  // Turn map: y-offsets of every user-turn boundary, captured at layout so
  // the side rail can scroll the stream to any past turn on tap.
  const turnOffsetsRef = useRef<Map<string, number>>(new Map());
  const markTurnOffset = useCallback((id: string) => (event: { nativeEvent: { layout: { y: number } } }) => {
    turnOffsetsRef.current.set(id, event.nativeEvent.layout.y);
  }, []);
  const scrollToTurn = useCallback((id: string) => {
    const offset = turnOffsetsRef.current.get(id);
    if (offset === undefined) return;
    streamRef.current?.scrollTo({ y: Math.max(0, offset - 12), animated: true });
  }, []);
  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.streamContent,
          {
            paddingBottom: 22,
            paddingLeft: (compact ? 12 : 20) + safeAreaLeft,
            paddingRight: (compact ? 12 : 20) + safeAreaRight,
          },
          messages.length === 0 && styles.emptyStream,
        ]}
        decelerationRate="normal"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => keepLatestVisible(false)}
        onScroll={onScroll}
        ref={streamRef}
        scrollEventThrottle={8}
        showsVerticalScrollIndicator={false}
        style={styles.stream}
      >
        {messages.length > 0 ? (
          <TeamStatusBar
            isChinese={isChinese}
            messages={messages}
            reconnectAttempt={reconnectAttempt}
            runtime={runtime}
            onSteerSubagent={onSteerSubagent}
            onStopSubagent={onStopSubagent}
          />
        ) : null}
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
          // One checklist for the whole history: the newest snapshot wins.
          // Older assistant messages keep their todos in the view model for
          // inspection, but only the last carrier renders a TodoSection.
          <Fragment key={messageReactKey(message)}>
            {message.role === 'user' ? (
              <View collapsable={false} onLayout={markTurnOffset(message.id)} style={{ height: 0 }} />
            ) : null}
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
              showTodos={index === lastTodoIndex}
              onBranch={onBranch}
              onChoiceInputFocus={onChoiceInputFocus}
              onCloseActivity={onCloseActivity}
              onInspectActivity={onInspectActivity}
              onMentionMember={onMentionMember}
              onOpenAttachment={onOpenAttachment}
              onRespondToChoice={onRespondToChoice}
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

      {userTurns.length > 1 ? (
        <View
          pointerEvents="box-none"
          style={{
            bottom: 12,
            gap: 3,
            justifyContent: 'space-between',
            position: 'absolute',
            right: 0,
            top: 12,
            width: 20,
            alignItems: 'center',
          }}
        >
          {userTurns.map((turn, position) => (
            <IOSPressable
              accessibilityLabel={isChinese ? `跳转到第 ${position + 1} 轮` : `Jump to turn ${position + 1}`}
              haptic="selection"
              key={turn.id}
              onPress={() => scrollToTurn(turn.id)}
              style={{
                alignItems: 'center',
                borderRadius: 6,
                height: 14,
                justifyContent: 'center',
                paddingHorizontal: 6,
                width: 20,
              }}
            >
              <View
                style={{
                  borderRadius: 2,
                  height: Math.max(3, 14 / userTurns.length),
                  opacity: position === userTurns.length - 1 ? 0.95 : 0.4,
                  width: 3,
                  backgroundColor: position === userTurns.length - 1
                    ? tokens.colors.primary
                    : tokens.colors.textTertiary,
                }}
              />
            </IOSPressable>
          ))}
        </View>
      ) : null}
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
  // `id` is the canonical message identity after the conversation reducer has
  // reconciled live and durable projections. Keying by role/turn/stage made
  // two legitimate dispatcher or progress messages collide, which caused
  // React to reuse rows, jump the scroll position, and sometimes render an
  // echo twice. Keep the key tied to the durable id for every role.
  return message.id;
}
