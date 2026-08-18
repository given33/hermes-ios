import assert from 'node:assert/strict';
import test from 'node:test';

import type { HermesChatViewMessage } from '../src/api/chat-view-types';
import { latestChatPlan } from '../src/studio/chat/chat-plan-model';

function message(
  activity: Partial<NonNullable<HermesChatViewMessage['activities']>[number]>,
  createdAt: number,
): HermesChatViewMessage {
  return {
    activities: [{
      category: 'tool',
      duration: '',
      id: `activity-${createdAt}`,
      name: 'todo',
      preview: 'todo',
      status: 'completed',
      ...activity,
    }],
    content: '',
    createdAt,
    id: `message-${createdAt}`,
    name: 'Hermes Agent',
    role: 'assistant',
  };
}

test('latest todo tool result becomes the authoritative chat plan', () => {
  const older = message({
    completedAt: 1_000,
    output: JSON.stringify({
      todos: [{ id: 'inspect', content: '检查代码', status: 'in_progress' }],
    }),
  }, 1_000);
  const newer = message({
    completedAt: 2_000,
    output: JSON.stringify({
      todos: [
        { id: 'inspect', content: '检查代码', status: 'completed' },
        { id: 'patch', content: '修复聊天', status: 'in_progress' },
        { id: 'verify', content: '真机验证', status: 'pending' },
      ],
    }),
  }, 2_000);

  assert.deepEqual(latestChatPlan([older, newer]), {
    completed: 1,
    items: [
      { id: 'inspect', content: '检查代码', status: 'completed' },
      { id: 'patch', content: '修复聊天', status: 'in_progress' },
      { id: 'verify', content: '真机验证', status: 'pending' },
    ],
    total: 3,
    updatedAt: 2_000,
  });
});

test('running todo input is visible before its tool result completes', () => {
  const plan = latestChatPlan([message({
    input: JSON.stringify({
      todos: [{ id: 'one', content: '准备计划', status: 'in_progress' }],
    }),
    name: 'todo',
    startedAt: 3_000,
    status: 'running',
  }, 3_000)]);

  assert.equal(plan?.items[0].content, '准备计划');
  assert.equal(plan?.items[0].status, 'in_progress');
});

test('todo JSON with an appended persistence hint still parses', () => {
  const plan = latestChatPlan([message({
    output: '{"todos":[{"id":"ship","content":"发布","status":"completed"}]}\n\n[Hint: persisted]',
  }, 4_000)]);

  assert.equal(plan?.completed, 1);
  assert.equal(plan?.total, 1);
});

test('todo plans accept title/text fields and normalized status aliases', () => {
  const plan = latestChatPlan([message({
    output: '```json\n{"todos":[{"id":"one","title":"检查发布包","status":"done"},{"id":"two","text":"上传构建","status":"waiting"}]}\n```',
  }, 4_500)]);

  assert.deepEqual(plan?.items, [
    { id: 'one', content: '检查发布包', status: 'completed' },
    { id: 'two', content: '上传构建', status: 'pending' },
  ]);
});

test('non-todo tool activities never create a plan', () => {
  assert.equal(latestChatPlan([message({
    name: 'terminal',
    output: '{"todos":[{"id":"fake","content":"错误计划","status":"pending"}]}',
  }, 5_000)]), null);
});
