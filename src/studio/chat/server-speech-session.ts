import type { HermesCloudApi } from '../../api/HermesCloudApi';

export interface PCMPlaybackSink {
  append(base64PCM: string): Promise<boolean>;
  finish(): Promise<boolean>;
  start(sampleRate: number, channels: number): Promise<boolean>;
  stop(interrupted: boolean): Promise<boolean>;
}

interface SpeechSocket {
  binaryType: BinaryType;
  close(code?: number, reason?: string): void;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  readyState: number;
  send(data: string): void;
}

export interface ServerSpeechSessionOptions {
  api: Pick<HermesCloudApi, 'openSpeechStream' | 'speakAudio'>;
  onError(error: unknown): void;
  onFinished(): void;
  onStarted(): void;
  pcmSink: PCMPlaybackSink | null;
  playEncodedAudio(dataUrl: string): Promise<void>;
  profile: string;
  stopEncodedAudio(): void;
}

interface SpeechControlFrame {
  channels?: unknown;
  sample_rate?: unknown;
  type?: unknown;
}

function pcmFrameToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  }
  return globalThis.btoa(binary);
}

async function binaryFrame(value: unknown): Promise<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.arrayBuffer();
  throw new Error('Hermes returned an invalid speech audio frame');
}

function parseControlFrame(value: string): SpeechControlFrame {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Hermes returned an invalid speech control frame');
  }
  return parsed as SpeechControlFrame;
}

/** One authenticated text-to-PCM session for one assistant reply. */
export class ServerSpeechSession {
  private readonly connectionAbort = new AbortController();
  private readonly fallbackAbort = new AbortController();
  private readonly pendingFrames: string[] = [];
  private playbackQueue: Promise<void> = Promise.resolve();
  private socket: SpeechSocket | null = null;
  private text = '';
  private doneRequested = false;
  private fallbackRequired = false;
  private fallbackStarted = false;
  private opening = false;
  private pcmReceived = false;
  private endReceived = false;
  private stopped = false;

  constructor(private readonly options: ServerSpeechSessionOptions) {}

  append(delta: string): void {
    if (this.stopped || this.doneRequested || !delta) return;
    this.text += delta;
    if (this.fallbackRequired || !this.options.pcmSink) return;
    this.pendingFrames.push(JSON.stringify({ text: delta }));
    this.ensureSocket();
  }

  finish(): void {
    if (this.stopped || this.doneRequested) return;
    this.doneRequested = true;
    if (this.fallbackRequired || !this.options.pcmSink) {
      this.fallbackRequired = true;
      this.startFallbackIfReady();
      return;
    }
    this.pendingFrames.push(JSON.stringify({ done: true }));
    this.ensureSocket();
  }

  async stop(interrupted = false): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.connectionAbort.abort();
    this.fallbackAbort.abort();
    const socket = this.socket;
    this.socket = null;
    if (socket?.readyState === 1) {
      try { socket.send(JSON.stringify({ stop: true })); } catch { /* best effort */ }
    }
    try { socket?.close(1000, 'speech stopped'); } catch { /* best effort */ }
    this.options.stopEncodedAudio();
    await this.options.pcmSink?.stop(interrupted).catch(() => false);
  }

  private ensureSocket(): void {
    if (this.socket || this.opening || this.stopped || this.fallbackStarted) return;
    this.opening = true;
    void this.options.api.openSpeechStream(this.options.profile, this.connectionAbort.signal)
      .then((socket) => {
        this.opening = false;
        if (this.stopped) {
          socket.close();
          return;
        }
        this.socket = socket;
        socket.binaryType = 'arraybuffer';
        socket.onmessage = (event) => this.handleMessage(event.data);
        socket.onerror = () => this.handleSocketFailure(
          new Error('Hermes speech stream failed'),
        );
        socket.onclose = () => {
          if (!this.stopped && !this.endReceived) {
            this.handleSocketFailure(new Error('Hermes speech stream closed early'));
          }
        };
        for (const frame of this.pendingFrames.splice(0)) socket.send(frame);
      })
      .catch((error) => {
        this.opening = false;
        this.handleSocketFailure(error);
      });
  }

  private handleMessage(value: unknown): void {
    if (this.stopped || this.fallbackRequired || this.endReceived) return;
    if (typeof value === 'string') {
      let frame: SpeechControlFrame;
      try {
        frame = parseControlFrame(value);
      } catch (error) {
        this.handleSocketFailure(error);
        return;
      }
      if (frame.type === 'fallback') {
        this.requireFallback();
        return;
      }
      if (frame.type === 'start') {
        const sampleRate = Number(frame.sample_rate);
        const channels = Number(frame.channels);
        if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 96_000
          || !Number.isInteger(channels) || channels < 1 || channels > 2) {
          this.handleSocketFailure(new Error('Hermes returned an unsupported PCM format'));
          return;
        }
        this.enqueuePlayback(async () => {
          const started = await this.options.pcmSink?.start(sampleRate, channels);
          if (!started) throw new Error('Hermes PCM playback could not start');
          this.options.onStarted();
        });
        return;
      }
      if (frame.type === 'end') {
        this.endReceived = true;
        this.enqueuePlayback(async () => {
          await this.options.pcmSink?.finish();
          if (!this.pcmReceived) this.options.onFinished();
        });
      }
      return;
    }

    this.enqueuePlayback(async () => {
      const bytes = await binaryFrame(value);
      if (!bytes.byteLength) return;
      const appended = await this.options.pcmSink?.append(pcmFrameToBase64(bytes));
      if (!appended) throw new Error('Hermes PCM playback rejected an audio frame');
      this.pcmReceived = true;
    });
  }

  private enqueuePlayback(operation: () => Promise<void>): void {
    this.playbackQueue = this.playbackQueue
      .then(() => this.stopped ? undefined : operation())
      .catch((error) => this.handleSocketFailure(error));
  }

  private handleSocketFailure(_error: unknown): void {
    if (this.stopped || this.fallbackRequired) return;
    if (this.pcmReceived) {
      this.endReceived = true;
      const socket = this.socket;
      this.socket = null;
      if (socket?.readyState === 1) {
        try { socket.send(JSON.stringify({ stop: true })); } catch { /* best effort */ }
      }
      try { socket?.close(); } catch { /* best effort */ }
      void this.options.pcmSink?.finish().catch(() => false);
      return;
    }
    this.requireFallback();
  }

  private requireFallback(): void {
    if (this.stopped) return;
    this.fallbackRequired = true;
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(); } catch { /* best effort */ }
    void this.options.pcmSink?.stop(false).catch(() => false);
    this.startFallbackIfReady();
  }

  private startFallbackIfReady(): void {
    if (!this.doneRequested || this.fallbackStarted) return;
    this.fallbackStarted = true;
    const text = this.text.trim();
    if (!text) {
      this.options.onFinished();
      return;
    }
    void this.options.api.speakAudio(text, this.options.profile, this.fallbackAbort.signal)
      .then(async (result) => {
        if (this.stopped) return;
        if (!result.ok || typeof result.data_url !== 'string' || !result.data_url.startsWith('data:audio/')) {
          throw new Error('Hermes returned invalid fallback speech audio');
        }
        this.options.onStarted();
        await this.options.playEncodedAudio(result.data_url);
        if (!this.stopped) this.options.onFinished();
      })
      .catch((error) => {
        if (!this.stopped) this.options.onError(error);
      });
  }
}
