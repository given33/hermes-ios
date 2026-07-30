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
