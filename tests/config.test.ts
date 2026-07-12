import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHermesUrl,
  getDownloadFilename,
  isHermesNavigation,
  selectIpaAsset,
} from '../src/config';

test('buildHermesUrl keeps the configured origin and adds app metadata', () => {
  const url = new URL(buildHermesUrl('/chat?session_id=abc'));

  assert.equal(url.origin, 'https://8.138.40.16');
  assert.equal(url.pathname, '/chat');
  assert.equal(url.searchParams.get('session_id'), 'abc');
  assert.equal(url.searchParams.get('client'), 'ios');
});

test('isHermesNavigation allows only the Hermes origin and app schemes', () => {
  assert.equal(isHermesNavigation('https://8.138.40.16/chat'), true);
  assert.equal(isHermesNavigation('hermes-agent://chat/abc'), true);
  assert.equal(isHermesNavigation('https://github.com/given33/hermes-ios'), false);
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
    getDownloadFilename('https://8.138.40.16/files/%E6%96%B9%E6%A1%88%3A1.pptx'),
    '方案_1.pptx',
  );
  assert.equal(getDownloadFilename('https://8.138.40.16/download/'), 'Hermes-文件');
});
