import { CalendarClock, Plus, RefreshCw, Save, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { HermesApiClient } from '../../api/HermesApiClient';
import { hermesStudioApiFor } from '../../api/hermes-api-registry';
import type {
  HermesStudioWorkflowRecord,
  HermesStudioWorkflowScheduleInput,
  HermesStudioWorkflowScheduleRecord,
} from '../../api/hermes-studio';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { NativeButton } from '../../components/ui/NativeButton';
import { useTheme } from '../../design/ThemeProvider';
import { PreviewModal, PreviewText } from '../PreviewPrimitives';

export interface HermesStudioWorkflowSchedulesProps {
  client?: HermesApiClient;
  isChinese: boolean;
  notify(message: string): void;
  onClose(): void;
  open: boolean;
  profile: string;
  workflow: HermesStudioWorkflowRecord | null;
}

interface ScheduleDraft {
  schedule: string;
  timezone: string;
  enabled: boolean;
  input: string;
  startNodeIds: string;
  timeoutMinutes: string;
}

const DEFAULT_DRAFT: ScheduleDraft = {
  schedule: '@daily',
  timezone: 'UTC',
  enabled: true,
  input: '',
  startNodeIds: '',
  timeoutMinutes: '',
};

export function HermesStudioWorkflowSchedules({
  client,
  isChinese,
  notify,
  onClose,
  open,
  profile,
  workflow,
}: HermesStudioWorkflowSchedulesProps) {
  const { tokens } = useTheme();
  const api = client ? hermesStudioApiFor(client) : null;
  const [schedules, setSchedules] = useState<HermesStudioWorkflowScheduleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft>(DEFAULT_DRAFT);

  const refresh = useCallback(async () => {
    if (!workflow) {
      setSchedules([]);
      return;
    }
    if (!api) {
      setSchedules([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      setSchedules(await api.workflows.listSchedules(workflow.id));
      setError(null);
    } catch (reason) {
      const message = reason instanceof Error && reason.message.trim()
        ? reason.message
        : (isChinese ? '读取工作流调度失败' : 'Failed to load workflow schedules');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [api, isChinese, workflow]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const reset = useCallback((schedule?: HermesStudioWorkflowScheduleRecord) => {
    setEditingId(schedule?.id || null);
    setDraft(schedule ? {
      schedule: schedule.schedule,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      input: schedule.input || '',
      startNodeIds: schedule.start_node_ids.join(', '),
      timeoutMinutes: schedule.timeout_ms == null ? '' : String(schedule.timeout_ms / 60_000),
    } : DEFAULT_DRAFT);
  }, []);

  const save = useCallback(async () => {
    if (!workflow || !api) return;
    const schedule = draft.schedule.trim();
    const timezone = draft.timezone.trim();
    if (!schedule || !timezone) {
      const message = isChinese ? '请填写 Cron/预设和时区' : 'Schedule and timezone are required';
      setError(message);
      notify(message);
      return;
    }
    const timeout = Number(draft.timeoutMinutes);
    const input: HermesStudioWorkflowScheduleInput = {
      schedule,
      timezone,
      enabled: draft.enabled,
      input: draft.input.trim() || null,
      start_node_ids: draft.startNodeIds.split(',').map((value) => value.trim()).filter(Boolean),
      timeout_ms: Number.isFinite(timeout) && timeout > 0 ? Math.round(timeout * 60_000) : null,
    };
    setSaving(true);
    try {
      const next = editingId
        ? await api.workflows.updateSchedule(workflow.id, editingId, input)
        : await api.workflows.createSchedule(workflow.id, input);
      setSchedules((current) => editingId
        ? current.map((item) => item.id === next.id ? next : item)
        : [next, ...current]);
      reset();
      notify(isChinese ? '工作流调度已保存' : 'Workflow schedule saved');
    } catch (reason) {
      const message = reason instanceof Error && reason.message.trim()
        ? reason.message
        : (isChinese ? '保存工作流调度失败' : 'Failed to save workflow schedule');
      setError(message);
      notify(message);
    } finally {
      setSaving(false);
    }
  }, [api, draft, editingId, isChinese, notify, reset, workflow]);

  const toggle = useCallback(async (schedule: HermesStudioWorkflowScheduleRecord) => {
    if (!workflow || !api) return;
    try {
      const next = await api.workflows.updateSchedule(workflow.id, schedule.id, { enabled: !schedule.enabled });
      setSchedules((current) => current.map((item) => item.id === next.id ? next : item));
    } catch (reason) {
      const message = reason instanceof Error && reason.message.trim()
        ? reason.message
        : (isChinese ? '更新调度状态失败' : 'Failed to update schedule state');
      setError(message);
      notify(message);
    }
  }, [api, isChinese, notify, workflow]);

  const remove = useCallback(async () => {
    if (!workflow || !api || !deleteId) return;
    try {
      await api.workflows.deleteSchedule(workflow.id, deleteId);
      setSchedules((current) => current.filter((item) => item.id !== deleteId));
      if (editingId === deleteId) reset();
      setDeleteId(null);
      notify(isChinese ? '工作流调度已删除' : 'Workflow schedule deleted');
    } catch (reason) {
      const message = reason instanceof Error && reason.message.trim()
        ? reason.message
        : (isChinese ? '删除工作流调度失败' : 'Failed to delete workflow schedule');
      setError(message);
      notify(message);
    }
  }, [api, deleteId, editingId, isChinese, notify, reset, workflow]);

  return (
    <>
      <PreviewModal onClose={onClose} open={open} title={isChinese ? '工作流定时调度' : 'Workflow schedules'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <PreviewText variant="muted">
            {isChinese
              ? `Hermes Studio 服务端持有调度，Profile：${workflow?.profile || profile}。手机离线不会中断已排队运行。`
              : `Schedules are owned by Hermes Studio. Profile: ${workflow?.profile || profile}; going offline does not cancel queued runs.`}
          </PreviewText>
          {error ? <Text style={[styles.error, { color: tokens.colors.destructive }]}>{error}</Text> : null}
          <View style={styles.toolbar}>
            <NativeButton ghost disabled={loading} onPress={() => { void refresh(); }} prefix={<RefreshCw />} size="sm">
              {isChinese ? '刷新' : 'Refresh'}
            </NativeButton>
            <NativeButton ghost onPress={() => reset()} prefix={<Plus />} size="sm">
              {isChinese ? '新建调度' : 'New schedule'}
            </NativeButton>
          </View>
          {schedules.length ? schedules.map((schedule) => (
            <View key={schedule.id} style={[styles.scheduleCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
              <View style={styles.scheduleHeader}>
                <View style={styles.scheduleCopy}>
                  <Text style={[styles.scheduleTitle, { color: tokens.colors.foreground }]}>{schedule.schedule}</Text>
                  <Text style={[styles.scheduleMeta, { color: tokens.colors.textTertiary }]}>
                    {schedule.timezone} · {schedule.enabled ? (isChinese ? '已启用' : 'Enabled') : (isChinese ? '已停用' : 'Disabled')}
                  </Text>
                  <Text style={[styles.scheduleMeta, { color: tokens.colors.textTertiary }]}>
                    {isChinese ? '下次' : 'Next'}: {formatTime(schedule.next_run_at)} · {isChinese ? '上次' : 'Last'}: {formatTime(schedule.last_scheduled_at)}
                  </Text>
                  {schedule.last_error ? <Text style={[styles.error, { color: tokens.colors.destructive }]}>{schedule.last_error}</Text> : null}
                </View>
                <CalendarClock color={schedule.enabled ? tokens.colors.success : tokens.colors.textTertiary} size={18} />
              </View>
              <View style={styles.toolbar}>
                <NativeButton ghost onPress={() => reset(schedule)} size="sm">{isChinese ? '编辑' : 'Edit'}</NativeButton>
                <NativeButton ghost onPress={() => { void toggle(schedule); }} size="sm">{schedule.enabled ? (isChinese ? '停用' : 'Disable') : (isChinese ? '启用' : 'Enable')}</NativeButton>
                <IOSPressable accessibilityLabel={isChinese ? '删除调度' : 'Delete schedule'} onPress={() => setDeleteId(schedule.id)} style={styles.iconButton}>
                  <Trash2 color={tokens.colors.destructive} size={15} />
                </IOSPressable>
              </View>
            </View>
          )) : (
            <PreviewText variant="muted">{loading ? (isChinese ? '读取中…' : 'Loading…') : (isChinese ? '尚未配置调度' : 'No schedules configured')}</PreviewText>
          )}
          <View style={[styles.form, { borderColor: tokens.colors.border }]}>
            <Text style={[styles.formTitle, { color: tokens.colors.foreground }]}>{editingId ? (isChinese ? '编辑调度' : 'Edit schedule') : (isChinese ? '新建调度' : 'New schedule')}</Text>
            <TextInput onChangeText={(schedule) => setDraft((current) => ({ ...current, schedule }))} placeholder="@daily / 0 9 * * *" placeholderTextColor={tokens.colors.textTertiary} style={[styles.input, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]} value={draft.schedule} />
            <TextInput onChangeText={(timezone) => setDraft((current) => ({ ...current, timezone }))} placeholder={isChinese ? '时区，例如 Asia/Shanghai' : 'Timezone, e.g. Asia/Shanghai'} placeholderTextColor={tokens.colors.textTertiary} style={[styles.input, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]} value={draft.timezone} />
            <TextInput multiline onChangeText={(input) => setDraft((current) => ({ ...current, input }))} placeholder={isChinese ? '定时运行的初始输入（可选）' : 'Initial workflow input (optional)'} placeholderTextColor={tokens.colors.textTertiary} style={[styles.input, styles.largeInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]} value={draft.input} />
            <TextInput onChangeText={(startNodeIds) => setDraft((current) => ({ ...current, startNodeIds }))} placeholder={isChinese ? '起始节点 ID，逗号分隔（可选）' : 'Start node IDs, comma separated (optional)'} placeholderTextColor={tokens.colors.textTertiary} style={[styles.input, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]} value={draft.startNodeIds} />
            <TextInput keyboardType="decimal-pad" onChangeText={(timeoutMinutes) => setDraft((current) => ({ ...current, timeoutMinutes }))} placeholder={isChinese ? '超时分钟（可选）' : 'Timeout minutes (optional)'} placeholderTextColor={tokens.colors.textTertiary} style={[styles.input, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]} value={draft.timeoutMinutes} />
            <View style={styles.toolbar}>
              <NativeButton ghost onPress={() => reset()} size="sm">{isChinese ? '清空' : 'Reset'}</NativeButton>
              <NativeButton disabled={!api || saving} loading={saving} onPress={() => { void save(); }} prefix={<Save />} size="sm">{isChinese ? '保存调度' : 'Save schedule'}</NativeButton>
            </View>
          </View>
        </ScrollView>
      </PreviewModal>
      <ConfirmDialog
        cancelLabel={isChinese ? '取消' : 'Cancel'}
        confirmLabel={isChinese ? '删除' : 'Delete'}
        description={isChinese ? '删除后服务器不会再触发这个工作流。' : 'The server will stop triggering this workflow schedule.'}
        destructive
        onCancel={() => setDeleteId(null)}
        onConfirm={() => { void remove(); }}
        open={Boolean(deleteId)}
        title={isChinese ? '删除调度？' : 'Delete schedule?'}
      />
    </>
  );
}

function formatTime(value: number | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

const styles = {
  content: { gap: 10, padding: 14, paddingBottom: 32 },
  toolbar: { alignItems: 'center' as const, flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  error: { fontSize: 11, lineHeight: 16 },
  scheduleCard: { borderRadius: 10, borderWidth: 1, gap: 8, padding: 10 },
  scheduleHeader: { alignItems: 'flex-start' as const, flexDirection: 'row' as const, gap: 8 },
  scheduleCopy: { flex: 1, minWidth: 0 },
  scheduleTitle: { fontSize: 13, fontWeight: '700' as const },
  scheduleMeta: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  iconButton: { alignItems: 'center' as const, borderRadius: 7, justifyContent: 'center' as const, minHeight: 28, minWidth: 28 },
  form: { borderRadius: 10, borderWidth: 1, gap: 7, marginTop: 4, padding: 10 },
  formTitle: { fontSize: 12, fontWeight: '700' as const },
  input: { borderRadius: 8, borderWidth: 1, fontSize: 12, minHeight: 38, paddingHorizontal: 9, paddingVertical: 7 },
  largeInput: { minHeight: 70, textAlignVertical: 'top' as const },
};
