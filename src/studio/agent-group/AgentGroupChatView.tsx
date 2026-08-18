import {
  ChevronLeft,
  Plus,
  RefreshCw,
  Settings2,
  Send,
  Square,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react-native';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { IOSPressable } from '../../components/ios/IOSPressable';
import { StudioOfficialAvatar } from '../../components/studio/StudioOfficialAvatar';
import { NativeButton } from '../../components/ui/NativeButton';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { PreviewModal, PreviewText } from '../PreviewPrimitives';
import { latestRoomPreview, roomHasRunningWork } from './agent-group-model';
import { AgentGroupMessageStream } from './AgentGroupMessageStream';
import type { AgentGroupChatController } from './useAgentGroupChatController';

export interface AgentGroupChatViewProps {
  compact: boolean;
  controller: AgentGroupChatController;
  isChinese: boolean;
  onOpenNavigation?(): void;
  safeAreaBottom: number;
  safeAreaLeft: number;
  safeAreaRight: number;
  safeAreaTop?: number;
  /** When false the room rail is hidden for the embedded chat-mode surface. */
  showRoomRail?: boolean;
}

export function AgentGroupChatView({
  compact,
  controller,
  isChinese,
  onOpenNavigation,
  safeAreaBottom,
  safeAreaLeft,
  safeAreaRight,
  safeAreaTop = 0,
  showRoomRail = true,
}: AgentGroupChatViewProps) {
  const { tokens } = useTheme();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteRoomId, setDeleteRoomId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState('');
  const [profilesInput, setProfilesInput] = useState('default');
  const [inputSettingsOpen, setInputSettingsOpen] = useState(false);
  const [showToolTrace, setShowToolTrace] = useState(true);
  const activeRoom = controller.activeRoom;
  const draft = activeRoom ? controller.drafts[activeRoom.room.id] || '' : '';
  const mentionCandidates = activeRoom ? mentionOptions(activeRoom.agents, draft) : [];
  const title = isChinese ? 'Hermes Studio Agent 群聊' : 'Hermes Studio Agent group chat';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}
      style={[styles.root, { backgroundColor: tokens.colors.background }]}
    >
      <View style={[styles.body, compact && styles.bodyCompact]}>
        {showRoomRail ? (
          <View
            style={[
              styles.roomRail,
              compact && styles.roomRailCompact,
              {
                backgroundColor: tokens.colors.card,
                borderColor: tokens.colors.border,
                paddingLeft: 10 + safeAreaLeft,
                paddingTop: compact ? safeAreaTop + 7 : 10,
                paddingRight: compact ? 8 + safeAreaRight : 8,
              },
            ]}
          >
          <View style={[styles.roomRailHeader, compact && styles.roomRailHeaderCompact]}>
            <View style={styles.roomRailTitleRow}>
              {compact ? (
                <IOSPressable
                  accessibilityLabel={isChinese ? '返回导航' : 'Open navigation'}
                  hitSlop={8}
                  onPress={() => onOpenNavigation?.()}
                  style={styles.navigationButton}
                >
                  <ChevronLeft color={tokens.colors.foreground} size={20} strokeWidth={1.8} />
                </IOSPressable>
              ) : null}
              <Users color={tokens.colors.primary} size={16} />
              <Text style={[styles.roomRailTitle, { color: tokens.colors.foreground }]}> 
                {isChinese ? 'Agent 房间' : 'Agent rooms'}
              </Text>
            </View>
            <View style={styles.roomRailActions}>
              <IOSPressable
                accessibilityLabel={isChinese ? '刷新 Agent 房间' : 'Refresh Agent rooms'}
                hitSlop={8}
                onPress={() => { void controller.refresh(); }}
                style={styles.iconButton}
              >
                <RefreshCw color={tokens.colors.textSecondary} size={15} />
              </IOSPressable>
              <IOSPressable
                accessibilityLabel={isChinese ? '新建 Agent 房间' : 'Create Agent room'}
                hitSlop={8}
                onPress={() => setCreateOpen(true)}
                style={styles.iconButton}
              >
                <Plus color={tokens.colors.textSecondary} size={16} />
              </IOSPressable>
            </View>
          </View>
          <Text style={[styles.separationNote, { color: tokens.colors.textTertiary }]}> 
            {isChinese ? '独立于托管协作时间线' : 'Separate from hosted collaboration timeline'}
          </Text>
          <ScrollView
            contentContainerStyle={styles.roomList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {controller.rooms.map((room) => {
              const snapshot = room.id === activeRoom?.room.id
                ? activeRoom
                : undefined;
              const running = roomHasRunningWork(snapshot);
              return (
                <IOSPressable
                  accessibilityLabel={`${isChinese ? '打开 Agent 房间' : 'Open Agent room'} ${room.name}`}
                  key={room.id}
                  onPress={() => controller.selectRoom(room.id)}
                  pressedStyle={{ backgroundColor: multiplyAlpha(tokens.colors.primary, 0.12) }}
                  style={[
                    styles.roomItem,
                    {
                      backgroundColor: room.id === activeRoom?.room.id
                        ? multiplyAlpha(tokens.colors.primary, 0.12)
                        : 'transparent',
                      borderColor: room.id === activeRoom?.room.id
                        ? multiplyAlpha(tokens.colors.primary, 0.3)
                        : tokens.colors.border,
                    },
                  ]}
                >
                  <View style={styles.roomItemIcon}>
                    <Users color={tokens.colors.primary} size={15} />
                    {running ? <View style={[styles.runningDot, { backgroundColor: tokens.colors.success }]} /> : null}
                  </View>
                  <View style={styles.roomItemCopy}>
                    <Text numberOfLines={1} style={[styles.roomItemTitle, { color: tokens.colors.foreground }]}>
                      {room.name}
                    </Text>
                    <Text numberOfLines={1} style={[styles.roomItemPreview, { color: tokens.colors.textTertiary }]}>
                      {snapshot ? latestRoomPreview(snapshot) || (isChinese ? '暂无消息' : 'No messages yet') : (isChinese ? '点击加载历史' : 'Tap to load history')}
                    </Text>
                  </View>
                </IOSPressable>
              );
            })}
            {!controller.rooms.length && !controller.loading ? (
              <View style={styles.emptyRoomRail}>
                <Users color={tokens.colors.textTertiary} size={21} />
                <Text style={[styles.emptyRoomText, { color: tokens.colors.textSecondary }]}>
                  {isChinese ? '还没有 Agent 房间' : 'No Agent rooms yet'}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
        ) : null}

        <View style={[styles.conversation, { paddingRight: 8 + safeAreaRight }]}> 
          <View style={[styles.conversationToolbar, { borderBottomColor: tokens.colors.border }]}> 
            <View style={styles.conversationHeading}>
              <StudioOfficialAvatar size={22} variant="studio" />
              <View style={styles.conversationHeadingCopy}>
                <Text numberOfLines={1} style={[styles.conversationTitle, { color: tokens.colors.foreground }]}>
                  {activeRoom?.room.name || title}
                </Text>
                <Text numberOfLines={1} style={[styles.conversationMeta, { color: tokens.colors.textTertiary }]}>
                  {activeRoom
                    ? `${activeRoom.agents.length} ${isChinese ? '个 Agent' : 'agents'} · ${activeRoom.messages.length} ${isChinese ? '条消息' : 'messages'}`
                    : (isChinese ? '选择房间开始' : 'Select a room to begin')}
                </Text>
              </View>
            </View>
            <View style={styles.connectionStatus}>
              {controller.connected ? <Wifi color={tokens.colors.success} size={14} /> : <WifiOff color={tokens.colors.textTertiary} size={14} />}
              <Text style={[styles.connectionText, { color: controller.connected ? tokens.colors.success : tokens.colors.textTertiary }]}>
                {controller.connected ? (isChinese ? '实时' : 'Live') : (isChinese ? '重连中' : 'Reconnecting')}
              </Text>
              {activeRoom?.runningAgents.length ? (
                <IOSPressable
                  accessibilityLabel={isChinese ? '停止 Agent 输出' : 'Stop Agent output'}
                  hitSlop={7}
                  onPress={() => {
                    const agentName = activeRoom.runningAgents[0];
                    if (agentName) void controller.interruptAgent(activeRoom.room.id, agentName);
                  }}
                  style={styles.iconButton}
                >
                  <Square color={tokens.colors.destructive} size={14} />
                </IOSPressable>
              ) : null}
            </View>
          </View>

          {controller.error && !activeRoom?.error ? (
            <View style={styles.errorBannerRow}>
              <Text style={[styles.errorBanner, { color: tokens.colors.destructive, flex: 1 }]}>{controller.error}</Text>
              <IOSPressable
                accessibilityLabel={isChinese ? '重试连接' : 'Retry connection'}
                hitSlop={8}
                onPress={() => {
                  void controller.refresh();
                  void controller.refreshRoom(activeRoom?.room.id);
                }}
                style={styles.iconButton}
              >
                <RefreshCw color={tokens.colors.destructive} size={14} />
              </IOSPressable>
            </View>
          ) : null}
          {activeRoom?.error ? (
            <View style={styles.errorBannerRow}>
              <Text style={[styles.errorBanner, { color: tokens.colors.destructive, flex: 1 }]}>{activeRoom.error}</Text>
            </View>
          ) : null}

          <View style={styles.messageStream}>
            <AgentGroupMessageStream
              agents={activeRoom?.agents || []}
              compact={compact}
              hasEarlierHistory={activeRoom?.hasEarlierHistory === true}
              loadingEarlier={controller.loading && Boolean(activeRoom?.messages.length)}
              onLoadEarlier={() => { void controller.loadEarlierMessages(); }}
              isChinese={isChinese}
              messages={activeRoom?.messages || []}
              onQuickReply={(text) => { void controller.sendMessage(text); }}
              onRetractMessage={activeRoom ? (messageId) => { void controller.retractMessage(activeRoom.room.id, messageId); } : undefined}
              running={Boolean(activeRoom?.runningAgents.length)}
              safeAreaBottom={safeAreaBottom}
              showToolTrace={showToolTrace}
              summaryAnchorId={activeRoom?.summaryAnchor?.id}
              userId={controller.userId}
            />
            {activeRoom?.typingNames.length ? (
              <Text style={[styles.typingText, { color: tokens.colors.textTertiary }]}>
                {activeRoom.typingNames.join(', ')} {isChinese ? '正在输入…' : 'typing…'}
              </Text>
            ) : null}
            {activeRoom?.runningAgents.length ? (
              <Text style={[styles.runningText, { color: tokens.colors.primary }]}>
                {activeRoom.runningAgents.join(', ')} {isChinese ? '正在执行任务' : 'running a task'}
              </Text>
            ) : null}
          </View>

          {mentionCandidates.length ? (
            <View style={[styles.mentionBar, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}> 
              <Text style={[styles.mentionHint, { color: tokens.colors.textTertiary }]}>{isChinese ? '选择要 @mention 的 Agent' : 'Mention an Agent'}</Text>
              {mentionCandidates.map((name) => (
                <IOSPressable
                  key={name}
                  onPress={() => {
                    if (!activeRoom) return;
                    controller.setDraft(activeRoom.room.id, replaceMention(draft, name));
                  }}
                  style={[styles.mentionChip, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.1) }]}
                >
                  <Text style={[styles.mentionChipText, { color: tokens.colors.primary }]}>@{name}</Text>
                </IOSPressable>
              ))}
            </View>
          ) : null}
          <View style={[styles.composer, { borderTopColor: tokens.colors.border, paddingBottom: 8 + safeAreaBottom }]}> 
            <IOSPressable
              accessibilityLabel={isChinese ? 'Agent 群聊输入设置' : 'Agent group input settings'}
              onPress={() => setInputSettingsOpen(true)}
              style={styles.inputSettingsButton}
            >
              <Settings2 color={tokens.colors.textTertiary} size={16} />
            </IOSPressable>
            <TextInput
              editable={Boolean(activeRoom)}
              multiline
              onChangeText={(value) => {
                if (!activeRoom) return;
                controller.setDraft(activeRoom.room.id, value);
                if (value.trim()) controller.emitTyping(activeRoom.room.id);
                else controller.emitStopTyping(activeRoom.room.id);
              }}
              onSubmitEditing={() => { void controller.sendMessage(); }}
              placeholder={activeRoom
                ? (isChinese ? '给 Agent 群聊发送消息，支持 @mention…' : 'Message the Agent group, @mention supported…')
                : (isChinese ? '先选择或新建房间' : 'Select or create a room first')}
              placeholderTextColor={tokens.colors.textTertiary}
              returnKeyType="send"
              style={[styles.input, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
              value={draft}
            />
            <IOSPressable
              accessibilityLabel={isChinese ? '发送 Agent 群聊消息' : 'Send Agent group message'}
              disabled={!activeRoom || !draft.trim()}
              onPress={() => { void controller.sendMessage(); }}
              pressedStyle={{ backgroundColor: tokens.colors.primary }}
              style={[styles.sendButton, { backgroundColor: tokens.colors.primary, opacity: activeRoom && draft.trim() ? 1 : 0.45 }]}
            >
              <Send color={tokens.colors.primaryForeground} size={17} />
            </IOSPressable>
          </View>
        </View>
      </View>

      <View style={[styles.bottomActions, { backgroundColor: tokens.colors.background, paddingLeft: 12 + safeAreaLeft }]}> 
        <NativeButton
          disabled={!activeRoom}
          ghost
          onPress={() => activeRoom && setDeleteRoomId(activeRoom.room.id)}
          prefix={<Trash2 />}
          size="sm"
        >
          {isChinese ? '删除房间' : 'Delete room'}
        </NativeButton>
        {controller.loading || controller.creating ? <PreviewText variant="tiny">{isChinese ? '同步中…' : 'Syncing…'}</PreviewText> : null}
      </View>

      <PreviewModal
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        title={isChinese ? '新建 Agent 群聊房间' : 'Create Agent group room'}
      >
        <PreviewText variant="muted">
          {isChinese ? '这是 Hermes Studio 独立房间，不会写入现有托管协作时间线。' : 'This is an independent Hermes Studio room; it does not write to the hosted collaboration timeline.'}
        </PreviewText>
        <TextInput
          onChangeText={setRoomName}
          placeholder={isChinese ? '房间名称' : 'Room name'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={roomName}
        />
        <TextInput
          onChangeText={setProfilesInput}
          placeholder={isChinese ? 'Agent profiles，用逗号分隔' : 'Agent profiles, comma separated'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={profilesInput}
        />
        <NativeButton
          disabled={!roomName.trim() || controller.creating}
          onPress={() => {
            void controller.createRoom(roomName, profilesInput.split(','));
            setCreateOpen(false);
            setRoomName('');
          }}
          prefix={<Plus />}
        >
          {isChinese ? '创建房间' : 'Create room'}
        </NativeButton>
      </PreviewModal>

      <PreviewModal
        onClose={() => setInputSettingsOpen(false)}
        open={inputSettingsOpen}
        title={isChinese ? 'Agent 群聊输入设置' : 'Agent group input settings'}
      >
        <PreviewText variant="muted">{isChinese ? '这些是 Hermes Studio 群聊输入层自己的选项，不会修改普通聊天设置。' : 'These settings belong to the Hermes Studio group input layer and do not modify ordinary chat settings.'}</PreviewText>
        <View style={[styles.inputSettingRow, { borderBottomColor: tokens.colors.border }]}> 
          <View style={styles.inputSettingCopy}>
            <Text style={[styles.inputSettingTitle, { color: tokens.colors.foreground }]}>{isChinese ? '显示工具调用轨迹' : 'Show tool traces'}</Text>
            <Text style={[styles.inputSettingDetail, { color: tokens.colors.textTertiary }]}>{isChinese ? '关闭后只隐藏已完成的工具行，正在运行的工具仍显示。' : 'Hide completed tool rows while keeping running tools visible.'}</Text>
          </View>
          <View style={styles.inputSettingToggle}>
            <IOSPressable accessibilityLabel={isChinese ? '切换工具调用轨迹' : 'Toggle tool traces'} onPress={() => setShowToolTrace((current) => !current)} style={styles.toggleButton}>
              <Text style={[styles.toggleButtonText, { color: showToolTrace ? tokens.colors.primary : tokens.colors.textTertiary }]}>{showToolTrace ? 'ON' : 'OFF'}</Text>
            </IOSPressable>
          </View>
        </View>
        <PreviewText variant="tiny">{isChinese ? '普通聊天、托管协作时间线和 Agent 群聊各自保存自己的显示设置。' : 'Ordinary chat, hosted collaboration, and Agent group chat keep separate display settings.'}</PreviewText>
      </PreviewModal>

      <ConfirmDialog
        cancelLabel={isChinese ? '取消' : 'Cancel'}
        confirmLabel={isChinese ? '删除' : 'Delete'}
        description={isChinese ? '删除后房间历史也会从 Hermes Studio 移除。' : 'The room and its Hermes Studio history will be removed.'}
        destructive
        onCancel={() => setDeleteRoomId(null)}
        onConfirm={() => {
          if (!deleteRoomId) return;
          void controller.deleteRoom(deleteRoomId);
          setDeleteRoomId(null);
        }}
        open={Boolean(deleteRoomId)}
        title={isChinese ? '删除 Agent 房间？' : 'Delete Agent room?'}
      />
    </KeyboardAvoidingView>
  );
}

const styles = {
  root: { flex: 1 },
  body: { flex: 1, flexDirection: 'row' as const, minHeight: 0 },
  bodyCompact: { flexDirection: 'column' as const },
  roomRail: { borderRightWidth: 1, minWidth: 220, paddingRight: 8, paddingTop: 10, width: 258 },
  roomRailCompact: { borderBottomWidth: 1, borderRightWidth: 0, maxHeight: 190, minWidth: 0, paddingRight: 10, width: '100%' as const },
  roomRailHeader: { alignItems: 'center' as const, flexDirection: 'row' as const, justifyContent: 'space-between' as const, minWidth: 0 },
  roomRailHeaderCompact: { minHeight: 36 },
  roomRailTitleRow: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 7 },
  roomRailTitle: { fontSize: 13, fontWeight: '700' as const },
  roomRailActions: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 4 },
  navigationButton: { alignItems: 'center' as const, borderRadius: 8, justifyContent: 'center' as const, minHeight: 30, minWidth: 30 },
  iconButton: { alignItems: 'center' as const, borderRadius: 7, justifyContent: 'center' as const, minHeight: 28, minWidth: 28 },
  separationNote: { fontSize: 10, marginBottom: 8, marginTop: 3 },
  roomList: { gap: 6, paddingBottom: 18, paddingTop: 5 },
  roomItem: { alignItems: 'center' as const, borderRadius: 9, borderWidth: 1, flexDirection: 'row' as const, gap: 8, minHeight: 48, paddingHorizontal: 8, paddingVertical: 7 },
  roomItemIcon: { alignItems: 'center' as const, height: 25, justifyContent: 'center' as const, position: 'relative' as const, width: 25 },
  runningDot: { borderRadius: 4, bottom: 0, height: 7, position: 'absolute' as const, right: 0, width: 7 },
  roomItemCopy: { flex: 1, minWidth: 0 },
  roomItemTitle: { fontSize: 12, fontWeight: '600' as const },
  roomItemPreview: { fontSize: 10, marginTop: 2 },
  emptyRoomRail: { alignItems: 'center' as const, gap: 7, paddingHorizontal: 10, paddingVertical: 30 },
  emptyRoomText: { fontSize: 11, textAlign: 'center' as const },
  conversation: { flex: 1, minWidth: 0, position: 'relative' as const },
  conversationToolbar: { alignItems: 'center' as const, borderBottomWidth: 1, flexDirection: 'row' as const, justifyContent: 'space-between' as const, minHeight: 54, paddingHorizontal: 12, paddingVertical: 8 },
  conversationHeading: { alignItems: 'center' as const, flexDirection: 'row' as const, flex: 1, gap: 8, minWidth: 0 },
  conversationHeadingCopy: { flex: 1, minWidth: 0 },
  conversationTitle: { fontSize: 14, fontWeight: '700' as const },
  conversationMeta: { fontSize: 10, marginTop: 2 },
  connectionStatus: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 4, marginLeft: 8 },
  connectionText: { fontSize: 10, fontWeight: '600' as const },
  errorBannerRow: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 6, paddingLeft: 12, paddingRight: 6 },
  errorBanner: { fontSize: 11, paddingTop: 8 },
  messageStream: { flex: 1, minHeight: 0 },
  typingText: { fontSize: 10, paddingLeft: 32 },
  runningText: { fontSize: 10, fontWeight: '600' as const, paddingLeft: 32 },
  composer: { alignItems: 'flex-end' as const, borderTopWidth: 1, flexDirection: 'row' as const, gap: 8, paddingHorizontal: 10, paddingTop: 9 },
  input: { borderRadius: 10, borderWidth: 1, flex: 1, fontSize: 13, lineHeight: 19, maxHeight: 110, minHeight: 42, paddingHorizontal: 11, paddingVertical: 9 },
  sendButton: { alignItems: 'center' as const, borderRadius: 10, height: 42, justifyContent: 'center' as const, width: 42 },
  bottomActions: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 4, paddingBottom: 5, paddingRight: 12, paddingTop: 2 },
  modalInput: { borderRadius: 8, borderWidth: 1, fontSize: 13, marginTop: 10, minHeight: 40, paddingHorizontal: 10, paddingVertical: 8 },
  inputSettingsButton: { alignItems: 'center' as const, borderRadius: 9, height: 42, justifyContent: 'center' as const, width: 30 },
  mentionBar: { alignItems: 'center' as const, borderTopWidth: 1, flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, paddingHorizontal: 10, paddingVertical: 6 },
  mentionHint: { fontSize: 10, marginRight: 2 },
  mentionChip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  mentionChipText: { fontSize: 10, fontWeight: '700' as const },
  inputSettingRow: { alignItems: 'center' as const, borderBottomWidth: 1, flexDirection: 'row' as const, gap: 10, paddingVertical: 12 },
  inputSettingCopy: { flex: 1, minWidth: 0 },
  inputSettingTitle: { fontSize: 12, fontWeight: '700' as const },
  inputSettingDetail: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  inputSettingToggle: { alignItems: 'center' as const, justifyContent: 'center' as const },
  toggleButton: { alignItems: 'center' as const, borderRadius: 999, minWidth: 44, paddingHorizontal: 8, paddingVertical: 5 },
  toggleButtonText: { fontSize: 10, fontWeight: '800' as const },
};

function mentionOptions(agents: Array<{ name: string }>, draft: string): string[] {
  const match = draft.match(/(?:^|\s)@([^\s]*)$/);
  if (!match) return [];
  const query = match[1].toLowerCase();
  return ['all', ...agents.map((agent) => agent.name).filter(Boolean)]
    .filter((name, index, values) => values.indexOf(name) === index && name.toLowerCase().includes(query))
    .slice(0, 6);
}

function replaceMention(draft: string, name: string): string {
  return draft.replace(/(?:^|\s)@([^\s]*)$/, (match) => `${match.startsWith(' ') ? ' ' : ''}@${name} `);
}
