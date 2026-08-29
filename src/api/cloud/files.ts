import { boundedUploadBody, uploadDeadlineMs } from '../upload-body';
import type {
  AccountFileEntry,
  AccountFilesQuery,
  AccountFilesResponse,
  ManagedFilesResponse,
  NativeUpload,
  ToolOutputArtifactEntry,
  ToolOutputArtifactsResponse,
} from '../HermesCloudApi';
import type { HermesCloudTransport, JsonRecord } from './transport';

const COLLABORATION = '/api/plugins/collaboration';
const TOOL_OUTPUT_PREFIX = 'toolout_';
const TOOL_OUTPUT_FILTER_CONTRACT = 'account-files-v1';

/** Managed workspace files and account-scoped cloud file library. */
export class HermesFilesCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  listFiles(path = '') {
    return this.transport.request<ManagedFilesResponse>('/api/files', {
      query: { path: path || undefined },
    });
  }

  readFile(path: string) {
    return this.transport.request<JsonRecord>('/api/files/read', { query: { path } });
  }

  streamFile(path: string, signal?: AbortSignal) {
    return this.transport.download('/api/files/stream', { query: { path }, signal });
  }

  listFilesystem(path = '', depth = 1) {
    return this.transport.request<JsonRecord>('/api/fs/list', {
      query: { path, depth: String(Math.max(0, Math.trunc(depth))) },
    });
  }

  readFilesystemText(path: string) {
    return this.transport.request<JsonRecord>('/api/fs/read-text', { query: { path } });
  }

  writeFilesystemText(path: string, content: string) {
    return this.transport.json<JsonRecord>('/api/fs/write-text', 'POST', { path, content });
  }

  readFilesystemDataUrl(path: string) {
    return this.transport.request<JsonRecord>('/api/fs/read-data-url', { query: { path } });
  }

  downloadFilesystem(path: string) {
    return this.transport.download('/api/fs/download', { query: { path } });
  }

  getGitRoot(path = '') {
    return this.transport.request<JsonRecord>('/api/fs/git-root', { query: { path: path || undefined } });
  }

  getDefaultCwd() {
    return this.transport.request<JsonRecord>('/api/fs/default-cwd');
  }

  createDirectory(path: string) {
    return this.transport.json<JsonRecord>('/api/files/mkdir', 'POST', { path });
  }

  deleteFile(path: string, recursive = false) {
    return this.transport.json<{ ok: boolean; path: string }>('/api/files', 'DELETE', {
      path,
      recursive,
    });
  }

  downloadManagedFile(path: string) {
    return this.transport.download('/api/files/download', { query: { path } });
  }

  consumeManagedFile<T>(
    path: string,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ) {
    return this.transport.consumeDownload('/api/files/download', consume, {
      query: { path },
      signal,
    });
  }

  async uploadManagedFile(path: string, upload: NativeUpload, overwrite = true) {
    const form = new FormData();
    form.append('path', path);
    form.append('overwrite', String(overwrite));
    form.append('file', {
      name: upload.name,
      type: upload.mimeType || 'application/octet-stream',
      uri: upload.uri,
    } as unknown as Blob);
    return this.transport.request<JsonRecord>('/api/files/upload-stream', {
      method: 'POST',
      body: form,
    });
  }

  getAccountFiles(query: AccountFilesQuery = {}) {
    return this.transport.request<AccountFilesResponse>(`${COLLABORATION}/files`, {
      query: {
        date_from: query.dateFrom,
        date_to: query.dateTo,
        limit: normalizePageLimit(query.limit),
        offset: normalizePageOffset(query.offset),
        q: query.keyword,
        source: query.source,
        status: query.status,
        type: query.fileType,
        filter_contract: TOOL_OUTPUT_FILTER_CONTRACT,
      },
    });
  }

  private async accountFilePrefix(query: AccountFilesQuery, wanted: number) {
    const pageSize = Math.max(1, Math.min(200, wanted));
    const files = new Map<string, AccountFileEntry>();
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total && files.size < wanted) {
      const page = await this.getAccountFiles({ ...query, limit: pageSize, offset });
      if (page.filter_contract !== TOOL_OUTPUT_FILTER_CONTRACT) {
        throw new Error('Hermes server does not support account-file pagination ordering');
      }
      const entries = Array.isArray(page.files) ? page.files : [];
      for (const entry of entries) {
        if (entry?.id) files.set(entry.id, entry);
      }
      total = Number.isFinite(page.total)
        ? Math.max(0, page.total)
        : offset + entries.length;
      if (!entries.length || offset + entries.length >= total) break;
      offset += entries.length;
    }
    return { files: [...files.values()], total: Number.isFinite(total) ? total : files.size };
  }

  getToolOutputArtifacts(
    limit = 200,
    offset = 0,
    query: AccountFilesQuery = {},
  ) {
    const filters = toolOutputServerFilters(query);
    return this.transport.request<ToolOutputArtifactsResponse>(
      `${COLLABORATION}/tool-output-artifacts`,
      {
        query: {
          limit: normalizePageLimit(limit),
          offset: normalizePageOffset(offset),
          ...filters,
        },
      },
    );
  }

  private async toolOutputArtifactPrefix(query: AccountFilesQuery, wanted: number) {
    if (
      (query.source && query.source !== 'model_output')
      || (query.status && query.status !== 'available')
      || (query.fileType && query.fileType !== 'tool_output')
    ) return { files: [] as AccountFileEntry[], total: 0 };
    const artifacts = new Map<string, ToolOutputArtifactEntry>();
    const matching: AccountFileEntry[] = [];
    const filters = toolOutputServerFilters(query);
    const requiresServerFiltering = filters.filter_contract === TOOL_OUTPUT_FILTER_CONTRACT;
    const pageSize = Math.max(1, Math.min(200, wanted));
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total && matching.length < wanted) {
      const page = await this.getToolOutputArtifacts(pageSize, offset, query);
      if (requiresServerFiltering && page.filter_contract !== TOOL_OUTPUT_FILTER_CONTRACT) {
        throw new Error('Hermes server does not support filtered tool-output pagination');
      }
      const entries = Array.isArray(page.artifacts) ? page.artifacts : [];
      for (const entry of entries) {
        if (!entry?.id || artifacts.has(entry.id)) continue;
        artifacts.set(entry.id, entry);
        const file = toolOutputArtifactFile(entry);
        if (accountFileMatches(file, query)) matching.push(file);
        else if (requiresServerFiltering) {
          throw new Error('Hermes server returned an invalid filtered tool-output page');
        }
      }
      total = Number.isFinite(page.total)
        ? Math.max(0, page.total)
        : offset + entries.length;
      if (!entries.length || offset + entries.length >= total) break;
      offset += entries.length;
    }
    return { files: matching, total: Number.isFinite(total) ? total : matching.length };
  }

  async getAllAccountFiles(query: AccountFilesQuery = {}) {
    const limit = normalizePageLimit(query.limit);
    const startOffset = normalizePageOffset(query.offset);
    const wanted = Math.min(Number.MAX_SAFE_INTEGER, startOffset + limit);
    const [stored, artifacts] = await Promise.all([
      this.accountFilePrefix({ ...query, limit: undefined, offset: undefined }, wanted),
      this.toolOutputArtifactPrefix(query, wanted),
    ]);
    const files = [
      ...stored.files,
      ...artifacts.files,
    ]
      .filter((entry) => accountFileMatches(entry, query))
      .sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))
      .slice(startOffset, wanted);
    return {
      files,
      total: stored.total + artifacts.total,
      limit,
      offset: startOffset,
    } satisfies AccountFilesResponse;
  }

  getAccountFile(id: string) {
    return this.transport.request<{ file: AccountFileEntry }>(
      `${COLLABORATION}/files/${encodeURIComponent(id)}`,
    );
  }

  deleteAccountFile(id: string) {
    if (isToolOutputArtifactId(id)) {
      return this.transport.request<{ id: string; ok: boolean }>(
        `${COLLABORATION}/tool-output-artifacts/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    }
    return this.transport.request<{ id: string; ok: boolean }>(
      `${COLLABORATION}/files/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  downloadAccountFile(id: string, preview = false) {
    if (isToolOutputArtifactId(id)) {
      return this.transport.download(
        `${COLLABORATION}/tool-output-artifacts/${encodeURIComponent(id)}/download`,
      );
    }
    return this.transport.download(
      `${COLLABORATION}/files/${encodeURIComponent(id)}/download`,
      { query: { preview: preview || undefined } },
    );
  }

  consumeAccountFile<T>(
    id: string,
    preview: boolean,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ) {
    if (isToolOutputArtifactId(id)) {
      return this.transport.consumeDownload(
        `${COLLABORATION}/tool-output-artifacts/${encodeURIComponent(id)}/download`,
        consume,
        { signal },
      );
    }
    return this.transport.consumeDownload(
      `${COLLABORATION}/files/${encodeURIComponent(id)}/download`,
      consume,
      { query: { preview: preview || undefined }, signal },
    );
  }

  async uploadAccountFile(upload: NativeUpload, uploadId: string) {
    const body = await boundedUploadBody(upload.uri, upload.name);
    return this.transport.request<{ file: AccountFileEntry }>(`${COLLABORATION}/files`, {
      body,
      deadlineMs: uploadDeadlineMs(body.size),
      headers: {
        'Content-Type': upload.mimeType || 'application/octet-stream',
        'X-Filename': encodeURIComponent(upload.name),
        'X-Upload-ID': uploadId,
      },
      method: 'POST',
    });
  }
}

function isToolOutputArtifactId(id: string) {
  return id.startsWith(TOOL_OUTPUT_PREFIX);
}

function normalizePageLimit(value: number | undefined): number {
  if (value === undefined) return 200;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 200;
  return Math.max(1, Math.min(200, Math.trunc(numeric)));
}

function normalizePageOffset(value: number | undefined): number {
  if (value === undefined) return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(numeric)));
}

function toolOutputArtifactFile(artifact: ToolOutputArtifactEntry): AccountFileEntry {
  const createdAt = Math.max(0, Number(artifact.created_at) || 0) * 1_000;
  const toolName = safeArtifactName(artifact.tool_name || 'tool');
  const callId = safeArtifactName(artifact.tool_call_id || artifact.id).slice(-48);
  return {
    id: artifact.id,
    name: `${toolName}-${callId}.txt`,
    sha256: artifact.sha256,
    mime_type: 'text/plain',
    extension: 'txt',
    file_type: 'tool_output',
    size: Math.max(0, Number(artifact.size_bytes) || 0),
    source: 'model_output',
    status: 'available',
    conversation_id: artifact.conversation_id || undefined,
    turn_id: artifact.turn_id || undefined,
    created_at: createdAt,
    updated_at: createdAt,
    available_at: createdAt,
    download_url: `${COLLABORATION}/tool-output-artifacts/${encodeURIComponent(artifact.id)}/download`,
  };
}

function safeArtifactName(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'tool';
}

function toolOutputServerFilters(query: AccountFilesQuery): Record<string, string> {
  const filters: Record<string, string> = {
    filter_contract: TOOL_OUTPUT_FILTER_CONTRACT,
  };
  const keyword = query.keyword?.trim();
  const dateFrom = query.dateFrom?.trim();
  const dateTo = query.dateTo?.trim();
  if (keyword) filters.q = keyword;
  if (dateFrom && Number.isFinite(accountFileDate(dateFrom))) filters.date_from = dateFrom;
  if (dateTo && Number.isFinite(accountFileDate(dateTo))) filters.date_to = dateTo;
  return filters;
}

function accountFileMatches(entry: AccountFileEntry, query: AccountFilesQuery) {
  if (query.source && entry.source !== query.source) return false;
  if (query.status && entry.status !== query.status) return false;
  if (query.fileType && entry.file_type !== query.fileType) return false;
  const keyword = query.keyword?.trim().toLocaleLowerCase();
  if (keyword && !`${entry.name} ${entry.file_type}`.toLocaleLowerCase().includes(keyword)) {
    return false;
  }
  const createdAt = Number(entry.created_at) || 0;
  const dateFrom = query.dateFrom ? accountFileDate(query.dateFrom) : Number.NaN;
  if (Number.isFinite(dateFrom) && createdAt < dateFrom) return false;
  if (query.dateTo) {
    const dateTo = accountFileDate(query.dateTo);
    if (Number.isFinite(dateTo)) {
      const inclusiveEnd = /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo)
        ? dateTo + 86_400_000 - 1
        : dateTo;
      if (createdAt > inclusiveEnd) return false;
    }
  }
  return true;
}

function accountFileDate(value: string): number {
  const normalized = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return Number.NaN;
    return numeric < 100_000_000_000 ? numeric * 1_000 : numeric;
  }
  return Date.parse(normalized);
}
