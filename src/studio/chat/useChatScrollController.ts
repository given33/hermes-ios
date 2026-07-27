import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

/** Keep streaming output stable without coupling scroll/keyboard refs to chat state. */
export function useChatScrollController(safeAreaBottom: number) {
  const streamRef = useRef<ScrollView>(null);
  const pendingScrollFrame = useRef<number | null>(null);
  const autoFollowStreamRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const keyboard = useAnimatedKeyboard();
  const keyboardAvoidanceEnabled = useSharedValue(1);

  const keepLatestVisible = useCallback((animated = false, force = false) => {
    if (!force && !autoFollowStreamRef.current) return;
    if (pendingScrollFrame.current !== null) return;
    setShowScrollToBottom(false);
    pendingScrollFrame.current = requestAnimationFrame(() => {
      pendingScrollFrame.current = null;
      streamRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const pauseStreamAutoFollow = useCallback(() => {
    autoFollowStreamRef.current = false;
    if (pendingScrollFrame.current !== null) {
      cancelAnimationFrame(pendingScrollFrame.current);
      pendingScrollFrame.current = null;
    }
  }, []);

  const handleStreamScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    autoFollowStreamRef.current = distanceFromBottom <= 72;
    setShowScrollToBottom(distanceFromBottom > 180);
  }, []);

  const keyboardRootStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboard.height.value * keyboardAvoidanceEnabled.value,
  }));
  const composerKeyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(
      keyboard.height.value * keyboardAvoidanceEnabled.value,
      [0, Math.max(1, safeAreaBottom)],
      [7 + safeAreaBottom, 3],
      Extrapolation.CLAMP,
    ),
  }));

  useAnimatedReaction(
    () => keyboard.height.value * keyboardAvoidanceEnabled.value,
    (height, previousHeight) => {
      if (previousHeight === null || Math.abs(height - previousHeight) >= 0.5) {
        runOnJS(keepLatestVisible)(false);
      }
    },
    [keepLatestVisible],
  );

  useEffect(() => () => {
    if (pendingScrollFrame.current !== null) {
      cancelAnimationFrame(pendingScrollFrame.current);
    }
  }, []);

  return {
    autoFollowStreamRef,
    composerKeyboardStyle,
    handleStreamScroll,
    keepLatestVisible,
    keyboardAvoidanceEnabled,
    keyboardRootStyle,
    pauseStreamAutoFollow,
    showScrollToBottom,
    streamRef,
  };
}
