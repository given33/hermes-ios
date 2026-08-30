import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ServerSpeechSession,
  type PCMPlaybackSink,
} from '../src/studio/chat/server-speech-session';

class FakeSocket {
  binaryType: BinaryType = 'blob';
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readyState = 1;
  sent: string[] = [];

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }

  send(value: string): void {
    this.sent.push(value);
  }

  message(value: unknown): void {
    this.onmessage?.({ data: value } as MessageEvent);
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function harness(options: { pcm?: boolean } = {}) {
  const socket = new FakeSocket();
  const pcmCalls: Array<unknown[]> = [];
  const fallbackCalls: Array<unknown[]> = [];
  const lifecycle: string[] = [];
  const pcmSink: PCMPlaybackSink | null = options.pcm === false ? null : {
    append: async (chunk) => { pcmCalls.push(['append', chunk]); return true; },
    finish: async () => { pcmCalls.push(['finish']); return true; },
    start: async (rate, channels) => { pcmCalls.push(['start', rate, channels]); return true; },
    stop: async (interrupted) => { pcmCalls.push(['stop', interrupted]); return true; },
  };
  const session = new ServerSpeechSession({
    api: {
      openSpeechStream: async () => socket as unknown as WebSocket,
      speakAudio: async (text, profile) => {
        fallbackCalls.push([text, profile]);
        return {
          data_url: 'data:audio/mpeg;base64,AA==',
          mime_type: 'audio/mpeg',
          ok: true,
        };
      },
    },
    onError: (error) => lifecycle.push(`error:${String(error)}`),
    onFinished: () => lifecycle.push('finished'),
    onStarted: () => lifecycle.push('started'),
    pcmSink,
    playEncodedAudio: async (dataUrl) => { fallbackCalls.push(['play', dataUrl]); },
    profile: 'reviewer',
    stopEncodedAudio: () => { fallbackCalls.push(['stop-encoded']); },
  });
  return { fallbackCalls, lifecycle, pcmCalls, session, socket };
}

test('server speech streams authenticated text into ordered PCM playback', async () => {
  const { fallbackCalls, lifecycle, pcmCalls, session, socket } = harness();
  session.append('Hello ');
  session.append('world.');
  session.finish();
  await flush();

  assert.deepEqual(socket.sent.map((frame) => JSON.parse(frame)), [
    { text: 'Hello ' },
    { text: 'world.' },
    { done: true },
  ]);
  socket.message(JSON.stringify({ type: 'start', sample_rate: 24_000, channels: 1 }));
  socket.message(Uint8Array.from([1, 2, 3, 4]).buffer);
  socket.message(JSON.stringify({ type: 'end' }));
  await flush();
  await flush();

  assert.deepEqual(pcmCalls, [
    ['start', 24_000, 1],
    ['append', 'AQIDBA=='],
    ['finish'],
  ]);
  assert.deepEqual(lifecycle, ['started']);
  assert.deepEqual(fallbackCalls, []);
});

test('a WebSocket failure before PCM falls back once with the complete reply', async () => {
  const { fallbackCalls, lifecycle, session, socket } = harness();
  session.append('First half. ');
  await flush();
  socket.onerror?.({} as Event);
  session.append('Second half.');
  session.finish();
  await flush();
  await flush();

  assert.deepEqual(fallbackCalls.filter(([kind]) => kind !== 'stop-encoded'), [
    ['First half. Second half.', 'reviewer'],
    ['play', 'data:audio/mpeg;base64,AA=='],
  ]);
  assert.deepEqual(lifecycle, ['started', 'finished']);
});

test('a stream failure after PCM never replays already-heard text through POST', async () => {
  const { fallbackCalls, pcmCalls, session, socket } = harness();
  session.append('Do not replay this.');
  session.finish();
  await flush();
  socket.message(JSON.stringify({ type: 'start', sample_rate: 16_000, channels: 1 }));
  socket.message(Uint8Array.from([0, 0]).buffer);
  await flush();
  socket.onerror?.({} as Event);
  await flush();

  assert.equal(fallbackCalls.some((call) => call[0] === 'Do not replay this.'), false);
  assert.equal(pcmCalls.some((call) => call[0] === 'finish'), true);
});

test('barge-in stops the socket, PCM sink, and encoded fallback player', async () => {
  const { fallbackCalls, pcmCalls, session, socket } = harness();
  session.append('Long reply');
  await flush();
  await session.stop(true);

  assert.deepEqual(JSON.parse(socket.sent.at(-1) || '{}'), { stop: true });
  assert.deepEqual(pcmCalls.at(-1), ['stop', true]);
  assert.deepEqual(fallbackCalls, [['stop-encoded']]);
});

test('builds without a PCM sink use POST fallback and never open a stream', async () => {
  const { fallbackCalls, lifecycle, session, socket } = harness({ pcm: false });
  session.append('Fallback only');
  session.finish();
  await flush();
  await flush();

  assert.deepEqual(socket.sent, []);
  assert.equal(fallbackCalls.some((call) => call[0] === 'Fallback only'), true);
  assert.deepEqual(lifecycle, ['started', 'finished']);
});
