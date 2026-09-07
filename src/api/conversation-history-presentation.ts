import type { SingleConversation } from './cloud/contracts';

export type HistoryCategory = 'chat' | 'agent-group' | 'coding' | 'runtime' | 'test' | 'draft' | 'archived';

export function conversationHistoryCategory(
  conversation: SingleConversation & { historyKind?: string },
): HistoryCategory {
  if (conversation.archived) return 'archived';
  if (conversation.history_category === 'test') return 'test';
  if (/^codex-ios-.*audit$/i.test(conversation.official_session_id || '')
    || /\bALIYUN_OK\b/.test(conversation.title)) return 'test';
  if (conversation.historyKind === 'agent-group') return 'agent-group';
  if (conversation.historyKind === 'coding') return 'coding';
  if (conversation.historyKind === 'workflow' || conversation.history_category === 'runtime'
    || /^work kanban task t_[a-z0-9]+$/i.test(conversation.title.trim())
    || ['dashboard-group', 'kanban', 'tool'].includes(conversation.source || '')) return 'runtime';
  if ((conversation.message_count ?? conversation.messages.length) === 0) return 'draft';
  return 'chat';
}

export function formatConversationCreatedAt(value: number | undefined, chinese: boolean): string {
  if (!value || !Number.isFinite(value)) return chinese ? '创建时间未知' : 'Creation time unknown';
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
  if (Number.isNaN(date.valueOf())) return chinese ? '创建时间未知' : 'Creation time unknown';
  const two = (part: number) => String(part).padStart(2, '0');
  const stamp = `${date.getFullYear()}/${two(date.getMonth() + 1)}/${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
  return chinese ? `创建于 ${stamp}` : `Created ${stamp}`;
}
