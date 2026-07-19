import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  resolve(process.cwd(), 'src/preview/PreviewChatPage.tsx'),
  'utf8',
);

test('workflow activity is collapsed above the avatar row with a compact hairline split', () => {
  const messageStart = source.indexOf('function UnifiedMessage');
  const messageEnd = source.indexOf('function MessageAvatar', messageStart);
  const message = source.slice(messageStart, messageEnd);
  const activity = message.indexOf('<RoleActivityGroup');
  const avatarRow = message.indexOf('<View style={[styles.messageRow');

  assert.ok(activity >= 0, 'workflow activity group is rendered');
  assert.ok(avatarRow > activity, 'activity group stays above avatar and message row');
  assert.match(source, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(source, /formatActivitySummary\(message, isChinese, now\)/);
  assert.match(source, /activityDivider: \{ height: StyleSheet\.hairlineWidth, marginBottom: 7, marginTop: 6/);
});

test('chat messages expose role avatars, local metadata, and Codex-like Markdown hierarchy', () => {
  assert.match(source, /import Markdown from 'react-native-markdown-display'/);
  assert.match(source, /function MessageAvatar/);
  assert.match(source, /'dbb3-worker': 'server\.rack'/);
  assert.match(source, /'pc-worker': 'desktopcomputer'/);
  assert.match(source, /reviewer: 'checkmark\.shield\.fill'/);
  assert.match(source, /avatarRole === 'dispatcher'/);
  assert.match(source, /avatarRole === 'reporter'/);
  assert.match(source, /formatMessageLocalTime/);
  assert.match(source, /messageStatusLabel/);
  assert.match(source, /<Markdown style=\{markdownStyles\}>/);
  assert.match(source, /heading1:[\s\S]*heading2:[\s\S]*heading3:/);
});

test('sending is one durable idempotent enqueue with foreground outbox compensation', () => {
  assert.match(source, /requestId: userMessageId/);
  assert.match(source, /turnId: hostedTurnId/);
  assert.match(source, /upsertPendingEnqueue\(cacheOwner,/);
  assert.match(source, /persistPendingAttachments\(/);
  assert.match(source, /deliverPendingEnqueue\(/);
  assert.match(source, /enqueueHostedTurn\(item\.conversationId, item\.input\)/);
  assert.match(source, /uploadId: attachment\.id/);
  assert.match(source, /globalThis\.crypto\?\.randomUUID/);
  assert.doesNotMatch(source, /const userMessageId = `user-\$\{userMessageCreatedAt\}`/);
  assert.match(source, /removePendingEnqueue\(cacheOwner, userMessageId\)/);
  assert.match(source, /replayPendingEnqueues/);
  assert.doesNotMatch(source, /recordConversationMessage\(conversationId|routeMessage\(/);
  assert.doesNotMatch(source, /new HermesChatStream|createNativeHermesChatStreamRuntime/);
});

test('a running hosted turn exposes the real server cancellation control', () => {
  assert.match(source, /conversationRunningHostedTurnId/);
  assert.match(source, /cancelHostedTurn\(/);
  assert.match(source, /取消当前任务/);
  assert.match(source, /name=\{cancellingHostedTurn[\s\S]*'stop\.fill'/);
});

test('an accepted hosted turn reaches a terminal state even when every poll fails', () => {
  assert.match(source, /optimisticHostedTurnTimeoutRef/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*hostedTurnVisibilityFailure/);
  assert.match(source, /optimisticState === 'running'[\s\S]*clearOptimisticHostedTurn\(\)/);
  assert.match(source, /setHostedRunning\(false\)[\s\S]*setSending\(false\)/);
});
