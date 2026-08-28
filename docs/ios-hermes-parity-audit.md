# iOS Hermes parity audit

Last audited: 2026-08-29 (Asia/Shanghai)

This is the working ledger for the iOS Hermes integration. A row is only
marked **verified** when the upstream desktop control, the gateway endpoint,
the native facade, the iOS route/action, and an automated contract test all
exist. “API only” is deliberately not treated as completion.

## Transport and authentication

| Area | Upstream/desktop source | Gateway + iOS implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| Basic hosted chat | `apps/desktop/src/app/chat` | Hosted conversation enqueue + ordered lifecycle projection in `src/studio/chat`; native API uses `/api/plugins/collaboration/single/...` | `tests/hosted-conversation-events.test.ts`, `tests/low-latency-event-reducer.test.ts` | verified |
| Low-latency chat events | Desktop event stream contract | WebSocket is preferred, authenticated with one-time `/api/auth/ws-ticket`; automatic SSE fallback remains for old gateways/proxies | `src/api/HermesApiClient.ts`, `src/studio/chat/useHostedConversationStream.ts`, `tests/api-client.test.ts` | verified |
| Bot Mode | Desktop Bot Mode roster/chat | `/api/bots` and canonical `official:v3:` session placeholders; Bots route opens the same hosted chat surface | `tests/cloud-api.test.ts`, `tests/hermes-route-data.test.ts` | verified |
| Worker collaboration | Desktop collaboration panel | Dispatcher + durable worker queue + `/api/plugins/collaboration/worker/ws`; iOS collaboration route uses the canonical room endpoints | backend role/deployment test suite; iOS collaboration source | verified |

## Native route matrix

| Desktop capability | iOS route/action surface | Test/evidence | Status |
| --- | --- | --- | --- |
| Sessions: open, rename, delete, context/lineage, compact, fork, archive/pin/unread | `/sessions`; native list, search, context/lineage, compaction, fork, export, empty-session cleanup, archive/pin/unread status chips and PATCH actions | `tests/swiftui-partial-frontend-source.test.ts`, route-data/API domain tests | verified |
| Files: browse, import, download/share, delete, folders | `/files`; bounded staged importer and protected temp files | file/import source tests and contract tests | verified |
| Models: select, expensive-model confirmation, discover, provider OAuth, custom endpoint | `/models`; model picker, confirmation, discovery, official provider OAuth start/submit/poll and custom endpoint validate/save/activate/delete | model route tests, provider API domain tests, contract tests | verified |
| Analytics | `/analytics`; deferred chart rendering and metrics | analytics snapshot/source tests | verified |
| Logs | `/logs`; filter and refresh | route contract/source tests | verified |
| Cron jobs | `/cron`; create, toggle, run, delete; official blueprint and delivery-target catalogs, typed values JSON, and per-job run history are displayed; blueprints can be instantiated | cron API domain tests + route contract | verified |
| Skills | `/skills`; list, toggle, edit/view `SKILL.md`, managed-installation status, SkillHub source/update/search/preview/scan/install/uninstall, and Learning graph refresh | skills route/source tests and route-data action tests | verified |
| Toolsets | Skills → Toolsets section; toggle, official provider/schema/model catalogs, provider/model/environment selection, post-setup, Terminal backend and Computer Use status/actions | toolset/runtime metadata hydration in `hermes-route-data.ts`; route contract | `tests/hermes-route-data.test.ts`, generated cross-language contract | verified (the native schema is JSON-backed; rich per-key form remains an explicitly tracked enhancement) |
| Plugins | `/plugins`; rescan, install/update/remove, visibility, managed rollback | managed-installation tests | verified |
| MCP | `/mcp`; catalog install, toggle, test, delete, OAuth start; safe browser open and completion polling | MCP route/source tests; OAuth action returns the official authorization URL and the native hook polls the official flow endpoint | verified |
| Channels/Webhooks | `/channels`, `/webhooks`; toggle/edit/test, webhook enable/create/delete | route action contract + API domain tests | verified |
| Pairing | `/pairing`; approve/revoke/clear pending | route action contract | verified |
| Profiles/Bots | `/profiles`, `/bots`; create, activate, rename, description, model, auto-describe, SOUL, setup command, export; Bot Chat opens canonical session | management API tests and route source tests | verified |
| Configuration | `/config`; raw config import/export, stream/compact toggles | config API tests | verified |
| Environment | `/env`; set/reveal/delete with profile scope | environment route source test | verified |
| System/maintenance | `/system`; gateway lifecycle, node reconnect, update check/update, Doctor, security audit, backup, debug share, Curator run/pause, diagnostics, checkpoints and prune | system route source + API domain tests | verified |
| Memory | `/memory`; MEMORY/USER/SOUL editing plus provider select, declared schema config, provider OAuth start/status, reset | memory route/API tests and `src/studio/PreviewMemoryPage.tsx` provider panel | verified |
| Workflows/approvals/runtime | dedicated native pages with revision/digest guarded actions | workflow/approval/runtime route tests | verified |

## Remaining desktop-only controls tracked here

These are not silently ignored. They are the small set of controls that still
need a richer native presentation than the current typed/JSON-backed bridge:

1. Toolset per-key schema form (the official schema, provider/model selectors,
   environment JSON editor and post-setup action are already usable).
2. Backup import and hooks create/delete editors, if the deployment exposes
   those optional desktop controls; the underlying diagnostics/checkpoint
   reads and prune action are already wired.
3. Session project-tree, pull-request scan and bulk import/delete affordances;
   single-session export, archive, pin, unread and empty-session cleanup are
   already complete.

## Change log

- 2026-08-29: moved Toolsets out of the SwiftUI toolbar content (where a
  `Section` could not render), added official toolset schema/model/provider and
  runtime metadata hydration, provider/model/environment selection,
  Terminal/Computer Use controls, Cron blueprint/delivery-target metadata,
  typed instantiation values and run history, session/profile export plus
  archive/pin/unread actions, provider OAuth/custom endpoint controls, MCP
  OAuth browser + completion polling, SkillHub search/preview/scan/install/
  uninstall/update, Learning graph refresh, diagnostics/checkpoints/prune, and
  the live iOS Memory provider panel (select/configure/OAuth), and
  the corresponding generated route contract entries and tests.

Each item must add a typed route snapshot, a named action in
`docs/spec/swiftui-route-actions.json`, a backend-wire test, and a native source
assertion before it can move to **verified**.

## Role/deployment parity

The backend audit is maintained in
`hermes-agent/docs/spec/hosted-audit-remediation.md`. The active topology is a
single `hermes-manager` dispatcher plus independent DBB3, PC/WSL and HK worker
lanes. Each worker has its own connector id, profile, `HERMES_HOME`, token and
skills; role turns do not include supervisor/reviewer agents. HK is deployed by
the gated `deploy-hk-worker` workflow and by the transactional
`deploy/automation/update-fabric-node.sh hk` path.

## Verification boundary

The repository is being audited on Windows. TypeScript, contract generation,
the complete iOS JavaScript test suite, and the backend role/deployment test
subset run here. A native Xcode compile and the Linux-only/full backend suite
require their respective host environments; until those are run, this ledger
must not claim release-level native-build verification.
