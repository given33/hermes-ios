import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesCloudApi } from '../src/api/HermesCloudApi';
import { consumeHostedConversationEvents } from '../src/api/hosted-conversation-events';

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

test('hosted conversation SSE survives fragmented frames and advances its cursor', async () => {
  const calls: Array<{ cursor: number; id: string }> = [];
  const api = {
    openHostedConversationEvents(id: string, cursor: number) {
      calls.push({ cursor, id });
      return Promise.resolve(streamResponse([
        ': keepalive\n\n',
        'id: 8\nevent: conver',
        'sation\ndata: {"cursor":8,"conversation":{"id":"chat-1",',
        '"profile":"default","title":"Hello","messages":[]}}\n\n',
        'id: 9\nevent: conversation\ndata: {"cursor":9,"conversation":',
        '{"id":"chat-1","profile":"default","title":"Hello","messages":[]}}\n\n',
      ]));
    },
  } as unknown as HermesCloudApi;
  const events: number[] = [];

  const cursor = await consumeHostedConversationEvents(
    api,
    'chat-1',
    7,
    new AbortController().signal,
    (event) => { events.push(event.cursor); },
  );

  assert.deepEqual(calls, [{ cursor: 7, id: 'chat-1' }]);
  assert.deepEqual(events, [8, 9]);
  assert.equal(cursor, 9);
});

test('hosted conversation SSE rejects malformed payloads instead of erasing chat state', async () => {
  const api = {
    openHostedConversationEvents() {
      return Promise.resolve(streamResponse([
        'id: 2\nevent: conversation\ndata: {"cursor":2,"conversation":{}}\n\n',
      ]));
    },
  } as unknown as HermesCloudApi;

  await assert.rejects(
    consumeHostedConversationEvents(
      api,
      'chat-1',
      1,
      new AbortController().signal,
      () => undefined,
    ),
    /invalid conversation/,
  );
});
