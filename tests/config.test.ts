import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HERMES_ORIGIN,
  HERMES_ORIGIN_TRANSPORT_ERROR,
  buildHermesUrl,
  getDownloadFilename,
  hermesOriginTransportError,
  isHermesMainDocument,
  isHermesNavigation,
  selectIpaAsset,
} from '../src/config';
import { cleartextHttpAllowed } from '../src/api/HermesApiClient';

test('the Hermes origin travels over HTTPS unless it targets a local dev host', () => {
  assert.match(HERMES_ORIGIN, /^https:\/\//);
  assert.equal(HERMES_ORIGIN_TRANSPORT_ERROR, null);
  // The same transport rule that guards normalizeBaseUrl vets the
  // EXPO_PUBLIC_HERMES_URL override at module load.
  assert.equal(cleartextHttpAllowed('localhost'), true);
  assert.equal(cleartextHttpAllowed('127.0.0.1'), true);
  assert.equal(cleartextHttpAllowed('mac-studio.local'), true);
  assert.equal(cleartextHttpAllowed('daxueshenmai.top'), false);
  assert.equal(cleartextHttpAllowed('192.168.1.20'), false);
});

test('a cleartext public origin is recorded for the config screen and names the escape hatches', () => {
  const transportError = hermesOriginTransportError('http://192.168.1.20:3000');
  assert.ok(transportError, 'a non-local http:// origin must be rejected');
  assert.match(transportError, /https:\/\//);
  assert.match(transportError, /EXPO_PUBLIC_HERMES_URL/);
  assert.match(transportError, /EXPO_PUBLIC_HERMES_ALLOW_HTTP=1/);

  // Local development targets and https origins pass without a verdict.
  assert.equal(hermesOriginTransportError('http://localhost:8080'), null);
  assert.equal(hermesOriginTransportError('http://mac-studio.local:3000'), null);
  assert.equal(hermesOriginTransportError('https://daxueshenmai.top'), null);

  // The documented opt-in clears the rejection for LAN dev servers.
  process.env.EXPO_PUBLIC_HERMES_ALLOW_HTTP = '1';
  try {
    assert.equal(hermesOriginTransportError('http://192.168.1.20:3000'), null);
  } finally {
    delete process.env.EXPO_PUBLIC_HERMES_ALLOW_HTTP;
  }
});

test('buildHermesUrl keeps the configured origin and adds app metadata', () => {
  const url = new URL(buildHermesUrl('/chat?session_id=abc'));

  assert.equal(url.origin, 'https://daxueshenmai.top');
  assert.equal(url.pathname, '/chat');
  assert.equal(url.searchParams.get('session_id'), 'abc');
  assert.equal(url.searchParams.get('client'), 'ios');
});

test('isHermesNavigation allows only the Hermes origin and app schemes', () => {
  assert.equal(isHermesNavigation('https://daxueshenmai.top/chat'), true);
  assert.equal(isHermesNavigation('hermes-agent://chat/abc'), true);
  assert.equal(isHermesNavigation('https://github.com/given33/hermes-ios'), false);
});

test('isHermesMainDocument ignores API and asset failures', () => {
  assert.equal(isHermesMainDocument('https://daxueshenmai.top/chat?client=ios'), true);
  assert.equal(isHermesMainDocument('https://daxueshenmai.top/'), true);
  assert.equal(
    isHermesMainDocument('https://daxueshenmai.top/api/plugins/collaboration/route'),
    false,
  );
  assert.equal(isHermesMainDocument('https://daxueshenmai.top/assets/index.js'), false);
  assert.equal(isHermesMainDocument('https://example.test/chat'), false);
});

test('selectIpaAsset chooses an IPA and ignores source archives', () => {
  const asset = selectIpaAsset([
    { name: 'Source code.zip', browser_download_url: 'https://example.test/source.zip' },
    { name: 'Hermes-Agent-unsigned.ipa', browser_download_url: 'https://example.test/app.ipa' },
  ]);

  assert.equal(asset?.browser_download_url, 'https://example.test/app.ipa');
});

test('getDownloadFilename decodes and sanitizes attachment names', () => {
  assert.equal(
    getDownloadFilename('https://daxueshenmai.top/files/%E6%96%B9%E6%A1%88%3A1.pptx'),
    '方案_1.pptx',
  );
  assert.equal(getDownloadFilename('https://daxueshenmai.top/download/'), 'Hermes-文件');
});
