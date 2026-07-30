import assert from 'node:assert/strict';
import test from 'node:test';

import { writeBoundedDownload } from '../src/api/bounded-download';

class MemoryDownloadFile {
  chunks: Uint8Array[] = [];
  exists = false;
  deleted = false;

  create(): void {
    if (this.exists) throw new Error('exists');
    this.exists = true;
  }

  delete(): void {
    this.exists = false;
    this.deleted = true;
    this.chunks = [];
  }

  writableStream(): WritableStream<Uint8Array<ArrayBufferLike>> {
    return new WritableStream({
      write: (chunk) => { this.chunks.push(new Uint8Array(chunk)); },
    });
  }

  text(): string {
    const length = this.chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(result);
  }
}

function response(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers });
}

test('bounded attachment downloads stream to disk and verify SHA-256', async () => {
  const target = new MemoryDownloadFile();
  const result = await writeBoundedDownload(response(['a', 'bc'], {
    'Content-Length': '3',
    ETag: '"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"',
  }), target, { expectedBytes: 3 });

  assert.deepEqual(result, {
    bytes: 3,
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  });
  assert.equal(target.text(), 'abc');
});

test('bounded attachment downloads reject declared and streamed overflow', async () => {
  const declaredTarget = new MemoryDownloadFile();
  await assert.rejects(
    writeBoundedDownload(response([], { 'Content-Length': '4' }), declaredTarget, {
      maximumBytes: 3,
    }),
    /64 MB or smaller/,
  );
  assert.equal(declaredTarget.exists, false);

  const streamedTarget = new MemoryDownloadFile();
  await assert.rejects(
    writeBoundedDownload(response(['ab', 'cd']), streamedTarget, { maximumBytes: 3 }),
    /64 MB or smaller/,
  );
  assert.equal(streamedTarget.deleted, true);
});

test('bounded attachment downloads delete partial files on stale epoch or hash mismatch', async () => {
  let checks = 0;
  const staleTarget = new MemoryDownloadFile();
  await assert.rejects(
    writeBoundedDownload(response(['a', 'b']), staleTarget, {
      isCurrent: () => ++checks < 3,
    }),
    /cancelled/,
  );
  assert.equal(staleTarget.deleted, true);

  const hashTarget = new MemoryDownloadFile();
  await assert.rejects(
    writeBoundedDownload(response(['abc']), hashTarget, { expectedSha256: '0'.repeat(64) }),
    /SHA-256 verification failed/,
  );
  assert.equal(hashTarget.deleted, true);
});
