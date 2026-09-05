import { Code2, Menu, MessageSquare, Users, History } from 'lucide-react-native';
import { Text, View } from 'react-native';

import type { HermesChatViewMessage as ChatMessage } from '../../api/chat-view-model';
import type { SidebarGatewayStatus } from '../../app/NativeShell';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { StudioOfficialAvatar } from '../../components/studio/StudioOfficialAvatar';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { CollaborationMemberStack } from './ChatCollaborationPresentation';
import { LiveDot } from './ChatPresentation';
import { styles } from './chat-presentation-styles';

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
  chatMode,
  collaborationState,
  compact,
  gatewayStatuses,
  isChinese,
  messages,
  onMentionMember,
  onChangeChatMode,
  onOpenConversations,
  onOpenNavigation,
  safeAreaLeft,
  safeAreaRight,
  safeAreaTop,
  sending,
  showCollaborationHeaderCount,
}: ChatHeaderProps) {
  const { tokens } = useTheme();

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: multiplyAlpha(tokens.colors.background, 0.92),
          borderBottomColor: tokens.colors.border,
          minHeight: 52 + safeAreaTop,
          paddingLeft: 8 + safeAreaLeft,
          paddingRight: 8 + safeAreaRight,
          paddingTop: safeAreaTop + 7,
        },
      ]}
    >
      <View style={[styles.heading, compact && styles.headingCompact]}>
        <IOSPressable
          accessibilityLabel={isChinese ? '打开导航' : 'Open navigation'}
          onPress={onOpenNavigation}
          opacityTo={0.72}
          scaleTo={0.92}
          style={[
            styles.navToggle,
            {
              backgroundColor: tokens.colors.card,
              borderColor: tokens.colors.border,
            },
          ]}
        >
          <Menu color={tokens.colors.foreground} size={compact ? 14 : 16} strokeWidth={1.7} />
        </IOSPressable>
        <View style={[styles.headerAvatar, compact && styles.headerAvatarCompact]}>
          {chatMode === 'coding' ? (
            <View style={{ alignItems: 'center', backgroundColor: multiplyAlpha(tokens.colors.primary, 0.14), borderRadius: compact ? 13 : 14, height: compact ? 26 : 28, justifyContent: 'center', width: compact ? 26 : 28 }}>
              <Code2 color={tokens.colors.primary} size={compact ? 15 : 17} />
            </View>
          ) : (
            <StudioOfficialAvatar size={compact ? 26 : 28} variant={chatMode === 'agent-group' ? 'studio' : 'agent'} />
          )}
        </View>
        <View style={styles.headingCopy}>
          <Text
            numberOfLines={1}
            style={[
              styles.headingTitle,
              { color: tokens.colors.foreground },
              compact && styles.headingTitleCompact,
            ]}
          >
            {chatMode === 'agent-group' ? 'Hermes Studio Agent 群聊' : 'Hermes Agent'}
          </Text>
          {!compact && chatMode === 'single' && collaborationState !== 'single' ? (
            <Text numberOfLines={1} style={[styles.headingSubtitle, { color: tokens.colors.textTertiary }]}>
              {collaborationState === 'lifting'
                ? (isChinese ? '群聊正在拉起' : 'Starting group chat')
                : (isChinese ? '群聊已拉起' : 'Group chat ready')}
            </Text>
          ) : null}
          {!compact && chatMode === 'coding' ? (
            <Text numberOfLines={1} style={[styles.headingSubtitle, { color: tokens.colors.textTertiary }]}>Pi coding runtime</Text>
          ) : null}
        </View>
        {chatMode === 'single' && collaborationState === 'active' && !compact ? (
          <View style={styles.collaborationHeaderInfo}>
            <CollaborationMemberStack
              isChinese={isChinese}
              messages={messages}
              onMentionMember={onMentionMember}
            />
            {showCollaborationHeaderCount ? (
              <Text
                numberOfLines={1}
                style={[styles.collaborationHeaderCount, { color: tokens.colors.textTertiary }]}
              >
                {isChinese ? '4 位成员' : '4 members'}
              </Text>
            ) : null}
            <View style={[styles.collaborationHeaderConnection, { backgroundColor: tokens.colors.success }]} />
          </View>
        ) : null}
      </View>
      <View style={styles.headerControls}>
        <View
          accessibilityLabel={isChinese ? '切换聊天模式' : 'Switch chat mode'}
          style={{
            alignItems: 'center',
            backgroundColor: tokens.colors.card,
            borderColor: tokens.colors.border,
            borderRadius: 8,
            borderWidth: 1,
            flexDirection: 'row',
            gap: 2,
            padding: 2,
          }}
        >
          <IOSPressable
            accessibilityLabel={isChinese ? '切换到普通聊天' : 'Switch to chat'}
            onPress={() => onChangeChatMode('single')}
            pressedStyle={{ backgroundColor: tokens.colors.accent }}
            style={{
              alignItems: 'center',
              backgroundColor: chatMode === 'single' ? tokens.colors.accent : 'transparent',
              borderRadius: 6,
              flexDirection: 'row',
              gap: 4,
              minHeight: 26,
              paddingHorizontal: compact ? 5 : 7,
            }}
          >
            <MessageSquare color={tokens.colors.foreground} size={13} />
            {!compact ? <Text style={{ color: tokens.colors.foreground, fontSize: 10 }}>{isChinese ? '聊天' : 'Chat'}</Text> : null}
          </IOSPressable>
          <IOSPressable
            accessibilityLabel={isChinese ? '切换到 Hermes Studio Agent 群聊' : 'Switch to Hermes Studio Agent group chat'}
            onPress={() => onChangeChatMode('agent-group')}
            pressedStyle={{ backgroundColor: tokens.colors.accent }}
            style={{
              alignItems: 'center',
              backgroundColor: chatMode === 'agent-group' ? tokens.colors.accent : 'transparent',
              borderRadius: 6,
              flexDirection: 'row',
              gap: 4,
              minHeight: 26,
              paddingHorizontal: compact ? 5 : 7,
            }}
          >
            <Users color={tokens.colors.foreground} size={13} />
            {!compact ? <Text style={{ color: tokens.colors.foreground, fontSize: 10 }}>{isChinese ? 'Agent 群聊' : 'Agent group'}</Text> : null}
          </IOSPressable>
          <IOSPressable
            accessibilityLabel={isChinese ? '切换到 Coding Pi' : 'Switch to Coding Pi'}
            onPress={() => onChangeChatMode('coding')}
            pressedStyle={{ backgroundColor: tokens.colors.accent }}
            style={{
              alignItems: 'center',
              backgroundColor: chatMode === 'coding' ? tokens.colors.accent : 'transparent',
              borderRadius: 6,
              flexDirection: 'row',
              gap: 4,
              minHeight: 26,
              paddingHorizontal: compact ? 5 : 7,
            }}
          >
            <Code2 color={tokens.colors.foreground} size={13} />
            {!compact ? <Text style={{ color: tokens.colors.foreground, fontSize: 10 }}>Coding</Text> : null}
          </IOSPressable>
        </View>
        {gatewayStatuses.length ? <View style={[styles.gatewayStatuses, compact && { width: 12 }]}>
          {gatewayStatuses.map((gateway) => (
            <View key={gateway.id} style={[styles.gatewayStatusRow, compact && { width: 12 }]}>
              <View
                accessibilityLabel={`${gateway.label} ${gateway.state}`}
                style={[
                  styles.gatewayStatusDot,
                  {
                    backgroundColor: gateway.state === 'online'
                      ? tokens.colors.success
                      : gateway.state === 'degraded'
                        ? tokens.colors.warning
                        : gateway.state === 'offline'
                          ? tokens.colors.destructive
                          : tokens.colors.textDisabled,
                  },
                ]}
              />
              {!compact ? <Text
                numberOfLines={1}
                style={[styles.gatewayStatusLabel, { color: tokens.colors.textSecondary }]}
              >
                {gateway.label}
              </Text> : null}
              {!compact ? <Text
                numberOfLines={1}
                style={[styles.gatewayStatusVersion, { color: tokens.colors.textTertiary }]}
              >
                {gateway.version?.split(' ')[0] || (
                  gateway.state === 'online'
                    ? (isChinese ? '在线' : 'online')
                    : gateway.state === 'degraded'
                      ? (isChinese ? '异常' : 'degraded')
                      : gateway.state === 'offline'
                        ? (isChinese ? '离线' : 'offline')
                        : (isChinese ? '检测中' : 'checking')
                )}
              </Text> : null}
            </View>
          ))}
        </View> : null}
        <IOSPressable
          accessibilityLabel={isChinese ? '会话' : 'Conversations'}
          accessibilityRole="button"
          onPress={onOpenConversations}
          pressedStyle={{ backgroundColor: tokens.colors.accent }}
          style={[
            styles.modelTools,
            compact && { width: 44, minHeight: 44, paddingHorizontal: 0, justifyContent: 'center' },
            {
              backgroundColor: tokens.colors.card,
              borderColor: tokens.colors.border,
            },
          ]}
        >
          {compact ? <History size={18} color={tokens.colors.foreground} /> : <Text style={[styles.modelToolsText, { color: tokens.colors.foreground }]}>
            {isChinese ? '会话' : 'Conversations'}
          </Text>}
        </IOSPressable>
        {!compact ? <LiveDot busy={sending} /> : null}
      </View>
    </View>
  );
}
