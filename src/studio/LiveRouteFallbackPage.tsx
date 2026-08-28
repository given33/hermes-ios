import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import type { HermesApiClient } from '../api/HermesApiClient';
import type { NativeRouteLocale } from '../app/route-composition';
import { HERMES_SWIFTUI_ROUTE_ACTIONS } from '../app/swiftui-route-contract';
import { useHermesSwiftUIRouteData } from '../app/useHermesSwiftUIRouteData';
import { NativeButton } from '../components/ui/NativeButton';
import { ScreenState } from '../components/ui/ScreenState';
import { useTheme } from '../design/ThemeProvider';
import {
  PreviewBadge,
  PreviewCard,
  PreviewMetric,
  PreviewPage,
  PreviewProgress,
  PreviewRow,
  PreviewText,
} from './PreviewPrimitives';

type JsonRecord = Record<string, any>;

/** API-backed renderer for builds without the optional SwiftUI route module. */
export function LiveRouteFallbackPage({
  cacheOwner,
  client,
  locale,
  notify,
  profile,
  routeId,
}: {
  cacheOwner: string;
  client?: HermesApiClient;
  locale: NativeRouteLocale;
  notify(message: string): void;
  profile: string;
  routeId: string;
}) {
  const { tokens } = useTheme();
  const [draft, setDraft] = useState('');
  const [roomDraft, setRoomDraft] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [configDraft, setConfigDraft] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [busy, setBusy] = useState(false);
  const routeData = useHermesSwiftUIRouteData({ cacheOwner, client, locale, notify, profile, routeId });
  const snapshot = useMemo<JsonRecord | null>(() => {
    try {
      const parsed = JSON.parse(routeData.dataJson) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }, [routeData.dataJson]);
  useEffect(() => {
    if (routeId !== 'config' || !snapshot || !isRecord(snapshot.config)) return;
    const exportText = snapshot.config.exportText;
    if (typeof exportText === 'string') setConfigDraft(exportText);
  }, [routeId, snapshot]);
  const send = useCallback(async (action: string, payload: JsonRecord = {}) => {
    setBusy(true);
    try {
      await routeData.onAction(action, JSON.stringify({ route: routeId, ...payload }));
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [notify, routeData, routeId]);
  const importFiles = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled) return;
    const uris = result.assets.map((asset) => asset.uri).filter(Boolean);
    if (!uris.length) return;
    await send(HERMES_SWIFTUI_ROUTE_ACTIONS.fileImport, {
      fields: { stagedImport: 'false' },
      requestId: `ios-file-import-${Date.now().toString(36)}`,
      uris,
    });
  }, [send]);
  if (!client) return <ScreenState kind="error" message={locale === 'zh' ? '需要登录后加载此页面。' : 'Sign in to load this page.'} />;
  return (
    <PreviewPage
      actions={<NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.refresh)} outlined size="sm">{locale === 'zh' ? '刷新' : 'Refresh'}</NativeButton>}
      subtitle={locale === 'zh' ? '实时连接 Hermes 后端' : 'Live data from Hermes backend'}
      title={routeTitle(routeId, locale)}
    >
      {renderRoute({
        busy,
        configDraft,
        draft,
        importFiles,
        locale,
        messageDraft,
        pairingCode,
        roomDraft,
        routeId,
        send,
        setConfigDraft,
        setDraft,
        setMessageDraft,
        setPairingCode,
        setRoomDraft,
        snapshot,
        tokens,
      })}
    </PreviewPage>
  );
}

function renderRoute({
  busy,
  configDraft,
  draft,
  importFiles,
  locale,
  messageDraft,
  pairingCode,
  routeId,
  roomDraft,
  send,
  setConfigDraft,
  setDraft,
  setMessageDraft,
  setPairingCode,
  setRoomDraft,
  snapshot,
  tokens,
}: {
  busy: boolean; configDraft: string; draft: string; importFiles(): Promise<void>;
  locale: NativeRouteLocale; messageDraft: string; pairingCode: string; roomDraft: string; routeId: string;
  send(action: string, payload?: JsonRecord): Promise<void>; setDraft(value: string): void;
  setConfigDraft(value: string): void; setMessageDraft(value: string): void;
  setPairingCode(value: string): void; setRoomDraft(value: string): void;
  snapshot: JsonRecord | null; tokens: ReturnType<typeof useTheme>['tokens'];
}) {
  if (!snapshot) return <ScreenState kind="loading" message={locale === 'zh' ? '正在加载 Hermes 数据...' : 'Loading Hermes data...'} />;
  const chinese = locale === 'zh';
  if (routeId === 'analytics') {
    const analytics = isRecord(snapshot.analytics) ? snapshot.analytics : {};
    return <PreviewCard title={chinese ? '使用概览' : 'Usage overview'}>{Object.entries(analytics).filter(([key]) => key !== 'points').map(([key, value]) => <PreviewRow key={key} style={styles.row}><PreviewText variant="label">{key}</PreviewText><PreviewText color={tokens.colors.primary} variant="mono">{displayValue(value)}</PreviewText></PreviewRow>)}</PreviewCard>;
  }
  if (routeId === 'logs') {
    const logs = Array.isArray(snapshot.logs) ? snapshot.logs : [];
    return <PreviewCard title={chinese ? '服务器日志' : 'Server logs'}>{logs.length ? logs.map((entry, index) => <PreviewText key={index} color={tokens.colors.textSecondary} style={styles.log} variant="mono">{displayValue(entry)}</PreviewText>) : <ScreenState kind="empty" message={chinese ? '暂无日志' : 'No logs'} />}</PreviewCard>;
  }
  if (routeId === 'sessions') return <PreviewCard title={chinese ? '会话' : 'Sessions'}>{rows(snapshot.sessions).map((row) => <PreviewRow key={row.id} style={styles.row}><View style={styles.grow}><PreviewText>{row.title || row.id}</PreviewText><PreviewText variant="muted">{row.detail || row.model || ''}</PreviewText></View><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.sessionRename, { id: row.id, value: row.title || row.id })} size="sm">{chinese ? '重命名' : 'Rename'}</NativeButton><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.sessionCompress, { id: row.id, detail: row.title || '' })} size="sm">{chinese ? '压缩' : 'Compact'}</NativeButton><NativeButton disabled={busy} destructive onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.sessionDelete, { id: row.id })} size="icon">×</NativeButton></PreviewRow>)}</PreviewCard>;
  if (routeId === 'files') return <><PreviewRow style={styles.actions}><NativeButton disabled={busy} onPress={() => void importFiles()} size="sm">{chinese ? '导入文件' : 'Import files'}</NativeButton></PreviewRow><PreviewCard title={chinese ? '文件' : 'Files'}>{rows(snapshot.files).map((row) => <PreviewRow key={row.id} style={styles.row}><View style={styles.grow}><PreviewText>{row.name || row.id}</PreviewText><PreviewText variant="muted">{row.detail || ''}</PreviewText></View><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.fileDownload, { id: row.id, name: row.name })} size="sm">{chinese ? '下载' : 'Get'}</NativeButton><NativeButton disabled={busy} destructive onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.fileDelete, { id: row.id })} size="icon">×</NativeButton></PreviewRow>)}</PreviewCard></>;
  if (routeId === 'cron') {
    const jobs = Array.isArray(snapshot.cron) ? snapshot.cron : [];
    return <><CreateBar busy={busy} chinese={chinese} draft={draft} onChange={setDraft} onSubmit={() => { const [name, schedule, ...prompt] = draft.split('|'); void send(HERMES_SWIFTUI_ROUTE_ACTIONS.cronCreate, { name: name || 'Hermes job', detail: prompt.join('|'), fields: { schedule: schedule || '0 * * * *' } }).then(() => setDraft('')); }} placeholder={chinese ? '名称|cron|提示词' : 'name|cron|prompt'} /><PreviewCard title={chinese ? '定时任务' : 'Scheduled jobs'}>{jobs.map((job) => <PreviewRow key={job.id} style={styles.row}><View style={styles.grow}><PreviewText>{job.name || job.id}</PreviewText><PreviewText variant="muted">{job.schedule || ''}</PreviewText></View><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.cronToggle, { id: job.id, enabled: job.enabled !== false })} size="sm">{job.enabled === false ? (chinese ? '启用' : 'Enable') : (chinese ? '停用' : 'Pause')}</NativeButton><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.cronRun, { id: job.id })} size="sm">{chinese ? '运行' : 'Run'}</NativeButton><NativeButton disabled={busy} destructive onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.cronDelete, { id: job.id })} size="icon">×</NativeButton></PreviewRow>)}</PreviewCard></>;
  }
  if (['plugins', 'mcp', 'channels', 'webhooks'].includes(routeId)) {
    const items = Array.isArray(snapshot.integrations) ? snapshot.integrations : [];
    return <>{(routeId === 'mcp' || routeId === 'webhooks') ? <CreateBar busy={busy} chinese={chinese} draft={draft} onChange={setDraft} onSubmit={() => { void send(HERMES_SWIFTUI_ROUTE_ACTIONS.integrationCreate, { name: draft, fields: routeId === 'mcp' ? { url: draft } : {} }).then(() => setDraft('')); }} placeholder={routeId === 'mcp' ? 'MCP URL' : (chinese ? 'Webhook 名称' : 'Webhook name')} /> : null}<PreviewCard title={routeTitle(routeId, locale)}>{items.map((item) => <PreviewRow key={item.id} style={styles.row}><View style={styles.grow}><PreviewText>{item.name || item.id}</PreviewText><PreviewText variant="muted">{item.detail || ''}</PreviewText></View><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.integrationToggle, { id: item.id, enabled: item.enabled !== true })} size="sm">{item.enabled === false ? (chinese ? '启用' : 'Enable') : (chinese ? '停用' : 'Disable')}</NativeButton>{routeId === 'channels' ? <NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.integrationUpdate, { id: item.id, fields: parseJsonRecord(item.configuration || '{}') || { enabled: item.enabled !== false } })} size="sm">{chinese ? '保存配置' : 'Save config'}</NativeButton> : null}{(routeId === 'mcp' || routeId === 'webhooks') ? <NativeButton disabled={busy} destructive onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.integrationDelete, { id: item.id })} size="icon">×</NativeButton> : null}</PreviewRow>)}</PreviewCard></>;
  }
  if (routeId === 'profiles' || routeId === 'profile-new') {
    const profiles = Array.isArray(snapshot.profiles) ? snapshot.profiles : [];
    return <><CreateBar busy={busy} chinese={chinese} draft={draft} onChange={setDraft} onSubmit={() => { void send(HERMES_SWIFTUI_ROUTE_ACTIONS.profileCreate, { name: draft }).then(() => setDraft('')); }} placeholder={chinese ? '新 Profile 名称' : 'New profile name'} /><PreviewCard title="Profiles">{profiles.map((item) => <PreviewRow key={item.id} style={styles.row}><View style={styles.grow}><PreviewText>{item.name || item.id}</PreviewText><PreviewText variant="muted">{item.model || item.detail || ''}</PreviewText></View><PreviewBadge tone={item.active ? 'success' : 'outline'}>{item.active ? (chinese ? '当前' : 'Active') : (chinese ? '可用' : 'Available')}</PreviewBadge><NativeButton disabled={busy || item.active === true} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.profileActivate, { id: item.id })} size="sm">{chinese ? '使用' : 'Use'}</NativeButton><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.profileUpdate, { id: item.id, detail: item.soul || item.detail || '' })} size="sm">{chinese ? '保存灵魂' : 'Save soul'}</NativeButton><NativeButton disabled={busy || item.active === true} destructive onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.profileDelete, { id: item.id })} size="icon">×</NativeButton></PreviewRow>)}</PreviewCard></>;
  }
  if (routeId === 'env') return <PreviewCard title={chinese ? '模型凭据' : 'Model credentials'}>{rows(snapshot.environment).map((item) => <PreviewRow key={item.id} style={styles.row}><View style={styles.grow}><PreviewText>{item.key || item.id}</PreviewText><PreviewText variant="mono">{item.maskedValue || '********'}</PreviewText></View><NativeButton disabled={busy} destructive onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.environmentDelete, { id: item.id })} size="icon">×</NativeButton></PreviewRow>)}</PreviewCard>;
  if (routeId === 'pairing') {
    const pairing = isRecord(snapshot.pairing) ? snapshot.pairing : {};
    const pending = rows(pairing.pending);
    const approved = rows(pairing.approved);
    return <><PreviewCard title={chinese ? '处理配对请求' : 'Handle pairing requests'}><PreviewRow style={styles.create}><TextInput autoCapitalize="characters" onChangeText={setPairingCode} placeholder={chinese ? '配对码' : 'Pairing code'} placeholderTextColor="#8b929c" style={styles.input} value={pairingCode} /><NativeButton disabled={busy} destructive onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.pairingClearPending)} size="sm">{chinese ? '清空待处理' : 'Clear pending'}</NativeButton></PreviewRow>{pending.length ? pending.map((item) => <PreviewRow key={item.id} style={styles.row}><View style={styles.grow}><PreviewText>{item.userName || item.userId || item.id}</PreviewText><PreviewText variant="muted">{item.platform} · {item.detail}</PreviewText></View><NativeButton disabled={busy || !pairingCode.trim()} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.pairingApprove, { id: item.platform, value: pairingCode })} size="sm">{chinese ? '批准' : 'Approve'}</NativeButton></PreviewRow>) : <ScreenState kind="empty" message={chinese ? '暂无待处理请求' : 'No pending requests'} />}</PreviewCard><PreviewCard title={chinese ? '已批准设备' : 'Approved devices'}>{approved.length ? approved.map((item) => <PreviewRow key={item.id} style={styles.row}><View style={styles.grow}><PreviewText>{item.userName || item.userId || item.id}</PreviewText><PreviewText variant="muted">{item.platform}</PreviewText></View><NativeButton disabled={busy || !item.userId} destructive onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.pairingRevoke, { id: item.platform, value: item.userId })} size="sm">{chinese ? '撤销' : 'Revoke'}</NativeButton></PreviewRow>) : <ScreenState kind="empty" message={chinese ? '暂无已批准设备' : 'No approved devices'} />}</PreviewCard></>;
  }
  if (routeId === 'achievements') {
    const achievements = isRecord(snapshot.achievements) ? snapshot.achievements : {};
    const items = rows(achievements.items);
    return <><PreviewRow style={styles.actions}><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.achievementsRescan)} size="sm">{chinese ? '重新扫描' : 'Rescan'}</NativeButton></PreviewRow><PreviewRow style={styles.metrics}><PreviewMetric label={chinese ? '已完成任务' : 'Tasks completed'} value={String(achievements.tasksCompleted || '-')} /><PreviewMetric label={chinese ? '连续天数' : 'Day streak'} value={String(achievements.dayStreak || '-')} /></PreviewRow><PreviewCard title={chinese ? '成就' : 'Achievements'}>{items.length ? items.map((item) => <View key={item.id} style={styles.progressItem}><PreviewRow><View style={styles.grow}><PreviewText>{item.title || item.id}</PreviewText><PreviewText variant="muted">{item.detail || ''}</PreviewText></View><PreviewBadge tone={Number(item.progress) >= 1 ? 'success' : 'outline'}>{`${Math.round(Number(item.progress || 0) * 100)}%`}</PreviewBadge></PreviewRow><PreviewProgress value={Number(item.progress || 0) * 100} /></View>) : <ScreenState kind="empty" message={chinese ? '暂无成就数据' : 'No achievements yet'} />}</PreviewCard></>;
  }
  if (routeId === 'kanban') {
    const columns = rows(snapshot.kanban);
    return <><CreateBar busy={busy} chinese={chinese} draft={draft} onChange={setDraft} onSubmit={() => { const [title, detail, targetId] = draft.split('|'); void send(HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanCreate, { name: title, detail, targetId }).then(() => setDraft('')); }} placeholder={chinese ? '标题|描述|列 ID' : 'title|description|column id'} /><PreviewCard title={chinese ? '任务看板' : 'Kanban'}>{columns.length ? columns.map((column) => <View key={column.id} style={styles.column}><PreviewRow><PreviewText variant="heading">{column.title || column.id}</PreviewText><PreviewBadge tone="outline">{String(rows(column.cards).length)}</PreviewBadge></PreviewRow>{rows(column.cards).map((card) => <PreviewRow key={card.id} style={styles.row}><View style={styles.grow}><PreviewText>{card.title || card.id}</PreviewText><PreviewText variant="muted">{card.detail || ''}</PreviewText></View><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanMove, { id: card.id, targetId: column.id })} size="sm">{chinese ? '移入此列' : 'Move here'}</NativeButton><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanUpdate, { id: card.id, detail: card.detail || '' })} size="sm">{chinese ? '保存' : 'Save'}</NativeButton><NativeButton disabled={busy} destructive onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanDelete, { id: card.id })} size="icon">×</NativeButton></PreviewRow>)}</View>) : <ScreenState kind="empty" message={chinese ? '暂无任务' : 'No tasks'} />}</PreviewCard></>;
  }
  if (routeId === 'collaboration') {
    const collaboration = isRecord(snapshot.collaboration) ? snapshot.collaboration : {};
    const rooms = rows(collaboration.rooms);
    const selectedRoomId = String(collaboration.selectedRoomId || rooms[0]?.id || '');
    const messages = rows(collaboration.messages);
    return <><CreateBar busy={busy} chinese={chinese} draft={roomDraft} onChange={setRoomDraft} onSubmit={() => { const [name, ...profiles] = roomDraft.split('|'); void send(HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationCreate, { value: name, fields: { profiles: profiles.join(',') } }).then(() => setRoomDraft('')); }} placeholder={chinese ? '房间名|profile1,profile2' : 'room name|profile1,profile2'} />{rooms.length ? <PreviewCard title={chinese ? '协作房间' : 'Collaboration rooms'}>{rooms.map((room) => <PreviewRow key={room.id} style={styles.row}><View style={styles.grow}><PreviewText>{room.name || room.id}</PreviewText></View><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationSelect, { id: room.id })} size="sm">{room.id === selectedRoomId ? (chinese ? '当前' : 'Selected') : (chinese ? '进入' : 'Open')}</NativeButton><NativeButton disabled={busy} destructive onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationDelete, { id: room.id })} size="icon">×</NativeButton></PreviewRow>)}</PreviewCard> : null}<PreviewCard title={chinese ? '消息' : 'Messages'}>{messages.map((message) => <PreviewText key={message.id} style={styles.message}>{message.text || ''}</PreviewText>)}<CreateBar busy={busy} chinese={chinese} draft={messageDraft} onChange={setMessageDraft} onSubmit={() => { void send(HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationSend, { id: selectedRoomId, value: messageDraft, requestId: `ios-room-${Date.now().toString(36)}` }).then(() => setMessageDraft('')); }} placeholder={chinese ? '发送消息' : 'Send a message'} /></PreviewCard></>;
  }
  if (routeId === 'approvals') {
    const approvals = isRecord(snapshot.approvals) ? snapshot.approvals : {};
    const items = rows(approvals.items);
    return <PreviewCard title={chinese ? '写入审批' : 'Write approvals'}>{items.length ? items.map((item) => <View key={item.id} style={styles.approval}><PreviewRow><View style={styles.grow}><PreviewText>{item.title || item.id}</PreviewText><PreviewText variant="muted">{item.subsystem || item.action} · {item.target || ''}</PreviewText></View><PreviewBadge tone={item.state === 'approved' ? 'success' : item.state === 'rejected' ? 'danger' : 'warning'}>{item.state || 'pending'}</PreviewBadge></PreviewRow>{item.diff ? <PreviewText numberOfLines={8} variant="mono">{item.diff}</PreviewText> : null}<PreviewRow style={styles.actions}><NativeButton disabled={busy || !item.revision} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.approvalApprove, { id: item.id, requestId: `ios-approval-${item.id}`, fields: { revision: String(item.revision), payloadDigest: item.payloadDigest || '' } })} size="sm">{chinese ? '批准' : 'Approve'}</NativeButton><NativeButton disabled={busy || !item.revision} destructive onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.approvalReject, { id: item.id, requestId: `ios-approval-reject-${item.id}`, fields: { revision: String(item.revision), payloadDigest: item.payloadDigest || '' } })} size="sm">{chinese ? '拒绝' : 'Reject'}</NativeButton></PreviewRow></View>) : <ScreenState kind="empty" message={chinese ? '暂无待审批写入' : 'No pending approvals'} />}</PreviewCard>;
  }
  if (routeId === 'runtime-center') {
    const runtime = isRecord(snapshot.runtime) ? snapshot.runtime : {};
    const runs = rows(runtime.runs);
    return <PreviewCard title={chinese ? '运行中心' : 'Runtime center'}>{runs.length ? runs.map((run) => <PreviewRow key={run.id} style={styles.row}><View style={styles.grow}><PreviewText>{run.title || run.id}</PreviewText><PreviewText variant="muted">{run.kind || ''} · {run.detail || ''}</PreviewText></View><PreviewBadge tone={run.state === 'completed' || run.state === 'success' ? 'success' : run.state === 'failed' ? 'danger' : 'outline'}>{run.state || 'unknown'}</PreviewBadge>{run.cancelable && run.cancelUrl ? <NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.runtimeCancel, { id: run.id, fields: { actionUrl: run.cancelUrl }, requestId: `ios-runtime-cancel-${run.id}` })} size="sm">{chinese ? '取消' : 'Cancel'}</NativeButton> : null}{run.retryable && run.retryUrl ? <NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.runtimeRetry, { id: run.id, fields: { actionUrl: run.retryUrl }, requestId: `ios-runtime-retry-${run.id}` })} size="sm">{chinese ? '重试' : 'Retry'}</NativeButton> : null}</PreviewRow>) : <ScreenState kind="empty" message={chinese ? '暂无运行记录' : 'No runtime runs'} />}</PreviewCard>;
  }
  if (routeId === 'docs') return <PreviewCard title={chinese ? 'Hermes 文档' : 'Hermes documentation'}><PreviewText>{chinese ? '这里提供 Hermes 后端能力说明。聊天、工作流、文件、技能、模型和设备管理均通过当前账户的安全 API 连接。' : 'Hermes backend capabilities are available here. Chat, workflows, files, skills, models, and device management use the current account-secured APIs.'}</PreviewText><PreviewText variant="muted">{chinese ? '如需查看最新接口，请刷新后端版本并重新进入本页。' : 'Refresh the backend version and reopen this page for the latest API surface.'}</PreviewText></PreviewCard>;
  if (routeId === 'config') {
    const config = isRecord(snapshot.config) ? snapshot.config : {};
    return <PreviewCard title={chinese ? '配置' : 'Configuration'}><PreviewText variant="muted">{chinese ? '编辑 JSON 后保存到当前 Profile。' : 'Edit JSON and save it to the active profile.'}</PreviewText><TextInput multiline numberOfLines={14} onChangeText={setConfigDraft} placeholder="{}" placeholderTextColor="#8b929c" style={styles.configInput} textAlignVertical="top" value={configDraft || String(config.exportText || '{}')} /><NativeButton disabled={busy || !configDraft.trim()} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.configUpdate, { value: configDraft })} size="sm">{chinese ? '保存配置' : 'Save configuration'}</NativeButton></PreviewCard>;
  }
  if (routeId === 'system') return <PreviewCard title={chinese ? '系统控制' : 'System controls'}><PreviewText color={tokens.colors.textSecondary} variant="mono">{JSON.stringify(snapshot.system || {}, null, 2)}</PreviewText><PreviewRow style={styles.actions}><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.systemRecover)} size="sm">{chinese ? '重连节点' : 'Reconnect'}</NativeButton><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.systemRestart)} size="sm">{chinese ? '重启网关' : 'Restart'}</NativeButton><NativeButton disabled={busy} onPress={() => void send(HERMES_SWIFTUI_ROUTE_ACTIONS.systemUpdate)} outlined size="sm">{chinese ? '更新' : 'Update'}</NativeButton></PreviewRow></PreviewCard>;
  return <PreviewCard title={routeTitle(routeId, locale)}><PreviewText color={tokens.colors.textSecondary} variant="mono">{JSON.stringify(snapshot, null, 2)}</PreviewText></PreviewCard>;
}

function CreateBar({ busy, chinese, draft, onChange, onSubmit, placeholder }: { busy: boolean; chinese: boolean; draft: string; onChange(value: string): void; onSubmit(): void; placeholder: string }) {
  return <PreviewRow style={styles.create}><TextInput onChangeText={onChange} onSubmitEditing={onSubmit} placeholder={placeholder} placeholderTextColor="#8b929c" style={styles.input} value={draft} /><NativeButton disabled={busy || !draft.trim()} onPress={onSubmit} size="sm">{chinese ? '新建' : 'Create'}</NativeButton></PreviewRow>;
}
function rows(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.filter(isRecord) : []; }
function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function displayValue(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value); }
function parseJsonRecord(value: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function routeTitle(routeId: string, locale: NativeRouteLocale): string {
  const titles: Record<string, [string, string]> = { sessions: ['会话', 'Sessions'], files: ['文件', 'Files'], analytics: ['分析', 'Analytics'], logs: ['日志', 'Logs'], cron: ['定时任务', 'Cron'], plugins: ['插件', 'Plugins'], mcp: ['MCP', 'MCP'], pairing: ['配对', 'Pairing'], channels: ['渠道', 'Channels'], webhooks: ['Webhooks', 'Webhooks'], profiles: ['Profiles', 'Profiles'], 'profile-new': ['新建 Profile', 'New Profile'], config: ['配置', 'Configuration'], env: ['环境变量', 'Environment'], system: ['系统', 'System'], docs: ['文档', 'Documentation'] };
  return (titles[routeId] || [routeId, routeId])[locale === 'zh' ? 0 : 1];
}
const styles = StyleSheet.create({
  actions: { flexWrap: 'wrap', gap: 8, marginTop: 12 },
  approval: { borderBottomColor: 'rgba(128,128,128,0.2)', borderBottomWidth: 1, gap: 8, paddingVertical: 10 },
  column: { gap: 4, marginBottom: 12 },
  configInput: { borderColor: '#6d737d', borderRadius: 6, borderWidth: 1, color: '#f5f7fa', minHeight: 260, padding: 10 },
  create: { gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  input: { borderColor: '#6d737d', borderRadius: 6, borderWidth: 1, color: '#f5f7fa', flex: 1, minHeight: 38, paddingHorizontal: 10 },
  log: { borderBottomColor: 'rgba(128,128,128,0.2)', borderBottomWidth: 1, paddingVertical: 5 },
  message: { borderBottomColor: 'rgba(128,128,128,0.2)', borderBottomWidth: 1, paddingVertical: 7 },
  metrics: { alignItems: 'stretch', gap: 12 },
  progressItem: { gap: 6, paddingVertical: 4 },
  row: { alignItems: 'center', borderBottomColor: 'rgba(128,128,128,0.2)', borderBottomWidth: 1, gap: 8, paddingVertical: 8 },
});
