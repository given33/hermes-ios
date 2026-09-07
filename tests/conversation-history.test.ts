import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeUnifiedConversationIndex } from '../src/api/conversation-index';
import { conversationHistoryCategory, formatConversationCreatedAt } from '../src/api/conversation-history-presentation';
import type { SessionSummary, SingleConversation } from '../src/api/cloud/contracts';

test('one chat owns its runtime aliases and cached imported rows without merging unrelated profiles', () => {
  const chat: SingleConversation = { id: 'chat-one', title: 'Original', profile: 'default', messages: [],
    runtime_sessions: { default: 's1' }, runtime_session_aliases: { 'acct-owner-default': 's1' }, message_count: 12 };
  const session = { id: 's1', profile: 'acct-owner-default', source: 'dashboard-group',
    started_at: 10, last_active: 20, message_count: 12 } as SessionSummary;
  const adopted = { id: 'chat-adopted', profile: 'acct-owner-default', title: 'Internal', messages: [],
    runtime_sessions: { 'acct-owner-default': 's1' } };
  const merged = mergeUnifiedConversationIndex([chat, adopted], [session, { ...session, profile: 'other', source: 'cli' }]);
  assert.equal(merged.length, 2);
  assert(merged.some(item => item.id === chat.id));
  assert(merged.some(item => item.official_profile === 'other'));
  assert.equal(conversationHistoryCategory(chat), 'chat');
  assert.equal(conversationHistoryCategory(merged.find(item => item.official_profile === 'other')!), 'chat');
  assert.equal(mergeUnifiedConversationIndex([], [session]).length, 0);
});

test('history categories keep tests, drafts, explicit archives and real conversations distinct', () => {
  const base: SingleConversation = { id: 'c', profile: 'default', title: '137 x 29', messages: [], message_count: 8 };
  assert.equal(conversationHistoryCategory(base), 'chat');
  assert.equal(conversationHistoryCategory({ ...base, history_category: 'test' }), 'test');
  assert.equal(conversationHistoryCategory({ ...base, message_count: 0 }), 'draft');
  assert.equal(conversationHistoryCategory({ ...base, archived: true }), 'archived');
  assert.equal(conversationHistoryCategory({ ...base, historyKind: 'coding' }), 'coding');
  assert.equal(conversationHistoryCategory({ ...base, title: 'work kanban task t_ab12' }), 'runtime');
  assert.equal(conversationHistoryCategory({ ...base, official_session_id: 'codex-ios-run-audit' }), 'test');
  assert.match(formatConversationCreatedAt(new Date(2026, 8, 7, 9, 4).valueOf(), true), /2026\/09\/07 09:04/);
});
