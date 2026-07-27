import assert from 'node:assert/strict';
import test from 'node:test';

// Regression coverage for the module-scope crash: a cleartext
// EXPO_PUBLIC_HERMES_URL used to throw while src/config.ts was evaluated,
// killing the bundle with a redbox before any error boundary existed.
//
// This file deliberately avoids a static `import '../src/config'`: the module
// must be evaluated for the first time AFTER the http:// override is in the
// environment, exactly like a build configured with a cleartext origin. The
// node test runner executes each test file in its own process, so no other
// test file can have primed the module cache here.

test('importing src/config with an http:// origin never throws at import time', async () => {
  process.env.EXPO_PUBLIC_HERMES_URL = 'http://192.168.1.20:3000';
  try {
    const config = await import('../src/config');

    // The bundle keeps evaluating and the override is preserved as-is…
    assert.equal(config.HERMES_ORIGIN, 'http://192.168.1.20:3000');

    // …while the deferred validation still rejects: the verdict is recorded
    // for HermesNativeApp's config-error screen instead of being thrown.
    const transportError = config.HERMES_ORIGIN_TRANSPORT_ERROR;
    assert.ok(
      transportError,
      'the cleartext origin must be recorded as a transport error',
    );
    assert.match(transportError, /https:\/\//);
    // The remediation names the exact escape hatches.
    assert.match(transportError, /EXPO_PUBLIC_HERMES_URL/);
    assert.match(transportError, /EXPO_PUBLIC_HERMES_ALLOW_HTTP=1/);
  } finally {
    delete process.env.EXPO_PUBLIC_HERMES_URL;
  }
});
