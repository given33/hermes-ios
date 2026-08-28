import type { HermesCloudApi } from '../../api/HermesCloudApi';
import type { HermesRouteLocaleInput } from '../route-snapshots/support';
import { writeBoundedDownload } from '../../api/bounded-download';
import { structuredContent } from '../route-snapshots/support';

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
