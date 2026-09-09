import { memo, useEffect, useRef, useState } from 'react';
import { type TextProps } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useWorkflowEntrance } from './WorkflowEntrance';

import { advanceStreamText } from './stream-motion-model';

export function useStreamingText(text: string, streaming: boolean): string {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(text);
  const visibleRef = useRef(text);
  const targetRef = useRef(text);
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const burstStartRef = useRef(0);

  useEffect(() => {
    targetRef.current = text;
    if (!streaming || reduceMotion || !text.startsWith(visibleRef.current)) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      visibleRef.current = text;
      setVisible(text);
      return;
    }
    if (frameRef.current !== null || text === visibleRef.current) return;
    lastFrameRef.current = performance.now();
    burstStartRef.current = lastFrameRef.current;
    const tick = (now: number) => {
      const elapsed = now - lastFrameRef.current;
      // Bound text shaping to 30 updates/s, independently of the transport rate.
      if (elapsed >= 32) {
        const next = now - burstStartRef.current >= 160
          ? targetRef.current : advanceStreamText(visibleRef.current, targetRef.current, elapsed);
        visibleRef.current = next;
        setVisible(next);
        lastFrameRef.current = now;
      }
      frameRef.current = visibleRef.current === targetRef.current ? null : requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [text, streaming, reduceMotion]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);
  // Completion, corrections and history must never display stale buffered text.
  return !streaming || reduceMotion || !text.startsWith(visible) ? text : visible;
}

export const StreamingText = memo(function StreamingText({ text, streaming, style, ...props }: TextProps & {
  text: string;
  streaming: boolean;
}) {
  const visible = useStreamingText(text, streaming);
  const entrance = useWorkflowEntrance();
  return <Animated.Text {...props} style={[style, entrance]}
    selectable={!streaming}>{visible}</Animated.Text>;
});
