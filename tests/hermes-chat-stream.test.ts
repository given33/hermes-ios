import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesApiClient } from '../src/api/HermesApiClient';
import {
  HermesChatStream,
  type HermesChatStreamRuntime,
} from '../src/api/HermesChatStream';

interface SentRpc {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(
    readonly generation: number,
    private readonly sent: SentRpc[],
  ) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(value: string) {
    const frame = JSON.parse(value) as SentRpc;
    this.sent.push(frame);
    if (frame.method === 'session.create') {
      this.reply(frame.id, { session_id: 'live-1', stored_session_id: 'stored-1' });
      return;
    }
    if (frame.method === 'prompt.submit') {
      queueMicrotask(() => this.disconnect());
      return;
    }
    if (frame.method === 'session.resume') {
      this.reply(frame.id, {
        session_id: 'live-2',
        resumed: 'stored-1',
        running: true,
      });
      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({
            method: 'event',
            params: {
              type: 'message.complete',
              session_id: 'live-2',
              payload: { status: 'completed', text: '恢复后的完整结果' },
            },
          }),
        });
      }, 10);
    }
  }

  close() {
    this.disconnect(1000, 'closed');
  }

  private reply(id: string, result: Record<string, unknown>) {
    queueMicrotask(() => {
      this.onmessage?.({ data: JSON.stringify({ id, result }) });
    });
  }

  private disconnect(code = 1006, reason = 'network dropped') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

test('stream reconnect resumes the server turn without submitting the prompt twice', async () => {
  const sockets: FakeSocket[] = [];
  const sent: SentRpc[] = [];
  const events: string[] = [];
  const runtime: HermesChatStreamRuntime = {
    currentAppState: () => 'active',
    createSocket: () => {
      const socket = new FakeSocket(sockets.length + 1, sent);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    now: () => Date.now(),
    random: () => 0,
    subscribeAppState: () => () => undefined,
    subscribeNetwork: () => () => undefined,
  };
  const client = {
    createWebSocketUrl: async () => 'wss://hermes.test/api/ws?ticket=one-time',
  } as unknown as HermesApiClient;
  const stream = new HermesChatStream(
    client,
    (event) => { events.push(event.type); },
    runtime,
  );

  const result = await stream.run({
    conversationId: 'conversation-42',
    profile: 'default',
    prompt: '只执行一次',
    sessionTitle: '恢复测试',
    turnId: 'turn-9',
  });

  assert.equal(sockets.length, 2);
  assert.equal(sent.filter(({ method }) => method === 'prompt.submit').length, 1);
  assert.equal(sent.filter(({ method }) => method === 'session.create').length, 1);
  assert.equal(sent.filter(({ method }) => method === 'session.resume').length, 1);
  assert.equal(sent.find(({ method }) => method === 'session.create')?.params.close_on_disconnect, false);
  assert.equal(sent.find(({ method }) => method === 'session.resume')?.params.close_on_disconnect, false);
  assert.equal(sent.find(({ method }) => method === 'session.resume')?.params.session_id, 'stored-1');
  for (const method of ['session.create', 'session.resume', 'prompt.submit']) {
    const params = sent.find((frame) => frame.method === method)?.params;
    assert.equal(params?.conversation_id, 'conversation-42');
    assert.equal(params?.turn_id, 'turn-9');
  }
  assert.ok(events.includes('connection.reconnecting'));
  assert.ok(events.includes('connection.restored'));
  assert.deepEqual(result, {
    sessionId: 'live-2',
    status: 'completed',
    storedSessionId: 'stored-1',
    text: '恢复后的完整结果',
  });
});
