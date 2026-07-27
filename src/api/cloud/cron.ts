import type { HermesCloudTransport, JsonRecord } from './transport';

/**
 * Cron scheduling endpoints (the SwiftUI `cron` route).
 *
 * Reached only through the `HermesCloudApi` facade, which delegates the
 * identically named public methods here. Endpoint paths, verbs, and payload
 * shapes are pinned by tests/cloud-api-domains.test.ts — moving a method must
 * not change its wire contract.
 */
export class HermesCronCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  getCronJobs(profile = 'all') {
    return this.transport.request<JsonRecord[]>('/api/cron/jobs', { query: { profile } });
  }

  createCronJob(job: JsonRecord, profile = 'default') {
    return this.transport.json<JsonRecord>('/api/cron/jobs', 'POST', job, {
      query: { profile },
    });
  }

  updateCronJob(id: string, updates: JsonRecord, profile = 'default') {
    return this.transport.json<JsonRecord>(`/api/cron/jobs/${encodeURIComponent(id)}`, 'PUT', {
      updates,
    }, { query: { profile } });
  }

  setCronJobPaused(id: string, paused: boolean, profile = 'default') {
    return this.transport.request<JsonRecord>(
      `/api/cron/jobs/${encodeURIComponent(id)}/${paused ? 'pause' : 'resume'}`,
      { method: 'POST', query: { profile } },
    );
  }

  triggerCronJob(id: string, profile = 'default') {
    return this.transport.request<JsonRecord>(
      `/api/cron/jobs/${encodeURIComponent(id)}/trigger`,
      {
        method: 'POST',
        query: { profile },
      },
    );
  }

  deleteCronJob(id: string, profile = 'default') {
    return this.transport.request<{ ok: boolean }>(
      `/api/cron/jobs/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        query: { profile },
      },
    );
  }
}
