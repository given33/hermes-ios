# Worker startup optimization — 2026-09-08

## Official implementation review

Fetched `NousResearch/hermes-agent` main at `966637323e6f90864e069dbc12755934c2c86387` on 2026-09-08. Reviewed the actual source and commit history rather than treating banner latency as worker first-token latency.

| Area | Official solution | Applied state |
| --- | --- | --- |
| Python/CLI startup | [55f9e472a0](https://github.com/NousResearch/hermes-agent/commit/55f9e472a06ef63b85e6161fd086121675be1e27): fast chat parser path, background skill/plugin setup, probe-only auxiliary clients, banner snapshot | Already an ancestor of our backend; sampled worker uses `_try_fast_chat_launch`. Official sub-400 ms figure measures a warm interactive banner, not a remote task's first model token. |
| SDK import compilation | [d380651a9f](https://github.com/NousResearch/hermes-agent/commit/d380651a9fd8867af89abd44b4b12a9bbdd39fe1) and [f298911467](https://github.com/NousResearch/hermes-agent/commit/f2989114670bec7a1f3f2353ac2064c3247ffd9d): warm installed package bytecode, ask uv to compile transitive dependencies | Cherry-picked as `fee9f3c455` and `57350539e5`, preserving upstream authorship. |
| Tool discovery | [Official registry](https://github.com/NousResearch/hermes-agent/blob/966637323e6f90864e069dbc12755934c2c86387/tools/registry.py): file metadata cache for AST discovery; lazy MCP SDK and bounded discovery | Already present. Prior local repairs pass the selected agent's context window through both initial discovery and MCP refresh; no unrelated default-model metadata request is needed. |
| Skills index | [Official prompt builder](https://github.com/NousResearch/hermes-agent/blob/966637323e6f90864e069dbc12755934c2c86387/agent/prompt_builder.py): per-profile memory cache and disk snapshot validated by a file manifest | Already present for local skills. Official current source explicitly scans external directories directly. Our account worker profiles use external skill directories, so this path still reparsed YAML for every new worker. |

## Minimal deployment-specific additions

Backend commit `d0dc95432629873b8c2605b130ef6c16d9f81e7b`:

- External skill frontmatter is cached under the current profile's `cache/`, keyed by the canonical source directory. Nanosecond modification times, sizes, additions and removals invalidate it. The source directory stays read-only. A scan that observes changing files is not persisted.
- Cached data contains metadata, not decisions about visibility. Platform, environment, enabled tools, disabled skills and local-name precedence still apply to each agent. Active conversations retain their existing prompt cache semantics.
- The custom archive updater precompiles approved Python source with the target runtime interpreter before services start. This extends the official installation-time compilation approach to code archives. It neither imports the modules nor changes independent profile data. Both generation and stable installation paths are covered, because different host launchers use different paths.
- Compilation is best-effort for optional sources, with a failed-file count in the deployment receipt. First rollout through the previous updater required one explicit, checksum-verified cache warm; subsequent versions run it within the updater.

## Validation

152 tests passed, two platform skips, using the repository's isolated `scripts/run_tests.sh` runner: official lazy dependency tests, prompt builder tests, external snapshot behavioral tests and runtime updater tests. Tests exercise metadata reuse without reparsing, source changes/deletion, corrupt cache recovery, profile isolation, dynamic environment gating and compilation without executing module code.

Baseline `a0939639a0` live Expo Web run: `C:/Users/given/AppData/Local/Temp/hermes-delivery-20260908-resumed/`. Five tasks passed: DBB3, Windows/WSL, Hong Kong, two-member aggregation and filesystem MCP. Each task had exactly one final report and no failed tools.

| Baseline task | First model request observed | Real thinking visible | Final/composer release |
| --- | ---: | ---: | ---: |
| DBB3 hostname + 8-second command | 33.31 s | 37.56 s | 70.59 s |
| Windows/WSL hostname | 16.90 s | 20.50 s | 39.87 s |
| Hong Kong hostname | 18.99 s | 23.28 s | 40.06 s |
| Two-member task (initial planner) | 4.48 s | 9.51 s | 75.05 s |
| Windows filesystem MCP | 18.05 s | 20.74 s | 50.57 s |

The DBB3 process sampler observed a worker child about 13 seconds after Send; its next 18 seconds included Python/module loading, tool discovery and external skill YAML parsing. These are real application startup costs, not all upstream inference latency. Public HTTPS checks with and without the configured proxy measured roughly 20–100 ms and do not explain those waits. Timing columns use one browser clock; host timestamps are not subtracted from browser timestamps.

Native iPhone and microphone acceptance are outside this run. A functional pass is not an acceptance of the requested few-second first token.

## First post-update measurements

Evidence: `C:/Users/given/AppData/Local/Temp/hermes-delivery-20260908-optimized-workers/`. The same three prompts reused the same authenticated conversation. All passed; no tools failed and each task had exactly one final report.

| Task | First model request observed | Real thinking visible | Final/composer release |
| --- | ---: | ---: | ---: |
| Windows hostname, first run after update | 25.65 s | 28.55 s | 47.59 s |
| Hong Kong hostname | 14.02 s | 16.99 s | 29.86 s |
| Windows filesystem MCP | 13.62 s | 17.50 s | 65.69 s |

The initial Windows run regressed against the warm baseline. The later MCP request started sooner but required more model/tool passes before completing. Therefore these observations support neither a universal latency reduction nor few-second acceptance. No samples were discarded to hide this variation.

A real Hong Kong metadata check compared fresh YAML parsing with the persisted snapshot: 128 files, 48.6 ms versus 6.6 ms, identical metadata. This verifies the specific optimization and shows that this cache alone cannot explain or eliminate the remaining multi-second worker initialization.

## Four-host verification and subsequent run

Hub, DBB3, Windows/WSL and Hong Kong all run `d0dc95432629873b8c2605b130ef6c16d9f81e7b`. All deployment source hashes match, all protected profile hashes match their own receipts, and gateways are active. Each host compiled 1,209 approved source files at both installation locations with zero failures. DBB3's GitHub download was slow; the exact 72 MB GitHub archive already fetched by Hub was transferred to its updater cache. The updater still verified the approved commit and source contents. Its update timer was restored after the transfer.

Evidence: `C:/Users/given/AppData/Local/Temp/hermes-delivery-20260908-optimized-final/`. DBB3, Windows and two-member aggregation passed with one final report per turn and no failed tools. Metrics filter by the actual enqueued turn ID as well as excluding snapshots, so old SSE replay events cannot be counted as a new request or duplicate final.

| Task | First model request observed | Real thinking visible | Final/composer release |
| --- | ---: | ---: | ---: |
| DBB3 hostname + 8-second command, first run after update | 31.53 s | 36.37 s | 63.19 s |
| Windows hostname, subsequent run | 15.00 s | 18.43 s | 36.99 s |
| Two-member task (initial planner) | 4.84 s | 11.96 s | 64.17 s |

The DBB3 trace still shows MCP discovery joining, tool-module discovery, SDK/Pydantic construction and a separate CLI process for each assignment. The [current official Kanban dispatcher](https://github.com/NousResearch/hermes-agent/blob/966637323e6f90864e069dbc12755934c2c86387/hermes_cli/kanban_db_dispatch.py) also spawns task processes. This audit did not find an official drop-in cross-host persistent worker implementation that removes all of those costs. These remaining waits are unresolved and must not be described as only provider latency.

The dedicated DBB3 warm follow-up (`C:/Users/given/AppData/Local/Temp/hermes-delivery-20260908-dbb3-warm/`) passed with one final and zero failed tools: request observed 28.13 s, thinking visible 31.83 s, final/composer release 67.25 s. Its sampler observed the worker child at 14.35 s, followed by CLI imports, Kanban schema checks, MCP joining and SDK construction. Pre-child time and post-child initialization both remain material; neither is hidden in the model-provider budget.

At the end of the run, all four runtime update timers and peer watchdog services were active. No physical-iOS acceptance or completion of the overall few-second worker-latency target is claimed.
