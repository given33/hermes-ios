import type { HermesCloudTransport, JsonRecord } from './transport';

export interface AudioTranscriptionResult {
  provider: string;
  transcript: string;
}

export interface ClientVoiceProvider {
  mode: 'client' | 'relay' | string;
  provider?: string;
  model?: string;
  api_key?: string;
  base_url?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface ClientVoiceConfig {
  ok: boolean;
  stt: ClientVoiceProvider;
  tts: ClientVoiceProvider;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  label: string;
}

/** Authenticated speech-to-text through the same Hermes origin as chat. */
export class HermesAudioCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  async transcribe(
    dataUrl: string,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<AudioTranscriptionResult> {
    const value = await this.transport.json<JsonRecord>(
      '/api/audio/transcribe',
      'POST',
      { data_url: dataUrl, mime_type: mimeType },
      { deadlineMs: 120_000, signal },
    );
    const transcript = typeof value.transcript === 'string'
      ? value.transcript.trim()
      : '';
    if (!transcript) throw new Error('Hermes returned an empty voice transcript');
    return {
      provider: typeof value.provider === 'string' ? value.provider : '',
      transcript,
    };
  }

  getVoiceConfig(profile = 'default', signal?: AbortSignal) {
    return this.transport.request<ClientVoiceConfig>('/api/audio/voice-config', {
      query: { profile },
      signal,
    });
  }

  listElevenLabsVoices(profile = 'default', signal?: AbortSignal) {
    return this.transport.request<{
      available: boolean;
      voices: ElevenLabsVoice[];
      error?: string;
    }>('/api/audio/elevenlabs/voices', {
      query: { profile },
      signal,
    });
  }

  speak(text: string, profile = 'default', signal?: AbortSignal) {
    return this.transport.json<{
      ok: boolean;
      data_url: string;
      mime_type: string;
      provider?: string;
    }>(
      '/api/audio/speak',
      'POST',
      { text },
      { query: { profile }, deadlineMs: 120_000, signal },
    );
  }

  /** Open the upstream sentence-chunked PCM TTS stream used during replies. */
  openSpeechStream(profile = 'default', signal?: AbortSignal) {
    return this.transport.openWebSocket('/api/audio/speak-stream', {
      profile,
      signal,
      connectTimeoutMs: 10_000,
    });
  }
}
