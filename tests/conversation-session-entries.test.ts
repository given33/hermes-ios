import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileConversationSessionEntries } from '../src/api/conversation-session-entries';
import type {
  ConversationSessionEntriesResponse,
  SingleConversation,
} from '../src/api/HermesCloudApi';

function conversation(messages: SingleConversation['messages'] = []): SingleConversation {
  return {
    id: 'conversation-1',
    profile: 'default',
    title: 'Recovery',
    messages,
  };
}

function response(
  entries: ConversationSessionEntriesResponse['entries'],
  cursor = entries.length,
): ConversationSessionEntriesResponse {
  return {
    schema_version: 'hermes.session-entry.v1',
    account_generation: 'generation-1',
    cursor,
    leaf_entry_id: entries.at(-1)?.entry_id || '',
    entries,
  };
}

test('append-only message entries restore a message omitted by a stale snapshot', () => {
  const restored = reconcileConversationSessionEntries(conversation(), response([{
    entry_id: 'entry-1',
    cursor: 1,
    parent_entry_id: null,
    entry_type: 'message',
    occurred_at: 100,
    idempotency_key: 'message:message-1',
    payload: {
      message_id: 'message-1',
      role: 'assistant',
      name: 'Hermes',
      content: 'Recovered output',
      status: 'completed',
      kind: 'message',
      turn_id: 'turn-1',
      role_stage: 'reporter',
    },
    schema_version: 'hermes.session-entry.v1',
  }]));

  assert.equal(restored.messages.length, 1);
  assert.equal(restored.messages[0].content, 'Recovered output');
  assert.equal(restored.messages[0].meta?.runtime_turn_id, 'turn-1');
  assert.equal(restored.session_entry_cursor, 1);
  assert.equal(restored.session_entry_leaf_id, 'entry-1');
});

test('later message entries update in place without duplicating history', () => {
  const restored = reconcileConversationSessionEntries(conversation([{
    id: 'message-1',
    role: 'assistant',
    name: 'Hermes',
    content: 'Partial',
    status: 'running',
    created_at: 50,
    meta: { retained: true },
  }]), response([{
    entry_id: 'entry-2',
    cursor: 2,
    parent_entry_id: 'entry-1',
    entry_type: 'message',
    occurred_at: 100,
    idempotency_key: 'message-update:message-1',
    payload: {
      message_id: 'message-1',
      role: 'assistant',
      name: 'Hermes',
      content: 'Complete',
      status: 'completed',
      kind: 'message',
    },
    schema_version: 'hermes.session-entry.v1',
  }], 2));

  assert.equal(restored.messages.length, 1);
  assert.equal(restored.messages[0].content, 'Complete');
  assert.equal(restored.messages[0].status, 'completed');
  assert.equal(restored.messages[0].meta?.retained, true);
  assert.equal(restored.messages[0].created_at, 50);
  assert.equal(restored.messages[0].updated_at, 100);
});

test('non-message entries advance the durable cursor without fabricating chat messages', () => {
  const restored = reconcileConversationSessionEntries(conversation(), response([{
    entry_id: 'entry-3',
    cursor: 3,
    parent_entry_id: null,
    entry_type: 'compaction',
    occurred_at: 100,
    idempotency_key: 'compaction-1',
    payload: { retained_tail: 20 },
    schema_version: 'hermes.session-entry.v1',
  }], 3));

  assert.deepEqual(restored.messages, []);
  assert.equal(restored.session_entry_cursor, 3);
});
