import * as Clipboard from 'expo-clipboard';
import { Check, ChevronDown, Copy } from 'lucide-react-native';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
      layout={LinearTransition
        .duration(IOS_MOTION.duration.control)
        .easing(IOS_STANDARD_EASING)}
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
  const statusColor = activity.status === 'failed'
    ? tokens.colors.destructive
    : running
      ? RUNNING_COLOR
      : activity.status === 'cancelled'
        ? tokens.colors.textTertiary
        : tokens.colors.success;
  const label = activityCategoryLabel(activity.category, isChinese);
  const primaryDetail = activityPrimaryDetail(activity);
  const elapsed = activityElapsedLabel(activity, now);
  return (
    <View style={[styles.entryCard, { backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.035) }]}>
      <IOSPressable
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
        <View style={[styles.entryStatusDot, { backgroundColor: statusColor }]} />
        <Text style={[styles.entryKind, { color: tokens.colors.textSecondary }]}>{label}</Text>
        <Text numberOfLines={1} style={[styles.entryName, { color: tokens.colors.foreground }]}>{activity.name}</Text>
        {primaryDetail ? (
          <Text numberOfLines={1} style={[styles.entryPrimaryDetail, { color: tokens.colors.textTertiary }]}>
            {primaryDetail}
          </Text>
        ) : null}
        {elapsed ? (
          <Text style={[styles.entryElapsed, { color: running ? RUNNING_COLOR : tokens.colors.textTertiary }]}>
            {elapsed}
          </Text>
        ) : null}
        <AnimatedChevron color={tokens.colors.textSecondary} open={expanded} size={12} />
      </IOSPressable>
      {expanded ? (
        <Reanimated.View
          entering={FadeIn
            .duration(IOS_MOTION.duration.control)
            .easing(IOS_DECELERATE_EASING)}
          exiting={FadeOut
            .duration(IOS_MOTION.duration.press)
            .easing(IOS_STANDARD_EASING)}
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
  const expanded = isTimelineEntryExpanded(collapseState, id);
  const first = entry[0];
  const label = activityCategoryLabel(first.category, isChinese);
  const elapsed = timelineGroupElapsedLabel(entry);
  return (
    <View style={[styles.entryCard, { backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.035) }]}>
      <IOSPressable
        accessibilityLabel={isChinese
          ? `${label} ${first.name} 共 ${entry.length} 步`
          : `${label} ${first.name}, ${entry.length} steps`}
        haptic="selection"
        onPress={() => onToggle(id)}
        style={styles.entryRow}
      >
        <View style={[styles.entryStatusDot, { backgroundColor: tokens.colors.success }]} />
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
          entering={FadeIn
            .duration(IOS_MOTION.duration.control)
            .easing(IOS_DECELERATE_EASING)}
          exiting={FadeOut
            .duration(IOS_MOTION.duration.press)
            .easing(IOS_STANDARD_EASING)}
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
  const sections = useMemo(() => entryDetailSections(activity, isChinese), [activity, isChinese]);
  const copyDetail = useCallback(async () => {
    const value = sections.map(({ label, text }) => `${label}\n${text}`).join('\n\n');
    if (!value.trim()) return;
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_200);
  }, [sections]);
  return (
    <View style={styles.entryDetailBody}>
      {sections.map((section) => (
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
      ))}
      {sections.length ? (
        <IOSPressable
          accessibilityLabel={isChinese ? '复制工具详情' : 'Copy tool detail'}
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
}: {
  isChinese: boolean;
  text: string;
  tone?: 'error';
}) {
  const { tokens } = useTheme();
  const [showAll, setShowAll] = useState(false);
  const clamp = clampActivityText(text);
  const value = showAll ? text.trimEnd() : clamp.text;
  return (
    <View style={[styles.entryCodeBlock, { backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.045) }]}>
      <Text
        selectable
        style={[
          styles.entryCode,
          { color: tone === 'error' ? tokens.colors.destructive : tokens.colors.foreground },
        ]}
      >
        {value}
      </Text>
      {clamp.clamped ? (
        <IOSPressable
          accessibilityLabel={showAll
            ? (isChinese ? '收起完整输出' : 'Collapse the complete output')
            : (isChinese ? '展开完整输出' : 'Expand the complete output')}
          haptic="selection"
          onPress={() => setShowAll((current) => !current)}
          style={styles.entryShowMore}
        >
          <Text style={[styles.entryShowMoreText, { color: tokens.colors.primary }]}>
            {showAll
              ? (isChinese ? '收起' : 'Show less')
              : (isChinese
                  ? `展开其余 ${clamp.hiddenLineCount} 行`
                  : `Show ${clamp.hiddenLineCount} more ${clamp.hiddenLineCount === 1 ? 'line' : 'lines'}`)}
          </Text>
        </IOSPressable>
      ) : null}
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
  useEffect(() => {
    rotation.value = withTiming(open ? 1 : 0, {
      duration: IOS_MOTION.duration.control,
      easing: IOS_STANDARD_EASING,
    });
  }, [open, rotation]);
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
  timeline: { gap: 4 },
  entryCard: { borderRadius: 6, overflow: 'hidden' },
  entryRow: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 28, paddingHorizontal: 8, paddingVertical: 3 },
  entryStatusDot: { borderRadius: 3, height: 6, width: 6 },
  entryKind: { fontFamily: BODY_SEMIBOLD, fontSize: 9, lineHeight: 13 },
  entryName: { flexShrink: 1, fontFamily: MONO_REGULAR, fontSize: 10, lineHeight: 14 },
  entryPrimaryDetail: { flex: 1, fontFamily: MONO_REGULAR, fontSize: 10, lineHeight: 14 },
  entryGroupCount: { fontFamily: MONO_REGULAR, fontSize: 9, lineHeight: 13 },
  entryElapsed: { fontFamily: MONO_REGULAR, fontSize: 9, lineHeight: 13, marginLeft: 'auto' },
  entryDetail: { borderLeftWidth: 2, marginBottom: 7, marginLeft: 17, marginRight: 8, marginTop: 3, paddingLeft: 10 },
  entryDetailBody: { gap: 6 },
  entrySection: { gap: 3 },
  entrySectionLabel: { fontFamily: BODY_SEMIBOLD, fontSize: 9, letterSpacing: 0.4, lineHeight: 13, textTransform: 'uppercase' },
  entryCodeBlock: { borderRadius: 5 },
  // Tool input/output often contains Chinese text; the mono Latin font has no
  // CJK glyphs, so fall back to the system font for correct wrapping.
  entryCode: { fontSize: 10, lineHeight: 15, padding: 7 },
  entryShowMore: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', minHeight: 26, paddingBottom: 4, paddingHorizontal: 7 },
  entryShowMoreText: { fontFamily: BODY_REGULAR, fontSize: 10, lineHeight: 14 },
  entryCopy: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 4, minHeight: 26, paddingHorizontal: 2 },
  entryCopyText: { fontFamily: BODY_REGULAR, fontSize: 10, lineHeight: 14 },
  groupMembers: { gap: 3, paddingBottom: 5, paddingHorizontal: 5 },
});
