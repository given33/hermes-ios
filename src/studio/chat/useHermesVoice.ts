import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';

import {
  HermesIOSContext,
  hasNativeIOSContext,
  type IOSVoiceState,
} from '../../../modules/hermes-ios-context';

interface VoiceMessage {
  content: string;
  id: string;
  role: string;
  status?: string;
}

interface UseHermesVoiceOptions {
  applyTranscript(value: string): void;
  describeError(error: unknown): string;
  focusComposer(): void;
  getDraft(): string;
  isChinese: boolean;
  messages: readonly VoiceMessage[];
  notify(message: string): void;
}

export function useHermesVoice({
  applyTranscript,
  describeError,
  focusComposer,
  getDraft,
  isChinese,
  messages,
  notify,
}: UseHermesVoiceOptions) {
  const [voiceState, setVoiceState] = useState<IOSVoiceState['state']>('idle');
  const [voiceError, setVoiceError] = useState('');
  const [readRepliesAloud, setReadRepliesAloud] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState('');
  const voiceDraftPrefixRef = useRef('');
  const autoSpokenMessageIdRef = useRef('');

  const toggleVoiceInput = useCallback(async () => {
    if (!hasNativeIOSContext) {
      notify(isChinese
        ? '语音输入需要在 iPhone 原生版本中使用。'
        : 'Voice input is available in the native iPhone build.');
      return;
    }
    try {
      setVoiceError('');
      if (voiceState === 'listening') {
        await HermesIOSContext.stopVoiceRecognition();
        focusComposer();
        return;
      }
      const authorization = await HermesIOSContext.requestVoiceAuthorization();
      if (authorization.microphone !== 'authorized' || authorization.speech !== 'authorized') {
        const message = isChinese
          ? '请在系统设置中允许 Hermes 使用麦克风和语音识别。'
          : 'Allow Hermes to use Microphone and Speech Recognition in Settings.';
        setVoiceError(message);
        notify(message);
        return;
      }
      const current = getDraft().trimEnd();
      voiceDraftPrefixRef.current = current ? `${current} ` : '';
      Keyboard.dismiss();
      await HermesIOSContext.startVoiceRecognition(isChinese ? 'zh-CN' : 'en-US');
    } catch (error) {
      const message = describeError(error);
      setVoiceError(message);
      notify(message);
    }
  }, [describeError, focusComposer, getDraft, isChinese, notify, voiceState]);

  const toggleMessageSpeech = useCallback(async (message: VoiceMessage) => {
    if (!hasNativeIOSContext) {
      notify(isChinese
        ? '朗读功能需要在 iPhone 原生版本中使用。'
        : 'Read aloud is available in the native iPhone build.');
      return;
    }
    try {
      if (speakingMessageId === message.id) {
        await HermesIOSContext.stopSpeaking();
        setSpeakingMessageId('');
        return;
      }
      await HermesIOSContext.stopSpeaking();
      const started = await HermesIOSContext.speakText(
        message.content,
        isChinese ? 'zh-CN' : 'en-US',
        0.5,
      );
      setSpeakingMessageId(started ? message.id : '');
    } catch (error) {
      notify(describeError(error));
    }
  }, [describeError, isChinese, notify, speakingMessageId]);

  const toggleReadRepliesAloud = useCallback(() => {
    if (!hasNativeIOSContext) {
      notify(isChinese
        ? '自动朗读需要在 iPhone 原生版本中使用。'
        : 'Automatic read-aloud is available in the native iPhone build.');
      return;
    }
    if (readRepliesAloud) {
      setReadRepliesAloud(false);
      setSpeakingMessageId('');
      void HermesIOSContext.stopSpeaking().catch(() => undefined);
      return;
    }
    autoSpokenMessageIdRef.current = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.status === 'completed')
      ?.id || '';
    setReadRepliesAloud(true);
  }, [isChinese, messages, notify, readRepliesAloud]);

  useEffect(() => {
    if (!readRepliesAloud || !hasNativeIOSContext || voiceState === 'listening') return;
    const latest = [...messages]
      .reverse()
      .find((message) => (
        message.role === 'assistant'
        && message.status === 'completed'
        && Boolean(message.content.trim())
      ));
    if (!latest || autoSpokenMessageIdRef.current === latest.id) return;
    autoSpokenMessageIdRef.current = latest.id;
    void HermesIOSContext.stopSpeaking()
      .then(() => HermesIOSContext.speakText(
        latest.content,
        isChinese ? 'zh-CN' : 'en-US',
        0.5,
      ))
      .then((started) => setSpeakingMessageId(started ? latest.id : ''))
      .catch((error) => notify(describeError(error)));
  }, [describeError, isChinese, messages, notify, readRepliesAloud, voiceState]);

  useEffect(() => {
    if (!hasNativeIOSContext) return undefined;
    const transcript = HermesIOSContext.subscribeVoiceTranscript((event) => {
      applyTranscript(`${voiceDraftPrefixRef.current}${event.text}`);
    });
    const state = HermesIOSContext.subscribeVoiceState((event) => {
      setVoiceState(event.state);
      if (event.state !== 'speaking') setSpeakingMessageId('');
      if (event.error) setVoiceError(event.error);
    });
    return () => {
      transcript.remove();
      state.remove();
      void HermesIOSContext.stopVoiceRecognition().catch(() => undefined);
      void HermesIOSContext.stopSpeaking().catch(() => undefined);
    };
  }, [applyTranscript]);

  return {
    readRepliesAloud,
    speakingMessageId,
    toggleMessageSpeech,
    toggleReadRepliesAloud,
    toggleVoiceInput,
    voiceError,
    voiceState,
  };
}
