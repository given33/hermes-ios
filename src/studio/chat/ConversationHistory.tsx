import {
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Code2,
  ExternalLink,
  GitBranch,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { SingleConversation } from '../../api/HermesCloudApi';
import { conversationHasRunningWork } from '../../api/chat-view-model';
import { StudioOfficialAvatar } from '../../components/studio/StudioOfficialAvatar';
import { StudioProfileAvatar } from '../../components/studio/StudioProfileAvatar';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useTheme } from '../../design/ThemeProvider';
import { multiplyAlpha } from '../../design/control-contracts';
import { styles } from './chat-presentation-styles';

export type ConversationHistoryKind = 'chat' | 'agent-group' | 'workflow' | 'coding';

export interface ConversationHistoryItem extends SingleConversation {
  active?: boolean;
  deletable?: boolean;
  historyKind?: ConversationHistoryKind;
  historyLabel?: string;
  sourceId?: string;
  status?: string;
}

export function ConversationHistory({
  activeId,
  conversations,
  isChinese,
  onCheckRelay,
  onClose,
  onDeleteMany,
  onNew,
  onRefresh,
  onSelect,
  onSelectItem,
}: {
  activeId: string;
  conversations: ConversationHistoryItem[];
  isChinese: boolean;
  onCheckRelay(): void;
  onClose?(): void;
  onDeleteMany(ids: readonly string[]): Promise<void> | void;
  onNew(): void;
  onRefresh(): void;
  onSelect(id: string): void;
  onSelectItem?(item: ConversationHistoryItem): void;
}) {
  const { tokens } = useTheme();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = conversations.filter((conversation) => !normalizedQuery || [
    conversation.title,
    conversation.profile,
    conversation.official_model,
    conversation.preview,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery)));
  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const leaveSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };
  const confirmDelete = async () => {
    const ids = [...pendingDeleteIds];
    if (!ids.length || deleting) return;
    setDeleting(true);
    try {
      await onDeleteMany(ids);
      setPendingDeleteIds([]);
      leaveSelectionMode();
    } finally {
      setDeleting(false);
    }
  };
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
          <IOSPressable
            accessibilityLabel={selectionMode
              ? (isChinese ? '取消选择会话' : 'Cancel selecting conversations')
              : (isChinese ? '删除会话' : 'Delete conversations')}
            onPress={() => {
              if (selectionMode) {
                leaveSelectionMode();
                return;
              }
              setSelectionMode(true);
              setSelectedIds(new Set());
            }}
            style={styles.pageSidebarAction}
          >
            {selectionMode ? (
              <X color={tokens.colors.textSecondary} size={15} />
            ) : (
              <Trash2 color={tokens.colors.textSecondary} size={15} />
            )}
            <Text style={[styles.pageSidebarActionText, { color: tokens.colors.textSecondary }]}>
              {selectionMode ? (isChinese ? '取消' : 'Done') : (isChinese ? '删除' : 'Delete')}
            </Text>
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
          const kind = conversation.historyKind || 'chat';
          const active = kind === 'chat'
            ? conversationHasRunningWork(conversation)
            : Boolean(conversation.active);
          const model = conversation.official_model || '';
          const selected = selectedIds.has(conversation.id);
          const HistoryIcon = kind === 'agent-group'
            ? Users
            : kind === 'workflow'
              ? GitBranch
              : kind === 'coding'
                ? Code2
                : MessageSquare;
          const historyLabel = conversation.historyLabel || (kind === 'agent-group'
            ? (isChinese ? 'Agent 群聊' : 'Agent group')
            : kind === 'workflow'
              ? (isChinese ? '工作流' : 'Workflow')
              : (isChinese ? '聊天' : 'Chat'));
          return (
            <View
              key={conversation.id}
              style={[
                styles.historyItem,
                activeId === conversation.id && { backgroundColor: tokens.colors.accent },
              ]}
            >
              <View style={{ alignItems: 'center', flexDirection: 'row', gap: 4 }}>
                <IOSPressable
                  accessibilityLabel={`${selectionMode
                    ? (isChinese ? '选择会话' : 'Select conversation')
                    : (isChinese ? '打开会话' : 'Open conversation')} ${conversation.title || ''}`}
                  onPress={() => selectionMode
                    ? toggleSelected(conversation.id)
                    : onSelectItem
                      ? onSelectItem(conversation)
                      : onSelect(conversation.id)}
                  style={{ flex: 1, gap: 7, minWidth: 0 }}
                >
                  <View style={styles.historyItemTitleRow}>
                    {selectionMode ? (
                      selected ? (
                        <CheckCircle2 color={tokens.colors.accent} size={15} />
                      ) : (
                        <Circle color={tokens.colors.textTertiary} size={15} />
                      )
                    ) : null}
                    <HistoryIcon color={kind === 'workflow' ? tokens.colors.warning : tokens.colors.primary} size={14} />
                    <Text numberOfLines={1} style={[styles.historyItemTitle, { color: tokens.colors.foreground }]}>
                      {conversation.title || (isChinese ? '新对话' : 'New conversation')}
                    </Text>
                    <Text style={[styles.historyItemTime, { color: tokens.colors.textSecondary }]}>
                      {formatConversationRecency(conversation.updated_at, isChinese)}
                    </Text>
                  </View>
                  <View style={styles.historyItemProfileRow}>
                    {kind === 'agent-group' ? (
                      <StudioOfficialAvatar size={18} variant="studio" />
                    ) : kind === 'workflow' ? (
                      <View style={[{ alignItems: 'center', borderRadius: 9, height: 18, justifyContent: 'center', width: 18 }, { backgroundColor: multiplyAlpha(tokens.colors.warning, 0.14) }]}>
                        <GitBranch color={tokens.colors.warning} size={12} />
                      </View>
                    ) : kind === 'coding' ? (
                      <View style={[{ alignItems: 'center', borderRadius: 9, height: 18, justifyContent: 'center', width: 18 }, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.14) }]}>
                        <Code2 color={tokens.colors.primary} size={12} />
                      </View>
                    ) : (
                      <StudioProfileAvatar seed={conversation.profile || model || 'default'} size={18} />
                    )}
                    <Text numberOfLines={1} style={[styles.historyItemMeta, { color: tokens.colors.textTertiary }]}>
                      {historyLabel}
                    </Text>
                    <Text numberOfLines={1} style={[styles.historyItemMeta, { color: tokens.colors.textSecondary }]}>
                      {[conversation.profile || 'default', model].filter(Boolean).join(' · ')}
                    </Text>
                    {active ? <View style={[styles.historyActiveDot, { backgroundColor: tokens.colors.success }]} /> : null}
                  </View>
                </IOSPressable>
                {!selectionMode && (kind === 'chat' || conversation.deletable) ? (
                  <IOSPressable
                    accessibilityLabel={`${isChinese ? '删除会话' : 'Delete conversation'} ${conversation.title || ''}`}
                    hitSlop={8}
                    onPress={() => setPendingDeleteIds([conversation.id])}
                    style={{ alignItems: 'center', height: 30, justifyContent: 'center', width: 30 }}
                  >
                    <Trash2 color={tokens.colors.textTertiary} size={15} />
                  </IOSPressable>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
      <View style={[styles.historyFooter, { borderTopColor: tokens.colors.border }]}>
        {selectionMode ? (
          <IOSPressable
            accessibilityLabel={isChinese ? '删除选中的会话' : 'Delete selected conversations'}
            disabled={selectedIds.size === 0}
            onPress={() => setPendingDeleteIds([...selectedIds])}
            style={{ alignItems: 'center', flexDirection: 'row', gap: 5, minHeight: 32, opacity: selectedIds.size ? 1 : 0.45 }}
          >
            <Check color={tokens.colors.destructive} size={14} />
            <Text style={[styles.historyItemMeta, { color: tokens.colors.destructive }]}>
              {isChinese ? `删除 ${selectedIds.size} 个` : `Delete ${selectedIds.size}`}
            </Text>
          </IOSPressable>
        ) : null}
        <Text style={[styles.historyItemMeta, { color: tokens.colors.textSecondary, marginLeft: 'auto' }]}>
          {filtered.length} {isChinese ? '个会话' : 'conversations'}
        </Text>
      </View>
      <ConfirmDialog
        confirmLabel={isChinese ? '删除' : 'Delete'}
        description={isChinese
          ? `确定删除 ${pendingDeleteIds.length} 个会话吗？此操作不可撤销。`
          : `Delete ${pendingDeleteIds.length} conversation${pendingDeleteIds.length === 1 ? '' : 's'}? This cannot be undone.`}
        destructive
        loading={deleting}
        onCancel={() => { if (!deleting) setPendingDeleteIds([]); }}
        onConfirm={() => { void confirmDelete(); }}
        open={pendingDeleteIds.length > 0}
        title={isChinese ? '删除会话' : 'Delete conversations'}
      />
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
