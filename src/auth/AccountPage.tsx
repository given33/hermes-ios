import { Download, LogOut, Trash2, UserRound } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type { HermesApiClient } from '../api/HermesApiClient';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { NativeButton } from '../components/ui/NativeButton';
import { resolveNativeFontStack } from '../design/native-font-faces';
import { useTheme } from '../design/ThemeProvider';
import type { NativeRouteLocale } from '../app/route-composition';
import { IOSIntelligenceApi } from '../context/IOSIntelligenceApi';
import { PreviewPage } from '../preview/PreviewPrimitives';

interface AccountPageProps {
  client?: HermesApiClient;
  locale: NativeRouteLocale;
  onDeleteAccount?(): Promise<void>;
  onLogout?(): Promise<void>;
  notify(message: string): void;
  username?: string;
}

export function AccountPage({
  client,
  locale,
  notify,
  onDeleteAccount,
  onLogout,
  username = '',
}: AccountPageProps) {
  const { tokens } = useTheme();
  const [busy, setBusy] = useState<'delete' | 'export' | 'logout' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const chinese = locale === 'zh';
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 600);

  const runExport = useCallback(async () => {
    if (!client || busy) return;
    setBusy('export');
    try {
      await shareAccountExport(client, exportPassphrase);
      notify(chinese ? '账户数据已准备完成' : 'Account export is ready');
    } catch (error) {
      notify(error instanceof Error ? error.message : (chinese ? '账户数据导出失败' : 'Account export failed'));
    } finally {
      setBusy(null);
    }
  }, [busy, chinese, client, exportPassphrase, notify]);

  const runLogout = useCallback(async () => {
    if (!onLogout || busy) return;
    setBusy('logout');
    try {
      await onLogout();
    } finally {
      setBusy(null);
    }
  }, [busy, onLogout]);

  const runDelete = useCallback(async () => {
    if (!onDeleteAccount || busy) return;
    setConfirmDelete(false);
    setBusy('delete');
    try {
      await onDeleteAccount();
    } finally {
      setBusy(null);
    }
  }, [busy, onDeleteAccount]);

  return (
    <PreviewPage title={chinese ? '账户' : 'Account'}>
      <View style={[styles.identity, { borderColor: tokens.colors.border }]}>
        <View style={[styles.avatar, { backgroundColor: tokens.colors.muted }]}>
          <UserRound color={tokens.colors.primary} size={24} />
        </View>
        <View style={styles.identityCopy}>
          <Text style={[styles.username, { color: tokens.colors.foreground, fontFamily: displayFont }]}>
            {username || (chinese ? 'Hermes 账户' : 'Hermes account')}
          </Text>
          <Text style={[styles.status, { color: tokens.colors.textSecondary }]}>
            {client ? (chinese ? '已连接' : 'Connected') : (chinese ? '预览' : 'Preview')}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TextInput
          accessibilityLabel={chinese ? '导出密码' : 'Export password'}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setExportPassphrase}
          placeholder={chinese ? '导出密码（至少 12 位）' : 'Export password (12+ characters)'}
          placeholderTextColor={tokens.colors.textSecondary}
          secureTextEntry
          style={[
            styles.password,
            {
              borderColor: tokens.colors.border,
              color: tokens.colors.foreground,
            },
          ]}
          value={exportPassphrase}
        />
        <NativeButton
          disabled={!client || busy !== null || exportPassphrase.length < 12}
          onPress={() => { void runExport(); }}
          outlined
          prefix={<Download />}
        >
          {busy === 'export'
            ? (chinese ? '正在导出' : 'Exporting')
            : (chinese ? '导出账户数据' : 'Export account data')}
        </NativeButton>
        <NativeButton
          disabled={!onLogout || busy !== null}
          onPress={() => { void runLogout(); }}
          outlined
          prefix={<LogOut />}
        >
          {chinese ? '退出登录' : 'Sign out'}
        </NativeButton>
        <NativeButton
          destructive
          disabled={!onDeleteAccount || busy !== null}
          onPress={() => setConfirmDelete(true)}
          prefix={<Trash2 />}
        >
          {busy === 'delete'
            ? (chinese ? '正在删除' : 'Deleting')
            : (chinese ? '删除账户' : 'Delete account')}
        </NativeButton>
      </View>

      <ConfirmDialog
        cancelLabel={chinese ? '取消' : 'Cancel'}
        confirmLabel={chinese ? '永久删除' : 'Delete permanently'}
        description={chinese
          ? '账户数据、轨迹、地点规律、设备会话和云端模型将被删除。'
          : 'Account data, trajectories, place patterns, device sessions, and cloud models will be deleted.'}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { void runDelete(); }}
        open={confirmDelete}
        title={chinese ? '删除账户？' : 'Delete account?'}
      />
    </PreviewPage>
  );
}

export async function shareAccountExport(
  client: HermesApiClient,
  exportPassphrase: string,
): Promise<void> {
  if (exportPassphrase.length < 12) throw new Error('Export password must be at least 12 characters');
  const payload = await new IOSIntelligenceApi(client).exportAccount(exportPassphrase);
  if (payload.encrypted !== true || !payload.blob_base64) {
    throw new Error('The server did not return an encrypted export');
  }
  const [{ File, Paths }, Sharing] = await Promise.all([
    import('expo-file-system'),
    import('expo-sharing'),
  ]);
  if (!await Sharing.isAvailableAsync()) throw new Error('System sharing is unavailable');
  const date = new Date().toISOString().slice(0, 10);
  const target = new File(Paths.cache, `Hermes-account-${date}.hermes-export`);
  target.create({ intermediates: true, overwrite: true });
  target.write(JSON.stringify(payload));
  try {
    await Sharing.shareAsync(target.uri, {
      dialogTitle: 'Hermes account export',
      mimeType: 'application/octet-stream',
      UTI: 'public.data',
    });
  } finally {
    target.delete();
  }
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'flex-start',
    gap: 12,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  identity: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 18,
  },
  identityCopy: {
    flex: 1,
    gap: 3,
  },
  password: {
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
    width: '100%',
  },
  status: {
    fontSize: 13,
    lineHeight: 18,
  },
  username: {
    fontSize: 17,
    lineHeight: 22,
  },
});
