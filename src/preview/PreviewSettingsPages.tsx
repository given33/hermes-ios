import * as DocumentPicker from 'expo-document-picker';
import * as Linking from 'expo-linking';
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
  Eye,
  EyeOff,
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
import { Pressable, StyleSheet, View } from 'react-native';

import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { useTheme } from '../design/ThemeProvider';
import type { PreviewPageProps } from './PreviewCorePages';
import {
  PREVIEW_CONFIG_SECTIONS,
  PREVIEW_ENV_GROUPS,
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

export function SystemPreviewPage({ notify }: PreviewPageProps) {
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
      notify(`${name} preview completed`);
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
          <NativeButton onPress={() => setConsoleOpen(true)} outlined size="sm"><Terminal />Console</NativeButton>
          <NativeButton accessibilityLabel="Refresh system status" ghost onPress={() => notify('System status refreshed')} size="icon"><RefreshCw /></NativeButton>
        </PreviewRow>
      )}
      subtitle="Monitor the Hermes gateway, inspect resources, and run administrative actions."
      title="System"
    >
      {runningAction ? (
        <PreviewCard title={runningAction} subtitle="Frontend preview action in progress">
          <PreviewProgress value={68} />
          <PreviewText variant="mono">$ hermes {runningAction.toLowerCase().replaceAll(' ', '-')} --preview</PreviewText>
        </PreviewCard>
      ) : null}
      <PreviewGrid minItemWidth={170}>
        <PreviewMetric accent="#4ade80" icon={Server} label="Gateway" value="Running" hint="PID 18421" />
        <PreviewMetric icon={Cpu} label="CPU" value="18%" hint="8 cores" />
        <PreviewMetric icon={MemoryStick} label="Memory" value="2.4 GB" hint="of 16 GB" />
        <PreviewMetric icon={HardDrive} label="Disk" value="42%" hint="86 GB free" />
      </PreviewGrid>
      <PreviewGrid minItemWidth={320}>
        <PreviewCard title="Gateway" subtitle="Running on 0.0.0.0:8080">
          <PreviewDataRow label="Status" value={<PreviewBadge tone="success">RUNNING</PreviewBadge>} />
          <PreviewDataRow label="Version" mono value="0.9.3" />
          <PreviewDataRow label="Uptime" mono value="4d 7h 21m" />
          <PreviewDataRow label="Active sessions" mono value="2" />
          <PreviewRow>
            <NativeButton onPress={() => setConfirm('restart')} outlined><RotateCw />Restart gateway</NativeButton>
            <NativeButton onPress={() => setConfirm('update')}><CloudDownload />Update Hermes</NativeButton>
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
            <NativeButton destructive ghost onPress={() => setConfirm('memory')} size="sm"><Trash2 />Reset memory</NativeButton>
            <NativeButton ghost onPress={() => notify('Previewed checkpoint pruning')} size="sm"><Archive />Prune checkpoints</NativeButton>
          </PreviewRow>
        </PreviewCard>
        <PreviewCard title="Credentials" subtitle="Stored provider credentials available to Hermes.">
          <PreviewSettingRow detail="2 keys" label="Anthropic" trailing={<PreviewBadge tone="success">CONFIGURED</PreviewBadge>} />
          <PreviewSettingRow detail="1 key" label="OpenRouter" trailing={<PreviewBadge tone="success">CONFIGURED</PreviewBadge>} />
          <PreviewSettingRow detail="No credentials" label="OpenAI" trailing={<PreviewBadge tone="outline">EMPTY</PreviewBadge>} />
          <PreviewRow>
            <NativeButton onPress={() => setCredentialOpen(true)} outlined size="sm"><Plus />Add credential</NativeButton>
            <NativeButton accessibilityLabel="Remove credential" destructive ghost onPress={() => setConfirm('credential')} size="icon"><Trash2 /></NativeButton>
          </PreviewRow>
        </PreviewCard>
      </PreviewGrid>
      <PreviewGrid minItemWidth={320}>
        <PreviewCard title="Configuration transfer" subtitle="Export, import, or restore Hermes data.">
          <PreviewRow>
            <NativeButton onPress={() => notify('Configuration export prepared')} outlined><Download />Export</NativeButton>
            <NativeButton onPress={importConfig} outlined><Import />Import</NativeButton>
          </PreviewRow>
          <PreviewSettingRow detail="/var/backups/hermes-2026-07-14.tar.gz" label="Latest backup" />
        </PreviewCard>
        <PreviewCard title="Shell hooks" subtitle="Run a command when matching terminal events occur.">
          <PreviewSettingRow detail="terminal · 10s timeout" label="notify-complete.sh" trailing={<PreviewBadge tone="success">ACTIVE</PreviewBadge>} />
          <NativeButton onPress={() => setHookOpen(true)} outlined><Plus />Add hook</NativeButton>
        </PreviewCard>
      </PreviewGrid>
      <ConfirmDialog
        confirmLabel={confirm === 'update' ? 'Update' : confirm === 'restart' ? 'Restart' : 'Remove'}
        description={confirm === 'update'
          ? 'Hermes will update from the configured source and restart the gateway when complete.'
          : confirm === 'restart'
            ? 'Active tasks continue on the server where supported. The gateway will briefly disconnect.'
            : confirm === 'memory'
              ? 'This permanently removes the selected memory store and cannot be undone.'
              : 'This credential will no longer be available to Hermes.'}
        destructive={confirm === 'memory' || confirm === 'credential'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => runAction(confirm === 'update' ? 'Update Hermes' : confirm === 'restart' ? 'Restart Gateway' : confirm === 'memory' ? 'Reset Memory' : 'Remove Credential')}
        open={confirm !== null}
        title={confirm === 'update' ? 'Update Hermes?' : confirm === 'restart' ? 'Restart gateway?' : confirm === 'memory' ? 'Reset memory?' : 'Remove credential?'}
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
          notify('Shell hook staged locally');
          setHookOpen(false);
        }}>Add hook</NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

export function ProfilesPreviewPage({ navigate, notify }: PreviewPageProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [soulProfile, setSoulProfile] = useState<string | null>(null);
  return (
    <PreviewPage
      actions={<NativeButton onPress={() => navigate('/profiles/new')} size="sm"><Plus />New profile</NativeButton>}
      subtitle="Create specialized agents with scoped models, keys, memories, skills, and schedules."
      title="Profiles"
    >
      <PreviewGrid minItemWidth={300}>
        {PREVIEW_PROFILES.map((profile) => (
          <PreviewCard
            action={profile.active ? <PreviewBadge tone="success">DEFAULT</PreviewBadge> : null}
            key={profile.name}
            subtitle={profile.description}
            title={profile.name}
          >
            <PreviewDataRow label="Model" mono value={profile.model} />
            <PreviewDataRow label="Skills" mono value={String(profile.skills)} />
            <PreviewDataRow label="Environment" value={profile.env ? 'Configured' : 'Inherited'} />
            <PreviewRow>
              {!profile.active ? (
                <NativeButton onPress={() => notify(`Previewed active profile: ${profile.name}`)} outlined size="sm">Set active</NativeButton>
              ) : null}
              <NativeButton onPress={() => setSoulProfile(profile.name)} outlined size="sm"><Edit3 />SOUL.md</NativeButton>
              <NativeButton accessibilityLabel="Copy CLI command" ghost onPress={() => notify(`hermes --profile ${profile.name} copied`)} size="icon"><Copy /></NativeButton>
              {!profile.active ? (
                <NativeButton accessibilityLabel="Delete profile" destructive ghost onPress={() => setDeleteTarget(profile.name)} size="icon"><Trash2 /></NativeButton>
              ) : null}
            </PreviewRow>
          </PreviewCard>
        ))}
      </PreviewGrid>
      <PreviewModal onClose={() => setSoulProfile(null)} open={soulProfile !== null} title={`Edit ${soulProfile ?? ''} SOUL.md`}>
        <NativeInput
          multiline
          style={styles.soulInput}
          value="# iOS Native Agent\n\nYou preserve the customized Hermes WebUI contracts while using native iOS interaction patterns."
        />
        <NativeButton onPress={() => {
          notify(`${soulProfile} SOUL.md staged locally`);
          setSoulProfile(null);
        }}>Save SOUL</NativeButton>
      </PreviewModal>
      <ConfirmDialog
        description={`This permanently deletes '${deleteTarget ?? ''}', including configuration, keys, memories, sessions, skills, and cron jobs.`}
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          notify(`Previewed profile deletion: ${deleteTarget}`);
          setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        title="Delete profile?"
      />
    </PreviewPage>
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
      notify(`Profile '${name || 'untitled'}' preview completed`);
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
            <PreviewRow><NativeButton outlined><Plus />Add server</NativeButton></PreviewRow>
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

export function ConfigPreviewPage({ notify }: PreviewPageProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const [section, setSection] = useState('General');
  const [resetOpen, setResetOpen] = useState(false);
  const sections = PREVIEW_CONFIG_SECTIONS.filter((group) => (
    group.name.toLowerCase().includes(query.toLowerCase())
    || group.fields.some(([key, value]) => `${key} ${value}`.toLowerCase().includes(query.toLowerCase()))
  ));
  return (
    <PreviewPage
      actions={(
        <PreviewRow>
          <NativeButton accessibilityLabel="Export JSON" ghost onPress={() => notify('Config JSON export prepared')} size="icon"><Download /></NativeButton>
          <NativeButton accessibilityLabel="Import JSON" ghost onPress={() => notify('Config import picker opened')} size="icon"><Upload /></NativeButton>
          <NativeButton onPress={() => notify('Configuration staged locally')} size="sm"><Save />Save</NativeButton>
        </PreviewRow>
      )}
      subtitle="~/.hermes/config.yaml"
      title="Config"
    >
      <PreviewCard>
        <PreviewRow style={styles.toolbarBetween}>
          <PreviewSearch onChangeText={setQuery} placeholder="Search..." value={query} />
          <PreviewSegmented<'form' | 'yaml'>
            onChange={setMode}
            options={[{ label: 'Form', value: 'form' }, { label: 'YAML', value: 'yaml' }]}
            value={mode}
          />
        </PreviewRow>
      </PreviewCard>
      {mode === 'yaml' ? (
        <PreviewCard title="Raw YAML config">
          <NativeInput multiline style={styles.yamlInput} value={'default_model: anthropic/claude-sonnet-4\nmax_iterations: 50\ntimezone: Asia/Shanghai\n\nterminal:\n  shell: /bin/zsh\n  stream_output: true\n\nmemory:\n  provider: builtin\n  auto_compact_threshold: 0.82'} />
        </PreviewCard>
      ) : (
        <View style={styles.configLayout}>
          <PreviewCard style={styles.configSidebar} title="Sections">
            {PREVIEW_CONFIG_SECTIONS.map((group) => (
              <PreviewSettingRow key={group.name} label={group.name} onPress={() => setSection(group.name)} trailing={section === group.name ? <Check size={16} /> : undefined} />
            ))}
          </PreviewCard>
          <View style={styles.configMain}>
            {sections.filter((group) => query || group.name === section).map((group) => (
              <PreviewCard
                action={<NativeButton accessibilityLabel={`Reset ${group.name}`} ghost onPress={() => setResetOpen(true)} size="icon"><RotateCw /></NativeButton>}
                key={group.name}
                title={group.name}
              >
                {group.fields.map(([key, value]) => (
                  <View key={key} style={styles.fieldGroup}>
                    <PreviewText variant="label">{key.replaceAll('_', ' ')}</PreviewText>
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
        description="This restores every field in this section to its default. It remains local until Save is pressed."
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          notify(`${section} restored to defaults in preview`);
          setResetOpen(false);
        }}
        open={resetOpen}
        title="Restore defaults?"
      />
    </PreviewPage>
  );
}

export function EnvPreviewPage({ notify }: PreviewPageProps) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  return (
    <PreviewPage
      actions={<PreviewBadge tone="warning">SENSITIVE</PreviewBadge>}
      subtitle="Manage API keys and credentials stored in ~/.hermes/.env."
      title="Keys"
    >
      <PreviewCard>
        <PreviewSearch onChangeText={setQuery} placeholder="Search keys..." value={query} />
      </PreviewCard>
      {PREVIEW_ENV_GROUPS.map((group) => {
        const entries = group.entries.filter(([key]) => key.toLowerCase().includes(query.toLowerCase()));
        if (!entries.length) return null;
        return (
          <PreviewCard
            action={<PreviewBadge tone="outline">{entries.filter((entry) => entry[1]).length} SET</PreviewBadge>}
            key={group.name}
            title={group.name}
          >
            {entries.map(([key, isSet, preview]) => (
              <View key={key}>
                <View style={styles.envRow}>
                  <View style={styles.flexCopy}>
                    <PreviewText variant="mono">{key}</PreviewText>
                    <PreviewText variant="tiny">
                      {isSet ? (revealed[key] ? preview : preview.replace(/./g, '•')) : 'Not set'}
                    </PreviewText>
                  </View>
                  <PreviewBadge tone={isSet ? 'success' : 'outline'}>{isSet ? 'SET' : 'EMPTY'}</PreviewBadge>
                  {isSet ? (
                    <NativeButton accessibilityLabel={revealed[key] ? `Hide ${key}` : `Reveal ${key}`} ghost onPress={() => setRevealed((current) => ({ ...current, [key]: !current[key] }))} size="icon">
                      {revealed[key] ? <EyeOff /> : <Eye />}
                    </NativeButton>
                  ) : null}
                  <NativeButton onPress={() => setEditing(key)} outlined size="sm">{isSet ? 'Replace' : 'Set'}</NativeButton>
                  {isSet ? <NativeButton accessibilityLabel={`Clear ${key}`} destructive ghost onPress={() => setClearTarget(key)} size="icon"><Trash2 /></NativeButton> : null}
                </View>
                <PreviewDivider />
              </View>
            ))}
          </PreviewCard>
        );
      })}
      <PreviewCard title="Custom keys" subtitle="Inject environment variables for skills, MCP servers, or custom tools.">
        <NativeButton onPress={() => setEditing('CUSTOM_KEY')} outlined><Plus />Add custom key</NativeButton>
      </PreviewCard>
      <PreviewModal onClose={() => setEditing(null)} open={editing !== null} title={`${editing?.startsWith('CUSTOM') ? 'Add custom key' : 'Set key'}`}>
        {editing?.startsWith('CUSTOM') ? <NativeInput placeholder="MY_SERVICE_API_KEY" /> : <PreviewText variant="mono">{editing}</PreviewText>}
        <NativeInput placeholder="Enter value..." secureTextEntry />
        <NativeButton onPress={() => {
          notify(`${editing} staged locally`);
          setEditing(null);
        }}>Save</NativeButton>
      </PreviewModal>
      <ConfirmDialog
        description="The stored value will be removed from the .env file. This cannot be undone from the interface."
        destructive
        onCancel={() => setClearTarget(null)}
        onConfirm={() => {
          notify(`Previewed key removal: ${clearTarget}`);
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
      actions={<NativeButton onPress={() => Linking.openURL(docsUrl)} size="sm"><ExternalLink />Open documentation</NativeButton>}
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
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    minHeight: 58,
  },
  flexCopy: {
    flex: 1,
    minWidth: 160,
  },
});
