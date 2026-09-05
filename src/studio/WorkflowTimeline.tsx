import * as Clipboard from 'expo-clipboard';
import { Check, ChevronDown, Copy, Search, Globe, Terminal, FilePenLine, FileText,
  CalendarClock, Users, Wrench, Clock3, CircleCheck, CircleX, CircleSlash, LoaderCircle,
  ExternalLink } from 'lucide-react-native';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  activityCategoryLabel,
  activityDisplayContent,
  messageStatusLabel,
  type HermesChatActivity as ChatActivity,
} from '../api/chat-view-model';
import { IOSPressable } from '../components/ios/IOSPressable';
import { multiplyAlpha } from '../design/control-contracts';
import { IOS_MOTION } from '../design/ios-motion';
import { useTheme } from '../design/ThemeProvider';
import { useMotion } from '../design/motion';
import { activityDetails, activityDiffText, activityStatusLabel } from './workflow-detail-model';
import {
  activityElapsedLabel,
  activityIsRunning,
  activityPrimaryDetail,
  clampActivityText,
  createTimelineCollapseState,
  groupTimelineActivities,
  isTimelineEntryExpanded,
  timelineCollapseReducer,
  timelineEntryLiveStates,
  timelineGroupElapsedLabel,
  type TimelineCollapseState,
} from './workflow-timeline-model';

const BODY_REGULAR = 'HermesGoogle-IBMPlexSans-400-Normal';
const BODY_SEMIBOLD = 'HermesGoogle-IBMPlexSans-600-Normal';
const MONO_REGULAR = 'HermesTerminal-JetBrainsMono-400-Normal';
const IOS_STANDARD_EASING = Easing.bezier(...IOS_MOTION.curve.standard);
const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);
const RUNNING_COLOR = '#D28B22';

/**
 * One ordered, collapsible tool-activity timeline for an assistant turn.
 * Every step renders collapsed as a single line; the in-flight step is
 * auto-expanded and collapses again once it settles unless the user pinned
 * it by toggling it manually.
 */
export function WorkflowTimeline({
  activities,
  isChinese,
  now,
  onInspectActivity,
}: {
  activities: readonly ChatActivity[];
  isChinese: boolean;
  now: number;
  onInspectActivity(): void;
}) {
  const [collapseState, dispatchCollapse] = useReducer(
    timelineCollapseReducer,
    undefined,
    createTimelineCollapseState,
  );
  const motion = useMotion();
  const entries = useMemo(() => groupTimelineActivities(activities), [activities]);
  useEffect(() => {
    dispatchCollapse({ entries: timelineEntryLiveStates(entries), type: 'sync' });
  }, [entries]);
  const toggleEntry = useCallback((id: string) => {
    onInspectActivity();
    dispatchCollapse({ id, type: 'toggle' });
  }, [onInspectActivity]);
  return (
    <Reanimated.View
      layout={motion.animate(LinearTransition
        .duration(IOS_MOTION.duration.control)
        .easing(IOS_STANDARD_EASING))}
      style={styles.timeline}
    >
      {entries.map((entry) => (
        entry.kind === 'group' ? (
          <TimelineGroupRow
            collapseState={collapseState}
            entry={entry.activities}
            id={entry.id}
            isChinese={isChinese}
            key={entry.id}
            now={now}
            onToggle={toggleEntry}
          />
        ) : (
          <TimelineStepRow
            activity={entry.activities[0]}
            expanded={isTimelineEntryExpanded(collapseState, entry.id)}
            isChinese={isChinese}
            key={entry.id}
            now={now}
            onToggle={toggleEntry}
          />
        )
      ))}
    </Reanimated.View>
  );
}

function TimelineStepRow({
  activity,
  expanded,
  isChinese,
  now,
  onToggle,
}: {
  activity: ChatActivity;
  expanded: boolean;
  isChinese: boolean;
  now: number;
  onToggle(id: string): void;
}) {
  const { tokens } = useTheme();
  const running = activityIsRunning(activity);
  const motion = useMotion();
  const ToolIcon = { search: Search, browser: Globe, command: Terminal, edit: FilePenLine,
    file: FileText, schedule: CalendarClock, subagent: Users }[activity.category] || Wrench;
  const StatusIcon = { queued: Clock3, running: LoaderCircle, completed: CircleCheck,
    failed: CircleX, cancelled: CircleSlash }[activity.status];
  const statusColor = activity.status === 'failed'
    ? tokens.colors.destructive
    : activity.status === 'queued' ? tokens.colors.textSecondary : running
      ? RUNNING_COLOR
      : activity.status === 'cancelled'
        ? tokens.colors.textTertiary
        : tokens.colors.success;
  const label = activityCategoryLabel(activity.category, isChinese);
  const primaryDetail = activityPrimaryDetail(activity);
  const elapsed = activityElapsedLabel(activity, now);
  return (
    <View style={[styles.entryCard, { borderColor: tokens.colors.border }]}>
      <IOSPressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={[
          label,
          activity.name,
          messageStatusLabel(activity.status, isChinese),
          elapsed,
        ].filter(Boolean).join(' · ')}
        haptic="selection"
        onPress={() => onToggle(activity.id)}
        style={styles.entryRow}
      >
        <ToolIcon color={tokens.colors.textSecondary} size={20} />
        <View style={styles.entryTitleColumn}>
          <View style={styles.entryTitleRow}>
            <Text style={[styles.entryKind, { color: tokens.colors.foreground }]}>{label}</Text>
          </View>
          {primaryDetail ? <Text numberOfLines={1} style={[styles.entryPrimaryDetail, { color: tokens.colors.textSecondary }]}>{primaryDetail}</Text> : null}
          <View style={styles.entryTitleRow}>
            <StatusIcon size={12} color={statusColor} />
            <Text style={[styles.entryElapsed, { color: statusColor }]}>{activityStatusLabel(activity.status, isChinese)}</Text>
            {elapsed ? <Text style={[styles.entryElapsed, { color: tokens.colors.textTertiary }]}>{elapsed}</Text> : null}
          </View>
        </View>
        <AnimatedChevron color={tokens.colors.textSecondary} open={expanded} size={16} />
      </IOSPressable>
      {expanded ? (
        <Reanimated.View
          entering={motion.animate(FadeIn
            .duration(IOS_MOTION.duration.control)
            .easing(IOS_DECELERATE_EASING))}
          exiting={motion.animate(FadeOut
            .duration(IOS_MOTION.duration.press)
            .easing(IOS_STANDARD_EASING))}
          style={[styles.entryDetail, { borderLeftColor: tokens.colors.border }]}
        >
          <EntryDetailBody activity={activity} isChinese={isChinese} />
        </Reanimated.View>
      ) : null}
    </View>
  );
}

function TimelineGroupRow({
  collapseState,
  entry,
  id,
  isChinese,
  now,
  onToggle,
}: {
  collapseState: TimelineCollapseState;
  entry: readonly ChatActivity[];
  id: string;
  isChinese: boolean;
  now: number;
  onToggle(id: string): void;
}) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const expanded = isTimelineEntryExpanded(collapseState, id);
  const first = entry[0];
  const label = activityCategoryLabel(first.category, isChinese);
  const elapsed = timelineGroupElapsedLabel(entry);
  return (
    <View style={[styles.entryCard, { borderColor: tokens.colors.border }]}>
      <IOSPressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={isChinese
          ? `${label} ${first.name} 共 ${entry.length} 步`
          : `${label} ${first.name}, ${entry.length} steps`}
        haptic="selection"
        onPress={() => onToggle(id)}
        style={styles.entryRow}
      >
        <CircleCheck size={18} color={tokens.colors.success} />
        <Text style={[styles.entryKind, { color: tokens.colors.textSecondary }]}>{label}</Text>
        <Text numberOfLines={1} style={[styles.entryName, { color: tokens.colors.foreground }]}>{first.name}</Text>
        <Text style={[styles.entryGroupCount, { color: tokens.colors.textTertiary }]}>
          {`× ${entry.length}`}
        </Text>
        {elapsed ? (
          <Text style={[styles.entryElapsed, { color: tokens.colors.textTertiary }]}>{elapsed}</Text>
        ) : null}
        <AnimatedChevron color={tokens.colors.textSecondary} open={expanded} size={12} />
      </IOSPressable>
      {expanded ? (
        <Reanimated.View
          entering={motion.animate(FadeIn
            .duration(IOS_MOTION.duration.control)
            .easing(IOS_DECELERATE_EASING))}
          exiting={motion.animate(FadeOut
            .duration(IOS_MOTION.duration.press)
            .easing(IOS_STANDARD_EASING))}
          style={styles.groupMembers}
        >
          {entry.map((activity) => (
            <TimelineStepRow
              activity={activity}
              expanded={isTimelineEntryExpanded(collapseState, activity.id)}
              isChinese={isChinese}
              key={activity.id}
              now={now}
              onToggle={onToggle}
            />
          ))}
        </Reanimated.View>
      ) : null}
    </View>
  );
}

interface EntryDetailSection {
  label: string;
  text: string;
  tone?: 'error';
}

function entryDetailSections(
  activity: ChatActivity,
  isChinese: boolean,
): EntryDetailSection[] {
  const sections: EntryDetailSection[] = [];
  if (activity.input?.trim()) {
    sections.push({ label: isChinese ? '输入' : 'Input', text: activity.input });
  }
  if (activity.error?.trim()) {
    sections.push({ label: isChinese ? '错误' : 'Error', text: activity.error, tone: 'error' });
  }
  if (activity.output?.trim()) {
    sections.push({ label: isChinese ? '输出' : 'Output', text: activity.output });
  }
  if (!sections.length) {
    const fallback = activityDisplayContent(activity);
    if (fallback) sections.push({ label: isChinese ? '详情' : 'Detail', text: fallback });
  }
  return sections;
}

function EntryDetailBody({
  activity,
  isChinese,
}: {
  activity: ChatActivity;
  isChinese: boolean;
}) {
  const { tokens } = useTheme();
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const [rawOpen, setRawOpen] = useState(false);
  const [sourceCount, setSourceCount] = useState(6);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
  }, []);
  const sections = useMemo(() => entryDetailSections(activity, isChinese), [activity, isChinese]);
  const detail = useMemo(() => activityDetails(activity), [activity]);
  const copyDetail = useCallback(async () => {
    const value = sections.map(({ label, text }) => `${label}\n${text}`).join('\n\n');
    if (!value.trim()) return;
    try { await Clipboard.setStringAsync(value); }
    catch { setActionError(isChinese ? '无法复制，请重试' : 'Copy failed. Try again.'); return; }
    setActionError('');
    setCopied(true);
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1_200);
  }, [sections, isChinese]);
  const openSource = async (url: string) => {
    try { await Linking.openURL(url); setActionError(''); }
    catch { setActionError(isChinese ? '无法打开来源，请重试' : 'Could not open source. Try again.'); }
  };
  return (
    <View style={styles.entryDetailBody}>
      {detail.fields.map(({ key, value }) => (
        <View key={key} style={styles.entrySection}>
          <Text style={[styles.entrySectionLabel, { color: tokens.colors.textTertiary }]}>{isChinese ? ({ command: '命令', cmd: '命令', query: '搜索内容', q: '搜索内容', url: '地址', path: '文件', file_path: '文件', action: '操作', schedule: '计划', task: '任务', agent: 'Agent', profile: '配置', model: '模型', provider: '模型服务', files: '涉及文件', tool: '工具', call_id: '调用 ID', parent_call_id: '父调用 ID' }[key] || key) : key}</Text>
          <ClampedActivityTextBlock isChinese={isChinese} text={value} />
        </View>
      ))}
      {detail.sources.slice(0, sourceCount).map((source) => (
        <IOSPressable key={source.url} accessibilityRole="link" accessibilityLabel={source.title}
          onPress={() => { void openSource(source.url); }} style={styles.sourceRow}>
          <Globe size={16} color={tokens.colors.primary} />
          <View style={styles.entryTitleColumn}>
            <Text numberOfLines={2} style={[styles.sourceTitle, { color: tokens.colors.primary }]}>{source.title}</Text>
            <Text numberOfLines={1} style={[styles.entryElapsed, { color: tokens.colors.textTertiary }]}>{new URL(source.url).hostname}</Text>
            {source.description ? <Text numberOfLines={2} style={[styles.sourceDescription, { color: tokens.colors.textSecondary }]}>{source.description}</Text> : null}
          </View>
          <ExternalLink size={14} color={tokens.colors.textTertiary} />
        </IOSPressable>
      ))}
      {detail.sources.length > sourceCount ? <IOSPressable accessibilityRole="button" onPress={() => setSourceCount((count) => count + 6)} style={styles.entryShowMore}>
        <Text style={{ color: tokens.colors.primary }}>{isChinese ? '更多来源' : 'More sources'}</Text>
      </IOSPressable> : null}
      {detail.change ? <View style={styles.entrySection}>
        <Text style={[styles.entrySectionLabel, { color: tokens.colors.textSecondary }]}>
          {detail.change.requested ? (isChinese ? '请求变更' : 'Requested changes') : (isChinese ? '返回的差异' : 'Reported diff')}
        </Text>
        <ClampedActivityTextBlock isChinese={isChinese} text={detail.change.patch} diff />
      </View> : null}
      {activity.error ? <ClampedActivityTextBlock isChinese={isChinese} text={activity.error} tone="error" /> : null}
      {detail.output && !detail.sources.length && !detail.change ? <ClampedActivityTextBlock isChinese={isChinese} text={detail.output} /> : null}
      {!detail.output && !activity.error && !detail.fields.length && !detail.sources.length && !detail.change && activityDisplayContent(activity)
        ? <ClampedActivityTextBlock isChinese={isChinese} text={activityDisplayContent(activity)} /> : null}
      <IOSPressable accessibilityRole="button" accessibilityState={{ expanded: rawOpen }}
        accessibilityLabel={isChinese ? '原始输入与输出' : 'Raw input and output'}
        onPress={() => setRawOpen((open) => !open)} style={styles.entryShowMore}>
        <AnimatedChevron color={tokens.colors.textSecondary} open={rawOpen} size={14} />
        <Text style={[styles.entryShowMoreText, { color: tokens.colors.textSecondary }]}>{isChinese ? '原始输入与输出' : 'Raw input and output'}</Text>
      </IOSPressable>
      {rawOpen ? sections.map((section) => (
        <View key={section.label} style={styles.entrySection}>
          <Text
            style={[
              styles.entrySectionLabel,
              { color: section.tone === 'error' ? tokens.colors.destructive : tokens.colors.textTertiary },
            ]}
          >
            {section.label}
          </Text>
          <ClampedActivityTextBlock isChinese={isChinese} text={section.text} tone={section.tone} />
        </View>
      )) : null}
      {actionError ? <Text accessibilityRole="alert" style={{ color: tokens.colors.destructive }}>{actionError}</Text> : null}
      {sections.length ? (
        <IOSPressable
          accessibilityLabel={isChinese ? '复制工具详情' : 'Copy tool detail'}
          accessibilityRole="button"
          onPress={() => { void copyDetail(); }}
          style={styles.entryCopy}
        >
          {copied
            ? <Check color={tokens.colors.success} size={12} />
            : <Copy color={tokens.colors.textTertiary} size={12} />}
          <Text style={[styles.entryCopyText, { color: tokens.colors.textTertiary }]}>
            {copied ? (isChinese ? '已复制' : 'Copied') : (isChinese ? '复制' : 'Copy')}
          </Text>
        </IOSPressable>
      ) : null}
    </View>
  );
}

function ClampedActivityTextBlock({
  isChinese,
  text,
  tone,
  diff = false,
}: {
  isChinese: boolean;
  text: string;
  tone?: 'error';
  diff?: boolean;
}) {
  const { tokens } = useTheme();
  const [visibleCharacters, setVisibleCharacters] = useState(1_600);
  const displayText = useMemo(() => diff ? activityDiffText(text) : text, [diff, text]);
  const clamp = useMemo(() => clampActivityText(displayText, { maxCharacters: visibleCharacters, maxLines: Math.ceil(visibleCharacters / 65) }), [displayText, visibleCharacters]);
  const value = clamp.text;
  return (
    <View style={[styles.entryCodeBlock, { backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.045) }]}>
      <Text
        selectable
        style={[
          styles.entryCode,
          { color: tone === 'error' ? tokens.colors.destructive : tokens.colors.foreground },
        ]}
      >
        {diff ? value.split('\n').map((line, index) => <Text key={index} style={{
          color: line.startsWith('+') && !line.startsWith('+++') ? tokens.colors.success
            : line.startsWith('-') && !line.startsWith('---') ? tokens.colors.destructive : tokens.colors.foreground,
        }}>{line}{'\n'}</Text>) : value}
      </Text>
      {clamp.clamped ? (
        <IOSPressable
          accessibilityRole="button"
          accessibilityLabel={isChinese ? '展开更多输出' : 'Show more output'}
          haptic="selection"
          onPress={() => setVisibleCharacters((count) => count + 4_000)}
          style={styles.entryShowMore}
        >
          <Text style={[styles.entryShowMoreText, { color: tokens.colors.primary }]}>
            {isChinese ? '展开更多' : 'Show more'}
          </Text>
        </IOSPressable>
      ) : null}
      {visibleCharacters > 1_600 ? <IOSPressable accessibilityRole="button" onPress={() => setVisibleCharacters(1_600)} style={styles.entryShowMore}>
        <Text style={[styles.entryShowMoreText, { color: tokens.colors.primary }]}>{isChinese ? '收起输出' : 'Collapse output'}</Text>
      </IOSPressable> : null}
    </View>
  );
}

export function AnimatedChevron({
  color,
  open,
  size,
}: {
  color: string;
  open: boolean;
  size: number;
}) {
  const rotation = useSharedValue(open ? 1 : 0);
  const motion = useMotion();
  useEffect(() => {
    rotation.value = withTiming(open ? 1 : 0, {
      duration: motion.duration(IOS_MOTION.duration.control),
      easing: IOS_STANDARD_EASING,
    });
  }, [open, rotation, motion]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 180}deg` }],
  }));
  return (
    <Reanimated.View style={animatedStyle}>
      <ChevronDown color={color} size={size} />
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  timeline: { gap: 0 },
  entryCard: { borderBottomWidth: StyleSheet.hairlineWidth },
  entryRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 60, paddingHorizontal: 4, paddingVertical: 10 },
  entryTitleColumn: { flex: 1, minWidth: 0, gap: 4 },
  entryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  entryKind: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  entryName: { flexShrink: 1, fontFamily: MONO_REGULAR, fontSize: 11, lineHeight: 16 },
  entryPrimaryDetail: { fontSize: 14, lineHeight: 20 },
  entryGroupCount: { fontFamily: MONO_REGULAR, fontSize: 9, lineHeight: 13 },
  entryElapsed: { fontSize: 12, lineHeight: 18 },
  entryDetail: { borderLeftWidth: 2, marginBottom: 12, marginLeft: 13, marginRight: 2, paddingLeft: 12 },
  entryDetailBody: { gap: 6 },
  entrySection: { gap: 3 },
  entrySectionLabel: { fontSize: 13, fontWeight: '500', letterSpacing: 0, lineHeight: 19 },
  entryCodeBlock: { borderRadius: 5 },
  // Tool input/output often contains Chinese text; the mono Latin font has no
  // CJK glyphs, so fall back to the system font for correct wrapping.
  entryCode: { fontSize: 13, lineHeight: 20, padding: 10 },
  entryShowMore: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 6, minHeight: 44, paddingHorizontal: 7 },
  entryShowMoreText: { fontFamily: BODY_REGULAR, fontSize: 12, lineHeight: 18 },
  entryCopy: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 6, minHeight: 44, paddingHorizontal: 7 },
  entryCopyText: { fontFamily: BODY_REGULAR, fontSize: 12, lineHeight: 18 },
  groupMembers: { gap: 3, paddingBottom: 5, paddingHorizontal: 5 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingVertical: 8 },
  sourceTitle: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  sourceDescription: { fontSize: 12, lineHeight: 17 },
});
