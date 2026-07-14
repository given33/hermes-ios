import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  Activity,
  Bot,
  Camera,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Download,
  File,
  FileText,
  Folder,
  FolderPlus,
  Image,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
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
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { multiplyAlpha } from '../design/control-contracts';
import { useTheme } from '../design/ThemeProvider';
import {
  PREVIEW_FILES,
  PREVIEW_LOGS,
  PREVIEW_MESSAGES,
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
} from './PreviewPrimitives';

export interface PreviewPageProps {
  navigate(path: string): void;
  notify(message: string): void;
}

export function ChatPreviewPage({ notify }: PreviewPageProps) {
  const { width } = useWindowDimensions();
  const { tokens } = useTheme();
  const [draft, setDraft] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [reasoning, setReasoning] = useState<'low' | 'medium' | 'high'>('medium');
  const modelPanel = (
    <View style={styles.modelPanelContent}>
      <PreviewText variant="label">Model</PreviewText>
      <PreviewSettingRow
        detail="Anthropic · 200K context"
        label="claude-sonnet-4"
        trailing={<ChevronDown color={tokens.colors.textSecondary} size={16} />}
      />
      <PreviewDivider />
      <PreviewText variant="label">Reasoning effort</PreviewText>
      <PreviewSegmented<'low' | 'medium' | 'high'>
        onChange={setReasoning}
        options={[
          { label: 'Low', value: 'low' },
          { label: 'Medium', value: 'medium' },
          { label: 'High', value: 'high' },
        ]}
        value={reasoning}
      />
      <PreviewDivider />
      <PreviewText variant="label">Enabled tools</PreviewText>
      {['Web Search', 'Terminal', 'File tools', 'Browser'].map((tool) => (
        <PreviewSettingRow
          key={tool}
          label={tool}
          trailing={<Check color={tokens.colors.success} size={16} />}
        />
      ))}
      <PreviewDivider />
      <PreviewDataRow label="Context" mono value="42.6K / 200K" />
      <PreviewProgress value={21.3} />
    </View>
  );

  const pickPhoto = async (camera: boolean) => {
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) notify(`${result.assets.length} image ready for preview`);
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true });
    if (!result.canceled) notify(`${result.assets.length} file ready for preview`);
  };

  return (
    <View style={styles.chatRoot}>
      <View style={styles.chatMain}>
        <View
          style={[
            styles.chatHeader,
            { borderBottomColor: tokens.colors.border },
          ]}
        >
          <View style={styles.chatTitle}>
            <PreviewText numberOfLines={1} variant="heading">
              iOS native migration plan
            </PreviewText>
            <PreviewRow>
              <PreviewBadge tone="success">CONNECTED</PreviewBadge>
              <PreviewText variant="tiny">default</PreviewText>
            </PreviewRow>
          </View>
          {width < 900 ? (
            <NativeButton
              accessibilityLabel="Model and tools"
              ghost
              onPress={() => setToolsOpen(true)}
              size="icon"
            >
              <SlidersHorizontal />
            </NativeButton>
          ) : null}
        </View>

        <ScrollView
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.messageScroll}
        >
          {PREVIEW_MESSAGES.map((message, index) => {
            const isUser = message.role === 'user';
            const isTool = message.role === 'tool';
            const Icon = isUser ? User : isTool ? Wrench : Bot;
            return (
              <View
                key={`${message.time}-${index}`}
                style={[
                  styles.message,
                  {
                    backgroundColor: isUser
                      ? tokens.colors.secondary
                      : isTool
                        ? multiplyAlpha(tokens.colors.warning, 0.06)
                        : 'transparent',
                    borderColor: tokens.colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: tokens.colors.muted },
                  ]}
                >
                  <Icon
                    color={isTool ? tokens.colors.warning : tokens.colors.foreground}
                    size={15}
                  />
                </View>
                <View style={styles.messageCopy}>
                  <PreviewRow style={styles.messageMeta}>
                    <PreviewText variant="label">
                      {isUser ? 'You' : isTool ? 'Tool' : 'Hermes'}
                    </PreviewText>
                    <PreviewText variant="tiny">{message.time}</PreviewText>
                  </PreviewRow>
                  <PreviewText variant={isTool ? 'mono' : 'body'}>
                    {message.content}
                  </PreviewText>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View
          style={[
            styles.composer,
            {
              backgroundColor: tokens.colors.card,
              borderColor: tokens.colors.border,
            },
          ]}
        >
          <TextInput
            multiline
            onChangeText={setDraft}
            placeholder="Message Hermes..."
            placeholderTextColor={tokens.colors.textTertiary}
            style={[
              styles.composerInput,
              { color: tokens.colors.foreground },
            ]}
            value={draft}
          />
          <View style={styles.composerToolbar}>
            <PreviewRow>
              <NativeButton accessibilityLabel="Attach file" ghost onPress={pickFile} size="icon">
                <Paperclip />
              </NativeButton>
              <NativeButton accessibilityLabel="Photo library" ghost onPress={() => pickPhoto(false)} size="icon">
                <Image />
              </NativeButton>
              <NativeButton accessibilityLabel="Camera" ghost onPress={() => pickPhoto(true)} size="icon">
                <Camera />
              </NativeButton>
            </PreviewRow>
            <NativeButton
              accessibilityLabel="Send"
              disabled={!draft.trim()}
              onPress={() => {
                notify('Preview message staged locally');
                setDraft('');
              }}
              size="icon"
            >
              <Send />
            </NativeButton>
          </View>
        </View>
      </View>
      {width >= 900 ? (
        <View style={[styles.modelPanel, { borderLeftColor: tokens.colors.border }]}> 
          {modelPanel}
        </View>
      ) : null}
      <PreviewModal onClose={() => setToolsOpen(false)} open={toolsOpen} title="Model & Tools">
        {modelPanel}
      </PreviewModal>
    </View>
  );
}

export function SessionsPreviewPage({ navigate, notify }: PreviewPageProps) {
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const filtered = PREVIEW_SESSIONS.filter((session) => (
    `${session.title} ${session.preview} ${session.model}`
      .toLowerCase()
      .includes(query.toLowerCase())
  ));
  return (
    <PreviewPage
      actions={(
        <NativeButton onPress={() => navigate('/chat')} size="sm">
          <Plus />
          New chat
        </NativeButton>
      )}
      subtitle="Browse, search, resume, rename, export, and remove Hermes sessions."
      title="Sessions"
    >
      <PreviewCard>
        <PreviewSearch
          onChangeText={setQuery}
          placeholder="Search message content..."
          value={query}
        />
      </PreviewCard>
      <View style={styles.sessionList}>
        {filtered.map((session) => (
          <PreviewCard key={session.id}>
            <View style={styles.sessionRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => navigate('/chat')}
                style={styles.sessionMain}
              >
                <View style={styles.sessionTitleRow}>
                  <PreviewText numberOfLines={1} variant="heading">
                    {session.title}
                  </PreviewText>
                  {session.active ? <PreviewBadge tone="success">LIVE</PreviewBadge> : null}
                </View>
                <PreviewText numberOfLines={2} variant="muted">
                  {session.preview}
                </PreviewText>
                <PreviewRow>
                  <PreviewBadge tone="outline">{session.model.split('/').pop()}</PreviewBadge>
                  <PreviewText variant="tiny">{session.messages} msgs</PreviewText>
                  <PreviewText variant="tiny">{session.tools} tools</PreviewText>
                  <PreviewText variant="tiny">{session.updated}</PreviewText>
                </PreviewRow>
              </Pressable>
              <PreviewRow>
                <NativeButton accessibilityLabel="Resume in chat" ghost onPress={() => navigate('/chat')} size="icon">
                  <Play />
                </NativeButton>
                <NativeButton accessibilityLabel="Export session" ghost onPress={() => notify('Session export prepared')} size="icon">
                  <Download />
                </NativeButton>
                <NativeButton accessibilityLabel="Delete session" destructive ghost onPress={() => setDeleteTarget(session.title)} size="icon">
                  <Trash2 />
                </NativeButton>
              </PreviewRow>
            </View>
          </PreviewCard>
        ))}
      </View>
      <ConfirmDialog
        description="This permanently removes the conversation and all of its messages. This preview does not write to the server."
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          notify(`Previewed deletion: ${deleteTarget}`);
          setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        title="Delete session?"
      />
    </PreviewPage>
  );
}

export function FilesPreviewPage({ notify }: PreviewPageProps) {
  const [path, setPath] = useState('~/.hermes');
  const [folderModal, setFolderModal] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true });
    if (!result.canceled) notify(`${result.assets.length} file selected`);
  };
  return (
    <PreviewPage
      actions={(
        <PreviewRow>
          <NativeButton onPress={pickFiles} outlined size="sm">
            <Upload />
            Upload
          </NativeButton>
          <NativeButton onPress={() => setFolderModal(true)} size="sm">
            <FolderPlus />
            New folder
          </NativeButton>
        </PreviewRow>
      )}
      subtitle="Browse the Hermes home directory, preview attachments, and manage files."
      title="Files"
    >
      <PreviewCard>
        <PreviewRow>
          <NativeInput onChangeText={setPath} style={styles.flexInput} value={path} />
          <NativeButton accessibilityLabel="Open path" onPress={() => notify(`Opened ${path}`)} size="icon">
            <ChevronDown />
          </NativeButton>
          <NativeButton accessibilityLabel="Refresh files" ghost onPress={() => notify('Files refreshed')} size="icon">
            <RefreshCw />
          </NativeButton>
        </PreviewRow>
      </PreviewCard>
      <PreviewCard>
        <View style={styles.fileHeader}>
          <PreviewText style={styles.fileName} variant="label">Name</PreviewText>
          <PreviewText style={styles.fileMeta} variant="label">Size</PreviewText>
          <PreviewText style={styles.fileMeta} variant="label">Modified</PreviewText>
          <View style={styles.fileActions} />
        </View>
        {PREVIEW_FILES.map((entry) => {
          const Icon = entry.kind === 'folder' ? Folder : File;
          return (
            <View key={entry.name} style={styles.fileRow}>
              <Pressable
                onPress={() => entry.kind === 'folder'
                  ? setPath(`${path}/${entry.name}`)
                  : notify(`Previewing ${entry.name}`)}
                style={styles.fileNameCell}
              >
                <Icon color={tokensForFile(entry.kind)} size={18} />
                <PreviewText numberOfLines={1} style={styles.fileName} variant="mono">
                  {entry.name}
                </PreviewText>
              </Pressable>
              <PreviewText style={styles.fileMeta} variant="tiny">{entry.size}</PreviewText>
              <PreviewText style={styles.fileMeta} variant="tiny">{entry.modified}</PreviewText>
              <View style={styles.fileActions}>
                {entry.kind === 'file' ? (
                  <NativeButton accessibilityLabel={`Download ${entry.name}`} ghost onPress={() => notify(`Download prepared: ${entry.name}`)} size="icon">
                    <Download />
                  </NativeButton>
                ) : null}
                <NativeButton accessibilityLabel={`Delete ${entry.name}`} destructive ghost onPress={() => notify(`Previewed deletion: ${entry.name}`)} size="icon">
                  <Trash2 />
                </NativeButton>
              </View>
            </View>
          );
        })}
      </PreviewCard>
      <PreviewModal onClose={() => setFolderModal(false)} open={folderModal} title="New folder">
        <NativeInput onChangeText={setNewFolder} placeholder="Folder name" value={newFolder} />
        <NativeButton
          disabled={!newFolder.trim()}
          onPress={() => {
            notify(`Previewed folder creation: ${newFolder}`);
            setFolderModal(false);
            setNewFolder('');
          }}
        >
          Create
        </NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

function tokensForFile(kind: string): string {
  return kind === 'folder' ? '#ffbd38' : '#ffe6cb';
}

export function AnalyticsPreviewPage({ notify }: PreviewPageProps) {
  const [days, setDays] = useState<'7' | '30' | '90'>('7');
  return (
    <PreviewPage
      actions={(
        <NativeButton accessibilityLabel="Refresh analytics" ghost onPress={() => notify('Analytics refreshed')} size="icon">
          <RefreshCw />
        </NativeButton>
      )}
      subtitle="Token usage, model activity, and skill engagement from Hermes sessions."
      title="Analytics"
    >
      <PreviewSegmented<'7' | '30' | '90'>
        onChange={setDays}
        options={[
          { label: '7 days', value: '7' },
          { label: '30 days', value: '30' },
          { label: '90 days', value: '90' },
        ]}
        value={days}
      />
      <PreviewGrid minItemWidth={170}>
        <PreviewMetric icon={Activity} label="Total tokens" value="3.41M" />
        <PreviewMetric accent="#ffe6cb" icon={Upload} label="Input" value="2.97M" />
        <PreviewMetric accent="#34d399" icon={Download} label="Output" value="441K" />
        <PreviewMetric icon={MessageSquare} label="Sessions" value="184" />
      </PreviewGrid>
      <PreviewCard title="Daily token usage">
        <PreviewBarChart values={PREVIEW_TOKEN_DAYS} />
        <PreviewRow>
          <PreviewBadge tone="outline">INPUT 2.97M</PreviewBadge>
          <PreviewBadge tone="success">OUTPUT 441K</PreviewBadge>
        </PreviewRow>
      </PreviewCard>
      <PreviewGrid minItemWidth={300}>
        <PreviewCard title="Per-model breakdown">
          <PreviewDataRow label="claude-sonnet-4" mono value="2.07M" />
          <PreviewDataRow label="qwen3-235b-a22b" mono value="1.01M" />
          <PreviewDataRow label="hermes-4-405b" mono value="493K" />
        </PreviewCard>
        <PreviewCard title="Top skills">
          <PreviewDataRow label="github-code-review" mono value="48 loads" />
          <PreviewDataRow label="deep-research" mono value="31 loads" />
          <PreviewDataRow label="frontend-design" mono value="24 loads" />
        </PreviewCard>
      </PreviewGrid>
    </PreviewPage>
  );
}

export function ModelsPreviewPage({ notify }: PreviewPageProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <PreviewPage
      actions={(
        <NativeButton onPress={() => setSettingsOpen(true)} outlined size="sm">
          <Settings2 />
          Model settings
        </NativeButton>
      )}
      subtitle="Configure default and auxiliary models, inspect capabilities, and compare usage."
      title="Models"
    >
      <PreviewGrid minItemWidth={180}>
        <PreviewMetric icon={Bot} label="Models used" value="3" />
        <PreviewMetric icon={CircleDollarSign} label="Estimated cost" value="$28.42" />
        <PreviewMetric icon={Activity} label="API calls" value="314" />
        <PreviewMetric icon={Wrench} label="Tool calls" value="1,082" />
      </PreviewGrid>
      <PreviewCard title="Model usage">
        <PreviewLineChart points={[18, 31, 24, 52, 43, 67, 54, 79, 62, 91]} />
      </PreviewCard>
      <PreviewGrid minItemWidth={300}>
        {PREVIEW_MODELS.map((model) => (
          <PreviewCard
            action={model.selected ? <PreviewBadge tone="success">DEFAULT</PreviewBadge> : null}
            key={model.model}
            subtitle={model.provider}
            title={model.model}
          >
            <PreviewDataRow label="Context window" mono value={model.context} />
            <PreviewDataRow label="Input tokens" mono value={model.input} />
            <PreviewDataRow label="Output tokens" mono value={model.output} />
            <PreviewDataRow label="API calls" mono value={String(model.calls)} />
            <PreviewRow>
              <PreviewBadge tone="outline">TOOLS</PreviewBadge>
              <PreviewBadge tone="outline">VISION</PreviewBadge>
              <PreviewBadge tone="outline">REASONING</PreviewBadge>
            </PreviewRow>
          </PreviewCard>
        ))}
      </PreviewGrid>
      <PreviewModal onClose={() => setSettingsOpen(false)} open={settingsOpen} title="Model settings">
        <PreviewSettingRow detail="Used for new conversations" label="Default model" trailing={<PreviewBadge>claude-sonnet-4</PreviewBadge>} />
        <PreviewSettingRow detail="Session titles and summaries" label="Smart title" trailing={<PreviewBadge>default</PreviewBadge>} />
        <PreviewSettingRow detail="Skill search" label="Skills Hub" trailing={<PreviewBadge>qwen3-235b</PreviewBadge>} />
        <PreviewSettingRow detail="Automatic profile descriptions" label="Profile Describer" trailing={<PreviewBadge>default</PreviewBadge>} />
        <NativeButton onPress={() => {
          notify('Model settings staged locally');
          setSettingsOpen(false);
        }}>
          Save
        </NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

export function LogsPreviewPage({ notify }: PreviewPageProps) {
  const [live, setLive] = useState(true);
  const [level, setLevel] = useState<'all' | 'info' | 'warn'>('all');
  const visible = PREVIEW_LOGS.filter((row) => (
    level === 'all' || row[1].toLowerCase() === level
  ));
  return (
    <PreviewPage
      actions={(
        <PreviewRow>
          <PreviewSettingRow
            label="Auto refresh"
            trailing={<PreviewToggle accessibilityLabel="Auto refresh logs" onChange={setLive} value={live} />}
          />
          <NativeButton accessibilityLabel="Refresh logs" ghost onPress={() => notify('Logs refreshed')} size="icon">
            <RefreshCw />
          </NativeButton>
        </PreviewRow>
      )}
      subtitle="Inspect gateway, agent, tool, scheduler, and plugin output."
      title="Logs"
    >
      <PreviewCard>
        <PreviewRow>
          <PreviewSegmented<'all' | 'info' | 'warn'>
            onChange={setLevel}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Info', value: 'info' },
              { label: 'Warn', value: 'warn' },
            ]}
            value={level}
          />
          <PreviewBadge tone={live ? 'success' : 'outline'}>{live ? 'LIVE' : 'PAUSED'}</PreviewBadge>
          <PreviewBadge tone="outline">hermes.log</PreviewBadge>
          <PreviewBadge tone="outline">500 lines</PreviewBadge>
        </PreviewRow>
      </PreviewCard>
      <PreviewCard title="hermes.log">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.logLines}>
            {visible.map((row, index) => (
              <View key={`${row[0]}-${index}`} style={styles.logRow}>
                <PreviewText style={styles.logTime} variant="mono">{row[0]}</PreviewText>
                <PreviewBadge tone={row[1] === 'WARN' ? 'warning' : 'outline'}>
                  {row[1]}
                </PreviewBadge>
                <PreviewText style={styles.logComponent} variant="mono">{row[2]}</PreviewText>
                <PreviewText style={styles.logMessage} variant="mono">{row[3]}</PreviewText>
              </View>
            ))}
          </View>
        </ScrollView>
      </PreviewCard>
    </PreviewPage>
  );
}

const styles = StyleSheet.create({
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
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chatTitle: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  messageScroll: {
    flex: 1,
  },
  messageList: {
    gap: 10,
    padding: 16,
  },
  message: {
    alignSelf: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    maxWidth: 840,
    padding: 12,
    width: '100%',
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  messageCopy: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  messageMeta: {
    justifyContent: 'space-between',
  },
  composer: {
    alignSelf: 'center',
    borderWidth: 1,
    marginBottom: 12,
    maxWidth: 840,
    minHeight: 112,
  },
  composerInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 54,
    paddingHorizontal: 12,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  composerToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 6,
  },
  modelPanel: {
    borderLeftWidth: 1,
    width: 300,
  },
  modelPanelContent: {
    gap: 10,
    padding: 16,
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
  flexInput: {
    flex: 1,
    minWidth: 160,
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
  logRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 36,
  },
  logTime: {
    width: 112,
  },
  logComponent: {
    width: 90,
  },
  logMessage: {
    minWidth: 420,
  },
});
