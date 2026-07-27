import { Clock3, ExternalLink, Plus, Search } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { SingleConversation } from '../../api/HermesCloudApi';
import { conversationHasRunningWork } from '../../api/chat-view-model';
import { StudioProfileAvatar } from '../../components/studio/StudioProfileAvatar';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { useTheme } from '../../design/ThemeProvider';
import { styles } from './chat-presentation-styles';

export function ConversationHistory({
  activeId,
  conversations,
  isChinese,
  onCheckRelay,
  onClose,
  onNew,
  onRefresh,
  onSelect,
}: {
  activeId: string;
  conversations: SingleConversation[];
  isChinese: boolean;
  onCheckRelay(): void;
  onClose?(): void;
  onNew(): void;
  onRefresh(): void;
  onSelect(id: string): void;
}) {
  const { tokens } = useTheme();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = conversations.filter((conversation) => !normalizedQuery || [
    conversation.title,
    conversation.profile,
    conversation.official_model,
    conversation.preview,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery)));
  return (
    <View style={[
      styles.history,
      onClose && styles.historyModal,
      { backgroundColor: tokens.colors.card, borderRightColor: tokens.colors.border },
    ]}>
      <View style={[styles.pageSidebarNav, { borderBottomColor: tokens.colors.border }]}>
        <View style={styles.pageSidebarActions}>
          <IOSPressable accessibilityLabel={isChinese ? '新建会话' : 'New chat'} onPress={onNew} style={styles.pageSidebarAction}>
            <Plus color={tokens.colors.textSecondary} size={15} />
            <Text style={[styles.pageSidebarActionText, { color: tokens.colors.textSecondary }]}>{isChinese ? '新建' : 'New'}</Text>
          </IOSPressable>
          <IOSPressable
            accessibilityLabel={isChinese ? '搜索会话' : 'Search chats'}
            onPress={() => setSearchOpen((current) => !current)}
            style={styles.pageSidebarAction}
          >
            <Search color={tokens.colors.textSecondary} size={15} />
            <Text style={[styles.pageSidebarActionText, { color: tokens.colors.textSecondary }]}>{isChinese ? '搜索' : 'Search'}</Text>
          </IOSPressable>
          <IOSPressable
            accessibilityLabel={isChinese ? '刷新会话历史' : 'Refresh history'}
            onPress={onRefresh}
            style={styles.pageSidebarAction}
          >
            <Clock3 color={tokens.colors.textSecondary} size={15} />
            <Text style={[styles.pageSidebarActionText, { color: tokens.colors.textSecondary }]}>{isChinese ? '会话' : 'History'}</Text>
          </IOSPressable>
          <IOSPressable accessibilityLabel="Check API Relay" onPress={onCheckRelay} style={styles.pageSidebarAction}>
            <ExternalLink color={tokens.colors.textSecondary} size={15} />
            <Text style={[styles.pageSidebarActionText, { color: tokens.colors.textSecondary }]}>Relay</Text>
          </IOSPressable>
        </View>
      </View>
      {searchOpen ? (
        <View style={styles.historySearchWrap}>
          <TextInput
            autoFocus
            onChangeText={setQuery}
            placeholder={isChinese ? '搜索会话...' : 'Search conversations...'}
            placeholderTextColor={tokens.colors.textTertiary}
            style={[
              styles.historySearchInput,
              {
                backgroundColor: tokens.colors.background,
                borderColor: tokens.colors.border,
                color: tokens.colors.foreground,
              },
            ]}
            value={query}
          />
        </View>
      ) : null}
      <Text style={[styles.historyLabel, { color: tokens.colors.textTertiary }]}>
        {isChinese ? `会话 · ${filtered.length}` : `Conversations · ${filtered.length}`}
      </Text>
      <ScrollView
        contentContainerStyle={styles.historyList}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={8}
        showsVerticalScrollIndicator={false}
        style={styles.historyScroll}
      >
        {filtered.map((conversation) => {
          const active = conversationHasRunningWork(conversation);
          const model = conversation.official_model || '';
          return (
            <IOSPressable
              accessibilityLabel={`${isChinese ? '打开会话' : 'Open conversation'} ${conversation.title || ''}`}
              key={conversation.id}
              onPress={() => onSelect(conversation.id)}
              style={[
                styles.historyItem,
                activeId === conversation.id && { backgroundColor: tokens.colors.accent },
              ]}
            >
              <View style={styles.historyItemTitleRow}>
                <Text numberOfLines={1} style={[styles.historyItemTitle, { color: tokens.colors.foreground }]}>
                  {conversation.title || (isChinese ? '新对话' : 'New conversation')}
                </Text>
                <Text style={[styles.historyItemTime, { color: tokens.colors.textSecondary }]}>
                  {formatConversationRecency(conversation.updated_at, isChinese)}
                </Text>
              </View>
              <View style={styles.historyItemProfileRow}>
                <StudioProfileAvatar seed={conversation.profile || model || 'default'} size={18} />
                <Text numberOfLines={1} style={[styles.historyItemMeta, { color: tokens.colors.textSecondary }]}>
                  {[conversation.profile || 'default', model].filter(Boolean).join(' · ')}
                </Text>
                {active ? <View style={[styles.historyActiveDot, { backgroundColor: tokens.colors.success }]} /> : null}
              </View>
            </IOSPressable>
          );
        })}
      </ScrollView>
      <View style={[styles.historyFooter, { borderTopColor: tokens.colors.border }]}>
        <Text style={[styles.historyItemMeta, { color: tokens.colors.textSecondary }]}>default</Text>
        <Text style={[styles.historyItemMeta, { color: tokens.colors.textSecondary }]}>
          {filtered.length} {isChinese ? '个会话' : 'conversations'}
        </Text>
      </View>
    </View>
  );
}

function formatConversationRecency(value: number | undefined, isChinese: boolean): string {
  if (!value) return '';
  const elapsed = Math.max(0, Date.now() - value);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return isChinese ? '刚刚' : 'Now';
  if (minutes < 60) return isChinese ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return isChinese ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return isChinese ? `${days} 天前` : `${days}d ago`;
}
