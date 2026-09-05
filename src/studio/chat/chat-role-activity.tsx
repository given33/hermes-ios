import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Activity as ActivityIcon } from 'lucide-react-native';
import Reanimated, { Easing, FadeIn, FadeOut } from 'react-native-reanimated';
import {
  activityDisplayContent,
  messageIsRunning,
  type HermesChatActivity as ChatActivity,
  type HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { multiplyAlpha } from '../../design/control-contracts';
import { IOS_MOTION } from '../../design/ios-motion';
import { useMotion } from '../../design/motion';
import { useTheme } from '../../design/ThemeProvider';
import { ReasoningSection } from '../ReasoningSection';
import { AnimatedChevron, WorkflowTimeline } from '../WorkflowTimeline';
import {
  activityIsRunning,
  reasoningElapsedLabel,
  turnPhaseChip,
  turnTimingLine,
} from '../workflow-timeline-model';
import { styles } from './chat-presentation-styles';
import type {
  HostedRuntimeProjection,
} from '../../api/hosted-runtime-types';
import { HostedSubagentRoster } from './hosted-subagent-roster';
import { HostedTrajectoryViewer } from './hosted-trajectory-viewer';
const IOS_STANDARD_EASING = Easing.bezier(...IOS_MOTION.curve.standard);
const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);
const AwaitingChoiceCard = memo(function AwaitingChoiceCard({
  activity,
  isChinese,
  onChoiceInputFocus,
  onRespondToChoice,
}: {
  activity: ChatActivity;
  isChinese: boolean;
  onChoiceInputFocus(): void;
  onRespondToChoice?(activityId: string, text: string): void;
}) {
  const { tokens } = useTheme();
  const [custom, setCustom] = useState('');
  const [localAnswered, setLocalAnswered] = useState(false);
  const options = activity.options || [];
  const question = activity.question || activity.preview || activity.name;
  const answered = localAnswered || activity.status === 'completed';
  const submitChoice = (text: string) => {
    setLocalAnswered(true);
    onRespondToChoice?.(activity.id, text);
  };
  return (
    <View
      style={[
        styles.subagentCard,
        {
          backgroundColor: multiplyAlpha('#D28B22', 0.07),
          borderColor: multiplyAlpha('#D28B22', 0.4),
        },
      ]}
    >
      <View style={styles.subagentHeader}>
        <View style={[styles.subagentIcon, { backgroundColor: multiplyAlpha('#D28B22', 0.16) }]}>
          <Text style={{ fontSize: 11, lineHeight: 14 }}>❓</Text>
        </View>
        <Text style={[styles.subagentName, { color: tokens.colors.textSecondary }]}>
          {isChinese ? '需要你决定方向' : 'Needs your decision'}
        </Text>
      </View>
      <Text numberOfLines={6} style={[styles.subagentSummary, { color: tokens.colors.textSecondary }]}>
        {question}
      </Text>
      {!answered && options.length ? (
        <View style={styles.choiceOptions}>
          {options.map((option) => (
            <IOSPressable
              accessibilityLabel={option.label}
              haptic="selection"
              key={option.id}
              onPress={() => submitChoice(`${option.id}. ${option.label}`)}
              style={[styles.choiceOption, { borderColor: multiplyAlpha(tokens.colors.primary, 0.4) }]}
            >
              <Text style={[styles.choiceOptionKey, { color: tokens.colors.primary }]}>{option.id}</Text>
              <Text numberOfLines={2} style={[styles.choiceOptionLabel, { color: tokens.colors.textSecondary }]}>
                {option.label}
              </Text>
            </IOSPressable>
          ))}
        </View>
      ) : null}
      {!answered ? (
        <View style={styles.choiceCustomRow}>
          <TextInput
            onChangeText={setCustom}
            onFocus={onChoiceInputFocus}
            placeholder={isChinese ? '或输入你自己的回答…' : 'Or type your own answer…'}
            placeholderTextColor={tokens.colors.textTertiary}
            style={[styles.choiceCustomInput, { borderColor: multiplyAlpha(tokens.colors.primary, 0.3), color: tokens.colors.textSecondary }]}
            value={custom}
          />
          <IOSPressable
            accessibilityLabel={isChinese ? '发送自定义回答' : 'Send custom answer'}
            disabled={!custom.trim()}
            onPress={() => {
              const text = custom.trim();
              if (text) submitChoice(text);
            }}
            style={[styles.choiceCustomSend, { backgroundColor: custom.trim() ? tokens.colors.primary : tokens.colors.textDisabled }]}
          >
            <Text style={{ color: tokens.colors.primaryForeground, fontSize: 12, fontWeight: '600' }}>
              {isChinese ? '发送' : 'Send'}
            </Text>
          </IOSPressable>
        </View>
      ) : null}
    </View>
  );
});
/**
 * Agent roster: every subagent spawned during the conversation (live or
 * historical), grouped by name — the mobile equivalent of the pi Agent Hub
 * side list. Each row shows the agent's name, live state and latest
 * activity; the creator (manager/worker) is the one who steers/kills/waits,
 * so this list is informational and drillable.
 */
export function AgentRoster({
  isChinese,
  messages,
}: {
  isChinese: boolean;
  messages: ChatMessage[];
}) {
  const { tokens } = useTheme();
  const [openAgents, setOpenAgents] = useState<Set<string>>(() => new Set());
  const roster = useMemo(() => {
    // Group every subagent activity by identity (name or child session).
    // Each group keeps the full activity timeline — tapping a row opens the
    // agent's session window: its complete run, step by step.
    const groups = new Map<string, ChatActivity[]>();
    const names = new Map<string, string>();
    for (const message of messages) {
      for (const activity of message.activities || []) {
        if (activity.category !== 'subagent') continue;
        // Persisted ids are `remote-subagent:{profile}:{index}:{goal}` —
        // truncating at the first colon merges every historical subagent
        // into one row. Keep the full id for those; live events group by
        // their agentName.
        const idSegments = activity.id.split(':');
        const stableIdKey = idSegments[0] === 'remote-subagent'
          ? activity.id
          : idSegments[0] || activity.id;
        const key = activity.agentName
          || stableIdKey
          || activity.name
          || activity.id;
        if (activity.agentName) names.set(key, activity.agentName);
        const list = groups.get(key) || [];
        list.push(activity);
        groups.set(key, list);
      }
    }
    return Array.from(groups.entries()).map(([key, list]) => {
      list.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
      const latest = list[list.length - 1];
      return { key, name: names.get(key) || latest.name || key, latest, list };
    });
  }, [messages]);
  if (!roster.length) return null;
  const toggle = (key: string) => {
    setOpenAgents((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
    <View style={[styles.rosterPanel, { borderColor: multiplyAlpha(tokens.colors.textTertiary, 0.25) }]}>
      <Text style={[styles.subagentSummaryLabel, { color: tokens.colors.textTertiary }]}>
        {isChinese ? '智能体名册 · 点击查看运行过程' : 'Agent roster · tap for the run'}
      </Text>
      {roster.map(({ key, name, latest, list }) => {
        const running = activityIsRunning(latest);
        const failed = latest.status === 'failed' || latest.status === 'cancelled';
        const color = failed ? tokens.colors.destructive : running ? '#D28B22' : tokens.colors.success;
        const open = openAgents.has(key);
        return (
          <View key={key}>
            <IOSPressable
              accessibilityLabel={isChinese ? '查看子代理会话' : 'Open agent session'}
              haptic="selection"
              onPress={() => toggle(key)}
              style={styles.rosterRow}
            >
              <View style={[styles.rosterDot, { backgroundColor: color }]} />
              <Text numberOfLines={1} style={[styles.rosterName, { color: tokens.colors.textSecondary }]}>
                {name}
              </Text>
              <Text numberOfLines={1} style={[styles.rosterState, { color }]}>
                {failed
                  ? (isChinese ? '已终止' : 'dead')
                  : running
                    ? (isChinese ? '运行中' : 'running')
                    : (isChinese ? '已完成' : 'done')}
              </Text>
            </IOSPressable>
            {open ? (
              <View style={styles.rosterTimeline}>
                {list.map((activity, index) => (
                  <View key={activity.id} style={styles.rosterEventRow}>
                    <Text style={[styles.rosterEventIndex, { color: tokens.colors.textTertiary }]}>
                      {index + 1}
                    </Text>
                    <Text numberOfLines={2} style={[styles.rosterEventText, { color: tokens.colors.textTertiary }]}>
                      {activityDetailLine(activity)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
/** One-line per subagent activity: what happened (tool/text/result). */
function activityDetailLine(activity: ChatActivity): string {
  const status = activity.status === 'running' ? '…' : activity.status === 'failed' ? '✗' : '✓';
  const text = activity.output || activity.preview || activity.detail || activity.name;
  return `${status} ${text.slice(0, 160)}`;
}
/** Context-window usage ring beside the composer. Shows the latest member's
 *  reported context usage; honest `—` when no metric has arrived. */
export function ContextUsageRing({
  isChinese,
  value,
}: {
  isChinese: boolean;
  value?: number;
}) {
  const { tokens } = useTheme();
  const percent = typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(100, Math.round(value))
    : null;
  const color = percent === null
    ? tokens.colors.textTertiary
    : percent >= 85
      ? tokens.colors.destructive
      : percent >= 70
        ? '#D28B22'
        : tokens.colors.success;
  return (
    <View
      accessible
      accessibilityLabel={percent === null
        ? (isChinese ? '上下文使用率未知' : 'Context usage unavailable')
        : (isChinese ? `上下文使用率 ${percent}%` : `Context usage ${percent}%`)}
      style={[styles.contextRing, { borderColor: multiplyAlpha(color, 0.5) }]}
    >
      <Text style={[styles.contextRingText, { color }]}>
        {percent === null ? '—' : `${percent}%`}
      </Text>
      <Text style={[styles.contextRingLabel, { color }]}>
        {isChinese ? '上下文' : 'ctx'}
      </Text>
    </View>
  );
}
/**
 * Team status bar: one glanceable line summarizing member states —
 * how many are working, how many finished, how many need attention.
 */
export function TeamStatusBar({
  isChinese,
  messages,
  reconnectAttempt = 0,
  runtime,
  onSteerSubagent,
  onStopSubagent,
}: {
  isChinese: boolean;
  messages: ChatMessage[];
  reconnectAttempt?: number;
  runtime?: HostedRuntimeProjection;
  onSteerSubagent?(subagentId: string, message: string): void;
  onStopSubagent?(subagentId: string): void;
}) {
  const { tokens } = useTheme();
  const [rosterOpen, setRosterOpen] = useState(false);
  const [trajectoryOpen, setTrajectoryOpen] = useState(false);
  const { working, done, awaiting, corrective, subagents } = useMemo(() => {
    let workingCount = 0;
    let doneCount = 0;
    let awaitingCount = 0;
    let correctiveCount = 0;
    let subagentCount = 0;
    // Attention counters (awaiting/corrective) are scoped to the live turn:
    // historical verdicts and answered questions must not accumulate forever.
    const currentTurnId = [...messages].reverse().find(
      (message) => message.runtimeTurnId,
    )?.runtimeTurnId;
    for (const message of messages) {
      if (message.role === 'user') continue;
      const isTeamMember = Boolean(
        message.memberId
        || message.roleStage === 'worker'
        || message.roleStage === 'reviewer'
        || message.activities?.some((activity) => activity.category === 'subagent'),
      );
      const inCurrentTurn = !currentTurnId || message.runtimeTurnId === currentTurnId;
      if (isTeamMember && (message.status === 'running' || message.status === 'streaming')) {
        workingCount += 1;
      } else if (isTeamMember && message.status === 'completed') {
        doneCount += 1;
      }
      for (const activity of message.activities || []) {
        if (activity.category === 'awaiting' && activity.status !== 'completed' && inCurrentTurn) {
          awaitingCount += 1;
        }
        if (
          activity.category === 'status'
          && (activity.severity || '').toLowerCase() === 'corrective'
          && inCurrentTurn
        ) {
          correctiveCount += 1;
        }
        if (activity.category === 'subagent') {
          subagentCount += 1;
        }
      }
    }
    return {
      working: workingCount,
      done: doneCount,
      awaiting: awaitingCount,
      corrective: correctiveCount,
      subagents: subagentCount,
    };
  }, [messages]);
  const runtimeComponents = Object.values(runtime?.components || {});
  const runtimeProviders = Object.values(runtime?.providers || {});
  const runtimeWaiting = runtimeComponents.filter((item) => item.lifecycle === 'waiting').length;
  const runtimeUnloading = runtimeComponents.filter((item) => item.lifecycle === 'unloading' || item.lifecycle === 'leaving').length;
  const runtimeDraining = runtimeProviders.filter((item) => item.status === 'draining').length;
  const runtimeDegraded = runtimeProviders.filter((item) => item.status === 'unhealthy').length;
  const runtimeSubagents = Object.values(runtime?.subagents || {});
  const runtimeSubagentCount = runtimeSubagents.length;
  const trajectory = runtime?.trajectory;
  const hasTrajectory = Boolean(trajectory && trajectory.records.length);
  const hasRuntime = Boolean(runtime && (
    runtimeComponents.length > 0
    || runtimeProviders.length > 0
    || runtime.terminal
    || runtime.hasGap
    || runtime.resetRequired
    || hasTrajectory
  ));
  if (!working && !done && !awaiting && !subagents && !runtimeSubagentCount && !corrective && !hasRuntime && !reconnectAttempt) return null;
  const parts: string[] = [];
  if (working) parts.push(`${working} ${isChinese ? '成员干活' : 'working'}`);
  if (done) parts.push(`${done} ${isChinese ? '成员完成' : 'done'}`);
  if (awaiting) parts.push(`${awaiting} ${isChinese ? '等你决定' : 'awaiting you'}`);
  if (corrective) parts.push(`${corrective} ${isChinese ? '需整改' : 'corrective'}`);
  if (runtimeWaiting) parts.push(`${runtimeWaiting} waiting`);
  if (runtimeDraining) parts.push(`${runtimeDraining} draining`);
  if (runtimeUnloading) parts.push(`${runtimeUnloading} unloading`);
  if (runtimeDegraded) parts.push(`${runtimeDegraded} degraded`);
  if (runtimeSubagentCount) parts.push(`${runtimeSubagentCount} workers`);
  if (reconnectAttempt) parts.push(`reconnect ${reconnectAttempt}`);
  if (runtime?.terminal) parts.push('terminal confirmed');
  return (
    <View style={[styles.teamStatusBar, { backgroundColor: tokens.colors.card, borderColor: multiplyAlpha(tokens.colors.textTertiary, 0.25) }]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: working ? '#D28B22' : tokens.colors.success }} />
      <Text style={[styles.teamStatusText, { color: tokens.colors.textSecondary }]}>
        {parts.join(' · ')}
      </Text>
      {subagents || runtimeSubagentCount ? (
        <IOSPressable
          accessibilityLabel={isChinese ? '展开智能体名册' : 'Open agent roster'}
          haptic="selection"
          onPress={() => setRosterOpen((current) => !current)}
          style={[styles.rosterToggle, { borderColor: multiplyAlpha(tokens.colors.textTertiary, 0.35) }]}
        >
          <Text style={[styles.rosterToggleText, { color: tokens.colors.textSecondary }]}>
            {isChinese ? `智能体 ${subagents}` : `agents ${subagents}`}
          </Text>
        </IOSPressable>
      ) : null}
      {rosterOpen ? (
        <>
          {subagents ? <AgentRoster isChinese={isChinese} messages={messages} /> : null}
          {runtimeSubagentCount ? (
            <HostedSubagentRoster
              isChinese={isChinese}
              onSteerSubagent={onSteerSubagent}
              onStopSubagent={onStopSubagent}
              subagents={runtimeSubagents}
            />
          ) : null}
        </>
      ) : null}
      {hasTrajectory ? (
        <IOSPressable
          accessibilityLabel={isChinese ? '打开执行轨迹' : 'Open trajectory'}
          haptic="selection"
          onPress={() => setTrajectoryOpen((current) => !current)}
          style={[styles.rosterToggle, { borderColor: multiplyAlpha(tokens.colors.textTertiary, 0.35) }]}
        >
          <ActivityIcon color={tokens.colors.primary} size={14} />
        </IOSPressable>
      ) : null}
      {trajectoryOpen && trajectory ? (
        <HostedTrajectoryViewer isChinese={isChinese} trajectory={trajectory} />
      ) : null}
    </View>
  );
}
/*
            <IOSPressable
              accessibilityLabel={expanded ? (isChinese ? '收起子代理记录' : 'Collapse worker transcript') : (isChinese ? '展开子代理记录' : 'Expand worker transcript')}
                      {isChinese ? '暂无实时记录' : 'No live transcript yet'}
                      placeholder={isChinese ? '给 worker 新指令' : 'Redirect worker'}
                      accessibilityLabel={isChinese ? '发送指令给子代理' : 'Send direction to worker'}
                      accessibilityLabel={isChinese ? '停止子代理' : 'Stop worker'}

    queued: isChinese ? '排队' : 'queued',
    running: isChinese ? '运行中' : 'running',
    steering: isChinese ? '指令已排队' : 'steering',
    stopping: isChinese ? '停止中' : 'stopping',
    completed: isChinese ? '完成' : 'done',
    failed: isChinese ? '失败' : 'failed',
    cancelled: isChinese ? '已停止' : 'stopped',
    unknown: isChinese ? '未知' : 'unknown',
*/
// One module-level ticker serves every running activity group: N parallel
// members must not spawn N intervals each re-rendering whole message groups.
let sharedNowInterval: ReturnType<typeof setInterval> | null = null;
let sharedNowSubscriberCount = 0;
const sharedNowListeners = new Set<(now: number) => void>();
function subscribeSharedNow(listener: (now: number) => void): () => void {
  sharedNowListeners.add(listener);
  sharedNowSubscriberCount += 1;
  if (sharedNowInterval === null) {
    sharedNowInterval = setInterval(() => {
      const now = Date.now();
      for (const current of sharedNowListeners) current(now);
    }, 1_000);
  }
  return () => {
    sharedNowListeners.delete(listener);
    sharedNowSubscriberCount -= 1;
    if (sharedNowSubscriberCount <= 0 && sharedNowInterval !== null) {
      clearInterval(sharedNowInterval);
      sharedNowInterval = null;
    }
  };
}

const TimingLabel = memo(function TimingLabel({
  isChinese,
  message,
  now,
}: {
  isChinese: boolean;
  message: ChatMessage;
  now: number;
}) {
  const { tokens } = useTheme();
  return (
    <Text numberOfLines={1} style={[styles.activityTitle, { color: tokens.colors.textSecondary }]}>
      {turnTimingLine(message, isChinese, now)}
    </Text>
  );
});
/**
 * One subscription per running group, one interval for the whole screen.
 * `now` comes from the group's gated `useNowTicker(running)` so settled
 * groups never subscribe and the shared interval idles when nothing runs.
 */
function useNowTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return undefined;
    return subscribeSharedNow(setNow);
  }, [active]);
  return now;
}

export const RoleActivityGroup = memo(function RoleActivityGroup({  isChinese,
  message,
  onChoiceInputFocus,
  onCloseActivity,
  onInspectActivity,
  onRespondToChoice,
}: {
  isChinese: boolean;
  message: ChatMessage;
  onChoiceInputFocus(): void;
  onCloseActivity(): void;
  onInspectActivity(): void;
  onRespondToChoice?(activityId: string, text: string): void;
}) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const [open, setOpen] = useState(false);
  const manualPinRef = useRef(false);
  const activities = message.activities || [];
  const reasoningActivities = activities.filter(
    (activity) => activity.category === 'reasoning',
  );
  const awaitingActivities = activities.filter(
    (activity) => activity.category === 'awaiting',
  );
  const reworkActivities = activities.filter(
    (activity) => activity.category === 'rework',
  );
  const stepActivities = activities.filter(
    (activity) => (
      activity.category !== 'reasoning'
      && activity.category !== 'awaiting'
      && activity.category !== 'rework'
    ),
  );
  const reasoningText = reasoningActivities
    .map((activity) => activityDisplayContent(activity))
    .filter(Boolean)
    .join('\n\n');
  const reasoningRunning = reasoningActivities.some(
    (activity) => activity.status === 'queued' || activity.status === 'running',
  );
  const running = messageIsRunning(message);
  const now = useNowTicker(running);
  // Live workflow display: while the turn runs the activity group stays
  // open so tool calls / searches appear in real time; once the turn ends it
  // collapses by default. A manual tap pins the state until the next turn.
  useEffect(() => {
    if (manualPinRef.current) return;
    setOpen(running);
  }, [running]);
  const phase = turnPhaseChip(message, isChinese);
  const phaseColor = phase.tone === 'failed'
    ? tokens.colors.destructive
    : phase.tone === 'running'
      ? '#D28B22'
      : phase.tone === 'cancelled'
        ? tokens.colors.textTertiary
        : tokens.colors.success;
  const summary = (
    <>
      <View style={[styles.turnPhaseChip, { backgroundColor: multiplyAlpha(phaseColor, 0.12) }]}>
        <View style={[styles.turnPhaseDot, { backgroundColor: phaseColor }]} />
        <Text numberOfLines={1} style={[styles.turnPhaseLabel, { color: phaseColor }]}>
          {phase.label}
        </Text>
      </View>
      <TimingLabel isChinese={isChinese} message={message} now={now} />
      {stepActivities.length ? (
        <Text style={[styles.activityCount, { color: tokens.colors.textTertiary }]}>
          {isChinese ? `${stepActivities.length} 个工具调用` : `${stepActivities.length} tool calls`}
        </Text>
      ) : null}
      {activities.length ? (
        <AnimatedChevron
          color={tokens.colors.textTertiary}
          open={open}
          size={14}
        />
      ) : null}
    </>
  );
  return (
    <View style={styles.activityGroup}>
      {awaitingActivities.length ? (
        <View style={styles.subagentCards}>
          {awaitingActivities.map((activity) => (
            <AwaitingChoiceCard
              activity={activity}
              isChinese={isChinese}
              key={activity.id}
              onChoiceInputFocus={onChoiceInputFocus}
              onRespondToChoice={onRespondToChoice}
            />
          ))}
        </View>
      ) : null}
      {reworkActivities.length ? (
        <View style={styles.subagentCards}>
          {reworkActivities.map((activity) => (
            <View
              key={activity.id}
              style={[styles.subagentCard, { backgroundColor: multiplyAlpha('#D28B22', 0.06), borderColor: multiplyAlpha('#D28B22', 0.35) }]}
            >
              <View style={styles.subagentHeader}>
                <View style={[styles.subagentIcon, { backgroundColor: multiplyAlpha('#D28B22', 0.14) }]}>
                  <Text style={{ fontSize: 11, lineHeight: 14 }}>🔁</Text>
                </View>
                <Text style={[styles.subagentName, { color: tokens.colors.textSecondary }]}>
                  {isChinese ? '返工流程' : 'Rework'}
                </Text>
                <Text style={[styles.subagentStatus, { color: '#D28B22' }]}>
                  {activity.preview === 'started'
                    ? (isChinese ? '正在打回给 worker' : 'sending back to worker')
                    : (isChinese ? '已打回给 worker 重做' : 'worker redoing')}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {stepActivities.length || reasoningActivities.length ? (
        <IOSPressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={isChinese ? '执行步骤' : 'Execution steps'}
          haptic="selection"
          onPress={() => {
            manualPinRef.current = true;
            setOpen((current) => {
              if (current) onCloseActivity();
              else onInspectActivity();
              return !current;
            });
          }}
          style={styles.activitySummary}
        >
          {summary}
        </IOSPressable>
      ) : (
        <View style={styles.activitySummary}>{summary}</View>
      )}
      {open ? (
        <Reanimated.View
          entering={FadeIn
            .duration(motion.fadeDuration(IOS_MOTION.duration.control))
            .easing(IOS_DECELERATE_EASING)}
          exiting={FadeOut
            .duration(motion.fadeDuration(IOS_MOTION.duration.press))
            .easing(IOS_STANDARD_EASING)}
          style={styles.activityTimeline}
        >
          {reasoningText ? (
            <ReasoningSection
              detailStyle={styles.reasoningActivityDetail}
              durationLabel={reasoningElapsedLabel(reasoningActivities, now)}
              isChinese={isChinese}
              onInspectActivity={onInspectActivity}
              running={reasoningRunning}
              text={reasoningText}
            />
          ) : null}
          {stepActivities.length ? (
            <WorkflowTimeline
              activities={stepActivities}
              isChinese={isChinese}
              now={now}
              onInspectActivity={onInspectActivity}
            />
          ) : null}
        </Reanimated.View>
      ) : null}
    </View>
  );
});
