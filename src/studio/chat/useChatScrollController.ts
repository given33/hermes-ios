import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Reanimated, {
  Extrapolation,
  interpolate,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useMotion } from '../../design/motion';
import { followStreamOffset } from './stream-motion-model';

/** Keep streaming output stable without coupling scroll/keyboard refs to chat state. */
export function useChatScrollController(safeAreaBottom: number) {
  const streamRef = useRef<Reanimated.ScrollView>(null);
  const pendingScrollFrame = useRef<number | null>(null);
  const autoFollowStreamRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const keyboard = useAnimatedKeyboard();
  const keyboardAvoidanceEnabled = useSharedValue(1);
  const motion = useMotion();
  const metrics = useRef({ content: 0, viewport: 0, offset: 0 });
  const lastScrollFrame = useRef(0);
  const commandedOffset = useRef<number | null>(null);
  const scrollOffset = useSharedValue(0);
  const timelinePinned = useRef(false);
  const navigationFrame = useRef<number | null>(null);
  const cancelNavigation = useCallback(() => {
    if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current);
    navigationFrame.current = null;
  }, []);

  const keepLatestVisible = useCallback((animated = false, force = false) => {
    if (!force && !autoFollowStreamRef.current) return;
    cancelNavigation();
    if (force) { autoFollowStreamRef.current = true; timelinePinned.current = false; }
    setShowScrollToBottom(false);
    if (pendingScrollFrame.current !== null) {
      if (animated) return;
      cancelAnimationFrame(pendingScrollFrame.current);
      pendingScrollFrame.current = null;
    }
    if (!animated || motion.reduceMotion || !metrics.current.viewport) {
      streamRef.current?.scrollToEnd({ animated: false });
      metrics.current.offset = Math.max(0, metrics.current.content - metrics.current.viewport);
      commandedOffset.current = metrics.current.offset;
      scrollOffset.value = metrics.current.offset;
      return;
    }
    lastScrollFrame.current = performance.now();
    const tick = (now: number) => {
      if (!autoFollowStreamRef.current) { pendingScrollFrame.current = null; return; }
      const current = metrics.current;
      const target = Math.max(0, current.content - current.viewport);
      const next = followStreamOffset(current.offset, target, now - lastScrollFrame.current);
      lastScrollFrame.current = now;
      current.offset = next;
      scrollOffset.value = next;
      commandedOffset.current = next;
      streamRef.current?.scrollTo({ y: next, animated: false });
      pendingScrollFrame.current = next === target ? null : requestAnimationFrame(tick);
    };
    pendingScrollFrame.current = requestAnimationFrame(tick);
  }, [cancelNavigation, motion.reduceMotion, scrollOffset]);

  const pauseStreamAutoFollow = useCallback(() => {
    cancelNavigation();
    autoFollowStreamRef.current = false;
    commandedOffset.current = null;
    const current = metrics.current;
    setShowScrollToBottom(current.content - current.viewport - current.offset > 24);
    if (pendingScrollFrame.current !== null) {
      cancelAnimationFrame(pendingScrollFrame.current);
      pendingScrollFrame.current = null;
    }
  }, [cancelNavigation]);

  const resumeStreamAutoFollow = useCallback(() => {
    // Closing the activity panel (or focusing any in-stream input) re-arms
    // auto-follow so streaming content keeps the latest message visible
    // without requiring the user to tap "back to bottom" first.
    autoFollowStreamRef.current = true;
    timelinePinned.current = false;
    cancelNavigation();
  }, [cancelNavigation]);

  const scrollToOffset = useCallback((target: number) => {
    pauseStreamAutoFollow();
    timelinePinned.current = true;
    const bounded = Math.max(0, Math.min(target, metrics.current.content - metrics.current.viewport));
    const start = metrics.current.offset;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = motion.reduceMotion ? 1 : Math.min(1, (now - startedAt) / 280);
      const y = start + (bounded - start) * (1 - (1 - progress) ** 3);
      metrics.current.offset = y;
      commandedOffset.current = y;
      scrollOffset.value = y;
      streamRef.current?.scrollTo({ y, animated: false });
      navigationFrame.current = progress === 1 ? null : requestAnimationFrame(tick);
    };
    tick(startedAt);
    setShowScrollToBottom(metrics.current.content - metrics.current.viewport - bounded > 180);
  }, [motion.reduceMotion, pauseStreamAutoFollow, scrollOffset]);

  const handleStreamScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    metrics.current.content = contentSize.height;
    metrics.current.viewport = layoutMeasurement.height;
    // Programmatic scroll events (including the lag while following a growing
    // answer) must not be mistaken for the reader scrolling away.
    if (pendingScrollFrame.current !== null || navigationFrame.current !== null
      || (commandedOffset.current !== null && Math.abs(contentOffset.y - commandedOffset.current) < 2)) return;
    scrollOffset.value = contentOffset.y;
    metrics.current.offset = contentOffset.y;
    if (distanceFromBottom <= 24 && !timelinePinned.current) autoFollowStreamRef.current = true;
    else if (distanceFromBottom > 72) autoFollowStreamRef.current = false;
    setShowScrollToBottom(distanceFromBottom > 180);
  }, [scrollOffset]);

  const handleStreamContentSizeChange = useCallback((_width: number, height: number) => {
    const initial = metrics.current.content === 0;
    metrics.current.content = height;
    if (!autoFollowStreamRef.current) {
      setShowScrollToBottom(height - metrics.current.viewport - metrics.current.offset > 180);
      return;
    }
    keepLatestVisible(!initial);
  }, [keepLatestVisible]);

  const handleStreamLayout = useCallback((event: LayoutChangeEvent) => {
    metrics.current.viewport = event.nativeEvent.layout.height;
    keepLatestVisible(true);
  }, [keepLatestVisible]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = streamRef.current?.getScrollableNode() as HTMLElement | undefined;
    if (!node?.addEventListener) return;
    const beginUserScroll = () => { timelinePinned.current = false; pauseStreamAutoFollow(); };
    const onWheel = (event: WheelEvent) => { if (event.deltaY !== 0) beginUserScroll(); };
    node.addEventListener('wheel', onWheel, { passive: true });
    node.addEventListener('touchstart', beginUserScroll, { passive: true });
    node.addEventListener('pointerdown', beginUserScroll, { passive: true });
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('touchstart', beginUserScroll);
      node.removeEventListener('pointerdown', beginUserScroll);
    };
  }, [pauseStreamAutoFollow]);

  const keyboardRootStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboard.height.value * keyboardAvoidanceEnabled.value,
  }));
  const composerKeyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(
      keyboard.height.value * keyboardAvoidanceEnabled.value,
      [0, Math.max(1, safeAreaBottom)],
      // Keep only a small breathing room above the keyboard; the previous
      // six-point inset made the composer visibly float away from the iOS
      // keyboard/home-indicator edge.
      [Math.max(8, safeAreaBottom - 12), 3],
      Extrapolation.CLAMP,
    ),
  }));

  useEffect(() => () => {
    cancelNavigation();
    if (pendingScrollFrame.current !== null) {
      cancelAnimationFrame(pendingScrollFrame.current);
    }
  }, [cancelNavigation]);

  return {
    autoFollowStreamRef,
    composerKeyboardStyle,
    handleStreamScroll,
    handleStreamContentSizeChange,
    handleStreamLayout,
    keepLatestVisible,
    keyboardAvoidanceEnabled,
    keyboardRootStyle,
    pauseStreamAutoFollow,
    resumeStreamAutoFollow,
    showScrollToBottom,
    streamRef,
    scrollOffset,
    scrollToOffset,
  };
}
