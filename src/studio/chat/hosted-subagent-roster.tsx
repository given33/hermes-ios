import { memo, useState } from 'react';
import { ChevronDown, Send, Square } from 'lucide-react-native';
import { Text, TextInput, View } from 'react-native';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import type { HostedSubagentProjection } from '../../api/hosted-runtime-types';

export const HostedSubagentRoster = memo(function HostedSubagentRoster({
  isChinese,
  onSteerSubagent,
  onStopSubagent,
  subagents,
}: {
  isChinese: boolean;
  onSteerSubagent?(subagentId: string, message: string): void;
  onStopSubagent?(subagentId: string): void;
  subagents: HostedSubagentProjection[];
}) {
  const { tokens } = useTheme();
  const [openId, setOpenId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <View style={{ borderTopColor: multiplyAlpha(tokens.colors.textTertiary, 0.18), borderTopWidth: 1, flex: 1, gap: 6, marginTop: 7, paddingTop: 7 }}>
      {subagents.map((subagent) => {
        const expanded = openId === subagent.subagentId;
        const terminal = subagent.terminal;
        const canSteer = Boolean(onSteerSubagent && subagent.acceptingSteer && !terminal);
        const canStop = Boolean(onStopSubagent && !terminal);
        const statusColor = terminal
          ? subagent.status === 'failed' ? tokens.colors.destructive : tokens.colors.success
          : subagent.status === 'stopping' ? tokens.colors.destructive : '#D28B22';
        const draft = drafts[subagent.subagentId] || '';
        const submitSteer = () => {
          const message = draft.trim();
          if (!message || !canSteer) return;
          onSteerSubagent?.(subagent.subagentId, message);
          setDrafts((current) => ({ ...current, [subagent.subagentId]: '' }));
        };
        return (
          <View key={subagent.subagentId} style={{ borderColor: multiplyAlpha(statusColor, 0.3), borderRadius: 7, borderWidth: 1, gap: 6, paddingHorizontal: 8, paddingVertical: 7 }}>
            <IOSPressable
              accessibilityLabel={expanded ? (isChinese ? '收起子代理记录' : 'Collapse worker transcript') : (isChinese ? '展开子代理记录' : 'Expand worker transcript')}
              haptic="selection"
              onPress={() => setOpenId((current) => current === subagent.subagentId ? '' : subagent.subagentId)}
              style={{ alignItems: 'center', flexDirection: 'row', gap: 7 }}
            >
              <View style={{ backgroundColor: multiplyAlpha(statusColor, 0.16), borderRadius: 4, height: 8, width: 8 }} />
              <Text numberOfLines={1} style={{ color: tokens.colors.textSecondary, flex: 1, fontSize: 11, fontWeight: '600' }}>
                {subagent.name || subagent.goal || subagent.subagentId}
              </Text>
              <Text style={{ color: statusColor, fontSize: 10 }}>
                {subagentStatusLabel(subagent.status, isChinese)}
              </Text>
              {typeof subagent.runningSeconds === 'number' ? (
                <Text style={{ color: tokens.colors.textTertiary, fontSize: 9 }}>
                  {Math.max(0, Math.round(subagent.runningSeconds))}s
                </Text>
              ) : null}
              <ChevronDown color={tokens.colors.textTertiary} size={14} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
            </IOSPressable>
            {subagent.goal && subagent.name ? (
              <Text numberOfLines={2} style={{ color: tokens.colors.textTertiary, fontSize: 10, lineHeight: 14 }}>
                {subagent.goal}
              </Text>
            ) : null}
            {subagent.partialResult ? (
              <Text numberOfLines={4} style={{ color: tokens.colors.textSecondary, fontSize: 10.5, lineHeight: 15 }}>
                {subagent.partialResult}
              </Text>
            ) : null}
            {expanded ? (
              <>
                <View style={{ gap: 3 }}>
                  {subagent.transcript.slice(-12).map((entry) => (
                    <Text key={entry.eventId} numberOfLines={3} style={{ color: tokens.colors.textTertiary, fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 9, lineHeight: 13 }}>
                      {entry.text}
                    </Text>
                  ))}
                  {!subagent.transcript.length ? (
                    <Text style={{ color: tokens.colors.textTertiary, fontSize: 10 }}>
                      {isChinese ? '暂无实时记录' : 'No live transcript yet'}
                    </Text>
                  ) : null}
                </View>
                {!terminal ? (
                  <View style={{ alignItems: 'center', flexDirection: 'row', gap: 5 }}>
                    <TextInput
                      editable={canSteer}
                      onChangeText={(text) => setDrafts((current) => ({ ...current, [subagent.subagentId]: text }))}
                      onSubmitEditing={submitSteer}
                      placeholder={isChinese ? '给 worker 新指令' : 'Redirect worker'}
                      placeholderTextColor={tokens.colors.textTertiary}
                      returnKeyType="send"
                      style={{ backgroundColor: multiplyAlpha(tokens.colors.textTertiary, 0.08), borderRadius: 5, color: tokens.colors.foreground, flex: 1, fontSize: 10, minHeight: 30, paddingHorizontal: 7, paddingVertical: 4 }}
                      value={draft}
                    />
                    <IOSPressable
                      accessibilityLabel={isChinese ? '发送指令给子代理' : 'Send direction to worker'}
                      disabled={!canSteer || !draft.trim()}
                      haptic="light"
                      onPress={submitSteer}
                      style={{ alignItems: 'center', backgroundColor: canSteer && draft.trim() ? tokens.colors.primary : tokens.colors.textDisabled, borderRadius: 5, height: 30, justifyContent: 'center', width: 30 }}
                    >
                      <Send color={tokens.colors.primaryForeground} size={14} />
                    </IOSPressable>
                    <IOSPressable
                      accessibilityLabel={isChinese ? '停止子代理' : 'Stop worker'}
                      disabled={!canStop}
                      haptic="medium"
                      onPress={() => onStopSubagent?.(subagent.subagentId)}
                      style={{ alignItems: 'center', backgroundColor: canStop ? multiplyAlpha(tokens.colors.destructive, 0.14) : tokens.colors.textDisabled, borderRadius: 5, height: 30, justifyContent: 'center', width: 30 }}
                    >
                      <Square color={canStop ? tokens.colors.destructive : tokens.colors.textTertiary} fill={canStop ? tokens.colors.destructive : 'transparent'} size={12} />
                    </IOSPressable>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
});

function subagentStatusLabel(
  status: HostedSubagentProjection['status'],
  isChinese: boolean,
): string {
  const labels: Record<HostedSubagentProjection['status'], string> = {
    queued: isChinese ? '排队' : 'queued',
    running: isChinese ? '运行中' : 'running',
    steering: isChinese ? '指令已排队' : 'steering',
    stopping: isChinese ? '停止中' : 'stopping',
    completed: isChinese ? '完成' : 'done',
    failed: isChinese ? '失败' : 'failed',
    cancelled: isChinese ? '已停止' : 'stopped',
    unknown: isChinese ? '未知' : 'unknown',
  };
  return labels[status];
}
