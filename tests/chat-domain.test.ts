import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesChatViewMessage } from '../src/api/chat-view-types';
import { mergeLiveMessagesIntoSnapshot, serverFailure } from '../src/studio/chat/chat-domain';

test('storage quota errors show local recovery copy without exposing storage keys', () => {
  for (const name of ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']) {
    const error = new DOMException('private-account-cache-key'.repeat(100), name);
    assert.match(serverFailure(error, true), /本地存储空间不足/);
    assert.match(serverFailure(error, false), /Local storage is full/);
    assert.doesNotMatch(serverFailure(error, true), /private-account|服务器操作失败/);
    assert.ok(serverFailure(error, false).length < 120);
  }
  assert.match(serverFailure(new Error('Other failure'), false), /Other failure/);
});

function message(
  id: string,
  status: string,
  overrides: Partial<HermesChatViewMessage> = {},
): HermesChatViewMessage {
  return {
    content: 'answer',
    id,
    name: 'Hermes',
    profile: 'default',
    role: 'assistant',
    roleStage: 'chat',
    runtimeTurnId: 'turn-1',
    status,
    ...overrides,
  };
}

test('incomplete snapshots retain user prompts in front of their own replies without duplicating later echoes', () => {
  const prompt = message('local-user', 'completed', { role: 'user', content: 'Question', createdAt: 100 });
  const reply = message('reply', 'running', { createdAt: 200 });
  const next = message('next-user', 'completed', { role: 'user', runtimeTurnId: 'turn-2', createdAt: 300 });
  const merged = mergeLiveMessagesIntoSnapshot([reply], [prompt, reply, next]);
  assert.deepEqual(merged.map(item => item.id), ['local-user', 'reply', 'next-user']);
  const echo = { ...prompt, id: 'server-user' };
  const refreshed = mergeLiveMessagesIntoSnapshot([echo, reply, next], merged);
  assert.deepEqual(refreshed.map(item => item.id), ['server-user', 'reply', 'next-user']);
  assert.equal(refreshed[0].renderKey, 'local-user');
});

test('a shorter final answer replaces an interim report while stage reports survive snapshot merging', () => {
  const report = { id: 'report', content: 'Preparing a longer explanation', createdAt: 100 };
  const live = message('live', 'running', { content: report.content, executionReports: [report] });
  const final = message('final', 'completed', { content: 'Done', executionComplete: true });
  const [merged] = mergeLiveMessagesIntoSnapshot([final], [live]);
  assert.equal(merged.content, 'Done');
  assert.deepEqual(merged.executionReports, [report]);
});

test('snapshot reasoning with a durable id merges with its live pass without duplication', () => {
  const thought = { id: 'live-r', category: 'reasoning', name: 'Thinking', preview: '', duration: '',
    status: 'running' as const, output: 'Read the page', startedAt: 10000 };
  const live = message('live', 'running', { activities: [thought] });
  const persisted = message('stored', 'completed', { activities: [{ ...thought, id: 'reasoning-1', status: 'completed', output: 'Read the page and check sources' }] });
  const [merged] = mergeLiveMessagesIntoSnapshot([persisted], [live]);
  assert.equal(merged.activities?.length, 1);
  assert.equal(merged.activities?.[0].id, 'live-r');
  assert.equal(merged.activities?.[0].output, 'Read the page and check sources');
});

test('a delayed live reply stays in its own turn when a later prompt already exists', () => {
  const a = message('u1', 'completed', { role: 'user' });
  const b = message('u2', 'completed', { role: 'user', runtimeTurnId: 'turn-2' });
  const live = message('live-1', 'running');
  const merged = mergeLiveMessagesIntoSnapshot([a, b], [a, live, b]);
  assert.deepEqual(merged.map(({ id }) => id), ['u1', 'live-1', 'u2']);
  const durable = mergeLiveMessagesIntoSnapshot([a, message('durable-1', 'completed'), b], merged);
  assert.deepEqual(durable.map(({ id }) => id), ['u1', 'durable-1', 'u2']);
  assert.equal(durable[1].renderKey, 'live-1');
});

test('snapshot matches message IDs before phase metadata and never appends the same ID twice', () => {
  const persisted = message('same-id', 'completed', { profile: 'default' });
  const live = message('same-id', 'running', { profile: undefined, roleStage: 'worker' });
  const merged = mergeLiveMessagesIntoSnapshot([persisted], [live]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'same-id');
  assert.equal(merged[0].status, 'completed');
});

test('user echoes cannot merge into an assistant in the same task', () => {
  const persisted = message('reply', 'running');
  const user = message('user', 'completed', { role: 'user', content: 'User task' });
  const merged = mergeLiveMessagesIntoSnapshot([user, persisted], [user]);
  assert.deepEqual(merged.map(({ id, role }) => ({ id, role })), [
    { id: 'user', role: 'user' }, { id: 'reply', role: 'assistant' },
  ]);
});

test('distinct team members in the same phase retain their own streamed text', () => {
  const a = message('server-a', 'running', { memberId: 'a', roleStage: 'worker', content: 'A' });
  const b = message('server-b', 'running', { memberId: 'b', roleStage: 'worker', content: 'B' });
  const merged = mergeLiveMessagesIntoSnapshot([a, b], [
    { ...b, id: 'live-b', content: 'B complete' },
    { ...a, id: 'live-a', content: 'A complete' },
  ]);
  assert.deepEqual(merged.map(({ content }) => content), ['A complete', 'B complete']);
});

test('durable terminal chat state cannot be reopened by an old live message', () => {
  for (const terminalStatus of ['completed', 'failed', 'cancelled']) {
    const persisted = message(`server-${terminalStatus}`, terminalStatus, {
      completedAt: 2_000,
      durationMs: 1_000,
      timingLabel: undefined,
      updatedAt: 2_000,
    });
    const live = message(`live-${terminalStatus}`, 'running', {
      completedAt: undefined,
      durationMs: undefined,
      timingLabel: 'Responding',
      updatedAt: 3_000,
    });

    const [merged] = mergeLiveMessagesIntoSnapshot([persisted], [live]);
    assert.equal(merged.id, persisted.id);
    assert.equal(merged.status, terminalStatus);
    assert.equal(merged.completedAt, 2_000);
    assert.equal(merged.durationMs, 1_000);
    assert.equal(merged.timingLabel, undefined);
    assert.equal(merged.updatedAt, 2_000);
  }
});

test('snapshot merge keeps richer reply and reasoning while retaining live-only cards and files', () => {
  const persisted = message('server-reply', 'completed', {
    completedAt: 2_000,
    content: 'The complete final answer from the server.',
    activities: [{
      category: 'reasoning',
      completedAt: 1_900,
      duration: '900 ms',
      durationMs: 900,
      id: 'reasoning-1',
      name: 'Reasoning',
      output: 'Full durable reasoning with the final verification result.',
      preview: 'Full durable reasoning',
      status: 'completed',
    }],
    attachments: [{
      downloadUrl: '/api/files/report.pdf',
      id: 'server-file',
      name: 'report.pdf',
    }],
  }) as HermesChatViewMessage & { reasoning?: string };
  persisted.reasoning = 'Full durable reasoning text';
  const live = message('live-reply', 'running', {
    content: 'The complete',
    activities: [{
      category: 'reasoning',
      duration: 'running',
      id: 'reasoning-1',
      name: 'Reasoning',
      output: 'Full durable',
      preview: 'Full',
      status: 'running',
    }, {
      category: 'interaction',
      duration: 'waiting',
      id: 'live-choice',
      name: 'Choose',
      preview: 'Select an option',
      status: 'running',
    }],
    attachments: [{
      downloadUrl: 'file:///cache/live.txt',
      id: 'live-file',
      name: 'live.txt',
    }],
  }) as HermesChatViewMessage & { reasoning?: string };
  live.reasoning = 'Full durable';

  const [merged] = mergeLiveMessagesIntoSnapshot([persisted], [live]);
  assert.equal(merged.content, persisted.content);
  assert.equal((merged as HermesChatViewMessage & { reasoning?: string }).reasoning, persisted.reasoning);
  assert.deepEqual(merged.activities?.map(({ id }) => id), ['reasoning-1', 'live-choice']);
  assert.equal(merged.activities?.[0]?.output, persisted.activities?.[0]?.output);
  assert.equal(merged.activities?.[0]?.preview, persisted.activities?.[0]?.preview);
  assert.equal(merged.activities?.[0]?.status, 'completed');
  assert.deepEqual(merged.attachments?.map(({ id }) => id), ['server-file', 'live-file']);
});
