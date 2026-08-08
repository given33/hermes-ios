import {
  ChevronRight,
  FileText,
  FolderOpen,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { HermesStudioWorkspaceFileEntry } from '../../api/hermes-studio';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { NativeButton } from '../../components/ui/NativeButton';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { PreviewText } from '../PreviewPrimitives';
import type { AgentGroupChatController } from './useAgentGroupChatController';

export interface AgentGroupWorkspacePanelProps {
  compact?: boolean;
  controller: AgentGroupChatController;
  isChinese: boolean;
  onClose(): void;
  roomId: string;
  workspace: string;
}

export function AgentGroupWorkspacePanel({
  compact = false,
  controller,
  isChinese,
  onClose,
  roomId,
  workspace,
}: AgentGroupWorkspacePanelProps) {
  const { tokens } = useTheme();
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<HermesStudioWorkspaceFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<HermesStudioWorkspaceFileEntry | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HermesStudioWorkspaceFileEntry | null>(null);

  const loadEntries = useCallback(async (nextPath = '') => {
    setLoading(true);
    setError(null);
    try {
      const result = await controllerRef.current.listWorkspaceFiles(roomId, nextPath);
      setPath(result.path || nextPath);
      setEntries(result.entries || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (isChinese ? '工作区文件读取失败' : 'Unable to read workspace files'));
    } finally {
      setLoading(false);
    }
  }, [isChinese, roomId]);

  useEffect(() => {
    if (!roomId) return;
    setPath('');
    setSelectedFile(null);
    setContent('');
    void loadEntries('');
  }, [loadEntries, roomId]);

  const openEntry = async (entry: HermesStudioWorkspaceFileEntry) => {
    if (entry.isDir) {
      await loadEntries(entry.path);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await controllerRef.current.readWorkspaceFile(roomId, entry.path);
      setSelectedFile(entry);
      setContent(result.content || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (isChinese ? '文件读取失败' : 'Unable to read file'));
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await controllerRef.current.writeWorkspaceFile(roomId, selectedFile.path, content);
      await loadEntries(path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (isChinese ? '文件保存失败' : 'Unable to save file'));
    } finally {
      setSaving(false);
    }
  };

  const createFolder = async () => {
    const name = `new-folder-${Date.now().toString(36)}`;
    try {
      await controllerRef.current.mkdirWorkspaceFile(roomId, joinPath(path, name));
      await loadEntries(path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (isChinese ? '目录创建失败' : 'Unable to create folder'));
    }
  };

  const deleteEntry = async () => {
    if (!deleteTarget) return;
    try {
      await controllerRef.current.deleteWorkspaceFile(roomId, deleteTarget.path, deleteTarget.isDir);
      if (selectedFile?.path === deleteTarget.path) {
        setSelectedFile(null);
        setContent('');
      }
      setDeleteTarget(null);
      await loadEntries(path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (isChinese ? '删除失败' : 'Unable to delete entry'));
      setDeleteTarget(null);
    }
  };

  return (
    <View style={[styles.panel, compact && styles.panelCompact, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}> 
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <FolderOpen color={tokens.colors.primary} size={16} />
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: tokens.colors.foreground }]}>{isChinese ? 'Agent 工作区' : 'Agent workspace'}</Text>
            <Text numberOfLines={1} style={[styles.workspace, { color: tokens.colors.textTertiary }]}>{workspace}</Text>
          </View>
        </View>
        <IOSPressable accessibilityLabel={isChinese ? '关闭工作区面板' : 'Close workspace panel'} onPress={onClose} style={styles.iconButton}>
          <X color={tokens.colors.textSecondary} size={16} />
        </IOSPressable>
      </View>
      <View style={styles.toolbar}>
        <TextInput
          onChangeText={setPath}
          onSubmitEditing={() => { void loadEntries(path); }}
          placeholder={isChinese ? '相对路径' : 'Relative path'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.pathInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={path}
        />
        <NativeButton ghost onPress={() => { void loadEntries(path); }} prefix={<RefreshCw />} size="icon" />
      </View>
      <View style={styles.toolbarButtons}>
        <NativeButton ghost onPress={() => { void createFolder(); }} prefix={<Plus />} size="sm">{isChinese ? '新建目录' : 'New folder'}</NativeButton>
        <PreviewText variant="tiny">{loading ? (isChinese ? '读取中…' : 'Loading…') : `${entries.length} ${isChinese ? '项' : 'items'}`}</PreviewText>
      </View>
      {error ? <Text style={[styles.error, { color: tokens.colors.destructive }]}>{error}</Text> : null}
      <ScrollView contentContainerStyle={styles.entryList} showsVerticalScrollIndicator={false}>
        {path ? (
          <IOSPressable onPress={() => { void loadEntries(parentPath(path)); }} style={styles.entryRow}>
            <ChevronRight color={tokens.colors.textTertiary} size={15} style={styles.backIcon} />
            <Text style={[styles.entryName, { color: tokens.colors.textSecondary }]}>..</Text>
          </IOSPressable>
        ) : null}
        {entries.map((entry) => (
          <IOSPressable key={entry.path} onPress={() => { void openEntry(entry); }} style={[styles.entryRow, selectedFile?.path === entry.path && { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.1) }]}>
            {entry.isDir ? <FolderOpen color={tokens.colors.primary} size={15} /> : <FileText color={tokens.colors.textSecondary} size={15} />}
            <View style={styles.entryCopy}>
              <Text numberOfLines={1} style={[styles.entryName, { color: tokens.colors.foreground }]}>{entry.name}</Text>
              <Text style={[styles.entryMeta, { color: tokens.colors.textTertiary }]}>{entry.isDir ? (isChinese ? '目录' : 'directory') : formatSize(entry.size)}</Text>
            </View>
            <IOSPressable accessibilityLabel={isChinese ? '删除工作区文件' : 'Delete workspace entry'} onPress={() => setDeleteTarget(entry)} style={styles.iconButton}>
              <Trash2 color={tokens.colors.destructive} size={14} />
            </IOSPressable>
          </IOSPressable>
        ))}
        {!entries.length && !loading ? <Text style={[styles.empty, { color: tokens.colors.textTertiary }]}>{isChinese ? '当前目录为空' : 'This directory is empty'}</Text> : null}
      </ScrollView>
      {selectedFile ? (
        <View style={[styles.editor, { borderTopColor: tokens.colors.border }]}> 
          <Text numberOfLines={1} style={[styles.editorTitle, { color: tokens.colors.foreground }]}>{selectedFile.path}</Text>
          <TextInput
            multiline
            onChangeText={setContent}
            style={[styles.editorInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
            value={content}
          />
          <NativeButton disabled={saving} loading={saving} onPress={() => { void saveFile(); }} prefix={<Save />} size="sm">{isChinese ? '保存文件' : 'Save file'}</NativeButton>
        </View>
      ) : null}
      <ConfirmDialog
        cancelLabel={isChinese ? '取消' : 'Cancel'}
        confirmLabel={isChinese ? '删除' : 'Delete'}
        description={isChinese ? '这会直接调用 Hermes Studio 工作区文件接口。' : 'This calls the Hermes Studio workspace file API directly.'}
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => { void deleteEntry(); }}
        open={Boolean(deleteTarget)}
        title={isChinese ? '删除工作区项目？' : 'Delete workspace entry?'}
      />
    </View>
  );
}

function joinPath(parent: string, child: string): string {
  return parent ? `${parent.replace(/[\\/]$/, '')}/${child}` : child;
}

function parentPath(value: string): string {
  const normalized = value.replace(/[\\/]$/, '');
  const index = normalized.lastIndexOf('/');
  return index < 0 ? '' : normalized.slice(0, index);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = {
  panel: { bottom: 0, borderLeftWidth: 1, position: 'absolute' as const, right: 0, top: 0, width: 340, zIndex: 5 },
  panelCompact: { width: '100%' as const },
  header: { alignItems: 'center' as const, borderBottomWidth: 1, flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingHorizontal: 10, paddingVertical: 9 },
  headerTitle: { alignItems: 'center' as const, flex: 1, flexDirection: 'row' as const, gap: 7, minWidth: 0 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 12, fontWeight: '700' as const },
  workspace: { fontSize: 9, marginTop: 2 },
  iconButton: { alignItems: 'center' as const, borderRadius: 7, justifyContent: 'center' as const, minHeight: 28, minWidth: 28 },
  toolbar: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 6, paddingHorizontal: 9, paddingTop: 8 },
  pathInput: { borderRadius: 7, borderWidth: 1, flex: 1, fontSize: 11, minHeight: 34, paddingHorizontal: 8, paddingVertical: 6 },
  toolbarButtons: { alignItems: 'center' as const, flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingHorizontal: 9, paddingVertical: 6 },
  error: { fontSize: 10, paddingHorizontal: 9 },
  entryList: { gap: 3, paddingHorizontal: 8, paddingBottom: 8 },
  entryRow: { alignItems: 'center' as const, borderRadius: 7, flexDirection: 'row' as const, gap: 7, minHeight: 36, paddingHorizontal: 6, paddingVertical: 4 },
  backIcon: { transform: [{ rotate: '180deg' }] },
  entryCopy: { flex: 1, minWidth: 0 },
  entryName: { fontSize: 11, fontWeight: '600' as const },
  entryMeta: { fontSize: 9, marginTop: 2 },
  empty: { fontSize: 10, padding: 15, textAlign: 'center' as const },
  editor: { borderTopWidth: 1, gap: 6, padding: 9 },
  editorTitle: { fontSize: 10, fontWeight: '700' as const },
  editorInput: { borderRadius: 7, borderWidth: 1, fontFamily: 'monospace', fontSize: 10, minHeight: 120, padding: 8, textAlignVertical: 'top' as const },
};
