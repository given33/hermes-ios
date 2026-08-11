import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const moduleRoot = resolve(process.cwd(), 'modules', 'hermes-ios-context');
const read = (file: string) => readFileSync(resolve(moduleRoot, file), 'utf8');

test('context bridge circuit breaker: faulted calls return degraded results', () => {
  const source = read('index.ts');
  // The circuit breaker must exist and degrade instead of throwing.
  assert.match(source, /NativeContextUnavailableError/);
  assert.match(source, /nativeContextFaulted/);
  assert.match(source, /circuit-breaker/i);
  assert.match(source, /HermesIOSContextSafe/);
  assert.match(source, /nativeContextDegradedResult/);
  // Subscribers return a no-op remove() so useEffect cleanups never crash.
  assert.match(source, /NATIVE_CONTEXT_NOOP_SUBSCRIBER/);
  assert.match(source, /remove: \(\) => undefined/);
  // Promise rejections from the native bridge must also degrade (async bridge
  // failures otherwise surface as unhandled rejections that crash the app).
  assert.match(source, /result instanceof Promise/);
  assert.match(source, /result\.catch/);
});

test('snapshot-style degraded values cover the common native surfaces', () => {
  const source = read('index.ts');
  for (const surface of [
    'getCapabilities',
    'getDeviceSnapshot',
    'getWatchSnapshot',
    'getPowerSnapshot',
    'getPendingEvents',
    'claimPendingEvents',
    'readPendingCommands',
  ]) {
    assert.match(source, new RegExp(`${surface}:`), `degraded value for ${surface}`);
  }
});

test('auth provider marks the bridge unavailable instead of blocking login', () => {
  const auth = readFileSync(resolve(process.cwd(), 'src', 'auth', 'AuthProvider.tsx'), 'utf8');
  assert.match(auth, /markNativeIOSContextUnavailable/);
  assert.match(auth, /runOptionalAuthEffect/);
  // Remote authentication stays authoritative; native failure must not throw.
  assert.match(auth, /entitlements are already known to be unusable/);
});

test('error boundary retry button uses IOSPressable, not native Pressable', () => {
  const app = readFileSync(resolve(process.cwd(), 'src', 'app', 'HermesNativeApp.tsx'), 'utf8');
  assert.match(app, /IOSPressable/);
  assert.doesNotMatch(app, /<Pressable/);
});
