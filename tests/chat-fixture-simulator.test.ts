import assert from 'node:assert/strict';
import test from 'node:test';

import {
  previewConversationHistory,
  previewNeedsCollaboration,
  previewTurnMessages,
} from '../src/preview/chat-fixture-simulator';

test('frontend fixture history keeps complete resumable transcripts', () => {
  const conversations = previewConversationHistory(true);
  assert.equal(conversations.length, 4);
  assert.ok(conversations.every((conversation) => (
    conversation.messages.length === conversation.message_count
    && conversation.messages.length >= 4
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
  assert.deepEqual(
    messages.map(({ roleStage }) => roleStage),
    ['dispatcher', 'worker', 'reviewer', 'reporter'],
  );
  assert.deepEqual(
    messages.map(({ avatarRole }) => avatarRole),
    ['dispatcher', 'dbb3-worker', 'reviewer', 'reporter'],
  );
});
