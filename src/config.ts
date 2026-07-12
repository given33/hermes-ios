export const HERMES_ORIGIN = (
  process.env.EXPO_PUBLIC_HERMES_URL ?? 'https://8.138.40.16'
).replace(/\/$/, '');

export const GITHUB_REPOSITORY =
  process.env.EXPO_PUBLIC_GITHUB_REPOSITORY ?? 'given33/hermes-ios';

export const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;

export type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

export function buildHermesUrl(path = '/chat'): string {
  const url = new URL(path, `${HERMES_ORIGIN}/`);
  url.searchParams.set('client', 'ios');
  return url.toString();
}

export function isHermesNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === HERMES_ORIGIN || parsed.protocol === 'hermes-agent:';
  } catch {
    return false;
  }
}

export function selectIpaAsset(assets: ReleaseAsset[]): ReleaseAsset | undefined {
  return assets.find((asset) => asset.name.toLowerCase().endsWith('.ipa'));
}

export function getDownloadFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const candidate = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '');
    const sanitized = candidate.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
    return sanitized && sanitized.toLowerCase() !== 'download' ? sanitized : 'Hermes-文件';
  } catch {
    return 'Hermes-文件';
  }
}
