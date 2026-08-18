import { Activity, CircleSlash, Play, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import type { HermesApiClient } from '../../api/HermesApiClient';
import { hermesCloudApiFor } from '../../api/hermes-api-registry';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';

export interface AgentHubPageProps {
  client?: HermesApiClient | null;
  isChinese?: boolean;
  locale?: string;
  notify?(message: string): void;
  profile: string;
}

interface HubRunRow {
  id: string;
  title: string;
  kind: string;
  state: string;
  profile: string;
  detail: string;
  startedAt?: number;
  updatedAt?: number;
  cancelUrl?: string;
  retryUrl?: string;
  conversationId?: string;
  error?: string;
}

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'canceled', 'archived']);
const ACTIVE_POLL_MS = 8_000;

/**
 * Account-level Agent Hub: every live and recent run across profiles in one
 * board, with direct cancel/retry controls. The in-conversation roster
 * (AgentRoster / HostedSubagentRoster) covers one conversation's subagents;
 * this page is the cross-conversation overview the desktop Agent Hub side
 * list provides.
 */
export function AgentHubPage({
  client,
  isChinese,
  locale,
  notify,
  profile,
}: AgentHubPageProps) {
  const chinese = isChinese ?? (locale ?? 'zh') === 'zh';
  const { tokens } = useTheme();
  const [runs, setRuns] = useState<HubRunRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const cloud = useMemo(() => (client ? hermesCloudApiFor(client) : null), [client]);
  const mounted = useRef(true);
  // Monotonic request sequence: a slow response that lands after a newer one
  // is dropped instead of overwriting fresher data.
  const requestSeq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!cloud) return;
    const seq = ++requestSeq.current;
    if (!options.silent) setRefreshing(true);
    try {
      const response = await cloud.getRuntimeRuns(profile) as Record<string, unknown>;
      if (!mounted.current || seq !== requestSeq.current) return;
      const rows = (Array.isArray(response?.runs) ? response.runs : []) as Record<string, unknown>[];
      setRuns(rows.map((entry) => ({
        id: String(entry.id ?? ''),
        title: String(entry.title ?? entry.source_run_id ?? ''),
        kind: String(entry.source ?? ''),
        state: String(entry.status ?? ''),
        profile: String(entry.profile ?? ''),
        detail: String(entry.current_node ?? entry.session_id ?? ''),
        startedAt: Number(entry.started_at) || undefined,
        updatedAt: Number(entry.updated_at) || undefined,
        cancelUrl: entry.cancel_supported === true && typeof entry.cancel_url === 'string'
          ? entry.cancel_url
          : undefined,
        retryUrl: entry.retry_supported === true && typeof entry.retry_url === 'string'
          ? entry.retry_url
          : undefined,
        conversationId: typeof entry.conversation_id === 'string' ? entry.conversation_id : undefined,
        error: typeof entry.error === 'string' ? entry.error : undefined,
      })));
      setError(null);
    } catch (reason) {
      if (mounted.current && seq === requestSeq.current) {
        setError(String((reason as Error)?.message || reason));
      }
    } finally {
      // The newest request owns the spinner state regardless of its own
      // mode: otherwise a manual refresh overtaken by a silent poll leaves
      // refreshing stuck on.
      if (mounted.current && seq === requestSeq.current) {
        setRefreshing(false);
      }
    }
  }, [cloud, profile]);

  useEffect(() => { void load(); }, [load]);

  const hasActive = runs.some((run) => !TERMINAL_STATES.has(run.state.toLowerCase()));
  useEffect(() => {
    if (!hasActive) return;
    // Silent polling: never drives the pull-to-refresh spinner.
    const timer = setInterval(() => { void load({ silent: true }); }, ACTIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  const control = useCallback(async (run: HubRunRow, action: 'cancel' | 'retry') => {
    if (!cloud) return;
    const url = action === 'cancel' ? run.cancelUrl : run.retryUrl;
    if (!url) return;
    setBusyIds((current) => new Set(current).add(run.id));
    try {
      if (action === 'cancel') {
        await cloud.cancelRuntimeRun(url, `hub-cancel-${run.id}`);
      } else {
        await cloud.retryRuntimeRun(url, `hub-retry-${run.id}`);
      }
      await load({ silent: true });
    } catch (reason) {
      notify?.(String((reason as Error)?.message || reason));
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(run.id);
        return next;
      });
    }
  }, [cloud, load, notify]);

  const active = runs.filter((run) => !TERMINAL_STATES.has(run.state.toLowerCase()));
  const recent = runs.filter((run) => TERMINAL_STATES.has(run.state.toLowerCase()));

  return (
    <View style={{ flex: 1, backgroundColor: tokens.colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void load(); }} tintColor={tokens.colors.primary} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Activity color={tokens.colors.primary} size={18} />
          <Text style={{ color: tokens.colors.foreground, fontSize: 17, fontWeight: '600' }}>
            Agent Hub
          </Text>
          <Text style={{ color: tokens.colors.textTertiary, fontSize: 13 }}>
            {chinese ? `${active.length} 运行中 · ${recent.length} 已结束` : `${active.length} active · ${recent.length} done`}
          </Text>
        </View>
        {error ? (
          <Text style={{ color: tokens.colors.destructive, fontSize: 13 }}>{error}</Text>
        ) : null}
        {!runs.length && !refreshing ? (
          <Text style={{ color: tokens.colors.textSecondary, fontSize: 14 }}>
            {chinese ? '暂无 Agent 运行记录' : 'No agent runs yet'}
          </Text>
        ) : null}
        {active.map((run) => (
          <HubRunCard
            busy={busyIds.has(run.id)}
            chinese={chinese}
            key={run.id}
            onControl={control}
            run={run}
            tokens={tokens}
          />
        ))}
        {recent.length ? (
          <Text style={{ color: tokens.colors.textTertiary, fontSize: 13, marginTop: 4 }}>
            {chinese ? '最近完成' : 'Recently finished'}
          </Text>
        ) : null}
        {recent.slice(0, 30).map((run) => (
          <HubRunCard
            busy={busyIds.has(run.id)}
            chinese={chinese}
            key={run.id}
            onControl={control}
            run={run}
            tokens={tokens}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function HubRunCard({
  busy,
  chinese,
  onControl,
  run,
  tokens,
}: {
  busy: boolean;
  chinese: boolean;
  onControl(run: HubRunRow, action: 'cancel' | 'retry'): void;
  run: HubRunRow;
  tokens: ReturnType<typeof useTheme>['tokens'];
}) {
  const terminal = TERMINAL_STATES.has(run.state.toLowerCase());
  const failed = run.state.toLowerCase() === 'failed';
  return (
    <View
      style={{
        backgroundColor: tokens.colors.card,
        borderColor: multiplyAlpha(failed ? tokens.colors.destructive : tokens.colors.border, failed ? 0.35 : 1),
        borderRadius: 12,
        borderWidth: 1,
        gap: 6,
        padding: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: failed ? tokens.colors.destructive : terminal ? tokens.colors.textSecondary : tokens.colors.primary, fontSize: 13, fontWeight: '600' }}>
          {run.state || 'unknown'}
        </Text>
        {run.kind ? <Text style={{ color: tokens.colors.textTertiary, fontSize: 12 }}>{run.kind}</Text> : null}
        {run.profile ? <Text style={{ color: tokens.colors.textTertiary, fontSize: 12 }}>· {run.profile}</Text> : null}
      </View>
      <Text numberOfLines={2} style={{ color: tokens.colors.foreground, fontSize: 14 }}>
        {run.title || run.id}
      </Text>
      {run.detail ? (
        <Text numberOfLines={1} style={{ color: tokens.colors.textTertiary, fontSize: 12 }}>{run.detail}</Text>
      ) : null}
      {run.error ? (
        <Text numberOfLines={2} style={{ color: tokens.colors.destructive, fontSize: 12 }}>{run.error}</Text>
      ) : null}
      {!terminal || run.retryUrl ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {!terminal && run.cancelUrl ? (
            <IOSPressable
              disabled={busy}
              haptic="selection"
              onPress={() => { void onControl(run, 'cancel'); }}
              style={{ alignItems: 'center', backgroundColor: multiplyAlpha(tokens.colors.destructive, 0.1), borderRadius: 8, flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <CircleSlash color={tokens.colors.destructive} size={13} />
              <Text style={{ color: tokens.colors.destructive, fontSize: 13 }}>{chinese ? '停止' : 'Stop'}</Text>
            </IOSPressable>
          ) : null}
          {run.retryUrl ? (
            <IOSPressable
              disabled={busy}
              haptic="selection"
              onPress={() => { void onControl(run, 'retry'); }}
              style={{ alignItems: 'center', backgroundColor: multiplyAlpha(tokens.colors.primary, 0.1), borderRadius: 8, flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <Play color={tokens.colors.primary} size={13} />
              <Text style={{ color: tokens.colors.primary, fontSize: 13 }}>{chinese ? '重试' : 'Retry'}</Text>
            </IOSPressable>
          ) : null}
          {busy ? (
            <Text style={{ color: tokens.colors.textTertiary, fontSize: 12 }}>
              {chinese ? '处理中…' : 'working…'}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
