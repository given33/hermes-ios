import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AuthLifecycleCoordinator,
  CredentialMutationQueue,
  isCurrentAuthLifecycle,
  isCurrentAuthSession,
  runOptionalAuthEffect,
} from '../src/auth/auth-lifecycle';
import type { SavedConnection } from '../src/auth/credential-contract';

const connection: SavedConnection = {
  accessToken: 'access-a',
  baseUrl: 'https://hermes.example',
  expiresAt: 2_000_000_000,
  refreshToken: 'refresh-a',
  username: 'owner',
};

test('auth lifecycle identity rejects old connection and generation callbacks', () => {
  assert.equal(isCurrentAuthLifecycle(connection, connection, 3, 3), true);
  assert.equal(isCurrentAuthLifecycle({ ...connection }, connection, 3, 3), false);
  assert.equal(isCurrentAuthLifecycle(connection, connection, 4, 3), false);
  assert.equal(isCurrentAuthLifecycle(null, connection, 3, 3), false);
});

test('credential mutations remain ordered after a failed operation', async () => {
  const queue = new CredentialMutationQueue();
  const calls: string[] = [];
  const first = queue.run(async () => {
    calls.push('first-start');
    await Promise.resolve();
    calls.push('first-failed');
    throw new Error('expected');
  });
  const second = queue.run(async () => {
    calls.push('second');
  });

  await assert.rejects(first, /expected/);
  await second;
  assert.deepEqual(calls, ['first-start', 'first-failed', 'second']);
});

test('optional post-login effects never turn a valid remote session into a login failure', async () => {
  const calls: string[] = [];
  const failed = await runOptionalAuthEffect(async () => {
    calls.push('keychain-failed');
    throw new Error('stale biometric item');
  });
  const completed = await runOptionalAuthEffect(async () => {
    calls.push('session-continues');
  });

  assert.equal(failed, false);
  assert.equal(completed, true);
  assert.deepEqual(calls, ['keychain-failed', 'session-continues']);
});

test('a late operation cannot unlock the gate or update a remounted auth provider', () => {
  const lifecycle = new AuthLifecycleCoordinator();
  lifecycle.mount();
  const staleOperation = lifecycle.beginOperation();
  assert.notEqual(staleOperation, null);

  lifecycle.unmount();
  lifecycle.mount();
  const currentOperation = lifecycle.beginOperation();
  assert.notEqual(currentOperation, null);
  lifecycle.finishOperation(staleOperation!);

  assert.equal(lifecycle.isBusy(), true);
  assert.equal(lifecycle.isCurrent(staleOperation!), false);
  assert.equal(lifecycle.isCurrent(currentOperation!), true);
  lifecycle.finishOperation(currentOperation!);
  assert.equal(lifecycle.isBusy(), false);
});

test('session identity survives token rotation but rejects a new auth generation', () => {
  const rotated = {
    ...connection,
    accessToken: 'access-b',
    refreshToken: 'refresh-b',
  };
  assert.equal(isCurrentAuthSession(rotated, connection, 7, 7), true);
  assert.equal(isCurrentAuthSession(rotated, connection, 8, 7), false);
  assert.equal(
    isCurrentAuthSession(
      { ...rotated, username: 'different-owner' },
      connection,
      7,
      7,
    ),
    false,
  );
});

test('invalidating logout wins a forced interleaving with an in-flight operation', () => {
  const lifecycle = new AuthLifecycleCoordinator();
  lifecycle.mount();
  const refreshGeneration = lifecycle.currentGeneration();
  assert.equal(lifecycle.isCurrent(refreshGeneration), true);

  const logoutGeneration = lifecycle.beginOperation();
  assert.notEqual(logoutGeneration, null);
  assert.equal(lifecycle.isCurrent(refreshGeneration), false);
  assert.equal(lifecycle.isCurrent(logoutGeneration!), true);
});
