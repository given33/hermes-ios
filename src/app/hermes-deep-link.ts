import { isHermesNavigation } from '../config';

export interface HermesDeepLinkTarget {
  conversationId?: string;
  routePath: string;
}

export interface AccountBoundHermesDeepLinkTarget {
  accountKey: string | null;
  target: HermesDeepLinkTarget & { requestId: number };
}

export function reconcileHermesDeepLinkAccount(
  current: AccountBoundHermesDeepLinkTarget | null,
  accountKey: string | null,
): AccountBoundHermesDeepLinkTarget | null {
  if (!current) return null;
  if (current.accountKey === null && accountKey !== null) {
    return { ...current, accountKey };
  }
  return current.accountKey === accountKey ? current : null;
}

export function parseHermesDeepLink(url: string): HermesDeepLinkTarget | null {
  if (!isHermesNavigation(url)) return null;
  if (hasRawDotPathSegment(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;

  const segments = parsed.protocol === 'hermes-agent:'
    ? [parsed.hostname, ...parsed.pathname.split('/')]
    : parsed.pathname.split('/');
  const decoded: string[] = [];
  for (const segment of segments.filter(Boolean)) {
    const value = decodePathSegment(segment);
    if (value === null) return null;
    decoded.push(value);
  }
  if (!decoded.length) return { routePath: '/chat' };

  if (decoded[0] === 'chat' || decoded[0] === 'conversation') {
    const conversationId = decoded[1]
      || parsed.searchParams.get('conversation_id')?.trim()
      || parsed.searchParams.get('session_id')?.trim()
      || undefined;
    return {
      ...(conversationId ? { conversationId } : {}),
      routePath: '/chat',
    };
  }
  // `hermes-agent://weather` is the short form push payloads use; the
  // Smart Weather page lives at /smart-weather, and an unaliased /weather
  // fell through to the shell fallback (the chat page).
  if (decoded[0] === 'weather') {
    return { routePath: '/smart-weather' };
  }
  return { routePath: `/${decoded.join('/')}` };
}

function decodePathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded && decoded !== '.' && decoded !== '..' ? decoded : null;
  } catch {
    return null;
  }
}

function hasRawDotPathSegment(url: string): boolean {
  const schemeEnd = url.indexOf(':');
  if (schemeEnd < 0) return false;
  let pathStart = schemeEnd + 1;
  if (url.slice(pathStart, pathStart + 2) === '//') {
    const authorityStart = pathStart + 2;
    const delimiterOffset = url.slice(authorityStart).search(/[/?#]/);
    if (delimiterOffset < 0) return false;
    pathStart = authorityStart + delimiterOffset;
    if (url[pathStart] !== '/') return false;
  }
  const suffix = url.slice(pathStart);
  const boundaryOffset = suffix.search(/[?#]/);
  const rawPath = boundaryOffset < 0 ? suffix : suffix.slice(0, boundaryOffset);
  return rawPath.split('/').some((segment) => {
    try {
      const decoded = decodeURIComponent(segment).trim();
      return decoded === '.' || decoded === '..';
    } catch {
      return false;
    }
  });
}
