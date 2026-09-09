import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { useMotion } from '../../design/motion';
import { useTheme } from '../../design/ThemeProvider';
import { WorkflowEntrance } from './WorkflowEntrance';
import { timelineBarWidth, timelineTurnAtOffset, type ConversationTimelineAnchor, type ConversationTimelineEntry } from './conversation-timeline-model';

const ROW_HEIGHT = Platform.OS === 'web' ? 14 : 24;

export const ConversationTimeline = memo(function ConversationTimeline({ entries, anchors, offset, contentHeight, viewportHeight, isChinese, right, onSelect }: {
  entries: readonly ConversationTimelineEntry[];
  anchors: SharedValue<ConversationTimelineAnchor[]>;
  offset: SharedValue<number>;
  contentHeight: SharedValue<number>;
  viewportHeight: SharedValue<number>;
  isChinese: boolean;
  right: number;
  onSelect(id: string): void;
}) {
  const { tokens } = useTheme();
  const list = useRef<FlatList<ConversationTimelineEntry>>(null);
  const [activeId, setActiveId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [previewId, setPreviewId] = useState('');
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [railHeight, setRailHeight] = useState(0);
  const [railOffset, setRailOffset] = useState(0);
  const focusIndex = useSharedValue(-1);
  const maximum = entries.reduce((max, entry) => Math.max(max, entry.length), 1);
  const preview = entries.find(entry => entry.id === previewId);
  const previewIndex = entries.findIndex(entry => entry.id === previewId);

  useAnimatedReaction(
    () => timelineTurnAtOffset(anchors.value, offset.value, contentHeight.value - viewportHeight.value),
    (next, previous) => { if (next !== previous) runOnJS(setActiveId)(next); },
    [anchors, offset, contentHeight, viewportHeight],
  );
  useEffect(() => {
    const index = entries.findIndex(entry => entry.id === activeId);
    if (index >= 0) list.current?.scrollToOffset({
      offset: Math.max(0, index * ROW_HEIGHT - (railHeight - ROW_HEIGHT) / 2), animated: false,
    });
  }, [activeId, entries, railHeight]);
  useEffect(() => () => { if (previewTimer.current) clearTimeout(previewTimer.current); }, []);

  const showPreview = useCallback((id: string, temporary = false) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    setPreviewId(id);
    focusIndex.value = entries.findIndex(entry => entry.id === id);
    if (temporary) previewTimer.current = setTimeout(() => {
      setPreviewId('');
      focusIndex.value = -1;
    }, 1600);
  }, [entries, focusIndex]);

  if (entries.length < 2) return null;
  return <View pointerEvents="box-none" style={[styles.position, { right }]}>
    <View pointerEvents="box-none" style={styles.rail} onLayout={event => setRailHeight(event.nativeEvent.layout.height)}>
      <FlatList
        accessibilityLabel={isChinese ? '\u4f1a\u8bdd\u65f6\u95f4\u8f74' : 'Conversation timeline'}
        data={entries}
        extraData={activeId}
        getItemLayout={(_data, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={10}
        keyExtractor={entry => entry.id}
        keyboardShouldPersistTaps="always"
        ref={list}
        showsVerticalScrollIndicator={false}
        onScroll={event => setRailOffset(event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={32}
        style={styles.list}
        renderItem={({ item, index }) => <TimelineBar
          entry={item} index={index} active={item.id === activeId} selected={item.id === selectedId} maximum={maximum} isChinese={isChinese}
          onPreview={showPreview} onSelect={id => { setSelectedId(id); onSelect(id); }} focusIndex={focusIndex}
        />}
      />
      {preview ? <View pointerEvents="none" style={[styles.previewPosition, {
        top: Math.max(0, Math.min(previewIndex * ROW_HEIGHT - railOffset - 32, railHeight - 104)),
      }]}>
        <WorkflowEntrance style={[styles.preview, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
          <Text style={[styles.previewNumber, { color: tokens.colors.primary }]}>
            {isChinese ? '\u4efb\u52a1' : 'Task'} {previewIndex + 1}
          </Text>
          <Text numberOfLines={4} style={[styles.previewText, { color: tokens.colors.foreground }]}>{preview.prompt}</Text>
        </WorkflowEntrance>
      </View> : null}
    </View>
  </View>;
});

const TimelineBar = memo(function TimelineBar({ entry, index, active, selected, maximum, isChinese, onSelect, onPreview, focusIndex }: {
  entry: ConversationTimelineEntry;
  index: number;
  active: boolean;
  selected: boolean;
  maximum: number;
  isChinese: boolean;
  focusIndex: SharedValue<number>;
  onSelect(id: string): void;
  onPreview(id: string, temporary?: boolean): void;
}) {
  const { tokens } = useTheme();
  const { reduceMotion } = useMotion();
  const progress = useSharedValue(active ? 1 : 0);
  const proximity = useSharedValue(0);
  useAnimatedReaction(
    () => focusIndex.value < 0 ? 0 : Math.max(0, 1 - Math.abs(index - focusIndex.value) / 3),
    next => { proximity.value = withTiming(next, { duration: reduceMotion ? 0 : 160 }); },
    [index, reduceMotion],
  );
  useEffect(() => { progress.value = withTiming(active ? 1 : 0, { duration: reduceMotion ? 0 : 140 }); }, [active, progress, reduceMotion]);
  const width = selected ? timelineBarWidth(entry.length, maximum) : 16;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.42 + 0.58 * Math.max(progress.value, proximity.value),
    transform: [
      { scaleY: 1 + 0.35 * Math.max(progress.value, proximity.value) },
    ],
  }));
  return <IOSPressable
    accessibilityRole="button"
    accessibilityLabel={`${isChinese ? '\u8df3\u8f6c\u5230\u4efb\u52a1' : 'Jump to task'} ${index + 1}: ${entry.prompt.slice(0, 120)}`}
    accessibilityState={{ selected: active }}
    haptic="selection"
    onHoverIn={() => onPreview(entry.id)} onHoverOut={() => onPreview('')}
    onFocus={() => onPreview(entry.id)} onBlur={() => onPreview('')}
    onLongPress={() => onPreview(entry.id, true)}
    onPress={() => { onSelect(entry.id); onPreview(entry.id, true); }}
    scaleTo={reduceMotion ? 1 : 0.94}
    style={styles.target}
  >
    <Animated.View testID={`timeline-bar-${entry.id}`} style={[styles.bar, {
      width,
      backgroundColor: active ? tokens.colors.primary : tokens.colors.textTertiary,
    }, animatedStyle]} />
  </IOSPressable>;
});

const styles = StyleSheet.create({
  position: { position: 'absolute', top: 16, bottom: 100, width: 44, justifyContent: 'center' },
  rail: { maxHeight: 280, flexShrink: 1 },
  list: { flexGrow: 0, flexShrink: 1 },
  target: { width: 44, height: ROW_HEIGHT, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 6 },
  bar: { height: 2, borderRadius: 1 },
  previewPosition: { position: 'absolute', right: 50, top: 0, width: 200 },
  preview: { padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  previewNumber: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  previewText: { fontSize: 12, lineHeight: 18 },
});
