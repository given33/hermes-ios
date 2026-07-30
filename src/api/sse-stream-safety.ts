export const MAX_SSE_FRAME_CHARACTERS = 8 * 1024 * 1024;

export async function* decodeSseTextStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let completed = false;
  let rejectAbort: (reason: Error) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    const error = sseAbortError();
    rejectAbort(error);
    void reader.cancel(error).catch(() => undefined);
  };

  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) {
        completed = true;
        const tail = decoder.decode();
        if (tail) yield tail;
        break;
      }
      const decoded = decoder.decode(value, { stream: true });
      if (decoded) yield decoded;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function assertSseFrameWithinLimit(length: number, streamName: string): void {
  if (length <= MAX_SSE_FRAME_CHARACTERS) return;
  throw new Error(`${streamName} exceeded the maximum frame size`);
}

function sseAbortError(): Error {
  const error = new Error('Hermes event stream was aborted');
  error.name = 'AbortError';
  return error;
}
