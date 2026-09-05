# iOS alignment changes, 2026-09-05

## Implemented

- Retire shared in-flight GET snapshots when a mutation starts and settles.
  Post-write refreshes no longer reuse pre-write or concurrent-write snapshots.
  Independent reads are not cancelled; ordinary concurrent reads still coalesce.
- Accept the official array-shaped Cron job response when loading run history,
  while preserving compatibility with the older jobs wrapper. Read each job's
  history in its declared profile.
- Reuse the existing conversation-sync work queue for route metadata. Cron
  history has at most four concurrent reads; two Toolsets hydrate at a time,
  with at most six config/model/provider reads. All rows and order are retained.
- Apply the companion URL policy consistently through the Coding Pi client
  factory and constructor. Ordinary Hermes clients retain their HTTPS policy.

## Validation

- `pnpm test`: 892 passed, zero failures, zero skips.
- `pnpm typecheck`: passed.
- `node scripts/verify-production-source-graph.mjs .`: passed, 348 modules.
- Ten new behavioral cases were reproduced on the previous implementation.
  Controlled concurrency probes reproduced peaks of 40 and 90 requests before
  the metadata limits; the fixed paths remain within four and six requests.

## Remaining Acceptance

These tests do not prove iPhone frame rate, network latency, CPU/memory use,
signed installation, or per-feature production parity. No physical-device
environment was available during this verification. The initial Cron history
view still renders raw JSON and needs structured native presentation. Official
feature additions and backend deployment alignment remain separate work.
