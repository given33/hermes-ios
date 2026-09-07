import type { HermesChatViewMessage as ChatMessage } from '../../api/chat-view-types';

export function chatMemberKey(message: ChatMessage): string {
  if (message.roleStage === 'chat') return 'hermes';
  return message.memberId || message.senderId || message.profile || message.name;
}

export function currentTurnMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  let start = messages.length - 1;
  while (start > 0 && messages[start].role !== 'user') start -= 1;
  return messages.slice(Math.max(0, start));
}

export function latestMemberMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const members = new Map<string, ChatMessage>();
  for (const message of currentTurnMessages(messages)) {
    if (message.role !== 'assistant' || message.roleStage === 'chat') continue;
    members.set(chatMemberKey(message), message);
  }
  return [...members.values()];
}

// Consolidate transport snapshots without changing the stored conversation.
export function compactChatMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const rows: ChatMessage[] = [];
  const indices = new Map<string, number>();
  for (const message of messages) {
    const key = message.runtimeTurnId
      ? message.role === 'user' ? `user:${message.runtimeTurnId}`
        : message.finalReport || message.roleStage === 'reporter' ? `final:${message.runtimeTurnId}`
        : `${message.runtimeTurnId}:${chatMemberKey(message)}:${message.roleStage || 'chat'}`
      : `id:${message.id}`;
    const index = indices.get(key);
    if (index === undefined) {
      indices.set(key, rows.length);
      rows.push(message);
      continue;
    }
    const previous = rows[index];
    if (message.role === 'user') continue;
    const activities = new Map((previous.activities || []).map((activity) => [activity.id, activity]));
    for (const activity of message.activities || []) activities.set(activity.id, activity);
    rows[index] = {
      ...previous, ...message, id: previous.id,
      content: message.content.trim() ? message.content : previous.content,
      activities: [...activities.values()],
      todos: message.todos ?? previous.todos,
      planItems: message.planItems ?? previous.planItems,
      startedAt: previous.startedAt || message.startedAt,
    };
  }
  // A terminal session-entry echo can carry a later timestamp for the user.
  // Keep each turn's prompt before its replies, independent of replay order.
  for (let index = 0; index < rows.length; index += 1) {
    const user = rows[index];
    if (user.role !== 'user' || !user.runtimeTurnId) continue;
    const firstReply = rows.findIndex((row) => row.role === 'assistant' && row.runtimeTurnId === user.runtimeTurnId);
    if (firstReply >= 0 && firstReply < index) {
      rows.splice(index, 1);
      rows.splice(firstReply, 0, user);
    }
  }
  return rows;
}
