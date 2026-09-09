import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { HermesApiClient } from '../../src/api/HermesApiClient';
import type { HermesChatViewMessage, HermesChatActivity } from '../../src/api/chat-view-types';
import { ThemeProvider, useTheme } from '../../src/design/ThemeProvider';
import { ChatMessageStream } from '../../src/studio/chat/ChatMessageStream';
import { useChatScrollController } from '../../src/studio/chat/useChatScrollController';
import { getNativeFrameRateDiagnostics, resetNativeFrameRateDiagnostics, startNativeFrameRateController } from '../../modules/hermes-ios-controls';

const noop = () => {};
// This entry is requested directly by the local browser verifier, never by App.
const themeClient = { request: () => Promise.reject(new Error('Offline motion fixture')) } as unknown as HermesApiClient;
const started = Date.now();
const thought = '\u5148\u68c0\u67e5\u5de5\u5177\u4e8b\u4ef6\u7684\u987a\u5e8f\uff0c\u518d\u786e\u8ba4\u6587\u672c\u589e\u91cf\u548c\u7ed3\u679c\u5448\u73b0\u3002\u8fd9\u4e9b\u66f4\u65b0\u9700\u8981\u4fdd\u6301\u8fde\u7eed\u3002';
const report = '\u5df2\u68c0\u67e5\u589e\u91cf\u4e8b\u4ef6\uff0c\u6b63\u5728\u6574\u7406\u6267\u884c\u7ed3\u679c\u3002';
const base: HermesChatViewMessage = {
  id: 'motion-answer', renderKey: 'motion-answer', runtimeTurnId: 'motion-turn',
  role: 'assistant', roleStage: 'chat', name: 'Hermes', content: '',
  status: 'running', startedAt: started, createdAt: started, firstTokenAt: started,
};

function Fixture() {
  const { tokens } = useTheme();
  const scroll = useChatScrollController(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    startNativeFrameRateController();
    void resetNativeFrameRateDiagnostics();
    const start = performance.now();
    const timer = setInterval(() => {
      const elapsed = performance.now() - start;
      setTick(elapsed);
      if (elapsed > 12000) {
        clearInterval(timer);
        void getNativeFrameRateDiagnostics().then(diagnostics => {
          if (diagnostics) console.info('[hermes-ios-motion]', JSON.stringify(diagnostics));
        });
      }
    }, 20);
    return () => clearInterval(timer);
  }, []);
  const complete = tick >= 10500;
  const reasoning: HermesChatActivity = {
    id: 'motion-reasoning', category: 'reasoning', name: 'Reasoning', duration: '', preview: '',
    startedAt: started, status: tick < 3800 ? 'running' : 'completed',
    output: thought.repeat(12).slice(0, Math.floor(Math.min(tick, 3800) / 8)),
  };
  const tools: HermesChatActivity[] = tick < 4000 ? [] : Array.from({ length: Math.min(5, Math.floor((tick - 4000) / 700) + 1) }, (_, index) => ({
    id: `motion-tool-${index}`, category: 'command', name: 'terminal', toolName: 'terminal',
    duration: '', preview: '', startedAt: started + 4000 + index * 700,
    status: tick > 4900 + index * 700 ? 'completed' : 'running',
    input: JSON.stringify({ command: `inspect --part ${index + 1}` }),
    output: ('result: incremental output\n').repeat(Math.min(22, Math.floor((tick - 4000 - index * 700) / 70))),
  }));
  const message: HermesChatViewMessage = {
    ...base, status: complete ? 'completed' : 'streaming', updatedAt: started + tick,
    completedAt: complete ? started + tick : undefined,
    content: complete ? `## \u6267\u884c\u7ed3\u679c\n\n${report.repeat(15)}\n\n\`motion_complete\``
      : tick > 7800 ? report.repeat(15).slice(0, Math.floor((tick - 7800) / 7)) : '',
    activities: [reasoning, ...tools],
  };
  const history: HermesChatViewMessage[] = Array.from({ length: 8 }, (_, index) => ({
    id: `history-${index}`, name: 'Hermes', role: 'assistant', roleStage: 'chat',
    content: `History ${index + 1}\n\n${report.repeat(3)}`, status: 'completed',
  }));
  return <View style={{ flex: 1, backgroundColor: tokens.colors.background }}>
    <ChatMessageStream collaborationStartIndex={-1} collaborationState="single" compact
      hostedRunning={!complete} isChinese messages={[...history, message]}
      onBranch={noop} onChoiceInputFocus={noop} onCloseActivity={scroll.pauseStreamAutoFollow}
      onInspectActivity={scroll.pauseStreamAutoFollow} onJumpToLatest={() => scroll.keepLatestVisible(true, true)}
      onMentionMember={noop} onOpenAttachment={noop} onToggleSpeech={noop}
      onScroll={scroll.handleStreamScroll} onContentSizeChange={scroll.handleStreamContentSizeChange}
      onStreamLayout={scroll.handleStreamLayout} onScrollBeginDrag={scroll.pauseStreamAutoFollow}
      pendingPhase="thinking" pendingStartedAt={started} reconnectAttempt={0} safeAreaBottom={0}
      sending={false} showScrollToBottom={scroll.showScrollToBottom} slashMenuOpen={false}
      speakingMessageId="" streamRef={scroll.streamRef} keepLatestVisible={scroll.keepLatestVisible} />
  </View>;
}

function MotionPreview() {
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider>
    <ThemeProvider client={themeClient} preferenceNamespace="motion-preview"><Fixture /></ThemeProvider>
  </SafeAreaProvider></GestureHandlerRootView>;
}
registerRootComponent(MotionPreview);
