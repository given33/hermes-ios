# `src/studio/` - shipped React Native product UI

This directory owns the authenticated Hermes Studio surfaces that ship in the
iOS application: the application composition shell, chat, memory, shared
controls, collaboration participants, reasoning, and workflow timeline.

Fixture records and Expo-only management walkthroughs belong in
`src/preview/`. The production source-graph verifier enforces that split and
Metro replaces preview-only imports with empty production modules.
