import type {
  AccountFileEntry,
  ConversationSessionState,
  SessionSummary,
} from '../../api/HermesCloudApi';
import { localizeHermesServerText } from '../../i18n/hermes-server-content-zh';

export type HermesRouteLocale = 'en' | 'zh';
export type HermesRouteLocaleInput = HermesRouteLocale | boolean;

export interface HermesRouteLocalizer {
  readonly locale: HermesRouteLocale;
  readonly isChinese: boolean;
  choose(chinese: string, english: string): string;
  serverText(value: string): string;
}

export function routeLocalizer(
  locale: HermesRouteLocaleInput = 'zh',
): HermesRouteLocalizer {
  const normalized = locale === true || locale === 'zh' ? 'zh' : 'en';
  const isChinese = normalized === 'zh';
  return {
    locale: normalized,
    isChinese,
    choose: (chinese, english) => isChinese ? chinese : english,
    serverText: (value) => localizeHermesServerText(value, isChinese),
  };
}

export function isSessionSummary(value: unknown): value is SessionSummary {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.message_count === 'number'
    && typeof value.tool_call_count === 'number';
}

export function isConversationSessionState(value: unknown): value is ConversationSessionState {
  if (!isRecord(value) || !isRecord(value.context) || !isRecord(value.lineage)) {
    return false;
  }
  return typeof value.conversation_id === 'string'
    && typeof value.profile === 'string'
    && typeof value.session_id === 'string'
    && typeof value.context.session_id === 'string'
    && Array.isArray(value.context.compression_lineage)
    && typeof value.lineage.current_session_id === 'string'
    && Array.isArray(value.lineage.sessions)
    && Array.isArray(value.lineage.edges);
}

export function isAccountFileEntry(value: unknown): value is AccountFileEntry {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.mime_type === 'string'
    && typeof value.file_type === 'string'
    && typeof value.size === 'number'
    && (value.source === 'model_output' || value.source === 'user_upload')
    && (value.status === 'available' || value.status === 'failed' || value.status === 'uploading')
    && typeof value.created_at === 'number';
}

export function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-';
  const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(milliseconds));
}

export function formatDateValue(value: unknown): string {
  if (typeof value === 'number') return formatTimestamp(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? formatTimestamp(parsed) : value;
  }
  return '-';
}

export function formatBytes(value: number | null): string {
  if (!value || value < 1) return value === 0 ? '0 B' : '-';
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${Math.round(value / 1_024)} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(value);
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 2,
    style: 'currency',
  }).format(value);
}

export function formatContextLength(value: number): string {
  return value > 0 ? `${formatCompactNumber(value)} context` : '';
}

export function formatDuration(seconds: number, localizer: HermesRouteLocalizer): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days) return localizer.choose(`${days}天 ${hours}小时`, `${days}d ${hours}h`);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours) return localizer.choose(`${hours}小时 ${minutes}分钟`, `${hours}h ${minutes}m`);
  return localizer.choose(`${minutes}分钟`, `${minutes}m`);
}

export function shortDayLabel(day: string): string {
  const match = day.match(/(\d{2})-(\d{2})$/);
  return match ? `${match[1]}/${match[2]}` : day;
}

export function inferLogLevel(line: string): string {
  const upper = line.toUpperCase();
  if (upper.includes('CRITICAL')) return 'CRITICAL';
  if (upper.includes('ERROR')) return 'ERROR';
  if (upper.includes('WARN')) return 'WARNING';
  if (upper.includes('DEBUG')) return 'DEBUG';
  return 'INFO';
}

export function hashString(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function positiveRevision(value: unknown): number | undefined {
  const revision = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : undefined;
}

export function epochMilliseconds(value: unknown): number | undefined {
  const timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

export function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function structuredContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(structuredContent).filter(Boolean).join('');
  if (isRecord(value)) return structuredContent(value.text ?? value.content);
  return '';
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStringRecord(value: Record<string, unknown>): value is Record<string, string> {
  return Object.values(value).every((item) => typeof item === 'string');
}
