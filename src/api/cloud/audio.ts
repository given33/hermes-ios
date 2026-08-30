import type { HermesCloudTransport, JsonRecord } from './transport';

export interface AudioTranscriptionResult {
  provider: string;
  transcript: string;
}

export interface ClientVoiceProvider {
  mode: string;
  provider?: string;
  model?: string;
  voice?: string;
  reason?: string;
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

function compactString(value: unknown, maxLength = 256): string | undefined {
  if (typeof value !== 'string') return undefined;
  const compact = value.trim().slice(0, maxLength);
  return compact || undefined;
}

function publicVoiceProvider(value: unknown): ClientVoiceProvider {
  const source = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  return {
    mode: compactString(source.mode, 32) || 'unavailable',
    ...(compactString(source.provider, 64) ? { provider: compactString(source.provider, 64) } : {}),
    ...(compactString(source.model, 160) ? { model: compactString(source.model, 160) } : {}),
    ...(compactString(source.voice ?? source.voice_id, 256)
      ? { voice: compactString(source.voice ?? source.voice_id, 256) }
      : {}),
    ...(compactString(source.reason, 256) ? { reason: compactString(source.reason, 256) } : {}),
  };
}

/** Keep provider credentials and transport details outside the app surface. */
export function sanitizeClientVoiceConfig(value: unknown): ClientVoiceConfig {
  const source = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  return {
    ok: source.ok === true,
    stt: publicVoiceProvider(source.stt),
    tts: publicVoiceProvider(source.tts),
  };
}

function sanitizeElevenLabsVoice(value: unknown): ElevenLabsVoice | null {
  const source = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const voiceId = compactString(source.voice_id, 256);
  if (!voiceId) return null;
  const name = compactString(source.name, 120) || voiceId;
  return {
    voice_id: voiceId,
    name,
    label: compactString(source.label, 160) || name,
  };
}

/** Authenticated speech-to-text through the same Hermes origin as chat. */
export class HermesAudioCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  async transcribe(
    dataUrl: string,
    mimeType: string,
    signal?: AbortSignal,
    profile?: string,
  ): Promise<AudioTranscriptionResult> {
    const value = await this.transport.json<JsonRecord>(
      '/api/audio/transcribe',
      'POST',
      { data_url: dataUrl, mime_type: mimeType },
      {
        // The backend resolves STT through the requested profile's home and
        // provider chain. Keep the profile optional for compatibility with
        // callers that intentionally use the dashboard default, while
        // allowing chat to target an independent worker profile.
        query: profile ? { profile } : undefined,
        deadlineMs: 120_000,
        signal,
      },
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

  async getVoiceConfig(profile = 'default', signal?: AbortSignal) {
    const value = await this.transport.request<unknown>('/api/audio/voice-config', {
      query: { profile },
      signal,
    });
    return sanitizeClientVoiceConfig(value);
  }

  async listElevenLabsVoices(profile = 'default', signal?: AbortSignal) {
    const value = await this.transport.request<{
      available: boolean;
      voices?: unknown[];
      error?: string;
    }>('/api/audio/elevenlabs/voices', {
      query: { profile },
      signal,
    });
    return {
      available: value.available === true,
      voices: Array.isArray(value.voices)
        ? value.voices.map(sanitizeElevenLabsVoice).filter((voice): voice is ElevenLabsVoice => voice !== null)
        : [],
      ...(compactString(value.error, 256) ? { error: compactString(value.error, 256) } : {}),
    };
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
