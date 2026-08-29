import type { HermesCloudApi } from '../../api/HermesCloudApi';
import { isRecord, stringValue } from '../route-snapshots/support';

/** Resolve an explicit repository path or the server's canonical Git root. */
export async function resolveGitPath(api: HermesCloudApi, requestedPath?: string): Promise<string> {
  const requested = requestedPath?.trim() || '';
  if (requested) return requested;
  const cwdResult = await api.getDefaultCwd().catch(() => ({}));
  const cwd = isRecord(cwdResult) ? stringValue(cwdResult.cwd) : '';
  const rootResult = await api.getGitRoot(cwd).catch(() => ({}));
  return isRecord(rootResult) ? stringValue(rootResult.root) || cwd : cwd;
}
