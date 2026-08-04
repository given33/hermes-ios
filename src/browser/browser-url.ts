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

export function browserDomainLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '') || 'New Tab';
  } catch {
    return 'New Tab';
  }
}
