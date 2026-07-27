import type { PaginatedSessions, SessionSummary } from '../HermesCloudApi';
import type { HermesCloudTransport, JsonRecord } from './transport';

/** Dashboard status, official session history, logs, and analytics. */
export class HermesSessionsCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  getStatus() {
    return this.transport.request<JsonRecord>('/api/status');
  }

  getSessions(limit = 50, offset = 0, profile = 'default') {
    return this.transport.request<PaginatedSessions>('/api/sessions', {
      profile,
      query: { limit, offset, order: 'recent' },
    });
  }

  async getAllSessions(profile = 'default', pageSize = 100) {
    return this.drainSessions(
      (offset) => this.getSessions(pageSize, offset, profile),
      pageSize,
    );
  }

  getProfileSessions(limit = 100, offset = 0) {
    return this.transport.request<PaginatedSessions>('/api/profiles/sessions', {
      query: {
        archived: 'exclude',
        limit,
        min_messages: 0,
        offset,
        order: 'recent',
        profile: 'all',
      },
    });
  }

  async getAllProfileSessions(pageSize = 100) {
    return this.drainSessions(
      (offset) => this.getProfileSessions(pageSize, offset),
      pageSize,
    );
  }

  getSession(id: string, profile = 'default') {
    return this.transport.request<JsonRecord>(
      `/api/sessions/${encodeURIComponent(id)}`,
      { profile },
    );
  }

  getSessionMessages(id: string, profile = 'default') {
    return this.transport.request<{ session_id: string; messages: JsonRecord[] }>(
      `/api/sessions/${encodeURIComponent(id)}/messages`,
      { profile },
    );
  }

  renameSession(id: string, title: string, profile = 'default') {
    return this.transport.json<{ ok: boolean; title: string }>(
      `/api/sessions/${encodeURIComponent(id)}`,
      'PATCH',
      { title, profile },
    );
  }

  deleteSession(id: string, profile = 'default') {
    return this.transport.request<{ ok: boolean }>(
      `/api/sessions/${encodeURIComponent(id)}`,
      { method: 'DELETE', profile },
    );
  }

  getAnalytics(days = 30, profile = 'default') {
    return Promise.all([
      this.transport.request<JsonRecord>('/api/analytics/usage', {
        profile,
        query: { days },
      }),
      this.transport.request<JsonRecord>('/api/analytics/models', {
        profile,
        query: { days },
      }),
    ]).then(([usage, models]) => ({ usage, models }));
  }

  getLogs(lines = 500, level = 'ALL', component = 'all') {
    return this.transport.request<JsonRecord>('/api/logs', {
      query: {
        lines,
        level: level === 'ALL' ? undefined : level,
        component: component === 'all' ? undefined : component,
      },
    });
  }

  private async drainSessions(
    readPage: (offset: number) => Promise<PaginatedSessions>,
    pageSize: number,
  ) {
    const sessions: SessionSummary[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const page = await readPage(offset);
      const entries = Array.isArray(page.sessions) ? page.sessions : [];
      sessions.push(...entries);
      total = Number.isFinite(page.total) ? Math.max(0, page.total) : sessions.length;
      if (!entries.length || entries.length < pageSize) break;
      offset += entries.length;
    }
    return { sessions, total: sessions.length, limit: pageSize, offset: 0 };
  }
}
