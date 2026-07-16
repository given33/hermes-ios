import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHermesUrl,
  getDownloadFilename,
  isHermesMainDocument,
  isHermesNavigation,
  selectIpaAsset,
} from '../src/config';

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
