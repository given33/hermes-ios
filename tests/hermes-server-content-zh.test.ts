import assert from 'node:assert/strict';
import test from 'node:test';

import {
  localizeHermesIntegrationDescription,
  localizeHermesIntegrationName,
  localizeHermesServerText,
} from '../src/i18n/hermes-server-content-zh';

test('official Hermes metadata and known log phrases have deterministic Chinese labels', () => {
  assert.equal(localizeHermesServerText('Browser', true), '浏览器');
  assert.equal(
    localizeHermesServerText('Search and inspect web content', true),
    '搜索并查看网页内容',
  );
  assert.equal(localizeHermesServerText('reviewer', true), '审阅员');
  assert.equal(localizeHermesServerText('in_progress', true), '进行中');
  assert.equal(
    localizeHermesServerText('WebSocket client connected profile=default', true),
    'WebSocket 客户端已连接 profile=default',
  );
});

test('official plugin metadata receives stable category-aware Chinese copy', () => {
  assert.equal(
    localizeHermesIntegrationName('disk-cleanup', 'disk-cleanup', 'plugins', true),
    '临时文件清理',
  );
  assert.equal(
    localizeHermesIntegrationDescription(
      'disk-cleanup',
      'Auto-track and clean up ephemeral files created during Hermes sessions.',
      'plugins',
      true,
    ),
    '自动跟踪并清理 Hermes 会话产生的测试脚本、临时输出和定时任务日志。',
  );
  assert.equal(
    localizeHermesIntegrationName('browser-firecrawl', 'browser-firecrawl', 'plugins', true),
    'Firecrawl 浏览器后端',
  );
  assert.equal(
    localizeHermesIntegrationDescription('filesystem', 'npx server-filesystem', 'mcp', true),
    'npx server-filesystem',
  );
});

test('English mode and user-authored content remain unchanged', () => {
  assert.equal(localizeHermesServerText('Browser', false), 'Browser');
  assert.equal(localizeHermesServerText('用户自己的 Project Phoenix', true), '用户自己的 Project Phoenix');
});
