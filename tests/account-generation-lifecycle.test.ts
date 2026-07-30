import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountGenerationFromOwnerScope,
  accountOwnerScope,
  LEGACY_ACCOUNT_GENERATION,
  legacyAccountOwnerScope,
} from '../src/auth/account-identity';
import {
  awaitCurrentIOSContext,
  IOSContextLifecycleCoordinator,
  StaleIOSContextLifecycleError,
} from '../src/context/ios-context-lifecycle';

const identity = {
  baseUrl: 'https://hermes.test',
  username: 'owner',
};

test('same-name replacement accounts use disjoint generation-scoped storage owners', () => {
  const oldScope = accountOwnerScope({
    ...identity,
    accountGeneration: 'acctgen_old',
  });
  const newScope = accountOwnerScope({
    ...identity,
    accountGeneration: 'acctgen_new',
  });

  assert.notEqual(oldScope, newScope);
  assert.equal(accountGenerationFromOwnerScope(oldScope), 'acctgen_old');
  assert.equal(accountGenerationFromOwnerScope(newScope), 'acctgen_new');
  assert.equal(
    accountGenerationFromOwnerScope(legacyAccountOwnerScope(identity)),
    LEGACY_ACCOUNT_GENERATION,
  );
  assert.throws(
    () => accountOwnerScope({ ...identity, accountGeneration: LEGACY_ACCOUNT_GENERATION }),
    /generation is required/i,
  );
});

test('a same-name generation replacement aborts and rejects the old async continuation', async () => {
  const lifecycle = new IOSContextLifecycleCoordinator();
  const oldCapture = lifecycle.activate('owner|acctgen_old', 'acctgen_old');
  let resolveOld!: (value: string) => void;
  const oldResult = awaitCurrentIOSContext(
    lifecycle,
    oldCapture,
    () => new Promise<string>((resolve) => { resolveOld = resolve; }),
  );

  const newCapture = lifecycle.activate('owner|acctgen_new', 'acctgen_new');
  assert.equal(oldCapture.signal.aborted, true);
  assert.equal(lifecycle.isCurrent(newCapture), true);
  resolveOld('late old result');

  await assert.rejects(
    oldResult,
    (error: unknown) => error instanceof StaleIOSContextLifecycleError,
  );
});

test('account deletion invalidates the current lifecycle before late native work returns', async () => {
  const lifecycle = new IOSContextLifecycleCoordinator();
  const capture = lifecycle.activate('owner|acctgen_current', 'acctgen_current');
  let release!: () => void;
  const pending = awaitCurrentIOSContext(
    lifecycle,
    capture,
    () => new Promise<void>((resolve) => { release = resolve; }),
  );

  lifecycle.invalidate(capture);
  release();

  assert.equal(capture.signal.aborted, true);
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof StaleIOSContextLifecycleError,
  );
});
