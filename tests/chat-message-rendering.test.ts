import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  resolve(process.cwd(), 'src/preview/PreviewChatPage.tsx'),
  'utf8',
);

test('workflow activity preserves the Build 28 order and keeps the summary chevron beside elapsed time', () => {
  const messageStart = source.indexOf('function UnifiedMessage');
  const messageEnd = source.indexOf('function MessageAvatar', messageStart);
  const message = source.slice(messageStart, messageEnd);
  const activity = message.indexOf('<RoleActivityGroup');
  const avatarRow = message.indexOf('<View style={[styles.messageRow');

  assert.ok(activity >= 0, 'workflow activity group is rendered');
  assert.ok(avatarRow > activity, 'activity group stays above its avatar and message row');
  assert.match(source, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(source, /formatActivitySummary\(message, isChinese, now\)/);
  assert.match(source, /formatActivitySummary\(message, isChinese, now\)/);
  assert.match(source, /activitySummary: \{ alignItems: 'center', flexDirection: 'row', gap: 6,/);
  assert.doesNotMatch(source, /activitySummary: \{[^\n]*justifyContent: 'space-between'/);
  assert.match(source, /activityTitle: \{ flexShrink: 1,/);
  assert.doesNotMatch(source, /activityTitle: \{ flex: 1,/);
  assert.match(source, /activityDivider: \{ height: StyleSheet\.hairlineWidth, marginBottom: 7, marginTop: 6/);
  assert.match(source, /shouldShowMessageTiming\(message\)/);
  assert.match(source, /activities\.length \? \(/);
});

test('message timestamps stay adjacent to sender names and user time precedes the user name', () => {
  const messageStart = source.indexOf('function UnifiedMessage');
  const messageEnd = source.indexOf('function MessageAvatar', messageStart);
  const message = source.slice(messageStart, messageEnd);
  const userTimestamp = message.indexOf('{isUser ? metadataNode : null}');
  const sender = message.indexOf('<View style={[styles.senderMeta');

  assert.ok(userTimestamp >= 0 && userTimestamp < sender);
  assert.match(source, /messageMeta: \{ alignItems: 'center', flexDirection: 'row', gap: 5,/);
  assert.doesNotMatch(source, /messageMeta: \{[^\n]*justifyContent: 'space-between'/);
  assert.doesNotMatch(source, /messageMeta: \{[^\n]*width: '100%'/);
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
  assert.match(source, /shouldRenderPendingMessage\(displayMessages, hostedRunning \|\| sending\)/);
  assert.doesNotMatch(source, /shouldRenderPendingMessage\(displayMessages, sending\)/);
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

test('the user message is rendered before any model or network request', () => {
  const sendStart = source.indexOf('const send = async () =>');
  const sendEnd = source.indexOf('const requestSend = () =>', sendStart);
  const send = source.slice(sendStart, sendEnd);
  const optimisticInsert = send.indexOf('setMessages((current) => [...current, userMessage])');
  const composerClear = send.indexOf('clearQueuedComposer()');
  const modelRequest = send.indexOf('cloudApi.getModels(conversationProfile)');
  const enqueueRequest = send.indexOf('cloudApi.enqueueHostedTurn(');

  assert.ok(optimisticInsert >= 0, 'the local user message is inserted');
  assert.ok(composerClear > optimisticInsert, 'the composer clears after the local insert');
  assert.ok(modelRequest > composerClear, 'model validation starts after the local UI update');
  assert.ok(enqueueRequest > modelRequest, 'hosted delivery remains after validation');
});

test('chat maps gateway failures to bounded native copy instead of proxy documents', () => {
  assert.match(source, /error instanceof HermesApiError/);
  assert.match(source, /error\.status === 429/);
  assert.match(source, /error\.status >= 500/);
  assert.match(source, /Hermes 服务暂时不可用，请稍后重试/);
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

test('running simple chats expose elapsed time and a runtime-status fold', () => {
  assert.match(source, /function PendingMessage/);
  assert.match(source, /status: 'running'/);
  assert.match(source, /startedAt/);
  assert.match(source, /<RoleActivityGroup[\s\S]*message=\{pendingMessage\}/);
});

test('activity inspection pauses stream following and renders one primary body', () => {
  assert.match(source, /autoFollowStreamRef/);
  assert.match(source, /onScroll=\{handleStreamScroll\}/);
  assert.match(source, /onInspectActivity\(\);[\s\S]*setOpen/);
  assert.match(source, /activityDisplayContent\(activity\)/);
  assert.match(source, /<ActivityDetail value=\{detailContent\}/);
  assert.doesNotMatch(source, /<ActivityDetail label=/);
  assert.doesNotMatch(source, /activityRuntime:/);
});
