import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const controllerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/PreviewChatPage.tsx'),
  'utf8',
);
const pageStateSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useChatPageState.ts'),
  'utf8',
);
const pageActionsSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useChatPageActions.ts'),
  'utf8',
);
const presentationSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/ChatPresentation.tsx'),
  'utf8',
);
const collaborationPresentationSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/ChatCollaborationPresentation.tsx'),
  'utf8',
);
const headerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/ChatHeader.tsx'),
  'utf8',
);
const messageStreamSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/ChatMessageStream.tsx'),
  'utf8',
);
const chatComposerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/ChatComposer.tsx'),
  'utf8',
);
const composerPresentationSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/ChatComposerPresentation.tsx'),
  'utf8',
);
const conversationHistorySource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/ConversationHistory.tsx'),
  'utf8',
);
const modelToolsDrawerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/ChatModelToolsDrawer.tsx'),
  'utf8',
);
const presentationStylesSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/chat-presentation-styles.ts'),
  'utf8',
);
const attachmentSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/chat-attachments.ts'),
  'utf8',
);
const domainSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/chat-domain.ts'),
  'utf8',
);
const deliverySource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/hosted-turn-delivery-service.ts'),
  'utf8',
);
const optimisticStateSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useOptimisticConversationState.ts'),
  'utf8',
);
const snapshotControllerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useConversationSnapshotController.ts'),
  'utf8',
);
const indexControllerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useConversationIndexController.ts'),
  'utf8',
);
const cancellationControllerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useHostedCancellationController.ts'),
  'utf8',
);
const composerNavigationControllerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useChatComposerNavigationController.ts'),
  'utf8',
);
const outboxReplayControllerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useHostedOutboxReplayController.ts'),
  'utf8',
);
const attachmentControllerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useChatAttachmentController.ts'),
  'utf8',
);
const attachmentLifecycleSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useChatAttachmentLifecycle.ts'),
  'utf8',
);
const interventionControllerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useHostedInterventionController.ts'),
  'utf8',
);
const sendControllerSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useHostedSendController.ts'),
  'utf8',
);
const conversationActionsSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useConversationActionsController.ts'),
  'utf8',
);
const deliveryCompositionSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/useHostedTurnDeliveryService.ts'),
  'utf8',
);
const pageShellSource = readFileSync(
  resolve(process.cwd(), 'src/studio/chat/ChatPageShell.tsx'),
  'utf8',
);
// Chat is intentionally split into controller, presentation, and attachment
// services. Contract assertions cover the whole production feature instead of
// forcing every implementation detail back into one giant React component.
const source = [
  controllerSource,
  pageStateSource,
  pageActionsSource,
  presentationSource,
  collaborationPresentationSource,
  headerSource,
  messageStreamSource,
  chatComposerSource,
  composerPresentationSource,
  conversationHistorySource,
  modelToolsDrawerSource,
  presentationStylesSource,
  attachmentSource,
  domainSource,
  deliverySource,
  optimisticStateSource,
  snapshotControllerSource,
  indexControllerSource,
  cancellationControllerSource,
  composerNavigationControllerSource,
  outboxReplayControllerSource,
  attachmentControllerSource,
  attachmentLifecycleSource,
  interventionControllerSource,
  sendControllerSource,
  conversationActionsSource,
  deliveryCompositionSource,
  pageShellSource,
].join('\n');

test('workflow activity sits above the role row and uses the Hermes Studio collapsed summary', () => {
  const messageStart = source.indexOf('function UnifiedMessage');
  const messageEnd = source.indexOf('function MessageAvatar', messageStart);
  const message = source.slice(messageStart, messageEnd);
  const activity = message.indexOf('<RoleActivityGroup');
  const avatarRow = message.indexOf('<View style={[styles.messageRow');
  const roleRow = message.indexOf('<View style={[styles.messageMeta');

  assert.ok(activity >= 0, 'workflow activity group is rendered');
  assert.ok(activity > avatarRow && activity < roleRow, 'activity timing stays above the role row');
  assert.match(message, /<View style=\{\[styles\.messageFooter/);
  assert.doesNotMatch(message, /<RoleActivityGroup[\s\S]{0,100}footer/);
  assert.match(source, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(source, /formatActivitySummary\(message, isChinese, now\)/);
  assert.match(source, /formatActivitySummary\(message, isChinese, now\)/);
  assert.match(source, /activitySummary: \{ alignItems: 'center', flexDirection: 'row', gap: 6,/);
  assert.doesNotMatch(source, /activitySummary: \{[^\n]*justifyContent: 'space-between'/);
  assert.match(source, /activityTitle: \{ flex: 1,/);
  assert.match(source, /activityCount: \{ fontFamily: MONO_REGULAR/);
  assert.doesNotMatch(source.slice(source.indexOf('function RoleActivityGroup'), source.indexOf('function shouldShowMessageTiming')), /<Cpu/);
  assert.doesNotMatch(source, /activityDivider:/);
  assert.match(source, /shouldShowMessageTiming\(message\)/);
  assert.match(source, /activities\.length \? \(/);
});

test('only user timestamps stay adjacent to sender names while assistant runtime metadata stays hidden', () => {
  const messageStart = source.indexOf('function UnifiedMessage');
  const messageEnd = source.indexOf('function MessageAvatar', messageStart);
  const message = source.slice(messageStart, messageEnd);
  const userTimestamp = message.indexOf('{isUser ? metadataNode : null}');
  const sender = message.indexOf('<View style={[styles.senderMeta');

  assert.ok(userTimestamp >= 0 && userTimestamp < sender);
  assert.match(message, /const metadata = isUser/);
  assert.doesNotMatch(message, /!isUser \? metadataNode/);
  assert.doesNotMatch(message, /runtimeModel/);
  assert.match(source, /messageMeta: \{ alignItems: 'center', flexDirection: 'row', gap: 5,/);
  assert.doesNotMatch(source, /messageMeta: \{[^\n]*justifyContent: 'space-between'/);
  assert.doesNotMatch(source, /messageMeta: \{[^\n]*width: '100%'/);
});

test('the same conversation lifts into the Studio collaboration surface from persisted work state', () => {
  assert.match(source, /conversationCollaborationState/);
  assert.match(source, /collaborationStateByConversationRef/);
  assert.match(source, /response\.route\.mode === 'work'/);
  assert.match(source, /群聊正在拉起/);
  assert.match(source, /群聊已拉起/);
  assert.match(source, /function CollaborationLiftNotice/);
  assert.match(source, /Hermes 调度员/);
  assert.match(source, /Hermes 审阅员/);
  assert.match(source, /Hermes 汇报员/);
  assert.match(source, /Hermes 监督者/);
  assert.match(source, /5 位成员/);
  assert.match(source, /function CollaborationMemberStack/);
  assert.match(source, /collaborationHeaderInfo/);
  assert.match(source, /collaborationHeaderConnection/);
  assert.match(source, /Hermes 调度员正在协调成员/);
  assert.match(source, /协作成员正在重连/);
  assert.doesNotMatch(source, /\/group-chat/);
});

test('messages preserve the IPA chat proportions and mobile scroll inspection', () => {
  assert.match(source, /messageAvatar: \{[^\n]*height: 30,[^\n]*width: 30/);
  assert.match(source, /messageRow: \{[^\n]*gap: 9/);
  assert.match(source, /messageStack: \{[^\n]*maxWidth: '88%'/);
  assert.match(source, /messageBody: \{[^\n]*borderRadius: 8,[^\n]*paddingHorizontal: 11,[^\n]*paddingTop: 9/);
  assert.match(source, /const BODY_REGULAR = 'HermesGoogle-IBMPlexSans-400-Normal'/);
  assert.match(source, /const DISPLAY_BOLD = 'SpaceGrotesk_700Bold'/);
  assert.match(source, /: tokens\.colors\.card/);
  assert.match(source, /showScrollToBottom/);
  assert.match(source, /回到最新消息/);
});

test('chat messages expose role avatars, local metadata, and Codex-like Markdown hierarchy', () => {
  assert.match(source, /import Markdown from 'react-native-markdown-display'/);
  assert.match(source, /import \{ StudioRoleAvatar \}/);
  assert.match(source, /function MessageAvatar/);
  assert.match(source, /<StudioRoleAvatar role=\{avatarRole\} size=\{size\}/);
  assert.match(source, /const size = compact \? 24 : 30/);
  assert.match(source, /isUser && remoteAvatar \? \(/);
  assert.match(source, /formatMessageLocalTime/);
  assert.doesNotMatch(source, /messageStatusLabel/);
  assert.match(source, /<Markdown style=\{markdownStyles\}>/);
  assert.match(source, /heading1:[\s\S]*heading2:[\s\S]*heading3:/);
});

test('sending is one durable idempotent enqueue with foreground outbox compensation', () => {
  assert.match(source, /shouldRenderPendingMessage\(messages, hostedRunning \|\| sending\)/);
  assert.doesNotMatch(source, /shouldRenderPendingMessage\(displayMessages, sending\)/);
  assert.match(source, /requestId: userMessageId/);
  assert.match(source, /turnId: hostedTurnId/);
  assert.match(source, /upsertPendingEnqueue\(cacheOwner,/);
  assert.match(source, /persistPendingAttachments\(/);
  assert.match(source, /deliverPendingEnqueue\(/);
  assert.match(source, /enqueueHostedTurn\(item\.conversationId, item\.input, signal\)/);
  assert.match(source, /uploadId: attachment\.id/);
  assert.match(source, /globalThis\.crypto\?\.randomUUID/);
  assert.doesNotMatch(source, /const userMessageId = `user-\$\{userMessageCreatedAt\}`/);
  assert.match(source, /removePendingEnqueueIfActive\([\s\S]*cacheOwner,[\s\S]*source\.input\.requestId/);
  assert.match(source, /replayPendingEnqueues/);
  assert.doesNotMatch(source, /recordConversationMessage\(conversationId|routeMessage\(/);
  assert.doesNotMatch(source, /new HermesChatStream|createNativeHermesChatStreamRuntime/);
});

test('the user message is rendered after durable intent but before any network request', () => {
  const sendStart = source.indexOf('const send = async () =>');
  const sendEnd = source.indexOf('const requestSend = () =>', sendStart);
  const send = source.slice(sendStart, sendEnd);
  const optimisticInsert = send.indexOf('setMessages((current) => upsertChatMessage(current, userMessage))');
  const composerClear = send.indexOf('clearQueuedComposer()');
  const durableIntent = send.indexOf('await localStore.initializePendingEnqueue(');
  const enqueueRequest = send.indexOf('await outbox.deliverPendingEnqueue(queuedItem, ownerEpoch)');

  assert.ok(optimisticInsert >= 0, 'the local user message is inserted');
  assert.ok(optimisticInsert > durableIntent, 'the local insert follows the durable intent');
  assert.ok(composerClear > optimisticInsert, 'the composer clears only after the visible commit');
  assert.ok(enqueueRequest > composerClear, 'hosted delivery starts after the composer handoff');
});

test('new conversation creation persists its staged snapshot before switching UI state', () => {
  const createStart = conversationActionsSource.indexOf('const createConversation = async () =>');
  const createEnd = conversationActionsSource.indexOf(
    'const cancelActiveHostedTurn = async () =>',
    createStart,
  );
  const create = conversationActionsSource.slice(createStart, createEnd);
  const serverCreate = create.indexOf('await cloudApi.createConversation(');
  const generationCheck = create.indexOf('accountGenerationFromOwnerScope(cacheOwner)');
  const durableIndex = create.indexOf('await commitConversationIndex(');
  const clearOldState = create.indexOf('clearOptimisticHostedTurn()');
  const switchConversation = create.indexOf(
    'await applyConversation(result.conversation, ownerEpoch, false, true)',
  );

  assert.ok(serverCreate >= 0);
  assert.ok(generationCheck > serverCreate);
  assert.ok(durableIndex > generationCheck);
  assert.ok(clearOldState > durableIndex);
  assert.ok(switchConversation > clearOldState);
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
  assert.match(source, /name=\{model\.canCancelHostedTurn \? 'stop\.circle\.fill' : 'arrow\.up\.circle\.fill'\}/);
});

test('collaboration members keep canonical distinct local avatars without excessive overlap', () => {
  assert.match(source, /canonicalMember\('dispatcher', 'dispatcher'/);
  assert.match(source, /canonicalMember\('worker', 'dbb3-worker'/);
  assert.match(source, /canonicalMember\('reviewer', 'reviewer'/);
  assert.match(source, /canonicalMember\('reporter', 'reporter'/);
  assert.match(source, /canonicalMember\('supervisor', 'supervisor'/);
  assert.match(source, /<StudioRoleAvatar role=\{member\.avatarRole \|\| 'hermes'\} size=\{24\}/);
  assert.match(source, /marginLeft: index === 0 \? 0 : -6/);
  assert.doesNotMatch(source, /<StudioOfficialAvatar size=\{24\} \/>/);
  const avatars = readFileSync(
    resolve(process.cwd(), 'src/components/studio/StudioRoleAvatar.tsx'),
    'utf8',
  );
  assert.match(avatars, /'dbb3-worker': 'studio-role-worker-dbb3'/);
  assert.match(avatars, /reporter: 'studio-role-reporter'/);
  assert.match(avatars, /reviewer: 'studio-role-reviewer'/);
  assert.match(avatars, /supervisor: 'studio-role-supervisor'/);
});

test('long pressing a member submits a durable intervention to the same hosted turn', () => {
  assert.match(source, /onLongPress=\{isUser \? undefined : \(\) => onMentionMember\(message\)\}/);
  assert.match(source, /onLongPress=\{\(\) => onMentionMember\(member\)\}/);
  assert.match(source, /const mention = `@\$\{message\.name\.trim\(\)\} `/);
  assert.match(source, /const composingIntervention = hostedRunning/);
  assert.match(source, /cloud\.interveneHostedTurn\(/);
  assert.match(source, /conversationId,[\s\S]*turnId,[\s\S]*trimmed,[\s\S]*messageId/);
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
  const timeline = readFileSync(
    resolve(process.cwd(), 'src/studio/WorkflowTimeline.tsx'),
    'utf8',
  );
  const reasoning = readFileSync(
    resolve(process.cwd(), 'src/studio/ReasoningSection.tsx'),
    'utf8',
  );
  assert.match(source, /autoFollowStreamRef/);
  assert.match(source, /onScroll: handleStreamScroll/);
  assert.match(source, /onInspectActivity\(\);[\s\S]*setOpen/);
  assert.match(source, /activityDisplayContent\(activity\)/);
  assert.match(source, /<ReasoningSection/);
  assert.match(source, /<WorkflowTimeline/);
  // The per-step fold, primary argument, clamped output, and pinned
  // collapse state now live in the extracted timeline components.
  assert.match(timeline, /activityPrimaryDetail\(activity\)/);
  assert.match(timeline, /clampActivityText/);
  assert.match(timeline, /timelineCollapseReducer/);
  assert.match(timeline, /onToggle\(activity\.id\)/);
  assert.match(reasoning, /reasoningPreviewLine\(text, running\)/);
  assert.match(reasoning, /Clipboard\.setStringAsync\(text\)/);
  assert.doesNotMatch(source, /activityRuntime:/);
});
