import * as Clipboard from 'expo-clipboard';
import { Copy, Download, FileText, LogOut, ShieldCheck, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HermesApiClient } from '../api/HermesApiClient';
import { StudioProfileAvatar } from '../components/studio/StudioProfileAvatar';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { resolveNativeFontStack } from '../design/native-font-faces';
import { useTheme } from '../design/ThemeProvider';
import {
  HERMES_STUDIO_BSL_1_1,
  HERMES_STUDIO_LOGO_NOTICE,
} from '../legal/third-party-notices';
import type { NativeRouteLocale } from '../app/route-composition';
import { IOSIntelligenceApi } from '../context/IOSIntelligenceApi';
import {
  PreviewBadge,
  PreviewDataRow,
  PreviewModal,
  PreviewPage,
  PreviewText,
} from '../studio/PreviewPrimitives';

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
  const [showThirdPartyNotices, setShowThirdPartyNotices] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const mounted = useRef(true);
  const chinese = locale === 'zh';
  const displayFont = resolveNativeFontStack(tokens.typography.fontDisplay, 600);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runExport = useCallback(async () => {
    if (!client || busy) return;
    setBusy('export');
    try {
      await shareAccountExport(client, exportPassphrase);
      if (mounted.current) {
        notify(chinese ? '账户数据已准备完成' : 'Account export is ready');
      }
    } catch (error) {
      if (mounted.current) {
        notify(error instanceof Error ? error.message : (chinese ? '账户数据导出失败' : 'Account export failed'));
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [busy, chinese, client, exportPassphrase, notify]);

  const runLogout = useCallback(async () => {
    if (!onLogout || busy) return;
    setBusy('logout');
    try {
      await onLogout();
    } catch (error) {
      if (mounted.current) {
        notify(error instanceof Error
          ? error.message
          : (chinese ? '退出登录失败，请重试。' : 'Sign out failed. Please retry.'));
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [busy, chinese, notify, onLogout]);

  const runDelete = useCallback(async () => {
    if (!onDeleteAccount || busy) return;
    setConfirmDelete(false);
    setBusy('delete');
    try {
      await onDeleteAccount();
    } catch (error) {
      if (mounted.current) {
        notify(error instanceof Error
          ? error.message
          : (chinese ? '删除账户失败，请重试。' : 'Account deletion failed. Please retry.'));
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [busy, chinese, notify, onDeleteAccount]);

  const copyAccount = useCallback(async () => {
    const identity = username || (chinese ? 'Hermes 账户' : 'Hermes account');
    await Clipboard.setStringAsync([
      `${chinese ? '账户' : 'Account'}: ${identity}`,
      `${chinese ? '连接' : 'Connection'}: ${client ? (chinese ? '已连接' : 'Connected') : (chinese ? '预览' : 'Preview')}`,
    ].join('\n'));
    notify(chinese ? '账户信息已复制' : 'Account information copied');
  }, [chinese, client, notify, username]);

  return (
    <PreviewPage title={chinese ? '账户' : 'Account'}>
      <View style={[styles.identity, { borderColor: tokens.colors.border }]}>
        <StudioProfileAvatar seed={username || 'Hermes iOS User'} size={48} />
        <View style={styles.identityCopy}>
          <Text style={[styles.username, { color: tokens.colors.foreground, fontFamily: displayFont }]}>
            {username || (chinese ? 'Hermes 账户' : 'Hermes account')}
          </Text>
          <Text style={[styles.status, { color: tokens.colors.textSecondary }]}>
            {client ? (chinese ? '已连接' : 'Connected') : (chinese ? '预览' : 'Preview')}
          </Text>
        </View>
        <PreviewBadge tone={client ? 'success' : 'outline'}>
          {client ? (chinese ? '已连接' : 'CONNECTED') : (chinese ? '预览' : 'PREVIEW')}
        </PreviewBadge>
        <NativeButton accessibilityLabel={chinese ? '复制账户信息' : 'Copy account information'} ghost onPress={() => { void copyAccount(); }} size="icon">
          <Copy />
        </NativeButton>
      </View>

      <View style={[styles.section, { borderTopColor: tokens.colors.border }]}>
        <PreviewText variant="label">{chinese ? '账户数据' : 'Account data'}</PreviewText>
        <PreviewDataRow label={chinese ? '导出格式' : 'Export format'} value={chinese ? '账户独立加密归档' : 'Per-account encrypted archive'} />
        <PreviewDataRow label={chinese ? '本地明文缓存' : 'Plaintext cache'} value={chinese ? '不保留' : 'Never retained'} />
        <NativeInput
          accessibilityLabel={chinese ? '导出密码' : 'Export password'}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setExportPassphrase}
          placeholder={chinese ? '导出密码（至少 12 位）' : 'Export password (12+ characters)'}
          placeholderTextColor={tokens.colors.textSecondary}
          secureTextEntry
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
      </View>

      <View style={[styles.section, { borderTopColor: tokens.colors.border }]}>
        <PreviewText variant="label">{chinese ? '会话与安全' : 'Session and security'}</PreviewText>
        <PreviewDataRow label={chinese ? '账户加密边界' : 'Encryption boundary'} value={<ShieldCheck color={tokens.colors.success} size={17} />} />
        <View style={styles.actions}>
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
      </View>

      <View style={[styles.section, { borderTopColor: tokens.colors.border }]}>
        <PreviewText variant="label">{chinese ? '关于' : 'About'}</PreviewText>
        <NativeButton
          onPress={() => setShowThirdPartyNotices(true)}
          outlined
          prefix={<FileText />}
        >
          {chinese ? '第三方授权' : 'Third-party notices'}
        </NativeButton>
      </View>

      <ConfirmDialog
        cancelLabel={chinese ? '取消' : 'Cancel'}
        confirmLabel={chinese ? '永久删除' : 'Delete permanently'}
        description={chinese
          ? '账户数据、协作会话、云文件、轨迹、地点规律、设备会话和云端模型将被永久删除。'
          : 'Account data, collaboration chats, cloud files, trajectories, place patterns, device sessions, and cloud models will be permanently deleted.'}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { void runDelete(); }}
        open={confirmDelete}
        title={chinese ? '删除账户？' : 'Delete account?'}
      />
      <PreviewModal
        onClose={() => setShowThirdPartyNotices(false)}
        open={showThirdPartyNotices}
        title={chinese ? '第三方授权' : 'Third-party notices'}
      >
        <PreviewText variant="heading">Hermes Studio</PreviewText>
        <PreviewText style={styles.legalText}>{HERMES_STUDIO_LOGO_NOTICE}</PreviewText>
        <PreviewText style={styles.legalText} variant="mono">
          {HERMES_STUDIO_BSL_1_1}
        </PreviewText>
      </PreviewModal>
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
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingTop: 16,
  },
  legalText: {
    fontSize: 12,
    lineHeight: 18,
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
