import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { HermesApiClient } from '../../src/api/HermesApiClient';
import type { HermesChatViewMessage } from '../../src/api/chat-view-model';
import { ThemeProvider, useTheme } from '../../src/design/ThemeProvider';
import { ChatMessageStream } from '../../src/studio/chat/ChatMessageStream';
import { useChatScrollController } from '../../src/studio/chat/useChatScrollController';

const noop = () => {};
const client = { request: () => Promise.reject(new Error('Offline timeline fixture')) } as unknown as HermesApiClient;
const history: HermesChatViewMessage[] = Array.from({ length: 24 }, (_, index) => [
  { id: `task-${index}`, role: 'user' as const, name: 'User', content: `Task ${index + 1}: ${'Inspect the workflow and preserve message ordering. '.repeat(index % 6 + 1)}` },
  { id: `answer-${index}`, role: 'assistant' as const, name: 'Hermes', status: 'completed', content: `Result ${index + 1}\n\n${'The task has been recorded. '.repeat(12)}` },
]).flat();

function Fixture() {
  const scroll = useChatScrollController(0);
  const { tokens } = useTheme();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(value => value + 1), 100);
    return () => clearInterval(timer);
  }, []);
  const live: HermesChatViewMessage = { id: 'live', role: 'assistant', name: 'Hermes', status: 'streaming', runtimeTurnId: 'timeline-live', content: '',
    activities: [{ id: 'reasoning', name: 'Reasoning', category: 'reasoning', status: 'running', duration: '', preview: '', output: 'Checking incremental updates. '.repeat(Math.min(tick, 100)) }] };
  return <View style={{ flex: 1, backgroundColor: tokens.colors.background }}>
    <ChatMessageStream collaborationStartIndex={-1} collaborationState="single" compact hostedRunning isChinese
      messages={[...history, live]} onBranch={noop} onChoiceInputFocus={noop} onCloseActivity={scroll.pauseStreamAutoFollow}
      onInspectActivity={scroll.pauseStreamAutoFollow} onJumpToLatest={() => scroll.keepLatestVisible(true, true)}
      onMentionMember={noop} onOpenAttachment={noop} onToggleSpeech={noop} onScroll={scroll.handleStreamScroll}
      onContentSizeChange={scroll.handleStreamContentSizeChange} onStreamLayout={scroll.handleStreamLayout}
      onScrollBeginDrag={scroll.pauseStreamAutoFollow} scrollOffset={scroll.scrollOffset} onScrollToOffset={scroll.scrollToOffset}
      pendingPhase="thinking" pendingStartedAt={0} reconnectAttempt={0} safeAreaBottom={0} sending={false}
      showScrollToBottom={scroll.showScrollToBottom} slashMenuOpen={false} speakingMessageId=""
      streamRef={scroll.streamRef} keepLatestVisible={scroll.keepLatestVisible} />
  </View>;
}

registerRootComponent(() => <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider>
  <ThemeProvider client={client} preferenceNamespace="timeline-preview"><Fixture /></ThemeProvider>
</SafeAreaProvider></GestureHandlerRootView>);
