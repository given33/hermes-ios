import type { HermesCloudTransport, JsonRecord } from './transport';

export interface AudioTranscriptionResult {
  provider: string;
  transcript: string;
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
}
