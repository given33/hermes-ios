import assert from 'node:assert/strict';
import test from 'node:test';

import {
  browserDomainLabel,
  HERMES_BROWSER_HOME_URL,
  normalizeBrowserInput,
} from '../src/browser/browser-url';

test('built-in browser normalizes URLs and search queries without changing explicit schemes', () => {
  assert.equal(HERMES_BROWSER_HOME_URL, 'https://www.google.com');
  assert.equal(normalizeBrowserInput('example.com'), 'https://example.com');
  assert.equal(normalizeBrowserInput('https://example.com/a'), 'https://example.com/a');
  assert.equal(
    normalizeBrowserInput('Hermes Agent browser'),
    'https://www.google.com/search?q=Hermes%20Agent%20browser',
  );
  assert.equal(normalizeBrowserInput('mailto:test@example.com'), 'mailto:test@example.com');
  assert.equal(browserDomainLabel('https://www.example.com/a'), 'example.com');
});
