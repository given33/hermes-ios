import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { initializePlaintextDirectory } from '../src/api/temporary-plaintext-lifecycle';

test('plaintext preview startup removes stale process files exactly once', () => {
  const calls: string[] = [];
  const directory = {
    exists: true,
    create() { calls.push('create'); },
    delete() { calls.push('delete'); },
  };
  const lifecycle = { initialized: false };

  initializePlaintextDirectory(directory, lifecycle);
  initializePlaintextDirectory(directory, lifecycle);

  assert.deepEqual(calls, ['delete', 'create']);
  assert.equal(lifecycle.initialized, true);
});

test('plaintext preview initialization fails closed when stale deletion fails', () => {
  const calls: string[] = [];
  const directory = {
    exists: true,
    create() { calls.push('create'); },
    delete() {
      calls.push('delete');
      throw new Error('protected stale directory');
    },
  };
  const lifecycle = { initialized: false };

  assert.throws(() => initializePlaintextDirectory(directory, lifecycle));
  assert.deepEqual(calls, ['delete']);
  assert.equal(lifecycle.initialized, false);
});

test('account and chat previews use the dedicated plaintext lifecycle and bounded stream', () => {
  const routeData = readFileSync(resolve('src/app/hermes-route-data.ts'), 'utf8');
  const chat = readFileSync(resolve('src/studio/chat/useChatAttachmentController.ts'), 'utf8');
  const app = readFileSync(resolve('src/app/HermesNativeApp.tsx'), 'utf8');

  assert.match(routeData, /temporaryPlaintextFile\(name, 'account-file'\)/);
  assert.match(routeData, /consumeAccountFile\([\s\S]*writeBoundedDownload/);
  assert.doesNotMatch(routeData, /blob\.arrayBuffer\(\)/);
  assert.match(chat, /temporaryPlaintextFile\([\s\S]*`chat-/);
  assert.match(chat, /finally \{[\s\S]*target\.exists\) target\.delete\(\)/);
  assert.match(app, /initializeTemporaryPlaintextFiles\(\)/);
});
