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
| Files: account library plus managed-workspace browse/import/download/delete/folders | `/files`; account cloud files keep bounded staged import/share/delete, while a native scope switch hydrates `/api/files`, opens parent/child directories, uploads staged files, downloads through bounded temporary storage, deletes files/folders, and creates folders through the official `folder.create` → `/api/files/mkdir` contract | managed-files route/action tests, file/import/folder source tests and contract tests | verified |
| Models: select, expensive-model confirmation, discover, provider OAuth, custom endpoint | `/models`; model picker, confirmation, discovery, official provider OAuth start/submit/poll and custom endpoint validate/save/activate/delete | model route tests, provider API domain tests, contract tests | verified |
| Analytics | `/analytics`; deferred chart rendering and metrics | analytics snapshot/source tests | verified |
| Logs | `/logs`; filter and refresh | route contract/source tests | verified |
| Cron jobs | `/cron`; create, edit, toggle, run, delete; official blueprint and delivery-target catalogs, typed values JSON, and per-job run history are displayed; blueprints can be instantiated | cron API domain tests + route contract | verified |
| Skills | `/skills`; list, toggle, edit/view `SKILL.md`, managed-installation status, SkillHub source/update/search/preview/scan/install/uninstall, and Learning graph refresh | skills route/source tests and route-data action tests | verified |
| Toolsets | Skills → Toolsets section; toggle, official provider/schema/model catalogs, native declared-key form, provider/model/environment selection, post-setup, Terminal backend and Computer Use status/actions | toolset/runtime metadata hydration in `hermes-route-data.ts`; native `HermesToolsetSchemaSheet` submits the official environment endpoint | `tests/hermes-route-data.test.ts`, `tests/swiftui-partial-frontend-source.test.ts`, generated cross-language contract | verified |
| Plugins | `/plugins`; rescan, install/update/remove, visibility, managed rollback | managed-installation tests | verified |
| MCP | `/mcp`; catalog install, toggle, test, delete, OAuth start; safe browser open and completion polling | MCP route/source tests; OAuth action returns the official authorization URL and the native hook polls the official flow endpoint | verified |
| Channels/Webhooks | `/channels`, `/webhooks`; toggle/edit/test, webhook enable/create/delete; Telegram/WhatsApp official QR onboarding start/status/apply/cancel | route action contract + API domain tests; native QR rendering and bounded status polling | verified |
| Pairing | `/pairing`; approve/revoke/clear pending | route action contract | verified |
| Profiles/Bots | `/profiles`, `/bots`; create, activate, rename, description, model, auto-describe, SOUL, setup command, export; Bot Chat opens canonical session; Bot Routines are hydrated per Profile and expose create/edit/toggle/run/delete | management API tests, route data/action tests and native source tests | verified |
| Bot profile capabilities/assets | Bots context menu loads and edits the official `profiles.describe`/`profiles.configure` contract (skills, Toolsets, MCP, model, SOUL, `ui_meta`); avatar upload/read/clear delegates to `profiles.set_asset`/`profiles.get_asset`, and generation delegates to `image.generate` then `profiles.set_asset`, with native iOS controls and server-side `has_avatar` state | backend Bot Mode REST bridge tests; `cloud-api-domains.test.ts`; `hermes-route-data.test.ts`; generated action contract | verified (official bridge) |
| Bot Petdex avatar picker | Bots context menu reads a bounded (96-entry) projection of the upstream `pet.gallery` catalog and applies a selected first-frame thumbnail through `pet.thumb` → `profiles.set_asset`; native selection menu carries slug and manifest URL, while the dedicated gallery API remains available for future paging/search | backend pet bridge test; `cloud-api-domains.test.ts`; `hermes-route-data.test.ts`; generated action contract | verified (official bridge) |
| Bot Mode cross-connection relay | Bots route reads the upstream relay roster and exposes a native target/message sheet; send queues through the canonical `tools.bot_relay.enqueue_envelope` helper with ambiguity/liveness/TTL safeguards | backend relay route test; `cloud-api-domains.test.ts`; `hermes-route-data.test.ts`; native source/action assertions | verified (official bridge) |
| Configuration | `/config`; raw config import/export, stream/compact toggles | config API tests | verified |
| Environment | `/env`; set/reveal/delete with profile scope | environment route source test | verified |
| System/maintenance | `/system`; gateway lifecycle, node reconnect, update check/update, Doctor, security audit, backup create/import, hooks list/create/delete, debug share, Curator run/pause, diagnostics, checkpoints and prune | system route source + API domain tests | verified |
| Memory | `/memory`; MEMORY/USER/SOUL editing plus provider select, declared schema config, provider OAuth start/status, reset | memory route/API tests and `src/studio/PreviewMemoryPage.tsx` provider panel | verified |
| Workflows/approvals/runtime | dedicated native pages with revision/digest guarded actions | workflow/approval/runtime route tests | verified |

## Change log

- 2026-08-29: added native official channel onboarding for Telegram and
  WhatsApp. The Channels page now starts the upstream QR flow, renders the
  returned payload with Core Image, polls the official pairing status, and
  submits/cancels through the same profile-scoped management APIs. No channel
  credentials or QR state are persisted locally.

- 2026-08-29: closed the managed-workspace Files gap. The native Files page
  now switches between the account cloud library and the desktop-equivalent
  `/api/files` workspace, with parent/child navigation, staged upload,
  bounded download/share, recursive delete, and server-relative folder
  creation. The new route snapshot field and four actions are generated from
  the cross-language contract; no local filesystem model or credentials are
  introduced.

- 2026-08-29: managed-file downloads now use the authenticated streaming
  consumer and bounded temporary-file writer (the same 64 MiB/hash-checked
  path as account attachments), avoiding a second in-memory Blob copy on iOS.

- 2026-08-29: exposed the previously action-only managed workspace folder
  operation on the native Files page. Users can enter a server-relative or
  absolute Hermes workspace path, submit `folder.create`, and receive the
  normal route refresh/result notification; the page does not invent a local
  folder model for the account-scoped cloud file library.

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
- 2026-08-29: added the mobile cross-connection relay bridge. The Bots route
  reads the desktop-maintained `bot_relay/roster.json`, renders reachable
  `handle@connection-id` targets, and queues messages through the official
  `enqueue_envelope` helper; ambiguous/offline targets fail explicitly and
  no connection credential crosses the mobile API.
- 2026-08-29: added the mobile Petdex avatar bridge. The Bots route now
  hydrates the official `pet.gallery` response and its native context menu
  applies a selected pet through server-side `pet.thumb` cropping followed by
  the canonical Bot `profiles.set_asset` handler. Petdex catalog/install
  semantics remain owned by the upstream gateway.
- 2026-08-29: closed the Bot Mode Routines gap. The iOS Bots route now
  hydrates bounded cron stores for every advertised Profile, exposes the
  desktop-equivalent routine controls, and carries an explicit profile scope
  through create/edit/toggle/run/delete/blueprint actions. Added the official
  `cron.update` route action and regression coverage.

Each item must add a typed route snapshot, a named action in
`docs/spec/swiftui-route-actions.json`, a backend-wire test, and a native source
assertion before it can move to **verified**.

### Bot Mode scope boundary

The mobile bridge verifies the interoperable Bot Mode core: profile roster and
CRUD, canonical Bot Chat, server-persisted title/visibility/pin/group metadata,
per-profile Routines, official profile capability/assets, Petdex avatar
selection, and cross-connection relay. The upstream desktop plugin still owns
one window-local orchestration detail that has no server contract: its local
group-chat round engine (member holds and @mention handoffs). iOS uses the
server-backed Hermes Studio collaboration room surface for group chat, with
mentions, member management, interruption, approvals, workspace files, and
authenticated low-latency event delivery. Pixel-pet runtime animation/state
controls remain explicitly out of scope by product decision; Petdex selection
and static avatar rendering are supported.

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

### 2026-08-29 continuation: managed-file facade budget

- Adding the bounded `consumeManagedFile` streaming facade briefly crossed the
  `HermesCloudApi` 1110-line architecture ratchet. The facade was compacted
  without changing its `Response`/`AbortSignal` contract or chunked-download
  semantics, bringing the module back to 1109 lines.
- `pnpm test` is green at 811 passed / 0 failed; `pnpm typecheck` and
  `pnpm contract:check` also pass after the change.

### 2026-08-30 continuation: official hosted commands and role boundary

- The mobile composer now recognizes the upstream `/bg`, `/btw`, and `/busy`
  commands as a separate hosted-command path. `HermesCloudApi` calls the
  account-owned `/mobile/conversations/{conversation_id}/commands` endpoint;
  the backend forwards directly to the official `tui_gateway` JSON-RPC methods
  (`prompt.background`, `prompt.btw`, and `config.set busy`).
- `btw.complete` and `background.complete` are persisted in the same hosted
  event cursor and assistant message snapshot, so the existing WebSocket-first
  stream (with SSE fallback) displays the final result after reconnects. The
  client shows an immediate acknowledgement without persisting a duplicate
  assistant answer.
- The former reviewer/supervisor model lane is intentionally absent from iOS:
  `/review` is not catalogued or executable, and server-side Kanban reviewer
  dispatch is fail-closed. The only hosted roles are one dispatcher and the
  independent DBB3, PC/WSL, and HK workers. Petdex static avatar selection is
  supported; pet runtime animation/state control is out of scope.
- Focused verification: `pnpm exec tsx --test
  tests/mobile-console-model.test.ts tests/chat-view-model.test.ts` (`37 passed`),
  `pnpm typecheck`, and `pnpm contract:check` all pass on Windows. Native
  Swift/Xcode archive and live four-node latency still require macOS CI and a
  production rehearsal.

发布锚点：iOS 提交 `0b98d5a` 已推送到 `origin/main`；它与后端
`c02c3b143d` 配套，消费同一份官方 hosted command/event 契约。

### 2026-08-30 continuation: unified Sessions write paths

The native Sessions list combines account conversations and official runtime
sessions. Previously archive/pin/unread/bulk-delete/export always used the
runtime `/api/sessions` contract, so account rows failed with 404 and
`official:v3` UI envelopes were sent as literal SQLite ids.

The collaboration PATCH now accepts account-scoped `archived`, `pinned`, and
`unread` flags (stored under `session_*` keys so they cannot collide with the
internal archive-placeholder marker). The iOS action bridge resolves official
envelopes, preserves profile ownership, groups mixed bulk deletion by profile,
and selects the correct export endpoint for each store. `pnpm test` passes with
`819 passed / 0 failed`; TypeScript, SwiftUI contract checks, and `expo-doctor`
(`18/18` checks) pass.

### 2026-08-30 continuation: official sessions are visible in the unified list

`HermesCloudApi.getUnifiedConversations()` now fetches the official
`/api/profiles/sessions` all-profile index in parallel with the account-scoped
conversation index, drains pagination, and merges unmapped CLI/Telegram/worker
sessions into signed `official:v3` placeholders. Profile ownership, pinned and
unread flags, mapped-session de-duplication, tombstones, and 404-only fallback
for older gateways are covered by the cloud API tests. This closes the gap where
the official backend session endpoint existed but iOS Sessions could not display
or reopen those sessions.
