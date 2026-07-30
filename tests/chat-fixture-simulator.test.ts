import assert from 'node:assert/strict';
import test from 'node:test';

import {
  previewConversationHistory,
  previewNeedsCollaboration,
  previewTurnMessages,
} from '../src/preview/chat-fixture-simulator';

test('frontend fixture history keeps complete resumable transcripts', () => {
  const accountGeneration = 'acctgen_frontend_preview';
  const conversations = previewConversationHistory(true, accountGeneration);
  assert.equal(conversations.length, 4);
  assert.ok(conversations.every((conversation) => (
    conversation.messages.length === conversation.message_count
    && conversation.messages.length >= 4
    && conversation.account_generation === accountGeneration
  )));
  assert.deepEqual(
    conversations[0]?.messages.map(({ role }) => role),
    ['user', 'assistant', 'user', 'assistant'],
  );
});

test('frontend fixture keeps greetings on a single Hermes turn', () => {
  assert.equal(previewNeedsCollaboration('你好', 0), false);
  const messages = previewTurnMessages({
    collaborative: false,
    isChinese: true,
    startedAt: 1_000,
    turnId: 'turn-simple',
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.roleStage, 'chat');
  assert.equal(messages[0]?.avatarRole, 'hermes');
});

test('frontend fixture lifts multi-stage work into the Studio collaboration roles', () => {
  assert.equal(
    previewNeedsCollaboration('分析仓库并完成修复、测试、审查和发布报告', 0),
    true,
  );
  const messages = previewTurnMessages({
    collaborative: true,
    isChinese: true,
    startedAt: 2_000,
    turnId: 'turn-work',
  });
  // Upserted playback: unique message ids in first-appearance order describe
  // the full team scenario (plan → parallel workers → rejection → rework →
  // re-review → handoff → final report).
  const finalById = new Map(messages.map((message) => [message.id, message]));
  const stages = [...finalById.values()];
  assert.deepEqual(
    stages.map(({ memberId }) => memberId),
    [
      'dbb3-manager',
      'dbb3-worker',
      'pc-worker',
      'reviewer',
      'dbb3-worker',
      'pc-worker',
      'reviewer',
      'dbb3-manager',
      'default',
    ],
  );
  assert.deepEqual(
    stages.map(({ avatarRole }) => avatarRole),
    [
      'dispatcher',
      'dbb3-worker',
      'pc-worker',
      'reviewer',
      'dbb3-worker',
      'pc-worker',
      'reviewer',
      'dispatcher',
      'reporter',
    ],
  );
  // Each member keeps a distinct sender header instead of a generic Hermes.
  assert.deepEqual(
    [...new Set(stages.map(({ name }) => name))],
    ['Hermes 调度员', 'DBB3 执行员', 'PC/WSL 执行员', 'Hermes 审阅员', 'Hermes 汇报员'],
  );
  // The reviewer rejects once and both workers run a visible rework round.
  assert.deepEqual(
    stages
      .map(({ rawRoleStage }) => rawRoleStage)
      .filter((stage) => /rework/.test(stage || '')),
    [
      'reviewer:rework-request:1',
      'worker:dbb3-worker:rework:1',
      'worker:pc-worker:rework:1',
      'reviewer:rework:1',
    ],
  );
  // Live states stream through running snapshots before terminal upserts.
  assert.ok(messages.some(({ roleStage, status }) => roleStage === 'worker' && status === 'running'));
  assert.equal(messages.filter(({ status }) => status === 'running').length, 8);
  assert.ok(stages.every(({ status }) => status === 'completed'));
});
