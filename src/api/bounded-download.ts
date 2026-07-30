import { MAX_CONVERSATION_ATTACHMENT_BYTES } from './attachment-size-policy';

export interface WritableDownloadFile {
  create(options?: { intermediates?: boolean; overwrite?: boolean }): void;
  delete(): void;
  readonly exists: boolean;
  writableStream(): WritableStream<Uint8Array<ArrayBufferLike>>;
}

export interface BoundedDownloadResult {
  bytes: number;
  sha256: string;
}

export async function writeBoundedDownload(
  response: Response,
  target: WritableDownloadFile,
  options: {
    expectedBytes?: number;
    expectedSha256?: string;
    isCurrent?: () => boolean;
    maximumBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<BoundedDownloadResult> {
  const maximumBytes = options.maximumBytes ?? MAX_CONVERSATION_ATTACHMENT_BYTES;
  const contentLength = parseContentLength(response.headers.get('Content-Length'));
  const expectedBytes = normalizedExpectedBytes(options.expectedBytes);
  if (contentLength !== null && contentLength > maximumBytes) throw attachmentTooLarge();
  if (expectedBytes !== null && expectedBytes > maximumBytes) throw attachmentTooLarge();
  if (contentLength !== null && expectedBytes !== null && contentLength !== expectedBytes) {
    throw new Error('Attachment size does not match its server metadata');
  }
  if (!response.body) throw new Error('Hermes returned an attachment without a response stream');
  assertDownloadCurrent(options);

  const expectedHash = normalizedSha256(options.expectedSha256)
    || normalizedSha256(response.headers.get('X-Content-SHA256'))
    || normalizedEntityTag(response.headers.get('ETag'));
  const hash = new IncrementalSha256();
  const reader = response.body.getReader();
  let writer: WritableStreamDefaultWriter<Uint8Array<ArrayBufferLike>> | undefined;
  let bytes = 0;
  try {
    target.create({ intermediates: true, overwrite: false });
    writer = target.writableStream().getWriter();
    while (true) {
      assertDownloadCurrent(options);
      const part = await reader.read();
      if (part.done) break;
      const chunk = part.value;
      if (!chunk.byteLength) continue;
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) throw attachmentTooLarge();
      hash.update(chunk);
      await writer.write(chunk);
    }
    assertDownloadCurrent(options);
    if (contentLength !== null && bytes !== contentLength) {
      throw new Error('Attachment response ended before Content-Length bytes were received');
    }
    if (expectedBytes !== null && bytes !== expectedBytes) {
      throw new Error('Attachment size does not match its server metadata');
    }
    const sha256 = hash.digestHex();
    if (expectedHash && sha256 !== expectedHash) {
      throw new Error('Attachment SHA-256 verification failed');
    }
    await writer.close();
    writer = undefined;
    return { bytes, sha256 };
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    await writer?.abort(error).catch(() => undefined);
    if (target.exists) target.delete();
    throw error;
  } finally {
    reader.releaseLock();
    writer?.releaseLock();
  }
}

function assertDownloadCurrent(options: {
  isCurrent?: () => boolean;
  signal?: AbortSignal;
}): void {
  if (options.signal?.aborted || options.isCurrent?.() === false) {
    throw new DOMException('Attachment download was cancelled', 'AbortError');
  }
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error('Hermes returned an invalid Content-Length');
  const bytes = Number(normalized);
  if (!Number.isSafeInteger(bytes)) throw new Error('Hermes returned an invalid Content-Length');
  return bytes;
}

function normalizedExpectedBytes(value: number | undefined): number | null {
  if (value === undefined) return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizedEntityTag(value: string | null): string {
  return normalizedSha256(value?.replace(/^W\//, '').replace(/^"|"$/g, ''));
}

function normalizedSha256(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function attachmentTooLarge(): Error {
  return new Error('File must be 64 MB or smaller');
}

class IncrementalSha256 {
  private readonly buffer = new Uint8Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;
  private finished = false;
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly words = new Uint32Array(64);

  update(input: Uint8Array): void {
    if (this.finished) throw new Error('SHA-256 digest is already finalized');
    this.bytesHashed += input.byteLength;
    let offset = 0;
    while (offset < input.byteLength) {
      const copied = Math.min(64 - this.bufferLength, input.byteLength - offset);
      this.buffer.set(input.subarray(offset, offset + copied), this.bufferLength);
      this.bufferLength += copied;
      offset += copied;
      if (this.bufferLength === 64) {
        this.compress(this.buffer);
        this.bufferLength = 0;
      }
    }
  }

  digestHex(): string {
    if (!this.finished) this.finish();
    return [...this.state].map((word) => word.toString(16).padStart(8, '0')).join('');
  }

  private finish(): void {
    const high = Math.floor(this.bytesHashed / 0x2000_0000);
    const low = (this.bytesHashed << 3) >>> 0;
    this.buffer[this.bufferLength] = 0x80;
    this.bufferLength += 1;
    if (this.bufferLength > 56) {
      this.buffer.fill(0, this.bufferLength);
      this.compress(this.buffer);
      this.bufferLength = 0;
    }
    this.buffer.fill(0, this.bufferLength, 56);
    const view = new DataView(this.buffer.buffer);
    view.setUint32(56, high, false);
    view.setUint32(60, low, false);
    this.compress(this.buffer);
    this.bufferLength = 0;
    this.finished = true;
  }

  private compress(block: Uint8Array): void {
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    for (let index = 0; index < 16; index += 1) {
      this.words[index] = view.getUint32(index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = this.words[index - 15];
      const y = this.words[index - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      this.words[index] = (
        this.words[index - 16] + sigma0 + this.words[index - 7] + sigma1
      ) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + SHA256_CONSTANTS[index] + this.words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
