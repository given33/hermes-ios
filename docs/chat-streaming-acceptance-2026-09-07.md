# Chat Streaming Acceptance, 2026-09-07–08

## Acceptance Status

Final-speaker ownership, real tool execution and incremental rendering passed live browser checks. The requested few-second response from every worker is **not yet accepted**. Current backend is `e940cb4e96cb0a518892dc13039d41a202f202bc` on all four hosts. A warm direct identity request displayed real reasoning in 3.52 seconds, but Windows worker requests still required 18–24 seconds. Process samples show remaining startup work reading profile configuration, SQLite schema and skill indexes; this is not solely model-provider latency.

No physical iPhone or microphone acceptance is claimed. Expo Web exercises the shared iOS project source and authenticated backend, not the native iOS runtime.

## Delivered Behavior

- A direct chat stays with the current server Hermes. An explicitly assigned single worker owns its final delivery; several workers emit their own progress and the current Hermes aggregates once. Prompts and persisted final-speaker metadata enforce the same rule. A dispatcher handoff is progress, not a second final answer.
- A turn stays active through interim reports, dispatch completion and tool calls. Only a root chat final or authoritative parent terminal releases the composer.
- Each model pass retains its report, reasoning and tools, in that display order. Reports are continuous without numbered stage headings. The final answer is separate; the process collapses after the complete turn.
- Reasoning and tools apply on animation frames as events arrive. Assistant-content fallback events do not become duplicate reasoning.
- Incomplete snapshots preserve user prompts, stable render identities and their position before the corresponding reply. Snapshot and live reasoning reconcile without duplicate passes.
- Message rows have no delayed opacity entrance animation. Reading an expanded process pauses automatic scrolling; collapsing it does not resume following the bottom.
- Tool count and timing both use 11 px text. Final replies show local month, day, hour and minute beside the read-aloud control.
- Search calls expose their query and navigable source links. Failed tool results remain failed even when the enclosing call event says complete.
- Model options retry temporary failures at 2/4/8/15-second intervals, retain confirmed selections and open immediately from cache. A general authentication 503 no longer claims email verification is unconfigured.

## Real Browser Evidence

Preview: `http://localhost:8082/`, Expo Web from this iOS source tree, using the authenticated live backend.

### Current Release Measurements

All times below use the browser's clock, from clicking Send. The model-request column is when its start event reached the browser. Provider and host clocks are not subtracted from the browser clock.

| Real task | Model request observed | Real thinking visible | Final visible and composer released |
| --- | --- | --- | --- |
| Direct 137 × 29 | 6.00 s | 9.05 s | 9.82 s |
| Direct identity question | 1.84 s | 3.52 s | 8.09 s |
| Windows worker hostname | 21.15 s | 23.81 s | 45.27 s |
| Windows MCP allowed directories | 16.08 s | 18.43 s | 45.24 s |
| DBB3 hostname and 8-second terminal operation | 31.26 s | 34.57 s | 69.66 s |
| Hong Kong hostname | 19.84 s | No reasoning from provider | 48.77 s |
| DBB3 + Windows task | 4.95 s (planning) | 7.27 s (planning) | 60.36 s |

Evidence: `C:/Users/given/AppData/Local/Temp/hermes-delivery-20260908-final-direct/` and `hermes-delivery-20260908-final-wsl/`. They contain SSE event timestamps, DOM observations and live/final screenshots. The Windows probes each had one worker final and no failed tools. MCP really called `mcp__filesystem__list_allowed_directories`; its returned directories included `/mnt/d/Hermes/home` and `/mnt/d`. The frontend observed 14/99/51/30 reasoning chunks respectively before completion. Decorative provider spinner text was filtered rather than presented as reasoning.

`C:/Users/given/AppData/Local/Temp/hermes-delivery-20260908-final-team/` verifies the final three rows on the current release. Each single-worker task had exactly one worker final; the two-worker task had exactly one aggregator final, with both actual hostnames in its answer. Tools succeeded, user messages stayed visible, and interim milestones did not release the composer. The Hong Kong provider returned no reasoning delta in this run, so no reasoning was fabricated. Multi-worker planning time is not presented as either worker's first-token time.

The prior full member run on `00b9a190d7` also passed final-speaker ownership for all three workers and the aggregator. Its first reasoning took 36.74/24.41/24.81 seconds on the three workers and is not evidence of a few-second startup.

### Startup And Streaming Fixes

- The connector now accepts `connection.retry` and validates an entire event batch before advancing its cursor. A retry event previously caused HTTP 422 and prevented subsequent reasoning/tool batches from arriving.
- State copies reuse immutable strings. A committed state seeds the guarded read cache; external replacements still invalidate it.
- A bounded active message tail remains durable in `single.json`. The full history sidecar is merged before eviction and at completion instead of being rewritten for every streaming update. Restart/rehydration, eviction and final-history tests preserve both user messages and assistant updates.
- Windows workers now inherit the native Linux code path. Both gateway and connector pin `HERMES_BIN` to the installed entry point, bypassing a legacy shell wrapper that cleared `PYTHONPATH`.
- Tool disclosure uses the actual agent context engine's resolved window. It no longer probes a profile's unrelated default model when the task selected a different model. Browser schema discovery no longer executes `npx --version`; actual browser execution still validates it.
- The filesystem MCP server is installed locally at a pinned version. Startup no longer tries an npm download into the worker's protected home. Deferred tools receive a per-call allowlist only after their current session scope has authorized them.
- Deployment recovery recognizes both `active` and `activating` for the oneshot updater. Peers do not restart a gateway during code/interpreter replacement; a stale marker from an inactive updater does not disable recovery.

Each task carries the selected model/provider override while each host retains its own default model, role, credentials and profile data.

### Conversation History

`C:/Users/given/AppData/Local/Temp/hermes-history-20260908-final/` verifies 19 normal chats, 110 explicit acceptance/test records and 24 unsent drafts. Two imported Kanban executions remain in the separate run history. The canonical index contains 155 rows; 466 underlying runtime sessions at that snapshot no longer each become an independent chat. Runtime aliases link imported sessions to their original account conversation, including old archived indexes. Titles are not used to merge conversations. Later probes can add runtime sessions without creating more user conversations.

The original conversation restores all 68 messages, including 21 user messages, with creation time 2026/09/06 20:31. Local cache refresh drops superseded runtime placeholders while retaining full downloaded transcripts. New messages in the real delivery checks continue using one conversation ID.

### Follow-up Latency Check

The history migration exposed a performance regression: old completed transcripts restored for metadata updates were retained for an hour, growing the hot state to 37 MB and causing a 180-second UI timeout. Metadata updates now avoid hydration and use one transaction; restored, already-idle histories return to the archive after 30 seconds. The hot state subsequently measured 2.39 MB.

`C:/Users/given/AppData/Local/Temp/hermes-delivery-20260907-aa/` records calculation completion in 13.31 seconds, an interim report plus terminal execution in 10.85 seconds, and a direct identity question in 25.06 seconds. The terminal report appeared around 4 seconds, before its final answer. All three requests reused the same conversation; the identity question stayed with the current assistant on Alibaba Cloud. In this run the provider emitted spinner/status text but no genuine reasoning deltas. Those placeholders were filtered, not presented as model reasoning. Earlier measurements below cover actual reasoning delivery when the provider returned it.

Recorded in `C:/Users/given/AppData/Local/Temp/hermes-delivery-20260907-u/`:

| Task | First reasoning visible after send | Final visible / composer released |
| --- | --- | --- |
| Direct 137 x 29 | 9.91 s | 16.61 s |
| Report, terminal output, final | 8.94 s | 17.55 s |
| Search official profiles docs and read a page | 7.63 s | 20.95 s |
| Write a file in the workspace and read it back | No reasoning delta from provider | 24.72 s |

For the first three tasks, the first real reasoning event was rendered 56/85/61 ms after browser receipt. These are client delivery measurements, not a claim of zero network or provider latency. Server and client wall clocks differ, so subtracting their timestamps directly is invalid.

The terminal detail opened in 34 ms. After expanding and collapsing a historical process, its header remained at y=317 px. All sent user messages remained visible throughout these tasks. Mobile and desktop screenshots cover 320, 390, 768 and 1280 px widths; mode controls are centered and all four host labels and versions fit.

The real write/read test produced `file_delivery_verified` in the selected profile's per-conversation workspace. A separate source inspection verified that the user's WutheringWaves export failed under `/opt/hermes-agent` but was subsequently saved successfully under `/var/lib/hermes-agent`, with exact content matching its successful tool input.

Model recovery evidence: `C:/Users/given/AppData/Local/Temp/hermes-model-recovery-20260907-d/`. Two injected 503 responses were followed by an automatic successful retry. The label returned as `deepseek-v4-flash`; the cached selector opened in 65 ms.

The later check at `C:/Users/given/AppData/Local/Temp/hermes-model-recovery-20260908-cached-b/` also delayed conversation model status by 3 seconds. The confirmed model label stayed visible, two injected 503s recovered automatically, and the cached selector opened in 92 ms. Catalog loading no longer waits for the slower conversation status request.

### Worker Delivery And Startup

`C:/Users/given/AppData/Local/Temp/hermes-delivery-20260908-accepted/` passed direct calculation, DBB3, Windows/WSL, Hong Kong and dual-worker tasks. Real terminal output identified `dbb3-hermes`, `LAPTOP-DQNM5NRK` and `ecsr4VOo`. Single-worker turns had exactly one worker final delivery; the dual-worker turn had exactly one aggregator final. Worker thinking and tool events arrived before completion, and completed DBB3 messages retained expandable tool history. No server fallback executed these probes.

The same conversation was reused in `C:/Users/given/AppData/Local/Temp/hermes-delivery-20260908-native-code/` after moving Windows code and Python dependencies onto native WSL storage:

| Worker | First model request received | First real thinking visible | Receipt → thinking rendered | Final / composer released |
| --- | ---: | ---: | ---: | ---: |
| DBB3 | 28.763 s | 32.520 s | 83 ms | 64.213 s |
| Windows/WSL | 44.735 s | 51.067 s | 87 ms | 73.163 s |
| Hong Kong | 24.568 s | 30.978 s | 71 ms | 60.277 s |

These three functional checks passed, but their startup latency did not meet the requirement. First model-request receipt includes dispatch, local initialization and event transport; it is not pure provider time.

`C:/Users/given/AppData/Local/Temp/hermes-delivery-20260908-wsl-startup-trace/startup-7.jsonl` sampled the real WSL connector and its child. The child appeared about 12.6 seconds after send and spent roughly 15 seconds waiting for configured MCP services before constructing its agent. The child then imported tool and model modules before issuing the model request. A separate DBB3 trace showed profile/plugin/MCP and OpenAI/Pydantic imports on its startup path. Keepalive health requests between DBB3 and the Hub measured about 30 ms, so the multi-second assignment delay is not explained by network RTT alone.

Backend `50c59c2a41` applies the official lazy MCP path to Kanban workers when a valid profile-local schema cache exists. Explicit per-server settings take precedence, expired/missing caches still rediscover services, and actual tool calls still connect and verify the live server. This avoids spawning every unrelated MCP service on each assignment. Code and dependency cache relocation alone was insufficient, as the measurements above show.

## Runtime Deployment

Backend source: `given33/hermes-agent`, commit `e940cb4e96cb0a518892dc13039d41a202f202bc`, version `0.21.0`. Frontend application source through `2289837`; this report and the final E2E locator correction follow that commit.

The commit was pushed to GitHub before deployment. Hub, DBB3, Windows/WSL and Hong Kong receipts were checked for the same commit, matching code hashes and unchanged profile configuration hashes. Slow or rate-limited downloads were assisted by transferring the exact archive already downloaded from GitHub. Future unassisted download latency is not covered by this acceptance run.

After the final live runs, all four gateways, update timers and peer watchdogs were active and code hashes still matched. The three workers' profile hashes still matched their deployment receipts. Hub's generated per-account runtime `config.yaml` changed during subsequent agent use; its post-test hash is therefore not claimed to match the pre-start deployment receipt. No other host's profile data was copied over it.

Generated files now use a writable directory under the selected runtime home, scoped by account generation and conversation. Official `session.create` and `session.cwd.set` APIs bind file and terminal tools to it, including resumed conversations. Code installation paths remain separate from profile data.

DBB3 had two conflicting recovery paths. The peer watchdog now tolerates SSH/network failures and service transitions instead of restarting healthy services. The obsolete standalone `hermes-managed-node-watchdog` was disabled on Hub and DBB3 because it used stale/process-local health state. Systemd restart policies, the current connector and peer watchdog remain active.

Official reference: [Profiles, Workspaces and Updating](https://hermes-agent.nousresearch.com/docs/user-guide/profiles).

Official delegation reference: [Delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation/). This project's cross-host connector is a custom integration; the official local subagent implementation is not being presented as identical to that integration.

The updater defers activation while a chat or real worker is executing. On WSL, code generations live in `/var/lib/hermes-runtime-code/wsl`, and the independently preserved Python environment lives under `/var/lib/hermes-python-wsl`. Configurations, identities, keys, histories and workspaces remain local to each host. The updater's GitHub Git transport now falls back to the official GitHub refs API after a timeout while still requiring the approved `main` commit.

## Checks And Limits

- Latest backend checks: 55 agent/context/tool-search tests passed; 58 history and event-stream tests passed; 29 browser-resolution tests passed with one platform skip; two applicable npm warmup checks passed. The broader pre-existing warmup module changes global `os.name` and caused a pytest `PosixPath` internal error on Windows; that full module is not reported as passing.
- Earlier retry/event persistence checks passed 62 tests, and deferred-tool scope/executor checks passed 63 tests. Deployment checks passed 10 tests with one Windows symlink skip. Watchdog shell syntax was checked before deployment.
- TypeScript type check passed.
- Latest model/options/view-model/lifecycle checks: 64 frontend tests passed. Connector transport/status/cache checks: 41 passed. Worker startup/deployment checks: 24 passed before the independent GitHub API fallback, whose updater suite passed 10 checks. MCP lazy-registration/schema-cache checks: 32 passed, including cache miss and first-use behavior.
- 128 focused frontend tests and 45 native-route contract tests passed, covering lifecycle, snapshots, history identity, stage grouping, delivery timing, file failure presentation and durable outbox behavior.
- Backend history/cancellation regression checks and 8 deployment tests passed. The deployment tests verify approved GitHub identity and preservation of independent profile data.
- 15 backend hosted-gateway tests passed, including real temporary-directory write/read, workspace isolation, resume binding, failed tool events and fallback reasoning filtering.
- Physical iPhone performance and native audio capture were not exercised in this acceptance run. Expo Web verifies the shared source and backend, not native iOS runtime behavior.
- Provider latency and tool execution time remain real elapsed time. Providers that send no reasoning content display their real tool activity; the UI does not invent reasoning or delay fast tools for animation.
