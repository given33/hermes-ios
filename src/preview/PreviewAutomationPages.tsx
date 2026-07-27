import {
  Activity,
  Bot,
  Boxes,
  CheckCircle2,
  Clock,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  KeyRound,
  Link,
  MessageCircle,
  MoreHorizontal,
  Package,
  Pause,
  Pencil,
  Play,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Webhook,
  Zap,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { IOSSwipeActions } from '../components/ios/IOSSwipeActions';
import { IOSTimePicker } from '../components/ios/IOSTimePicker';
import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { NativeListItem } from '../components/ui/NativeListItem';
import { multiplyAlpha } from '../design/control-contracts';
import { useTheme } from '../design/ThemeProvider';
import {
  PREVIEW_CHANNELS,
  PREVIEW_CRON,
  PREVIEW_MCP,
  PREVIEW_PAIRINGS,
  PREVIEW_PLUGINS,
  PREVIEW_SKILLS,
  PREVIEW_WEBHOOKS,
} from './preview-fixtures';
import type { PreviewPageProps } from './PreviewCorePages';
import {
  PreviewBadge,
  PreviewCard,
  PreviewDataRow,
  PreviewDivider,
  PreviewGrid,
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

interface EditableMcpServer {
  active: boolean;
  endpoint: string;
  name: string;
  tools: number;
  transport: 'http' | 'stdio';
}

interface EditableChannel {
  account: string;
  mentionRequired: boolean;
  name: string;
  reactionsEnabled: boolean;
  status: 'Connected' | 'Disabled';
  users: string;
}

interface EditableWebhook {
  active: boolean;
  deliveries: number;
  description: string;
  events: string;
  name: string;
}

export function CronPreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const { tokens } = useTheme();
  const chinese = locale === 'zh';
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [schedule, setSchedule] = useState<'interval' | 'daily' | 'weekly'>('daily');
  const [runAt, setRunAt] = useState(() => new Date(2026, 0, 1, 9, 0));
  const [states, setStates] = useState<Record<string, boolean>>(() => (
    Object.fromEntries(PREVIEW_CRON.map((job) => [job.id, job.enabled]))
  ));
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'time'>('name');
  const sortedJobs = [...PREVIEW_CRON].sort((a, b) => (
    sortBy === 'name' ? a.name.localeCompare(b.name) : a.next.localeCompare(b.next)
  ));
  return (
    <PreviewPage
      actions={(
        <PreviewRow>
          <PreviewSegmented<'name' | 'time'>
            onChange={setSortBy}
            options={[
              { label: chinese ? '名称 ↑' : 'Name ↑', value: 'name' },
              { label: chinese ? '时间 ↑' : 'Time ↑', value: 'time' },
            ]}
            value={sortBy}
          />
          <NativeButton onPress={() => setCreateOpen(true)} prefix={<Plus />} size="sm">
            {chinese ? '创建任务' : 'Create job'}
          </NativeButton>
        </PreviewRow>
      )}
      title={chinese ? '任务' : 'Jobs'}
    >
      <PreviewGrid minItemWidth={360}>
        {sortedJobs.map((job) => (
          <IOSSwipeActions
            actions={[
              {
                icon: 'pencil',
                id: 'edit',
                label: 'Edit',
                onPress: () => notify(`Edit job: ${job.name}`),
              },
              {
                destructive: true,
                icon: 'trash',
                id: 'delete',
                label: 'Delete',
                onPress: () => setDeleteTarget(job.name),
              },
            ]}
            containerStyle={styles.swipeContainer}
            key={job.id}
          >
          <PreviewCard
            action={(
              <PreviewRow style={styles.cardIconActions}>
                <NativeButton
                  accessibilityLabel={states[job.id] ? 'Pause job' : 'Resume job'}
                  ghost
                  onPress={() => setStates((current) => ({
                    ...current,
                    [job.id]: !(current[job.id] ?? false),
                  }))}
                  size="icon"
                >
                  {states[job.id] ? <Pause /> : <Play />}
                </NativeButton>
                <NativeButton accessibilityLabel="Trigger now" ghost onPress={() => notify(`Triggered: ${job.name}`)} size="icon">
                  <Zap />
                </NativeButton>
                <NativeButton accessibilityLabel="Edit job" ghost onPress={() => notify(`Edit job: ${job.name}`)} size="icon">
                  <Pencil />
                </NativeButton>
                <NativeButton accessibilityLabel="Delete job" destructive ghost onPress={() => setDeleteTarget(job.name)} size="icon">
                  <Trash2 />
                </NativeButton>
              </PreviewRow>
            )}
            subtitle={job.schedule}
            title={job.name}
          >
            <PreviewRow>
              <PreviewBadge tone={states[job.id] ? 'success' : 'outline'}>
                {states[job.id] ? 'ACTIVE' : 'PAUSED'}
              </PreviewBadge>
              <PreviewBadge tone="outline">{job.delivery}</PreviewBadge>
            </PreviewRow>
            <PreviewDataRow label="Next" mono value={job.next} />
            <NativeButton
              onPress={() => setSelectedJob((current) => current === job.id ? null : job.id)}
              outlined={selectedJob !== job.id}
              size="sm"
            >
              {selectedJob === job.id ? (chinese ? '已选择' : 'Selected') : (chinese ? '查看运行历史' : 'View run history')}
            </NativeButton>
          </PreviewCard>
          </IOSSwipeActions>
        ))}
      </PreviewGrid>
      <View style={[styles.jobsSplitter, { backgroundColor: tokens.colors.border }]} />
      <View style={styles.runHistory}>
        <View style={styles.runHistoryHeader}>
          <PreviewText variant="heading">{chinese ? '运行历史' : 'Run history'}</PreviewText>
          <PreviewText variant="tiny">{selectedJob ? `1 ${chinese ? '次运行' : 'run'}` : `3 ${chinese ? '次运行' : 'runs'}`}</PreviewText>
        </View>
        {sortedJobs.filter((job) => !selectedJob || job.id === selectedJob).map((job) => (
          <View key={`run-${job.id}`} style={[styles.runHistoryRow, { borderColor: tokens.colors.border }]}>
            <View style={styles.flexCopy}>
              <PreviewText variant="heading">{job.name} — {job.next}</PreviewText>
              <PreviewText variant="tiny">{job.delivery} · 4.2 KB</PreviewText>
            </View>
            <PreviewBadge tone={states[job.id] ? 'success' : 'outline'}>{states[job.id] ? 'SUCCESS' : 'PAUSED'}</PreviewBadge>
          </View>
        ))}
      </View>
      <PreviewModal onClose={() => setCreateOpen(false)} open={createOpen} title="New cron job">
        <PreviewText variant="label">Name (optional)</PreviewText>
        <NativeInput onChangeText={setName} placeholder="e.g. Daily summary" value={name} />
        <PreviewText variant="label">Prompt</PreviewText>
        <NativeInput multiline onChangeText={setPrompt} placeholder="What should the agent do each time?" value={prompt} />
        <PreviewText variant="label">Schedule</PreviewText>
        <PreviewSegmented<'interval' | 'daily' | 'weekly'>
          onChange={setSchedule}
          options={[
            { label: 'Interval', value: 'interval' },
            { label: 'Daily', value: 'daily' },
            { label: 'Weekly', value: 'weekly' },
          ]}
          value={schedule}
        />
        <IOSTimePicker label="Run at" onChange={setRunAt} value={runAt} />
        <PreviewSettingRow detail="Telegram" label="Deliver to" />
        <NativeButton
          disabled={!prompt.trim()}
          onPress={() => {
            notify(`Created cron job: ${name || 'Untitled job'}`);
            setCreateOpen(false);
            setName('');
            setPrompt('');
          }}
        >
          Create
        </NativeButton>
      </PreviewModal>
      <ConfirmDialog
        description="This permanently removes the job from the schedule."
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          notify(`Deleted cron job: ${deleteTarget}`);
          setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        title="Delete cron job?"
      />
    </PreviewPage>
  );
}

export function SkillsPreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const { tokens } = useTheme();
  const isChinese = locale === 'zh';
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'builtin' | 'external' | 'hub' | 'local' | 'modified'>('all');
  const [scanComplete, setScanComplete] = useState(false);
  const [addedSkills, setAddedSkills] = useState<Record<string, boolean>>({});
  const categories = Array.from(new Set(PREVIEW_SKILLS.map((skill) => skill.category)));
  const normalizedQuery = query.trim().toLowerCase();
  const skillSource = (name: string) => name === 'frontend-design'
    ? 'local'
    : name === 'deep-research'
      ? 'hub'
      : name === 'browser-use'
        ? 'external'
        : 'builtin';
  const filtered = PREVIEW_SKILLS.filter((skill) => {
    const source = skillSource(skill.name);
    const sourceMatches = sourceFilter === 'all'
      || sourceFilter === source
      || (sourceFilter === 'modified' && skill.name === 'frontend-design');
    return sourceMatches && `${skill.name} ${skill.category} ${skill.description} ${isChinese ? `${skillCategoryZh(skill.category)} ${skillDescriptionZh(skill.name)}` : ''}`
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const scanLocalSkills = () => {
    setScanComplete(true);
    notify(isChinese
      ? `已检索到 ${PREVIEW_SKILLS.length} 个可用 Skill`
      : `Found ${PREVIEW_SKILLS.length} available skills`);
  };
  const addScannedSkills = () => {
    setAddedSkills(Object.fromEntries(PREVIEW_SKILLS.map((skill) => [skill.name, true])));
    notify(isChinese
      ? `已将 ${PREVIEW_SKILLS.length} 个 Skill 加入 Hermes`
      : `Added ${PREVIEW_SKILLS.length} skills to Hermes`);
  };
  return (
    <PreviewPage
      actions={(
        <PreviewRow style={styles.skillsHeaderActions}>
          <NativeButton ghost onPress={() => notify(isChinese ? '没有待处理的技能写入' : 'No pending skill writes')} prefix={<ShieldCheck />} size="sm">
            {isChinese ? '写入审批 0' : 'Write approvals 0'}
          </NativeButton>
          <NativeButton ghost onPress={() => notify(isChinese ? '已打开技能导入' : 'Skill import opened')} prefix={<Download />} size="sm">
            {isChinese ? '导入' : 'Import'}
          </NativeButton>
          <NativeButton ghost onPress={() => notify(isChinese ? '已打开外部目录' : 'External directories opened')} prefix={<Package />} size="sm">
            {isChinese ? '外部目录' : 'External dirs'}
          </NativeButton>
        </PreviewRow>
      )}
      title={isChinese ? '技能' : 'Skills'}
    >
      <View style={styles.skillSourceLegend}>
        {([
          ['builtin', isChinese ? '内置' : 'Builtin', '#6b7280'],
          ['hub', 'Hub', '#3b82f6'],
          ['local', isChinese ? '本地' : 'Local', '#22c55e'],
          ['external', isChinese ? '外部' : 'External', '#f59e0b'],
          ['modified', isChinese ? '已修改' : 'Modified', '#a855f7'],
        ] as const).map(([value, label, color]) => (
          <NativeButton
            ghost={sourceFilter !== value}
            key={value}
            onPress={() => setSourceFilter((current) => current === value ? 'all' : value)}
            prefix={<View style={[styles.legendDot, { backgroundColor: color }]} />}
            size="sm"
          >
            {label}
          </NativeButton>
        ))}
      </View>
      <View style={styles.studioToolbar}>
        <View style={styles.toolbarSearch}>
          <PreviewSearch onChangeText={setQuery} placeholder={isChinese ? '搜索技能...' : 'Search skills...'} value={query} />
        </View>
        <PreviewRow style={styles.skillScanActions}>
          <NativeButton
            ghost
            haptic="selection"
            onPress={scanLocalSkills}
            prefix={<RefreshCw />}
            size="sm"
          >
            {isChinese ? '自动检索本机 Skill' : 'Scan local skills'}
          </NativeButton>
          {scanComplete ? (
            <NativeButton
              haptic="light"
              onPress={addScannedSkills}
              prefix={<Plus />}
              size="sm"
            >
              {isChinese ? `自动添加 ${PREVIEW_SKILLS.length} 个` : `Add all ${PREVIEW_SKILLS.length}`}
            </NativeButton>
          ) : null}
        </PreviewRow>
      </View>
      <View style={styles.skillsLayout}>
        <View style={[styles.studioSkillSidebar, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
          {categories.map((item) => {
            const categorySkills = filtered.filter((skill) => skill.category === item);
            if (!categorySkills.length) return null;
            return (
              <View key={item} style={styles.studioSkillGroup}>
                <PreviewText style={styles.studioSkillGroupTitle} variant="label">
                  {isChinese ? skillCategoryZh(item) : item} · {categorySkills.length}
                </PreviewText>
                {categorySkills.map((skill) => (
                  <NativeListItem
                    active={Boolean(addedSkills[skill.name])}
                    activeBackgroundColor={multiplyAlpha(tokens.colors.primary, 0.09)}
                    key={skill.name}
                    onPress={() => setAddedSkills((current) => ({
                      ...current,
                      [skill.name]: !current[skill.name],
                    }))}
                    style={styles.studioSkillListItem}
                  >
                    <View style={[styles.legendDot, { backgroundColor: skillSource(skill.name) === 'builtin' ? '#6b7280' : skillSource(skill.name) === 'hub' ? '#3b82f6' : skillSource(skill.name) === 'local' ? '#22c55e' : '#f59e0b' }]} />
                    <View style={styles.skillFilterLabel}>
                      <Text numberOfLines={1}>{skill.name}</Text>
                      <Text numberOfLines={2} style={styles.skillDescription}>
                        {isChinese ? skillDescriptionZh(skill.name) : skill.description}
                      </Text>
                    </View>
                    <PreviewBadge tone={addedSkills[skill.name] ? 'success' : 'outline'}>
                      {addedSkills[skill.name]
                        ? (isChinese ? '已添加' : 'Added')
                        : skillSource(skill.name)}
                    </PreviewBadge>
                  </NativeListItem>
                ))}
              </View>
            );
          })}
        </View>
      </View>
    </PreviewPage>
  );
}

function skillCategoryZh(category: string): string {
  return ({
    Automation: '自动化',
    Development: '开发',
    Documents: '文档',
    Research: '研究',
  } as Record<string, string>)[category] ?? category;
}

function skillDescriptionZh(name: string): string {
  return ({
    'browser-use': '通过受控代理执行浏览器工作流。',
    'deep-research': '执行多来源研究并生成带引用的报告。',
    'frontend-design': '构建完善的用户界面。',
    'github-code-review': '结合仓库上下文审查拉取请求。',
    pdf: '读取、创建和检查 PDF 文档。',
    'ppt-master': '创建和修改演示文稿。',
  } as Record<string, string>)[name] ?? name;
}

export function PluginsPreviewPage({ locale = 'zh', navigate, notify }: PreviewPageProps) {
  const chinese = locale === 'zh';
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'disabled'>('all');
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => (
    Object.fromEntries(PREVIEW_PLUGINS.map((plugin) => [plugin.name, plugin.active]))
  ));
  const filtered = PREVIEW_PLUGINS.filter((plugin) => {
    const active = enabled[plugin.name] ?? false;
    if (status === 'active' && !active) return false;
    if (status === 'disabled' && active) return false;
    const normalized = query.trim().toLowerCase();
    return !normalized || `${plugin.name} ${plugin.label} ${plugin.source} ${plugin.tab}`.toLowerCase().includes(normalized);
  });
  const activeCount = Object.values(enabled).filter(Boolean).length;
  const tableWide = width >= 780;
  return (
    <PreviewPage
      actions={(
        <NativeButton ghost onPress={() => notify(chinese ? '插件已刷新' : 'Plugins refreshed')} prefix={<RefreshCw />} size="sm">
          {chinese ? '刷新' : 'Refresh'}
        </NativeButton>
      )}
      title={chinese ? '插件' : 'Plugins'}
    >
      <View style={[styles.studioNotice, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.08), borderColor: multiplyAlpha(tokens.colors.primary, 0.28) }]}>
        <PreviewText variant="muted">
          {chinese ? '插件由当前 Hermes Profile 扫描并加载；托管插件的状态由其 Provider 管理。' : 'Plugins are scanned for the active Hermes profile. Provider-managed plugins are controlled by their provider.'}
        </PreviewText>
      </View>
      <View style={styles.summaryGrid}>
        <StudioSummaryCard label={chinese ? '总数' : 'Total'} value={PREVIEW_PLUGINS.length} />
        <StudioSummaryCard label={chinese ? '活跃' : 'Active'} tone="success" value={activeCount} />
        <StudioSummaryCard label={chinese ? '未活跃' : 'Inactive'} tone="warning" value={PREVIEW_PLUGINS.length - activeCount} />
        <StudioSummaryCard label={chinese ? '已禁用' : 'Disabled'} tone="error" value={PREVIEW_PLUGINS.length - activeCount} />
        <StudioSummaryCard label={chinese ? 'Provider 托管' : 'Provider managed'} tone="info" value={1} />
      </View>
      <View style={styles.studioToolbar}>
        <View style={styles.toolbarSearch}>
          <PreviewSearch
            onChangeText={setQuery}
            placeholder={chinese ? '搜索插件、来源或能力...' : 'Search plugins, sources, or capabilities...'}
            value={query}
          />
        </View>
        <PreviewSegmented<'all' | 'active' | 'disabled'>
          onChange={setStatus}
          options={[
            { label: chinese ? '全部' : 'All', value: 'all' },
            { label: chinese ? '活跃' : 'Active', value: 'active' },
            { label: chinese ? '禁用' : 'Disabled', value: 'disabled' },
          ]}
          value={status}
        />
      </View>
      <View style={[styles.studioTable, { borderColor: tokens.colors.border }]}>
        {tableWide ? (
          <View style={[styles.pluginTableRow, styles.pluginTableHeader, { borderBottomColor: tokens.colors.border }]}>
            <PreviewText style={styles.pluginMainCell} variant="label">{chinese ? '插件' : 'Plugin'}</PreviewText>
            <PreviewText style={styles.pluginStatusCell} variant="label">{chinese ? '状态' : 'Status'}</PreviewText>
            <PreviewText style={styles.pluginMetaCell} variant="label">{chinese ? '来源 / 类型' : 'Source / kind'}</PreviewText>
            <PreviewText style={styles.pluginCapabilityCell} variant="label">{chinese ? '能力' : 'Capabilities'}</PreviewText>
            <PreviewText style={styles.pluginManageCell} variant="label">{chinese ? '管理' : 'Manage'}</PreviewText>
          </View>
        ) : null}
        {filtered.map((plugin, index) => {
          const active = enabled[plugin.name] ?? false;
          const openRoute = plugin.name === 'hermes-achievements'
            ? '/achievements'
            : plugin.name === 'kanban'
              ? '/kanban'
              : plugin.name === 'collaboration'
                ? '/collaboration'
                : null;
          return (
            <View
              key={plugin.name}
              style={[
                styles.pluginTableRow,
                !tableWide && styles.pluginTableRowCompact,
                index < filtered.length - 1 && { borderBottomColor: tokens.colors.border, borderBottomWidth: 1 },
              ]}
            >
              <View style={styles.pluginMainCell}>
                <PreviewText variant="heading">{plugin.name}</PreviewText>
                <PreviewText variant="tiny">{plugin.label} · v{plugin.version}</PreviewText>
                {!tableWide ? <PreviewText variant="tiny">{plugin.source} · standalone · {plugin.tab}</PreviewText> : null}
              </View>
              <View style={styles.pluginStatusCell}>
                <PreviewBadge tone={active ? 'success' : 'danger'}>{active ? (chinese ? '已启用' : 'Enabled') : (chinese ? '已禁用' : 'Disabled')}</PreviewBadge>
              </View>
              {tableWide ? <PreviewText style={styles.pluginMetaCell} variant="mono">{plugin.source} / standalone</PreviewText> : null}
              {tableWide ? <PreviewText style={styles.pluginCapabilityCell} variant="tiny">tools 4 · hooks 2 · env 0</PreviewText> : null}
              <View style={styles.pluginManageCell}>
                {openRoute ? <NativeButton ghost onPress={() => navigate(openRoute)} size="sm">{chinese ? '打开' : 'Open'}</NativeButton> : null}
                <PreviewToggle
                  accessibilityLabel={`Enable ${plugin.label}`}
                  onChange={(value) => setEnabled((current) => ({ ...current, [plugin.name]: value }))}
                  value={active}
                />
              </View>
            </View>
          );
        })}
      </View>
      <View style={[styles.metadataPanel, { borderColor: tokens.colors.border }]}>
        <PreviewText variant="mono">agent root: ~/.hermes</PreviewText>
        <PreviewText variant="mono">python: /usr/bin/python3</PreviewText>
        <PreviewText variant="mono">project plugins: enabled</PreviewText>
      </View>
    </PreviewPage>
  );
}

export function McpPreviewPage({ notify }: PreviewPageProps) {
  const { tokens } = useTheme();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [command, setCommand] = useState('');
  const [argumentsText, setArgumentsText] = useState('');
  const [transport, setTransport] = useState<'http' | 'stdio'>('http');
  const [query, setQuery] = useState('');
  const [servers, setServers] = useState<EditableMcpServer[]>(() => (
    PREVIEW_MCP.map((server) => ({ ...server }))
  ));
  const filtered = servers.filter((server) => (
    `${server.name} ${server.transport} ${server.endpoint}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  const connected = servers.filter((server) => server.active).length;
  const toolCount = servers.reduce((total, server) => total + server.tools, 0);
  const toggleServer = (serverName: string, active: boolean) => {
    setServers((current) => current.map((server) => (
      server.name === serverName ? { ...server, active } : server
    )));
  };
  const removeServer = (serverName: string) => {
    setServers((current) => current.filter((server) => server.name !== serverName));
    notify(`Removed server: ${serverName}`);
  };
  return (
    <PreviewPage
      actions={<NativeButton ghost onPress={() => notify('MCP 服务已刷新')} prefix={<RefreshCw />} size="sm">刷新</NativeButton>}
      title="MCP"
    >
      <View style={styles.summaryGrid}>
        <StudioSummaryCard label="总数" value={servers.length} />
        <StudioSummaryCard label="已连接" tone="success" value={connected} />
        <StudioSummaryCard label="未连接" tone="warning" value={servers.length - connected} />
        <StudioSummaryCard label="工具" tone="info" value={toolCount} />
      </View>
      <View style={styles.studioToolbar}>
        <View style={styles.toolbarSearch}>
          <PreviewSearch onChangeText={setQuery} placeholder="搜索服务、传输或工具..." value={query} />
        </View>
        <PreviewRow>
          <NativeButton onPress={() => notify('已重载全部 MCP 服务')} outlined prefix={<RefreshCw />} size="sm">重载全部</NativeButton>
          <NativeButton onPress={() => setAddOpen(true)} prefix={<Plus />} size="sm">添加服务</NativeButton>
        </PreviewRow>
      </View>
      <PreviewGrid minItemWidth={290}>
        {filtered.map((server) => (
          <IOSSwipeActions
            actions={[
              {
                icon: 'bolt',
                id: 'test',
                label: 'Test',
                onPress: () => notify(`Tested ${server.name}: ${server.tools} tools`),
              },
              {
                destructive: true,
                icon: 'trash',
                id: 'remove',
                label: 'Remove',
                onPress: () => removeServer(server.name),
              },
            ]}
            containerStyle={styles.swipeContainer}
            key={server.name}
          >
          <PreviewCard
            action={<PreviewToggle accessibilityLabel={`Enable ${server.name}`} onChange={(active) => toggleServer(server.name, active)} value={server.active} />}
            subtitle={`${server.transport.toUpperCase()} · ${server.active ? 'connected' : 'disconnected'}`}
            title={server.name}
          >
            <PreviewText numberOfLines={2} variant="mono">{server.endpoint}</PreviewText>
            <PreviewRow>
              <PreviewBadge tone={server.active ? 'success' : 'outline'}>{server.active ? 'CONNECTED' : 'DISABLED'}</PreviewBadge>
              <PreviewBadge tone="outline">{server.tools} TOOLS</PreviewBadge>
            </PreviewRow>
            <PreviewRow style={styles.cardIconActions}>
              <NativeButton ghost onPress={() => notify(`Opened ${server.tools} tools for ${server.name}`)} size="sm">
                {server.tools} tools
              </NativeButton>
              <NativeButton accessibilityLabel="Test" ghost onPress={() => notify(`Tested ${server.name}: ${server.tools} tools`)} size="icon">
                <Zap />
              </NativeButton>
              <NativeButton accessibilityLabel="Remove server" destructive ghost onPress={() => removeServer(server.name)} size="icon">
                <Trash2 />
              </NativeButton>
            </PreviewRow>
          </PreviewCard>
          </IOSSwipeActions>
        ))}
      </PreviewGrid>
      <PreviewModal onClose={() => setAddOpen(false)} open={addOpen} title="Add MCP server">
        <PreviewText variant="label">Server name</PreviewText>
        <NativeInput onChangeText={setName} placeholder="my-server" value={name} />
        <PreviewSegmented<'http' | 'stdio'>
          onChange={setTransport}
          options={[{ label: 'HTTP', value: 'http' }, { label: 'stdio', value: 'stdio' }]}
          value={transport}
        />
        {transport === 'http' ? (
          <NativeInput onChangeText={setEndpoint} placeholder="https://example.com/mcp" value={endpoint} />
        ) : (
          <>
            <NativeInput onChangeText={setCommand} placeholder="npx" value={command} />
            <NativeInput onChangeText={setArgumentsText} placeholder="-y @modelcontextprotocol/server" value={argumentsText} />
          </>
        )}
        <NativeButton disabled={!name.trim() || (transport === 'http' ? !endpoint.trim() : !command.trim())} onPress={() => {
          const serverEndpoint = transport === 'http'
            ? endpoint.trim()
            : `${command.trim()} ${argumentsText.trim()}`.trim();
          setServers((current) => [...current, {
            active: true,
            endpoint: serverEndpoint,
            name: name.trim(),
            tools: 0,
            transport,
          }]);
          notify(`Added MCP server: ${name}`);
          setAddOpen(false);
          setName('');
          setEndpoint('');
          setCommand('');
          setArgumentsText('');
        }}>
          Add server
        </NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

function StudioSummaryCard({ label, tone = 'default', value }: {
  label: string;
  tone?: 'default' | 'error' | 'info' | 'success' | 'warning';
  value: number | string;
}) {
  const { tokens } = useTheme();
  const color = tone === 'success'
    ? tokens.colors.success
    : tone === 'warning'
      ? tokens.colors.warning
    : tone === 'error'
        ? tokens.colors.destructive
        : tone === 'info'
          ? tokens.colors.primary
          : tokens.colors.foreground;
  return (
    <View style={[styles.summaryCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
      <PreviewText variant="label">{label}</PreviewText>
      <PreviewText color={color} style={styles.summaryValue}>{String(value)}</PreviewText>
    </View>
  );
}

export function ChannelsPreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const chinese = locale === 'zh';
  const [channels, setChannels] = useState<EditableChannel[]>(() => PREVIEW_CHANNELS.map((channel) => ({
    ...channel,
    mentionRequired: true,
    reactionsEnabled: channel.status === 'Connected',
  })));
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [channelCredential, setChannelCredential] = useState('');
  const [allowedUsers, setAllowedUsers] = useState('');
  const [homeChannel, setHomeChannel] = useState('');
  const selected = channels.find((channel) => channel.name === selectedName) ?? null;
  const updateChannel = (
    channelName: string,
    update: Partial<(typeof channels)[number]>,
  ) => {
    setChannels((current) => current.map((channel) => (
      channel.name === channelName ? { ...channel, ...update } : channel
    )));
  };
  const openChannel = (channel: EditableChannel) => {
    setSelectedName(channel.name);
    setChannelCredential('');
    setAllowedUsers(channel.name === 'Telegram' ? '842661204, 901245887' : '');
    setHomeChannel(channel.account);
  };
  return (
    <PreviewPage
      title={chinese ? '消息渠道' : 'Channels'}
    >
      <View style={styles.channelStack}>
        {channels.map((channel) => (
          <PreviewCard
            action={<PreviewBadge tone={channel.status === 'Connected' ? 'success' : 'outline'}>{channel.status.toUpperCase()}</PreviewBadge>}
            key={channel.name}
            subtitle={channel.account}
            title={channel.name}
          >
            <PreviewSettingRow detail={channel.users} label={chinese ? '访问范围' : 'Access'} />
            <PreviewSettingRow detail={chinese ? '群聊中需要 @Hermes' : 'Require @Hermes in groups'} label={chinese ? '提及规则' : 'Mention rule'} trailing={<PreviewToggle accessibilityLabel={`Require mention for ${channel.name}`} onChange={(mentionRequired) => updateChannel(channel.name, { mentionRequired })} value={channel.mentionRequired} />} />
            <PreviewSettingRow detail={chinese ? '发送与接收表情反馈' : 'Send and receive reactions'} label={chinese ? '表情反馈' : 'Reactions'} trailing={<PreviewToggle accessibilityLabel={`Reactions for ${channel.name}`} onChange={(reactionsEnabled) => updateChannel(channel.name, { reactionsEnabled })} value={channel.reactionsEnabled} />} />
            <NativeButton onPress={() => openChannel(channel)} outlined prefix={<Settings2 />}>
              {chinese ? '配置' : 'Configure'}
            </NativeButton>
          </PreviewCard>
        ))}
      </View>
      <PreviewModal onClose={() => setSelectedName(null)} open={selected !== null} title={`${selected?.name ?? ''} ${chinese ? '设置' : 'settings'}`}>
        <PreviewSettingRow label={`${chinese ? '启用' : 'Enable'} ${selected?.name ?? 'channel'}`} trailing={<PreviewToggle accessibilityLabel="Enable channel" onChange={(enabled) => selected && updateChannel(selected.name, { status: enabled ? 'Connected' : 'Disabled' })} value={selected?.status === 'Connected'} />} />
        <PreviewText variant="label">{chinese ? 'Bot Token / 凭据' : 'Bot token / credentials'}</PreviewText>
        <NativeInput onChangeText={setChannelCredential} placeholder="••••••••••••••••" secureTextEntry value={channelCredential} />
        <PreviewText variant="label">{chinese ? '允许的用户' : 'Allowed users'}</PreviewText>
        <NativeInput onChangeText={setAllowedUsers} value={allowedUsers} />
        <PreviewText variant="label">{chinese ? '主频道' : 'Home channel'}</PreviewText>
        <NativeInput onChangeText={setHomeChannel} value={homeChannel} />
        <NativeButton onPress={() => {
          if (selected) updateChannel(selected.name, { account: homeChannel });
          notify(`${selected?.name} settings saved`);
          setSelectedName(null);
        }}>
          {chinese ? '保存' : 'Save'}
        </NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

export function WebhooksPreviewPage({ notify }: PreviewPageProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [deliverOnly, setDeliverOnly] = useState(false);
  const [hooks, setHooks] = useState<EditableWebhook[]>(() => (
    PREVIEW_WEBHOOKS.map((hook) => ({ ...hook }))
  ));
  const updateHook = (hookName: string, active: boolean) => {
    setHooks((current) => current.map((hook) => (
      hook.name === hookName ? { ...hook, active } : hook
    )));
  };
  const deleteHook = (hookName: string) => {
    setHooks((current) => current.filter((hook) => hook.name !== hookName));
    notify(`Deleted webhook: ${hookName}`);
  };
  return (
    <PreviewPage
      actions={<NativeButton onPress={() => setCreateOpen(true)} prefix={<Plus />} size="sm">New webhook</NativeButton>}
      subtitle="Receive external events and route them into Hermes prompts and channels."
      title="Webhooks"
    >
      <PreviewCard title="Receiver">
        <PreviewSettingRow detail="https://hermes.example.com/api/webhooks/v1" label="Endpoint" trailing={<NativeButton accessibilityLabel="Copy endpoint" ghost onPress={() => notify('Webhook endpoint copied')} size="icon"><Copy /></NativeButton>} />
        <PreviewSettingRow detail="Requests require the configured bearer secret" label="Authentication" trailing={<PreviewBadge tone="success">ENABLED</PreviewBadge>} />
      </PreviewCard>
      <PreviewGrid minItemWidth={300}>
        {hooks.map((hook) => (
          <IOSSwipeActions
            actions={[
              {
                icon: 'doc.on.doc',
                id: 'copy',
                label: 'Copy',
                onPress: () => notify(`Copied URL for ${hook.name}`),
              },
              {
                destructive: true,
                icon: 'trash',
                id: 'delete',
                label: 'Delete',
                onPress: () => deleteHook(hook.name),
              },
            ]}
            containerStyle={styles.swipeContainer}
            key={hook.name}
          >
          <PreviewCard
            action={<PreviewToggle accessibilityLabel={`Enable ${hook.name}`} onChange={(active) => updateHook(hook.name, active)} value={hook.active} />}
            subtitle={hook.description}
            title={hook.name}
          >
            <PreviewBadge tone="outline">{hook.events}</PreviewBadge>
            <PreviewDataRow label="Deliveries" mono value={String(hook.deliveries)} />
            <PreviewRow style={styles.cardIconActions}>
              <NativeButton accessibilityLabel="Copy" ghost onPress={() => notify(`Copied URL for ${hook.name}`)} size="icon"><Copy /></NativeButton>
              <NativeButton accessibilityLabel="Delete webhook" destructive ghost onPress={() => deleteHook(hook.name)} size="icon"><Trash2 /></NativeButton>
            </PreviewRow>
          </PreviewCard>
          </IOSSwipeActions>
        ))}
      </PreviewGrid>
      <PreviewModal onClose={() => setCreateOpen(false)} open={createOpen} title="New webhook">
        <NativeInput onChangeText={setName} placeholder="e.g. github-push" value={name} />
        <NativeInput placeholder="What this webhook does (optional)" />
        <NativeInput placeholder="push, pull_request" />
        <NativeInput multiline placeholder="Instructions for the agent when this webhook fires" />
        <PreviewSettingRow label="Deliver only" trailing={<PreviewToggle accessibilityLabel="Deliver only" onChange={setDeliverOnly} value={deliverOnly} />} />
        <NativeButton disabled={!name.trim()} onPress={() => {
          setHooks((current) => [...current, {
            active: true,
            deliveries: 0,
            description: deliverOnly ? 'Delivery-only webhook' : 'Runs Hermes instructions for matching events.',
            events: 'custom',
            name: name.trim(),
          }]);
          notify(`Created webhook: ${name}`);
          setCreateOpen(false);
          setName('');
          setDeliverOnly(false);
        }}>Create</NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

export function PairingPreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  const chinese = locale === 'zh';
  const compact = width < 620;
  const [manualUrl, setManualUrl] = useState('');
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [pairingTarget, setPairingTarget] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState('');
  const devices = PREVIEW_PAIRINGS.map((device, index) => ({
    ...device,
    address: index === 0 ? '192.168.1.18:8080' : index === 1 ? '192.168.1.24:8080' : '192.168.1.31:8080',
    agentVersion: '0.19.0',
    endpoint: index === 0 ? 'Mobile' : index === 1 ? 'Desktop' : 'Web',
    online: device.status === 'Connected',
    os: index === 0 ? 'iOS 18.6.1 arm64' : index === 1 ? 'macOS 15.5 arm64' : 'iPadOS 18.6 arm64',
    responseMs: index === 0 ? 18 : index === 1 ? 37 : 0,
    webVersion: '2026.7.20',
  }));
  const submitManualPairing = () => {
    if (!manualUrl.trim()) {
      notify(chinese ? '请输入设备 URL' : 'Enter a device URL');
      return;
    }
    notify(chinese ? '已发送远程配对请求' : 'Remote pairing request sent');
    setManualUrl('');
  };
  return (
    <PreviewPage
      actions={(
        <PreviewRow style={styles.deviceHeaderActions}>
          {!compact ? <>
            <NativeInput
              autoCapitalize="none"
              onChangeText={setManualUrl}
              placeholder={chinese ? '输入远程设备 URL' : 'Remote device URL'}
              style={styles.manualPairingInput}
              value={manualUrl}
            />
            <NativeButton onPress={submitManualPairing} outlined size="sm">
              {chinese ? '手动配对' : 'Manual pairing'}
            </NativeButton>
            <NativeButton onPress={() => notify(chinese ? '配对链接已复制' : 'Pairing link copied')} outlined prefix={<Link />} size="sm">
              {chinese ? '复制配对链接' : 'Copy pairing link'}
            </NativeButton>
          </> : null}
          <NativeButton onPress={() => setRequestsOpen(true)} outlined size="sm">
            {compact ? '1' : chinese ? '请求 1' : 'Requests 1'}
          </NativeButton>
          <NativeButton accessibilityLabel={chinese ? '刷新设备' : 'Refresh devices'} onPress={() => notify(chinese ? '设备发现已刷新' : 'Device discovery refreshed')} prefix={<RefreshCw />} size={compact ? 'icon' : 'sm'}>
            {compact ? null : chinese ? '刷新' : 'Refresh'}
          </NativeButton>
        </PreviewRow>
      )}
      title={chinese ? '设备' : 'Devices'}
    >
      {compact ? (
        <View style={styles.compactPairingToolbar}>
          <NativeInput
            autoCapitalize="none"
            onChangeText={setManualUrl}
            placeholder={chinese ? '输入远程设备 URL' : 'Remote device URL'}
            value={manualUrl}
          />
          <PreviewRow>
            <NativeButton onPress={submitManualPairing} outlined size="sm">
              {chinese ? '手动配对' : 'Manual pairing'}
            </NativeButton>
            <NativeButton onPress={() => notify(chinese ? '配对链接已复制' : 'Pairing link copied')} outlined prefix={<Link />} size="sm">
              {chinese ? '复制配对链接' : 'Copy pairing link'}
            </NativeButton>
          </PreviewRow>
        </View>
      ) : null}
      <PreviewRow style={styles.deviceHeaderMeta}>
        <PreviewText variant="muted">{chinese ? `${devices.length} 台设备` : `${devices.length} devices`}</PreviewText>
        <PreviewText variant="muted">{chinese ? '上次扫描：刚刚' : 'Last scanned: just now'}</PreviewText>
      </PreviewRow>
      <View style={[styles.deviceGrid, width < 760 && styles.deviceGridCompact]}>
        {devices.map((device) => (
          <View
            key={device.name}
            style={[
              styles.studioDeviceCard,
              {
                backgroundColor: tokens.colors.card,
                borderColor: tokens.colors.border,
              },
              width < 760 && styles.studioDeviceCardCompact,
            ]}
          >
            <View style={styles.deviceCardHeader}>
              <View style={styles.flexCopy}>
                <PreviewText variant="heading">{device.name}</PreviewText>
                <PreviewText color={tokens.colors.primary} variant="tiny">{device.address}</PreviewText>
              </View>
              <PreviewBadge tone={device.endpoint === 'Desktop' ? 'success' : device.endpoint === 'Web' ? 'outline' : 'default'}>
                {device.endpoint.toUpperCase()}
              </PreviewBadge>
            </View>
            <PreviewRow>
              <PreviewBadge tone={device.online ? 'success' : 'outline'}>
                {device.online ? (chinese ? '在线' : 'ONLINE') : (chinese ? '离线' : 'OFFLINE')}
              </PreviewBadge>
              <PreviewBadge tone={device.status === 'Connected' ? 'success' : 'outline'}>
                {device.status === 'Connected' ? (chinese ? '已配对' : 'PAIRED') : (chinese ? '已授权' : 'AUTHORIZED')}
              </PreviewBadge>
            </PreviewRow>
            <View style={styles.deviceMetaList}>
              <PreviewDataRow label={chinese ? '操作系统' : 'OS'} value={device.os} />
              <PreviewDataRow label={chinese ? 'Agent 版本' : 'Agent version'} mono value={device.agentVersion} />
              <PreviewDataRow label={chinese ? 'Web UI 版本' : 'Web UI version'} mono value={device.webVersion} />
              <PreviewDataRow label={chinese ? '响应时间' : 'Response'} mono value={device.online ? `${device.responseMs}ms` : '—'} />
            </View>
            <View style={styles.deviceCardActions}>
              {!device.online ? (
                <NativeButton onPress={() => {
                  setPairingTarget(device.name);
                  setPairingCode('');
                }} size="sm">
                  {chinese ? '请求配对' : 'Request pairing'}
                </NativeButton>
              ) : null}
              <NativeButton destructive ghost onPress={() => notify(chinese ? `已阻止 ${device.name}` : `Blocked ${device.name}`)} size="sm">
                {chinese ? '阻止' : 'Block'}
              </NativeButton>
            </View>
          </View>
        ))}
      </View>
      <PreviewModal onClose={() => setRequestsOpen(false)} open={requestsOpen} title={chinese ? '配对请求' : 'Pairing requests'}>
        <View style={[styles.requestItem, { borderColor: tokens.colors.border }]}>
          <View style={styles.flexCopy}>
            <PreviewText variant="heading">Hermes Studio Desktop</PreviewText>
            <PreviewText variant="muted">192.168.1.42:8080</PreviewText>
            <PreviewRow>
              <PreviewBadge tone="warning">{chinese ? '未处理' : 'PENDING'}</PreviewBadge>
              <PreviewBadge>{chinese ? '等待批准' : 'AWAITING APPROVAL'}</PreviewBadge>
            </PreviewRow>
          </View>
          <PreviewRow>
            <NativeButton onPress={() => { notify(chinese ? '配对请求已批准' : 'Pairing request approved'); setRequestsOpen(false); }} size="sm">{chinese ? '批准' : 'Approve'}</NativeButton>
            <NativeButton destructive outlined onPress={() => { notify(chinese ? '配对请求已拒绝' : 'Pairing request rejected'); setRequestsOpen(false); }} size="sm">{chinese ? '拒绝' : 'Reject'}</NativeButton>
          </PreviewRow>
        </View>
      </PreviewModal>
      <PreviewModal onClose={() => setPairingTarget(null)} open={pairingTarget !== null} title={chinese ? '输入配对码' : 'Enter pairing code'}>
        <PreviewText variant="muted">{pairingTarget}</PreviewText>
        <NativeInput autoCapitalize="characters" onChangeText={setPairingCode} placeholder={chinese ? '配对码' : 'Pairing code'} value={pairingCode} />
        <PreviewRow style={styles.rightActions}>
          <NativeButton ghost onPress={() => setPairingTarget(null)} size="sm">{chinese ? '取消' : 'Cancel'}</NativeButton>
          <NativeButton disabled={!pairingCode.trim()} onPress={() => {
            notify(chinese ? '配对请求已提交' : 'Pairing request submitted');
            setPairingTarget(null);
          }} size="sm">{chinese ? '提交配对请求' : 'Submit pairing request'}</NativeButton>
        </PreviewRow>
      </PreviewModal>
    </PreviewPage>
  );
}

const styles = StyleSheet.create({
  swipeContainer: {
    borderRadius: 4,
  },
  stack: {
    gap: 12,
  },
  jobsSplitter: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: -20,
  },
  runHistory: {
    gap: 8,
  },
  runHistoryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 38,
  },
  runHistoryRow: {
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  channelStack: {
    gap: 14,
  },
  studioNotice: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryCard: {
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 140,
    flexGrow: 1,
    gap: 6,
    minWidth: 132,
    padding: 14,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 28,
  },
  studioToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  toolbarSearch: {
    flex: 1,
    minWidth: 220,
  },
  studioTable: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pluginTableHeader: {
    minHeight: 38,
  },
  pluginTableRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pluginTableRowCompact: {
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  pluginMainCell: {
    flex: 2,
    gap: 3,
    minWidth: 170,
  },
  pluginStatusCell: {
    minWidth: 88,
  },
  pluginMetaCell: {
    flex: 1,
    minWidth: 112,
  },
  pluginCapabilityCell: {
    flex: 1,
    minWidth: 120,
  },
  pluginManageCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'flex-end',
    minWidth: 72,
  },
  metadataPanel: {
    borderRadius: 6,
    borderWidth: 1,
    gap: 5,
    padding: 12,
  },
  rightActions: {
    justifyContent: 'flex-end',
  },
  cardIconActions: {
    flexWrap: 'nowrap',
    gap: 2,
  },
  toolbarBetween: {
    justifyContent: 'space-between',
  },
  skillsHeaderActions: {
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  skillSourceLegend: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  legendDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  skillsLayout: {
    gap: 12,
  },
  skillFilterLabel: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  skillDescription: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.72,
  },
  studioSkillSidebar: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  studioSkillGroup: {
    gap: 2,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  studioSkillGroupTitle: {
    paddingHorizontal: 8,
    paddingBottom: 5,
    paddingTop: 10,
  },
  studioSkillListItem: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 8,
    minHeight: 58,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  skillScanActions: {
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  pairingCode: {
    alignItems: 'center',
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 92,
    padding: 16,
  },
  codeText: {
    fontSize: 24,
    letterSpacing: 3,
  },
  deviceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 62,
  },
  deviceIcon: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  flexCopy: {
    flex: 1,
    minWidth: 0,
  },
  deviceHeaderActions: {
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  manualPairingInput: {
    minWidth: 220,
    width: 260,
  },
  deviceHeaderMeta: {
    gap: 14,
    justifyContent: 'flex-end',
  },
  compactPairingToolbar: {
    gap: 8,
  },
  deviceGrid: {
    alignItems: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  deviceGridCompact: {
    flexDirection: 'column',
  },
  studioDeviceCard: {
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 300,
    flexGrow: 1,
    gap: 13,
    maxWidth: 520,
    minWidth: 280,
    padding: 15,
  },
  studioDeviceCardCompact: {
    maxWidth: undefined,
    minWidth: 0,
    width: '100%',
  },
  deviceCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  deviceMetaList: {
    gap: 1,
  },
  deviceCardActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  requestItem: {
    alignItems: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 14,
  },
});
