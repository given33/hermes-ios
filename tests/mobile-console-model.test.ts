import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRemoteConsoleCommand,
  isStopSlashCommand,
  mobileConsoleResultText,
} from '../src/studio/chat/mobile-console-model';

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
