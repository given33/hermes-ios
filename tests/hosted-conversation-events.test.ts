import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesCloudApi } from '../src/api/HermesCloudApi';
import {
  consumeHostedConversationEvents,
} from '../src/api/hosted-conversation-events';

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
        'sation\ndata: {"cursor":8,"account_generation":"generation-1","conversation":{"id":"chat-1",',
        '"account_generation":"generation-1","profile":"default","title":"Hello","messages":[]}}\n\n',
        'id: 9\nevent: conversation\ndata: {"cursor":9,"account_generation":"generation-1","conversation":',
        '{"id":"chat-1","account_generation":"generation-1","profile":"default","title":"Hello","messages":[]}}\n\n',
      ]));
    },
  } as unknown as HermesCloudApi;
  const events: number[] = [];

  const cursor = await consumeHostedConversationEvents(
    api,
    'chat-1',
    7,
    'generation-1',
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
        'id: 2\nevent: conversation\ndata: {"cursor":2,"account_generation":"generation-1","conversation":{}}\n\n',
      ]));
    },
  } as unknown as HermesCloudApi;

  await assert.rejects(
    consumeHostedConversationEvents(
      api,
      'chat-1',
      1,
      'generation-1',
      new AbortController().signal,
      () => undefined,
    ),
    /invalid conversation/,
  );
});

test('canonical hosted events advance without repeating the full conversation snapshot', async () => {
  const canonicalEvent = {
    event_id: 'evt-1',
    cursor: 12,
    account_generation: 'generation-1',
    conversation_id: 'chat-1',
    turn_id: 'turn-1',
    role_stage: 'worker',
    event_type: 'message.delta',
    sequence: 3,
    occurred_at: 1_700_000_000_000,
    idempotency_key: 'delta-3',
    payload: { delta: 'hello' },
    schema_version: 'hermes.hosted-event.v1',
  };
  const api = {
    openHostedConversationEvents() {
      return Promise.resolve(streamResponse([
        `id: 12\nevent: conversation\ndata: ${JSON.stringify({
          cursor: 12,
          min_cursor: 1,
          has_gap: false,
          account_generation: 'generation-1',
          events: [canonicalEvent],
        })}\n\n`,
      ]));
    },
  } as unknown as HermesCloudApi;
  const frames: Array<{ cursor: number; eventType: string; generation: string }> = [];

  const cursor = await consumeHostedConversationEvents(
    api,
    'chat-1',
    11,
    'generation-1',
    new AbortController().signal,
    (frame) => {
      frames.push({
        cursor: frame.cursor,
        eventType: frame.events[0]?.event_type || '',
        generation: frame.accountGeneration,
      });
      assert.equal(frame.conversation, undefined);
    },
  );

  assert.equal(cursor, 12);
  assert.deepEqual(frames, [{
    cursor: 12,
    eventType: 'message.delta',
    generation: 'generation-1',
  }]);
});

test('cursor retention gaps require a recovery snapshot', async () => {
  const api = {
    openHostedConversationEvents() {
      return Promise.resolve(streamResponse([
        'id: 20\nevent: conversation\ndata: '
          + '{"cursor":20,"min_cursor":15,"has_gap":true,"account_generation":"generation-1","events":[]}\n\n',
      ]));
    },
  } as unknown as HermesCloudApi;

  await assert.rejects(
    consumeHostedConversationEvents(
      api,
      'chat-1',
      4,
      'generation-1',
      new AbortController().signal,
      () => undefined,
    ),
    /gap is missing its recovery snapshot/,
  );
});

test('an explicit future-cursor reset accepts the authoritative lower cursor', async () => {
  const api = {
    openHostedConversationEvents() {
      return Promise.resolve(streamResponse([
        'id: 10\nevent: conversation\ndata: '
          + '{"cursor":10,"min_cursor":1,"has_gap":true,"reset_cursor":true,'
          + '"reset_reason":"future_cursor","account_generation":"generation-1","events":[],"conversation":'
          + '{"id":"chat-1","account_generation":"generation-1","profile":"default","title":"Hello","messages":[]}}\n\n',
      ]));
    },
  } as unknown as HermesCloudApi;
  const frames: Array<{ cursor: number; reset: boolean }> = [];

  const cursor = await consumeHostedConversationEvents(
    api,
    'chat-1',
    999,
    'generation-1',
    new AbortController().signal,
    (frame) => { frames.push({ cursor: frame.cursor, reset: frame.resetCursor }); },
  );

  assert.equal(cursor, 10);
  assert.deepEqual(frames, [{ cursor: 10, reset: true }]);
});

test('hosted event envelopes reject empty generation and cross-conversation events', async () => {
  const emptyGenerationApi = {
    openHostedConversationEvents() {
      return Promise.resolve(streamResponse([
        'event: conversation\ndata: {"cursor":1,"conversation":{"id":"chat-1",'
          + '"account_generation":"generation-1","profile":"default","title":"x","messages":[]}}\n\n',
      ]));
    },
  } as unknown as HermesCloudApi;
  await assert.rejects(
    consumeHostedConversationEvents(
      emptyGenerationApi,
      'chat-1',
      0,
      'generation-1',
      new AbortController().signal,
      () => undefined,
    ),
    /account generation changed/,
  );

  const crossedEventApi = {
    openHostedConversationEvents() {
      return Promise.resolve(streamResponse([
        `event: conversation\ndata: ${JSON.stringify({
          cursor: 2,
          account_generation: 'generation-1',
          events: [{
            event_id: 'evt-crossed',
            cursor: 2,
            account_generation: 'generation-1',
            conversation_id: 'chat-other',
            turn_id: 'turn-1',
            role_stage: 'worker',
            event_type: 'message.delta',
            sequence: 1,
            occurred_at: 1,
            idempotency_key: 'crossed',
            payload: {},
            schema_version: 'hermes.hosted-event.v1',
          }],
        })}\n\n`,
      ]));
    },
  } as unknown as HermesCloudApi;
  await assert.rejects(
    consumeHostedConversationEvents(
      crossedEventApi,
      'chat-1',
      1,
      'generation-1',
      new AbortController().signal,
      () => undefined,
    ),
    /crossed its identity boundary/,
  );
});

test('hosted event cursor is not accepted when durable frame application fails', async () => {
  const api = {
    openHostedConversationEvents() {
      return Promise.resolve(streamResponse([
        'id: 3\nevent: conversation\ndata: {"cursor":3,"account_generation":"generation-1",'
          + '"conversation":{"id":"chat-1","account_generation":"generation-1",'
          + '"profile":"default","title":"x","messages":[]}}\n\n',
      ]));
    },
  } as unknown as HermesCloudApi;

  await assert.rejects(
    consumeHostedConversationEvents(
      api,
      'chat-1',
      2,
      'generation-1',
      new AbortController().signal,
      async () => { throw new Error('disk full'); },
    ),
    /disk full/,
  );
});
