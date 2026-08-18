import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesChatViewMessage } from '../src/api/chat-view-types';
import { mergeLiveMessagesIntoSnapshot } from '../src/studio/chat/chat-domain';

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
