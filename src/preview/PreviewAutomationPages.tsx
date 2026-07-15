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
  Filter,
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
  Wrench,
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
import { WEBUI_FONT_FAMILIES } from '../app/webui-fonts';
import { multiplyAlpha } from '../design/control-contracts';
import { useTheme } from '../design/ThemeProvider';
import {
  PREVIEW_CHANNELS,
  PREVIEW_CRON,
  PREVIEW_MCP,
  PREVIEW_PAIRINGS,
  PREVIEW_PLUGINS,
  PREVIEW_SKILLS,
  PREVIEW_TOOLSETS,
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
} from './PreviewPrimitives';

export function CronPreviewPage({ notify }: PreviewPageProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [schedule, setSchedule] = useState<'interval' | 'daily' | 'weekly'>('daily');
  const [runAt, setRunAt] = useState(() => new Date(2026, 0, 1, 9, 0));
  const [states, setStates] = useState<Record<string, boolean>>(() => (
    Object.fromEntries(PREVIEW_CRON.map((job) => [job.id, job.enabled]))
  ));
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  return (
    <PreviewPage
      actions={(
        <NativeButton onPress={() => setCreateOpen(true)} prefix={<Plus />} size="sm">
          New cron job
        </NativeButton>
      )}
      subtitle="Schedule agent prompts, scripts, delivery targets, and one-off runs."
      title="Cron"
    >
      <PreviewGrid minItemWidth={180}>
        <PreviewCard>
          <PreviewDataRow label="Scheduled" mono value="3" />
        </PreviewCard>
        <PreviewCard>
          <PreviewDataRow label="Active" mono value="2" />
        </PreviewCard>
        <PreviewCard>
          <PreviewDataRow label="Next run" mono value="Today 18:00" />
        </PreviewCard>
      </PreviewGrid>
      <View style={styles.stack}>
        {PREVIEW_CRON.map((job) => (
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
          </PreviewCard>
          </IOSSwipeActions>
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

export function SkillsPreviewPage({ locale = 'zh', navigate, notify }: PreviewPageProps) {
  const { width } = useWindowDimensions();
  const { tokens } = useTheme();
  const isChinese = locale === 'zh';
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'skills' | 'toolsets' | 'hub'>('skills');
  const [category, setCategory] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => (
    Object.fromEntries(PREVIEW_SKILLS.map((skill) => [skill.name, skill.enabled]))
  ));
  const isWide = width >= 700;
  const categories = Array.from(new Set(PREVIEW_SKILLS.map((skill) => skill.category)));
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = PREVIEW_SKILLS.filter((skill) => (
    (!category || skill.category === category)
    && `${skill.name} ${skill.category} ${skill.description} ${isChinese ? `${skillCategoryZh(skill.category)} ${skillDescriptionZh(skill.name)}` : ''}`
      .toLowerCase()
      .includes(normalizedQuery)
  ));
  return (
    <PreviewPage
      actions={<PreviewBadge tone="success">{isChinese ? `已启用 ${Object.values(enabled).filter(Boolean).length}/${PREVIEW_SKILLS.length}` : `${Object.values(enabled).filter(Boolean).length}/${PREVIEW_SKILLS.length} ENABLED`}</PreviewBadge>}
      title={isChinese ? '技能' : 'Skills'}
    >
      <PreviewSearch
        onChangeText={setQuery}
        placeholder={isChinese ? '搜索技能和工具集...' : 'Search skills and toolsets...'}
        value={query}
      />
      <View style={[styles.skillsLayout, isWide && styles.skillsLayoutWide]}>
        <View style={[styles.skillsFilters, { backgroundColor: tokens.colors.muted, borderColor: tokens.colors.border }, isWide && styles.skillsFiltersWide]}>
          {isWide ? (
            <View style={[styles.skillsFilterHeading, { borderBottomColor: tokens.colors.border }]}>
              <Filter color={tokens.colors.textTertiary} size={13} />
              <PreviewText variant="label">{isChinese ? '筛选' : 'Filters'}</PreviewText>
            </View>
          ) : null}
          <View style={[styles.skillsFilterItems, isWide && styles.skillsFilterItemsWide]}>
            <SkillFilterItem
              active={tab === 'skills'}
              icon={Package}
              label={`${isChinese ? '全部' : 'All'} (${PREVIEW_SKILLS.length})`}
              onPress={() => {
                setTab('skills');
                setCategory(null);
              }}
            />
            <SkillFilterItem
              active={tab === 'toolsets'}
              icon={Wrench}
              label={`${isChinese ? '工具集' : 'Toolsets'} (${PREVIEW_TOOLSETS.length})`}
              onPress={() => setTab('toolsets')}
            />
            <SkillFilterItem
              active={tab === 'hub'}
              icon={Search}
              label={isChinese ? '浏览中心' : 'Browse hub'}
              onPress={() => setTab('hub')}
            />
          </View>
          {isWide && tab === 'skills' && !normalizedQuery ? (
            <View style={[styles.skillsCategories, { borderTopColor: tokens.colors.border }]}>
              <PreviewText style={styles.skillsCategoriesTitle} variant="label">
                {isChinese ? '分类' : 'Categories'}
              </PreviewText>
              {categories.map((item) => (
                <SkillCategoryItem
                  active={category === item}
                  count={PREVIEW_SKILLS.filter((skill) => skill.category === item).length}
                  key={item}
                  label={isChinese ? skillCategoryZh(item) : item}
                  onPress={() => setCategory((current) => current === item ? null : item)}
                />
              ))}
            </View>
          ) : null}
        </View>
        <View style={styles.skillsContent}>
          {tab === 'skills' ? (
            <PreviewCard
              action={(
                <PreviewRow style={styles.cardIconActions}>
                  <PreviewBadge tone="outline">{filtered.length}</PreviewBadge>
                  <NativeButton
                    accessibilityLabel={isChinese ? '学习技能' : 'Learn a skill'}
                    ghost
                    onPress={() => navigate('/chat')}
                    size="icon"
                  >
                    <Sparkles />
                  </NativeButton>
                  <NativeButton
                    accessibilityLabel={isChinese ? '新建技能' : 'New skill'}
                    ghost
                    onPress={() => notify(isChinese ? '已打开新建技能编辑器' : 'New skill editor opened')}
                    size="icon"
                  >
                    <Plus />
                  </NativeButton>
                </PreviewRow>
              )}
              title={category ? (isChinese ? skillCategoryZh(category) : category) : isChinese ? '全部' : 'All'}
            >
              <View style={styles.skillRows}>
                {filtered.map((skill, index) => (
                  <View key={skill.name}>
                    <View style={styles.skillRow}>
                      <View style={styles.skillSwitch}>
                        <PreviewToggle
                          accessibilityLabel={`Enable ${skill.name}`}
                          onChange={(value) => setEnabled((current) => ({ ...current, [skill.name]: value }))}
                          value={enabled[skill.name] ?? false}
                        />
                      </View>
                      <View style={styles.skillCopy}>
                        <PreviewText color={enabled[skill.name] ? tokens.colors.foreground : tokens.colors.textSecondary} variant="mono">
                          {skill.name}
                        </PreviewText>
                        <PreviewText numberOfLines={2} variant="tiny">
                          {isChinese ? skillDescriptionZh(skill.name) : skill.description}
                        </PreviewText>
                      </View>
                      <NativeButton
                        accessibilityLabel={isChinese ? `编辑 ${skill.name}` : `Edit ${skill.name}`}
                        ghost
                        onPress={() => notify(isChinese ? `已打开 ${skill.name}/SKILL.md` : `Opened ${skill.name}/SKILL.md`)}
                        size="icon"
                      >
                        <Pencil />
                      </NativeButton>
                    </View>
                    {index < filtered.length - 1 ? <PreviewDivider /> : null}
                  </View>
                ))}
              </View>
            </PreviewCard>
          ) : tab === 'toolsets' ? (
        <PreviewGrid minItemWidth={300}>
          {PREVIEW_TOOLSETS.map((toolset) => (
            <PreviewCard
              action={<PreviewBadge tone={toolset.setup ? 'warning' : toolset.active ? 'success' : 'outline'}>{toolset.setup ? isChinese ? '需要配置' : 'SETUP NEEDED' : toolset.active ? isChinese ? '已启用' : 'ACTIVE' : isChinese ? '未启用' : 'INACTIVE'}</PreviewBadge>}
              key={toolset.name}
              subtitle={isChinese ? toolsetDetailZh(toolset.name) : toolset.detail}
              title={isChinese ? `${toolsetNameZh(toolset.name)}工具集` : `${toolset.name} Toolset`}
            >
              <NativeButton onPress={() => notify(isChinese ? `已打开 ${toolset.name} 工具集设置` : `Opened ${toolset.name} toolset settings`)} outlined prefix={<Wrench />} size="sm">
                {isChinese ? '配置' : 'Configure'}
              </NativeButton>
            </PreviewCard>
          ))}
        </PreviewGrid>
          ) : (
            <PreviewCard
              subtitle={isChinese ? '从官方和社区来源发现并安装技能。' : 'Discover and install skills from official and community sources.'}
              title={isChinese ? '技能中心' : 'Skill hub'}
            >
              {PREVIEW_SKILLS.slice(0, 4).map((skill, index) => (
                <View key={skill.name}>
                  <View style={styles.skillRow}>
                    <Package color={tokens.colors.textTertiary} size={18} />
                    <View style={styles.skillCopy}>
                      <PreviewText variant="mono">{skill.name}</PreviewText>
                      <PreviewText numberOfLines={2} variant="tiny">
                        {isChinese ? skillDescriptionZh(skill.name) : skill.description}
                      </PreviewText>
                    </View>
                    <NativeButton onPress={() => notify(isChinese ? `已安装 ${skill.name}` : `Installed ${skill.name}`)} outlined size="sm">
                      {isChinese ? '安装' : 'Install'}
                    </NativeButton>
                  </View>
                  {index < 3 ? <PreviewDivider /> : null}
                </View>
              ))}
            </PreviewCard>
          )}
        </View>
      </View>
    </PreviewPage>
  );
}

function SkillFilterItem({ active, icon: Icon, label, onPress }: {
  active: boolean;
  icon: typeof Package;
  label: string;
  onPress(): void;
}) {
  const { tokens } = useTheme();
  return (
    <NativeListItem
      active={active}
      activeBackgroundColor={multiplyAlpha(tokens.colors.foreground, 0.9)}
      activeTextColor={tokens.colors.background}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.skillFilterItem}
      textStyle={styles.skillFilterText}
    >
      <Icon size={14} />
      <View style={styles.skillFilterLabel}>
        <Text numberOfLines={1}>{label}</Text>
      </View>
    </NativeListItem>
  );
}

function SkillCategoryItem({ active, count, label, onPress }: {
  active: boolean;
  count: number;
  label: string;
  onPress(): void;
}) {
  return (
    <NativeListItem
      active={active}
      onPress={onPress}
      style={styles.skillCategoryItem}
      textStyle={styles.skillCategoryText}
    >
      <View style={styles.skillFilterLabel}>
        <Text numberOfLines={1}>{label}</Text>
      </View>
      <Text>{count}</Text>
    </NativeListItem>
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

function toolsetNameZh(name: string): string {
  return ({ Browser: '浏览器', GitHub: 'GitHub', 'Google Workspace': 'Google Workspace' } as Record<string, string>)[name] ?? name;
}

function toolsetDetailZh(name: string): string {
  return ({
    Browser: 'Playwright 浏览器自动化',
    GitHub: '仓库、议题和拉取请求',
    'Google Workspace': '云端硬盘、Gmail、文档和日历',
  } as Record<string, string>)[name] ?? name;
}

export function PluginsPreviewPage({ navigate, notify }: PreviewPageProps) {
  const [identifier, setIdentifier] = useState('');
  const [memory, setMemory] = useState('builtin');
  return (
    <PreviewPage
      actions={(
        <NativeButton accessibilityLabel="Rescan dashboard extensions" ghost onPress={() => notify('Dashboard extensions rescanned')} size="icon">
          <RefreshCw />
        </NativeButton>
      )}
      subtitle="Discover, install, enable, update, and configure Hermes plugins."
      title="Plugins"
    >
      <PreviewGrid minItemWidth={320}>
        <PreviewCard title="Runtime providers" subtitle="Memory and context providers apply to the next session.">
          <PreviewText variant="label">Memory provider</PreviewText>
          <NativeInput onChangeText={setMemory} value={memory} />
          <PreviewText variant="label">Context engine</PreviewText>
          <NativeInput value="hermes" />
          <NativeButton onPress={() => notify('Provider settings saved')} prefix={<Save />}>
            Save providers
          </NativeButton>
        </PreviewCard>
        <PreviewCard title="Install from GitHub / Git URL" subtitle="Use owner/repo shorthand or a complete clone URL.">
          <NativeInput onChangeText={setIdentifier} placeholder="owner/repo or https://..." value={identifier} />
          <PreviewSettingRow label="Force reinstall" trailing={<PreviewToggle accessibilityLabel="Force reinstall" onChange={() => {}} value={false} />} />
          <PreviewSettingRow label="Enable after install" trailing={<PreviewToggle accessibilityLabel="Enable after install" onChange={() => {}} value />} />
          <NativeButton disabled={!identifier.trim()} onPress={() => notify(`Installed: ${identifier}`)} prefix={<Download />}>
            Install
          </NativeButton>
        </PreviewCard>
      </PreviewGrid>
      <PreviewText variant="label">Installed plugins</PreviewText>
      <PreviewGrid minItemWidth={300}>
        {PREVIEW_PLUGINS.map((plugin) => (
          <PreviewCard
            action={<PreviewToggle accessibilityLabel={`Enable ${plugin.label}`} onChange={() => {}} value={plugin.active} />}
            key={plugin.name}
            subtitle={plugin.name}
            title={plugin.label}
          >
            <PreviewRow>
              <PreviewBadge tone="success">v{plugin.version}</PreviewBadge>
              <PreviewBadge tone="outline">{plugin.source}</PreviewBadge>
              <PreviewBadge tone="outline">{plugin.tab}</PreviewBadge>
            </PreviewRow>
            <PreviewRow>
              {plugin.name === 'hermes-achievements' ? (
                <NativeButton onPress={() => navigate('/achievements')} ghost size="sm">Open tab</NativeButton>
              ) : plugin.name === 'kanban' ? (
                <NativeButton onPress={() => navigate('/kanban')} ghost size="sm">Open tab</NativeButton>
              ) : null}
              <NativeButton onPress={() => notify(`Updated: ${plugin.name}`)} ghost prefix={<RefreshCw />} size="sm">
                git pull
              </NativeButton>
            </PreviewRow>
          </PreviewCard>
        ))}
      </PreviewGrid>
    </PreviewPage>
  );
}

export function McpPreviewPage({ notify }: PreviewPageProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'http' | 'stdio'>('http');
  return (
    <PreviewPage
      actions={<NativeButton onPress={() => setAddOpen(true)} prefix={<Plus />} size="sm">Add server</NativeButton>}
      subtitle="Manage Model Context Protocol servers and inspect available tools."
      title="MCP"
    >
      <PreviewGrid minItemWidth={290}>
        {PREVIEW_MCP.map((server) => (
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
                onPress: () => notify(`Removed server: ${server.name}`),
              },
            ]}
            containerStyle={styles.swipeContainer}
            key={server.name}
          >
          <PreviewCard
            action={<PreviewToggle accessibilityLabel={`Enable ${server.name}`} onChange={() => {}} value={server.active} />}
            subtitle={server.transport.toUpperCase()}
            title={server.name}
          >
            <PreviewText numberOfLines={2} variant="mono">{server.endpoint}</PreviewText>
            <PreviewRow>
              <PreviewBadge tone={server.active ? 'success' : 'outline'}>{server.active ? 'CONNECTED' : 'DISABLED'}</PreviewBadge>
              <PreviewBadge tone="outline">{server.tools} TOOLS</PreviewBadge>
            </PreviewRow>
            <PreviewRow style={styles.cardIconActions}>
              <NativeButton accessibilityLabel="Test" ghost onPress={() => notify(`Tested ${server.name}: ${server.tools} tools`)} size="icon">
                <Zap />
              </NativeButton>
              <NativeButton accessibilityLabel="Remove server" destructive ghost onPress={() => notify(`Removed server: ${server.name}`)} size="icon">
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
          <NativeInput placeholder="https://example.com/mcp" />
        ) : (
          <>
            <NativeInput placeholder="npx" />
            <NativeInput placeholder="-y @modelcontextprotocol/server" />
          </>
        )}
        <NativeButton disabled={!name.trim()} onPress={() => {
          notify(`Added MCP server: ${name}`);
          setAddOpen(false);
          setName('');
        }}>
          Add server
        </NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

export function ChannelsPreviewPage({ notify }: PreviewPageProps) {
  const [selected, setSelected] = useState<(typeof PREVIEW_CHANNELS)[number] | null>(null);
  return (
    <PreviewPage
      actions={<NativeButton accessibilityLabel="Refresh channels" ghost onPress={() => notify('Channel status refreshed')} size="icon"><RefreshCw /></NativeButton>}
      subtitle="Connect messaging platforms, control allowed users, and configure delivery behavior."
      title="Channels"
    >
      <PreviewGrid minItemWidth={300}>
        {PREVIEW_CHANNELS.map((channel) => (
          <PreviewCard
            action={<PreviewBadge tone={channel.status === 'Connected' ? 'success' : 'outline'}>{channel.status.toUpperCase()}</PreviewBadge>}
            key={channel.name}
            subtitle={channel.account}
            title={channel.name}
          >
            <PreviewDataRow label="Access" value={channel.users} />
            <NativeButton onPress={() => setSelected(channel)} outlined prefix={<Settings2 />}>
              Configure
            </NativeButton>
          </PreviewCard>
        ))}
      </PreviewGrid>
      <PreviewModal onClose={() => setSelected(null)} open={selected !== null} title={`${selected?.name ?? ''} settings`}>
        <PreviewSettingRow label={`Enable ${selected?.name ?? 'channel'}`} trailing={<PreviewToggle accessibilityLabel="Enable channel" onChange={() => {}} value={selected?.status === 'Connected'} />} />
        <PreviewText variant="label">Allowed users</PreviewText>
        <NativeInput value={selected?.name === 'Telegram' ? '842661204, 901245887' : ''} />
        <PreviewText variant="label">Home channel</PreviewText>
        <NativeInput value={selected?.account ?? ''} />
        <NativeButton onPress={() => {
          notify(`${selected?.name} settings saved`);
          setSelected(null);
        }}>
          Save
        </NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

export function WebhooksPreviewPage({ notify }: PreviewPageProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
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
        {PREVIEW_WEBHOOKS.map((hook) => (
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
                onPress: () => notify(`Deleted webhook: ${hook.name}`),
              },
            ]}
            containerStyle={styles.swipeContainer}
            key={hook.name}
          >
          <PreviewCard
            action={<PreviewToggle accessibilityLabel={`Enable ${hook.name}`} onChange={() => {}} value={hook.active} />}
            subtitle={hook.description}
            title={hook.name}
          >
            <PreviewBadge tone="outline">{hook.events}</PreviewBadge>
            <PreviewDataRow label="Deliveries" mono value={String(hook.deliveries)} />
            <PreviewRow style={styles.cardIconActions}>
              <NativeButton accessibilityLabel="Copy" ghost onPress={() => notify(`Copied URL for ${hook.name}`)} size="icon"><Copy /></NativeButton>
              <NativeButton accessibilityLabel="Delete webhook" destructive ghost onPress={() => notify(`Deleted webhook: ${hook.name}`)} size="icon"><Trash2 /></NativeButton>
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
        <PreviewSettingRow label="Deliver only" trailing={<PreviewToggle accessibilityLabel="Deliver only" onChange={() => {}} value={false} />} />
        <NativeButton disabled={!name.trim()} onPress={() => {
          notify(`Created webhook: ${name}`);
          setCreateOpen(false);
          setName('');
        }}>Create</NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

export function PairingPreviewPage({ notify }: PreviewPageProps) {
  const [revoke, setRevoke] = useState<string | null>(null);
  return (
    <PreviewPage
      actions={<NativeButton onPress={() => notify('New pairing code generated')} prefix={<Plus />} size="sm">Pair device</NativeButton>}
      subtitle="Review authorized devices and revoke access to this Hermes server."
      title="Pairing"
    >
      <PreviewCard title="Pair a new device" subtitle="Scan from another Hermes client or enter the code manually.">
        <View style={styles.pairingCode}>
          <PreviewText style={styles.codeText} variant="mono">HERMES-842-661</PreviewText>
        </View>
        <PreviewRow>
          <PreviewBadge tone="warning">EXPIRES IN 09:42</PreviewBadge>
          <NativeButton onPress={() => notify('Pairing code copied')} outlined prefix={<Copy />} size="sm">Copy code</NativeButton>
        </PreviewRow>
      </PreviewCard>
      <PreviewCard title="Authorized devices">
        {PREVIEW_PAIRINGS.map((device) => (
          <IOSSwipeActions
            actions={[
              {
                destructive: true,
                icon: 'trash',
                id: 'revoke',
                label: 'Revoke',
                onPress: () => setRevoke(device.name),
              },
            ]}
            key={device.name}
          >
          <View>
            <View style={styles.deviceRow}>
              <View style={styles.deviceIcon}><ShieldCheck size={19} /></View>
              <View style={styles.flexCopy}>
                <PreviewText variant="heading">{device.name}</PreviewText>
                <PreviewText variant="muted">{device.platform} · {device.lastSeen}</PreviewText>
              </View>
              <PreviewBadge tone={device.status === 'Connected' ? 'success' : 'outline'}>{device.status.toUpperCase()}</PreviewBadge>
              <NativeButton accessibilityLabel="Revoke access" destructive ghost onPress={() => setRevoke(device.name)} size="icon"><Trash2 /></NativeButton>
            </View>
            <PreviewDivider />
          </View>
          </IOSSwipeActions>
        ))}
      </PreviewCard>
      <ConfirmDialog
        description="This device will need a new pairing code before it can connect again."
        destructive
        onCancel={() => setRevoke(null)}
        onConfirm={() => {
          notify(`Revoked: ${revoke}`);
          setRevoke(null);
        }}
        open={revoke !== null}
        title="Revoke access?"
      />
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
  skillsLayout: {
    gap: 16,
  },
  skillsLayoutWide: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  skillsFilters: {
    borderWidth: 1,
    flexShrink: 0,
  },
  skillsFiltersWide: {
    width: 224,
  },
  skillsFilterHeading: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  skillsFilterItems: {
    flexDirection: 'row',
    gap: 4,
    padding: 8,
  },
  skillsFilterItemsWide: {
    flexDirection: 'column',
  },
  skillFilterItem: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  skillFilterLabel: {
    flex: 1,
    minWidth: 0,
  },
  skillFilterText: {
    fontFamily: WEBUI_FONT_FAMILIES.MondwestRegular,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  skillsCategories: {
    borderTopWidth: 1,
    gap: 1,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  skillsCategoriesTitle: {
    paddingHorizontal: 4,
    paddingBottom: 4,
    paddingTop: 8,
  },
  skillCategoryItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 26,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  skillCategoryText: {
    fontSize: 11,
  },
  skillsContent: {
    flex: 1,
    minWidth: 0,
  },
  skillRows: {
    gap: 0,
  },
  skillRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  skillSwitch: {
    paddingTop: 2,
  },
  skillCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
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
});
