export const HERMES_BROWSER_HOME_URL = 'https://www.google.com';

export function normalizeBrowserInput(value: string): string {
  const input = value.trim();
  if (!input) return '';
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return input;
  if (/\s/.test(input) || !input.includes('.')) {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  }
  return `https://${input}`;
}

const EXTERNAL_BROWSER_SCHEMES = new Set(['http', 'https', 'mailto', 'sms', 'tel']);

export function isSafeExternalBrowserUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.username === '' && parsed.password === '' && EXTERNAL_BROWSER_SCHEMES.has(parsed.protocol.slice(0, -1).toLowerCase());
  } catch {
    return false;
  }
}

export function browserDomainLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '') || 'New Tab';
  } catch {
    return 'New Tab';
  }
}
