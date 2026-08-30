import type { HermesCloudApi } from '../../api/HermesCloudApi';
import type { HermesRouteLocaleInput } from '../route-snapshots/support';
import { writeBoundedDownload, type WritableDownloadFile } from '../../api/bounded-download';
import { isRecord, structuredContent } from '../route-snapshots/support';

/** Extract safe, de-duplicated web links from current and legacy operation responses. */
export function operationShareUrls(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const rawUrls = value.urls;
  const candidates = [
    ...(Array.isArray(rawUrls) ? rawUrls : []),
    ...(isRecord(rawUrls) ? Object.values(rawUrls) : []),
    value.url,
  ];
  const urls = candidates.filter((candidate): candidate is string =>
    typeof candidate === 'string' && /^https?:\/\//i.test(candidate.trim()),
  ).map((candidate) => candidate.trim());
  return [...new Set(urls)];
}

export async function presentAccountFile(api: HermesCloudApi, id: string, name: string, shareOnly: boolean) {
  const [quickLook, Sharing, { temporaryPlaintextFile }] = await Promise.all([
    import('../../../modules/hermes-quick-look'), import('expo-sharing'), import('../../api/temporary-plaintext-files'),
  ]);
  const target = temporaryPlaintextFile(name, 'account-file');
  try {
    await api.consumeAccountFile(id, !shareOnly, (response, signal) => writeBoundedDownload(response, target, { signal }));
    const presented = shareOnly ? false : await quickLook.presentQuickLook(target.uri, name);
    if (!presented && await Sharing.isAvailableAsync()) await Sharing.shareAsync(target.uri, { dialogTitle: name });
  } finally { if (target.exists) target.delete(); }
}

/** Present a managed workspace file downloaded from the official `/api/files`
 * endpoint. The response is streamed into the same bounded temporary-file
 * path used by account files so large artifacts never accumulate in JS memory. */
export async function presentManagedFile(api: HermesCloudApi, path: string, name: string) {
  const [quickLook, Sharing, { temporaryPlaintextFile }] = await Promise.all([
    import('../../../modules/hermes-quick-look'), import('expo-sharing'), import('../../api/temporary-plaintext-files'),
  ]);
  const target = temporaryPlaintextFile(name || fileNameFromUri(path), 'managed-file');
  try {
    await api.consumeManagedFile(path, (response, signal) => writeBoundedDownload(response, target, { signal }));
    const presented = await quickLook.presentQuickLook(target.uri, name || path);
    if (!presented && await Sharing.isAvailableAsync()) await Sharing.shareAsync(target.uri, { dialogTitle: name || path });
  } finally { if (target.exists) target.delete(); }
}

export const MAX_BACKUP_DOWNLOAD_BYTES = 64 * 1024 * 1024;

const BACKUP_CONTENT_TYPES = new Set([
  '',
  'application/octet-stream',
  'application/x-zip-compressed',
  'application/zip',
]);

interface BackupDownloadFile extends WritableDownloadFile {
  readonly size: number;
  open(): {
    close(): void;
    readBytes(length: number): Uint8Array;
  };
}

/** Stream a backup into a bounded file and validate the stored bytes without
 * ever materializing the archive as a JS Blob/ArrayBuffer. */
export async function writeValidatedBackup(
  response: Response,
  target: BackupDownloadFile,
  signal?: AbortSignal,
): Promise<number> {
  try {
    const contentType = (response.headers.get('Content-Type') || '')
      .trim().toLowerCase().split(';', 1)[0];
    if (!BACKUP_CONTENT_TYPES.has(contentType)) {
      throw new Error('Hermes returned an unsupported backup content type');
    }
    const result = await writeBoundedDownload(response, target, {
      maximumBytes: MAX_BACKUP_DOWNLOAD_BYTES,
      signal,
    });
    if (!target.exists || result.bytes <= 0) {
      throw new Error('Hermes returned an empty backup archive');
    }
    if (target.size !== result.bytes) {
      throw new Error('Hermes backup file size does not match the downloaded bytes');
    }
    const handle = target.open();
    let signature: Uint8Array;
    try {
      signature = handle.readBytes(4);
    } finally {
      handle.close();
    }
    if (!hasZipSignature(signature)) {
      throw new Error('Hermes returned an invalid ZIP backup');
    }
    return result.bytes;
  } catch (error) {
    if (target.exists) target.delete();
    throw error;
  }
}

export async function presentBackup(
  api: HermesCloudApi,
  archive: string,
  locale: HermesRouteLocaleInput,
  expectedPid?: number,
) {
  await waitForBackupCompletion(api, expectedPid);
  const [quickLook, Sharing, { temporaryPlaintextFile }] = await Promise.all([
    import('../../../modules/hermes-quick-look'),
    import('expo-sharing'),
    import('../../api/temporary-plaintext-files'),
  ]);
  const sourceName = fileNameFromUri(archive);
  const name = sourceName.toLowerCase().endsWith('.zip')
    ? sourceName
    : `${sourceName || 'hermes-backup'}.zip`;
  const target = temporaryPlaintextFile(name, 'system-backup');
  try {
    await api.consumeBackup(
      archive,
      (response, signal) => writeValidatedBackup(response, target, signal),
    );
    const title = locale === 'zh' ? 'Hermes 备份' : 'Hermes backup';
    const presented = await quickLook.presentQuickLook(target.uri, title);
    if (!presented && await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(target.uri, {
        dialogTitle: title,
        mimeType: 'application/zip',
      });
    }
  } finally {
    if (target.exists) target.delete();
  }
}

async function waitForBackupCompletion(api: HermesCloudApi, expectedPid?: number): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await api.getActionStatus('backup', 20);
    const statusPid = typeof status.pid === 'number' ? status.pid : undefined;
    if (expectedPid !== undefined && statusPid !== expectedPid) {
      throw new Error(statusPid === undefined
        ? 'Hermes backup status did not identify the requested process'
        : 'Hermes reported a different backup process');
    }
    if (status.running === false) {
      if (status.exit_code === 0) return;
      if (typeof status.exit_code === 'number') {
        throw new Error(`Hermes backup failed (exit ${status.exit_code})`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Hermes backup did not finish within two minutes');
}

export interface ActionCompletionOptions {
  attempts?: number;
  pollIntervalMs?: number;
}

/** Wait for a dashboard background action and return its actual log output.
 * The PID check prevents a stale status response from presenting another
 * invocation's result as the one the user just started. */
export async function waitForActionCompletion(
  api: HermesCloudApi,
  name: string,
  expectedPid: number | undefined,
  options: ActionCompletionOptions = {},
): Promise<string> {
  const attempts = Math.max(1, Math.min(600, Math.floor(options.attempts ?? 240)));
  const pollIntervalMs = Math.max(0, Math.min(5_000, Math.floor(options.pollIntervalMs ?? 500)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await api.getActionStatus(name, 200);
    const statusPid = typeof status.pid === 'number' && Number.isSafeInteger(status.pid)
      ? status.pid
      : undefined;
    if (expectedPid !== undefined && statusPid !== expectedPid) {
      throw new Error(statusPid === undefined
        ? `Hermes ${name} status did not identify the requested process`
        : `Hermes reported a different ${name} process`);
    }
    if (status.running === false) {
      const exitCode = typeof status.exit_code === 'number' ? status.exit_code : undefined;
      if (exitCode !== 0) {
        throw new Error(exitCode === undefined
          ? `Hermes ${name} finished without a verifiable result`
          : `Hermes ${name} failed (exit ${exitCode})`);
      }
      const lines = Array.isArray(status.lines)
        ? status.lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
        : [];
      return lines.slice(-40).join('\n').slice(-8_000);
    }
    if (pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
  throw new Error(`Hermes ${name} did not finish within two minutes`);
}

export async function completedActionMessage(
  api: HermesCloudApi,
  name: string,
  launch: Record<string, unknown>,
  fallback: string,
): Promise<string> {
  const pid = typeof launch.pid === 'number' && Number.isSafeInteger(launch.pid)
    ? launch.pid
    : undefined;
  return (await waitForActionCompletion(api, name, pid)) || fallback;
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
}

export async function presentSkillContent(api: HermesCloudApi, name: string, profile: string) {
  const response = await api.getSkillContent(name, profile);
  const content = structuredContent(response.content ?? response.text);
  const [quickLook, Sharing, { temporaryPlaintextFile }] = await Promise.all([
    import('../../../modules/hermes-quick-look'), import('expo-sharing'), import('../../api/temporary-plaintext-files'),
  ]);
  const target = temporaryPlaintextFile(`${name}-SKILL.md`, 'skill-preview');
  try {
    target.write(content);
    const presented = await quickLook.presentQuickLook(target.uri, `${name}/SKILL.md`);
    if (!presented && await Sharing.isAvailableAsync()) await Sharing.shareAsync(target.uri);
  } finally { if (target.exists) target.delete(); }
}

export function fileImportUploadId(requestId: string | undefined, uri: string, index: number): string {
  const stableRequest = requestId?.trim() || `file-import-${Date.now().toString(36)}`;
  let hash = 2166136261;
  for (const char of uri) { hash ^= char.codePointAt(0) || 0; hash = Math.imul(hash, 16777619); }
  return `${stableRequest}-${index}-${(hash >>> 0).toString(16)}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 256);
}

export function fileNameFromUri(value: string): string {
  try { const url = new URL(value); return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'attachment'); }
  catch { return value.split(/[\\/]/).filter(Boolean).pop() || 'attachment'; }
}

export async function removeStagedFileImport(uri: string): Promise<void> {
  try { const { File } = await import('expo-file-system'); const file = new File(uri); if (file.exists) file.delete(); }
  catch { /* Native stale-batch cleanup remains the fallback. */ }
}

/** Present a server-side session export using the same native quick-look/share
 * path as skill previews. The gateway streams pages; this helper only handles
 * the bounded completed JSON response on the device. */
export async function presentSessionExport(
  api: HermesCloudApi,
  id: string,
  profile: string,
  locale: HermesRouteLocaleInput,
) {
  const exported = await api.exportSession(id, profile);
  const [quickLook, Sharing, { temporaryPlaintextFile }] = await Promise.all([
    import('../../../modules/hermes-quick-look'),
    import('expo-sharing'),
    import('../../api/temporary-plaintext-files'),
  ]);
  const target = temporaryPlaintextFile(`${id}-session.json`, 'session-export');
  try {
    target.write(JSON.stringify(exported, null, 2));
    const title = locale === 'zh' ? '导出会话' : 'Exported session';
    const presented = await quickLook.presentQuickLook(target.uri, title);
    if (!presented && await Sharing.isAvailableAsync()) await Sharing.shareAsync(target.uri);
  } finally {
    if (target.exists) target.delete();
  }
}

/** Present an account-scoped unified conversation export. Unlike an official
 * runtime session, this id belongs to the collaboration store and must be
 * loaded through `/single/conversations/:id` rather than `/api/sessions`.
 */
export async function presentConversationExport(
  api: HermesCloudApi,
  id: string,
  locale: HermesRouteLocaleInput,
) {
  const result = await api.getConversation(id);
  const exported = result?.conversation || result;
  const [quickLook, Sharing, { temporaryPlaintextFile }] = await Promise.all([
    import('../../../modules/hermes-quick-look'),
    import('expo-sharing'),
    import('../../api/temporary-plaintext-files'),
  ]);
  const target = temporaryPlaintextFile(`${id}-conversation.json`, 'conversation-export');
  try {
    target.write(JSON.stringify(exported, null, 2));
    const title = locale === 'zh' ? '导出会话' : 'Exported conversation';
    const presented = await quickLook.presentQuickLook(target.uri, title);
    if (!presented && await Sharing.isAvailableAsync()) await Sharing.shareAsync(target.uri);
  } finally {
    if (target.exists) target.delete();
  }
}

export async function presentProfileExport(
  api: HermesCloudApi,
  name: string,
  locale: HermesRouteLocaleInput,
) {
  const exported = await api.exportProfile(name);
  const [quickLook, Sharing, { temporaryPlaintextFile }] = await Promise.all([
    import('../../../modules/hermes-quick-look'),
    import('expo-sharing'),
    import('../../api/temporary-plaintext-files'),
  ]);
  const target = temporaryPlaintextFile(`${name}-profile.json`, 'profile-export');
  try {
    target.write(JSON.stringify(exported, null, 2));
    const title = locale === 'zh' ? `导出 Profile：${name}` : `Exported profile: ${name}`;
    const presented = await quickLook.presentQuickLook(target.uri, title);
    if (!presented && await Sharing.isAvailableAsync()) await Sharing.shareAsync(target.uri);
  } finally {
    if (target.exists) target.delete();
  }
}
