import { MAX_CONVERSATION_ATTACHMENT_BYTES } from './attachment-size-policy';

async function nativeFileBody(uri: string): Promise<Blob> {
  const { File: ExpoFile } = await import('expo-file-system');
  const file = new ExpoFile(uri);
  if (!file.exists) throw new Error('Selected attachment is no longer available');
  return file;
}

export async function boundedUploadBody(
  uri: string,
  name: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const body = uri.startsWith('file:')
    ? await nativeFileBody(uri)
    : await fetch(uri, { signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to read attachment (${response.status})`);
      const declared = response.headers.get('Content-Length');
      if (declared !== null) {
        if (!/^\d+$/.test(declared.trim())) throw new Error('Invalid attachment Content-Length');
        if (Number(declared) > MAX_CONVERSATION_ATTACHMENT_BYTES) {
          throw new Error(`File must be 64 MB or smaller: ${name}`);
        }
      }
      return response.blob();
    });
  if (body.size > MAX_CONVERSATION_ATTACHMENT_BYTES) {
    throw new Error(`File must be 64 MB or smaller: ${name}`);
  }
  return body;
}

/**
 * Deadline for a single upload request, scaled by payload size.
 *
 * The transport default (30s) is tuned for JSON calls: a 64 MB attachment on
 * a 5-20 Mbps cellular uplink needs 30-100s, so every large upload was
 * aborted mid-flight. Floor of 2 minutes, then ~25 KB/s worst-case budget.
 */
export function uploadDeadlineMs(byteSize: number): number {
  return Math.max(120_000, Math.ceil((Math.max(0, byteSize) / 25_000)) * 1_000);
}
