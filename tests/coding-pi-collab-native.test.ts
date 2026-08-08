import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

const collabPage = read('src/studio/coding-pi/CodingPiCollabView.tsx');
const collabClient = read('src/studio/coding-pi/collab-native-client.ts');
const toolCard = read('src/studio/coding-pi/CodingPiToolCard.tsx');
const officialToolDetails = read('src/studio/coding-pi/CodingPiOfficialToolDetails.tsx');
const preview = read('src/studio/PreviewChatPage.tsx');
const featureModes = read('src/studio/chat/useChatFeatureModes.ts');
const pageShell = read('src/studio/chat/ChatPageShell.tsx');

test('Coding owns the complete native collab-web surface without Browser/WebView integration', () => {
  assert.doesNotMatch(collabPage, /react-native-webview|BuiltinBrowserPage|requestBuiltinBrowserUrl|onOpenOfficialWeb/);
  assert.doesNotMatch(preview, /requestBuiltinBrowserUrl|onOpenOfficialWeb|browser-open-request/);

  for (const marker of [
    'CodingPiConnectScreen',
    'CollabHeader',
    'CollabSharePanel',
    'CollabBanner',
    'CollabTranscript',
    'CollabComposer',
    'CollabAgentsPanel',
    'CollabAgentDrawer',
    'CollabToasts',
    'Rejoin',
    'New link',
    'read-only',
    'web_link',
    'web_view_link',
    'sendUiResponse',
    'sendAbort',
    'sendAgentCommand',
    'fetchTranscript',
  ]) {
    assert.ok(collabPage.includes(marker), `missing native collab surface marker: ${marker}`);
  }

  for (const frame of [
    "t: 'hello'",
    "t: 'prompt'",
    "t: 'ui-response'",
    "t: 'abort'",
    "t: 'agent-cmd'",
    "t: 'fetch-transcript'",
    "case 'snapshot-chunk'",
    "case 'tool_execution_update'",
    "case 'ui-request'",
    "case 'transcript'",
    "case 'bye'",
  ]) {
    assert.ok(collabClient.includes(frame), `missing native collab protocol behavior: ${frame}`);
  }
});

test('native tool inspection covers the official collab-web registry and xdev dispatch', () => {
  assert.match(officialToolDetails, /const OFFICIAL_TOOL_RENDERERS = new Set/);
  assert.match(officialToolDetails, /export function isOfficialToolRenderer/);
  for (const tool of [
    'ask', 'ast_edit', 'ast_grep', 'bash', 'browser', 'puppeteer', 'debug', 'edit', 'apply_patch',
    'eval', 'js', 'python', 'notebook', 'fetch', 'glob', 'find', 'generate_image', 'github', 'goal',
    'inspect_image', 'hub', 'irc', 'job', 'await', 'poll', 'cancel_job', 'lsp', 'recall', 'reflect',
    'retain', 'read', 'report_tool_issue', 'resolve', 'reject', 'propose', 'grep', 'search', 'task',
    'todo', 'web_search', 'write', 'yield',
  ]) {
    assert.match(officialToolDetails, new RegExp(`['"]${tool}['"]`), `missing official renderer registry entry: ${tool}`);
    assert.match(officialToolDetails, new RegExp(`case ['"]${tool}['"]`), `missing native renderer dispatch: ${tool}`);
  }
  assert.match(toolCard, /executeXdevDispatch/);
  assert.match(toolCard, /partialResult/);
  assert.match(toolCard, /ToolImageGrid/);
  assert.match(toolCard, /onOpenAgent/);
  assert.match(toolCard, /<CodingPiOfficialToolDetails/);
  for (const renderer of [
    'NativeTaskDetails', 'NativeTaskResult', 'NativeTaskProgress',
    'NativeTodoDetails', 'NativeTodoOp', 'NativeTodoPhase',
    'NativeAskDetails', 'NativeAskQuestion',
  ]) {
    assert.match(officialToolDetails, new RegExp(`function ${renderer}`), `missing structured native renderer: ${renderer}`);
  }
});

test('Chat and Coding remain separate persistent feature stores', () => {
  assert.match(featureModes, /useCodingPiCollabController/);
  assert.match(featureModes, /useAgentGroupChatController/);
  assert.match(featureModes, /useHermesStudioWorkflowHistory/);
  assert.match(pageShell, /headerProps\.chatMode === 'coding'/);
  assert.match(pageShell, /<ChatMessageStream/);
  assert.match(pageShell, /<AgentGroupChatView/);
});

test('no Pi browser request bridge remains outside the generic Hermes Browser page', () => {
  const codingFiles = readdirSync(resolve(root, 'src/studio/coding-pi'));
  assert.ok(codingFiles.includes('CodingPiCollabView.tsx'));
  assert.ok(!codingFiles.some((file) => file.toLowerCase().includes('browser')));
  assert.doesNotMatch(read('src/browser/BuiltinBrowserPage.tsx'), /requestBuiltinBrowserUrl|onOpenOfficialWeb/);
});
