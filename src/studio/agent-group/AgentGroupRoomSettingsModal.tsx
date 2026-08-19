import {
  Copy,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  UserRoundPlus,
} from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type {
  HermesStudioRoomAgent,
  HermesStudioRoomAgentInput,
} from '../../api/hermes-studio';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { NativeButton } from '../../components/ui/NativeButton';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { PreviewModal, PreviewText } from '../PreviewPrimitives';
import type { AgentGroupChatController } from './useAgentGroupChatController';

export interface AgentGroupRoomSettingsModalProps {
  controller: AgentGroupChatController;
  isChinese: boolean;
  onClose(): void;
  open: boolean;
}

interface AgentForm {
  agent: string;
  profile: string;
  provider: string;
  model: string;
  apiMode: string;
  reasoningEffort: string;
  name: string;
  description: string;
  avatar: string;
}

const EMPTY_AGENT: AgentForm = {
  agent: 'hermes',
  profile: 'default',
  provider: '',
  model: '',
  apiMode: 'chat_completions',
  reasoningEffort: '',
  name: '',
  description: '',
  avatar: '',
};

export function AgentGroupRoomSettingsModal({
  controller,
  isChinese,
  onClose,
  open,
}: AgentGroupRoomSettingsModalProps) {
  const { tokens } = useTheme();
  const activeRoom = controller.activeRoom;
  const roomId = activeRoom?.room.id || '';
  const [roomName, setRoomName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [summaryProfile, setSummaryProfile] = useState('default');
  const [summaryProvider, setSummaryProvider] = useState('');
  const [summaryModel, setSummaryModel] = useState('');
  const [summaryApiMode, setSummaryApiMode] = useState('chat_completions');
  const [summaryEveryTurns, setSummaryEveryTurns] = useState('20');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneInviteCode, setCloneInviteCode] = useState('');
  const [editingAgent, setEditingAgent] = useState<HermesStudioRoomAgent | null>(null);
  const [agentForm, setAgentForm] = useState<AgentForm>(EMPTY_AGENT);
  const [agentEditorOpen, setAgentEditorOpen] = useState(false);
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null);
  // While the user is editing, their input wins over server refreshes; the
  // flag resets on close and after a save so the next projection syncs in.
  const formDirtyRef = useRef(false);
  const markDirty = () => { formDirtyRef.current = true; };

  const serverRoomFingerprint = activeRoom
    ? [
      activeRoom.room.id,
      activeRoom.room.name,
      activeRoom.room.inviteCode || '',
      activeRoom.room.workspace || '',
      activeRoom.room.summaryProfile || '',
      activeRoom.room.summaryProvider || '',
      activeRoom.room.summaryModel || '',
      activeRoom.room.summaryApiMode || '',
      String(activeRoom.room.summaryEveryTurns || 20),
    ].join('\u0001')
    : '';

  useEffect(() => {
    if (!open) {
      formDirtyRef.current = false;
      return;
    }
    if (!roomId || !activeRoom) return;
    if (formDirtyRef.current) return;
    const room = activeRoom.room;
    setRoomName(room.name);
    setInviteCode(room.inviteCode || '');
    setWorkspace(room.workspace || '');
    setSummaryProfile(room.summaryProfile || 'default');
    setSummaryProvider(room.summaryProvider || '');
    setSummaryModel(room.summaryModel || '');
    setSummaryApiMode(room.summaryApiMode || 'chat_completions');
    setSummaryEveryTurns(String(room.summaryEveryTurns || 20));
    setSummaryDraft(activeRoom.summary?.summary || '');
    setEditingAgent(null);
    setAgentForm(EMPTY_AGENT);
    void controller.loadRoomSummary(roomId);
    setAgentEditorOpen(false);
    // Re-run whenever the server projection changes (poll refresh, save
    // response normalized server-side, another device editing the room) so
    // the form never shows stale fields for the same room.
  }, [open, roomId, serverRoomFingerprint]);

  useEffect(() => {
    if (!formDirtyRef.current && activeRoom?.room.id === roomId && activeRoom.summary) setSummaryDraft(activeRoom.summary.summary);
  }, [activeRoom?.summary, activeRoom?.room.id, roomId]);

  if (!activeRoom) return null;

  // Owner-only operations (rename, invite code, workspace, compression,
  // agent roster, clone) are gated so members never see actionable 403s.
  const canManage = activeRoom.room.canManage !== false;

  const updateAgentForm = (key: keyof AgentForm, value: string) => {
    markDirty();
    setAgentForm((current) => ({ ...current, [key]: value }));
  };

  const saveRoomBasics = () => {
    formDirtyRef.current = false;
    void controller.updateRoomConfig(roomId, { name: roomName.trim() });
  };

  const saveSummaryConfig = () => {
    formDirtyRef.current = false;
    void controller.updateRoomConfig(roomId, {
      summaryProfile: summaryProfile.trim() || 'default',
      summaryProvider: summaryProvider.trim(),
      summaryModel: summaryModel.trim(),
      summaryApiMode: summaryApiMode.trim() || 'chat_completions',
      summaryEveryTurns: Math.max(1, Number(summaryEveryTurns) || 20),
    });
  };

  const saveAgent = () => {
    const input: HermesStudioRoomAgentInput = {
      agent: agentForm.agent.trim() || 'hermes',
      profile: agentForm.profile.trim() || 'default',
      provider: agentForm.provider.trim(),
      model: agentForm.model.trim(),
      apiMode: agentForm.apiMode.trim(),
      reasoningEffort: agentForm.reasoningEffort.trim(),
      name: agentForm.name.trim(),
      description: agentForm.description.trim(),
      avatar: agentForm.avatar.trim(),
    };
    if (editingAgent) void controller.updateAgent(roomId, editingAgent.id, input);
    else void controller.addAgent(roomId, input);
    setEditingAgent(null);
    setAgentForm(EMPTY_AGENT);
    setAgentEditorOpen(false);
  };

  const beginEditAgent = (agent: HermesStudioRoomAgent) => {
    setEditingAgent(agent);
    setAgentEditorOpen(true);
    setAgentForm({
      agent: agent.agent || 'hermes',
      profile: agent.profile || 'default',
      provider: agent.provider || '',
      model: agent.model || '',
      apiMode: agent.apiMode || 'chat_completions',
      reasoningEffort: agent.reasoningEffort || '',
      name: agent.name || '',
      description: agent.description || '',
      avatar: agent.avatar || '',
    });
  };

  return (
    <>
      <PreviewModal
        onClose={onClose}
        open={open}
        title={isChinese ? 'Agent 房间设置' : 'Agent room settings'}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <PreviewText variant="muted">
            {isChinese
              ? '这些设置来自 Hermes Studio 最新版；它们只作用于 Agent 群聊房间，不会写入托管协作时间线。'
              : 'These settings come from the latest Hermes Studio contract and never write to the hosted collaboration timeline.'}
          </PreviewText>

          <Section isChinese={isChinese} title={isChinese ? '房间基础设置' : 'Room basics'}>
            {canManage ? (
              <>
                <Field label={isChinese ? '房间名称' : 'Room name'} value={roomName} onChangeText={(value) => { markDirty(); setRoomName(value); }} />
                <NativeButton disabled={!roomName.trim() || roomName.trim() === activeRoom.room.name} onPress={saveRoomBasics} prefix={<Save />} size="sm">
                  {isChinese ? '保存名称' : 'Save name'}
                </NativeButton>
                <Field label={isChinese ? '邀请码' : 'Invite code'} value={inviteCode} onChangeText={(value) => { markDirty(); setInviteCode(value); }} />
                <View style={styles.inlineButtons}>
                  <NativeButton ghost onPress={() => { markDirty(); setInviteCode(generateInviteCode()); }} prefix={<RefreshCw />} size="sm">
                    {isChinese ? '生成' : 'Generate'}
                  </NativeButton>
                  <NativeButton disabled={!inviteCode.trim()} onPress={() => { formDirtyRef.current = false; void controller.updateInviteCode(roomId, inviteCode.trim()); }} prefix={<Save />} size="sm">
                    {isChinese ? '保存邀请码' : 'Save invite code'}
                  </NativeButton>
                </View>
                <Field label={isChinese ? '工作区路径' : 'Workspace path'} value={workspace} onChangeText={(value) => { markDirty(); setWorkspace(value); }} multiline />
                <NativeButton onPress={() => { formDirtyRef.current = false; void controller.updateRoomWorkspace(roomId, workspace.trim()); }} prefix={<Save />} size="sm">
                  {isChinese ? '保存工作区' : 'Save workspace'}
                </NativeButton>
              </>
            ) : (
              <PreviewText variant="muted">
                {isChinese ? '你是本房间成员：名称、邀请码与工作区由房主管理。' : 'You are a member here: the owner manages the name, invite code, and workspace.'}
              </PreviewText>
            )}
          </Section>

          <Section isChinese={isChinese} title={isChinese ? '上下文压缩设置' : 'Context compression'}>
            {canManage ? (
              <>
                <Field label={isChinese ? '摘要 Profile' : 'Summary profile'} value={summaryProfile} onChangeText={(value) => { markDirty(); setSummaryProfile(value); }} />
                <Field label={isChinese ? '摘要 Provider' : 'Summary provider'} value={summaryProvider} onChangeText={(value) => { markDirty(); setSummaryProvider(value); }} />
                <Field label={isChinese ? '摘要 Model' : 'Summary model'} value={summaryModel} onChangeText={(value) => { markDirty(); setSummaryModel(value); }} />
                <Field label={isChinese ? '摘要 API 模式' : 'Summary API mode'} value={summaryApiMode} onChangeText={(value) => { markDirty(); setSummaryApiMode(value); }} />
                <Field label={isChinese ? '每多少轮压缩' : 'Summarize every turns'} value={summaryEveryTurns} onChangeText={(value) => { markDirty(); setSummaryEveryTurns(value); }} keyboardType="number-pad" />
                <NativeButton onPress={saveSummaryConfig} prefix={<Save />} size="sm">
                  {isChinese ? '保存压缩配置' : 'Save compression settings'}
                </NativeButton>
              </>
            ) : (
              <PreviewText variant="muted">
                {isChinese ? '压缩配置由房主管理。' : 'Compression settings are managed by the room owner.'}
              </PreviewText>
            )}
            <Text style={[styles.summaryMeta, { color: tokens.colors.textTertiary }]}>
              {activeRoom.summary
                ? `${isChinese ? '状态' : 'Status'}: ${activeRoom.summary.status} · ${isChinese ? '已压缩轮数' : 'Summarized turns'}: ${activeRoom.summary.summarizedTurnCount}`
                : (isChinese ? '尚未读取摘要状态' : 'Summary state has not been loaded')}
            </Text>
            {canManage ? (
              <>
                <Field label={isChinese ? '当前摘要（可编辑）' : 'Current summary (editable)'} value={summaryDraft} onChangeText={(value) => { markDirty(); setSummaryDraft(value); }} multiline large />
                <NativeButton onPress={() => { formDirtyRef.current = false; void controller.updateRoomSummary(roomId, summaryDraft); }} prefix={<Save />} size="sm">
                  {isChinese ? '保存摘要' : 'Save summary'}
                </NativeButton>
              </>
            ) : (
              activeRoom.summary?.summary ? (
                <Text numberOfLines={12} style={[styles.summaryMeta, { color: tokens.colors.textSecondary }]}>
                  {activeRoom.summary.summary}
                </Text>
              ) : null
            )}
          </Section>

          <Section isChinese={isChinese} title={isChinese ? `房间 Agent · ${activeRoom.agents.length}` : `Room agents · ${activeRoom.agents.length}`}>
            {activeRoom.agents.map((agent) => (
              <View key={agent.id} style={[styles.agentRow, { borderColor: tokens.colors.border, backgroundColor: tokens.colors.card }]}>
                <View style={[styles.agentAvatar, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.14) }]}>
                  <Text style={[styles.agentAvatarText, { color: tokens.colors.primary }]}>{(agent.name || agent.agent || 'A').slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.agentCopy}>
                  <Text numberOfLines={1} style={[styles.agentName, { color: tokens.colors.foreground }]}>{agent.name || agent.profile}</Text>
                  <Text numberOfLines={2} style={[styles.agentMeta, { color: tokens.colors.textTertiary }]}>
                    {agent.agent} · {agent.profile} · {agent.provider || 'default'} / {agent.model || 'default'}
                  </Text>
                  {agent.description ? <Text numberOfLines={1} style={[styles.agentMeta, { color: tokens.colors.textSecondary }]}>{agent.description}</Text> : null}
                </View>
                {canManage ? (
                  <IOSPressable accessibilityLabel={isChinese ? '编辑 Agent' : 'Edit Agent'} onPress={() => beginEditAgent(agent)} style={styles.smallIcon}>
                    <Settings2 color={tokens.colors.textSecondary} size={15} />
                  </IOSPressable>
                ) : null}
                {canManage ? (
                  <IOSPressable accessibilityLabel={isChinese ? '删除 Agent' : 'Remove Agent'} onPress={() => setDeleteAgentId(agent.id)} style={styles.smallIcon}>
                    <Trash2 color={tokens.colors.destructive} size={15} />
                  </IOSPressable>
                ) : null}
              </View>
            ))}
            {canManage ? (
              <NativeButton ghost onPress={() => { setEditingAgent(null); setAgentForm(EMPTY_AGENT); setAgentEditorOpen(true); }} prefix={<UserRoundPlus />} size="sm">
                {isChinese ? '添加 Agent / 打开编辑器' : 'Add Agent / open editor'}
              </NativeButton>
            ) : (
              <PreviewText variant="muted">
                {isChinese ? 'Agent 名单由房主管理。' : 'The agent roster is managed by the room owner.'}
              </PreviewText>
            )}
            {agentEditorOpen ? (
              <View style={[styles.agentEditor, { borderColor: tokens.colors.border }]}>
                <Text style={[styles.editorTitle, { color: tokens.colors.foreground }]}>
                  {editingAgent ? (isChinese ? `编辑 ${editingAgent.name}` : `Edit ${editingAgent.name}`) : (isChinese ? '添加 Agent' : 'Add Agent')}
                </Text>
                <Field label={isChinese ? 'Agent 类型' : 'Agent type'} value={agentForm.agent} onChangeText={(value) => updateAgentForm('agent', value)} />
                <Field label="Profile" value={agentForm.profile} onChangeText={(value) => updateAgentForm('profile', value)} />
                <Field label="Provider" value={agentForm.provider} onChangeText={(value) => updateAgentForm('provider', value)} />
                <Field label="Model" value={agentForm.model} onChangeText={(value) => updateAgentForm('model', value)} />
                <Field label={isChinese ? 'API 模式' : 'API mode'} value={agentForm.apiMode} onChangeText={(value) => updateAgentForm('apiMode', value)} />
                <Field label={isChinese ? '推理强度' : 'Reasoning effort'} value={agentForm.reasoningEffort} onChangeText={(value) => updateAgentForm('reasoningEffort', value)} />
                <Field label={isChinese ? '显示名称' : 'Display name'} value={agentForm.name} onChangeText={(value) => updateAgentForm('name', value)} />
                <Field label={isChinese ? '描述' : 'Description'} value={agentForm.description} onChangeText={(value) => updateAgentForm('description', value)} multiline />
                <Field label={isChinese ? '头像 JSON / data URL' : 'Avatar JSON / data URL'} value={agentForm.avatar} onChangeText={(value) => updateAgentForm('avatar', value)} multiline />
                <View style={styles.inlineButtons}>
                  <NativeButton ghost onPress={() => { setEditingAgent(null); setAgentForm(EMPTY_AGENT); setAgentEditorOpen(false); }} size="sm">
                    {isChinese ? '取消' : 'Cancel'}
                  </NativeButton>
                  <NativeButton onPress={saveAgent} prefix={editingAgent ? <Save /> : <Plus />} size="sm">
                    {editingAgent ? (isChinese ? '更新 Agent' : 'Update Agent') : (isChinese ? '添加 Agent' : 'Add Agent')}
                  </NativeButton>
                </View>
              </View>
            ) : null}
          </Section>

          <Section isChinese={isChinese} title={isChinese ? '房间操作' : 'Room actions'}>
            {canManage ? (
              <>
                <Field label={isChinese ? '克隆后的名称' : 'Clone name'} value={cloneName} onChangeText={setCloneName} />
                <Field label={isChinese ? '克隆邀请码（可选）' : 'Clone invite code (optional)'} value={cloneInviteCode} onChangeText={setCloneInviteCode} />
                <NativeButton disabled={!cloneName.trim()} onPress={() => void controller.cloneRoom(roomId, cloneName.trim(), cloneInviteCode.trim() || undefined)} prefix={<Copy />} size="sm">
                  {isChinese ? '克隆房间' : 'Clone room'}
                </NativeButton>
              </>
            ) : (
              <PreviewText variant="muted">
                {isChinese ? '克隆房间需要房主身份。' : 'Cloning a room requires the owner.'}
              </PreviewText>
            )}
            <Field label={isChinese ? '用邀请码加入其他房间' : 'Join another room by invite code'} value={joinCode} onChangeText={setJoinCode} />
            <NativeButton disabled={!joinCode.trim()} onPress={() => { void controller.joinRoomByCode(joinCode.trim()).catch(() => undefined); }} prefix={<Link2 />} size="sm">
              {isChinese ? '加入房间' : 'Join room'}
            </NativeButton>
          </Section>
        </ScrollView>
      </PreviewModal>

      <ConfirmDialog
        cancelLabel={isChinese ? '取消' : 'Cancel'}
        confirmLabel={isChinese ? '删除' : 'Remove'}
        description={isChinese ? '删除 Agent 后，它将不再参与这个 Hermes Studio 房间。' : 'The Agent will stop participating in this Hermes Studio room.'}
        destructive
        onCancel={() => setDeleteAgentId(null)}
        onConfirm={() => {
          if (deleteAgentId) void controller.removeAgent(roomId, deleteAgentId);
          setDeleteAgentId(null);
        }}
        open={Boolean(deleteAgentId)}
        title={isChinese ? '删除房间 Agent？' : 'Remove room Agent?'}
      />
    </>
  );
}

function Section({ children, isChinese: _isChinese, title }: { children: ReactNode; isChinese: boolean; title: string }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.section, { borderColor: tokens.colors.border, backgroundColor: tokens.colors.background }]}>
      <View style={styles.sectionHeader}>
        <Settings2 color={tokens.colors.primary} size={15} />
        <Text style={[styles.sectionTitle, { color: tokens.colors.foreground }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  large = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  multiline?: boolean;
  large?: boolean;
  keyboardType?: 'default' | 'number-pad';
}) {
  const { tokens } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: tokens.colors.textSecondary }]}>{label}</Text>
      <TextInput
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholderTextColor={tokens.colors.textTertiary}
        style={[styles.input, (multiline || large) && styles.inputLarge, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
        value={value}
      />
    </View>
  );
}

function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

const styles = {
  content: { gap: 12, paddingBottom: 28 },
  section: { borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 },
  sectionHeader: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 7, marginBottom: 2 },
  sectionTitle: { fontSize: 13, fontWeight: '700' as const },
  field: { gap: 5 },
  label: { fontSize: 11, fontWeight: '600' as const },
  input: { borderRadius: 8, borderWidth: 1, fontSize: 12, minHeight: 38, paddingHorizontal: 9, paddingVertical: 7 },
  inputLarge: { minHeight: 78, textAlignVertical: 'top' as const },
  inlineButtons: { alignItems: 'center' as const, flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 7 },
  summaryMeta: { fontSize: 10, lineHeight: 15 },
  agentRow: { alignItems: 'center' as const, borderRadius: 9, borderWidth: 1, flexDirection: 'row' as const, gap: 8, padding: 8 },
  agentAvatar: { alignItems: 'center' as const, borderRadius: 18, height: 30, justifyContent: 'center' as const, width: 30 },
  agentAvatarText: { fontSize: 13, fontWeight: '800' as const },
  agentCopy: { flex: 1, minWidth: 0 },
  agentName: { fontSize: 12, fontWeight: '700' as const },
  agentMeta: { fontSize: 10, marginTop: 2 },
  smallIcon: { alignItems: 'center' as const, borderRadius: 7, justifyContent: 'center' as const, minHeight: 28, minWidth: 28 },
  agentEditor: { borderRadius: 9, borderWidth: 1, gap: 8, marginTop: 5, padding: 9 },
  editorTitle: { fontSize: 12, fontWeight: '700' as const },
};
