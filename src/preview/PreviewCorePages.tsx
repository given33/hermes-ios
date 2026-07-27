import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  Activity,
  AlertCircle,
  Bot,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Copy,
  Download,
  File,
  FileText,
  Folder,
  FolderPlus,
  Image,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  User,
  Wrench,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Reanimated, {
  FadeIn,
  FadeOut,
  SlideInLeft,
  SlideOutLeft,
} from 'react-native-reanimated';

import type { HermesApiClient } from '../api/HermesApiClient';
import type {
  CustomModelConfiguration,
  CustomModelConnectionResult,
} from '../api/HermesCloudApi';
import { hermesCloudApiFor } from '../api/hermes-api-registry';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { IOSContextMenu } from '../components/ios/IOSContextMenu';
import { IOSPressable } from '../components/ios/IOSPressable';
import { IOSSwipeActions } from '../components/ios/IOSSwipeActions';
import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { ScreenState } from '../components/ui/ScreenState';
import { StudioProfileAvatar } from '../components/studio/StudioProfileAvatar';
import { multiplyAlpha } from '../design/control-contracts';
import { MOTION, useMotion } from '../design/motion';
import { useTheme } from '../design/ThemeProvider';
import { WEBUI_FONT_FAMILIES } from '../app/webui-fonts';
import {
  PREVIEW_FILES,
  PREVIEW_LOGS,
  PREVIEW_MODELS,
  PREVIEW_SESSIONS,
  PREVIEW_TOKEN_DAYS,
} from './preview-fixtures';
import {
  PreviewBadge,
  PreviewBarChart,
  PreviewCard,
  PreviewDataRow,
  PreviewDivider,
  PreviewGrid,
  PreviewLineChart,
  PreviewMetric,
  PreviewModal,
  PreviewPage,
  PreviewProgress,
  PreviewRow,
  PreviewSearch,
  PreviewSegmented,
  PreviewSettingRow,
  PreviewText,
  PreviewToggle,
} from '../studio/PreviewPrimitives';

export interface PreviewPageProps {
  gatewayStatuses?: readonly {
    id: string;
    label: string;
    state: 'online' | 'offline' | 'degraded' | 'unknown';
    version?: string | null;
  }[];
  locale?: 'en' | 'zh';
  navigate(path: string): void;
  notify(message: string): void;
  serverOnline?: boolean;
}

export function SessionsPreviewPage({ locale = 'zh', navigate, notify }: PreviewPageProps) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const { width } = useWindowDimensions();
  const chinese = locale === 'zh';
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(PREVIEW_SESSIONS[0].id);
  const [showSessions, setShowSessions] = useState(true);
  const compact = width < 720;
  const filtered = PREVIEW_SESSIONS.filter((session) => (
    `${session.title} ${session.preview} ${session.model}`
      .toLowerCase()
      .includes(query.toLowerCase())
  ));
  const selected = PREVIEW_SESSIONS.find((session) => session.id === selectedId) ?? PREVIEW_SESSIONS[0];
  const selectSession = (sessionId: string) => {
    setSelectedId(sessionId);
    if (compact) setShowSessions(false);
  };
  return (
    <View style={[styles.historyPanel, { backgroundColor: tokens.colors.card }]}>
      {compact && showSessions ? (
        <Reanimated.View
          entering={motion.animate(FadeIn.duration(MOTION.duration.transition))}
          exiting={motion.animate(FadeOut.duration(MOTION.duration.transition))}
          style={styles.historyBackdrop}
        >
          <IOSPressable
            accessibilityLabel={chinese ? '关闭会话列表' : 'Close session list'}
            onPress={() => setShowSessions(false)}
            style={[styles.historyBackdropFill, { backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.38) }]}
          />
        </Reanimated.View>
      ) : null}
      {(!compact || showSessions) ? (
        // The overlaid session list slides on compact widths (transition
        // band, interruptible, dropped under Reduce Motion); on wide layouts
        // it is a permanent column and must not animate on mount.
        <Reanimated.View
          entering={compact
            ? motion.animate(SlideInLeft.duration(MOTION.duration.transition))
            : undefined}
          exiting={compact
            ? motion.animate(SlideOutLeft.duration(MOTION.duration.transition))
            : undefined}
          style={[
            styles.historySidebar,
            { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border },
            compact && styles.historySidebarCompact,
          ]}
        >
          <View style={[styles.historySidebarHeader, { borderBottomColor: tokens.colors.border }]}>
            <NativeButton onPress={() => navigate('/chat')} prefix={<Plus />} size="sm">
              {chinese ? '新建会话' : 'New chat'}
            </NativeButton>
            <NativeButton accessibilityLabel={chinese ? '批量管理' : 'Batch manage'} ghost onPress={() => notify(chinese ? '已进入批量管理' : 'Batch mode opened')} size="icon">
              <Check />
            </NativeButton>
          </View>
          <View style={styles.historySearch}>
            <PreviewSearch onChangeText={setQuery} placeholder={chinese ? '搜索会话...' : 'Search sessions...'} value={query} />
          </View>
          <ScrollView contentContainerStyle={styles.historySessionGroups} scrollEventThrottle={8} showsVerticalScrollIndicator={false}>
            <PreviewText style={styles.historyGroupTitle} variant="label">Web UI · {filtered.length}</PreviewText>
            {filtered.map((session) => (
              <IOSSwipeActions
                actions={[
                  { icon: 'pencil', id: 'rename', label: chinese ? '重命名' : 'Rename', onPress: () => notify(`Rename session: ${session.title}`) },
                  { destructive: true, icon: 'trash', id: 'delete', label: chinese ? '删除' : 'Delete', onPress: () => setDeleteTarget(session.title) },
                ]}
                key={session.id}
              >
                <IOSContextMenu
                  accessibilityLabel={`${chinese ? '打开' : 'Open'} ${session.title}`}
                  actions={[
                    { id: 'resume', onPress: () => navigate('/chat'), systemImage: 'play', title: chinese ? '在聊天中继续' : 'Resume in chat' },
                    { id: 'copy', onPress: () => notify(session.id), systemImage: 'doc.on.doc', title: chinese ? '复制会话 ID' : 'Copy session ID' },
                    { destructive: true, id: 'delete', onPress: () => setDeleteTarget(session.title), systemImage: 'trash', title: chinese ? '删除会话' : 'Delete session' },
                  ]}
                  onPress={() => selectSession(session.id)}
                  style={[
                    styles.historySessionItem,
                    selected.id === session.id && { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.1) },
                  ]}
                >
                  <View style={styles.historySessionTitleRow}>
                    <PreviewText numberOfLines={1} style={styles.historySessionTitle} variant="heading">{session.title}</PreviewText>
                    <PreviewText variant="tiny">{session.updated}</PreviewText>
                  </View>
                  <View style={styles.historySessionAgentRow}>
                    <StudioProfileAvatar seed={session.active ? 'default' : session.model} size={18} />
                    <PreviewText numberOfLines={1} variant="tiny">default · {session.model.split('/').pop()}</PreviewText>
                    {session.active ? <View style={[styles.historyUnreadDot, { backgroundColor: tokens.colors.success }]} /> : null}
                  </View>
                </IOSContextMenu>
              </IOSSwipeActions>
            ))}
            <PreviewText style={styles.historyGroupTitle} variant="label">API Server · 0</PreviewText>
          </ScrollView>
          <View style={[styles.historySidebarFooter, { borderTopColor: tokens.colors.border }]}>
            <PreviewText variant="tiny">default</PreviewText>
            <PreviewText variant="tiny">{filtered.length} sessions</PreviewText>
          </View>
        </Reanimated.View>
      ) : null}
      <View style={styles.historyMain}>
        <View style={[styles.historyHeader, { borderBottomColor: tokens.colors.border }]}>
          <View style={styles.historyHeaderLeft}>
            <NativeButton accessibilityLabel={chinese ? '切换会话列表' : 'Toggle sessions'} ghost onPress={() => setShowSessions((value) => !value)} size="icon">
              <MessageSquare />
            </NativeButton>
            <PreviewText numberOfLines={1} style={styles.historyHeaderTitle} variant="heading">{selected.title}</PreviewText>
            <PreviewBadge tone="outline">Web UI</PreviewBadge>
          </View>
          <PreviewRow style={styles.historyHeaderActions}>
            <NativeButton accessibilityLabel={chinese ? '复制会话 ID' : 'Copy session ID'} ghost onPress={() => notify(selected.id)} size="icon"><Copy /></NativeButton>
            <NativeButton accessibilityLabel={chinese ? '查看大纲' : 'Show outline'} ghost onPress={() => notify(chinese ? '已打开消息大纲' : 'Message outline opened')} size="icon"><PanelRight /></NativeButton>
          </PreviewRow>
        </View>
        <ScrollView contentContainerStyle={styles.historyMessages} scrollEventThrottle={8} showsVerticalScrollIndicator={false}>
          <View style={styles.historyMessageRow}>
            <StudioProfileAvatar seed="Given iOS User" size={36} />
            <View style={styles.historyMessageCopy}>
              <View style={styles.historyMessageMeta}>
                <PreviewText variant="heading">Given</PreviewText>
                <PreviewText variant="tiny">{selected.updated}</PreviewText>
              </View>
              <View style={[styles.historyBubble, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.06) }]}>
                <PreviewText>{selected.title}</PreviewText>
              </View>
            </View>
          </View>
          <View style={styles.historyMessageRow}>
            <StudioProfileAvatar seed="default" size={36} />
            <View style={styles.historyMessageCopy}>
              <View style={styles.historyMessageMeta}>
                <PreviewText variant="heading">Hermes</PreviewText>
                <PreviewText variant="tiny">{selected.model.split('/').pop()} · {selected.messages} messages</PreviewText>
              </View>
              <View style={[styles.historyBubble, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.06) }]}>
                <PreviewText>{selected.preview}</PreviewText>
              </View>
              <PreviewRow>
                <PreviewBadge tone="outline">{selected.tools} tools</PreviewBadge>
                <PreviewBadge tone={selected.active ? 'success' : 'outline'}>{selected.active ? 'LIVE' : 'DONE'}</PreviewBadge>
              </PreviewRow>
            </View>
          </View>
        </ScrollView>
      </View>
      <ConfirmDialog
        description={chinese ? '此操作会永久删除该会话及其全部消息。' : 'This permanently removes the conversation and all of its messages.'}
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          notify(`Deleted session: ${deleteTarget}`);
          setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        title={chinese ? '删除会话？' : 'Delete session?'}
      />
    </View>
  );
}

export function FilesPreviewPage({ notify }: PreviewPageProps) {
  const { width } = useWindowDimensions();
  const { tokens } = useTheme();
  const [path, setPath] = useState('~/.hermes');
  const [folderModal, setFolderModal] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const compact = width < 700;
  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true });
    if (!result.canceled) notify(`${result.assets.length} file selected`);
  };
  return (
    <View
      style={[
        styles.filesWorkspace,
        compact && styles.filesWorkspaceCompact,
        { backgroundColor: tokens.colors.background },
      ]}
    >
      <View
        style={[
          styles.filesTree,
          compact && styles.filesTreeCompact,
          { borderColor: tokens.colors.border },
        ]}
      >
        <View style={styles.filesTreeHeader}>
          <PreviewText variant="heading">文件</PreviewText>
          <NativeButton accessibilityLabel="Refresh files" ghost onPress={() => notify('Files refreshed')} size="icon">
            <RefreshCw />
          </NativeButton>
        </View>
        {['~/.hermes', 'workspaces', 'attachments', 'exports', 'profiles'].map((entry, index) => (
          <IOSPressable
            key={entry}
            onPress={() => setPath(index === 0 ? entry : `~/.hermes/${entry}`)}
            style={[
              styles.filesTreeRow,
              path.endsWith(entry) && { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.10) },
            ]}
          >
            <Folder color={tokens.colors.textSecondary} size={16} />
            <PreviewText numberOfLines={1}>{entry}</PreviewText>
          </IOSPressable>
        ))}
      </View>

      <View style={styles.filesMain}>
        <View style={[styles.filesToolbar, { borderBottomColor: tokens.colors.border }]}>
          <PreviewRow>
            <NativeButton onPress={() => notify('New file')} outlined prefix={<FileText />} size="sm">新建文件</NativeButton>
            <NativeButton onPress={() => setFolderModal(true)} outlined prefix={<FolderPlus />} size="sm">新建文件夹</NativeButton>
            <NativeButton onPress={pickFiles} prefix={<Upload />} size="sm">上传</NativeButton>
          </PreviewRow>
        </View>
        <View style={[styles.filesBreadcrumb, { borderBottomColor: tokens.colors.border }]}>
          <PreviewText numberOfLines={1} style={styles.flexInput} variant="mono">{path}</PreviewText>
          <NativeButton accessibilityLabel="Open path" onPress={() => notify(`Opened ${path}`)} size="icon">
            <ChevronDown />
          </NativeButton>
        </View>
        <ScrollView contentContainerStyle={styles.filesList} scrollEventThrottle={8} style={styles.filesListScroll}>
        <View style={styles.fileHeader}>
          <PreviewText style={styles.fileName} variant="label">Name</PreviewText>
          <PreviewText style={styles.fileMeta} variant="label">Size</PreviewText>
          <PreviewText style={styles.fileMeta} variant="label">Modified</PreviewText>
          <View style={styles.fileActions} />
        </View>
        {PREVIEW_FILES.map((entry) => {
          const Icon = entry.kind === 'folder' ? Folder : File;
          return (
            <IOSSwipeActions
              actions={[
                ...(entry.kind === 'file' ? [{
                  icon: 'square.and.arrow.down',
                  id: 'download',
                  label: 'Save',
                  onPress: () => notify(`Download prepared: ${entry.name}`),
                }] : []),
                {
                  destructive: true,
                  icon: 'trash',
                  id: 'delete',
                  label: 'Delete',
                  onPress: () => notify(`Deleted: ${entry.name}`),
                },
              ]}
              key={entry.name}
            >
            <View style={styles.fileRow}>
              <IOSContextMenu
                actions={[
                  ...(entry.kind === 'file' ? [{
                    id: 'preview',
                    onPress: () => notify(`Previewing ${entry.name}`),
                    systemImage: 'doc.text.magnifyingglass',
                    title: 'Quick Look',
                  }, {
                    id: 'save',
                    onPress: () => notify(`Download prepared: ${entry.name}`),
                    systemImage: 'square.and.arrow.down',
                    title: 'Save to Files',
                  }] : []),
                  {
                    destructive: true,
                    id: 'delete',
                    onPress: () => notify(`Deleted: ${entry.name}`),
                    systemImage: 'trash',
                    title: 'Delete',
                  },
                ]}
                onPress={() => entry.kind === 'folder'
                  ? setPath(`${path}/${entry.name}`)
                  : notify(`Previewing ${entry.name}`)}
                style={styles.fileNameCell}
              >
                <Icon color={tokensForFile(entry.kind)} size={18} />
                <PreviewText numberOfLines={1} style={styles.fileName} variant="mono">
                  {entry.name}
                </PreviewText>
              </IOSContextMenu>
              <PreviewText style={styles.fileMeta} variant="tiny">{entry.size}</PreviewText>
              <PreviewText style={styles.fileMeta} variant="tiny">{entry.modified}</PreviewText>
              <View style={styles.fileActions}>
                {entry.kind === 'file' ? (
                  <NativeButton accessibilityLabel={`Download ${entry.name}`} ghost onPress={() => notify(`Download prepared: ${entry.name}`)} size="icon">
                    <Download />
                  </NativeButton>
                ) : null}
                <NativeButton accessibilityLabel={`Delete ${entry.name}`} destructive ghost onPress={() => notify(`Deleted: ${entry.name}`)} size="icon">
                  <Trash2 />
                </NativeButton>
              </View>
            </View>
            </IOSSwipeActions>
          );
        })}
        </ScrollView>
      </View>
      <PreviewModal onClose={() => setFolderModal(false)} open={folderModal} title="New folder">
        <NativeInput onChangeText={setNewFolder} placeholder="Folder name" value={newFolder} />
        <NativeButton
          disabled={!newFolder.trim()}
          onPress={() => {
            notify(`Created folder: ${newFolder}`);
            setFolderModal(false);
            setNewFolder('');
          }}
        >
          Create
        </NativeButton>
      </PreviewModal>
    </View>
  );
}

function tokensForFile(kind: string): string {
  return kind === 'folder' ? '#ffbd38' : '#ffe6cb';
}

export function AnalyticsPreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const { tokens } = useTheme();
  const chinese = locale === 'zh';
  const [days, setDays] = useState<'7' | '30' | '90' | '365'>('30');
  return (
    <PreviewPage
      actions={(
        <NativeButton ghost onPress={() => notify(chinese ? '使用量已刷新' : 'Usage refreshed')} prefix={<RefreshCw />} size="sm">
          {chinese ? '刷新' : 'Refresh'}
        </NativeButton>
      )}
      title={chinese ? '使用量' : 'Usage'}
    >
      <PreviewSegmented<'7' | '30' | '90' | '365'>
        onChange={setDays}
        options={[
          { label: '7d', value: '7' },
          { label: '30d', value: '30' },
          { label: '90d', value: '90' },
          { label: '365d', value: '365' },
        ]}
        value={days}
      />
      <View style={styles.usageStatGrid}>
        <StudioUsageStat detail={chinese ? '输入 + 输出' : 'Input + output'} label={chinese ? '总 Token' : 'Total tokens'} value="3.41M" />
        <StudioUsageStat detail={chinese ? '当前周期' : 'Current period'} label={chinese ? '会话' : 'Sessions'} value="184" />
        <StudioUsageStat detail={chinese ? '模型估算' : 'Model estimate'} label={chinese ? '估算费用' : 'Estimated cost'} value="$18.42" />
        <StudioUsageStat detail={chinese ? '节省 38%' : '38% saved'} label={chinese ? '缓存命中' : 'Cache hit'} value="62%" />
      </View>
      <View style={[styles.usagePanel, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
        <PreviewText style={styles.usagePanelTitle} variant="heading">{chinese ? '每日 Token 使用量' : 'Daily token usage'}</PreviewText>
        <PreviewBarChart values={PREVIEW_TOKEN_DAYS} />
        <View style={styles.usageLegend}>
          <StudioUsageLegend color={tokens.colors.foreground} label="INPUT 2.97M" />
          <StudioUsageLegend color={tokens.colors.success} label="OUTPUT 441K" />
        </View>
      </View>
      <View style={styles.usageBreakdownGrid}>
        <StudioUsagePanel
          rows={[
            ['claude-sonnet-4', '2.07M', 1],
            ['qwen3-235b-a22b', '1.01M', 0.49],
            ['hermes-4-405b', '493K', 0.24],
          ]}
          title={chinese ? '模型分布' : 'Per-model breakdown'}
        />
        <StudioUsagePanel
          rows={[
            ['github-code-review', '48 loads', 1],
            ['deep-research', '31 loads', 0.65],
            ['frontend-design', '24 loads', 0.5],
          ]}
          title={chinese ? 'Agent 分布' : 'Agent breakdown'}
        />
      </View>
    </PreviewPage>
  );
}

function StudioUsageStat({ detail, label, value }: { detail: string; label: string; value: string }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.usageStat, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
      <PreviewText style={styles.usageStatLabel} variant="label">{label}</PreviewText>
      <PreviewText style={styles.usageStatValue}>{value}</PreviewText>
      <PreviewText style={styles.usageStatDetail} variant="tiny">{detail}</PreviewText>
    </View>
  );
}

function StudioUsageLegend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.usageLegendItem}>
      <View style={[styles.usageLegendDot, { backgroundColor: color }]} />
      <PreviewText style={styles.usageLegendText} variant="mono">{label}</PreviewText>
    </View>
  );
}

function StudioUsagePanel({ rows, title }: {
  rows: Array<[string, string, number]>;
  title: string;
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.usagePanel, styles.usageBreakdownPanel, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
      <PreviewText style={styles.usagePanelTitle} variant="heading">{title}</PreviewText>
      {rows.map(([label, value, progress]) => (
        <View key={label} style={styles.usageBreakdownRow}>
          <View style={styles.usageBreakdownMeta}>
            <PreviewText numberOfLines={1} style={styles.usageBreakdownLabel} variant="mono">{label}</PreviewText>
            <PreviewText style={styles.usageBreakdownValue} variant="mono">{value}</PreviewText>
          </View>
          <View style={[styles.usageBreakdownTrack, { backgroundColor: tokens.colors.muted }]}>
            <View style={[styles.usageBreakdownFill, { backgroundColor: tokens.colors.foreground, width: `${Math.round(progress * 100)}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

type ModelsTab = 'general' | 'auxiliary' | 'combination';

export function ModelsPreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const { tokens } = useTheme();
  const chinese = locale === 'zh';
  const [activeTab, setActiveTab] = useState<ModelsTab>('general');
  const [providerOpen, setProviderOpen] = useState(false);
  const auxiliaryTasks = [
    ['视觉', 'openai-codex / gpt-5.5', '120s / 下载 30s'],
    ['网页提取', 'auto', '360s'],
    ['压缩', 'auto', '120s'],
    ['技能中心', 'auto', '30s'],
    ['审批', 'auto', '30s'],
    ['MCP', 'auto', '30s'],
    ['标题生成', 'auto', '30s'],
    ['Triage 扩写', 'auto', '120s'],
    ['看板拆解', 'auto', '180s'],
    ['Profile 描述', 'auto', '60s'],
    ['策展', 'auto', '600s'],
    ['会话搜索', 'auto', '30s'],
    ['写入记忆', 'auto', '30s'],
  ];
  return (
    <PreviewPage
      actions={(
        activeTab === 'general' ? (
          <PreviewRow>
            <NativeButton
              onPress={() => notify(chinese ? '模型缓存已刷新' : 'Model cache refreshed')}
              outlined
              prefix={<RefreshCw />}
              size="sm"
            >
              {chinese ? '刷新模型缓存' : 'Refresh model cache'}
            </NativeButton>
            <NativeButton onPress={() => setProviderOpen(true)} prefix={<Plus />} size="sm">
              {chinese ? '添加 Provider' : 'Add Provider'}
            </NativeButton>
          </PreviewRow>
        ) : null
      )}
      title={chinese ? '模型' : 'Models'}
    >
      <StudioLineTabs<ModelsTab>
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { label: chinese ? '通用' : 'General', value: 'general' },
          { label: chinese ? '辅助模型' : 'Auxiliary', value: 'auxiliary' },
          { label: chinese ? '组合模型' : 'Combination', value: 'combination' },
        ]}
      />

      {activeTab === 'general' ? (
        <PreviewGrid minItemWidth={360}>
          <StudioProviderCard
            baseUrl="https://openrouter.ai/api/v1"
            builtin
            models={PREVIEW_MODELS.map(({ model }) => model)}
            name="OpenRouter"
            provider="openrouter"
          />
          <StudioProviderCard
            baseUrl="https://api.z.ai/api/paas/v4"
            builtin
            models={['glm-4.5', 'glm-4.5-air', 'glm-4.6', 'glm-4.7', 'glm-5', 'glm-5-turbo']}
            name="Z.AI / GLM"
            provider="zai"
          />
          <StudioProviderCard
            baseUrl="https://api.openai.com/v1"
            models={['gpt-5.5', 'gpt-5.5-mini', 'gpt-5.5-codex']}
            name="OpenAI"
            provider="openai"
          />
        </PreviewGrid>
      ) : null}

      {activeTab === 'auxiliary' ? (
        <View style={[styles.studioTablePanel, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
          <View style={[styles.studioPanelHeader, { borderBottomColor: tokens.colors.border }]}>
            <View style={styles.studioPanelHeading}>
              <PreviewText variant="heading">{chinese ? '辅助模型' : 'Auxiliary models'}</PreviewText>
              <PreviewText variant="muted">{chinese ? '为压缩、视觉、审批、MCP 和后台维护任务单独指定模型。' : 'Assign dedicated models for compression, vision, approvals, MCP, and maintenance.'}</PreviewText>
            </View>
            <NativeButton ghost onPress={() => notify(chinese ? '辅助模型已刷新' : 'Auxiliary models refreshed')} size="sm">
              {chinese ? '刷新' : 'Refresh'}
            </NativeButton>
          </View>
          <ScrollView horizontal scrollEventThrottle={8} showsHorizontalScrollIndicator={false}>
            <View style={styles.studioTable}>
              <StudioTableRow
                cells={[chinese ? '任务' : 'Task', 'PROVIDER / 默认模型', chinese ? '超时' : 'Timeout', chinese ? '操作' : 'Actions']}
                header
              />
              {auxiliaryTasks.map(([task, provider, timeout]) => (
                <StudioTableRow
                  actions
                  cells={[task, provider, timeout, chinese ? '编辑   清除' : 'Edit   Clear']}
                  key={task}
                />
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {activeTab === 'combination' ? (
        <View style={[styles.studioTablePanel, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
          <View style={[styles.studioPanelHeader, { borderBottomColor: tokens.colors.border }]}>
            <View style={styles.studioPanelHeading}>
              <PreviewText variant="heading">{chinese ? '组合模型' : 'Combination models'}</PreviewText>
              <PreviewText variant="muted">{chinese ? '用多个参考模型和聚合模型构建 MoA 预设。' : 'Build MoA presets from reference and aggregator models.'}</PreviewText>
            </View>
            <PreviewRow>
              <NativeButton ghost onPress={() => notify(chinese ? '组合模型已刷新' : 'Combination models refreshed')} size="sm">{chinese ? '刷新' : 'Refresh'}</NativeButton>
              <NativeButton onPress={() => notify(chinese ? '新建组合模型' : 'New combination model')} size="sm">{chinese ? '添加组合模型' : 'Add model'}</NativeButton>
            </PreviewRow>
          </View>
          <ScrollView horizontal scrollEventThrottle={8} showsHorizontalScrollIndicator={false}>
            <View style={styles.studioTable}>
              <StudioTableRow cells={[chinese ? '名称' : 'Name', chinese ? '参考模型' : 'Reference models', chinese ? '聚合模型' : 'Aggregator', chinese ? '操作' : 'Actions']} header />
              <StudioTableRow actions cells={['default', 'openrouter / qwen3-235b, zai / glm-5', 'openai / gpt-5.5', chinese ? '编辑   设为默认   删除' : 'Edit   Set default   Delete']} />
            </View>
          </ScrollView>
        </View>
      ) : null}

      <PreviewModal onClose={() => setProviderOpen(false)} open={providerOpen} title={chinese ? '添加 Provider' : 'Add Provider'}>
        <PreviewSettingRow detail="OpenAI-compatible" label="Provider" />
        <NativeInput placeholder="provider-id" />
        <NativeInput placeholder="Base URL" />
        <NativeInput placeholder="API key" secureTextEntry />
        <NativeButton onPress={() => {
          notify(chinese ? 'Provider 已保存' : 'Provider saved');
          setProviderOpen(false);
        }}>
          {chinese ? '保存' : 'Save'}
        </NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

export function PerformancePreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const { tokens } = useTheme();
  const chinese = locale === 'zh';
  const [autoRefresh, setAutoRefresh] = useState(true);
  const workers = [
    { active: '2 / 3', cpu: '12.4%', memory: '684 MB', pid: '24118', profile: 'default', status: 'RUNNING' },
    { active: '1 / 1', cpu: '6.8%', memory: '412 MB', pid: '24162', profile: 'ios-native', status: 'RUNNING' },
    { active: '0 / 1', cpu: '0.3%', memory: '196 MB', pid: '24204', profile: 'researcher', status: 'IDLE' },
  ];
  return (
    <PreviewPage
      actions={(
        <PreviewRow>
          <NativeButton onPress={() => setAutoRefresh((value) => !value)} outlined size="sm">
            {autoRefresh ? (chinese ? '自动刷新：开' : 'Auto refresh: on') : (chinese ? '自动刷新：关' : 'Auto refresh: off')}
          </NativeButton>
          <NativeButton ghost onPress={() => notify(chinese ? '性能数据已刷新' : 'Performance refreshed')} prefix={<RefreshCw />} size="sm">
            {chinese ? '刷新' : 'Refresh'}
          </NativeButton>
        </PreviewRow>
      )}
      title={chinese ? '性能' : 'Performance'}
    >
      <PreviewGrid minItemWidth={170}>
        <PerformanceMetric label={chinese ? '系统 CPU' : 'System CPU'} progress={0.31} value="31%" />
        <PerformanceMetric detail="7.9 GB / 16 GB" label={chinese ? '系统内存' : 'System memory'} progress={0.49} value="49%" />
        <PerformanceMetric detail={chinese ? '运行中 3' : '3 running'} label={chinese ? '活跃会话' : 'Active sessions'} value="5" />
        <PerformanceMetric detail="1.29 GB RSS" label={chinese ? 'Workers' : 'Workers'} value="3 / 3" />
      </PreviewGrid>
      <View style={[styles.runtimeSection, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
        <View style={[styles.runtimeSectionHeader, { borderBottomColor: tokens.colors.border }]}>
          <PreviewText variant="heading">{chinese ? '进程' : 'Processes'}</PreviewText>
          <PreviewText variant="tiny">linux x64 · 16 CPU · uptime 3d 08h</PreviewText>
        </View>
        <RuntimeProcessRow cpu="4.8%" memory="286 MB" name="Web UI" secondary="PID 23891" />
        <RuntimeProcessRow cpu="2.1%" memory="174 MB" name="Bridge Broker" secondary="127.0.0.1:3030" />
      </View>
      <View style={[styles.runtimeSection, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
        <View style={[styles.runtimeSectionHeader, { borderBottomColor: tokens.colors.border }]}>
          <PreviewText variant="heading">{chinese ? 'Worker 内存' : 'Worker memory'}</PreviewText>
          <PreviewText variant="tiny">{chinese ? '刚刚更新' : 'Updated now'}</PreviewText>
        </View>
        <ScrollView horizontal scrollEventThrottle={8} showsHorizontalScrollIndicator={false}>
          <View style={styles.workerTable}>
            <View style={[styles.workerTableRow, { borderBottomColor: tokens.colors.border }]}>
              {['Profile', 'PID', 'CPU', chinese ? '内存' : 'Memory', chinese ? '会话' : 'Sessions', chinese ? '状态' : 'Status'].map((label) => (
                <PreviewText key={label} style={styles.workerTableCell} variant="label">{label}</PreviewText>
              ))}
            </View>
            {workers.map((worker) => (
              <View key={worker.profile} style={[styles.workerTableRow, { borderBottomColor: tokens.colors.border }]}>
                <PreviewText style={styles.workerTableCell} variant="heading">{worker.profile}</PreviewText>
                <PreviewText style={styles.workerTableCell} variant="mono">{worker.pid}</PreviewText>
                <PreviewText style={styles.workerTableCell} variant="mono">{worker.cpu}</PreviewText>
                <PreviewText style={styles.workerTableCell} variant="mono">{worker.memory}</PreviewText>
                <PreviewText style={styles.workerTableCell} variant="mono">{worker.active}</PreviewText>
                <View style={styles.workerTableCell}><PreviewBadge tone={worker.status === 'RUNNING' ? 'success' : 'outline'}>{worker.status}</PreviewBadge></View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </PreviewPage>
  );
}

function PerformanceMetric({ detail, label, progress, value }: {
  detail?: string;
  label: string;
  progress?: number;
  value: string;
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.performanceMetric, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
      <PreviewText variant="label">{label}</PreviewText>
      <PreviewText style={styles.performanceValue}>{value}</PreviewText>
      {detail ? <PreviewText variant="tiny">{detail}</PreviewText> : null}
      {typeof progress === 'number' ? <PreviewProgress value={progress} /> : null}
    </View>
  );
}

function RuntimeProcessRow({ cpu, memory, name, secondary }: {
  cpu: string;
  memory: string;
  name: string;
  secondary: string;
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.runtimeProcessRow, { borderBottomColor: tokens.colors.border }]}>
      <View style={styles.runtimeProcessName}>
        <PreviewText variant="heading">{name}</PreviewText>
        <PreviewText variant="tiny">{secondary}</PreviewText>
      </View>
      <PreviewText variant="mono">{cpu}</PreviewText>
      <PreviewText variant="mono">{memory}</PreviewText>
      <PreviewBadge tone="success">RUNNING</PreviewBadge>
    </View>
  );
}

function StudioLineTabs<T extends string>({
  active,
  onChange,
  tabs,
}: {
  active: T;
  onChange(value: T): void;
  tabs: readonly { label: string; value: T }[];
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.studioTabs, { borderBottomColor: tokens.colors.border }]}>
      {tabs.map((tab) => (
        <IOSPressable
          accessibilityState={{ selected: active === tab.value }}
          key={tab.value}
          onPress={() => onChange(tab.value)}
          style={[
            styles.studioTab,
            active === tab.value && { borderBottomColor: tokens.colors.foreground },
          ]}
        >
          <PreviewText color={active === tab.value ? tokens.colors.foreground : tokens.colors.textSecondary}>
            {tab.label}
          </PreviewText>
        </IOSPressable>
      ))}
    </View>
  );
}

function StudioProviderCard({
  baseUrl,
  builtin = false,
  models,
  name,
  provider,
}: {
  baseUrl: string;
  builtin?: boolean;
  models: readonly string[];
  name: string;
  provider: string;
}) {
  return (
    <PreviewCard
      action={builtin ? <PreviewBadge tone="outline">内置</PreviewBadge> : null}
      title={name}
    >
      <PreviewDataRow label="Provider" mono value={provider} />
      <PreviewDataRow label="Base URL" mono value={baseUrl} />
      <PreviewDataRow label="模型列表" value={`${models.length} 个模型`} />
      <PreviewRow>
        {models.slice(0, 7).map((model) => <PreviewBadge key={model} tone="outline">{model}</PreviewBadge>)}
      </PreviewRow>
    </PreviewCard>
  );
}

function StudioTableRow({
  actions = false,
  cells,
  header = false,
}: {
  actions?: boolean;
  cells: readonly string[];
  header?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.studioTableRow, { borderBottomColor: tokens.colors.border }]}>
      {cells.map((cell, index) => (
        <PreviewText
          color={header || index > 0 ? tokens.colors.textSecondary : tokens.colors.foreground}
          key={`${cell}:${index}`}
          numberOfLines={1}
          style={[
            styles.studioTableCell,
            index === 1 && styles.studioTableCellWide,
            index === 3 && styles.studioTableActions,
          ]}
          variant={header ? 'label' : index === 0 ? 'body' : actions && index === 3 ? 'tiny' : 'mono'}
        >
          {cell}
        </PreviewText>
      ))}
    </View>
  );
}

export function LogsPreviewPage({ notify }: PreviewPageProps) {
  const { width } = useWindowDimensions();
  const { tokens } = useTheme();
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<'all' | 'debug' | 'info' | 'warn'>('all');
  const visible = PREVIEW_LOGS.filter((row) => (
    (level === 'all' || row[1].toLowerCase() === level)
    && `${row[0]} ${row[1]} ${row[2]} ${row[3]}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  const compact = width < 620;
  const logRows = visible.map((row, index) => {
    const levelColor = row[1] === 'WARN'
      ? tokens.colors.warning
      : row[1] === 'DEBUG'
        ? tokens.colors.textTertiary
        : tokens.colors.success;
    return (
      <View
        key={`${row[0]}-${index}`}
        style={[
          styles.logRow,
          compact && styles.logRowCompact,
          {
            borderBottomColor: compact ? tokens.colors.border : 'transparent',
            borderLeftColor: levelColor,
          },
        ]}
      >
        <View style={compact ? styles.logMetaRow : undefined}>
          <PreviewText style={compact ? styles.logTimeCompact : styles.logTime} variant="mono">
            {row[0]}
          </PreviewText>
          {compact ? (
            <>
              <PreviewText style={[styles.logLevel, { color: levelColor }]} variant="mono">{row[1]}</PreviewText>
              <PreviewText style={styles.logComponentCompact} variant="mono">{row[2]}</PreviewText>
            </>
          ) : null}
        </View>
        {!compact ? (
          <>
            <PreviewText style={[styles.logLevel, { color: levelColor }]} variant="mono">{row[1]}</PreviewText>
            <PreviewText style={styles.logComponent} variant="mono">{row[2]}</PreviewText>
          </>
        ) : null}
        <PreviewText style={[styles.logMessage, compact && styles.logMessageCompact]} variant="mono">
          {row[3]}
        </PreviewText>
      </View>
    );
  });
  return (
    <PreviewPage
      actions={(
        <NativeButton ghost onPress={() => notify('日志已刷新')} prefix={<RefreshCw />} size="sm">刷新</NativeButton>
      )}
      title="日志"
    >
      <View style={styles.logToolbar}>
        <PreviewRow>
          <PreviewBadge tone="outline">hermes.log</PreviewBadge>
          <PreviewBadge tone="outline">500 行</PreviewBadge>
        </PreviewRow>
        <View style={styles.logSearch}>
          <PreviewSearch onChangeText={setQuery} placeholder="搜索日志..." value={query} />
        </View>
        <PreviewSegmented<'all' | 'debug' | 'info' | 'warn'>
            onChange={setLevel}
            options={[
              { label: '全部', value: 'all' },
              { label: 'DEBUG', value: 'debug' },
              { label: 'INFO', value: 'info' },
              { label: 'WARN', value: 'warn' },
            ]}
            value={level}
          />
      </View>
      <View style={[styles.logStream, { borderTopColor: tokens.colors.border }]}>
        {compact ? (
          <View style={styles.logLinesCompact}>{logRows}</View>
        ) : (
          <ScrollView
            decelerationRate="normal"
            directionalLockEnabled
            horizontal
            scrollEventThrottle={8}
            showsHorizontalScrollIndicator={false}
          >
            <View style={styles.logLines}>{logRows}</View>
          </ScrollView>
        )}
      </View>
    </PreviewPage>
  );
}

const styles = StyleSheet.create({
  swipeContainer: {
    borderRadius: 4,
  },
  chatRoot: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  chatMain: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  chatHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modelToolsButton: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  terminalWindow: {
    borderRadius: 8,
    elevation: 8,
    flex: 1,
    marginBottom: 0,
    marginHorizontal: 12,
    marginTop: 4,
    minHeight: 0,
    overflow: 'hidden',
    padding: 8,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
  terminalScroll: {
    flex: 1,
    minHeight: 0,
  },
  terminalTranscript: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingBottom: 12,
    paddingRight: 2,
  },
  terminalInputChrome: {
    flexShrink: 0,
  },
  terminalStatusBar: {
    backgroundColor: '#1a1a2e',
    overflow: 'hidden',
  },
  terminalStatusText: {
    flexShrink: 0,
  },
  terminalStatusBase: {
    color: '#C0C0C0',
  },
  terminalStatusStrong: {
    color: '#FFD700',
    fontWeight: '700',
  },
  terminalStatusDim: {
    color: '#8B8682',
  },
  terminalStatusGood: {
    color: '#8FBC8F',
    fontWeight: '700',
  },
  terminalAttachmentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    minHeight: 20,
    paddingHorizontal: 3,
  },
  terminalInputRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 0,
    minHeight: 22,
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  terminalInput: {
    flex: 1,
    maxHeight: 92,
    minHeight: 20,
    padding: 0,
    textAlignVertical: 'top',
  },
  terminalIconButton: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    marginLeft: 5,
    width: 24,
  },
  copyLastButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 3,
    borderWidth: 1,
    bottom: 42,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    position: 'absolute',
    right: 8,
  },
  modelPanel: {
    width: 240,
  },
  modelPanelContent: {
    gap: 10,
    paddingBottom: 8,
    paddingRight: 12,
    paddingTop: 4,
  },
  fullWidthButton: {
    justifyContent: 'flex-start',
    width: '100%',
  },
  fullWidthPressable: {
    width: '100%',
  },
  chatSideCard: {
    minWidth: 0,
  },
  chatSideRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  chatSideCopy: {
    flex: 1,
    minWidth: 0,
  },
  modelPickerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  modelEditorFields: {
    gap: 10,
  },
  modelDetectionBox: {
    borderRadius: 6,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modelDetectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 46,
  },
  modelDetectionMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  modelRefreshButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 42,
  },
  modelDetectedRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  modelEmptyCircle: {
    borderRadius: 8,
    borderWidth: 1.5,
    height: 16,
    width: 16,
  },
  modelActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-end',
  },
  modelOperation: {
    alignItems: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 10,
  },
  flexSpacer: {
    flex: 1,
  },
  studioTabs: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 4,
    minHeight: 42,
  },
  studioTab: {
    alignItems: 'center',
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
  },
  studioTablePanel: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  studioPanelHeader: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  studioPanelHeading: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  studioTable: {
    minWidth: 720,
    width: '100%',
  },
  studioTableRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 42,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  studioTableCell: {
    flex: 1.1,
    minWidth: 0,
  },
  studioTableCellWide: {
    flex: 1.8,
  },
  studioTableActions: {
    flex: 0.9,
    textAlign: 'right',
  },
  usageStatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  usageStat: {
    borderRadius: 6,
    borderWidth: 1,
    flexBasis: 180,
    flexGrow: 1,
    gap: 4,
    minHeight: 104,
    padding: 16,
  },
  usageStatLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  usageStatValue: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 27,
  },
  usageStatDetail: {
    fontSize: 11,
    lineHeight: 15,
  },
  usagePanel: {
    borderRadius: 6,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  usagePanelTitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  usageLegend: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  usageLegendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  usageLegendDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  usageLegendText: {
    fontSize: 10,
    lineHeight: 14,
  },
  usageBreakdownGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  usageBreakdownPanel: {
    flexBasis: 300,
    flexGrow: 1,
  },
  usageBreakdownRow: {
    gap: 6,
  },
  usageBreakdownMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  usageBreakdownLabel: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  usageBreakdownValue: {
    fontSize: 10,
    lineHeight: 14,
  },
  usageBreakdownTrack: {
    borderRadius: 2,
    height: 16,
    overflow: 'hidden',
  },
  usageBreakdownFill: {
    height: '100%',
  },
  performanceMetric: {
    borderRadius: 6,
    borderWidth: 1,
    gap: 7,
    minHeight: 108,
    padding: 14,
  },
  performanceValue: {
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 28,
  },
  runtimeSection: {
    borderRadius: 6,
    borderWidth: 1,
    overflow: 'hidden',
  },
  runtimeSectionHeader: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  runtimeProcessRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 18,
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  runtimeProcessName: {
    flex: 1,
    gap: 3,
    minWidth: 150,
  },
  workerTable: {
    minWidth: 760,
    width: '100%',
  },
  workerTableRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  workerTableCell: {
    flex: 1,
    minWidth: 112,
  },
  sessionList: {
    gap: 10,
  },
  sessionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  sessionMain: {
    flex: 1,
    gap: 8,
    minWidth: 0,
  },
  sessionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  historyPanel: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  historyBackdrop: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 8,
  },
  historyBackdropFill: {
    flex: 1,
  },
  historySidebar: {
    borderRadius: 14,
    borderWidth: 1,
    margin: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    width: 280,
    zIndex: 10,
  },
  historySidebarCompact: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
  historySidebarHeader: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingHorizontal: 10,
  },
  historySearch: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  historySessionGroups: {
    paddingBottom: 12,
    paddingHorizontal: 8,
  },
  historyGroupTitle: {
    paddingBottom: 6,
    paddingHorizontal: 8,
    paddingTop: 10,
  },
  historySessionItem: {
    borderRadius: 8,
    gap: 6,
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  historySessionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  historySessionTitle: {
    flex: 1,
    minWidth: 0,
  },
  historySessionAgentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  historyUnreadDot: {
    borderRadius: 4,
    height: 7,
    marginLeft: 'auto',
    width: 7,
  },
  historySidebarFooter: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  historyMain: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  historyHeader: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 12,
  },
  historyHeaderLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minWidth: 0,
  },
  historyHeaderActions: {
    flexWrap: 'nowrap',
    gap: 2,
  },
  historyHeaderTitle: {
    maxWidth: 360,
  },
  historyMessages: {
    alignSelf: 'center',
    gap: 24,
    maxWidth: 860,
    paddingBottom: 40,
    paddingHorizontal: 18,
    paddingTop: 28,
    width: '100%',
  },
  historyMessageRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  historyMessageCopy: {
    flex: 1,
    gap: 7,
    minWidth: 0,
  },
  historyMessageMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  historyBubble: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    maxWidth: '94%',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  flexInput: {
    flex: 1,
    minWidth: 160,
  },
  filesWorkspace: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  filesWorkspaceCompact: {
    flexDirection: 'column',
  },
  filesTree: {
    borderRightWidth: 1,
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 8,
    width: 240,
  },
  filesTreeCompact: {
    borderBottomWidth: 1,
    borderRightWidth: 0,
    height: 200,
    width: '100%',
  },
  filesTreeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 42,
    paddingHorizontal: 8,
  },
  filesTreeRow: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  filesMain: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  filesToolbar: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filesBreadcrumb: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 14,
  },
  filesListScroll: {
    flex: 1,
    minHeight: 0,
  },
  filesList: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  fileHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  fileRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 4,
  },
  fileNameCell: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 9,
    minWidth: 120,
  },
  fileName: {
    flex: 1,
    minWidth: 0,
  },
  fileMeta: {
    textAlign: 'right',
    width: 90,
  },
  fileActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    width: 88,
  },
  logLines: {
    minWidth: 780,
  },
  logLinesCompact: {
    gap: 0,
    width: '100%',
  },
  logHeaderControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  logToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  logSearch: {
    flex: 1,
    minWidth: 180,
  },
  logStream: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -20,
    paddingTop: 4,
  },
  logRow: {
    alignItems: 'center',
    borderLeftWidth: 2,
    flexDirection: 'row',
    gap: 8,
    minHeight: 30,
    paddingHorizontal: 20,
    paddingVertical: 3,
  },
  logRowCompact: {
    alignItems: 'stretch',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'column',
    gap: 5,
    paddingVertical: 8,
  },
  logMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  logTime: {
    width: 112,
  },
  logTimeCompact: {
    fontSize: 11,
    lineHeight: 16,
  },
  logLevel: {
    fontSize: 10,
    lineHeight: 16,
    minWidth: 42,
  },
  logComponent: {
    width: 90,
  },
  logComponentCompact: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  logMessage: {
    fontSize: 12,
    lineHeight: 19,
    minWidth: 420,
  },
  logMessageCompact: {
    minWidth: 0,
    width: '100%',
  },
});
