import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
} from 'expo-audio';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';

import {
  HermesIOSContext,
  hasNativeIOSContext,
  type IOSVoiceState,
} from '../../../modules/hermes-ios-context';
import type { ElevenLabsVoice } from '../../api/cloud/audio';
import type { HermesCloudApi } from '../../api/HermesCloudApi';
import { ServerSpeechSession } from './server-speech-session';
import { createPCMPlaybackSink } from './pcm-playback-sink';
import { readVoiceRecording, releaseVoiceRecording } from './voice-recording';
import { useVoiceCapture } from './useVoiceCapture';
import {
  LOADING_VOICE_RUNTIME,
  resolveVoiceRuntime,
  shouldLoadElevenLabsVoices,
  type VoiceRuntimePolicy,
} from './voice-runtime-policy';

interface VoiceMessage {
  content: string;
  id: string;
  role: string;
  status?: string;
}

interface StreamingSpeechCursor {
  finishing: boolean;
  messageId: string;
  sourceLength: number;
}

interface ServerSpeechCursor extends StreamingSpeechCursor {
  session: ServerSpeechSession | null;
}

interface FallbackPlayback {
  listener: { remove(): void };
  player: AudioPlayer;
  resolve(): void;
  timer: ReturnType<typeof setTimeout>;
}

export type HermesVoiceState = IOSVoiceState['state'] | 'transcribing';
export type HermesVoiceChoice = Pick<ElevenLabsVoice, 'label' | 'name' | 'voice_id'>;

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
  onSubmitTranscript?(text: string): void;
  profile?: string;
}

const EMPTY_STREAMING_CURSOR: StreamingSpeechCursor = {
  finishing: false,
  messageId: '',
  sourceLength: 0,
};

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

function deleteTemporaryRecording(uri: string): void {
  releaseVoiceRecording(uri);
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
  onSubmitTranscript,
  profile = 'default',
}: UseHermesVoiceOptions) {
  const { recorder, state: recorderState } = useVoiceCapture();
  const [voiceRuntime, setVoiceRuntime] = useState<VoiceRuntimePolicy>(LOADING_VOICE_RUNTIME);
  const [voiceChoices, setVoiceChoices] = useState<HermesVoiceChoice[]>([]);
  const [voiceChoiceBusy, setVoiceChoiceBusy] = useState(false);
  const [voiceState, setVoiceState] = useState<HermesVoiceState>('idle');
  const [voiceError, setVoiceError] = useState('');
  const [voicePreview, setVoicePreview] = useState('');
  const [nativeVoiceDurationMs, setNativeVoiceDurationMs] = useState(0);
  const [readRepliesAloud, setReadRepliesAloud] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState('');
  const [voiceConversation, setVoiceConversation] = useState(false);
  const conversationRef = useRef(false);
  const awaitingResponseRef = useRef(false);
  const speechHeardRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const closingRecordingRef = useRef(false);
  const voiceDraftBeforeRef = useRef('');
  const voiceDraftPrefixRef = useRef('');
  const autoSpokenMessageIdRef = useRef('');
  const expoRecordingRef = useRef(false);
  const nativeRecognitionRef = useRef(false);
  const nativeVoiceStartedAtRef = useRef(0);
  const acceptNativeTranscriptRef = useRef(false);
  const voiceOperationRef = useRef(0);
  const voiceConfigGenerationRef = useRef(0);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const nativeSpeechCursorRef = useRef<StreamingSpeechCursor>({ ...EMPTY_STREAMING_CURSOR });
  const serverSpeechCursorRef = useRef<ServerSpeechCursor>({
    ...EMPTY_STREAMING_CURSOR,
    session: null,
  });
  const streamingSpeechGenerationRef = useRef(0);
  const streamingSpeechQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeServerSpeechRef = useRef<{ messageId: string; session: ServerSpeechSession } | null>(null);
  const fallbackPlayerRef = useRef<AudioPlayer | null>(null);
  const fallbackPlaybackRef = useRef<FallbackPlayback | null>(null);

  const restoreVoiceDraft = useCallback(() => {
    applyTranscript(voiceDraftBeforeRef.current);
    setVoicePreview('');
  }, [applyTranscript]);

  const applyFinalTranscript = useCallback((transcript: string) => {
    const normalized = transcript.trim();
    if (!normalized) {
      setVoicePreview(isChinese ? '未检测到语音，正在继续聆听' : 'No speech detected. Listening again.');
      return;
    }
    if (conversationRef.current && /^(停止|结束|退出语音|结束语音|stop|goodbye|never mind)[。.!！]?$/i.test(normalized)) {
      conversationRef.current = false;
      setVoiceConversation(false);
      setReadRepliesAloud(false);
      return;
    }
    applyTranscript(`${voiceDraftPrefixRef.current}${normalized}`);
    setVoicePreview(normalized);
    if (conversationRef.current && onSubmitTranscript) {
      awaitingResponseRef.current = true;
      onSubmitTranscript(normalized);
    }
  }, [applyTranscript, isChinese, onSubmitTranscript]);

  const stopEncodedAudio = useCallback(() => {
    const playback = fallbackPlaybackRef.current;
    fallbackPlaybackRef.current = null;
    if (!playback) return;
    clearTimeout(playback.timer);
    playback.listener.remove();
    playback.player.pause();
    playback.resolve();
  }, []);

  const playEncodedAudio = useCallback(async (dataUrl: string) => {
    stopEncodedAudio();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const player = fallbackPlayerRef.current || createAudioPlayer(null, { updateInterval: 100 });
    fallbackPlayerRef.current = player;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        const active = fallbackPlaybackRef.current;
        if (!active || active.player !== player) return;
        fallbackPlaybackRef.current = null;
        clearTimeout(active.timer);
        active.listener.remove();
        if (error) reject(error);
        else resolve();
      };
      const listener = player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) finish();
        else if (status.playbackState === 'failed') {
          finish(new Error('Hermes fallback speech audio could not be played'));
        }
      });
      const timer = setTimeout(
        () => finish(new Error('Hermes fallback speech playback timed out')),
        180_000,
      );
      fallbackPlaybackRef.current = { listener, player, resolve, timer };
      try {
        player.replace(dataUrl);
        player.play();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }, [stopEncodedAudio]);

  const beginServerSpeech = useCallback((messageId: string): ServerSpeechSession => {
    if (!cloudApi) throw new Error('Hermes server connection is unavailable');
    const previous = activeServerSpeechRef.current;
    if (previous) void previous.session.stop(false);
    let session: ServerSpeechSession;
    session = new ServerSpeechSession({
      api: cloudApi,
      onError: (error) => {
        if (activeServerSpeechRef.current?.session !== session) return;
        activeServerSpeechRef.current = null;
        setSpeakingMessageId('');
        setVoiceState('idle');
        conversationRef.current = false;
        setVoiceConversation(false);
        notify(describeError(error));
      },
      onFinished: () => {
        if (activeServerSpeechRef.current?.session !== session) return;
        activeServerSpeechRef.current = null;
        setSpeakingMessageId('');
        setVoiceState('idle');
        awaitingResponseRef.current = false;
      },
      onStarted: () => {
        if (activeServerSpeechRef.current?.session !== session) return;
        setSpeakingMessageId(messageId);
        setVoiceState('speaking');
      },
      pcmSink: createPCMPlaybackSink(() => {
        if (activeServerSpeechRef.current?.session !== session) return;
        activeServerSpeechRef.current = null;
        awaitingResponseRef.current = false;
        setSpeakingMessageId('');
        setVoiceState('idle');
      }),
      playEncodedAudio,
      profile,
      stopEncodedAudio,
    });
    activeServerSpeechRef.current = { messageId, session };
    setSpeakingMessageId(messageId);
    return session;
  }, [cloudApi, describeError, notify, playEncodedAudio, profile, stopEncodedAudio]);

  const stopCurrentSpeech = useCallback(async (interrupted = false) => {
    streamingSpeechGenerationRef.current += 1;
    nativeSpeechCursorRef.current = { ...EMPTY_STREAMING_CURSOR };
    serverSpeechCursorRef.current = { ...EMPTY_STREAMING_CURSOR, session: null };
    const serverSpeech = activeServerSpeechRef.current;
    activeServerSpeechRef.current = null;
    await serverSpeech?.session.stop(interrupted);
    stopEncodedAudio();
    if (hasNativeIOSContext) {
      if (interrupted) await HermesIOSContext.interruptSpeaking();
      else await HermesIOSContext.stopSpeaking();
    }
    await Speech.stop();
    setSpeakingMessageId('');
    setVoiceState((current) => current === 'speaking' ? 'idle' : current);
  }, [stopEncodedAudio]);

  const speakText = useCallback(async (text: string, messageId: string) => {
    await stopCurrentSpeech();
    if (voiceRuntime.ttsMode === 'server') {
      const session = beginServerSpeech(messageId);
      session.append(text);
      session.finish();
      return;
    }
    if (voiceRuntime.ttsMode !== 'native') {
      throw new Error(isChinese ? '当前 Profile 未配置语音输出。' : 'Voice output is not configured for this profile.');
    }
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
      onDone: () => {
        awaitingResponseRef.current = false;
        setSpeakingMessageId((current) => current === messageId ? '' : current);
        setVoiceState('idle');
      },
      onError: (error) => {
        setSpeakingMessageId((current) => current === messageId ? '' : current);
        notify(describeError(error));
      },
      onStopped: () => setSpeakingMessageId((current) => current === messageId ? '' : current),
      rate: 1.0,
    });
  }, [beginServerSpeech, describeError, isChinese, notify, stopCurrentSpeech, voiceRuntime.ttsMode]);

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
      const { dataUrl, mimeType } = await readVoiceRecording(uri);
      if (operation !== voiceOperationRef.current) return;
      const abortController = new AbortController();
      transcriptionAbortRef.current = abortController;
      const result = await cloudApi.transcribeAudio(
        dataUrl,
        mimeType,
        abortController.signal,
        profile,
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
      conversationRef.current = false;
      setVoiceConversation(false);
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
    profile,
    recorder,
    recorderState.url,
    restoreVoiceDraft,
  ]);

  const stopVoiceInput = useCallback(async (forceTranscribe = true) => {
    if (voiceState !== 'listening' || closingRecordingRef.current) return;
    closingRecordingRef.current = true;
    const operation = ++voiceOperationRef.current;
    try {
      setVoiceError('');
      if (!forceTranscribe && !speechHeardRef.current && expoRecordingRef.current) {
        await recorder.stop();
        expoRecordingRef.current = false;
        deleteTemporaryRecording(recorder.uri || '');
        setVoiceState('idle');
        return;
      }
      if (nativeRecognitionRef.current) {
        nativeRecognitionRef.current = false;
        acceptNativeTranscriptRef.current = false;
        setVoiceState('transcribing');
        const transcript = await HermesIOSContext.stopVoiceRecognition();
        if (operation !== voiceOperationRef.current) return;
        applyFinalTranscript(transcript);
        setVoiceState('idle');
        focusComposer();
        return;
      }
      if (expoRecordingRef.current) await stopExpoVoiceInput(operation);
    } catch (error) {
      if (operation !== voiceOperationRef.current) return;
      restoreVoiceDraft();
      setVoiceState('idle');
      const message = describeError(error);
      setVoiceError(message);
      notify(message);
    } finally {
      closingRecordingRef.current = false;
    }
  }, [applyFinalTranscript, describeError, focusComposer, notify, recorder, restoreVoiceDraft, stopExpoVoiceInput, voiceState]);

  const cancelVoiceInput = useCallback(async () => {
    conversationRef.current = false;
    setVoiceConversation(false);
    awaitingResponseRef.current = false;
    setReadRepliesAloud(false);
    await stopCurrentSpeech();
    ++voiceOperationRef.current;
    acceptNativeTranscriptRef.current = false;
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    try {
      if (nativeRecognitionRef.current) {
        nativeRecognitionRef.current = false;
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
  }, [focusComposer, recorder, recorderState.isRecording, recorderState.url, restoreVoiceDraft, stopCurrentSpeech]);

  const startVoiceInput = useCallback(async () => {
    if (voiceState === 'listening' || voiceState === 'transcribing') return;
    const operation = ++voiceOperationRef.current;
    try {
      if (agentTurnActive) {
        void Promise.resolve().then(() => onInterruptAgent?.())
          .catch((error) => notify(describeError(error)));
      }
      await stopCurrentSpeech(agentTurnActive || voiceState === 'speaking');
      setVoiceError('');
      setVoicePreview('');
      speechHeardRef.current = false;
      lastSpeechAtRef.current = Date.now();
      if (!conversationRef.current) {
        autoSpokenMessageIdRef.current = [...messages].reverse().find((message) => message.role === 'assistant')?.id || '';
        conversationRef.current = true;
        setVoiceConversation(true);
        setReadRepliesAloud(true);
      }
      awaitingResponseRef.current = false;
      const currentDraft = getDraft();
      voiceDraftBeforeRef.current = currentDraft;
      const current = currentDraft.trimEnd();
      voiceDraftPrefixRef.current = current ? `${current} ` : '';

      if (!voiceRuntime.loaded || voiceRuntime.sttMode === 'unavailable') {
        throw new Error(isChinese ? '当前 Profile 未配置语音输入。' : 'Voice input is not configured for this profile.');
      }
      if (voiceRuntime.sttMode === 'native') {
        if (!hasNativeIOSContext) throw new Error('Native Apple Speech is unavailable in this build');
        const authorization = await HermesIOSContext.requestVoiceAuthorization();
        if (authorization.microphone !== 'authorized' || authorization.speech !== 'authorized') {
          const message = isChinese
            ? '请在系统设置中允许 Hermes 使用麦克风和语音识别。'
            : 'Allow Hermes to use Microphone and Speech Recognition in Settings.';
          setVoiceError(message);
          notify(message);
          conversationRef.current = false;
          setVoiceConversation(false);
          return;
        }
        if (operation !== voiceOperationRef.current) return;
        Keyboard.dismiss();
        acceptNativeTranscriptRef.current = true;
        nativeRecognitionRef.current = true;
        nativeVoiceStartedAtRef.current = Date.now();
        setNativeVoiceDurationMs(0);
        await HermesIOSContext.startVoiceRecognition(isChinese ? 'zh-CN' : 'en-US');
        if (operation === voiceOperationRef.current) setVoiceState('listening');
        return;
      }

      if (!cloudApi) throw new Error(isChinese ? '请先连接 Hermes 服务。' : 'Connect to Hermes first.');
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        const message = isChinese
          ? '请在系统设置中允许 Hermes 使用麦克风。'
          : 'Allow Hermes to use the microphone in Settings.';
        setVoiceError(message);
        notify(message);
        conversationRef.current = false;
        setVoiceConversation(false);
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
      nativeRecognitionRef.current = false;
      acceptNativeTranscriptRef.current = false;
      restoreVoiceDraft();
      setVoiceState('idle');
      const message = describeError(error);
      conversationRef.current = false;
      setVoiceConversation(false);
      setVoiceError(message);
      notify(message);
    }
  }, [
    agentTurnActive, cloudApi, describeError, getDraft, isChinese, notify, onInterruptAgent,
    messages, recorder, restoreVoiceDraft, stopCurrentSpeech, voiceRuntime.loaded, voiceRuntime.sttMode, voiceState,
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
      conversationRef.current = false;
      setVoiceConversation(false);
      setReadRepliesAloud(false);
      if (hasNativeIOSContext) {
        void HermesIOSContext.setVoiceNarrationEnabled(false).catch(() => undefined);
      }
      void stopCurrentSpeech().catch(() => undefined);
      return;
    }
    if (!voiceRuntime.loaded || voiceRuntime.ttsMode === 'unavailable') {
      const message = isChinese ? '当前 Profile 未配置语音输出。' : 'Voice output is not configured for this profile.';
      setVoiceError(message);
      notify(message);
      return;
    }
    autoSpokenMessageIdRef.current = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.status === 'completed')
      ?.id || '';
    if (hasNativeIOSContext) {
      void HermesIOSContext.setVoiceNarrationEnabled(true).catch(() => undefined);
    }
    setReadRepliesAloud(true);
  }, [isChinese, messages, notify, readRepliesAloud, stopCurrentSpeech, voiceRuntime]);

  const selectVoice = useCallback(async (voiceId: string) => {
    const choice = voiceChoices.find((voice) => voice.voice_id === voiceId);
    if (!choice || !cloudApi || voiceChoiceBusy) return;
    const generation = voiceConfigGenerationRef.current;
    setVoiceChoiceBusy(true);
    try {
      await stopCurrentSpeech();
      await cloudApi.saveConfig({ tts: { elevenlabs: { voice_id: choice.voice_id } } }, profile);
      if (generation !== voiceConfigGenerationRef.current) return;
      setVoiceRuntime((current) => ({ ...current, selectedVoiceId: choice.voice_id }));
    } catch (error) {
      if (generation === voiceConfigGenerationRef.current) notify(describeError(error));
    } finally {
      if (generation === voiceConfigGenerationRef.current) setVoiceChoiceBusy(false);
    }
  }, [cloudApi, describeError, notify, profile, stopCurrentSpeech, voiceChoiceBusy, voiceChoices]);

  useEffect(() => {
    const generation = ++voiceConfigGenerationRef.current;
    const abort = new AbortController();
    ++voiceOperationRef.current;
    ++streamingSpeechGenerationRef.current;
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    const wasExpoRecording = expoRecordingRef.current;
    acceptNativeTranscriptRef.current = false;
    nativeRecognitionRef.current = false;
    expoRecordingRef.current = false;
    void activeServerSpeechRef.current?.session.stop(false);
    activeServerSpeechRef.current = null;
    nativeSpeechCursorRef.current = { ...EMPTY_STREAMING_CURSOR };
    serverSpeechCursorRef.current = { ...EMPTY_STREAMING_CURSOR, session: null };
    stopEncodedAudio();
    if (wasExpoRecording) void recorder.stop().catch(() => undefined);
    if (hasNativeIOSContext) {
      void HermesIOSContext.stopVoiceRecognition().catch(() => undefined);
      void HermesIOSContext.stopSpeaking().catch(() => undefined);
    }
    void Speech.stop().catch(() => undefined);
    setSpeakingMessageId('');
    setVoiceState('idle');
    conversationRef.current = false;
    setVoiceConversation(false);
    awaitingResponseRef.current = false;
    setVoiceRuntime(LOADING_VOICE_RUNTIME);
    setVoiceChoices([]);
    setVoiceChoiceBusy(false);
    if (!cloudApi) {
      setVoiceRuntime({ ...LOADING_VOICE_RUNTIME, loaded: true });
      return () => abort.abort();
    }
    void cloudApi.getVoiceConfig(profile, abort.signal)
      .then(async (config) => {
        if (generation !== voiceConfigGenerationRef.current) return;
        const runtime = resolveVoiceRuntime(config);
        setVoiceRuntime(runtime);
        if (!shouldLoadElevenLabsVoices(runtime)) return;
        const result = await cloudApi.listElevenLabsVoices(profile, abort.signal);
        if (generation !== voiceConfigGenerationRef.current || !result.available) return;
        setVoiceChoices(result.voices);
      })
      .catch((error) => {
        if (generation === voiceConfigGenerationRef.current && !isAbortError(error)) {
          setVoiceRuntime({ ...LOADING_VOICE_RUNTIME, loaded: true });
        }
      });
    return () => abort.abort();
  }, [cloudApi, profile, recorder, stopEncodedAudio]);

  useEffect(() => {
    if (!hasNativeIOSContext) return undefined;
    let cancelled = false;
    void HermesIOSContext.getVoiceNarrationEnabled()
      .then((enabled) => { if (!cancelled) setReadRepliesAloud(enabled); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!readRepliesAloud || !voiceRuntime.loaded || voiceRuntime.ttsMode === 'unavailable'
      || voiceState === 'listening' || voiceState === 'transcribing') return;
    const latest = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && Boolean(message.content.trim()));
    if (!latest) return;

    if (voiceRuntime.ttsMode === 'native' && !hasNativeIOSContext) {
      if (latest.status !== 'completed' || autoSpokenMessageIdRef.current === latest.id) return;
      autoSpokenMessageIdRef.current = latest.id;
      void speakText(latest.content, latest.id).catch((error) => notify(describeError(error)));
      return;
    }

    const serverCursor = serverSpeechCursorRef.current;
    const nativeCursor = nativeSpeechCursorRef.current;
    if (autoSpokenMessageIdRef.current === latest.id
      && serverCursor.messageId !== latest.id && nativeCursor.messageId !== latest.id) return;

    const generation = streamingSpeechGenerationRef.current;
    streamingSpeechQueueRef.current = streamingSpeechQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (generation !== streamingSpeechGenerationRef.current) return;
        const status = (latest.status || '').toLowerCase();
        const failed = status === 'failed' || status === 'cancelled' || status === 'canceled';
        const pending = status === 'queued' || status === 'running' || status === 'streaming';

        if (voiceRuntime.ttsMode === 'server') {
          let cursor = serverSpeechCursorRef.current;
          if (failed) {
            if (cursor.messageId === latest.id) await cursor.session?.stop(true);
            serverSpeechCursorRef.current = { ...EMPTY_STREAMING_CURSOR, session: null };
            setSpeakingMessageId('');
            return;
          }
          if (cursor.messageId !== latest.id || latest.content.length < cursor.sourceLength) {
            await cursor.session?.stop(false);
            if (generation !== streamingSpeechGenerationRef.current) return;
            const session = beginServerSpeech(latest.id);
            cursor = { finishing: false, messageId: latest.id, session, sourceLength: 0 };
            serverSpeechCursorRef.current = cursor;
          }
          const delta = latest.content.slice(cursor.sourceLength);
          if (delta) {
            cursor.session?.append(delta);
            cursor.sourceLength = latest.content.length;
          }
          if (!pending && !cursor.finishing) {
            cursor.finishing = true;
            cursor.session?.finish();
            autoSpokenMessageIdRef.current = latest.id;
          }
          return;
        }

        let cursor = nativeSpeechCursorRef.current;
        if (failed) {
          if (cursor.messageId === latest.id) await HermesIOSContext.interruptSpeaking();
          nativeSpeechCursorRef.current = { ...EMPTY_STREAMING_CURSOR };
          setSpeakingMessageId('');
          return;
        }
        if (cursor.messageId !== latest.id || latest.content.length < cursor.sourceLength) {
          await HermesIOSContext.stopSpeaking();
          if (generation !== streamingSpeechGenerationRef.current) return;
          const started = await HermesIOSContext.startStreamingSpeech(isChinese ? 'zh-CN' : 'en-US', 0.5);
          if (!started || generation !== streamingSpeechGenerationRef.current) return;
          cursor = { finishing: false, messageId: latest.id, sourceLength: 0 };
          nativeSpeechCursorRef.current = cursor;
          setSpeakingMessageId(latest.id);
        }
        const delta = latest.content.slice(cursor.sourceLength);
        if (delta) {
          await HermesIOSContext.appendStreamingSpeech(delta);
          cursor.sourceLength = latest.content.length;
        }
        if (!pending && !cursor.finishing) {
          cursor.finishing = true;
          await HermesIOSContext.finishStreamingSpeech();
          autoSpokenMessageIdRef.current = latest.id;
        }
      })
      .catch((error) => {
        if (generation !== streamingSpeechGenerationRef.current) return;
        setSpeakingMessageId('');
        notify(describeError(error));
      });
  }, [
    beginServerSpeech, describeError, isChinese, messages, notify, readRepliesAloud,
    speakText, voiceRuntime.loaded, voiceRuntime.ttsMode, voiceState,
  ]);

  useEffect(() => {
    if (!voiceConversation || voiceState !== 'listening' || nativeRecognitionRef.current) return;
    if (recorderState.level >= 0.075) {
      speechHeardRef.current = true;
      lastSpeechAtRef.current = Date.now();
    }
    if ((speechHeardRef.current && Date.now() - lastSpeechAtRef.current >= 1_250)
      || (!speechHeardRef.current && recorderState.durationMillis >= 12_000)
      || recorderState.durationMillis >= 60_000) void stopVoiceInput(false);
  }, [recorderState.durationMillis, recorderState.level, stopVoiceInput, voiceConversation, voiceState]);

  useEffect(() => {
    if (!voiceConversation || voiceState !== 'idle' || agentTurnActive || speakingMessageId || awaitingResponseRef.current) return;
    const timer = setTimeout(() => { if (conversationRef.current) void startVoiceInput(); }, 350);
    return () => clearTimeout(timer);
  }, [agentTurnActive, speakingMessageId, startVoiceInput, voiceConversation, voiceState]);

  useEffect(() => {
    if (voiceState !== 'listening') {
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
        nativeRecognitionRef.current = false;
        setVoiceError('');
        applyFinalTranscript(event.text);
        focusComposer();
      }
    });
    const state = HermesIOSContext.subscribeVoiceState((event) => {
      setVoiceState(event.state);
      if (event.state === 'idle' && activeServerSpeechRef.current) {
        activeServerSpeechRef.current = null;
        awaitingResponseRef.current = false;
      }
      if (event.state !== 'speaking') {
        setSpeakingMessageId('');
      }
      if (event.state === 'listening' && nativeVoiceStartedAtRef.current <= 0) {
        nativeVoiceStartedAtRef.current = Date.now();
      }
      if (event.error) {
        acceptNativeTranscriptRef.current = false;
        nativeRecognitionRef.current = false;
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
  }, [applyFinalTranscript, applyTranscript, focusComposer, notify, restoreVoiceDraft]);

  useEffect(() => () => {
    ++voiceOperationRef.current;
    ++voiceConfigGenerationRef.current;
    transcriptionAbortRef.current?.abort();
    acceptNativeTranscriptRef.current = false;
    nativeRecognitionRef.current = false;
    void activeServerSpeechRef.current?.session.stop(false);
    activeServerSpeechRef.current = null;
    stopEncodedAudio();
    fallbackPlayerRef.current?.remove();
    fallbackPlayerRef.current = null;
    if (expoRecordingRef.current) void recorder.stop().catch(() => undefined);
    void Speech.stop().catch(() => undefined);
  }, [recorder, stopEncodedAudio]);

  return {
    cancelVoiceInput,
    readRepliesAloud,
    selectVoice,
    selectedVoiceId: voiceRuntime.selectedVoiceId,
    speakingMessageId,
    startVoiceInput,
    stopVoiceInput,
    toggleMessageSpeech,
    toggleReadRepliesAloud,
    voiceAvailable: voiceRuntime.loaded
      && (voiceRuntime.sttMode !== 'unavailable' || voiceRuntime.ttsMode !== 'unavailable'),
    voiceChoiceBusy,
    voiceChoices,
    voiceDurationMs: nativeRecognitionRef.current
      ? nativeVoiceDurationMs
      : voiceState === 'listening' ? recorderState.durationMillis : 0,
    voiceError,
    voiceConversation,
    voiceLevel: recorderState.level,
    voicePreview,
    voiceState,
  };
}
