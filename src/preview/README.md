# `src/preview/` - design fixtures only

This directory contains Expo design-walkthrough pages, fixture data, and the
empty modules that Metro substitutes into production builds. The shipped chat,
memory, shell, workflow timeline, and shared React Native controls live in
`src/studio/`.

Production builds replace these preview-only module families:

| Preview-only module | Production replacement |
| --- | --- |
| `preview-fixtures.ts` | `production-fixtures.ts` |
| `Preview(Automation\|Core\|Plugin\|Settings)Pages` and `HermesStudioSettingsPage` | `production-route-stubs.tsx` |
| `src/i18n/preview-localization.ts` | `src/i18n/production-preview-localization.ts` |
| `chat-fixture-simulator.ts` | `production-chat-simulator.ts` |

`scripts/verify-production-source-graph.mjs` rejects every other module in this
directory if it becomes reachable from the signed application entry.
