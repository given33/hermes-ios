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
import { useMemo, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { IOSContextMenu } from '../components/ios/IOSContextMenu';
import { IOSActionSheet } from '../components/ios/IOSActionSheet';
import { IOSPressable } from '../components/ios/IOSPressable';
import { IOSSwipeActions } from '../components/ios/IOSSwipeActions';
import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { multiplyAlpha } from '../design/control-contracts';
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
} from './PreviewPrimitives';

export interface PreviewPageProps {
  locale?: 'en' | 'zh';
  navigate(path: string): void;
  notify(message: string): void;
}

export function ChatPreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const { width } = useWindowDimensions();
  const { tokens } = useTheme();
  const [draft, setDraft] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachmentCount, setAttachmentCount] = useState(0);
  const [model, setModel] = useState('claude-sonnet-4');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [reasoning, setReasoning] = useState<'low' | 'medium' | 'high'>('medium');
  const isChinese = locale === 'zh';
  const terminalFontSize = terminalFontSizeForWidth(width - 24);
  const terminalLineHeight = terminalFontSize * (width < 1024 ? 1.02 : 1.15);
  const terminalFont = 'HermesTerminal-JetBrainsMono-400-Normal';
  const terminalBold = 'HermesTerminal-JetBrainsMono-700-Normal';
  const terminalBackground = tokens.terminal.background;
  const terminalForeground = tokens.terminal.foreground;
  const terminalMuted = terminalForeground.startsWith('#')
    ? `${terminalForeground}99`
    : terminalForeground;
  const openModelPicker = () => {
    if (Platform.OS !== 'ios') {
      notify(isChinese ? '模型选择仅在 iOS 可用' : 'Model selection is available on iOS');
      return;
    }
    setModelPickerOpen(true);
  };
  const modelPanel = (
    <View style={styles.modelPanelContent}>
      <NativeButton
        contentStyle={styles.fullWidthButton}
        onPress={() => notify(isChinese ? '已新建对话' : 'New chat created')}
        outlined
        prefix={<MessageSquarePlus />}
        style={styles.fullWidthPressable}
      >
        {isChinese ? '新建对话' : 'New chat'}
      </NativeButton>
      <PreviewCard style={styles.chatSideCard}>
        <View style={styles.chatSideRow}>
          <View style={styles.chatSideCopy}>
            <PreviewText variant="label">{isChinese ? '模型' : 'Model'}</PreviewText>
            <IOSPressable haptic="selection" onPress={openModelPicker} style={styles.modelPickerRow}>
              <PreviewText numberOfLines={1} style={styles.chatSideCopy}>{model}</PreviewText>
              <ChevronDown color={tokens.colors.textSecondary} size={14} />
            </IOSPressable>
          </View>
          <PreviewBadge tone="success">{isChinese ? '在线' : 'LIVE'}</PreviewBadge>
        </View>
      </PreviewCard>
      <PreviewCard style={styles.chatSideCard}>
        <View style={styles.chatSideRow}>
          <View style={styles.chatSideCopy}>
            <PreviewText variant="label">{isChinese ? '工具事件流' : 'Tool events'}</PreviewText>
            <PreviewText numberOfLines={1} variant="tiny">
              {isChinese ? '等待下一次工具调用' : 'Waiting for the next tool call'}
            </PreviewText>
          </View>
          <PreviewBadge tone="success">{isChinese ? '在线' : 'LIVE'}</PreviewBadge>
        </View>
      </PreviewCard>
      <PreviewCard style={styles.chatSideCard} title={isChinese ? '推理强度' : 'Reasoning effort'}>
        <PreviewSegmented<'low' | 'medium' | 'high'>
          onChange={setReasoning}
          options={[
            { label: isChinese ? '低' : 'Low', value: 'low' },
            { label: isChinese ? '中' : 'Medium', value: 'medium' },
            { label: isChinese ? '高' : 'High', value: 'high' },
          ]}
          value={reasoning}
        />
      </PreviewCard>
    </View>
  );

  const pickPhoto = async (camera: boolean) => {
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) {
      setAttachmentCount((count) => count + result.assets.length);
      setAttachmentsOpen(false);
      notify(isChinese ? `已选择 ${result.assets.length} 张图片` : `${result.assets.length} image selected`);
    }
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true });
    if (!result.canceled) {
      setAttachmentCount((count) => count + result.assets.length);
      setAttachmentsOpen(false);
      notify(isChinese ? `已选择 ${result.assets.length} 个文件` : `${result.assets.length} file selected`);
    }
  };

  const sendPreview = () => {
    if (!draft.trim() && attachmentCount === 0) return;
    notify(isChinese ? '消息已发送' : 'Message sent');
    setDraft('');
    setAttachmentCount(0);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
      style={styles.chatRoot}
    >
      <View style={styles.chatMain}>
        <View
          style={[
            styles.chatHeader,
            { borderBottomColor: tokens.colors.border },
          ]}
        >
          <PreviewText
            numberOfLines={1}
            style={{ fontFamily: WEBUI_FONT_FAMILIES.RulesExpandedBold }}
            variant="heading"
          >
            {isChinese ? '单聊' : 'Chat'}
          </PreviewText>
          {width < 1024 ? (
            <IOSPressable
              accessibilityLabel={isChinese ? '打开模型与工具' : 'Open model and tools'}
              onPress={() => setToolsOpen(true)}
              pressedStyle={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.05) }}
              style={[
                styles.modelToolsButton,
                {
                  backgroundColor: 'transparent',
                  borderColor: multiplyAlpha(tokens.colors.foreground, 0.2),
                },
              ]}
            >
              <PanelRight color={tokens.colors.textSecondary} size={13} />
              <PreviewText variant="tiny">
                {isChinese ? '模型与工具' : 'Model & tools'}
              </PreviewText>
            </IOSPressable>
          ) : null}
        </View>
        <View
          style={[
            styles.terminalWindow,
            {
              backgroundColor: terminalBackground,
              shadowColor: '#000000',
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.terminalTranscript}
            decelerationRate="normal"
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={8}
            showsVerticalScrollIndicator
            style={styles.terminalScroll}
          >
            <TerminalLine bold color={terminalForeground} fontFamily={terminalBold} fontSize={terminalFontSize} lineHeight={terminalLineHeight}>
              {'⚕  HERMES AGENT  v0.9.3'}
            </TerminalLine>
            <TerminalLine color={terminalMuted} fontFamily={terminalFont} fontSize={terminalFontSize} lineHeight={terminalLineHeight}>
              {'model  anthropic/claude-sonnet-4  ·  profile  default'}
            </TerminalLine>
            <TerminalLine color={terminalMuted} fontFamily={terminalFont} fontSize={terminalFontSize} lineHeight={terminalLineHeight}>
              {'cwd    ~/.hermes-ios'}
            </TerminalLine>
            <TerminalSpacer lineHeight={terminalLineHeight} />
            <TerminalLine color={terminalForeground} fontFamily={terminalFont} fontSize={terminalFontSize} lineHeight={terminalLineHeight}>
              {isChinese
                ? '欢迎使用 Hermes Agent！输入消息，或使用 /help 查看命令。'
                : 'Welcome to Hermes Agent! Type your message or /help for commands.'}
            </TerminalLine>
            <TerminalSpacer lineHeight={terminalLineHeight} />
            <TerminalLine color="#87ceeb" fontFamily={terminalBold} fontSize={terminalFontSize} lineHeight={terminalLineHeight}>
              {'❯  '}{isChinese ? '帮我检查当前项目的状态。' : 'Check the current project status.'}
            </TerminalLine>
            <TerminalSpacer lineHeight={terminalLineHeight} />
            <TerminalLine color="#ffd700" fontFamily={terminalBold} fontSize={terminalFontSize} lineHeight={terminalLineHeight}>
              {'⚕  Hermes Agent'}
            </TerminalLine>
            <TerminalLine color={terminalForeground} fontFamily={terminalFont} fontSize={terminalFontSize} lineHeight={terminalLineHeight}>
              {isChinese
                ? '我先查看工作目录和 Git 状态。'
                : 'I will inspect the working directory and Git status.'}
            </TerminalLine>
            <TerminalLine color={terminalForeground} fontFamily={terminalFont} fontSize={terminalFontSize} lineHeight={terminalLineHeight}>
              {isChinese
                ? '$ git status --short'
                : '$ git status --short'}
            </TerminalLine>
          </ScrollView>

          <View style={styles.terminalInputChrome}>
            <TerminalStatusBar
              fontFamily={terminalFont}
              fontSize={terminalFontSize}
              layoutWidth={width - 40}
              lineHeight={terminalLineHeight}
            />
            <TerminalRule
              fontFamily={terminalFont}
              fontSize={terminalFontSize}
              lineHeight={terminalLineHeight}
            />
            {attachmentCount > 0 ? (
              <View style={styles.terminalAttachmentRow}>
                <Paperclip color="#87ceeb" size={terminalFontSize + 3} />
                <PreviewText style={{ color: '#87ceeb', fontFamily: terminalBold, fontSize: terminalFontSize }}>
                  {isChinese ? `${attachmentCount} 个附件` : `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`}
                </PreviewText>
              </View>
            ) : null}
            <View style={styles.terminalInputRow}>
              <PreviewText style={{ color: terminalForeground, fontFamily: terminalFont, fontSize: terminalFontSize, lineHeight: terminalLineHeight }}>
                {'❯ '}
              </PreviewText>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                blurOnSubmit={false}
                multiline
                onChangeText={setDraft}
                onSubmitEditing={sendPreview}
                placeholder={isChinese ? '输入消息' : 'Type a message'}
                placeholderTextColor="#888888"
                returnKeyType="send"
                selectionColor={terminalForeground}
                style={[
                  styles.terminalInput,
                  {
                    color: terminalForeground,
                    fontFamily: terminalFont,
                    fontSize: terminalFontSize,
                    lineHeight: terminalLineHeight,
                  },
                ]}
                submitBehavior="submit"
                value={draft}
              />
              <IOSPressable
                accessibilityLabel={isChinese ? '添加附件' : 'Add attachment'}
                hitSlop={8}
                onPress={() => setAttachmentsOpen(true)}
                scaleTo={0.9}
                style={styles.terminalIconButton}
              >
                <Paperclip color={terminalMuted} size={terminalFontSize + 5} />
              </IOSPressable>
            </View>
            {width >= 1024 ? (
              <TerminalRule
                fontFamily={terminalFont}
                fontSize={terminalFontSize}
                lineHeight={terminalLineHeight}
              />
            ) : null}
          </View>

          <IOSPressable
            accessibilityLabel={isChinese ? '复制上一条回复' : 'Copy last response'}
            onPress={() => notify(isChinese ? '已复制上一条回复' : 'Last response copied')}
            style={[styles.copyLastButton, { borderColor: `${terminalForeground}55` }]}
          >
            <Copy color={terminalForeground} size={terminalFontSize + 2} />
            {width >= 400 ? (
              <PreviewText style={{ color: terminalForeground, fontFamily: terminalFont, fontSize: terminalFontSize }}>
                {isChinese ? '复制上一条回复' : 'copy last response'}
              </PreviewText>
            ) : null}
          </IOSPressable>
        </View>
      </View>
      {width >= 1024 ? (
        <View style={[styles.modelPanel, { borderLeftColor: tokens.colors.border }]}> 
          {modelPanel}
        </View>
      ) : null}
      <PreviewModal onClose={() => setToolsOpen(false)} open={toolsOpen} title={isChinese ? '模型与工具' : 'Model & Tools'}>
        {modelPanel}
      </PreviewModal>
      <PreviewModal onClose={() => setAttachmentsOpen(false)} open={attachmentsOpen} title={isChinese ? '添加附件' : 'Add attachment'}>
        <NativeButton onPress={() => void pickPhoto(false)} outlined prefix={<Image />}>
          {isChinese ? '照片图库' : 'Photo library'}
        </NativeButton>
        <NativeButton onPress={() => void pickPhoto(true)} outlined prefix={<Camera />}>
          {isChinese ? '拍照' : 'Take photo'}
        </NativeButton>
        <NativeButton onPress={() => void pickFile()} outlined prefix={<File />}>
          {isChinese ? '系统文件' : 'System files'}
        </NativeButton>
      </PreviewModal>
      <IOSActionSheet
        actions={PREVIEW_MODELS.map((item) => ({
          id: item.model,
          title: item.model,
        }))}
        cancelLabel={isChinese ? '取消' : 'Cancel'}
        onOpenChange={setModelPickerOpen}
        onSelect={setModel}
        open={modelPickerOpen}
        title={isChinese ? '选择模型' : 'Select model'}
      />
    </KeyboardAvoidingView>
  );
}

function TerminalLine({
  children,
  color,
  fontFamily,
  fontSize,
  lineHeight,
}: {
  bold?: boolean;
  children: ReactNode;
  color: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}) {
  return (
    <PreviewText
      style={{ color, fontFamily, fontSize, lineHeight }}
    >
      {children}
    </PreviewText>
  );
}

function TerminalSpacer({ lineHeight }: { lineHeight: number }) {
  return <View style={{ height: lineHeight }} />;
}

function TerminalStatusBar({
  fontFamily,
  fontSize,
  layoutWidth,
  lineHeight,
}: {
  fontFamily: string;
  fontSize: number;
  layoutWidth: number;
  lineHeight: number;
}) {
  const estimatedColumns = Math.floor(layoutWidth / (fontSize * 0.6));
  const model = 'claude-sonnet-4';
  const baseStyle = { fontFamily, fontSize, lineHeight };
  return (
    <View style={[styles.terminalStatusBar, { height: lineHeight }]}>
      <Text numberOfLines={1} style={[baseStyle, styles.terminalStatusText]}>
        <Text style={[baseStyle, styles.terminalStatusBase]}>{' ⚕ '}</Text>
        <Text style={[baseStyle, styles.terminalStatusStrong]}>{model}</Text>
        <Text style={[baseStyle, styles.terminalStatusDim]}>
          {estimatedColumns < 52 ? ' · 0s ' : estimatedColumns < 76 ? ' · ' : ' │ 21.5k/200k │ '}
        </Text>
        {estimatedColumns >= 52 ? (
          <Text style={[baseStyle, styles.terminalStatusGood]}>
            {estimatedColumns < 76 ? '21%' : '██░░░░░░░░ 21%'}
          </Text>
        ) : null}
        {estimatedColumns >= 52 ? (
          <Text style={[baseStyle, styles.terminalStatusDim]}>
            {estimatedColumns < 76 ? ' · 0s ' : ' │ 0s '}
          </Text>
        ) : null}
      </Text>
    </View>
  );
}

function TerminalRule({
  fontFamily,
  fontSize,
  lineHeight,
}: {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}) {
  return (
    <Text
      numberOfLines={1}
      style={{
        color: '#CD7F32',
        fontFamily,
        fontSize,
        height: lineHeight,
        lineHeight,
      }}
    >
      {'─'.repeat(180)}
    </Text>
  );
}

function terminalFontSizeForWidth(layoutWidth: number): number {
  if (layoutWidth < 300) return 7;
  if (layoutWidth < 360) return 8;
  if (layoutWidth < 420) return 9;
  if (layoutWidth < 520) return 10;
  if (layoutWidth < 720) return 11;
  if (layoutWidth < 1024) return 12;
  return 14;
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
        <NativeButton onPress={() => navigate('/chat')} prefix={<Plus />} size="sm">
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
          <IOSSwipeActions
            actions={[
              {
                icon: 'pencil',
                id: 'rename',
                label: 'Rename',
                onPress: () => notify(`Rename session: ${session.title}`),
              },
              {
                destructive: true,
                icon: 'trash',
                id: 'delete',
                label: 'Delete',
                onPress: () => setDeleteTarget(session.title),
              },
            ]}
            containerStyle={styles.swipeContainer}
            key={session.id}
          >
          <PreviewCard>
            <View style={styles.sessionRow}>
              <IOSContextMenu
                accessibilityLabel={`Open ${session.title}`}
                actions={[
                  {
                    id: 'resume',
                    onPress: () => navigate('/chat'),
                    systemImage: 'play',
                    title: 'Resume in chat',
                  },
                  {
                    id: 'export',
                    onPress: () => notify('Session export prepared'),
                    systemImage: 'square.and.arrow.up',
                    title: 'Export session',
                  },
                  {
                    destructive: true,
                    id: 'delete',
                    onPress: () => setDeleteTarget(session.title),
                    systemImage: 'trash',
                    title: 'Delete session',
                  },
                ]}
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
              </IOSContextMenu>
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
          </IOSSwipeActions>
        ))}
      </View>
      <ConfirmDialog
        description="This permanently removes the conversation and all of its messages. This preview does not write to the server."
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          notify(`Deleted session: ${deleteTarget}`);
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
          <NativeButton onPress={pickFiles} outlined prefix={<Upload />} size="sm">
            Upload
          </NativeButton>
          <NativeButton onPress={() => setFolderModal(true)} prefix={<FolderPlus />} size="sm">
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
      </PreviewCard>
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
        <NativeButton onPress={() => setSettingsOpen(true)} outlined prefix={<Settings2 />} size="sm">
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
          notify('Model settings saved');
          setSettingsOpen(false);
        }}>
          Save
        </NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

export function LogsPreviewPage({ notify }: PreviewPageProps) {
  const { width } = useWindowDimensions();
  const { tokens } = useTheme();
  const [live, setLive] = useState(true);
  const [level, setLevel] = useState<'all' | 'info' | 'warn'>('all');
  const visible = PREVIEW_LOGS.filter((row) => (
    level === 'all' || row[1].toLowerCase() === level
  ));
  const compact = width < 620;
  const logRows = visible.map((row, index) => (
    <View
      key={`${row[0]}-${index}`}
      style={[
        styles.logRow,
        compact && styles.logRowCompact,
        compact && { borderBottomColor: tokens.colors.border },
      ]}
    >
      <View style={compact ? styles.logMetaRow : undefined}>
        <PreviewText style={compact ? undefined : styles.logTime} variant="mono">
          {row[0]}
        </PreviewText>
        {compact ? (
          <>
            <PreviewBadge tone={row[1] === 'WARN' ? 'warning' : 'outline'}>
              {row[1]}
            </PreviewBadge>
            <PreviewText variant="mono">{row[2]}</PreviewText>
          </>
        ) : null}
      </View>
      {!compact ? (
        <>
          <PreviewBadge tone={row[1] === 'WARN' ? 'warning' : 'outline'}>
            {row[1]}
          </PreviewBadge>
          <PreviewText style={styles.logComponent} variant="mono">{row[2]}</PreviewText>
        </>
      ) : null}
      <PreviewText style={[styles.logMessage, compact && styles.logMessageCompact]} variant="mono">
        {row[3]}
      </PreviewText>
    </View>
  ));
  return (
    <PreviewPage
      actions={(
        <View style={styles.logHeaderControls}>
          <PreviewText variant="label">Auto refresh</PreviewText>
          <PreviewToggle accessibilityLabel="Auto refresh logs" onChange={setLive} value={live} />
          <NativeButton accessibilityLabel="Refresh logs" ghost onPress={() => notify('Logs refreshed')} size="icon">
            <RefreshCw />
          </NativeButton>
        </View>
      )}
      subtitle="Inspect gateway, agent, tool, scheduler, and plugin output."
      title="Logs"
    >
      <PreviewCard>
        <View style={styles.logToolbar}>
          <PreviewSegmented<'all' | 'info' | 'warn'>
            onChange={setLevel}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Info', value: 'info' },
              { label: 'Warn', value: 'warn' },
            ]}
            value={level}
          />
          <PreviewRow>
            <PreviewBadge tone={live ? 'success' : 'outline'}>{live ? 'LIVE' : 'PAUSED'}</PreviewBadge>
            <PreviewBadge tone="outline">hermes.log</PreviewBadge>
            <PreviewBadge tone="outline">500 lines</PreviewBadge>
          </PreviewRow>
        </View>
      </PreviewCard>
      <PreviewCard title="hermes.log">
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
      </PreviewCard>
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
    alignItems: 'flex-start',
    gap: 10,
  },
  logRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 36,
  },
  logRowCompact: {
    alignItems: 'stretch',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'column',
    gap: 5,
    paddingVertical: 10,
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
  logComponent: {
    width: 90,
  },
  logMessage: {
    minWidth: 420,
  },
  logMessageCompact: {
    minWidth: 0,
    width: '100%',
  },
});
