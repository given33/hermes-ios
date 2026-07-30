# Third-party notices

## OpenMinis chat composer

The Hermes iOS chat composer includes a React Native port of the component
structure and interaction design from these OpenMinis files:

- `src/ios/Views/Chat/AIChatView.swift`
- `src/ios/Views/Chat/ChatInputBar.swift`
- `src/ios/Views/Chat/Voice/InlineVoiceInputView.swift`

Source revision: `OpenMinis/OpenMinis@9cf3a855fecd27bb5735b84cacbd56852a3ab8dd`

Project: https://github.com/OpenMinis/OpenMinis

License: GNU General Public License version 3. A copy is included at
`licenses/OpenMinis-GPL-3.0.txt`.

The port retains the OpenMinis two-level composer structure, attachment grid,
text/voice content region, circular attachment and slash controls, read-aloud
toggle, microphone/text-mode switch, send/stop control, continuous 20-point
surface, and shadow treatment. Hermes-specific durable outbox, hosted-task,
encryption, and account-boundary behavior remains behind that UI.

## Pi protocol and interaction references

Hermes iOS adapts protocol and interaction concepts from
`earendil-works/pi` at revision
`a597371bda2af70372d1323d550483b5f4a0ae36` (MIT):

| Pi source | Hermes iOS target |
|---|---|
| `packages/agent/src/types.ts` | `src/api/hosted-conversation-events.ts` |
| `packages/ai/src/utils/event-stream.ts` | `src/studio/chat/useHostedConversationStream.ts` |
| `packages/agent/src/harness/session` | `src/api/conversation-session-entries.ts` |
| `packages/tui/src/autocomplete.ts`, `packages/coding-agent/src/core/slash-commands.ts` | `src/studio/chat/slash-command-model.ts` and composer navigation |
| resource source/diagnostic types | managed resource catalog models under `src/api/cloud` |

The iOS code is a React Native adaptation with account-generation fencing,
native lifecycle handling, reconnect cursors and Hermes server ownership. Pi's
Node runtime, server, provider credentials and TUI are not bundled. The Pi MIT
license is reproduced in `licenses/pi-MIT.txt`.
