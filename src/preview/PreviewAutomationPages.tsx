import {
  Activity,
  Bot,
  Boxes,
  CheckCircle2,
  Clock,
  Cloud,
  Code2,
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
  Play,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  Save,
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
import { Pressable, StyleSheet, View } from 'react-native';

import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
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
  const [states, setStates] = useState<Record<string, boolean>>(() => (
    Object.fromEntries(PREVIEW_CRON.map((job) => [job.id, job.enabled]))
  ));
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  return (
    <PreviewPage
      actions={(
        <NativeButton onPress={() => setCreateOpen(true)} size="sm">
          <Plus />
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
          <PreviewCard
            action={<PreviewToggle accessibilityLabel={`Enable ${job.name}`} onChange={(value) => setStates((current) => ({ ...current, [job.id]: value }))} value={states[job.id] ?? false} />}
            key={job.id}
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
            <PreviewRow style={styles.rightActions}>
              <NativeButton onPress={() => notify(`Previewed run: ${job.name}`)} outlined size="sm">
                <Play />
                Trigger now
              </NativeButton>
              <NativeButton accessibilityLabel="Delete job" destructive ghost onPress={() => setDeleteTarget(job.name)} size="icon">
                <Trash2 />
              </NativeButton>
            </PreviewRow>
          </PreviewCard>
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
        <NativeInput placeholder="09:00" value="09:00" />
        <PreviewSettingRow detail="Telegram" label="Deliver to" />
        <NativeButton
          disabled={!prompt.trim()}
          onPress={() => {
            notify(`Previewed cron creation: ${name || 'Untitled job'}`);
            setCreateOpen(false);
            setName('');
            setPrompt('');
          }}
        >
          Create
        </NativeButton>
      </PreviewModal>
      <ConfirmDialog
        description="This removes the job from the schedule. No server data changes in frontend preview mode."
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          notify(`Previewed cron deletion: ${deleteTarget}`);
          setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        title="Delete cron job?"
      />
    </PreviewPage>
  );
}

export function SkillsPreviewPage({ navigate, notify }: PreviewPageProps) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'skills' | 'toolsets'>('skills');
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => (
    Object.fromEntries(PREVIEW_SKILLS.map((skill) => [skill.name, skill.enabled]))
  ));
  const filtered = PREVIEW_SKILLS.filter((skill) => (
    `${skill.name} ${skill.category} ${skill.description}`.toLowerCase().includes(query.toLowerCase())
  ));
  return (
    <PreviewPage
      actions={<PreviewBadge tone="success">{Object.values(enabled).filter(Boolean).length}/{PREVIEW_SKILLS.length} ENABLED</PreviewBadge>}
      subtitle="Browse installed skills and configure CLI toolsets for the selected profile."
      title="Skills"
    >
      <PreviewCard>
        <PreviewRow style={styles.toolbarBetween}>
          <PreviewSearch onChangeText={setQuery} placeholder="Search skills and toolsets..." value={query} />
          <PreviewSegmented<'skills' | 'toolsets'>
            onChange={setTab}
            options={[
              { label: 'Skills', value: 'skills' },
              { label: 'Toolsets', value: 'toolsets' },
            ]}
            value={tab}
          />
        </PreviewRow>
      </PreviewCard>
      {tab === 'skills' ? (
        <PreviewGrid minItemWidth={290}>
          {filtered.map((skill) => (
            <PreviewCard
              action={<PreviewToggle accessibilityLabel={`Enable ${skill.name}`} onChange={(value) => setEnabled((current) => ({ ...current, [skill.name]: value }))} value={enabled[skill.name] ?? false} />}
              key={skill.name}
              subtitle={skill.category}
              title={skill.name}
            >
              <PreviewText variant="muted">{skill.description}</PreviewText>
              <PreviewRow>
                <PreviewBadge tone={enabled[skill.name] ? 'success' : 'outline'}>
                  {enabled[skill.name] ? 'ACTIVE' : 'INACTIVE'}
                </PreviewBadge>
                <NativeButton onPress={() => notify(`Opened ${skill.name}/SKILL.md`)} outlined size="sm">
                  <Code2 />
                  Edit
                </NativeButton>
              </PreviewRow>
            </PreviewCard>
          ))}
        </PreviewGrid>
      ) : (
        <PreviewGrid minItemWidth={300}>
          {PREVIEW_TOOLSETS.map((toolset) => (
            <PreviewCard
              action={<PreviewBadge tone={toolset.setup ? 'warning' : toolset.active ? 'success' : 'outline'}>{toolset.setup ? 'SETUP NEEDED' : toolset.active ? 'ACTIVE' : 'INACTIVE'}</PreviewBadge>}
              key={toolset.name}
              subtitle={toolset.detail}
              title={`${toolset.name} Toolset`}
            >
              <PreviewSettingRow detail="Provider and environment configuration" label="Configure" />
              <NativeButton onPress={() => notify(`Opened ${toolset.name} toolset settings`)} outlined>
                <Settings2 />
                Configure
              </NativeButton>
            </PreviewCard>
          ))}
        </PreviewGrid>
      )}
      <PreviewCard
        action={<NativeButton onPress={() => navigate('/chat')} size="sm"><Sparkles />Learn in chat</NativeButton>}
        subtitle="Point Hermes at a directory, documentation URL, or workflow description."
        title="Learn a skill"
      >
        <NativeInput placeholder="~/projects/some-sdk" />
        <NativeInput placeholder="https://docs.example.com/api" />
        <NativeInput multiline placeholder="Describe how the workflow should be performed..." />
      </PreviewCard>
    </PreviewPage>
  );
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
          <NativeButton onPress={() => notify('Provider settings staged locally')}>
            <Save />
            Save providers
          </NativeButton>
        </PreviewCard>
        <PreviewCard title="Install from GitHub / Git URL" subtitle="Use owner/repo shorthand or a complete clone URL.">
          <NativeInput onChangeText={setIdentifier} placeholder="owner/repo or https://..." value={identifier} />
          <PreviewSettingRow label="Force reinstall" trailing={<PreviewToggle accessibilityLabel="Force reinstall" onChange={() => {}} value={false} />} />
          <PreviewSettingRow label="Enable after install" trailing={<PreviewToggle accessibilityLabel="Enable after install" onChange={() => {}} value />} />
          <NativeButton disabled={!identifier.trim()} onPress={() => notify(`Previewed install: ${identifier}`)}>
            <Download />
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
                <NativeButton onPress={() => navigate('/achievements')} outlined size="sm">Open tab</NativeButton>
              ) : plugin.name === 'kanban' ? (
                <NativeButton onPress={() => navigate('/kanban')} outlined size="sm">Open tab</NativeButton>
              ) : null}
              <NativeButton onPress={() => notify(`Previewed git pull: ${plugin.name}`)} outlined size="sm">
                <RefreshCw />
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
      actions={<NativeButton onPress={() => setAddOpen(true)} size="sm"><Plus />Add server</NativeButton>}
      subtitle="Manage Model Context Protocol servers and inspect available tools."
      title="MCP"
    >
      <PreviewGrid minItemWidth={290}>
        {PREVIEW_MCP.map((server) => (
          <PreviewCard
            action={<PreviewToggle accessibilityLabel={`Enable ${server.name}`} onChange={() => {}} value={server.active} />}
            key={server.name}
            subtitle={server.transport.toUpperCase()}
            title={server.name}
          >
            <PreviewText numberOfLines={2} variant="mono">{server.endpoint}</PreviewText>
            <PreviewRow>
              <PreviewBadge tone={server.active ? 'success' : 'outline'}>{server.active ? 'CONNECTED' : 'DISABLED'}</PreviewBadge>
              <PreviewBadge tone="outline">{server.tools} TOOLS</PreviewBadge>
            </PreviewRow>
            <PreviewRow>
              <NativeButton onPress={() => notify(`Tested ${server.name}: ${server.tools} tools`)} outlined size="sm">
                <Zap />Test
              </NativeButton>
              <NativeButton accessibilityLabel="Remove server" destructive ghost onPress={() => notify(`Previewed removal: ${server.name}`)} size="icon">
                <Trash2 />
              </NativeButton>
            </PreviewRow>
          </PreviewCard>
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
          notify(`Previewed MCP server: ${name}`);
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
            <NativeButton onPress={() => setSelected(channel)} outlined>
              <Settings2 />
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
          notify(`${selected?.name} settings staged locally`);
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
      actions={<NativeButton onPress={() => setCreateOpen(true)} size="sm"><Plus />New webhook</NativeButton>}
      subtitle="Receive external events and route them into Hermes prompts and channels."
      title="Webhooks"
    >
      <PreviewCard title="Receiver">
        <PreviewSettingRow detail="https://hermes.example.com/api/webhooks/v1" label="Endpoint" trailing={<NativeButton accessibilityLabel="Copy endpoint" ghost onPress={() => notify('Webhook endpoint copied')} size="icon"><Copy /></NativeButton>} />
        <PreviewSettingRow detail="Requests require the configured bearer secret" label="Authentication" trailing={<PreviewBadge tone="success">ENABLED</PreviewBadge>} />
      </PreviewCard>
      <PreviewGrid minItemWidth={300}>
        {PREVIEW_WEBHOOKS.map((hook) => (
          <PreviewCard
            action={<PreviewToggle accessibilityLabel={`Enable ${hook.name}`} onChange={() => {}} value={hook.active} />}
            key={hook.name}
            subtitle={hook.description}
            title={hook.name}
          >
            <PreviewBadge tone="outline">{hook.events}</PreviewBadge>
            <PreviewDataRow label="Deliveries" mono value={String(hook.deliveries)} />
            <PreviewRow>
              <NativeButton onPress={() => notify(`Copied URL for ${hook.name}`)} outlined size="sm"><Copy />Copy</NativeButton>
              <NativeButton accessibilityLabel="Delete webhook" destructive ghost onPress={() => notify(`Previewed deletion: ${hook.name}`)} size="icon"><Trash2 /></NativeButton>
            </PreviewRow>
          </PreviewCard>
        ))}
      </PreviewGrid>
      <PreviewModal onClose={() => setCreateOpen(false)} open={createOpen} title="New webhook">
        <NativeInput onChangeText={setName} placeholder="e.g. github-push" value={name} />
        <NativeInput placeholder="What this webhook does (optional)" />
        <NativeInput placeholder="push, pull_request" />
        <NativeInput multiline placeholder="Instructions for the agent when this webhook fires" />
        <PreviewSettingRow label="Deliver only" trailing={<PreviewToggle accessibilityLabel="Deliver only" onChange={() => {}} value={false} />} />
        <NativeButton disabled={!name.trim()} onPress={() => {
          notify(`Previewed webhook creation: ${name}`);
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
      actions={<NativeButton onPress={() => notify('New pairing code generated')} size="sm"><Plus />Pair device</NativeButton>}
      subtitle="Review authorized devices and revoke access to this Hermes server."
      title="Pairing"
    >
      <PreviewCard title="Pair a new device" subtitle="Scan from another Hermes client or enter the code manually.">
        <View style={styles.pairingCode}>
          <PreviewText style={styles.codeText} variant="mono">HERMES-842-661</PreviewText>
        </View>
        <PreviewRow>
          <PreviewBadge tone="warning">EXPIRES IN 09:42</PreviewBadge>
          <NativeButton onPress={() => notify('Pairing code copied')} outlined size="sm"><Copy />Copy code</NativeButton>
        </PreviewRow>
      </PreviewCard>
      <PreviewCard title="Authorized devices">
        {PREVIEW_PAIRINGS.map((device) => (
          <View key={device.name}>
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
        ))}
      </PreviewCard>
      <ConfirmDialog
        description="This device will need a new pairing code before it can connect again."
        destructive
        onCancel={() => setRevoke(null)}
        onConfirm={() => {
          notify(`Previewed revoke: ${revoke}`);
          setRevoke(null);
        }}
        open={revoke !== null}
        title="Revoke access?"
      />
    </PreviewPage>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 12,
  },
  rightActions: {
    justifyContent: 'flex-end',
  },
  toolbarBetween: {
    justifyContent: 'space-between',
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
