import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Reanimated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';

import { activityCategoryLabel } from '../api/chat-view-model';
import { IOSPressable } from '../components/ios/IOSPressable';
import { multiplyAlpha } from '../design/control-contracts';
import { IOS_MOTION } from '../design/ios-motion';
import { useTheme } from '../design/ThemeProvider';
import { AnimatedChevron } from './WorkflowTimeline';
import {
  clampActivityText,
  createTimelineCollapseState,
  isTimelineEntryExpanded,
  reasoningPreviewLine,
  timelineCollapseReducer,
} from './workflow-timeline-model';

const BODY_REGULAR = 'HermesGoogle-IBMPlexSans-400-Normal';
const BODY_SEMIBOLD = 'HermesGoogle-IBMPlexSans-600-Normal';
const MONO_REGULAR = 'HermesTerminal-JetBrainsMono-400-Normal';
const IOS_STANDARD_EASING = Easing.bezier(...IOS_MOTION.curve.standard);
const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);
const RUNNING_COLOR = '#D28B22';
const REASONING_ENTRY_ID = 'reasoning';

/**
 * One collapsible reasoning section per assistant turn. It stays collapsed
 * behind a first-line preview by default, auto-expands while the backend is
 * still streaming reasoning, and collapses again on completion unless the
 * user toggled it manually.
 */
export function ReasoningSection({
  detailStyle,
  durationLabel,
  isChinese,
  onInspectActivity,
  running,
  text,
}: {
  detailStyle?: StyleProp<ViewStyle>;
  durationLabel?: string;
  isChinese: boolean;
  onInspectActivity(): void;
  running: boolean;
  text: string;
}) {
  const { tokens } = useTheme();
  const [collapseState, dispatchCollapse] = useReducer(
    timelineCollapseReducer,
    undefined,
    createTimelineCollapseState,
  );
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
  }, []);
  useEffect(() => {
    dispatchCollapse({
      entries: [{ id: REASONING_ENTRY_ID, running }],
      type: 'sync',
    });
  }, [running]);
  const expanded = isTimelineEntryExpanded(collapseState, REASONING_ENTRY_ID);
  const label = activityCategoryLabel('reasoning', isChinese);
  const preview = reasoningPreviewLine(text, running);
  const copyReasoning = useCallback(async () => {
    if (!text.trim()) return;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1_200);
  }, [text]);
  const clamp = clampActivityText(text);
  const value = showAll ? text.trimEnd() : clamp.text;
  return (
    <Reanimated.View
      layout={LinearTransition
        .duration(IOS_MOTION.duration.control)
        .easing(IOS_STANDARD_EASING)}
      style={[styles.section, { backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.035) }]}
    >
      <IOSPressable
        accessibilityLabel={isChinese
          ? `${label}：${preview || '暂无内容'}`
          : `${label}: ${preview || 'No content yet'}`}
        haptic="selection"
        onPress={() => {
          onInspectActivity();
          dispatchCollapse({ id: REASONING_ENTRY_ID, type: 'toggle' });
        }}
        style={styles.headerRow}
      >
        <View
          style={[
            styles.statusDot,
            { backgroundColor: running ? RUNNING_COLOR : tokens.colors.textTertiary },
          ]}
        />
        <Text style={[styles.kind, { color: tokens.colors.textSecondary }]}>{label}</Text>
        {!expanded && preview ? (
          <Text numberOfLines={1} style={[styles.preview, { color: tokens.colors.textTertiary }]}>
            {preview}
          </Text>
        ) : (
          <View style={styles.previewSpacer} />
        )}
        {durationLabel ? (
          <Text style={[styles.duration, { color: running ? RUNNING_COLOR : tokens.colors.textTertiary }]}>
            {durationLabel}
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
          style={[
            styles.body,
            { borderLeftColor: tokens.colors.textTertiary },
            detailStyle,
          ]}
        >
          <Text selectable style={[styles.reasoningText, { color: tokens.colors.foreground }]}>
            {value}
          </Text>
          {clamp.clamped ? (
            <IOSPressable
              accessibilityLabel={showAll
                ? (isChinese ? '收起完整思考' : 'Collapse the complete reasoning')
                : (isChinese ? '展开完整思考' : 'Expand the complete reasoning')}
              haptic="selection"
              onPress={() => setShowAll((current) => !current)}
              style={styles.showMore}
            >
              <Text style={[styles.showMoreText, { color: tokens.colors.primary }]}>
                {showAll
                  ? (isChinese ? '收起' : 'Show less')
                  : (isChinese
                      ? `展开其余 ${clamp.hiddenLineCount} 行`
                      : `Show ${clamp.hiddenLineCount} more ${clamp.hiddenLineCount === 1 ? 'line' : 'lines'}`)}
              </Text>
            </IOSPressable>
          ) : null}
          <IOSPressable
            accessibilityLabel={isChinese ? '复制思考内容' : 'Copy reasoning'}
            onPress={() => { void copyReasoning(); }}
            style={styles.copy}
          >
            {copied
              ? <Check color={tokens.colors.success} size={12} />
              : <Copy color={tokens.colors.textTertiary} size={12} />}
            <Text style={[styles.copyText, { color: tokens.colors.textTertiary }]}>
              {copied ? (isChinese ? '已复制' : 'Copied') : (isChinese ? '复制' : 'Copy')}
            </Text>
          </IOSPressable>
        </Reanimated.View>
      ) : null}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: 6, overflow: 'hidden' },
  headerRow: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 28, paddingHorizontal: 8, paddingVertical: 3 },
  statusDot: { borderRadius: 3, height: 6, width: 6 },
  kind: { fontFamily: BODY_SEMIBOLD, fontSize: 9, lineHeight: 13 },
  preview: { flex: 1, fontFamily: BODY_REGULAR, fontSize: 10, fontStyle: 'italic', lineHeight: 14 },
  previewSpacer: { flex: 1 },
  duration: { fontFamily: MONO_REGULAR, fontSize: 9, lineHeight: 13 },
  body: { borderLeftWidth: 2, gap: 4, marginBottom: 7, marginLeft: 17, marginRight: 8, marginTop: 3, paddingLeft: 10 },
  // IBMPlexSans has no CJK glyphs; a model's reasoning stream is dense
  // Chinese text without spaces, so the Latin font gives it no break
  // opportunities and the characters render glued together. Let the system
  // font (SF Pro + PingFang SC) drive shaping so CJK wraps naturally.
  reasoningText: { fontSize: 13, fontStyle: 'italic', lineHeight: 19 },
  showMore: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', minHeight: 26 },
  showMoreText: { fontFamily: BODY_REGULAR, fontSize: 10, lineHeight: 14 },
  copy: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 4, minHeight: 26 },
  copyText: { fontFamily: BODY_REGULAR, fontSize: 10, lineHeight: 14 },
});
