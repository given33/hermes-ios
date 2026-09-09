import { useCallback, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import Reanimated, {
  Extrapolation, interpolate, runOnJS, runOnUI, scrollTo, withTiming,
  useAnimatedKeyboard, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle,
  useFrameCallback, useSharedValue,
  type FrameInfo,
} from 'react-native-reanimated';
import { useMotion } from '../../design/motion';
import { followStreamOffset, shouldResumeStreamFollow } from './stream-motion-model';

/** iOS follows content and cancels on drag entirely on the UI runtime. */
export function useChatScrollController(safeAreaBottom: number) {
  const streamRef = useAnimatedRef<Reanimated.ScrollView>();
  const autoFollowStreamRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const keyboard = useAnimatedKeyboard();
  const keyboardAvoidanceEnabled = useSharedValue(1);
  const following = useSharedValue(true);
  const moving = useSharedValue(false);
  const dragging = useSharedValue(false);
  const userGesture = useSharedValue(false);
  const contentHeight = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const offset = useSharedValue(0);
  const navigating = useSharedValue(false);
  const navigationOffset = useSharedValue(0);
  const navigationTarget = useSharedValue(0);
  const showButton = useSharedValue(false);
  const { reduceMotion } = useMotion();

  const publishFollow = useCallback((value: boolean) => { autoFollowStreamRef.current = value; }, []);
  const publishButton = useCallback((value: boolean) => setShowScrollToBottom(value), []);
  useFrameCallback(useCallback(({ timeSincePreviousFrame }: FrameInfo) => {
    'worklet';
    if (navigating.value && !dragging.value) {
      const next = Math.max(0, Math.min(navigationOffset.value, contentHeight.value - viewportHeight.value));
      offset.value = next;
      scrollTo(streamRef, 0, next, false);
      if (Math.abs(navigationOffset.value - navigationTarget.value) < 0.5) navigating.value = false;
      return;
    }
    if (!moving.value || !following.value || dragging.value || viewportHeight.value <= 0) return;
    const target = Math.max(0, contentHeight.value - viewportHeight.value);
    const next = reduceMotion ? target
      : followStreamOffset(offset.value, target, timeSincePreviousFrame ?? 16);
    offset.value = next;
    scrollTo(streamRef, 0, next, false);
    if (next === target) moving.value = false;
  }, [contentHeight, dragging, following, moving, navigating, navigationOffset, navigationTarget, offset, reduceMotion, streamRef, viewportHeight]));

  const keepLatestVisible = useCallback((animated = false, force = false) => {
    if (force) autoFollowStreamRef.current = true;
    runOnUI((animate: boolean, forced: boolean) => {
      if (forced) { following.value = true; dragging.value = false; userGesture.value = false; }
      if (!following.value || dragging.value) return;
      navigating.value = false;
      if (showButton.value) { showButton.value = false; runOnJS(publishButton)(false); }
      if (animate && !reduceMotion) moving.value = true;
      else {
        moving.value = false;
        offset.value = Math.max(0, contentHeight.value - viewportHeight.value);
        scrollTo(streamRef, 0, offset.value, false);
      }
    })(animated, force);
  }, [contentHeight, dragging, following, moving, navigating, offset, publishButton, reduceMotion, showButton, streamRef, userGesture, viewportHeight]);

  const pauseStreamAutoFollow = useCallback(() => {
    autoFollowStreamRef.current = false;
    following.value = false;
    moving.value = false;
    navigating.value = false;
    userGesture.value = false;
  }, [following, moving, navigating, userGesture]);
  const resumeStreamAutoFollow = useCallback(() => {
    autoFollowStreamRef.current = true;
    runOnUI(() => {
      following.value = true;
      dragging.value = false;
      moving.value = true;
      navigating.value = false;
      userGesture.value = false;
      if (showButton.value) { showButton.value = false; runOnJS(publishButton)(false); }
    })();
  }, [dragging, following, moving, navigating, publishButton, showButton, userGesture]);

  const scrollToOffset = useCallback((target: number) => {
    autoFollowStreamRef.current = false;
    runOnUI((y: number) => {
      following.value = false;
      moving.value = false;
      dragging.value = false;
      userGesture.value = false;
      const bounded = Math.max(0, Math.min(y, contentHeight.value - viewportHeight.value));
      navigationTarget.value = bounded;
      navigationOffset.value = offset.value;
      navigationOffset.value = withTiming(bounded, { duration: reduceMotion ? 0 : 280 });
      navigating.value = true;
      const visible = contentHeight.value - viewportHeight.value - bounded > 180;
      showButton.value = visible;
      runOnJS(publishButton)(visible);
    })(target);
  }, [contentHeight, dragging, following, moving, navigating, navigationOffset, navigationTarget, offset, publishButton, reduceMotion, showButton, userGesture, viewportHeight]);

  const handleStreamScroll = useAnimatedScrollHandler({
    onBeginDrag: () => {
      dragging.value = true;
      userGesture.value = true;
      following.value = false;
      moving.value = false;
      navigating.value = false;
      runOnJS(publishFollow)(false);
    },
    onScroll: event => {
      contentHeight.value = event.contentSize.height;
      viewportHeight.value = event.layoutMeasurement.height;
      if ((!moving.value && !navigating.value) || dragging.value) offset.value = event.contentOffset.y;
      const distance = event.contentSize.height - event.layoutMeasurement.height - event.contentOffset.y;
      const visible = !following.value && distance > 180;
      if (visible !== showButton.value) { showButton.value = visible; runOnJS(publishButton)(visible); }
    },
    onEndDrag: event => {
      dragging.value = false;
      if (!userGesture.value) return;
      const nearBottom = shouldResumeStreamFollow(
        event.contentSize.height - event.layoutMeasurement.height - event.contentOffset.y,
        event.velocity?.y,
      );
      following.value = nearBottom;
      moving.value = nearBottom;
      runOnJS(publishFollow)(nearBottom);
    },
    onMomentumEnd: event => {
      if (!userGesture.value) return;
      userGesture.value = false;
      const nearBottom = shouldResumeStreamFollow(event.contentSize.height - event.layoutMeasurement.height - event.contentOffset.y);
      following.value = nearBottom;
      moving.value = nearBottom;
      runOnJS(publishFollow)(nearBottom);
    },
  });

  const handleStreamContentSizeChange = useCallback((_width: number, height: number) => {
    runOnUI((next: number) => {
      const initial = contentHeight.value === 0;
      contentHeight.value = next;
      if (!following.value || dragging.value) {
        const visible = next - viewportHeight.value - offset.value > 180;
        if (visible !== showButton.value) { showButton.value = visible; runOnJS(publishButton)(visible); }
        return;
      }
      if (initial || reduceMotion) {
        offset.value = Math.max(0, next - viewportHeight.value);
        scrollTo(streamRef, 0, offset.value, false);
      } else moving.value = true;
    })(height);
  }, [contentHeight, dragging, following, moving, offset, publishButton, reduceMotion, showButton, streamRef, viewportHeight]);

  const handleStreamLayout = useCallback((event: LayoutChangeEvent) => {
    viewportHeight.value = event.nativeEvent.layout.height;
    keepLatestVisible(true);
  }, [keepLatestVisible, viewportHeight]);
  const keyboardRootStyle = useAnimatedStyle(() => ({ paddingBottom: keyboard.height.value * keyboardAvoidanceEnabled.value }));
  const composerKeyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(keyboard.height.value * keyboardAvoidanceEnabled.value,
      [0, Math.max(1, safeAreaBottom)], [Math.max(8, safeAreaBottom - 12), 3], Extrapolation.CLAMP),
  }));
  return {
    autoFollowStreamRef, composerKeyboardStyle, handleStreamScroll, handleStreamContentSizeChange,
    handleStreamLayout, keepLatestVisible, keyboardAvoidanceEnabled, keyboardRootStyle,
    pauseStreamAutoFollow, resumeStreamAutoFollow, showScrollToBottom, streamRef,
    scrollOffset: offset, scrollToOffset,
  };
}
