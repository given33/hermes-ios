# Chat acceptance requirements

Latest user decisions, 2026-09-08. These supersede earlier proposals to hide
member activity or replace reasoning with summaries.

- Ordinary questions and calculations stay in direct chat.
- Delegate only when useful or explicitly requested. Identity questions about
  the current assistant, greetings and address preferences remain direct chat.
- Exactly one final speaker: direct chat uses the current server's Hermes;
  one worker delivers its own verified result; multiple workers provide their
  progress and handoff, then the current Hermes publishes one consolidated result.
  Dispatcher announcements are progress, not another final answer. If server
  fallback actually executes the assignment, attribute the result to that server.
- Show the actual assignment, recipient, receipt, progress and completion.
  A received lease, completed tool or intermediate report never ends the turn.
- Display each member's full provider-supplied reasoning, streamed as it arrives.
  Do not truncate it or replace it with a summary. Keep manual collapse available.
- Put reasoning and tools inside one execution section. Expand during execution;
  collapse the whole section by default when the task finishes. Historical full
  reasoning remains available by expanding the section.
- Keep tool calls visible and collapsed by default, with correct terminal state.
  Do not display raw input/output panels. Keep spacing compact.
- Todo lists belong to specific members. Update them from actual tool events;
  receiving or dispatching a task does not mean it is complete.
- Do not append a task execution board to the final answer.
- Put the context ring beside voice input. Its compact popup shows usage percent
  and context length from real server data, with unknown values when absent.
- Show Alibaba Cloud, DBB3, Windows/WSL and HK runtime status truthfully.
- Real tasks must validate routing, retries, streaming, tools, completion and
  absence of duplicate replies. Unit checks alone are not full acceptance.
- Each model pass displays its report, provider reasoning and tool calls in
  sequence, with no numbered Hermes stage headings. Keep the final result separate.
- Measure from user send through actual delivery. Track dispatch, worker startup,
  provider wait and rendering separately. Aim for a few seconds to the first
  real model event; do not hide local startup time or fabricate thinking content.
- Publish code to GitHub first, synchronize the exact commit to all four hosts,
  and keep each host's roles, credentials, configuration, memory and sessions independent.
