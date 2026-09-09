import { ChevronDown } from 'lucide-react-native';
import { Fragment, type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, type ScrollViewProps, Text, View } from 'react-native';
import Reanimated, { Easing, FadeIn, useSharedValue, type SharedValue } from 'react-native-reanimated';

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
import { chatMemberKey, compactChatMessages } from './chat-member-model';
import { WorkflowEntrance } from './WorkflowEntrance';
import { ConversationTimeline } from './ConversationTimeline';
import { buildConversationTimeline, type ConversationTimelineAnchor, type ConversationTimelineEntry } from './conversation-timeline-model';

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
  onContentSizeChange?: ScrollViewProps['onContentSizeChange'];
  onStreamLayout?: ScrollViewProps['onLayout'];
  onScrollBeginDrag?: ScrollViewProps['onScrollBeginDrag'];
  scrollOffset?: SharedValue<number>;
  onScrollToOffset?(offset: number): void;
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
  streamRef: RefObject<Reanimated.ScrollView | null>;
  keepLatestVisible(animated?: boolean, force?: boolean): void;
}

export function ChatMessageStream({
  collaborationStartIndex,
  collaborationState,
  compact,
  hostedRunning,
  isChinese,
  keepLatestVisible,
  messages: sourceMessages,
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
  onContentSizeChange: onStreamContentSizeChange,
  onStreamLayout,
  onScrollBeginDrag,
  scrollOffset,
  onScrollToOffset,
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
  const messages = useMemo(() => compactChatMessages(sourceMessages), [sourceMessages]);
  const lastTodoIndices = new Map<string, number>();
  for (let position = messages.length - 1; position >= 0; position -= 1) {
    const message = messages[position];
    if (message.role !== 'user' && message.todos?.length) {
      const key = `${message.runtimeTurnId || ''}:${chatMemberKey(message)}`;
      if (!lastTodoIndices.has(key)) lastTodoIndices.set(key, position);
    }
  }
  const { tokens } = useTheme();
  const timelineContentHeight = useSharedValue(0);
  const timelineViewportHeight = useSharedValue(0);
  const onContentSizeChange = useCallback((width: number, height: number) => {
    timelineContentHeight.value = height;
    if (onStreamContentSizeChange) onStreamContentSizeChange(width, height);
    else keepLatestVisible(true);
  }, [keepLatestVisible, onStreamContentSizeChange, timelineContentHeight]);
  const onLayout = useCallback<NonNullable<ScrollViewProps['onLayout']>>(event => {
    timelineViewportHeight.value = event.nativeEvent.layout.height;
    onStreamLayout?.(event);
  }, [onStreamLayout, timelineViewportHeight]);

  const previousTurns = useRef<readonly ConversationTimelineEntry[]>([]);
  const userTurns = buildConversationTimeline(messages, previousTurns.current);
  previousTurns.current = userTurns;
  const turnAnchors = useSharedValue<ConversationTimelineAnchor[]>([]);
  const fallbackOffset = useSharedValue(0);
  const layoutFrame = useRef<number | null>(null);
  // Turn map: y-offsets of every user-turn boundary, captured at layout so
  // the side rail can scroll the stream to any past turn on tap. Pruned to
  // the current message ids on every change so a conversation switch (or
  // deletion) cannot leave stale offsets behind — and the map stays bounded.
  const turnOffsetsRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const live = new Set(userTurns.map(turn => turn.id));
    for (const key of turnOffsetsRef.current.keys()) {
      if (!live.has(key)) turnOffsetsRef.current.delete(key);
    }
    turnAnchors.value = userTurns.flatMap(turn => {
      const y = turnOffsetsRef.current.get(turn.id);
      return y === undefined ? [] : [{ id: turn.id, y }];
    });
  }, [userTurns, turnAnchors]);
  useEffect(() => () => { if (layoutFrame.current !== null) cancelAnimationFrame(layoutFrame.current); }, []);
  const markTurnOffset = useCallback((id: string) => (event: { nativeEvent: { layout: { y: number } } }) => {
    turnOffsetsRef.current.set(id, event.nativeEvent.layout.y);
    if (layoutFrame.current !== null) return;
    layoutFrame.current = requestAnimationFrame(() => {
      layoutFrame.current = null;
      turnAnchors.value = previousTurns.current.flatMap(turn => {
        const y = turnOffsetsRef.current.get(turn.id);
        return y === undefined ? [] : [{ id: turn.id, y }];
      });
    });
  }, [turnAnchors]);
  const scrollToTurn = useCallback((id: string) => {
    const offset = turnOffsetsRef.current.get(id);
    if (offset === undefined) return;
    onInspectActivity();
    if (onScrollToOffset) onScrollToOffset(Math.max(0, offset - 12));
    else streamRef.current?.scrollTo({ y: Math.max(0, offset - 12), animated: true });
  }, [onInspectActivity, onScrollToOffset, streamRef]);
  return (
    <>
      <Reanimated.ScrollView
        contentContainerStyle={[
          styles.streamContent,
          {
            paddingBottom: 22,
            paddingLeft: (compact ? 12 : 20) + safeAreaLeft,
            paddingRight: (userTurns.length > 1 ? 48 : compact ? 12 : 20) + safeAreaRight,
          },
          messages.length === 0 && styles.emptyStream,
        ]}
        decelerationRate="normal"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={onContentSizeChange}
        onLayout={onLayout}
        onScrollBeginDrag={Platform.OS === 'web' ? onScrollBeginDrag : undefined}
        onScroll={onScroll}
        ref={streamRef}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={styles.stream}
      >
        {messages.length > 0 && (hostedRunning || sending) ? (
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
              <View collapsable={false} onLayout={markTurnOffset(messageReactKey(message))} style={{ height: 0 }} />
            ) : null}
            {collaborationState === 'active' && collaborationStartIndex === index ? (
              <>
                <CollaborationLiftNotice
                  isChinese={isChinese}
                  messages={messages}
                  onMentionMember={onMentionMember}
                  state="active"
                />
              </>
            ) : null}
            <UnifiedMessage
              index={index}
              isChinese={isChinese}
              message={message}
              showTodos={index === lastTodoIndices.get(`${message.runtimeTurnId || ''}:${chatMemberKey(message)}`)}
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
      </Reanimated.ScrollView>

      {!slashMenuOpen ? <ConversationTimeline entries={userTurns} anchors={turnAnchors}
        contentHeight={timelineContentHeight} viewportHeight={timelineViewportHeight}
        offset={scrollOffset || fallbackOffset} isChinese={isChinese} right={safeAreaRight}
        onSelect={scrollToTurn} /> : null}
      {showScrollToBottom && !slashMenuOpen ? (
        <WorkflowEntrance
          style={[styles.scrollToBottomWrap, { bottom: 86 + safeAreaBottom }]}
        >
          <IOSPressable
            accessibilityLabel={isChinese ? '回到最新消息' : 'Jump to latest message'}
            accessibilityRole="button"
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
        </WorkflowEntrance>
      ) : null}
    </>
  );
}

function messageReactKey(message: ChatMessage): string {
  // Retain the mounted row across live-to-durable ID reconciliation.
  return message.renderKey || message.id;
}
