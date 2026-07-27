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
