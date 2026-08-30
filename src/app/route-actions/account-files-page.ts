import type {
  AccountFilesQuery,
  AccountFilesResponse,
  HermesCloudApi,
} from '../../api/HermesCloudApi';
import type { HermesSwiftUIRouteActionPayload } from '../swiftui-route-contract';
import { filesSnapshot } from '../route-snapshots/sessions-files';
import { isRecord, routeLocalizer, type HermesRouteLocaleInput } from '../route-snapshots/support';

export const ACCOUNT_FILES_PAGE_LIMIT = 50;

export interface AccountFilesPageFilters {
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
  source?: string;
}

export interface AccountFilesPageEnvelope {
  files: ReturnType<typeof filesSnapshot>;
  hasMore: boolean;
  limit: number;
  nextOffset: number;
  offset: number;
  query: AccountFilesPageFilters;
  requestId: string;
  total: number;
}

export async function loadAccountFilesRouteFields(
  api: HermesCloudApi,
  source: unknown,
  locale: HermesRouteLocaleInput,
): Promise<{
  accountFilesJSON?: string;
  files: ReturnType<typeof filesSnapshot>;
  managedFilesJSON?: string;
}> {
  const localizer = routeLocalizer(locale);
  const managed = typeof api.listFiles === 'function'
    ? await api.listFiles().catch(() => undefined)
    : undefined;
  const accountPage = isRecord(source) && Array.isArray(source.files)
    ? accountFilesPageEnvelope(source as unknown as AccountFilesResponse, locale)
    : undefined;
  return {
    files: filesSnapshot(source, localizer),
    ...(accountPage ? { accountFilesJSON: JSON.stringify(accountPage) } : {}),
    ...(managed ? { managedFilesJSON: JSON.stringify(managed) } : {}),
  };
}

export async function loadAccountFilesPage(
  api: HermesCloudApi,
  payload: HermesSwiftUIRouteActionPayload,
  locale: HermesRouteLocaleInput,
): Promise<AccountFilesPageEnvelope> {
  const query = accountFilesPageQuery(payload);
  const response = await api.getAllAccountFiles(query);
  return accountFilesPageEnvelope(response, locale, payload.requestId || '', query);
}

export function accountFilesPageEnvelope(
  response: AccountFilesResponse,
  locale: HermesRouteLocaleInput,
  requestId = '',
  query: AccountFilesQuery = {},
): AccountFilesPageEnvelope {
  const localizer = routeLocalizer(locale);
  const files = filesSnapshot(response, localizer);
  const total = finiteNonNegative(response.total);
  const offset = finiteNonNegative(response.offset);
  const limit = boundedInteger(response.limit, 1, 200, ACCOUNT_FILES_PAGE_LIMIT);
  const nextOffset = Math.min(Number.MAX_SAFE_INTEGER, offset + files.length);
  return {
    files,
    hasMore: files.length > 0 && nextOffset < total,
    limit,
    nextOffset,
    offset,
    query: {
      ...(query.keyword ? { keyword: query.keyword } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo ? { dateTo: query.dateTo } : {}),
    },
    requestId,
    total,
  };
}

export function accountFilesPageQuery(
  payload: HermesSwiftUIRouteActionPayload,
): AccountFilesQuery {
  const fields = payload.fields || {};
  const keyword = clean(fields.q ?? payload.value);
  const source = clean(fields.source);
  const dateFrom = clean(fields.dateFrom);
  const dateTo = clean(fields.dateTo);
  return {
    ...(keyword ? { keyword } : {}),
    ...(source === 'model_output' || source === 'user_upload' ? { source } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    limit: boundedInteger(fields.limit, 1, 200, ACCOUNT_FILES_PAGE_LIMIT),
    offset: boundedInteger(fields.offset, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const number = typeof value === 'number' ? value : Number(String(value ?? ''));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)));
}

function finiteNonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
