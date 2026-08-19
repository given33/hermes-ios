import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File as ExpoFile } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';

import {
  HermesIOSContext,
  hasNativeIOSContext,
  type IOSVoiceState,
} from '../../../modules/hermes-ios-context';
import type { HermesCloudApi } from '../../api/HermesCloudApi';

interface VoiceMessage {
  content: string;
  id: string;
  role: string;
  status?: string;
}

export type HermesVoiceState = IOSVoiceState['state'] | 'transcribing';

interface UseHermesVoiceOptions {
  agentTurnActive: boolean;
  applyTranscript(value: string): void;
  cloudApi: HermesCloudApi | null;
  describeError(error: unknown): string;
  focusComposer(): void;
  getDraft(): string;
  isChinese: boolean;
  messages: readonly VoiceMessage[];
  notify(message: string): void;
  onInterruptAgent?(): Promise<void> | void;
}

function recordingMimeType(uri: string): string {
  const normalized = uri.toLowerCase();
  if (normalized.endsWith('.m4a') || normalized.endsWith('.mp4')) return 'audio/mp4';
  if (normalized.endsWith('.aac')) return 'audio/aac';
  if (normalized.endsWith('.wav')) return 'audio/wav';
  return 'audio/webm';
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

function deleteTemporaryRecording(uri: string): void {
  if (!uri) return;
  try {
    const file = new ExpoFile(uri);
    if (file.exists) file.delete();
  } catch {
    // The recorder may already have released its temporary file.
  }
}

export function useHermesVoice({
  agentTurnActive,
  applyTranscript,
  cloudApi,
  describeError,
  focusComposer,
  getDraft,
  isChinese,
  messages,
  notify,
  onInterruptAgent,
}: UseHermesVoiceOptions) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [voiceState, setVoiceState] = useState<HermesVoiceState>('idle');
  const [voiceError, setVoiceError] = useState('');
  const [voicePreview, setVoicePreview] = useState('');
  const [nativeVoiceDurationMs, setNativeVoiceDurationMs] = useState(0);
  const [readRepliesAloud, setReadRepliesAloud] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState('');
  const voiceDraftBeforeRef = useRef('');
  const voiceDraftPrefixRef = useRef('');
  const autoSpokenMessageIdRef = useRef('');
  const expoRecordingRef = useRef(false);
  const nativeVoiceStartedAtRef = useRef(0);
  const acceptNativeTranscriptRef = useRef(false);
  const voiceOperationRef = useRef(0);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const streamingSpeechCursorRef = useRef({
    finishing: false,
    messageId: '',
    sourceLength: 0,
  });
  const streamingSpeechGenerationRef = useRef(0);
  const streamingSpeechQueueRef = useRef<Promise<void>>(Promise.resolve());

  const restoreVoiceDraft = useCallback(() => {
    applyTranscript(voiceDraftBeforeRef.current);
    setVoicePreview('');
  }, [applyTranscript]);

  const applyFinalTranscript = useCallback((transcript: string) => {
    const normalized = transcript.trim();
    if (!normalized) {
      throw new Error(isChinese ? '没有识别到语音，请重试。' : 'No speech was recognized. Try again.');
    }
    applyTranscript(`${voiceDraftPrefixRef.current}${normalized}`);
    setVoicePreview(normalized);
  }, [applyTranscript, isChinese]);

  const stopCurrentSpeech = useCallback(async (interrupted = false) => {
    streamingSpeechGenerationRef.current += 1;
    streamingSpeechCursorRef.current = {
      finishing: false,
      messageId: '',
      sourceLength: 0,
    };
    if (hasNativeIOSContext) {
      if (interrupted) await HermesIOSContext.interruptSpeaking();
      else await HermesIOSContext.stopSpeaking();
    } else {
      await Speech.stop();
    }
    setSpeakingMessageId('');
  }, []);

  const speakText = useCallback(async (text: string, messageId: string) => {
    await stopCurrentSpeech();
    if (hasNativeIOSContext) {
      const started = await HermesIOSContext.speakText(
        text,
        isChinese ? 'zh-CN' : 'en-US',
        0.5,
      );
      setSpeakingMessageId(started ? messageId : '');
      return;
    }
    setSpeakingMessageId(messageId);
    Speech.speak(text, {
      language: isChinese ? 'zh-CN' : 'en-US',
      onDone: () => setSpeakingMessageId((current) => current === messageId ? '' : current),
      onError: (error) => {
        setSpeakingMessageId((current) => current === messageId ? '' : current);
        notify(describeError(error));
      },
      onStopped: () => setSpeakingMessageId((current) => current === messageId ? '' : current),
      // expo-speech scale: 1.0 is normal pace (unlike AVSpeechUtterance
      // where 0.5 is normal — the native path above is already correct).
      rate: 1.0,
    });
  }, [describeError, isChinese, notify, stopCurrentSpeech]);

  const stopExpoVoiceInput = useCallback(async (operation: number) => {
    setVoiceState('transcribing');
    let uri = '';
    try {
      await recorder.stop();
      expoRecordingRef.current = false;
      uri = recorder.uri || recorderState.url || '';
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (operation !== voiceOperationRef.current) return;
      if (!uri) throw new Error('Hermes could not read the voice recording');
      if (!cloudApi) throw new Error('Hermes server connection is unavailable');
      const file = new ExpoFile(uri);
      const mimeType = recordingMimeType(uri);
      const base64 = await file.base64();
      if (operation !== voiceOperationRef.current) return;
      const abortController = new AbortController();
      transcriptionAbortRef.current = abortController;
      const result = await cloudApi.transcribeAudio(
        `data:${mimeType};base64,${base64}`,
        mimeType,
        abortController.signal,
      );
      if (operation !== voiceOperationRef.current) return;
      applyFinalTranscript(result.transcript);
      setVoiceError('');
      focusComposer();
    } catch (error) {
      if (operation !== voiceOperationRef.current || isAbortError(error)) return;
      restoreVoiceDraft();
      const message = describeError(error);
      setVoiceError(message);
      notify(message);
    } finally {
      expoRecordingRef.current = false;
      if (operation === voiceOperationRef.current) setVoiceState('idle');
      if (transcriptionAbortRef.current?.signal.aborted || operation === voiceOperationRef.current) {
        transcriptionAbortRef.current = null;
      }
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
        .catch(() => undefined);
      deleteTemporaryRecording(uri);
    }
  }, [
    applyFinalTranscript,
    cloudApi,
    describeError,
    focusComposer,
    notify,
    recorder,
    recorderState.url,
    restoreVoiceDraft,
  ]);

  const stopVoiceInput = useCallback(async () => {
    if (voiceState !== 'listening') return;
    const operation = ++voiceOperationRef.current;
    try {
      setVoiceError('');
      if (hasNativeIOSContext) {
        acceptNativeTranscriptRef.current = false;
        setVoiceState('transcribing');
        const transcript = await HermesIOSContext.stopVoiceRecognition();
        if (operation !== voiceOperationRef.current) return;
        applyFinalTranscript(transcript);
        setVoiceState('idle');
        focusComposer();
        return;
      }
      if (expoRecordingRef.current) {
        await stopExpoVoiceInput(operation);
      }
    } catch (error) {
      if (operation !== voiceOperationRef.current) return;
      restoreVoiceDraft();
      setVoiceState('idle');
      const message = describeError(error);
      setVoiceError(message);
      notify(message);
    }
  }, [
    applyFinalTranscript,
    describeError,
    focusComposer,
    notify,
    restoreVoiceDraft,
    stopExpoVoiceInput,
    voiceState,
  ]);

  const cancelVoiceInput = useCallback(async () => {
    ++voiceOperationRef.current;
    acceptNativeTranscriptRef.current = false;
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    try {
      if (hasNativeIOSContext) {
        await HermesIOSContext.stopVoiceRecognition();
      } else if (expoRecordingRef.current || recorderState.isRecording) {
        await recorder.stop();
      }
    } catch {
      // Cancellation is best-effort; restoring the draft is authoritative.
    } finally {
      expoRecordingRef.current = false;
      deleteTemporaryRecording(recorder.uri || recorderState.url || '');
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
        .catch(() => undefined);
      restoreVoiceDraft();
      setVoiceError('');
      setVoiceState('idle');
      focusComposer();
    }
  }, [focusComposer, recorder, recorderState.isRecording, recorderState.url, restoreVoiceDraft]);

  const startVoiceInput = useCallback(async () => {
    if (voiceState === 'listening' || voiceState === 'transcribing') return;
    const operation = ++voiceOperationRef.current;
    try {
      if (agentTurnActive) {
        void Promise.resolve()
          .then(() => onInterruptAgent?.())
          .catch((error) => {
            notify(describeError(error));
          });
      }
      await stopCurrentSpeech(agentTurnActive || voiceState === 'speaking');
      setVoiceError('');
      setVoicePreview('');
      const currentDraft = getDraft();
      voiceDraftBeforeRef.current = currentDraft;
      const current = currentDraft.trimEnd();
      voiceDraftPrefixRef.current = current ? `${current} ` : '';
      if (hasNativeIOSContext) {
        const authorization = await HermesIOSContext.requestVoiceAuthorization();
        if (authorization.microphone !== 'authorized' || authorization.speech !== 'authorized') {
          const message = isChinese
            ? '请在系统设置中允许 Hermes 使用麦克风和语音识别。'
            : 'Allow Hermes to use Microphone and Speech Recognition in Settings.';
          setVoiceError(message);
          notify(message);
          return;
        }
        if (operation !== voiceOperationRef.current) return;
        Keyboard.dismiss();
        acceptNativeTranscriptRef.current = true;
        nativeVoiceStartedAtRef.current = Date.now();
        setNativeVoiceDurationMs(0);
        await HermesIOSContext.startVoiceRecognition(isChinese ? 'zh-CN' : 'en-US');
        if (operation === voiceOperationRef.current) setVoiceState('listening');
        return;
      }

      if (!cloudApi) {
        throw new Error(isChinese ? '请先连接 Hermes 服务。' : 'Connect to Hermes first.');
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        const message = isChinese
          ? '请在系统设置中允许 Hermes 使用麦克风。'
          : 'Allow Hermes to use the microphone in Settings.';
        setVoiceError(message);
        notify(message);
        return;
      }
      if (operation !== voiceOperationRef.current) return;
      Keyboard.dismiss();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      expoRecordingRef.current = true;
      nativeVoiceStartedAtRef.current = Date.now();
      setVoiceState('listening');
    } catch (error) {
      if (operation !== voiceOperationRef.current) return;
      expoRecordingRef.current = false;
      acceptNativeTranscriptRef.current = false;
      restoreVoiceDraft();
      setVoiceState('idle');
      const message = describeError(error);
      setVoiceError(message);
      notify(message);
    }
  }, [
    agentTurnActive,
    cloudApi,
    describeError,
    focusComposer,
    getDraft,
    isChinese,
    notify,
    onInterruptAgent,
    recorder,
    restoreVoiceDraft,
    stopCurrentSpeech,
    voiceState,
  ]);

  const toggleMessageSpeech = useCallback(async (message: VoiceMessage) => {
    try {
      if (speakingMessageId === message.id) {
        await stopCurrentSpeech();
        return;
      }
      await speakText(message.content, message.id);
    } catch (error) {
      notify(describeError(error));
    }
  }, [describeError, notify, speakText, speakingMessageId, stopCurrentSpeech]);

  const toggleReadRepliesAloud = useCallback(() => {
    if (readRepliesAloud) {
      setReadRepliesAloud(false);
      void stopCurrentSpeech().catch(() => undefined);
      return;
    }
    autoSpokenMessageIdRef.current = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.status === 'completed')
      ?.id || '';
    setReadRepliesAloud(true);
  }, [messages, readRepliesAloud, stopCurrentSpeech]);

  useEffect(() => {
    if (
      !readRepliesAloud
      || voiceState === 'listening'
      || voiceState === 'transcribing'
    ) return;
    const latest = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && Boolean(message.content.trim()));
    if (!latest) return;

    if (!hasNativeIOSContext) {
      if (latest.status !== 'completed' || autoSpokenMessageIdRef.current === latest.id) return;
      autoSpokenMessageIdRef.current = latest.id;
      void speakText(latest.content, latest.id).catch((error) => notify(describeError(error)));
      return;
    }

    if (
      autoSpokenMessageIdRef.current === latest.id
      && streamingSpeechCursorRef.current.messageId !== latest.id
    ) return;

    const generation = streamingSpeechGenerationRef.current;
    streamingSpeechQueueRef.current = streamingSpeechQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (generation !== streamingSpeechGenerationRef.current) return;
        const status = (latest.status || '').toLowerCase();
        const failed = status === 'failed' || status === 'cancelled' || status === 'canceled';
        const pending = status === 'queued' || status === 'running';
        const cursor = streamingSpeechCursorRef.current;

        if (failed) {
          if (cursor.messageId === latest.id) await HermesIOSContext.interruptSpeaking();
          streamingSpeechCursorRef.current = {
            finishing: false,
            messageId: '',
            sourceLength: 0,
          };
          setSpeakingMessageId('');
          return;
        }

        if (
          cursor.messageId !== latest.id
          || latest.content.length < cursor.sourceLength
        ) {
          await HermesIOSContext.stopSpeaking();
          if (generation !== streamingSpeechGenerationRef.current) return;
          const started = await HermesIOSContext.startStreamingSpeech(
            isChinese ? 'zh-CN' : 'en-US',
            0.5,
          );
          if (!started || generation !== streamingSpeechGenerationRef.current) return;
          streamingSpeechCursorRef.current = {
            finishing: false,
            messageId: latest.id,
            sourceLength: 0,
          };
          setSpeakingMessageId(latest.id);
        }

        const active = streamingSpeechCursorRef.current;
        if (active.messageId !== latest.id) return;
        const delta = latest.content.slice(active.sourceLength);
        if (delta) {
          await HermesIOSContext.appendStreamingSpeech(delta);
          active.sourceLength = latest.content.length;
        }
        if (!pending && !active.finishing) {
          active.finishing = true;
          await HermesIOSContext.finishStreamingSpeech();
          autoSpokenMessageIdRef.current = latest.id;
        }
      })
      .catch((error) => {
        if (generation !== streamingSpeechGenerationRef.current) return;
        setSpeakingMessageId('');
        notify(describeError(error));
      });
  }, [describeError, isChinese, messages, notify, readRepliesAloud, speakText, voiceState]);

  useEffect(() => {
    if (voiceState !== 'listening' || !hasNativeIOSContext) {
      if (voiceState !== 'transcribing') setNativeVoiceDurationMs(0);
      return undefined;
    }
    const updateDuration = () => {
      setNativeVoiceDurationMs(Math.max(0, Date.now() - nativeVoiceStartedAtRef.current));
    };
    updateDuration();
    const interval = setInterval(updateDuration, 250);
    return () => clearInterval(interval);
  }, [voiceState]);

  useEffect(() => {
    if (!hasNativeIOSContext) return undefined;
    const transcript = HermesIOSContext.subscribeVoiceTranscript((event) => {
      if (!acceptNativeTranscriptRef.current) return;
      setVoicePreview(event.text);
      applyTranscript(`${voiceDraftPrefixRef.current}${event.text}`);
      if (event.isFinal) {
        acceptNativeTranscriptRef.current = false;
        setVoiceError('');
        focusComposer();
      }
    });
    const state = HermesIOSContext.subscribeVoiceState((event) => {
      setVoiceState(event.state);
      if (event.state !== 'speaking') setSpeakingMessageId('');
      if (event.state === 'listening' && nativeVoiceStartedAtRef.current <= 0) {
        nativeVoiceStartedAtRef.current = Date.now();
      }
      if (event.error) {
        acceptNativeTranscriptRef.current = false;
        restoreVoiceDraft();
        setVoiceError(event.error);
        notify(event.error);
      }
    });
    return () => {
      transcript.remove();
      state.remove();
      void HermesIOSContext.stopVoiceRecognition().catch(() => undefined);
      void HermesIOSContext.stopSpeaking().catch(() => undefined);
    };
  }, [applyTranscript, focusComposer, notify, restoreVoiceDraft]);

  useEffect(() => () => {
    ++voiceOperationRef.current;
    transcriptionAbortRef.current?.abort();
    acceptNativeTranscriptRef.current = false;
    if (expoRecordingRef.current) {
      void recorder.stop().catch(() => undefined);
    }
    if (!hasNativeIOSContext) void Speech.stop().catch(() => undefined);
  }, [recorder]);

  return {
    cancelVoiceInput,
    readRepliesAloud,
    speakingMessageId,
    startVoiceInput,
    stopVoiceInput,
    toggleMessageSpeech,
    toggleReadRepliesAloud,
    voiceDurationMs: hasNativeIOSContext
      ? nativeVoiceDurationMs
      : voiceState === 'listening' ? recorderState.durationMillis : 0,
    voiceError,
    voicePreview,
    voiceState,
  };
}
