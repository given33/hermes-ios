# Conversation Navigation and Dispatch Audit

Context: Codex task 01a08385-2229-7c31-9b9b-4d5ba1b1fc4a.
Scope: conversation navigation, streaming render cost, native navigation, and the DBB3 connector's batch dispatch path. This is not an exhaustive proof that the repositories contain no other bugs.

## Implemented

- Timeline rows use compact waveform spacing, prompt-length-based logarithmic widths, and a 160 ms proximity response on hover, focus, or long press. An unusually large pasted prompt no longer compresses ordinary prompts into nearly identical marks. The first entry receives no special width.
- The preview follows the selected row within the visible rail. Initial rail layout participates in centering the active task.
- Timeline navigation takes a bounded 280 ms animation rather than browser/native distance-dependent smooth scrolling. A real gesture cancels it, and new streamed output does not reclaim the selected position. Native navigation runs through Reanimated on the UI runtime.
- Bottom-of-conversation detection selects the last task even when its short reply prevents that prompt from reaching the viewport top.
- Transcript compaction replaces a per-user full-history search and array splices with a linear ordering pass. Prompt/reply ordering and input immutability remain covered.
- DBB3 accepts and dispatches every run in a leased batch before synchronizing status and uploading results. A previous run's result synchronization therefore cannot block another assignment in that batch.
- Wake notifications are consumed before the authoritative pull, including immediate terminal handoffs. New notifications arriving during a cycle remain pending. Per-cycle account-validation markers are cleared before a new cycle.
- Acknowledged terminal failures also request immediate handoff, and completed runs are not redundantly read again after restart.

## Verification

- 60 focused frontend tests passed; TypeScript checking passed.
- Navigation browser replay passed at 390x844, 1280x860, and 320x568. Measured click-to-visible-task latency: 299, 323, and 299 ms. Click-to-visibility is measured in a synthetic transcript, not an iPhone interaction trace.
- Streaming animation replay passed at mobile and desktop sizes and with Reduce Motion. Manual history inspection, return-to-latest, tool layout, and completion checks passed. These are browser results, not native FPS claims.
- iOS Hermes export: `.expo/timeline-wave-ios-export`. Production-source and font checks passed. This checks JavaScript bytecode/assets, not Swift compilation or physical-device rendering.
- Final connector-focused run: 24 tests passed. Connector session-cache suite: 36 tests passed in the broader run.
- Broader deployment checking is not fully green: an existing source-text assertion requires every runtime filename to appear literally in deployment scripts despite their Git-index-generated source manifest; a WSL installer harness also invoked Windows Python for a Linux temporary path and failed with a permission error. These are recorded rather than presented as passing checks.

## Measurements

Local compaction benchmark, identical 5,000-turn input and output, 15 samples:

| Metric | HEAD implementation | Updated implementation |
| --- | ---: | ---: |
| Median | 53.724 ms | 5.043 ms |
| p95 | 60.367 ms | 9.362 ms |

Current installed server runtime was measured separately against a controlled loopback HTTP endpoint using isolated temporary profiles. No real model inference was measured, and the new connector edits have not been deployed to that server.

| Startup mode | Observed preparation time |
| --- | ---: |
| Cold independent process | 2,984-5,005 ms |
| Prewarmed independent worker | 906-3,618 ms |
| First persistent-session turn | 3,045 ms |
| Subsequent persistent-session turns | 22-85 ms |
| Three concurrent new sessions in a ready runtime | 291-387 ms |

The universal one-second target is **not achieved**. Import/configuration/agent initialization and spare-pool depletion still affect independent workers; a large in-progress artifact upload and external transport/model latency are also outside a guaranteed subsecond bound. The current changes remove measured UI overhead and unnecessary dispatch serialization without falsely marking workers as executing early.

Evidence lives under `.expo/timeline-verification/`: `results.json`, `compaction.json`, `worker-startup.json`, and viewport screenshots. `scripts/measure-chat-compaction.mjs` reproduces the local before/after comparison with `node --import tsx`.

## Delivery

Local preview: http://localhost:8083. Edits build on the existing dirty worktrees in `hermes-ios` and `hermes-agent`. No commit, push, production restart/deployment, or iPhone installation was performed. Native-device acceptance and cold-worker startup reduction remain outstanding.
