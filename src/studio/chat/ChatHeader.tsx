import { Code2, Menu, MessageSquare, Users, History } from 'lucide-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { HermesChatViewMessage as ChatMessage } from '../../api/chat-view-model';
import type { SidebarGatewayStatus } from '../../app/NativeShell';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { StudioOfficialAvatar } from '../../components/studio/StudioOfficialAvatar';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { CollaborationMemberStack } from './ChatCollaborationPresentation';
import { styles } from './chat-presentation-styles';
import { latestMemberMessages } from './chat-member-model';

export type ChatMode = 'single' | 'agent-group' | 'coding';

export interface ChatHeaderProps {
  chatMode: ChatMode;
  collaborationState: 'active' | 'lifting' | 'single';
  compact: boolean;
  gatewayStatuses: readonly SidebarGatewayStatus[];
  isChinese: boolean;
  messages: readonly ChatMessage[];
  onMentionMember(message: ChatMessage): void;
  onChangeChatMode(mode: ChatMode): void;
  onOpenConversations(): void;
  onOpenNavigation(): void;
  safeAreaLeft: number;
  safeAreaRight: number;
  safeAreaTop: number;
  sending: boolean;
  showCollaborationHeaderCount: boolean;
}

export function ChatHeader({
  chatMode, collaborationState, compact, gatewayStatuses, isChinese, messages,
  onMentionMember, onChangeChatMode, onOpenConversations, onOpenNavigation,
  safeAreaLeft, safeAreaRight, safeAreaTop, showCollaborationHeaderCount,
}: ChatHeaderProps) {
  const { tokens } = useTheme();
  const [availableWidth, setAvailableWidth] = useState(0);
  const stacked = compact || availableWidth < 900;
  const modes = (
    <View
      testID="chat-mode-switch"
      accessibilityLabel={isChinese ? '切换聊天模式' : 'Switch chat mode'}
      style={[styles.chatModes, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}
    >
      {([
        { mode: 'single', Icon: MessageSquare, label: isChinese ? '聊天' : 'Chat', accessibilityLabel: isChinese ? '切换到普通聊天' : 'Switch to chat' },
        { mode: 'agent-group', Icon: Users, label: isChinese ? 'Agent 群聊' : 'Agent group', accessibilityLabel: isChinese ? '切换到 Hermes Studio Agent 群聊' : 'Switch to Hermes Studio Agent group chat' },
        { mode: 'coding', Icon: Code2, label: 'Coding', accessibilityLabel: isChinese ? '切换到 Coding Pi' : 'Switch to Coding Pi' },
      ] as const).map(({ mode, Icon, label, accessibilityLabel }) => (
        <IOSPressable
          accessibilityLabel={accessibilityLabel} accessibilityRole="button"
          accessibilityState={{ selected: chatMode === mode }} key={mode}
          onPress={() => onChangeChatMode(mode)}
          pressedStyle={{ backgroundColor: tokens.colors.accent }}
          style={[styles.chatMode, { backgroundColor: chatMode === mode ? tokens.colors.accent : 'transparent' }]}
        >
          <Icon color={tokens.colors.foreground} size={14} />
          <Text style={{ color: tokens.colors.foreground, fontSize: 11 }}>{label}</Text>
        </IOSPressable>
      ))}
    </View>
  );
  const hosts = gatewayStatuses.length ? (
    <View testID="chat-host-matrix" style={[styles.gatewayStatuses, stacked && { width: '100%' }]}>
      {gatewayStatuses.map((gateway) => (
        <View key={gateway.id} testID={`chat-host-${gateway.id}`} style={styles.gatewayStatusRow}>
          <View
            accessibilityLabel={`${gateway.label} ${gateway.state}`}
            style={[styles.gatewayStatusDot, { marginTop: 4, backgroundColor: gateway.state === 'online'
              ? tokens.colors.success : gateway.state === 'degraded' ? tokens.colors.warning
                : gateway.state === 'offline' ? tokens.colors.destructive : tokens.colors.textDisabled }]}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.gatewayStatusLabel, { color: tokens.colors.textSecondary }]}>{gateway.label}</Text>
            <Text style={[styles.gatewayStatusVersion, { color: tokens.colors.textTertiary }]}>
              {gateway.version?.split(' ')[0] || (isChinese ? '版本未知' : 'Version unknown')}
            </Text>
          </View>
        </View>
      ))}
    </View>
  ) : null;

  return (
    <View
      testID="chat-header"
      onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
      style={[styles.header, {
        backgroundColor: multiplyAlpha(tokens.colors.background, 0.92), borderBottomColor: tokens.colors.border,
        paddingLeft: 8 + safeAreaLeft, paddingRight: 8 + safeAreaRight, paddingTop: safeAreaTop + 7,
      }]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.heading, compact && styles.headingCompact]}>
          <IOSPressable
            accessibilityLabel={isChinese ? '打开导航' : 'Open navigation'}
            onPress={onOpenNavigation} opacityTo={0.72} scaleTo={0.92}
            style={[styles.navToggle, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}
          >
            <Menu color={tokens.colors.foreground} size={16} strokeWidth={1.7} />
          </IOSPressable>
          <View style={styles.headerAvatar}>
            {chatMode === 'coding' ? <Code2 color={tokens.colors.primary} size={18} />
              : <StudioOfficialAvatar size={28} variant={chatMode === 'agent-group' ? 'studio' : 'agent'} />}
          </View>
          <View style={styles.headingCopy}>
            <Text numberOfLines={1} style={[styles.headingTitle, { color: tokens.colors.foreground }]}>
              {chatMode === 'agent-group' && !stacked ? 'Hermes Studio' : 'Hermes Agent'}
            </Text>
            {!stacked && chatMode === 'single' && collaborationState !== 'single' ? (
              <Text style={[styles.headingSubtitle, { color: tokens.colors.textTertiary }]}>
                {collaborationState === 'lifting' ? (isChinese ? '正在安排协作' : 'Preparing collaboration')
                  : (isChinese ? 'Hermes 负责最终汇报' : 'Hermes coordinates the final response')}
              </Text>
            ) : null}
          </View>
          {chatMode === 'single' && collaborationState === 'active' && !stacked ? (
            <View style={styles.collaborationHeaderInfo}>
              <CollaborationMemberStack isChinese={isChinese} messages={messages} onMentionMember={onMentionMember} />
              {showCollaborationHeaderCount ? <Text style={[styles.collaborationHeaderCount, { color: tokens.colors.textTertiary }]}>
                {latestMemberMessages(messages).length} {isChinese ? '位成员' : 'members'}
              </Text> : null}
            </View>
          ) : null}
        </View>
        {!stacked ? modes : null}
        <View style={[styles.headerControls, !stacked && { flex: 1, minWidth: 0 }]}>
          {!stacked ? hosts : null}
          <IOSPressable
            accessibilityLabel={isChinese ? '会话' : 'Conversations'} accessibilityRole="button"
            onPress={onOpenConversations} pressedStyle={{ backgroundColor: tokens.colors.accent }}
            style={[styles.modelTools, { width: 36, minHeight: 36, paddingHorizontal: 0, backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}
          >
            <History size={18} color={tokens.colors.foreground} />
          </IOSPressable>
        </View>
      </View>
      {stacked ? <View style={{ alignItems: 'center' }}>{modes}</View> : null}
      {stacked ? hosts : null}
    </View>
  );
}
