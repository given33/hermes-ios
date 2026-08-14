import { Activity } from 'lucide-react-native';
import { memo } from 'react';
import { Text, View } from 'react-native';
import type { HostedTrajectoryProjection, HostedTrajectoryRecord } from '../../api/hosted-runtime-types';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';

export const HostedTrajectoryViewer = memo(function HostedTrajectoryViewer({
  isChinese,
  trajectory,
}: {
  isChinese: boolean;
  trajectory: HostedTrajectoryProjection;
}) {
  const { tokens } = useTheme();
  const records = trajectory.records.slice(-18);
  return (
    <View style={{ borderTopColor: multiplyAlpha(tokens.colors.textTertiary, 0.2), borderTopWidth: 1, gap: 7, marginTop: 8, paddingTop: 8 }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
        <Activity color={tokens.colors.primary} size={14} />
        <Text style={{ color: tokens.colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
          {isChinese ? '执行轨迹' : 'Trajectory'}
        </Text>
        <Text style={{ color: tokens.colors.textTertiary, fontSize: 10 }}>
          {trajectory.stats.records} events / {trajectory.stats.toolCalls} tools
        </Text>
      </View>
      {records.length ? records.map((record) => (
        <TrajectoryRow isChinese={isChinese} key={`${record.eventId}:${record.cursor}`} record={record} />
      )) : (
        <Text style={{ color: tokens.colors.textTertiary, fontSize: 10 }}>
          {isChinese ? '暂无轨迹记录' : 'No trajectory records yet'}
        </Text>
      )}
    </View>
  );
});

const TrajectoryRow = memo(function TrajectoryRow({
  isChinese,
  record,
}: {
  isChinese: boolean;
  record: HostedTrajectoryRecord;
}) {
  const { tokens } = useTheme();
  const color = record.status === 'error'
    ? tokens.colors.destructive
    : record.status === 'running'
      ? '#D28B22'
      : tokens.colors.success;
  const kind = isChinese
    ? ({ tool: '工具', subagent: '子代理', reasoning: '推理', compaction: '压缩', user: '用户', assistant: '助手' } as Record<string, string>)[record.kind]
    : record.kind;
  return (
    <View style={{ alignItems: 'flex-start', flexDirection: 'row', gap: 7 }}>
      <View style={{ backgroundColor: color, borderRadius: 4, height: 8, marginTop: 3, width: 8 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ color: tokens.colors.textSecondary, fontSize: 10, lineHeight: 14 }}>
          {kind} / {record.summary}
        </Text>
        <Text style={{ color: tokens.colors.textTertiary, fontSize: 9 }}>
          #{record.index} · {record.event}{record.durationMs ? ` · ${record.durationMs}ms` : ''}
        </Text>
      </View>
    </View>
  );
});
