export function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  return 0;
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function stringListValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(stringValue).filter(Boolean).join('、');
  }
  return stringValue(value);
}

export function structuredText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(structuredText).filter(Boolean).join('\n');
  if (isRecord(value)) {
    const primary = structuredText(value.text ?? value.content);
    if (primary) return primary;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return '';
}

export function timestampValue(value: unknown): number {
  const numeric = numberValue(value);
  if (numeric > 0) return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
