interface HttpLikeError {
  status?: unknown;
}

const HTML_RESPONSE = /<\s*(?:!doctype|html|head|body|title|center|h1|hr)\b/i;
const STATUS_IN_MESSAGE = /\((\d{3})\)/;

export function smartWeatherLoadErrorMessage(
  error: unknown,
  locale: 'en' | 'zh',
): string {
  const status = httpStatus(error);
  if (status === 401 || status === 403) {
    return locale === 'zh'
      ? 'Hermes 登录状态已失效，请重新登录。'
      : 'Your Hermes session has expired. Sign in again.';
  }
  if (status === 429) {
    return locale === 'zh'
      ? '服务器请求过于频繁，智能天气将稍后自动重试。'
      : 'The server is receiving too many requests. Smart Weather will retry shortly.';
  }
  if (status !== null && status >= 500) {
    return locale === 'zh'
      ? 'Hermes 服务暂时不可用，地图和本机定位仍可继续使用。'
      : 'Hermes is temporarily unavailable. The map and on-device location remain available.';
  }

  const raw = error instanceof Error ? error.message : String(error ?? '');
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact || HTML_RESPONSE.test(compact)) {
    return locale === 'zh'
      ? '智能天气数据暂时不可用，请稍后重试。'
      : 'Smart Weather data is temporarily unavailable. Try again shortly.';
  }
  return compact.slice(0, 160);
}

export function smartWeatherRetryDelayMs(error: unknown): number {
  const status = httpStatus(error);
  if (status === 429) return 60_000;
  if (status !== null && status >= 500) return 30_000;
  return 15_000;
}

export function httpStatus(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const status = (error as HttpLikeError).status;
    if (typeof status === 'number' && Number.isInteger(status)) return status;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  const match = STATUS_IN_MESSAGE.exec(message);
  return match ? Number(match[1]) : null;
}
