import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HERMES_CLEARTEXT_BASE_URL_ERROR_CODE,
  HermesApiError,
  HermesCleartextBaseUrlError,
} from '../src/api/HermesApiClient';
import { MobileAuthApiClient, MobileAuthApiError } from '../src/auth/mobile-auth';
import {
  savedSessionFailureInvalidatesCredentials,
  savedSessionFailureIsCleartextBaseUrl,
} from '../src/auth/session-restore-policy';

test('permanent 4xx and identity failures invalidate the saved session', () => {
  assert.equal(savedSessionFailureInvalidatesCredentials(new MobileAuthApiError(401)), true);
  assert.equal(savedSessionFailureInvalidatesCredentials(new HermesApiError(403)), true);
  assert.equal(
    savedSessionFailureInvalidatesCredentials(new Error('Hermes refreshed a different account')),
    true,
  );
});

test('transient failures keep the saved session for a retry', () => {
  assert.equal(
    savedSessionFailureInvalidatesCredentials(new TypeError('Network request failed')),
    false,
  );
  assert.equal(
    savedSessionFailureInvalidatesCredentials(new Error('Hermes authentication request timed out')),
    false,
  );
  assert.equal(savedSessionFailureInvalidatesCredentials(new HermesApiError(503)), false);
  assert.equal(savedSessionFailureInvalidatesCredentials(new MobileAuthApiError(429)), false);
});

test('a saved cleartext http:// base URL invalidates the session instead of retrying forever', () => {
  // The exact error the cold-start restore hits: adoptSavedSession feeds the
  // stored base URL into the MobileAuthApiClient constructor, whose transport
  // rule rejects cleartext HTTP before any request is attempted.
  let cleartextError: unknown;
  try {
    new MobileAuthApiClient('http://192.168.1.20:3000');
  } catch (error) {
    cleartextError = error;
  }
  assert.ok(cleartextError instanceof HermesCleartextBaseUrlError);
  assert.equal(cleartextError.code, HERMES_CLEARTEXT_BASE_URL_ERROR_CODE);
  assert.match(cleartextError.message, /must use HTTPS outside local development/);

  // Terminal, not transient: the restore layer clears the stored session and
  // falls through to the login screen instead of scheduling another retry.
  assert.equal(savedSessionFailureIsCleartextBaseUrl(cleartextError), true);
  assert.equal(savedSessionFailureInvalidatesCredentials(cleartextError), true);
  // The typed error classifies terminal on its own…
  assert.equal(
    savedSessionFailureInvalidatesCredentials(new HermesCleartextBaseUrlError()),
    true,
  );
  // …and so does a re-thrown plain copy that lost the prototype and code.
  assert.equal(
    savedSessionFailureInvalidatesCredentials(
      new Error('Hermes base URL must use HTTPS outside local development'),
    ),
    true,
  );
  // Other restore failures never trip the cleartext classifier.
  assert.equal(
    savedSessionFailureIsCleartextBaseUrl(new Error('Hermes request failed (500)')),
    false,
  );
  assert.equal(savedSessionFailureIsCleartextBaseUrl(new HermesApiError(401)), false);
});
