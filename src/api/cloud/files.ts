import { boundedUploadBody } from '../upload-body';
import type {
  AccountFileEntry,
  AccountFilesQuery,
  AccountFilesResponse,
  ManagedFilesResponse,
  NativeUpload,
} from '../HermesCloudApi';
import type { HermesCloudTransport, JsonRecord } from './transport';

const COLLABORATION = '/api/plugins/collaboration';

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

  async getAllAccountFiles(query: AccountFilesQuery = {}) {
    const pageSize = Math.max(1, Math.min(200, Math.trunc(query.limit || 200)));
    const startOffset = Math.max(0, Math.trunc(query.offset || 0));
    const files = new Map<string, AccountFileEntry>();
    let offset = startOffset;
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
    const allFiles = [...files.values()];
    return {
      files: allFiles,
      total: allFiles.length,
      limit: pageSize,
      offset: startOffset,
    } satisfies AccountFilesResponse;
  }

  getAccountFile(id: string) {
    return this.transport.request<{ file: AccountFileEntry }>(
      `${COLLABORATION}/files/${encodeURIComponent(id)}`,
    );
  }

  deleteAccountFile(id: string) {
    return this.transport.request<{ id: string; ok: boolean }>(
      `${COLLABORATION}/files/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  downloadAccountFile(id: string, preview = false) {
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
