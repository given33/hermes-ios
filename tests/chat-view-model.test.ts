import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityCategoryLabel,
  attachmentContext,
  avatarRoleFor,
  chatModelConfigurationError,
  conversationCollaborationState,
  conversationHasRunningWork,
  conversationHostedTurnState,
  conversationMessagesToView,
  conversationRunningHostedTurnId,
  formatActivitySummary,
  formatMessageLocalTime,
  messageDurationMs,
  messageStatusLabel,
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
  assert.deepEqual(messages.map(({ avatarRole }) => avatarRole), [
    'dbb3-worker',
    'reviewer',
    'reporter',
  ]);
});

test('Hermes manager planning and handoff remain identifiable after cloud restore', () => {
  const messages = conversationMessagesToView(conversation({
    messages: [{
      content: 'Structured plan',
      id: 'manager-plan',
      kind: 'message',
      meta: {
        profile: 'dbb3-manager',
        role_stage: 'manager_planning',
      },
      name: 'dbb3-manager',
      role: 'assistant',
      status: 'completed',
    }],
  }), true);

  assert.equal(messages[0].name, 'Hermes 调度员');
  assert.equal(messages[0].roleStage, 'dispatcher');
  assert.equal(messages[0].avatarRole, 'dispatcher');
});

test('collaboration lift state follows persisted route and workflow progress', () => {
  assert.equal(conversationCollaborationState(conversation()), 'single');
  assert.equal(conversationCollaborationState(conversation({
    hosted_turns: {
      'turn-work': {
        mode: 'work',
        stage: 'accepted',
        status: 'queued',
      },
    },
  })), 'lifting');
  assert.equal(conversationCollaborationState(conversation({
    hosted_turns: {
      'turn-work': {
        mode: 'work',
        stage: 'manager_planning',
        status: 'running',
      },
    },
  })), 'active');
  assert.equal(conversationCollaborationState(conversation({
    messages: [{
      content: '正在审阅',
      id: 'reviewer-progress',
      meta: { role_stage: 'reviewer.progress' },
      name: 'reviewer',
      role: 'assistant',
      status: 'running',
    }],
  })), 'active');
});

test('model replies survive legacy snapshots that keep the answer in metadata', () => {
  const [message] = conversationMessagesToView(conversation({
    messages: [{
      content: '',
      id: 'legacy-answer',
      meta: {
        final_report: { text: '模型最终回复已恢复。' },
        role_stage: 'chat',
      },
      name: 'default',
      role: 'assistant',
      status: 'completed',
    }],
  }));

  assert.equal(message.content, '模型最终回复已恢复。');
});

test('non-text legacy metadata never becomes a visible model reply', () => {
  const [message] = conversationMessagesToView(conversation({
    messages: [{
      content: '',
      id: 'metadata-flags-only',
      meta: { final_report: false, reply: 0 },
      name: 'Hermes',
      role: 'assistant',
    }],
  }));

  assert.equal(message.content, '');
});

test('todo snapshots are projected onto chat messages with legacy labels normalized', () => {
  const [message] = conversationMessagesToView(conversation({
    messages: [{
      activities: [{
        id: 'todo-activity',
        name: 'todo.update',
        output: JSON.stringify({
          todos: [
            { id: 'done', title: '已完成步骤', status: 'done' },
            { id: 'running', text: '当前步骤', status: 'in-progress' },
          ],
        }),
        status: 'completed',
      }],
      content: '',
      id: 'todo-message',
      name: 'default',
      role: 'assistant',
      status: 'completed',
    }],
  }));

  assert.deepEqual(message.todos, [
    { id: 'done', title: '已完成步骤', status: 'completed' },
    { id: 'running', title: '当前步骤', status: 'in_progress' },
  ]);
});

test('context usage accepts metadata values for the compact composer control', () => {
  const [message] = conversationMessagesToView(conversation({
    messages: [{
      content: '回复',
      id: 'context-message',
      meta: { context_percent: '87' },
      name: 'default',
      role: 'assistant',
      status: 'completed',
    }],
  }));

  assert.equal(message.contextUsedPercent, 87);
});

test('a lone failed workflow role stays in ordinary chat instead of lifting a group', () => {
  const failed = conversation({
    messages: [{
      content: "No module named 'agent.runtime_provider'",
      id: 'reporter-failure',
      meta: { role_stage: 'reporter' },
      name: 'reporter',
      role: 'assistant',
      status: 'failed',
    }],
  });

  assert.equal(conversationCollaborationState(failed), 'single');
  const [message] = conversationMessagesToView(failed, true);
  assert.equal(message.name, 'Hermes Agent');
  assert.equal(message.roleStage, 'chat');
  assert.equal(message.avatarRole, 'hermes');
  assert.equal(message.roleLabel, '运行失败');
});

test('completed workflow history does not keep later ordinary turns in group chat', () => {
  const completedRoles = ['manager', 'worker', 'reviewer', 'reporter'].map((role) => ({
    content: `${role} complete`,
    id: `${role}-complete`,
    meta: { role_stage: role },
    name: role,
    role: 'assistant' as const,
    status: 'completed',
  }));

  assert.equal(conversationCollaborationState(conversation({
    messages: completedRoles,
  })), 'single');
  assert.equal(conversationCollaborationState(conversation({
    messages: completedRoles.map(({ status: _status, ...message }) => message),
  })), 'single');
});

test('legacy hosted wrapper errors are presented as ordinary chat failures', () => {
  const [message] = conversationMessagesToView(conversation({
    messages: [{
      content: "服务端托管任务失败：No module named 'agent.runtime_provider'",
      id: 'legacy-hosted-wrapper-failure',
      meta: { role_stage: 'reporter' },
      name: 'default',
      role: 'assistant',
      status: 'failed',
    }],
  }), true);

  assert.equal(message.roleStage, 'chat');
  assert.equal(message.name, 'Hermes Agent');
  assert.equal(message.content, "对话运行失败：No module named 'agent.runtime_provider'");
  assert.doesNotMatch(message.content, /托管/);
});

test('ordinary chat waiting phases only start elapsed time after the first token', () => {
  const now = 1_800_000_000_000;
  const statusMessage = (output: string, firstTokenAt = 0) => conversationMessagesToView(conversation({
    messages: [{
      content: firstTokenAt ? '首个 token' : '',
      created_at: now - 4_000,
      id: `chat-status-${output}`,
      meta: {
        activities: [{
          id: `status-${output}`,
          name: '运行状态',
          output,
          started_at: now - 2_000,
          status: 'completed',
        }],
        first_token_at: firstTokenAt,
        role_stage: 'chat',
      },
      name: 'default',
      role: 'assistant',
      status: 'running',
      updated_at: now,
    }],
  }), true, now)[0];

  const reconnecting = statusMessage('正在重连 (2/5)');
  assert.equal(reconnecting.timingLabel, '正在重新连接 (2/5)');

  const thinkingWithoutToken = statusMessage('正在思考');
  assert.equal(thinkingWithoutToken.timingLabel, undefined);
  assert.equal(thinkingWithoutToken.startedAt, undefined);

  const firstTokenAt = now - 1_250;
  const thinkingWithToken = statusMessage('正在思考', firstTokenAt);
  assert.equal(thinkingWithToken.timingLabel, '正在回复');
  assert.equal(thinkingWithToken.startedAt, firstTokenAt);

  const [reasoningWithToken] = conversationMessagesToView(conversation({
    messages: [{
      content: '',
      created_at: now - 4_000,
      id: 'chat-reasoning-token',
      meta: {
        activities: [{
          category: 'reasoning',
          id: 'reasoning-1',
          name: '模型思考',
          output: '正在核对日期来源。',
          started_at: firstTokenAt,
          status: 'running',
        }],
        first_token_at: firstTokenAt,
        role_stage: 'chat',
      },
      name: 'default',
      role: 'assistant',
      status: 'running',
      updated_at: now,
    }],
  }), true, now);
  assert.equal(reasoningWithToken.timingLabel, '正在思考');
  assert.equal(reasoningWithToken.startedAt, firstTokenAt);
});

test('server user echoes from one runtime turn collapse to one bubble', () => {
  const messages = conversationMessagesToView(conversation({
    messages: [
      {
        content: '你好',
        created_at: 10_000,
        id: 'server-user-a',
        meta: { runtime_turn_id: 'turn-one' },
        name: 'You',
        role: 'user',
        status: 'completed',
      },
      {
        content: '你好',
        created_at: 20_000,
        id: 'server-user-b',
        meta: { runtime_turn_id: 'turn-one' },
        name: 'You',
        role: 'user',
        status: 'completed',
      },
    ],
  }), true);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'server-user-b');
});

test('snapshot and journal user echoes collapse when runtime ids differ', () => {
  const messages = conversationMessagesToView(conversation({
    messages: [
      {
        content: '你好',
        created_at: 10_000,
        id: 'snapshot-user',
        meta: { runtime_turn_id: 'turn-snapshot' },
        name: 'You',
        role: 'user',
        status: 'completed',
      },
      {
        content: '你好',
        created_at: 10_000,
        id: 'journal-user',
        meta: { runtime_turn_id: 'turn-journal' },
        name: 'You',
        role: 'user',
        status: 'completed',
      },
    ],
  }), true);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'journal-user');
});

test('identical user text in distinct runtime turns remains distinct', () => {
  const messages = conversationMessagesToView(conversation({
    messages: [
      {
        content: '你好',
        created_at: 10_000,
        id: 'server-user-a',
        meta: { runtime_turn_id: 'turn-one' },
        name: 'You',
        role: 'user',
        status: 'completed',
      },
      {
        content: '你好',
        created_at: 20_000,
        id: 'server-user-b',
        meta: { runtime_turn_id: 'turn-two' },
        name: 'You',
        role: 'user',
        status: 'completed',
      },
    ],
  }), true);

  assert.equal(messages.length, 2);
});

test('connection retry state is recognized when the backend stores it in the activity name', () => {
  const now = 1_800_000_000_000;
  const [message] = conversationMessagesToView(conversation({
    messages: [{
      content: '',
      id: 'chat-retry-name',
      meta: {
        activities: [{
          id: 'model-connection-retry',
          name: '正在重新连接 (3/5)',
          output: '',
          started_at: now - 1_000,
          status: 'running',
        }],
        role_stage: 'chat',
      },
      name: 'default',
      role: 'assistant',
      status: 'running',
      updated_at: now,
    }],
  }), true, now);

  assert.equal(message.timingLabel, '正在重新连接 (3/5)');
  assert.equal(message.startedAt, now - 1_000);
});

test('server workflow metadata restores sender, runtime, timestamps, handoff, and full activities', () => {
  const startedAt = new Date(2026, 6, 16, 9, 5, 0).getTime();
  const completedAt = startedAt + 132_000;
  const [message] = conversationMessagesToView(conversation({
    messages: [{
      activities: [{
        completed_at: startedAt + 32_000,
        duration: 32,
        input_text: 'Hermes hosted turn API',
        kind: 'search',
        label: '搜索 Hermes 托管接口',
        metadata: { source_count: 3 },
        model: 'gpt-5.6',
        output_text: '已查询 3 个来源并保留完整详情',
        provider: 'openai',
        seq: 1,
        started_at: startedAt,
        status: 'completed',
        tool_name: 'web_search',
      }],
      completed_at: completedAt,
      content: '## 阶段结果\n\n搜索和文件检查均已完成。',
      created_at: startedAt,
      handoff_to: ['reviewer', 'reporter'],
      id: 'worker-rich',
      model: 'claude-sonnet-4',
      name: 'dbb3-worker',
      profile: 'dbb3-worker',
      provider: 'anthropic',
      role: 'worker',
      role_label: 'DBB3 · 执行',
      sender_id: 'profile:dbb3-worker',
      sender: 'DBB3 执行员',
      started_at: startedAt,
      status: 'completed',
      updated_at: completedAt,
      meta: {
        file_events: [{
          command: 'apply_patch PATCH',
          completed_at: completedAt,
          detail: { path: 'src/app.ts', result: 'updated' },
          id: 'file-1',
          kind: 'file',
          name: 'write_file',
          started_at: completedAt - 30_000,
          status: 'completed',
        }],
      },
    }],
  }));

  assert.equal(message.name, 'DBB3 执行员');
  assert.equal(message.profile, 'dbb3-worker');
  assert.equal(message.senderId, 'profile:dbb3-worker');
  assert.equal(message.avatarRole, 'dbb3-worker');
  assert.equal(message.roleStage, 'worker');
  assert.equal(message.roleLabel, 'DBB3 · 执行');
  assert.equal(message.model, 'anthropic · claude-sonnet-4');
  assert.equal(message.provider, 'anthropic');
  assert.equal(message.handoffTarget, 'reviewer、reporter');
  assert.equal(message.createdAt, startedAt);
  assert.equal(message.updatedAt, completedAt);
  assert.equal(message.durationMs, 132_000);
  assert.equal(formatActivitySummary(message, true, completedAt), '已处理 2m 12s');
  assert.equal(formatMessageLocalTime(startedAt, true, startedAt), '09:05');
  assert.equal(messageStatusLabel(message.status, true), '已完成');
  assert.deepEqual(message.activities?.map(({ category }) => category), ['search', 'file']);
  assert.equal(message.activities?.[0].name, '搜索 Hermes 托管接口');
  assert.equal(message.activities?.[0].toolName, 'web_search');
  assert.equal(message.activities?.[0].durationMs, 32_000);
  assert.match(message.activities?.[0].detail ?? '', /source_count/);
  assert.equal(message.activities?.[0].input, 'Hermes hosted turn API');
  assert.equal(message.activities?.[0].output, '已查询 3 个来源并保留完整详情');
  assert.match(message.activities?.[1].detail ?? '', /src\/app\.ts/);
});

test('role avatars and activity labels distinguish every workflow participant', () => {
  assert.equal(avatarRoleFor('default', 'dispatcher'), 'dispatcher');
  assert.equal(avatarRoleFor('dbb3-worker', 'worker'), 'dbb3-worker');
  assert.equal(avatarRoleFor('pc-wsl-worker', 'worker'), 'pc-worker');
  assert.equal(avatarRoleFor('reviewer', 'reviewer'), 'reviewer');
  assert.equal(avatarRoleFor('default', 'reporter'), 'reporter');
  assert.equal(avatarRoleFor('supervisor', 'supervisor'), 'supervisor');
  assert.equal(activityCategoryLabel('reasoning', true), '思考');
  assert.equal(activityCategoryLabel('browser', true), '搜索');
  assert.equal(activityCategoryLabel('mcp', false), 'MCP');
});

test('top-level sender_role wins over canonical transport role and phase suffixes', () => {
  const [message, chat] = conversationMessagesToView(conversation({
    messages: [
      {
        collaboration_role: 'dispatcher',
        content: '本阶段已完成。',
        id: 'phase-message',
        meta: { role_stage: 'worker.progress' },
        name: 'pc-worker',
        profile: 'pc-worker',
        role: 'assistant',
        sender_role: 'worker',
        status: 'completed',
      },
      {
        content: '简单聊天回复。',
        id: 'hosted-chat-message',
        name: 'default',
        profile: 'default',
        role: 'assistant',
        sender_role: 'hermes',
        status: 'completed',
      },
    ],
  }));

  assert.equal(message.roleStage, 'worker');
  assert.equal(message.avatarRole, 'pc-worker');
  assert.equal(message.profile, 'pc-worker');
  assert.equal(chat.roleStage, 'chat');
  assert.equal(chat.avatarRole, 'hermes');
});

test('running state is derived from durable server runs, not client timers', () => {
  const now = 1_800_000_000_000;
  assert.equal(conversationHasRunningWork(conversation({
    hosted_turns: { turn: { status: 'running', updated_at: now - 30_000 } },
  }), now), true);
  assert.equal(conversationHasRunningWork(conversation({
    hosted_turns: { turn: { status: 'completed' } },
    runtime_runs: { default: { status: 'completed' } },
  }), now), false);
  assert.equal(conversationRunningHostedTurnId(conversation({
    hosted_turns: {
      completed: { status: 'completed', updated_at: now - 10_000 },
      older: { status: 'running', turn_id: 'turn-older', updated_at: now - 30_000 },
      newest: { status: 'queued', turn_id: 'turn-newest', updated_at: now - 5_000 },
    },
  }), now), 'turn-newest');
  assert.equal(conversationRunningHostedTurnId(conversation({
    hosted_turns: { completed: { status: 'cancelled' } },
  }), now), '');
  const optimistic = conversation({
    hosted_turns: {
      active: { status: 'running', turn_id: 'turn-active', updated_at: now - 1_000 },
      done: { status: 'completed', turn_id: 'turn-done' },
    },
  });
  assert.equal(conversationHostedTurnState(optimistic, 'turn-active', now), 'running');
  assert.equal(conversationHostedTurnState(optimistic, 'turn-done', now), 'terminal');
  assert.equal(conversationHostedTurnState(optimistic, 'turn-not-visible-yet', now), 'missing');
});

test('terminal chat message stops a stale running hosted record immediately', () => {
  const now = 1_800_000_000_000;
  const staleRun = conversation({
    hosted_turns: {
      turn: {
        status: 'running',
        turn_id: 'turn-failed',
        updated_at: now - 10_000,
      },
    },
    messages: [{
      content: '模型服务拒绝了 API 密钥（HTTP 401）。',
      id: 'failed-message',
      meta: {
        message_key: 'turn-failed:chat:completed',
        role_stage: 'chat',
      },
      name: 'Hermes',
      role: 'assistant',
      status: 'failed',
    }],
  });

  assert.equal(conversationHasRunningWork(staleRun, now), false);
  assert.equal(conversationRunningHostedTurnId(staleRun, now), '');
  assert.equal(conversationHostedTurnState(staleRun, 'turn-failed', now), 'terminal');
});

test('a completed route event does not terminate its still-running hosted turn', () => {
  const now = 1_800_000_000_000;
  const pending = conversation({
    hosted_turns: {
      turn: {
        status: 'running',
        turn_id: 'turn-new',
        updated_at: now - 1_000,
      },
    },
    messages: [{
      content: 'chat route selected',
      id: 'turn-new:route',
      kind: 'route',
      meta: { runtime_turn_id: 'turn-new' },
      name: 'Hermes',
      role: 'system',
      status: 'completed',
    }],
  });

  assert.equal(conversationHasRunningWork(pending, now), true);
  assert.equal(conversationHostedTurnState(pending, 'turn-new', now), 'running');
});

test('hosted terminal state closes stale message activities and duration', () => {
  const now = 1_800_000_000_000;
  const [message] = conversationMessagesToView(conversation({
    hosted_turns: {
      failed: {
        completed_at: now - 1_000,
        status: 'failed',
        turn_id: 'turn-empty-stream',
        updated_at: now - 1_000,
      },
    },
    messages: [{
      activities: [{
        id: 'provider-call',
        kind: 'model',
        started_at: now - 30_000,
        status: 'running',
      }],
      content: 'API call failed after 5 retries: empty stream',
      created_at: now - 30_000,
      id: 'empty-stream-failure',
      meta: { runtime_turn_id: 'turn-empty-stream' },
      name: 'Hermes',
      role: 'assistant',
      status: 'failed',
      updated_at: now - 1_000,
    }],
  }), true, now);

  assert.equal(message.status, 'failed');
  assert.equal(message.activities?.[0].status, 'failed');
  assert.match(formatActivitySummary(message, true, now), /^已处理 /);
  assert.equal(messageDurationMs(message, now + 60_000), 29_000);
});

test('ordinary model replies expose total duration without tool activities', () => {
  const now = 1_800_000_000_000;
  const [message] = conversationMessagesToView(conversation({
    messages: [{
      content: '你好，我在。',
      created_at: now - 2_500,
      id: 'chat-reply',
      name: 'Hermes',
      role: 'assistant',
      status: 'completed',
      updated_at: now,
    }],
  }), true, now);

  assert.equal(message.activities?.length || 0, 0);
  assert.equal(messageDurationMs(message, now), 2_500);
  assert.match(formatActivitySummary(message, true, now), /^已处理 0m 2s$/);
});

test('abandoned durable runs never keep fresh installs spinning indefinitely', () => {
  const now = 1_800_000_000_000;
  const stale = conversation({
    hosted_turns: {
      old: {
        status: 'running',
        turn_id: 'turn-old',
        updated_at: now - 61 * 60 * 60 * 1_000,
      },
      timestampMissing: { status: 'running', turn_id: 'turn-unknown' },
    },
    runtime_runs: {
      reviewer: { status: 'running', updated_at: now - 31 * 60 * 1_000 },
    },
  });

  assert.equal(conversationHasRunningWork(stale, now), false);
  assert.equal(conversationRunningHostedTurnId(stale, now), '');
  assert.equal(conversationHostedTurnState(stale, 'turn-old', now), 'terminal');
  assert.equal(conversationHostedTurnState(stale, 'turn-unknown', now), 'terminal');
});

test('runtime and hosted freshness follow their distinct server recovery windows', () => {
  const now = 1_800_000_000_000;
  assert.equal(conversationHasRunningWork(conversation({
    runtime_runs: {
      worker: { status: 'running', updated_at: now - 29 * 60 * 1_000 },
    },
  }), now), true);
  assert.equal(conversationHasRunningWork(conversation({
    runtime_runs: {
      worker: { status: 'running', updated_at: now - 31 * 60 * 1_000 },
    },
  }), now), false);
  assert.equal(conversationHasRunningWork(conversation({
    hosted_turns: {
      worker: { status: 'running', updated_at: now - 35 * 60 * 60 * 1_000 },
    },
  }), now), true);
  assert.equal(conversationHasRunningWork(conversation({
    hosted_turns: {
      worker: { status: 'running', updated_at: now - 37 * 60 * 60 * 1_000 },
    },
  }), now), false);
});

test('a quiet 35-hour hosted worker message remains active', () => {
  const now = 1_800_000_000_000;
  const updatedAt = now - 35 * 60 * 60 * 1_000;
  const [message] = conversationMessagesToView(conversation({
    messages: [{
      content: 'long hosted task',
      created_at: updatedAt,
      id: 'hosted-long',
      meta: { runtime_turn_id: 'turn-long' },
      name: 'pc-worker',
      role: 'assistant',
      sender_role: 'worker',
      status: 'running',
      updated_at: updatedAt,
    }],
  }), true, now);

  assert.equal(message.status, 'running');
});

test('abandoned worker and reviewer messages stop their duration animations', () => {
  const now = 1_800_000_000_000;
  const startedAt = now - 61 * 60 * 60 * 1_000;
  const messages = conversationMessagesToView(conversation({
    messages: [{
      activities: [{
        id: 'remote-worker',
        kind: 'status',
        started_at: startedAt,
        status: 'running',
      }],
      content: 'Connected to remote worker',
      created_at: startedAt,
      id: 'worker-stale',
      name: 'pc-worker',
      role: 'assistant',
      sender_role: 'worker',
      started_at: startedAt,
      status: 'running',
      updated_at: startedAt + 30_000,
    }],
  }), true, now);

  assert.equal(messages[0].status, 'failed');
  assert.equal(messages[0].activities?.[0].status, 'failed');
  assert.doesNotMatch(formatActivitySummary(messages[0], true, now), /3663m/);
});

test('attachments and stream events remain structured for the native chat UI', () => {
  assert.equal(
    attachmentContext([{ name: 'report.pdf', path: '/uploads/report.pdf' }]),
    '用户为本轮上传的附件：\n- report.pdf: /uploads/report.pdf',
  );
  const streamActivity = streamEventToActivity('tool.end', {
      duration_ms: 1200,
      name: 'read_file',
      output: 'done',
      tool_id: 'tool-1',
    });
  assert.equal(streamActivity?.category, 'file');
  assert.equal(streamActivity?.duration, '1.2 s');
  assert.equal(streamActivity?.durationMs, 1200);
  assert.equal(streamActivity?.id, 'tool-1');
  assert.equal(streamActivity?.name, 'read_file');
  assert.equal(streamActivity?.output, 'done');
  assert.equal(streamActivity?.status, 'completed');
  assert.equal(streamActivity?.toolName, 'read_file');
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
      custom: {
        apiKeyConfigured: false,
        baseUrl: 'https://models.example/v1',
        model: 'glm-5',
      },
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
    custom: {
      apiKeyConfigured: true,
      baseUrl: 'https://models.example/v1',
      model: 'glm-5',
    },
    info: { model: 'glm-5', provider: 'custom' },
    options: {
      providers: [{ authenticated: true, models: ['glm-5'], slug: 'custom' }],
    },
  }), null);
  assert.equal(chatModelConfigurationError({
    custom: {
      apiKeyConfigured: false,
      baseUrl: '',
      model: 'hermes-4',
    },
    info: { model: 'hermes-4', provider: 'nous' },
    options: {
      model: 'hermes-4',
      provider: 'nous',
      providers: [{ authenticated: true, models: ['hermes-4'], slug: 'nous' }],
    },
  }), null);
  assert.equal(chatModelConfigurationError({
    custom: {
      apiKeyConfigured: false,
      baseUrl: '',
      model: 'gpt-5.3-codex',
    },
    info: { model: 'gpt-5.3-codex', provider: 'openai-codex' },
    options: {
      model: 'gpt-5.3-codex',
      provider: 'openai-codex',
      providers: [{
        authenticated: true,
        auth_type: 'oauth',
        models: ['gpt-5.3-codex'],
        slug: 'openai-codex',
      }],
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
  const withRuntimePlaceholder = upsertChatMessage([user], {
    ...assistant,
    roleStage: 'chat',
    status: 'running',
  });
  assert.equal(shouldRenderPendingMessage(withRuntimePlaceholder, true), true);
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
