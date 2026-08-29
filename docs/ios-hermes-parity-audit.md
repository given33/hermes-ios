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
| Bot Mode core | Desktop Bot Mode roster/chat | `/api/bots` and canonical `official:v3:` session placeholders; Bots route opens the same hosted chat surface | `tests/cloud-api.test.ts`, `tests/hermes-route-data.test.ts` | verified (core) |
| Worker collaboration | Desktop collaboration panel | Dispatcher + durable worker queue + `/api/plugins/collaboration/worker/ws`; iOS collaboration route uses the canonical room endpoints | backend role/deployment test suite; iOS collaboration source | verified |

## Native route matrix

| Desktop capability | iOS route/action surface | Test/evidence | Status |
| --- | --- | --- | --- |
| Sessions: open, rename, delete, context/lineage, compact, fork, archive/pin/unread, project tree, PR scan, bulk import/delete | `/sessions`; native list/search/context/lineage/compaction/fork/export, official sidebar/project-tree/PR/statistics catalogs, bulk selection/delete and JSON import | `tests/swiftui-partial-frontend-source.test.ts`, `tests/hermes-route-data.test.ts`, route-data/API domain tests | verified |
| Files: browse, import, download/share, delete, folders | `/files`; bounded staged importer and protected temp files | file/import source tests and contract tests | verified |
| Models: select, expensive-model confirmation, discover, provider OAuth, custom endpoint | `/models`; model picker, confirmation, discovery, official provider OAuth start/submit/poll and custom endpoint validate/save/activate/delete | model route tests, provider API domain tests, contract tests | verified |
| Analytics | `/analytics`; deferred chart rendering and metrics | analytics snapshot/source tests | verified |
| Logs | `/logs`; filter and refresh | route contract/source tests | verified |
| Cron jobs | `/cron`; create, toggle, run, delete; official blueprint and delivery-target catalogs, typed values JSON, and per-job run history are displayed; blueprints can be instantiated | cron API domain tests + route contract | verified |
| Skills | `/skills`; list, toggle, edit/view `SKILL.md`, managed-installation status, SkillHub source/update/search/preview/scan/install/uninstall, and Learning graph refresh | skills route/source tests and route-data action tests | verified |
| Toolsets | Skills → Toolsets section; toggle, official provider/schema/model catalogs, native declared-key form, provider/model/environment selection, post-setup, Terminal backend and Computer Use status/actions | toolset/runtime metadata hydration in `hermes-route-data.ts`; native `HermesToolsetSchemaSheet` submits the official environment endpoint | `tests/hermes-route-data.test.ts`, `tests/swiftui-partial-frontend-source.test.ts`, generated cross-language contract | verified |
| Plugins | `/plugins`; rescan, install/update/remove, visibility, managed rollback | managed-installation tests | verified |
| MCP | `/mcp`; catalog install, toggle, test, delete, OAuth start; safe browser open and completion polling | MCP route/source tests; OAuth action returns the official authorization URL and the native hook polls the official flow endpoint | verified |
| Channels/Webhooks | `/channels`, `/webhooks`; toggle/edit/test, webhook enable/create/delete | route action contract + API domain tests | verified |
| Pairing | `/pairing`; approve/revoke/clear pending | route action contract | verified |
| Profiles/Bots | `/profiles`, `/bots`; create, activate, rename, description, model, auto-describe, SOUL, setup command, export; Bot Chat opens canonical session | management API tests and route source tests | verified |
| Bot profile capabilities/assets | Bots context menu loads and edits the official `profiles.describe`/`profiles.configure` contract (skills, Toolsets, MCP, model, SOUL, `ui_meta`); avatar upload/read/clear delegates to `profiles.set_asset`/`profiles.get_asset` with a native iOS file importer and server-side `has_avatar` state | backend Bot Mode REST bridge tests; `cloud-api-domains.test.ts`; `hermes-route-data.test.ts`; generated action contract | verified (official bridge) |
| Configuration | `/config`; raw config import/export, stream/compact toggles | config API tests | verified |
| Environment | `/env`; set/reveal/delete with profile scope | environment route source test | verified |
| System/maintenance | `/system`; gateway lifecycle, node reconnect, update check/update, Doctor, security audit, backup create/import, hooks list/create/delete, debug share, Curator run/pause, diagnostics, checkpoints and prune | system route source + API domain tests | verified |
| Memory | `/memory`; MEMORY/USER/SOUL editing plus provider select, declared schema config, provider OAuth start/status, reset | memory route/API tests and `src/studio/PreviewMemoryPage.tsx` provider panel | verified |
| Workflows/approvals/runtime | dedicated native pages with revision/digest guarded actions | workflow/approval/runtime route tests | verified |

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
- 2026-08-29: completed the remaining optional desktop surfaces: session
  sidebar/project-tree/PR/statistics catalogs are carried in the native
  snapshot; bulk delete and JSON import actions call the official session
  endpoints; System can import a backup archive and create/delete hooks; and
  Toolsets expose a native declared-key schema form in addition to the raw
  JSON editor. Added backend-wire and native source regression tests.
- 2026-08-29: fixed the native `HermesSessionSnapshot` decoder to accept the
  server's optional `archived`, `pinned`, and `unread` flags that the SwiftUI
  page already renders; blank redacted Toolset values are never written back.
- 2026-08-29: completed the mobile Bot Mode metadata bridge. `/api/bots`
  now carries upstream `ui_meta['hermes-bots']` presentation state; typed
  `/api/bots/{name}/meta` GET/PATCH endpoints persist title, hidden/pinned
  state, avatar presentation fields, and group membership. The native Bots
  route displays title/groups and exposes hide/show and pin/unpin actions, and
  bot renames use the dedicated Bot Mode REST route. Legacy `mcp.catalog.install`
  action events are also routed through the official catalog installer.
- 2026-08-29: completed the official profile capability/asset bridge. New
  `/api/bots/{name}/describe`, `/configure`, and `/assets/{asset}` routes call
  the registered upstream `profiles.describe`, `profiles.configure`,
  `profiles.get_asset`, and `profiles.set_asset` handlers directly. iOS now
  exposes a raw JSON advanced capability editor and native avatar importer;
  no duplicate profile config writer was introduced.

Each item must add a typed route snapshot, a named action in
`docs/spec/swiftui-route-actions.json`, a backend-wire test, and a native source
assertion before it can move to **verified**.

### Bot Mode scope boundary

The mobile bridge currently verifies the interoperable core: profile roster and
CRUD, canonical Bot Chat, and server-persisted title/visibility/pin/group
metadata. The upstream desktop plugin still owns several presentation and
orchestration surfaces that are not yet represented by a mobile REST contract:
the local group-chat round engine (including member holds and @mention
handoffs), AI/pixel-pet/avatar generation and picker state, cross-connection
roster/relay management, and the dedicated Routines pane. Those are deliberately
not marked as mobile parity until each has a typed endpoint, native route/action,
and contract test; the generic profile, cron, collaboration, and authenticated
gateway-WebSocket APIs remain available for future bridges.

## Role/deployment parity

The backend audit is maintained in
`hermes-agent/docs/hosted-audit-remediation.md`. The active topology is a
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
