import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import {
  Activity,
  Archive,
  Bot,
  Check,
  ChevronDown,
  CircleGauge,
  Clipboard,
  CloudDownload,
  Code2,
  Copy,
  Cpu,
  Database,
  Download,
  Edit3,
  ExternalLink,
  FileJson,
  Gauge,
  HardDrive,
  Import,
  KeyRound,
  MemoryStick,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActionSheetIOS, Platform, StyleSheet, View } from 'react-native';

import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { IOSContextMenu } from '../components/ios/IOSContextMenu';
import { IOSPressable } from '../components/ios/IOSPressable';
import { IOSSwipeActions } from '../components/ios/IOSSwipeActions';
import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { useTheme } from '../design/ThemeProvider';
import type { PreviewPageProps } from './PreviewCorePages';
import {
  PREVIEW_CONFIG_SECTIONS,
  PREVIEW_PROFILES,
} from './preview-fixtures';
import {
  PreviewBadge,
  PreviewCard,
  PreviewDataRow,
  PreviewDivider,
  PreviewGrid,
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
} from './PreviewPrimitives';

type SystemConfirm = 'restart' | 'update' | 'memory' | 'credential' | null;

export function SystemPreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const isChinese = locale === 'zh';
  const [confirm, setConfirm] = useState<SystemConfirm>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [hookOpen, setHookOpen] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [credentialProvider, setCredentialProvider] = useState('');
  const runAction = (name: string) => {
    setConfirm(null);
    setRunningAction(name);
    setTimeout(() => {
      setRunningAction(null);
      notify(`${name} completed`);
    }, 900);
  };
  const importConfig = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'application/yaml', 'text/yaml'] });
    if (!result.canceled) notify(`Import preview: ${result.assets[0]?.name ?? 'file'}`);
  };
  return (
    <PreviewPage
      actions={(
        <PreviewRow>
          <NativeButton onPress={() => setConsoleOpen(true)} outlined prefix={<Terminal />} size="sm">{isChinese ? '控制台' : 'Console'}</NativeButton>
          <NativeButton accessibilityLabel={isChinese ? '刷新系统状态' : 'Refresh system status'} ghost onPress={() => notify(isChinese ? '系统状态已刷新' : 'System status refreshed')} size="icon"><RefreshCw /></NativeButton>
        </PreviewRow>
      )}
      subtitle={isChinese ? '监控 Hermes 网关、查看资源并执行管理操作。' : 'Monitor the Hermes gateway, inspect resources, and run administrative actions.'}
      title={isChinese ? '系统监控' : 'System'}
    >
      {runningAction ? (
        <PreviewCard title={runningAction} subtitle={isChinese ? '管理操作正在进行' : 'Administrative action in progress'}>
          <PreviewProgress value={68} />
          <PreviewText variant="mono">$ hermes {runningAction.toLowerCase().replaceAll(' ', '-')} --preview</PreviewText>
        </PreviewCard>
      ) : null}
      <PreviewGrid minItemWidth={170}>
        <PreviewMetric accent="#4ade80" icon={Server} label={isChinese ? '网关' : 'Gateway'} value={isChinese ? '运行中' : 'Running'} hint="PID 18421" />
        <PreviewMetric icon={Cpu} label="CPU" value="18%" hint={isChinese ? '8 核' : '8 cores'} />
        <PreviewMetric icon={MemoryStick} label={isChinese ? '内存' : 'Memory'} value="2.4 GB" hint={isChinese ? '共 16 GB' : 'of 16 GB'} />
        <PreviewMetric icon={HardDrive} label={isChinese ? '磁盘' : 'Disk'} value="42%" hint={isChinese ? '剩余 86 GB' : '86 GB free'} />
      </PreviewGrid>
      <PreviewGrid minItemWidth={320}>
        <PreviewCard title={isChinese ? '网关' : 'Gateway'} subtitle={isChinese ? '正在 0.0.0.0:8080 上运行' : 'Running on 0.0.0.0:8080'}>
          <PreviewDataRow label={isChinese ? '状态' : 'Status'} value={<PreviewBadge tone="success">{isChinese ? '运行中' : 'RUNNING'}</PreviewBadge>} />
          <PreviewDataRow label={isChinese ? '版本' : 'Version'} mono value="0.9.3" />
          <PreviewDataRow label={isChinese ? '运行时间' : 'Uptime'} mono value="4d 7h 21m" />
          <PreviewDataRow label={isChinese ? '活跃会话' : 'Active sessions'} mono value="2" />
          <PreviewRow>
            <NativeButton onPress={() => setConfirm('restart')} outlined prefix={<RotateCw />}>{isChinese ? '重启网关' : 'Restart gateway'}</NativeButton>
            <NativeButton onPress={() => setConfirm('update')} prefix={<CloudDownload />}>{isChinese ? '更新 Hermes' : 'Update Hermes'}</NativeButton>
          </PreviewRow>
        </PreviewCard>
        <PreviewCard title="Runtime" subtitle="Python and operating system details">
          <PreviewDataRow label="Platform" mono value="Linux 6.8.0" />
          <PreviewDataRow label="Python" mono value="3.11.9" />
          <PreviewDataRow label="Node" mono value="22.17.0" />
          <PreviewDataRow label="Hermes home" mono value="/home/hermes/.hermes" />
          <PreviewDataRow label="Database" mono value="SQLite · healthy" />
        </PreviewCard>
      </PreviewGrid>
      <PreviewGrid minItemWidth={320}>
        <PreviewCard title="Memory" subtitle="Inspect and reset memory stores and checkpoints.">
          <PreviewDataRow label="User memories" mono value="1,284" />
          <PreviewDataRow label="Agent memories" mono value="438" />
          <PreviewDataRow label="Checkpoints" mono value="92" />
          <PreviewRow>
            <NativeButton destructive ghost onPress={() => setConfirm('memory')} prefix={<Trash2 />} size="sm">Reset memory</NativeButton>
            <NativeButton ghost onPress={() => notify('Checkpoint pruning started')} prefix={<Archive />} size="sm">Prune checkpoints</NativeButton>
          </PreviewRow>
        </PreviewCard>
        <PreviewCard title="Credentials" subtitle="Stored provider credentials available to Hermes.">
          <PreviewSettingRow detail="2 keys" label="Anthropic" trailing={<PreviewBadge tone="success">CONFIGURED</PreviewBadge>} />
          <PreviewSettingRow detail="1 key" label="OpenRouter" trailing={<PreviewBadge tone="success">CONFIGURED</PreviewBadge>} />
          <PreviewSettingRow detail="No credentials" label="OpenAI" trailing={<PreviewBadge tone="outline">EMPTY</PreviewBadge>} />
          <PreviewRow>
            <NativeButton onPress={() => setCredentialOpen(true)} outlined prefix={<Plus />} size="sm">Add credential</NativeButton>
            <NativeButton accessibilityLabel="Remove credential" destructive ghost onPress={() => setConfirm('credential')} size="icon"><Trash2 /></NativeButton>
          </PreviewRow>
        </PreviewCard>
      </PreviewGrid>
      <PreviewGrid minItemWidth={320}>
        <PreviewCard title="Configuration transfer" subtitle="Export, import, or restore Hermes data.">
          <PreviewRow>
            <NativeButton onPress={() => notify('Configuration export prepared')} outlined prefix={<Download />}>Export</NativeButton>
            <NativeButton onPress={importConfig} outlined prefix={<Import />}>Import</NativeButton>
          </PreviewRow>
          <PreviewSettingRow detail="/var/backups/hermes-2026-07-14.tar.gz" label="Latest backup" />
        </PreviewCard>
        <PreviewCard title="Shell hooks" subtitle="Run a command when matching terminal events occur.">
          <PreviewSettingRow detail="terminal · 10s timeout" label="notify-complete.sh" trailing={<PreviewBadge tone="success">ACTIVE</PreviewBadge>} />
          <NativeButton onPress={() => setHookOpen(true)} outlined prefix={<Plus />}>Add hook</NativeButton>
        </PreviewCard>
      </PreviewGrid>
      <ConfirmDialog
        cancelLabel={isChinese ? '取消' : 'Cancel'}
        confirmLabel={confirm === 'update'
          ? isChinese ? '立即更新' : 'Update now'
          : confirm === 'restart'
            ? isChinese ? '重启网关' : 'Restart gateway'
            : isChinese ? '移除' : 'Remove'}
        description={confirm === 'update'
          ? isChinese ? 'Hermes 将从已配置的来源更新，并在完成后重启网关。' : 'Hermes will update from the configured source and restart the gateway when complete.'
          : confirm === 'restart'
            ? isChinese ? '支持的活跃任务会继续在服务器运行，网关会短暂断开。' : 'Active tasks continue on the server where supported. The gateway will briefly disconnect.'
            : confirm === 'memory'
              ? isChinese ? '这会永久移除所选记忆存储，且无法撤销。' : 'This permanently removes the selected memory store and cannot be undone.'
              : isChinese ? 'Hermes 将无法再使用此凭据。' : 'This credential will no longer be available to Hermes.'}
        destructive={confirm === 'memory' || confirm === 'credential'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => runAction(confirm === 'update' ? 'Update Hermes' : confirm === 'restart' ? 'Restart Gateway' : confirm === 'memory' ? 'Reset Memory' : 'Remove Credential')}
        open={confirm !== null}
        title={confirm === 'update'
          ? isChinese ? '更新 Hermes？' : 'Update Hermes?'
          : confirm === 'restart'
            ? isChinese ? '重启网关？' : 'Restart gateway?'
            : confirm === 'memory'
              ? isChinese ? '重置记忆？' : 'Reset memory?'
              : isChinese ? '移除凭据？' : 'Remove credential?'}
      />
      <PreviewModal onClose={() => setConsoleOpen(false)} open={consoleOpen} title="Hermes console">
        <View style={styles.console}>
          <PreviewText color="#4ade80" variant="mono">Hermes Agent 0.9.3</PreviewText>
          <PreviewText variant="mono">gateway: running (pid 18421)</PreviewText>
          <PreviewText variant="mono">profiles: default, ios-native, researcher</PreviewText>
          <PreviewText variant="mono">$ _</PreviewText>
        </View>
      </PreviewModal>
      <PreviewModal onClose={() => setCredentialOpen(false)} open={credentialOpen} title="Add credential">
        <NativeInput onChangeText={setCredentialProvider} placeholder="Provider (e.g. openrouter)" value={credentialProvider} />
        <NativeInput placeholder="API key" secureTextEntry />
        <NativeInput placeholder="Label (optional)" />
        <NativeButton disabled={!credentialProvider.trim()} onPress={() => {
          notify(`Credential form completed for ${credentialProvider}`);
          setCredentialOpen(false);
          setCredentialProvider('');
        }}>Save credential</NativeButton>
      </PreviewModal>
      <PreviewModal onClose={() => setHookOpen(false)} open={hookOpen} title="Add shell hook">
        <NativeInput placeholder="/usr/local/bin/my-hook.sh" />
        <NativeInput placeholder="Matcher, e.g. terminal" />
        <NativeInput placeholder="Timeout in seconds" value="10" />
        <NativeButton onPress={() => {
          notify('Shell hook added');
          setHookOpen(false);
        }}>Add hook</NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

export function ProfilesPreviewPage({ navigate, notify }: PreviewPageProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [soulProfile, setSoulProfile] = useState<string | null>(null);
  const [actionsProfile, setActionsProfile] = useState<
    (typeof PREVIEW_PROFILES)[number] | null
  >(null);
  const setActive = (profile: (typeof PREVIEW_PROFILES)[number]) => {
    notify(`Active profile: ${profile.name}`);
  };
  const editSoul = (profile: (typeof PREVIEW_PROFILES)[number]) => {
    setSoulProfile(profile.name);
  };
  const copyCommand = (profile: (typeof PREVIEW_PROFILES)[number]) => {
    notify(`hermes --profile ${profile.name} copied`);
  };
  const openProfileActions = (profile: (typeof PREVIEW_PROFILES)[number]) => {
    if (Platform.OS !== 'ios') {
      setActionsProfile(profile);
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: 4,
        destructiveButtonIndex: 3,
        options: ['Set active', 'Edit SOUL.md', 'Copy command', 'Delete profile', 'Cancel'],
        title: profile.name,
      },
      (index) => {
        if (index === 0) setActive(profile);
        if (index === 1) editSoul(profile);
        if (index === 2) copyCommand(profile);
        if (index === 3) setDeleteTarget(profile.name);
      },
    );
  };
  return (
    <PreviewPage
      actions={<NativeButton onPress={() => navigate('/profiles/new')} prefix={<Plus />} size="sm">New profile</NativeButton>}
      subtitle="Create specialized agents with scoped models, keys, memories, skills, and schedules."
      title="Profiles"
    >
      <PreviewGrid minItemWidth={300}>
        {PREVIEW_PROFILES.map((profile) => (
          <IOSSwipeActions
            actions={[
              {
                icon: 'pencil',
                id: 'edit',
                label: 'Edit',
                onPress: () => editSoul(profile),
              },
              {
                destructive: true,
                icon: 'trash',
                id: 'delete',
                label: 'Delete',
                onPress: () => setDeleteTarget(profile.name),
              },
            ]}
            containerStyle={styles.swipeContainer}
            key={profile.name}
          >
          <IOSContextMenu
            actions={[
              {
                id: 'active',
                onPress: () => setActive(profile),
                systemImage: 'checkmark.circle',
                title: 'Set active',
              },
              {
                id: 'soul',
                onPress: () => editSoul(profile),
                systemImage: 'pencil',
                title: 'Edit SOUL.md',
              },
              {
                id: 'copy',
                onPress: () => copyCommand(profile),
                systemImage: 'doc.on.doc',
                title: 'Copy command',
              },
              {
                destructive: true,
                id: 'delete',
                onPress: () => setDeleteTarget(profile.name),
                systemImage: 'trash',
                title: 'Delete profile',
              },
            ]}
          >
          <PreviewCard
            action={(
              <PreviewRow style={styles.profileHeaderActions}>
                {profile.active ? <PreviewBadge tone="success">DEFAULT</PreviewBadge> : null}
                <NativeButton
                  accessibilityLabel="Profile actions"
                  ghost
                  onPress={() => openProfileActions(profile)}
                  size="icon"
                >
                  <MoreHorizontal />
                </NativeButton>
              </PreviewRow>
            )}
            subtitle={profile.description}
            title={profile.name}
          >
            <PreviewDataRow label="Model" mono value={profile.model} />
            <PreviewDataRow label="Skills" mono value={String(profile.skills)} />
            <PreviewDataRow label="Environment" value={profile.env ? 'Configured' : 'Inherited'} />
          </PreviewCard>
          </IOSContextMenu>
          </IOSSwipeActions>
        ))}
      </PreviewGrid>
      <ProfileActionsSheet
        onClose={() => setActionsProfile(null)}
        onCopy={() => {
          notify(`hermes --profile ${actionsProfile?.name} copied`);
          setActionsProfile(null);
        }}
        onDelete={() => {
          setDeleteTarget(actionsProfile?.name ?? null);
          setActionsProfile(null);
        }}
        onEditSoul={() => {
          setSoulProfile(actionsProfile?.name ?? null);
          setActionsProfile(null);
        }}
        onSetActive={() => {
          notify(`Active profile: ${actionsProfile?.name}`);
          setActionsProfile(null);
        }}
        profile={actionsProfile}
      />
      <PreviewModal onClose={() => setSoulProfile(null)} open={soulProfile !== null} title={`Edit ${soulProfile ?? ''} SOUL.md`}>
        <NativeInput
          multiline
          style={styles.soulInput}
          value="# iOS Native Agent\n\nYou preserve the customized Hermes WebUI contracts while using native iOS interaction patterns."
        />
        <NativeButton onPress={() => {
          notify(`${soulProfile} SOUL.md saved`);
          setSoulProfile(null);
        }}>Save SOUL</NativeButton>
      </PreviewModal>
      <ConfirmDialog
        description={`This permanently deletes '${deleteTarget ?? ''}', including configuration, keys, memories, sessions, skills, and cron jobs.`}
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          notify(`Deleted profile: ${deleteTarget}`);
          setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        title="Delete profile?"
      />
    </PreviewPage>
  );
}

function ProfileActionsSheet({
  onClose,
  onCopy,
  onDelete,
  onEditSoul,
  onSetActive,
  profile,
}: {
  onClose(): void;
  onCopy(): void;
  onDelete(): void;
  onEditSoul(): void;
  onSetActive(): void;
  profile: (typeof PREVIEW_PROFILES)[number] | null;
}) {
  return (
    <PreviewModal
      onClose={onClose}
      open={profile !== null}
      title={`${profile?.name ?? ''} actions`}
    >
      {!profile?.active ? (
        <ProfileActionItem
          icon={Check}
          label="Set active"
          onPress={onSetActive}
        />
      ) : null}
      <ProfileActionItem
        icon={Edit3}
        label="SOUL.md"
        onPress={onEditSoul}
      />
      <ProfileActionItem
        icon={Copy}
        label="Copy CLI command"
        onPress={onCopy}
      />
      {!profile?.active ? (
        <ProfileActionItem
          destructive
          icon={Trash2}
          label="Delete profile"
          onPress={onDelete}
        />
      ) : null}
    </PreviewModal>
  );
}

function ProfileActionItem({
  destructive = false,
  icon: Icon,
  label,
  onPress,
}: {
  destructive?: boolean;
  icon: typeof Check;
  label: string;
  onPress(): void;
}) {
  const { tokens } = useTheme();
  const color = destructive ? tokens.colors.destructive : tokens.colors.foreground;
  return (
    <IOSPressable
      accessibilityRole="button"
      onPress={onPress}
      pressedStyle={{ backgroundColor: tokens.colors.muted }}
      style={[
        styles.profileActionItem,
        { borderBottomColor: tokens.colors.border },
      ]}
    >
      <Icon color={color} size={17} />
      <PreviewText color={color} variant="label">{label}</PreviewText>
    </IOSPressable>
  );
}

export function ProfileBuilderPreviewPage({ navigate, notify }: PreviewPageProps) {
  const [step, setStep] = useState<'identity' | 'model' | 'skills' | 'mcp'>('identity');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('anthropic/claude-sonnet-4');
  const [skills, setSkills] = useState<Record<string, boolean>>({
    'github-code-review': true,
    'frontend-design': true,
    'deep-research': false,
  });
  const next = () => {
    const order: typeof step[] = ['identity', 'model', 'skills', 'mcp'];
    const index = order.indexOf(step);
    if (index < order.length - 1) setStep(order[index + 1]!);
    else {
      notify(`Profile '${name || 'untitled'}' created`);
      navigate('/profiles');
    }
  };
  return (
    <PreviewPage
      actions={<NativeButton ghost onPress={() => navigate('/profiles')} size="sm">Cancel</NativeButton>}
      subtitle="Build a profile with its own identity, model, skills, and MCP servers."
      title="New profile"
    >
      <PreviewSegmented<'identity' | 'model' | 'skills' | 'mcp'>
        onChange={setStep}
        options={[
          { label: 'Identity', value: 'identity' },
          { label: 'Model', value: 'model' },
          { label: 'Skills', value: 'skills' },
          { label: 'MCP', value: 'mcp' },
        ]}
        value={step}
      />
      <PreviewCard title={step === 'identity' ? 'Profile identity' : step === 'model' ? 'Default model' : step === 'skills' ? 'Skills' : 'MCP servers'}>
        {step === 'identity' ? (
          <>
            <PreviewText variant="label">Name</PreviewText>
            <NativeInput onChangeText={setName} placeholder="coder" value={name} />
            <PreviewText variant="label">Description</PreviewText>
            <NativeInput multiline onChangeText={setDescription} placeholder="What this agent profile is for" value={description} />
          </>
        ) : step === 'model' ? (
          <>
            {['anthropic/claude-sonnet-4', 'openrouter/qwen3-235b-a22b', 'nous/hermes-4-405b'].map((option) => (
              <PreviewSettingRow
                key={option}
                label={option}
                onPress={() => setModel(option)}
                trailing={model === option ? <Check size={17} /> : undefined}
              />
            ))}
          </>
        ) : step === 'skills' ? (
          <>
            {Object.entries(skills).map(([skill, value]) => (
              <PreviewSettingRow
                key={skill}
                label={skill}
                trailing={<PreviewToggle accessibilityLabel={`Enable ${skill}`} onChange={(enabled) => setSkills((current) => ({ ...current, [skill]: enabled }))} value={value} />}
              />
            ))}
          </>
        ) : (
          <>
            <NativeInput placeholder="Server name" />
            <NativeInput placeholder="URL (https://.../mcp)" />
            <PreviewRow><NativeButton outlined prefix={<Plus />}>Add server</NativeButton></PreviewRow>
          </>
        )}
        <PreviewRow style={styles.builderFooter}>
          <NativeButton disabled={step === 'identity'} ghost onPress={() => {
            const order: typeof step[] = ['identity', 'model', 'skills', 'mcp'];
            setStep(order[Math.max(0, order.indexOf(step) - 1)]!);
          }}>Back</NativeButton>
          <NativeButton disabled={step === 'identity' && !name.trim()} onPress={next}>
            {step === 'mcp' ? 'Create profile' : 'Continue'}
          </NativeButton>
        </PreviewRow>
      </PreviewCard>
    </PreviewPage>
  );
}

export function ConfigPreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const isChinese = locale === 'zh';
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const [section, setSection] = useState('General');
  const [resetOpen, setResetOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const sections = PREVIEW_CONFIG_SECTIONS.filter((group) => (
    `${group.name} ${isChinese ? configSectionZh(group.name) : ''}`
      .toLowerCase()
      .includes(normalizedQuery)
    || group.fields.some(([key, value]) => (
      `${key} ${value} ${isChinese ? configFieldZh(key) : ''}`
        .toLowerCase()
        .includes(normalizedQuery)
    ))
  ));
  const exportConfig = async () => {
    const file = new File(Paths.cache, 'hermes-config-preview.json');
    file.write(JSON.stringify({
      generatedAt: new Date().toISOString(),
      sections: PREVIEW_CONFIG_SECTIONS,
    }, null, 2));
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        dialogTitle: isChinese ? '导出 Hermes 配置' : 'Export Hermes config',
        mimeType: 'application/json',
        UTI: 'public.json',
      });
    }
    notify(isChinese ? '配置 JSON 已导出' : 'Config JSON exported');
  };
  const importConfigFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: ['application/json', 'application/yaml', 'text/yaml'],
    });
    if (!result.canceled) {
      notify(isChinese
        ? `已选择配置：${result.assets[0]?.name ?? '文件'}`
        : `Selected config: ${result.assets[0]?.name ?? 'file'}`);
    }
  };
  return (
    <PreviewPage
      actions={(
        <PreviewRow>
          <NativeButton accessibilityLabel={isChinese ? '导出 JSON' : 'Export JSON'} ghost haptic="light" onPress={() => void exportConfig()} size="icon"><Download /></NativeButton>
          <NativeButton accessibilityLabel={isChinese ? '导入 JSON' : 'Import JSON'} ghost haptic="light" onPress={() => void importConfigFile()} size="icon"><Upload /></NativeButton>
          <NativeButton onPress={() => notify(isChinese ? '配置已保存' : 'Configuration saved')} prefix={<Save />} size="sm">{isChinese ? '保存' : 'Save'}</NativeButton>
        </PreviewRow>
      )}
      subtitle="~/.hermes/config.yaml"
      title={isChinese ? '配置' : 'Config'}
    >
      <PreviewCard>
        <PreviewRow style={styles.toolbarBetween}>
          <PreviewSearch onChangeText={setQuery} placeholder={isChinese ? '搜索...' : 'Search...'} value={query} />
          <PreviewSegmented<'form' | 'yaml'>
            onChange={setMode}
            options={[{ label: isChinese ? '表单' : 'Form', value: 'form' }, { label: 'YAML', value: 'yaml' }]}
            value={mode}
          />
        </PreviewRow>
      </PreviewCard>
      {mode === 'yaml' ? (
        <PreviewCard title={isChinese ? '原始 YAML 配置' : 'Raw YAML config'}>
          <NativeInput multiline style={styles.yamlInput} value={'default_model: anthropic/claude-sonnet-4\nmax_iterations: 50\ntimezone: Asia/Shanghai\n\nterminal:\n  shell: /bin/zsh\n  stream_output: true\n\nmemory:\n  provider: builtin\n  auto_compact_threshold: 0.82'} />
        </PreviewCard>
      ) : (
        <View style={styles.configLayout}>
          <PreviewCard style={styles.configSidebar} title={isChinese ? '分类' : 'Sections'}>
            {PREVIEW_CONFIG_SECTIONS.map((group) => (
              <PreviewSettingRow key={group.name} label={isChinese ? configSectionZh(group.name) : group.name} onPress={() => setSection(group.name)} trailing={section === group.name ? <Check size={16} /> : undefined} />
            ))}
          </PreviewCard>
          <View style={styles.configMain}>
            {sections.filter((group) => query || group.name === section).map((group) => (
              <PreviewCard
                action={<NativeButton accessibilityLabel={isChinese ? `将${configSectionZh(group.name)}恢复为默认值` : `Reset ${group.name}`} ghost onPress={() => setResetOpen(true)} size="icon"><RotateCw /></NativeButton>}
                key={group.name}
                title={isChinese ? configSectionZh(group.name) : group.name}
              >
                {group.fields.map(([key, value]) => (
                  <View key={key} style={styles.fieldGroup}>
                    <PreviewText variant="label">
                      {isChinese ? configFieldZh(key) : key.replaceAll('_', ' ')}
                    </PreviewText>
                    {value === 'true' ? (
                      <PreviewToggle accessibilityLabel={key} onChange={() => {}} value />
                    ) : (
                      <NativeInput value={value} />
                    )}
                  </View>
                ))}
              </PreviewCard>
            ))}
          </View>
        </View>
      )}
      <ConfirmDialog
        cancelLabel={isChinese ? '取消' : 'Cancel'}
        confirmLabel={isChinese ? '恢复默认值' : 'Restore defaults'}
        description={isChinese
          ? `确定要将${configSectionZh(section)}的所有设置恢复为默认值吗？此操作仅更新表单，在按下「保存」按钮前不会写入 config.yaml。`
          : 'This restores every field in this section to its default. It remains local until Save is pressed.'}
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          notify(isChinese ? `${configSectionZh(section)}已恢复默认值` : `${section} restored to defaults`);
          setResetOpen(false);
        }}
        open={resetOpen}
        title={isChinese ? '恢复默认值？' : 'Restore defaults?'}
      />
    </PreviewPage>
  );
}

function configSectionZh(section: string): string {
  return ({ General: '通用', Memory: '记忆', Terminal: '终端' } as Record<string, string>)[section]
    ?? section;
}

function configFieldZh(field: string): string {
  return ({
    auto_compact_threshold: '自动压缩阈值',
    context_engine: '上下文引擎',
    default_model: '默认模型',
    max_iterations: '最大迭代次数',
    provider: '提供商',
    shell: 'Shell',
    stream_output: '流式输出',
    terminal_font_size: '终端字体大小',
    timezone: '时区',
  } as Record<string, string>)[field] ?? field.replaceAll('_', ' ');
}

const PREVIEW_MODEL_CREDENTIALS = [{
  id: 'custom-main',
  key: 'custom · model-a',
  maskedValue: 'sk-••••••••',
}] as const;

export function EnvPreviewPage({ notify }: PreviewPageProps) {
  const { tokens } = useTheme();
  const [credentials, setCredentials] = useState<ReadonlyArray<{
    id: string;
    key: string;
    maskedValue: string;
  }>>(PREVIEW_MODEL_CREDENTIALS);
  const [clearTarget, setClearTarget] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const visibleCredentials = credentials.filter(({ key }) => (
    key.toLowerCase().includes(query.toLowerCase())
  ));
  return (
    <PreviewPage
      actions={<PreviewBadge tone="warning">SENSITIVE</PreviewBadge>}
      subtitle="Credentials saved by the custom model editor."
      title="Keys"
    >
      <PreviewCard>
        <PreviewSearch onChangeText={setQuery} placeholder="Search keys..." value={query} />
      </PreviewCard>
      <PreviewCard
        action={<PreviewBadge tone="outline">{visibleCredentials.length} SET</PreviewBadge>}
        title="Model credentials"
      >
        {visibleCredentials.map((credential) => (
          <IOSSwipeActions
            actions={[{
              destructive: true,
              icon: 'trash',
              id: 'clear',
              label: 'Clear',
              onPress: () => setClearTarget(credential.id),
            }]}
            key={credential.id}
          >
              <View>
                <View style={styles.envRow}>
                  <View style={styles.envKeyHeader}>
                    <PreviewText style={styles.flexCopy} variant="mono">{credential.key}</PreviewText>
                    <PreviewBadge tone="success">SET</PreviewBadge>
                  </View>
                  <View style={styles.envValueRow}>
                    <View
                      style={[
                        styles.envValue,
                        { borderColor: tokens.colors.border },
                      ]}
                    >
                      <PreviewText numberOfLines={1} variant="tiny">
                        {credential.maskedValue}
                      </PreviewText>
                    </View>
                    <NativeButton
                      destructive
                      onPress={() => setClearTarget(credential.id)}
                      outlined
                      prefix={<Trash2 />}
                      size="sm"
                    >
                      Clear
                    </NativeButton>
                  </View>
                </View>
                <PreviewDivider />
              </View>
          </IOSSwipeActions>
        ))}
      </PreviewCard>
      <ConfirmDialog
        description="The stored model credential will be removed."
        destructive
        onCancel={() => setClearTarget(null)}
        onConfirm={() => {
          setCredentials((current) => current.filter(({ id }) => id !== clearTarget));
          notify(`Removed model credential: ${clearTarget}`);
          setClearTarget(null);
        }}
        open={clearTarget !== null}
        title="Clear this key?"
      />
    </PreviewPage>
  );
}

export function DocsPreviewPage() {
  const docsUrl = 'https://hermes-agent.nousresearch.com/docs/';
  return (
    <PreviewPage
      actions={<NativeButton onPress={() => Linking.openURL(docsUrl)} prefix={<ExternalLink />} size="sm">Open documentation</NativeButton>}
      subtitle="The official Hermes Agent documentation opens in the system browser."
      title="Documentation"
    >
      <PreviewGrid minItemWidth={260}>
        <PreviewCard title="Getting started" subtitle="Install, configure, and run Hermes Agent.">
          <PreviewSettingRow label="Installation" onPress={() => Linking.openURL(docsUrl)} />
          <PreviewSettingRow label="Configuration" onPress={() => Linking.openURL(docsUrl)} />
          <PreviewSettingRow label="Profiles" onPress={() => Linking.openURL(docsUrl)} />
        </PreviewCard>
        <PreviewCard title="Capabilities" subtitle="Learn the agent, tools, memory, and automation model.">
          <PreviewSettingRow label="Skills and toolsets" onPress={() => Linking.openURL(docsUrl)} />
          <PreviewSettingRow label="Cron and webhooks" onPress={() => Linking.openURL(docsUrl)} />
          <PreviewSettingRow label="Messaging channels" onPress={() => Linking.openURL(docsUrl)} />
        </PreviewCard>
        <PreviewCard title="Operations" subtitle="Deploy, secure, monitor, and update Hermes.">
          <PreviewSettingRow label="Gateway" onPress={() => Linking.openURL(docsUrl)} />
          <PreviewSettingRow label="Security" onPress={() => Linking.openURL(docsUrl)} />
          <PreviewSettingRow label="Troubleshooting" onPress={() => Linking.openURL(docsUrl)} />
        </PreviewCard>
      </PreviewGrid>
    </PreviewPage>
  );
}

const styles = StyleSheet.create({
  swipeContainer: {
    borderRadius: 4,
  },
  console: {
    backgroundColor: '#000000',
    gap: 8,
    minHeight: 260,
    padding: 14,
  },
  soulInput: {
    minHeight: 240,
    textAlignVertical: 'top',
  },
  builderFooter: {
    justifyContent: 'space-between',
    marginTop: 12,
  },
  toolbarBetween: {
    justifyContent: 'space-between',
  },
  yamlInput: {
    minHeight: 360,
    textAlignVertical: 'top',
  },
  configLayout: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  configSidebar: {
    flexGrow: 1,
    maxWidth: 260,
    minWidth: 210,
  },
  configMain: {
    flex: 4,
    gap: 12,
    minWidth: 280,
  },
  fieldGroup: {
    gap: 6,
  },
  envRow: {
    gap: 8,
    minHeight: 76,
    paddingVertical: 8,
  },
  envKeyHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minWidth: 0,
  },
  envValueRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    width: '100%',
  },
  envValue: {
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 30,
    minWidth: 88,
    paddingHorizontal: 10,
  },
  flexCopy: {
    flex: 1,
    minWidth: 0,
  },
  profileHeaderActions: {
    flexWrap: 'nowrap',
    gap: 3,
  },
  profileActionItem: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 46,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
});
