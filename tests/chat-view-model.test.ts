import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachmentContext,
  conversationHasRunningWork,
  conversationMessagesToView,
  streamEventToActivity,
} from '../src/api/chat-view-model';
import type { SingleConversation } from '../src/api/HermesCloudApi';

function conversation(overrides: Partial<SingleConversation> = {}): SingleConversation {
  return {
    id: 'conversation-1',
    messages: [],
    profile: 'default',
    title: '云端会话',
    ...overrides,
  };
}

test('cloud conversation messages preserve worker, reviewer, reporter, and activities', () => {
  const messages = conversationMessagesToView(conversation({
    messages: [
      {
        content: '内部路由信息',
        id: 'route',
        kind: 'route',
        name: '简单任务',
        role: 'system',
      },
      {
        content: '执行完成',
        id: 'worker',
        meta: {
          activities: [{
            category: 'command',
            duration_ms: 420,
            id: 'tool-1',
            input: 'git status',
            name: 'terminal',
            output: 'clean',
            status: 'completed',
          }],
          role_stage: 'worker',
        },
        name: 'dbb3-worker',
        role: 'assistant',
      },
      {
        content: '验收通过',
        id: 'reviewer',
        meta: { role_stage: 'reviewer' },
        name: 'reviewer',
        role: 'assistant',
      },
      {
        content: '最终结果',
        id: 'reporter',
        meta: { role_stage: 'reporter' },
        name: 'default',
        role: 'assistant',
      },
    ],
  }));

  assert.deepEqual(messages.map(({ id, roleStage }) => [id, roleStage]), [
    ['worker', 'worker'],
    ['reviewer', 'reviewer'],
    ['reporter', 'reporter'],
  ]);
  assert.equal(messages[0].activities?.[0].input, 'git status');
  assert.equal(messages[0].activities?.[0].duration, '420 ms');
});

test('running state is derived from durable server runs, not client timers', () => {
  assert.equal(conversationHasRunningWork(conversation({
    hosted_turns: { turn: { status: 'running' } },
  })), true);
  assert.equal(conversationHasRunningWork(conversation({
    hosted_turns: { turn: { status: 'completed' } },
    runtime_runs: { default: { status: 'completed' } },
  })), false);
});

test('attachments and stream events remain structured for the native chat UI', () => {
  assert.equal(
    attachmentContext([{ name: 'report.pdf', path: '/uploads/report.pdf' }]),
    '用户为本轮上传的附件：\n- report.pdf: /uploads/report.pdf',
  );
  assert.deepEqual(
    streamEventToActivity('tool.end', {
      duration_ms: 1200,
      name: 'read_file',
      output: 'done',
      tool_id: 'tool-1',
    }),
    {
      category: 'file',
      duration: '1.2 s',
      id: 'tool-1',
      input: undefined,
      name: 'read_file',
      output: 'done',
      preview: 'read_file',
      status: 'completed',
    },
  );
});
