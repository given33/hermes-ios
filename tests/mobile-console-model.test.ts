import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consoleInvocationBlocksActiveView,
  consoleInvocationOwnsActiveView,
  isRemoteConsoleCommand,
  isStopSlashCommand,
  mobileConsoleResultText,
  parseHostedCommand,
} from '../src/studio/chat/mobile-console-model';

test('console results only mutate the conversation view that launched them', () => {
  assert.equal(consoleInvocationOwnsActiveView('a', 'a', 7, 7), true);
  assert.equal(consoleInvocationOwnsActiveView('b', 'a', 8, 7), false);
  assert.equal(consoleInvocationOwnsActiveView('a', 'a', 8, 7), false);
  assert.equal(consoleInvocationOwnsActiveView('', '', 7, 7), false);
});

test('a running console invocation blocks only its conversation generation', () => {
  const running = [{ conversationId: 'a', generation: 7 }];
  assert.equal(consoleInvocationBlocksActiveView(running, 'a', 7), true);
  assert.equal(consoleInvocationBlocksActiveView(running, 'b', 8), false);
  assert.equal(consoleInvocationBlocksActiveView(running, 'a', 8), false);
  assert.equal(consoleInvocationBlocksActiveView(
    [{ conversationId: '', generation: 9 }],
    'new-conversation',
    9,
  ), false);
  assert.equal(consoleInvocationBlocksActiveView(
    [{ conversationId: '', generation: 9 }],
    '',
    9,
  ), true);
});

test('stop command matching is exact and does not capture unrelated commands', () => {
  assert.equal(isStopSlashCommand('/stop'), true);
  assert.equal(isStopSlashCommand(' /STOP now '), true);
  assert.equal(isStopSlashCommand('/stopwatch'), false);
  assert.equal(isStopSlashCommand('/status'), false);
});

test('remote console command matching excludes local stop handling', () => {
  assert.equal(isRemoteConsoleCommand('/status'), true);
  assert.equal(isRemoteConsoleCommand('/config set theme dark'), true);
  assert.equal(isRemoteConsoleCommand('/stop'), false);
  assert.equal(isRemoteConsoleCommand('hello'), false);
});

test('official hosted commands are parsed separately from the legacy console', () => {
  assert.deepEqual(parseHostedCommand('/bg run tests'), { command: 'bg', argument: 'run tests' });
  assert.deepEqual(parseHostedCommand('/background investigate'), { command: 'bg', argument: 'investigate' });
  assert.deepEqual(parseHostedCommand('/btw what changed?'), { command: 'btw', argument: 'what changed?' });
  assert.deepEqual(parseHostedCommand('/busy queue'), { command: 'busy', argument: 'queue' });
  assert.equal(parseHostedCommand('/review this'), null);
});

test('console result text preserves server output and supplies truthful fallback text', () => {
  const base = {
    command: '/status',
    confirmation_message: '',
    profile: 'default',
  };
  assert.equal(mobileConsoleResultText({
    ...base,
    output: 'gateway: running',
    status: 'ok',
  }, true), 'gateway: running');
  assert.equal(mobileConsoleResultText({
    ...base,
    output: '',
    status: 'ok',
  }, true), '命令已完成。');
  assert.equal(mobileConsoleResultText({
    ...base,
    output: '',
    status: 'error',
  }, false), 'Command failed.');
});
