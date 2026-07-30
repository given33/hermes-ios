import { boundedUploadBody } from '../upload-body';
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
        limit: query.limit ?? 200,
        offset: query.offset ?? 0,
        q: query.keyword,
        source: query.source,
        status: query.status,
        type: query.fileType,
      },
    });
  }

  private async drainAccountFiles(query: AccountFilesQuery = {}) {
    const pageSize = Math.max(1, Math.min(200, Math.trunc(query.limit || 200)));
    const files = new Map<string, AccountFileEntry>();
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const page = await this.getAccountFiles({ ...query, limit: pageSize, offset });
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
    return [...files.values()];
  }

  getToolOutputArtifacts(limit = 200, offset = 0) {
    return this.transport.request<ToolOutputArtifactsResponse>(
      `${COLLABORATION}/tool-output-artifacts`,
      { query: { limit, offset } },
    );
  }

  private async drainToolOutputArtifacts() {
    const artifacts = new Map<string, ToolOutputArtifactEntry>();
    const pageSize = 200;
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const page = await this.getToolOutputArtifacts(pageSize, offset);
      const entries = Array.isArray(page.artifacts) ? page.artifacts : [];
      for (const entry of entries) {
        if (entry?.id) artifacts.set(entry.id, entry);
      }
      total = Number.isFinite(page.total)
        ? Math.max(0, page.total)
        : offset + entries.length;
      if (!entries.length || offset + entries.length >= total) break;
      offset += entries.length;
    }
    return [...artifacts.values()];
  }

  async getAllAccountFiles(query: AccountFilesQuery = {}) {
    const [storedFiles, artifacts] = await Promise.all([
      this.drainAccountFiles(query),
      this.drainToolOutputArtifacts(),
    ]);
    const startOffset = Math.max(0, Math.trunc(query.offset || 0));
    const files = [
      ...storedFiles,
      ...artifacts.map(toolOutputArtifactFile),
    ]
      .filter((entry) => accountFileMatches(entry, query))
      .sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))
      .slice(startOffset);
    return {
      files,
      total: files.length,
      limit: Math.max(1, Math.min(200, Math.trunc(query.limit || 200))),
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

  async uploadAccountFile(upload: NativeUpload, uploadId: string) {
    const body = await boundedUploadBody(upload.uri, upload.name);
    return this.transport.request<{ file: AccountFileEntry }>(`${COLLABORATION}/files`, {
      body,
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

function accountFileMatches(entry: AccountFileEntry, query: AccountFilesQuery) {
  if (query.source && entry.source !== query.source) return false;
  if (query.status && entry.status !== query.status) return false;
  if (query.fileType && entry.file_type !== query.fileType) return false;
  const keyword = query.keyword?.trim().toLocaleLowerCase();
  if (keyword && !`${entry.name} ${entry.file_type}`.toLocaleLowerCase().includes(keyword)) {
    return false;
  }
  const createdAt = Number(entry.created_at) || 0;
  const dateFrom = query.dateFrom ? Date.parse(query.dateFrom) : Number.NaN;
  if (Number.isFinite(dateFrom) && createdAt < dateFrom) return false;
  if (query.dateTo) {
    const dateTo = Date.parse(query.dateTo);
    if (Number.isFinite(dateTo)) {
      const inclusiveEnd = /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo)
        ? dateTo + 86_400_000 - 1
        : dateTo;
      if (createdAt > inclusiveEnd) return false;
    }
  }
  return true;
}
