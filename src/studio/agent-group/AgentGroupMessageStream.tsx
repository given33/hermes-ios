import * as Clipboard from 'expo-clipboard';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard as ClipboardIcon,
  FileText,
  RotateCcw,
  Undo2,
  Wrench,
} from 'lucide-react-native';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Markdown from 'react-native-markdown-display';

import type {
  HermesStudioGroupChatMessage,
  HermesStudioRoomAgent,
} from '../../api/hermes-studio';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';

export interface AgentGroupMessageStreamProps {
  agents: HermesStudioRoomAgent[];
  compact: boolean;
  hasEarlierHistory?: boolean;
  /** Resend a failed optimistic message by id (returns its text). */
  onRetryFailed?(messageId: string): void;
  isChinese: boolean;
  loadingEarlier?: boolean;
  messages: HermesStudioGroupChatMessage[];
  onLoadEarlier?(): void;
  onQuickReply?(text: string): void;
  onRetractMessage?(messageId: string): void;
  running: boolean;
  safeAreaBottom: number;
  showToolTrace?: boolean;
  summaryAnchorId?: string;
  userId: string;
}

/**
 * Hermes Studio's group surface has its own message contract and presentation:
 * an agent run is grouped into a card, tool messages are compact expandable
 * rows, and agent/user messages use the group-chat avatar + bubble layout. It
 * intentionally does not import the ordinary chat presentation components.
 */
export function AgentGroupMessageStream({
  agents,
  compact,
  hasEarlierHistory = false,
  onRetryFailed,
  isChinese,
  loadingEarlier = false,
  messages,
  onLoadEarlier,
  onQuickReply,
  onRetractMessage,
  running,
  safeAreaBottom,
  showToolTrace = true,
  summaryAnchorId,
  userId,
}: AgentGroupMessageStreamProps) {
  const { tokens } = useTheme();
  const scrollRef = useRef<FlatList<HermesStudioGroupChatMessage> | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const displayMessages = useMemo(() => groupAgentRunMessages(
    showToolTrace
      ? messages
      : messages.flatMap((message) => {
          if (message.role === 'tool' && message.toolStatus !== 'running') return [];
          if (!message.runItems?.length) return [message];
          const runItems = message.runItems.filter((item) => item.role !== 'tool' || item.toolStatus === 'running');
          return runItems.length ? [{ ...message, runItems }] : [];
        }),
  ), [messages, showToolTrace]);
  // Inverted list contract: index 0 renders at the visual bottom, so feed
  // it newest-first.
  const invertedMessages = useMemo(
    () => [...displayMessages].reverse(),
    [displayMessages],
  );
  const followVersion = useMemo(
    () => displayMessages.map((message) => (
      [
        message.id,
        message.content.length,
        message.reasoning?.length || 0,
        message.reasoning_content?.length || 0,
        message.isStreaming ? 'streaming' : '',
        message.runItems?.map((item) => `${item.id}:${item.content.length}:${item.toolStatus || ''}`).join(',') || '',
      ].join(':')
    )).join('|'),
    [displayMessages],
  );

  const scrollToBottom = useCallback((animated = false) => {
    // Inverted list: offset 0 IS the latest message.
    scrollRef.current?.scrollToOffset({ offset: 0, animated });
    setShowScrollToBottom(false);
  }, []);

  // Auto-follow mirrors the main chat stream: streaming output keeps the
  // latest message visible only while the user is near the bottom. Scrolling
  // up to read history must not yank the view back down.
  const autoFollowRef = useRef(true);

  useEffect(() => {
    if (autoFollowRef.current) scrollToBottom(false);
  }, [followVersion, scrollToBottom]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Inverted list: contentOffset.y grows upwards, so it already IS the
    // distance from the newest message.
    const distance = event.nativeEvent.contentOffset.y;
    autoFollowRef.current = distance <= 72;
    setShowScrollToBottom(distance > 180);
  }, []);

  return (
    <View style={styles.root}>
      <FlatList
        ListEmptyComponent={<GroupEmptyState agents={agents} isChinese={isChinese} />}
        ListFooterComponent={hasEarlierHistory && displayMessages.length > 0 ? (
          <IOSPressable
            accessibilityLabel={isChinese ? '加载剩余历史消息' : 'Load remaining history'}
            disabled={loadingEarlier}
            haptic="selection"
            onPress={() => { onLoadEarlier?.(); }}
            style={{
              alignItems: 'center',
              alignSelf: 'center',
              backgroundColor: multiplyAlpha(tokens.colors.card, 0.9),
              borderColor: multiplyAlpha(tokens.colors.primary, 0.25),
              borderRadius: 14,
              borderWidth: 1,
              paddingHorizontal: 14,
              paddingVertical: 7,
              marginTop: 8,
            }}
          >
            <Text style={{ color: tokens.colors.primary, fontSize: 13 }}>
              {loadingEarlier
                ? (isChinese ? '正在加载…' : 'Loading…')
                : (isChinese ? '加载剩余历史消息' : 'Load remaining history')}
            </Text>
          </IOSPressable>
        ) : null}
        ListHeaderComponent={running && !displayMessages.some((message) => message.isStreaming) ? (
          <GroupRunningIndicator agents={agents} isChinese={isChinese} />
        ) : null}
        contentContainerStyle={[
          styles.list,
          { paddingHorizontal: compact ? 12 : 20, paddingBottom: 20 + safeAreaBottom },
          !displayMessages.length && (compact ? styles.emptyListCompact : styles.emptyList),
        ]}
        data={invertedMessages}
        inverted
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(message) => message.id}
        onContentSizeChange={() => {
          if (autoFollowRef.current) scrollToBottom(false);
        }}
        onScroll={onScroll}
        ref={scrollRef}
        renderItem={({ item }) => (
          <Fragment key={item.id}>
            {item.runItems?.length ? (
              <AgentRunCard agents={agents} isChinese={isChinese} message={item} onQuickReply={onQuickReply} onRetract={onRetractMessage} userId={userId} />
            ) : (
              <AgentGroupMessageItem agents={agents} isChinese={isChinese} message={item} onQuickReply={onQuickReply} onRetract={onRetractMessage} onRetryFailed={onRetryFailed} userId={userId} />
            )}
            {summaryAnchorId && containsMessageId(item, summaryAnchorId) ? (
              <SummaryAnchorDivider isChinese={isChinese} />
            ) : null}
          </Fragment>
        )}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        windowSize={9}
      />
      {showScrollToBottom ? (
        <IOSPressable
          accessibilityLabel={isChinese ? '回到最新群聊消息' : 'Jump to latest group message'}
          onPress={() => {
            autoFollowRef.current = true;
            scrollToBottom(true);
          }}
          style={[styles.scrollButton, { backgroundColor: tokens.colors.card, borderColor: multiplyAlpha(tokens.colors.primary, 0.25) }]}
        >
          <ChevronDown color={tokens.colors.primary} size={18} />
        </IOSPressable>
      ) : null}
    </View>
  );
}

function GroupChoiceOptions({
  content,
  isChinese,
  onQuickReply,
  tokens,
}: {
  content: string;
  isChinese: boolean;
  onQuickReply?(text: string): void;
  tokens: ReturnType<typeof useTheme>['tokens'];
}) {
  const options = useMemo(() => {
    if (!content) return [];
    const found: { id: string; label: string }[] = [];
    const seen = new Set<string>();
    let sawOption = false;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^(选项|options?|choices?)\s*[:：]$/i.test(trimmed)) continue;
      const match = trimmed.match(/^([A-Za-z]|\d{1,2})[.、．:：]\s*(.+)$/);
      if (!match) {
        if (sawOption) break;
        continue;
      }
      const id = match[1].toUpperCase();
      if (seen.has(id)) continue;
      seen.add(id);
      sawOption = true;
      found.push({ id, label: match[2].trim().slice(0, 200) });
      if (found.length >= 4) break;
    }
    return found;
  }, [content]);
  if (!options.length || !onQuickReply) return null;
  return (
    <View style={{ gap: 5, marginTop: 8 }}>
      {options.map((option) => (
        <IOSPressable
          accessibilityLabel={option.label}
          haptic="selection"
          key={option.id}
          onPress={() => onQuickReply(`${option.id}. ${option.label}`)}
          style={[styles.choiceChip, { borderColor: multiplyAlpha(tokens.colors.primary, 0.4) }]}
        >
          <Text style={[styles.choiceChipKey, { color: tokens.colors.primary }]}>{option.id}</Text>
          <Text numberOfLines={2} style={[styles.choiceChipLabel, { color: tokens.colors.textSecondary }]}>
            {option.label}
          </Text>
        </IOSPressable>
      ))}
    </View>
  );
}

function AgentRunCard({
  agents,
  isChinese,
  message,
  onQuickReply,
  onRetract,
  userId,
}: {
  agents: HermesStudioRoomAgent[];
  isChinese: boolean;
  message: HermesStudioGroupChatMessage;
  onQuickReply?(text: string): void;
  onRetract?(messageId: string): void;
  userId: string;
}) {
  const { tokens } = useTheme();
  const agent = findAgent(agents, message);
  const items = message.runItems || [];
  return (
    <View style={styles.runRow}>
      <GroupAvatar agent={agent} name={message.senderName} size={36} />
      <View style={styles.runColumn}>
        <Text style={[styles.senderName, { color: tokens.colors.foreground }]}>{message.senderName || 'Agent'}</Text>
        <View style={[styles.runCard, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.055) }]}>
          {items.map((item) => (
            <AgentGroupMessageItem
              agents={agents}
              embedded
              isChinese={isChinese}
              key={item.id}
              message={item}
              onQuickReply={onQuickReply}
              userId={userId}
            />
          ))}
        </View>
        <Text style={[styles.time, { color: tokens.colors.textTertiary }]}>{formatTimestamp(items[items.length - 1]?.timestamp || message.timestamp)}</Text>
      </View>
    </View>
  );
}

function AgentGroupMessageItem({
  agents,
  embedded = false,
  isChinese,
  message,
  onQuickReply,
  onRetract,
  onRetryFailed,
  userId,
}: {
  agents: HermesStudioRoomAgent[];
  embedded?: boolean;
  isChinese: boolean;
  message: HermesStudioGroupChatMessage;
  onQuickReply?(text: string): void;
  onRetract?(messageId: string): void;
  onRetryFailed?(messageId: string): void;
  userId: string;
}) {
  const { tokens } = useTheme();
  const agent = findAgent(agents, message);
  const isAgent = Boolean(agent) || message.role === 'assistant';
  // Ownership by senderId ONLY: `role === 'user'` also matched OTHER human
  // members' messages, rendering them right-aligned with a retract button
  // the server would reject.
  const isSelf = message.senderId === userId;
  const isError = message.deliveryStatus === 'failed'
    || message.finish_reason === 'error'
    || /^Error:\s*/i.test(message.content || '');
  const [thinkingExpanded, setThinkingExpanded] = useState(Boolean(message.isStreaming && message.reasoning && !message.content));
  const [toolExpanded, setToolExpanded] = useState(false);
  const reasoning = message.reasoning || message.reasoning_content || '';
  const toolName = message.toolName || message.tool_name || 'tool';
  const hasToolDetails = Boolean(reasoning.trim() || message.toolArgs !== undefined || message.toolResult !== undefined);

  const copyMessage = async () => {
    const content = message.content || reasoning;
    if (content.trim()) await Clipboard.setStringAsync(content);
  };

  if (message.role === 'tool') {
    return (
      <View style={[styles.messageRow, embedded && styles.embeddedRow]}>
        {!embedded ? <GroupAvatar agent={agent} name={message.senderName} size={36} /> : null}
        <View style={[styles.messageBody, embedded && styles.embeddedBody]}>
          {!embedded ? <MessageHeader agent={agent} message={message} tokens={tokens} /> : null}
          <IOSPressable
            disabled={!hasToolDetails}
            onPress={() => setToolExpanded((current) => !current)}
            style={styles.toolLine}
          >
            {hasToolDetails ? <ChevronRight color={tokens.colors.textTertiary} size={11} style={toolExpanded ? styles.rotated : undefined} /> : <Wrench color={tokens.colors.textTertiary} size={12} />}
            <Text numberOfLines={1} style={[styles.toolName, { color: tokens.colors.textTertiary }]}>{toolName}</Text>
            {message.toolPreview && !toolExpanded ? <Text numberOfLines={1} style={[styles.toolPreview, { color: tokens.colors.textTertiary }]}>{message.toolPreview}</Text> : null}
            {message.toolStatus === 'running' ? <Text style={[styles.toolSpinner, { color: tokens.colors.primary }]}>◌</Text> : null}
            {message.toolStatus === 'error' ? <Text style={[styles.toolError, { color: tokens.colors.destructive }]}>{isChinese ? '错误' : 'error'}</Text> : null}
          </IOSPressable>
          {toolExpanded && hasToolDetails ? (
            <ToolDetails isChinese={isChinese} message={message} />
          ) : null}
          {!embedded ? <Text style={[styles.time, { color: tokens.colors.textTertiary }]}>{formatTimestamp(message.timestamp)}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.messageRow, embedded && styles.embeddedRow, isSelf && !embedded && styles.selfRow]}>
      {!embedded ? <GroupAvatar agent={agent} name={message.senderName} size={36} /> : null}
      <View style={[styles.messageBody, embedded && styles.embeddedBody, isSelf && !embedded && styles.selfBody]}>
        {!embedded ? <MessageHeader agent={agent} message={message} tokens={tokens} /> : null}
        <View style={[
          styles.content,
          { backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.055) },
          isAgent && { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.06) },
          isSelf && { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.06) },
          isError && { backgroundColor: multiplyAlpha(tokens.colors.destructive, 0.06), borderColor: multiplyAlpha(tokens.colors.destructive, 0.2), borderWidth: 1 },
          embedded && styles.embeddedContent,
        ]}>
          {message.attachments?.length ? <Attachments attachments={message.attachments} /> : null}
          {reasoning.trim() ? (
            <View style={[styles.thinkingBlock, { borderBottomColor: tokens.colors.border }]}>
              <IOSPressable onPress={() => setThinkingExpanded((current) => !current)} style={styles.thinkingHeader}>
                {thinkingExpanded ? <ChevronDown color={tokens.colors.textTertiary} size={11} /> : <ChevronRight color={tokens.colors.textTertiary} size={11} />}
                <Text style={styles.thinkingIcon}>💭</Text>
                <Text style={[styles.thinkingLabel, { color: tokens.colors.textTertiary }]}>{message.isStreaming && !message.content ? (isChinese ? '正在思考' : 'Thinking') : (isChinese ? '推理' : 'Thinking')}</Text>
                <Text style={[styles.thinkingMeta, { color: tokens.colors.textTertiary }]}>· {reasoning.length}</Text>
              </IOSPressable>
              {thinkingExpanded ? <Markdown style={markdownStyles}>{reasoning}</Markdown> : null}
            </View>
          ) : null}
          {message.content.trim() ? <Markdown style={markdownStyles}>{message.content}</Markdown> : null}
          <GroupChoiceOptions
            content={message.content}
            isChinese={isChinese}
            onQuickReply={onQuickReply}
            tokens={tokens}
          />
          {message.isStreaming && !message.content ? <StreamingDots color={tokens.colors.textTertiary} /> : null}
          {message.workspaceChanges?.length ? <WorkspaceChanges isChinese={isChinese} changes={message.workspaceChanges} /> : null}
        </View>
        {!embedded ? (
          <View style={styles.messageMeta}>
            {message.deliveryStatus === 'failed' && onRetryFailed ? (
              <IOSPressable
                accessibilityLabel={isChinese ? '重发这条消息' : 'Resend this message'}
                haptic="selection"
                onPress={() => onRetryFailed(message.id)}
                style={[styles.metaButton, { alignItems: 'center', flexDirection: 'row', gap: 3, paddingHorizontal: 6 }]}
              >
                <RotateCcw color={tokens.colors.primary} size={13} />
                <Text style={{ color: tokens.colors.primary, fontSize: 11, fontWeight: '600' }}>
                  {isChinese ? '重发' : 'Retry'}
                </Text>
              </IOSPressable>
            ) : null}
            {onRetract && isSelf && message.role === 'user' && !message.retracted && !message.deliveryStatus ? (
              <IOSPressable
                accessibilityLabel={isChinese ? '撤回这条群聊消息' : 'Retract this group message'}
                haptic="selection"
                onPress={() => onRetract(message.id)}
                style={styles.metaButton}
              >
                <Undo2 color={tokens.colors.textTertiary} size={13} />
              </IOSPressable>
            ) : null}
            <IOSPressable accessibilityLabel={isChinese ? '复制群聊消息' : 'Copy group message'} onPress={() => { void copyMessage(); }} style={styles.metaButton}>
              <ClipboardIcon color={tokens.colors.textTertiary} size={13} />
            </IOSPressable>
            <Text style={[styles.time, { color: message.deliveryStatus === 'failed' ? tokens.colors.destructive : tokens.colors.textTertiary }]}>
              {message.deliveryStatus === 'failed' ? (isChinese ? '发送失败 · 可重试' : 'Failed to send · retry') : formatTimestamp(message.timestamp)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ToolDetails({ isChinese, message }: { isChinese: boolean; message: HermesStudioGroupChatMessage }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.toolDetails, { borderLeftColor: tokens.colors.border }]}> 
      {message.reasoning?.trim() ? <ToolDetailBlock label={isChinese ? '推理' : 'Thinking'} value={message.reasoning} markdown /> : null}
      {message.toolArgs !== undefined ? <ToolDetailBlock label={isChinese ? '参数' : 'Arguments'} value={formatToolPayload(message.toolArgs)} /> : null}
      {message.toolResult !== undefined ? <ToolDetailBlock label={isChinese ? '结果' : 'Result'} value={formatToolPayload(message.toolResult)} /> : null}
    </View>
  );
}

function ToolDetailBlock({ label, markdown = false, value }: { label: string; markdown?: boolean; value: string }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.toolDetailSection}>
      <Text style={[styles.toolDetailLabel, { color: tokens.colors.textTertiary }]}>{label}</Text>
      {markdown ? <Markdown style={markdownStyles}>{value}</Markdown> : <ScrollView horizontal><Text selectable style={[styles.toolCode, { color: tokens.colors.textSecondary }]}>{value}</Text></ScrollView>}
    </View>
  );
}

function MessageHeader({ agent, message, tokens }: { agent?: HermesStudioRoomAgent; message: HermesStudioGroupChatMessage; tokens: ReturnType<typeof useTheme>['tokens'] }) {
  return (
    <View style={styles.messageHeader}>
      <Text style={[styles.senderName, { color: tokens.colors.foreground }]}>{message.senderName || (agent ? agent.name : 'User')}</Text>
      {agent?.description ? <Text numberOfLines={1} style={[styles.agentDescription, { color: tokens.colors.textTertiary }]}>{agent.description}</Text> : null}
    </View>
  );
}

function Attachments({ attachments }: { attachments: Array<{ id: string; name: string; type: string; size: number; url: string }> }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.attachments}>
      {attachments.map((attachment) => attachment.type.startsWith('image/') ? (
        <Image key={attachment.id} source={{ uri: attachment.url }} style={styles.attachmentImage} />
      ) : (
        <View key={attachment.id} style={[styles.attachmentFile, { backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.04), borderColor: tokens.colors.border }]}>
          <FileText color={tokens.colors.textSecondary} size={16} />
          <Text numberOfLines={1} style={[styles.attachmentName, { color: tokens.colors.textSecondary }]}>{attachment.name}</Text>
          <Text style={[styles.attachmentSize, { color: tokens.colors.textTertiary }]}>{formatBytes(attachment.size)}</Text>
        </View>
      ))}
    </View>
  );
}

function WorkspaceChanges({
  changes,
  isChinese,
}: {
  changes: NonNullable<HermesStudioGroupChatMessage['workspaceChanges']>;
  isChinese: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.workspaceChanges, { borderTopColor: tokens.colors.border }]}>
      <Text style={[styles.workspaceChangesTitle, { color: tokens.colors.textSecondary }]}>🗂️ {isChinese ? '工作区变更' : 'Workspace changes'}</Text>
      {changes.flatMap((change) => change.files.slice(0, 20).map((file) => (
        <View key={`${change.change_id}:${String(file.id)}:${file.path}`} style={styles.workspaceChangeRow}>
          <Text numberOfLines={1} style={[styles.workspaceChangePath, { color: tokens.colors.foreground }]}>{file.path}</Text>
          <Text style={[styles.workspaceChangeMeta, { color: tokens.colors.textTertiary }]}>
            {file.change_type || 'modified'} · +{file.additions} −{file.deletions}
          </Text>
        </View>
      )))}
      {changes.some((change) => change.truncated) ? <Text style={[styles.workspaceChangeMeta, { color: tokens.colors.textTertiary }]}>{isChinese ? '部分变更被服务端截断' : 'Some changes were truncated by the server'}</Text> : null}
    </View>
  );
}

function GroupAvatar({ agent, name, size }: { agent?: HermesStudioRoomAgent; name: string; size: number }) {
  const { tokens } = useTheme();
  const label = (agent?.name || agent?.agent || name || 'A').slice(0, 1).toUpperCase();
  const color = agentColor(agent?.agent || name, tokens.colors.primary);
  if (agent?.avatar && /^(data:|https?:\/\/)/.test(agent.avatar)) {
    return <Image source={{ uri: agent.avatar }} style={[styles.avatar, { height: size, width: size }]} />;
  }
  return (
    <View style={[styles.avatar, { backgroundColor: multiplyAlpha(color, 0.18), height: size, width: size }]}> 
      <Text style={[styles.avatarText, { color, fontSize: Math.max(12, size * 0.38) }]}>{label}</Text>
    </View>
  );
}

function GroupEmptyState({ agents, isChinese }: { agents: HermesStudioRoomAgent[]; isChinese: boolean }) {
  const { tokens } = useTheme();
  const emptyAgents = agents.slice(0, 4);
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyAvatars}>
        {emptyAgents.length ? emptyAgents.map((agent) => <GroupAvatar agent={agent} name={agent.name} key={agent.id} size={44} />) : <GroupAvatar name="Hermes" size={44} />}
      </View>
      <Text style={[styles.emptyTitle, { color: tokens.colors.foreground }]}>{isChinese ? 'Hermes Studio Agent 群聊' : 'Hermes Studio Agent group chat'}</Text>
      <Text style={[styles.emptyText, { color: tokens.colors.textSecondary }]}>{isChinese ? '发送消息或 @mention 指定 Agent；每个房间有自己的上下文、成员和运行状态。' : 'Send a message or @mention an Agent; every room owns its own context, members, and run state.'}</Text>
    </View>
  );
}

function GroupRunningIndicator({ agents, isChinese }: { agents: HermesStudioRoomAgent[]; isChinese: boolean }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.runningRow}>
      <GroupAvatar agent={agents[0]} name={agents[0]?.name || 'Agent'} size={28} />
      <Text style={[styles.runningText, { color: tokens.colors.textTertiary }]}>{isChinese ? 'Agent 正在处理…' : 'Agent is working…'}</Text>
      <StreamingDots color={tokens.colors.textTertiary} />
    </View>
  );
}

function SummaryAnchorDivider({ isChinese }: { isChinese: boolean }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.summaryDivider}>
      <View style={[styles.summaryLine, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.22) }]} />
      <View style={[styles.summaryPill, { backgroundColor: tokens.colors.card, borderColor: multiplyAlpha(tokens.colors.primary, 0.22) }]}>
        <Check color={tokens.colors.primary} size={13} />
        <Text style={[styles.summaryPillText, { color: tokens.colors.textSecondary }]}>{isChinese ? '以上消息已纳入上下文摘要' : 'Messages above are in the context summary'}</Text>
      </View>
      <View style={[styles.summaryLine, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.22) }]} />
    </View>
  );
}

function StreamingDots({ color }: { color: string }) {
  return <Text style={[styles.streamingDots, { color }]}>•••</Text>;
}

function findAgent(agents: HermesStudioRoomAgent[], message: HermesStudioGroupChatMessage): HermesStudioRoomAgent | undefined {
  return agents.find((agent) => agent.agentId === message.senderId || agent.name === message.senderName);
}

function groupAgentRunMessages(messages: HermesStudioGroupChatMessage[]): HermesStudioGroupChatMessage[] {
  const result: HermesStudioGroupChatMessage[] = [];
  const grouped = new Map<string, HermesStudioGroupChatMessage>();
  for (const message of messages) {
    const runId = message.run_id || '';
    if (!runId || (message.role !== 'assistant' && message.role !== 'tool')) {
      result.push(message);
      continue;
    }
    const key = `${message.senderId}\u0000${runId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.runItems = [...(existing.runItems || []), message];
      existing.isStreaming = Boolean(existing.isStreaming || message.isStreaming || message.toolStatus === 'running');
      continue;
    }
    const run: HermesStudioGroupChatMessage = {
      ...message,
      id: `group-agent-run:${message.senderId}:${runId}`,
      role: 'agent_run',
      content: '',
      reasoning: null,
      reasoning_content: null,
      tool_calls: null,
      runItems: [message],
      isStreaming: Boolean(message.isStreaming || message.toolStatus === 'running'),
    };
    grouped.set(key, run);
    result.push(run);
  }
  for (const run of grouped.values()) run.runItems?.sort((left, right) => left.timestamp - right.timestamp);
  return result;
}

function containsMessageId(message: HermesStudioGroupChatMessage, id: string): boolean {
  return message.id === id || Boolean(message.runItems?.some((item) => item.id === id));
}

function formatToolPayload(value: unknown): string {
  if (typeof value === 'string') return value.length > 2_000 ? `${value.slice(0, 2_000)}\n…` : value;
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 2_000 ? `${text.slice(0, 2_000)}\n…` : text;
  } catch {
    return String(value);
  }
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value || 0} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(value: number): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function agentColor(seed: string, fallback: string): string {
  if (seed.toLowerCase().includes('codex')) return '#2563eb';
  if (seed.toLowerCase().includes('claude')) return '#a855f7';
  if (seed.toLowerCase().includes('ekko')) return '#0f766e';
  return fallback;
}

const markdownStyles = {
  body: { color: '#1f2937', fontSize: 13, lineHeight: 21 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  strong: { fontWeight: '700' as const },
  code_inline: { backgroundColor: 'rgba(15,23,42,0.08)', borderRadius: 4, paddingHorizontal: 3 },
  code_block: { backgroundColor: 'rgba(15,23,42,0.07)', borderRadius: 6, padding: 8 },
  fence: { backgroundColor: 'rgba(15,23,42,0.07)', borderRadius: 6, padding: 8 },
  bullet_list: { marginBottom: 6 },
  ordered_list: { marginBottom: 6 },
  list_item: { marginBottom: 3 },
};

const styles = {
  choiceChip: { alignItems: 'center' as const, borderRadius: 8, borderWidth: 1, flexDirection: 'row' as const, gap: 8, paddingHorizontal: 10, paddingVertical: 7 },
  choiceChipKey: { fontSize: 12, fontWeight: '700' as const },
  choiceChipLabel: { flex: 1, fontSize: 12 },

  root: { flex: 1, minHeight: 0 },
  list: { gap: 12, flexGrow: 1, paddingTop: 16 },
  emptyList: { justifyContent: 'center' as const },
  emptyListCompact: { justifyContent: 'flex-start' as const, paddingTop: 24 },
  emptyState: { alignItems: 'center' as const, gap: 10, maxWidth: 560, paddingHorizontal: 24, alignSelf: 'center' as const },
  emptyAvatars: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 5, marginBottom: 3 },
  emptyTitle: { fontSize: 14, fontWeight: '700' as const, textAlign: 'center' as const },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: 'center' as const },
  scrollButton: { alignItems: 'center' as const, borderRadius: 999, borderWidth: 1, bottom: 18, height: 38, justifyContent: 'center' as const, position: 'absolute' as const, right: 18, width: 38 },
  messageRow: { alignItems: 'flex-start' as const, flexDirection: 'row' as const, gap: 10, maxWidth: '100%' as const, minWidth: 0, paddingVertical: 2 },
  embeddedRow: { gap: 0, paddingVertical: 0 },
  selfRow: { flexDirection: 'row-reverse' as const },
  avatar: { alignItems: 'center' as const, borderRadius: 8, justifyContent: 'center' as const, overflow: 'hidden' as const },
  avatarText: { fontWeight: '800' as const },
  messageBody: { flexDirection: 'column' as const, maxWidth: '85%' as const, minWidth: 0 },
  embeddedBody: { maxWidth: '100%' as const, width: '100%' as const },
  selfBody: { alignItems: 'flex-end' as const },
  messageHeader: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 8, paddingBottom: 2 },
  senderName: { fontSize: 13, fontWeight: '600' as const },
  agentDescription: { flexShrink: 1, fontSize: 11, fontStyle: 'italic' as const },
  content: { borderRadius: 10, minWidth: 0, paddingHorizontal: 14, paddingVertical: 10 },
  embeddedContent: { backgroundColor: 'transparent', borderRadius: 0, paddingHorizontal: 10, paddingVertical: 8 },
  thinkingBlock: { borderBottomWidth: 1, borderStyle: 'dashed' as const, marginBottom: 8, paddingVertical: 4 },
  thinkingHeader: { alignItems: 'center' as const, borderRadius: 5, flexDirection: 'row' as const, gap: 5, paddingHorizontal: 4, paddingVertical: 2 },
  rotated: { transform: [{ rotate: '90deg' }] },
  thinkingIcon: { fontSize: 11 },
  thinkingLabel: { fontSize: 11, fontWeight: '500' as const },
  thinkingMeta: { fontSize: 10 },
  messageMeta: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 5, marginTop: 4, paddingHorizontal: 4 },
  metaButton: { alignItems: 'center' as const, borderRadius: 4, height: 24, justifyContent: 'center' as const, width: 24 },
  time: { fontSize: 11, opacity: 0.65 },
  attachments: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 8 },
  attachmentImage: { borderRadius: 5, height: 96, width: 96 },
  attachmentFile: { alignItems: 'center' as const, borderRadius: 5, borderWidth: 1, flexDirection: 'row' as const, gap: 6, maxWidth: 220, minWidth: 140, paddingHorizontal: 9, paddingVertical: 8 },
  attachmentName: { flex: 1, fontSize: 11 },
  attachmentSize: { fontSize: 10 },
  workspaceChanges: { borderTopWidth: 1, gap: 4, marginTop: 8, paddingTop: 7 },
  workspaceChangesTitle: { fontSize: 10, fontWeight: '700' as const },
  workspaceChangeRow: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 6 },
  workspaceChangePath: { flex: 1, fontFamily: 'monospace', fontSize: 10 },
  workspaceChangeMeta: { fontSize: 9 },
  toolLine: { alignItems: 'center' as const, borderRadius: 5, flexDirection: 'row' as const, gap: 6, maxWidth: '100%' as const, paddingHorizontal: 4, paddingVertical: 3 },
  toolName: { flexShrink: 0, fontFamily: 'monospace', fontSize: 11 },
  toolPreview: { flex: 1, fontSize: 11 },
  toolSpinner: { fontSize: 14 },
  toolError: { fontSize: 9 },
  toolDetails: { borderLeftWidth: 2, marginLeft: 16, marginTop: 2, paddingLeft: 10 },
  toolDetailSection: { marginBottom: 7 },
  toolDetailLabel: { fontSize: 10, marginBottom: 3 },
  toolCode: { fontFamily: 'monospace', fontSize: 10, lineHeight: 15 },
  streamingDots: { fontSize: 17, letterSpacing: 3, paddingVertical: 4 },
  runRow: { alignItems: 'flex-start' as const, flexDirection: 'row' as const, gap: 10, maxWidth: '100%' as const, paddingVertical: 2 },
  runColumn: { flexDirection: 'column' as const, minWidth: 0, width: '85%' as const },
  runCard: { borderRadius: 10, minWidth: 0, overflow: 'visible' as const },
  runningRow: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 8, paddingVertical: 2 },
  runningText: { fontSize: 11 },
  summaryDivider: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 10, marginVertical: 8, width: '100%' as const },
  summaryLine: { flex: 1, height: 1 },
  summaryPill: { alignItems: 'center' as const, borderRadius: 999, borderWidth: 1, flexDirection: 'row' as const, gap: 5, paddingHorizontal: 10, paddingVertical: 6 },
  summaryPillText: { fontSize: 10 },
};
