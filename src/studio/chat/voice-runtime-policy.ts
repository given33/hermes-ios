import type { ClientVoiceConfig, ClientVoiceProvider } from '../../api/cloud/audio';

export type VoiceExecutionMode = 'native' | 'server' | 'unavailable';

export interface VoiceRuntimePolicy {
  loaded: boolean;
  selectedVoiceId: string;
  sttMode: VoiceExecutionMode;
  ttsMode: VoiceExecutionMode;
  ttsProvider: string;
}

export const LOADING_VOICE_RUNTIME: VoiceRuntimePolicy = {
  loaded: false,
  selectedVoiceId: '',
  sttMode: 'unavailable',
  ttsMode: 'unavailable',
  ttsProvider: '',
};

function executionMode(provider: ClientVoiceProvider): VoiceExecutionMode {
  const mode = provider.mode.trim().toLowerCase();
  if (mode === 'client' || mode === 'native') return 'native';
  if (mode === 'direct' || mode === 'relay' || mode === 'server') return 'server';
  return provider.provider?.trim() ? 'server' : 'unavailable';
}

export function resolveVoiceRuntime(config: ClientVoiceConfig): VoiceRuntimePolicy {
  if (!config.ok) {
    return { ...LOADING_VOICE_RUNTIME, loaded: true };
  }
  return {
    loaded: true,
    selectedVoiceId: config.tts.voice?.trim() || '',
    sttMode: executionMode(config.stt),
    ttsMode: executionMode(config.tts),
    ttsProvider: config.tts.provider?.trim().toLowerCase() || '',
  };
}

export function shouldLoadElevenLabsVoices(runtime: VoiceRuntimePolicy): boolean {
  return runtime.loaded
    && runtime.ttsMode === 'server'
    && (runtime.ttsProvider === '' || runtime.ttsProvider === 'elevenlabs');
}
