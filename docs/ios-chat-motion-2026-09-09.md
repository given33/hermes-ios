# iOS Chat Motion, 2026-09-09

Status: implementation and iOS Hermes bundle verification completed; physical-device acceptance pending.

## Changes

- iOS uses `useChatScrollController.native.ts`. Reanimated frame callbacks and scroll handlers follow the changing content target on the UI runtime. Drag interrupts following on that runtime; JS is notified only when follow/button state changes. The browser uses a separate controller.
- Stream reducers coalesce nonterminal events at a maximum cadence of roughly 30 updates per second. Terminal events still flush immediately and preserve ordered events.
- Reasoning, progress reports and expanded tool output use a bounded presentation buffer. Replacements, corrections, completion and Reduce Motion bypass the buffer. Source text remains unchanged for persistence and copying.
- Disclosure height is measured independently. Only open/close animates height; text increments do not restart layout animations. A closing region retains its last children until the transition finishes.
- Tool rows stay individually mounted throughout a live turn. History can still group completed calls. Settled rows do not receive timer ticks.
- New tools and final answers use shared-value opacity/translation animations. They do not use layout-entry transitions that can reposition DOM elements during reflow on web.
- The final answer enters before the process closes. Manual inspection pins the process open. Assistant columns retain a stable width throughout streaming.
- The existing native CADisplayLink diagnostics now expose resettable delayed-frame counts, intervals over 50 ms, maximum interval and p95 of the latest 600 samples. These measure main-thread display-link pacing, not GPU presented-frame timing. Power/thermal state remains included. Actual renderer hitches still require Instruments on iOS.

## Evidence

- TypeScript check passed.
- The 32 focused motion, tool detail, execution phase and grouping checks passed.
- Native shell source checks passed. One existing SwiftUI source-contract assertion expects a removed `createConversation(profile, ...)` call. Two existing compact-layout assertions expect removed ChatPlanDrawer/contextUsageRow markup. The same missing patterns were checked in HEAD before these changes. These failures were not hidden or bypassed.
- `expo export --platform ios --source-maps --output-dir .expo/motion-ios-export` compiled the application to Hermes bytecode. Its source map includes `useChatScrollController.native.ts` and excludes the browser controller.
- Production bundle and font export checks passed. This verifies JS/resources, not Swift compilation or a signed IPA.
- The separate browser replay imports the real chat components and checks tool order/no absolute positioning, manual scroll interruption, jump-to-latest, terminal content, manual pinning and Reduce Motion. Browser timing is deliberately not an iPhone FPS claim.

## Native Acceptance Still Required

The available host is Windows. No connected iPhone, Xcode command, or configured Mac SSH host was found. No new IPA was installed and no Instruments trace was captured. The Swift diagnostic extension still requires an Xcode build. Existing macOS CI runs the full suite before building; the baseline assertion failures above remain in that path.

On an accessible Mac/device, use a Release build of Hermes and capture the four transitions independently: reasoning increments, tool input/output increments, progress reports, final-answer handoff. Repeat on a 60 Hz device and a ProMotion device, with a long conversation, rapid open/close, manual scrolling, keyboard transitions, and Reduce Motion. Record frame pacing, animation hitches and main-thread time with Instruments. Reset `resetNativeFrameRateDiagnostics()` before each run and read `getNativeFrameRateDiagnostics()` afterward; do not infer displayed FPS from the requested refresh rate.

`scripts/fixtures/chat-motion-preview.tsx` is a separate replay entry, excluded from App and production imports. On a custom native build containing the diagnostic module, it logs `[hermes-ios-motion]` diagnostics after the replay. It is a synthetic rendering probe and does not replace a real hosted conversation.

No production deployment, git commit or push was performed for this change.
