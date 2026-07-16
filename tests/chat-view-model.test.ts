import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachmentContext,
  chatModelConfigurationError,
  conversationHasRunningWork,
  conversationMessagesToView,
  shouldRenderPendingMessage,
  streamEventToActivity,
  upsertChatMessage,
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
  const restored = conversationMessagesToView(conversation({
    messages: [{
      content: '查看附件',
      id: 'attachment-message',
      name: 'user',
      role: 'user',
      meta: {
        attachments: [{
          id: 'uploads:report.pdf',
          name: 'report.pdf',
          mime_type: 'application/pdf',
          size: 2048,
          download_url: '/api/plugins/collaboration/single/conversations/chat-1/attachments/uploads/report.pdf',
        }],
      },
    }],
  }));
  assert.deepEqual(restored[0].attachments, [{
    downloadUrl: '/api/plugins/collaboration/single/conversations/chat-1/attachments/uploads/report.pdf',
    id: 'uploads:report.pdf',
    mimeType: 'application/pdf',
    name: 'report.pdf',
    size: 2048,
  }]);
});

test('missing model credentials produce one terminal error without a second pending assistant', () => {
  assert.match(
    chatModelConfigurationError({ info: { model: '', provider: '' }, options: {} }) ?? '',
    /尚未配置可用模型/,
  );
  assert.match(
    chatModelConfigurationError({
      info: { model: 'glm-5', provider: 'custom' },
      options: {
        model: 'glm-5',
        provider: 'custom',
        providers: [{ authenticated: false, models: ['glm-5'], slug: 'custom' }],
      },
    }) ?? '',
    /没有可用的连接凭据/,
  );
  assert.equal(chatModelConfigurationError({
    info: { model: 'glm-5', provider: 'custom' },
    options: {
      providers: [{ authenticated: true, models: ['glm-5'], slug: 'custom' }],
    },
  }), null);

  const user = {
    content: '你好',
    id: 'user-1',
    name: '你',
    role: 'user' as const,
  };
  assert.equal(shouldRenderPendingMessage([user], true), true);
  const assistant = {
    content: '',
    id: 'stream-1',
    name: 'Hermes Agent',
    role: 'assistant' as const,
  };
  const withPlaceholder = upsertChatMessage([user], assistant);
  assert.equal(shouldRenderPendingMessage(withPlaceholder, true), false);
  const failed = upsertChatMessage(withPlaceholder, {
    ...assistant,
    content: '模型配置错误',
  });
  assert.equal(failed.length, 2);
  assert.equal(failed[1].content, '模型配置错误');
});

test('conversation history deduplicates repeated server message ids', () => {
  const shared = {
    content: '',
    id: 'assistant-shared',
    name: 'default',
    role: 'assistant',
  };
  const messages = conversationMessagesToView(conversation({
    messages: [shared, { ...shared, content: '只显示一次' }],
  }));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, '只显示一次');
});
