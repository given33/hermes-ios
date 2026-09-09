import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HermesChatViewMessage as Message } from '../src/api/chat-view-types';
import { compactChatMessages, latestMemberMessages } from '../src/studio/chat/chat-member-model';

const message = (id: string, overrides: Partial<Message> = {}): Message => ({
  id, name: 'worker', role: 'assistant', roleStage: 'worker', profile: 'pc-worker',
  runtimeTurnId: 'turn-2', content: id, status: 'completed', ...overrides,
});

test('member counts use current turn and one identity across ten progress messages', () => {
  const history = [message('old', { runtimeTurnId: 'turn-1', profile: 'hk-worker' }),
    message('user', { role: 'user' }),
    ...Array.from({ length: 10 }, (_, i) => message(`progress-${i}`))];
  assert.equal(latestMemberMessages(history).length, 1);
  assert.equal(latestMemberMessages(history)[0].id, 'progress-9');
});

test('stream snapshots consolidate per member while preserving final response and member todos', () => {
  const rows = compactChatMessages([
    message('user', { role: 'user', content: 'Task' }),
    message('user-echo', { role: 'user', content: 'Task' }),
    message('opening', { status: 'streaming' }),
    message('other', { profile: 'dbb3-worker', todos: [{ id: 'b', title: 'B', status: 'pending' }] }),
    message('complete', { todos: [{ id: 'a', title: 'A', status: 'completed' }] }),
    message('final', { profile: 'default', roleStage: 'reporter', finalReport: true, content: 'Final answer' }),
  ]);
  assert.equal(rows.length, 4);
  assert.equal(rows[1].content, 'complete');
  assert.equal(rows[1].todos?.[0].id, 'a');
  assert.equal(rows[2].todos?.[0].id, 'b');
  assert.equal(rows[3].content, 'Final answer');
  assert.equal(rows[3].finalReport, true);
});

test('separate turns and members retain their own messages', () => {
  assert.equal(compactChatMessages([
    message('one', { runtimeTurnId: 'a', memberId: 'a' }),
    message('two', { runtimeTurnId: 'a', memberId: 'b' }),
    message('three', { runtimeTurnId: 'b', memberId: 'a' }),
  ]).length, 3);
});

test('late user echoes move before the first reply without reordering other rows', () => {
  const rows = [message('reply-a', { runtimeTurnId: 'a' }),
    message('reply-b', { runtimeTurnId: 'b' }),
    message('user-b', { role: 'user', runtimeTurnId: 'b' }),
    message('user-a', { role: 'user', runtimeTurnId: 'a' }),
    message('no-turn', { runtimeTurnId: undefined })];
  assert.deepEqual(compactChatMessages(rows).map(row => row.id),
    ['user-a', 'reply-a', 'user-b', 'reply-b', 'no-turn']);
  assert.equal(rows[0].id, 'reply-a');
});
