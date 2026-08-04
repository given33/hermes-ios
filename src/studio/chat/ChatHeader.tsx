import { Menu } from 'lucide-react-native';
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

export interface ChatHeaderProps {
  collaborationState: 'active' | 'lifting' | 'single';
  compact: boolean;
  gatewayStatuses: readonly SidebarGatewayStatus[];
  isChinese: boolean;
  messages: readonly ChatMessage[];
  onMentionMember(message: ChatMessage): void;
  onOpenConversations(): void;
  onOpenNavigation(): void;
  safeAreaLeft: number;
  safeAreaRight: number;
  safeAreaTop: number;
  sending: boolean;
  showCollaborationHeaderCount: boolean;
}

export function ChatHeader({
  collaborationState,
  compact,
  gatewayStatuses,
  isChinese,
  messages,
  onMentionMember,
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
          <StudioOfficialAvatar size={compact ? 26 : 28} />
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
            Hermes Agent
          </Text>
          {!compact && collaborationState !== 'single' ? (
            <Text numberOfLines={1} style={[styles.headingSubtitle, { color: tokens.colors.textTertiary }]}>
              {collaborationState === 'lifting'
                ? (isChinese ? '群聊正在拉起' : 'Starting group chat')
                : (isChinese ? '群聊已拉起' : 'Group chat ready')}
            </Text>
          ) : null}
        </View>
        {collaborationState === 'active' && !compact ? (
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
                {isChinese ? '5 位成员' : '5 members'}
              </Text>
            ) : null}
            <View style={[styles.collaborationHeaderConnection, { backgroundColor: tokens.colors.success }]} />
          </View>
        ) : null}
      </View>
      <View style={styles.headerControls}>
        <View style={styles.gatewayStatuses}>
          {gatewayStatuses.map((gateway) => (
            <View key={gateway.id} style={styles.gatewayStatusRow}>
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
              <Text
                numberOfLines={1}
                style={[styles.gatewayStatusLabel, { color: tokens.colors.textSecondary }]}
              >
                {gateway.label}
              </Text>
              <Text
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
              </Text>
            </View>
          ))}
        </View>
        <IOSPressable
          accessibilityLabel={isChinese ? '会话' : 'Conversations'}
          onPress={onOpenConversations}
          pressedStyle={{ backgroundColor: tokens.colors.accent }}
          style={[
            styles.modelTools,
            {
              backgroundColor: tokens.colors.card,
              borderColor: tokens.colors.border,
            },
          ]}
        >
          <Text style={[styles.modelToolsText, { color: tokens.colors.foreground }]}>
            {isChinese ? '会话' : 'Conversations'}
          </Text>
        </IOSPressable>
        {!compact ? <LiveDot busy={sending} /> : null}
      </View>
    </View>
  );
}
