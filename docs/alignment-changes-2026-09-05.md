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
view originally rendered raw JSON. Official
feature additions and backend deployment alignment remain separate work.

## Cron Follow-Up

- Native history now groups runs by profile and job, with expandable timestamps,
  model and session IDs. An ended run is not presented as successful without
  an explicit success result. Failed history reads remain visible.
- Delivery targets show configuration readiness. Job editing and creation use
  the existing official delivery field; the picker retains custom destinations.
- All Cron row operations carry the task's profile. Same-ID jobs in separate
  profiles retain separate histories and SwiftUI identities.
- Preserve editable names and prompts verbatim; read the official object-shaped
  schedule and `last_run_at` instead of showing placeholders for valid records.
- `pnpm test`: 895 passed, zero failures/skips. `pnpm typecheck`: passed.
- Native compilation of this follow-up is pending the macOS workflow. Earlier
  commit `0a393d6` passed Verify and the unsigned device/Simulator Release build
  in run `33945396630`. No physical-device or signed-installation result exists.
- Blueprint parameter editing still uses JSON; full Cron feature acceptance is
  open. History details do not yet open profile-scoped run transcripts.
