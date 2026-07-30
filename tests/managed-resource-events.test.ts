import assert from 'node:assert/strict';
import test from 'node:test';

import { consumeManagedResourceEvents } from '../src/api/managed-resource-events';

function eventResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

function frame(cursor: number, eventCursor = cursor): string {
  return [
    `id: ${cursor}`,
    'event: managed-resources',
    `data: ${JSON.stringify({
      account_generation: 'generation-1',
      cursor,
      diagnostics: [],
      events: eventCursor > 0 ? [{ cursor: eventCursor, resource: {}, created_at: 'now' }] : [],
      has_more: false,
      resources: [],
    })}`,
    '',
    '',
  ].join('\n');
}

test('managed-resource SSE frames advance the authoritative cursor', async () => {
  const frames: number[] = [];
  const api = {
    async openManagedResourceEvents(cursor: number) {
      assert.equal(cursor, 0);
      return eventResponse([frame(1), frame(2)]);
    },
  };

  const cursor = await consumeManagedResourceEvents(
    api,
    0,
    new AbortController().signal,
    (page) => { frames.push(page.cursor); },
  );

  assert.equal(cursor, 2);
  assert.deepEqual(frames, [1, 2]);
});

test('managed-resource SSE rejects cursor regressions and missing account generations', async () => {
  const regressed = {
    async openManagedResourceEvents() {
      return eventResponse([frame(2, 2)]);
    },
  };
  await assert.rejects(
    consumeManagedResourceEvents(
      regressed,
      3,
      new AbortController().signal,
      () => undefined,
    ),
    /cursor regressed/,
  );

  const missingGeneration = {
    async openManagedResourceEvents() {
      return eventResponse([
        'id: 1\nevent: managed-resources\ndata: {"cursor":1,"resources":[],"events":[],"diagnostics":[]}\n\n',
      ]);
    },
  };
  await assert.rejects(
    consumeManagedResourceEvents(
      missingGeneration,
      0,
      new AbortController().signal,
      () => undefined,
    ),
    /invalid catalog/,
  );
});
