# OpenMinis capability adoption

Reference revision: `OpenMinis/OpenMinis@9cf3a855fecd27bb5735b84cacbd56852a3ab8dd`.

OpenMinis is GPL-3.0. Its chat-composer component structure is ported to React
Native with source attribution and the GPL text retained in the repository.
OpenMinis is not a package, submodule, bundled asset, or runtime dependency.
Native speech and permission services use Apple APIs and existing Hermes
interfaces.

## Adopted

- Native speech input using `SFSpeechRecognizer` with partial transcripts,
  on-device recognition when supported, interruption cleanup, a bounded
  recording session, and stale-callback isolation.
- Native read-aloud using `AVSpeechSynthesizer`, with per-message start/stop
  controls and stale-utterance isolation.
- A source-attributed React Native port of the OpenMinis two-level composer:
  attachment grid, text/voice region, `+`, slash command, read-aloud,
  microphone/text switch, waveform, and stable send/stop controls. It keeps the
  existing Hermes durable send path.
- Explicit just-in-time Camera and Photos authorization before opening their
  system pickers.

## Retained Hermes implementations

- Adaptive Always location, precise-location upgrade, Visits, background
  recovery, MapKit/AMap, and account-scoped encrypted event queues.
- HealthKit, EventKit, Screen Time, Watch, power, APNs, Live Activities and
  the 21 MCP/44-tool Device Relay architecture.
- Server-authoritative conversations, hosted tasks, attachments, skills,
  account generation, deletion, and multi-device recovery.

## Excluded

- iCloud and CloudKit. The main server remains the only synchronization and
  recovery authority.
- The embedded iSH/PRoot runtime. Server, DBB3 and WSL workers retain task
  ownership when iOS is suspended or terminated.
- OpenMinis iCloud, local Linux runtime, and unrelated bundled assets.

## Future scoped capabilities

OpenMinis also demonstrates HomeKit, Bluetooth, NFC, media-library, Vision,
Clipboard, AlarmKit and full Photos-library tools. Each future Hermes tool
requires a separate permission scope, an approval digest for mutations,
idempotency, account-generation binding, audit events, denial-safe UI and a
real-device entitlement test before release.

## Release gates

- `pnpm typecheck`
- `pnpm test`
- Expo public-config generation
- macOS Release compile after pod resolution
- iPhone tests for first permission, denial, Settings recovery, AirPods/route
  change, phone-call interruption, rapid stop/start, offline recognition,
  long dictation, TTS cancellation, app backgrounding and account deletion
