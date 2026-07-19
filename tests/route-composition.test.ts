import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASELINE_PLUGIN_MANIFESTS,
  composeRouteRegistry,
  resolvePluginIcon,
  type PluginManifest,
} from '../src/app/route-composition';
import { HERMES_NATIVE_ROUTES } from '../src/app/route-registry';

const CORE_ROUTE_PATHS = [
  '/',
  '/sessions',
  '/files',
  '/analytics',
  '/smart-weather',
  '/models',
  '/logs',
  '/cron',
  '/skills',
  '/plugins',
  '/mcp',
  '/pairing',
  '/channels',
  '/webhooks',
  '/system',
  '/profiles',
  '/profiles/new',
  '/config',
  '/account',
  '/env',
  '/docs',
] as const;

const CORE_NAV_PATHS = [
  '/sessions',
  '/analytics',
  '/smart-weather',
  '/models',
  '/logs',
  '/cron',
  '/skills',
  '/mcp',
  '/channels',
  '/webhooks',
  '/pairing',
  '/profiles',
  '/config',
  '/account',
  '/env',
  '/system',
  '/docs',
] as const;

const CORE_NAV_ICONS = [
  'MessageSquare',
  'BarChart3',
  'Globe',
  'Cpu',
  'FileText',
  'Clock',
  'Package',
  'Plug',
  'Radio',
  'Webhook',
  'ShieldCheck',
  'Users',
  'Settings',
  'Users',
  'KeyRound',
  'Wrench',
  'BookOpen',
] as const;

const ENGLISH_NAV_LABELS = [
  'Sessions',
  'Analytics',
  'Smart Weather',
  'Models',
  'Logs',
  'Cron',
  'Skills',
  'MCP',
  'Channels',
  'Webhooks',
  'Pairing',
  'Profiles',
  'Config',
  'Account',
  'Keys',
  'System',
  'Documentation',
] as const;

const CHINESE_NAV_LABELS = [
  '\u4f1a\u8bdd',
  '\u5206\u6790',
  '\u667a\u80fd\u5929\u6c14',
  '\u6a21\u578b',
  '\u65e5\u5fd7',
  '\u5b9a\u65f6\u4efb\u52a1',
  '\u6280\u80fd',
  'MCP',
  '\u6d88\u606f\u6e20\u9053',
  '\u7f51\u7edc\u94a9\u5b50',
  '\u8bbe\u5907\u914d\u5bf9',
  '\u591aAgent\u914d\u7f6e',
  '\u914d\u7f6e',
  '\u8d26\u6237',
  '\u5bc6\u94a5',
  '\u7cfb\u7edf\u76d1\u63a7',
  '\u6587\u6863',
] as const;

function plugin(
  name: string,
  path: string,
  tab: Omit<PluginManifest['tab'], 'path'> = {},
  icon = 'Star',
): PluginManifest {
  return {
    name,
    label: name,
    description: `${name} test plugin`,
    icon,
    version: '1.0.0',
    tab: { path, ...tab },
    slots: [],
    entry: 'dist/index.js',
    css: null,
    has_api: false,
    source: 'test',
  };
}

function navProjection(
  items: ReturnType<typeof composeRouteRegistry>['coreItems'],
) {
  return items.map(({ path, label, icon }) => ({ path, label, icon }));
}

test('freezes the customized WebUI built-in route map without bundled plugins', () => {
  assert.deepEqual(
    HERMES_NATIVE_ROUTES.map((route) => route.path),
    [...CORE_ROUTE_PATHS, '/chat'],
  );
  assert.deepEqual(
    HERMES_NATIVE_ROUTES.filter((route) => route.visibleInSidebar)
      .map((route) => route.path)
      .sort(),
    [...CORE_NAV_PATHS, '/chat'].sort(),
  );
  assert.deepEqual(HERMES_NATIVE_ROUTES[0], {
    id: 'root',
    path: '/',
    redirectTo: '/sessions',
    visibleInSidebar: false,
  });
  assert.equal(
    HERMES_NATIVE_ROUTES.find((route) => route.path === '/files')
      ?.visibleInSidebar,
    false,
  );
  assert.equal(
    HERMES_NATIVE_ROUTES.find((route) => route.path === '/profiles/new')
      ?.visibleInSidebar,
    false,
  );
  assert.equal(
    HERMES_NATIVE_ROUTES.find((route) => route.path === '/plugins')
      ?.visibleInSidebar,
    false,
  );
  assert.equal(
    HERMES_NATIVE_ROUTES.some((route) =>
      ['/kanban', '/achievements', '/collaboration'].includes(
        route.path,
      ),
    ),
    false,
  );
});

test('freezes bundled manifests as plugin inputs in discovery order', () => {
  assert.deepEqual(BASELINE_PLUGIN_MANIFESTS, [
    {
      name: 'collaboration',
      label: '\u7fa4\u804a\u4e0e\u5de5\u4f5c\u6d41',
      description:
        'Hermes \u591a Profile \u7fa4\u804a\u4e0e Kanban \u5de5\u4f5c\u6d41\u754c\u9762\u3002',
      icon: 'MessagesSquare',
      version: '2.1.36',
      tab: {
        path: '/collaboration',
        position: 'after:chat',
        hidden: true,
      },
      slots: ['chat:top'],
      entry: 'dist/index.js?v=2.1.36',
      css: 'dist/style.css?v=2.1.36',
      has_api: true,
      source: 'bundled',
    },
    {
      name: 'hermes-achievements',
      label: '\u6210\u5c31',
      description:
        'Steam-style achievements for vibe coding and agentic Hermes workflows.',
      icon: 'Star',
      version: '0.4.0',
      tab: { path: '/achievements', position: 'after:analytics' },
      slots: [],
      entry: 'dist/index.js',
      css: 'dist/style.css',
      has_api: true,
      source: 'bundled',
    },
    {
      name: 'kanban',
      label: '\u770b\u677f',
      description:
        'Multi-agent collaboration board \u2014 drag-drop cards across columns, read comment threads, see which profile is running what',
      icon: 'Package',
      version: '1.0.1',
      tab: { path: '/kanban', position: 'after:skills' },
      slots: [],
      entry: 'dist/index.js?v=1.0.1',
      css: 'dist/style.css?v=1.0.1',
      has_api: true,
      source: 'bundled',
    },
  ]);
});

test('starts with no plugins until server manifests are provided', () => {
  const composition = composeRouteRegistry();

  assert.equal(composition.pluginItems.length, 0);
  assert.equal(
    composition.routes.some((route) => route.source === 'plugin'),
    false,
  );
});

test('composes conditional chat and strictly boolean-gated analytics navigation', () => {
  const withoutFlags = composeRouteRegistry({ manifests: [] });
  assert.equal(withoutFlags.routes.some((route) => route.path === '/chat'), true);
  assert.equal(withoutFlags.coreItems[0]?.path, '/chat');
  assert.equal(
    withoutFlags.routes.some((route) => route.path === '/analytics'),
    true,
  );
  assert.equal(
    withoutFlags.coreItems.some((item) => item.path === '/analytics'),
    false,
  );

  const chatDisabled = composeRouteRegistry({
    embeddedChat: false,
    manifests: [],
  });
  assert.equal(chatDisabled.routes.some((route) => route.path === '/chat'), false);
  assert.equal(
    chatDisabled.coreItems.some((item) => item.path === '/chat'),
    false,
  );

  for (const value of ['true', 1, false, null, undefined]) {
    const composition = composeRouteRegistry({
      manifests: [],
      config: { dashboard: { show_token_analytics: value } },
    });
    assert.equal(
      composition.coreItems.some((item) => item.path === '/analytics'),
      false,
    );
  }

  const enabled = composeRouteRegistry({
    embeddedChat: true,
    manifests: [],
    config: { dashboard: { show_token_analytics: true } },
  });
  assert.deepEqual(
    enabled.routes.map((route) => route.path),
    [...CORE_ROUTE_PATHS, '/chat'],
  );
  assert.deepEqual(
    enabled.coreItems.map((item) => item.path),
    ['/chat', ...CORE_NAV_PATHS],
  );
  assert.equal(enabled.routes.at(-1)?.key, 'builtin:/chat');
});

test('composes exact English and Chinese core labels and icons', () => {
  const config = { dashboard: { show_token_analytics: true } };
  const english = composeRouteRegistry({
    embeddedChat: true,
    manifests: [],
    config,
    locale: 'en',
  });
  assert.deepEqual(navProjection(english.coreItems), [
    { path: '/chat', label: 'Chat', icon: 'Terminal' },
    ...CORE_NAV_PATHS.map((path, index) => ({
      path,
      label: ENGLISH_NAV_LABELS[index],
      icon: CORE_NAV_ICONS[index],
    })),
  ]);

  const chinese = composeRouteRegistry({
    embeddedChat: true,
    manifests: [],
    config,
    locale: 'zh',
  });
  assert.deepEqual(navProjection(chinese.coreItems), [
    { path: '/chat', label: '\u5355\u804a', icon: 'Terminal' },
    ...CORE_NAV_PATHS.map((path, index) => ({
      path,
      label: CHINESE_NAV_LABELS[index],
      icon: CORE_NAV_ICONS[index],
    })),
  ]);
});

test('baseline plugin positions are applied before sidebar partitioning', () => {
  const analyticsHidden = composeRouteRegistry({
    embeddedChat: true,
    manifests: BASELINE_PLUGIN_MANIFESTS,
  });
  assert.deepEqual(
    analyticsHidden.pluginItems.map((item) => item.path),
    ['/kanban', '/achievements'],
  );
  assert.equal(
    analyticsHidden.coreItems.some((item) => item.path === '/collaboration'),
    false,
  );
  assert.equal(
    analyticsHidden.pluginItems.some((item) => item.path === '/collaboration'),
    false,
  );

  const analyticsVisible = composeRouteRegistry({
    embeddedChat: true,
    manifests: BASELINE_PLUGIN_MANIFESTS,
    config: { dashboard: { show_token_analytics: true } },
  });
  assert.deepEqual(
    analyticsVisible.pluginItems.map((item) => item.path),
    ['/achievements', '/kanban'],
  );
  assert.deepEqual(
    analyticsVisible.routes.slice(-3).map(({ key, path, pluginName, routeId }) => ({
      key,
      path,
      pluginName,
      routeId,
    })),
    [
      {
        key: 'plugin:hermes-achievements',
        path: '/achievements',
        pluginName: 'hermes-achievements',
        routeId: 'achievements',
      },
      {
        key: 'plugin:kanban',
        path: '/kanban',
        pluginName: 'kanban',
        routeId: 'kanban',
      },
      {
        key: 'plugin:hidden:collaboration',
        path: '/collaboration',
        pluginName: 'collaboration',
        routeId: 'collaboration',
      },
    ],
  );
  assert.equal(
    analyticsVisible.routes.some((route) => 'hidden' in route),
    false,
  );
  assert.deepEqual(BASELINE_PLUGIN_MANIFESTS[0].slots, ['chat:top']);
});

test('navigation preserves position hints, duplicates, and built-in collisions', () => {
  const manifests = [
    plugin('after-skills', '/after-skills', { position: 'after:skills' }),
    plugin('before-models', '/before-models', { position: 'before:models' }),
    plugin('missing-target', '/missing-target', { position: 'after:missing' }),
    plugin('invalid-position', '/invalid-position', { position: 'middle' }),
    plugin('implicit-end', '/implicit-end'),
    plugin('override', '/override-tab', { override: '/logs' }),
    plugin('hidden', '/hidden-tab', { hidden: true }),
    plugin('collision', '/sessions', { position: 'after:sessions' }),
    plugin('duplicate-one', '/duplicate', { position: 'before:models' }),
    plugin('duplicate-two', '/duplicate', { position: 'before:models' }),
  ];
  const snapshot = structuredClone(manifests);
  const composition = composeRouteRegistry({
    manifests,
    config: { dashboard: { show_token_analytics: true } },
  });

  assert.deepEqual(manifests, snapshot);
  assert.deepEqual(
    composition.pluginItems.map((item) => item.path),
    [
      '/before-models',
      '/duplicate',
      '/duplicate',
      '/after-skills',
      '/missing-target',
      '/invalid-position',
      '/implicit-end',
    ],
  );
  assert.deepEqual(
    composition.coreItems.filter((item) => item.path === '/sessions').map(
      (item) => item.source,
    ),
    ['builtin', 'plugin'],
  );
  assert.equal(
    composition.pluginItems.some((item) => item.path === '/override-tab'),
    false,
  );
  assert.equal(
    composition.pluginItems.some((item) => item.path === '/hidden-tab'),
    false,
  );
});

test('routes preserve reachability independently from sidebar visibility', () => {
  const manifests = [
    plugin('first-override', '/unused-first', { override: '/sessions' }),
    plugin('last-override', '/unused-last', { override: '/sessions' }),
    plugin('hidden-override', '/unused-hidden', {
      override: '/models',
      hidden: true,
    }),
    plugin('unknown-override', '/unused-unknown', { override: '/unknown' }),
    plugin('duplicate', '/addon'),
    plugin('duplicate', '/addon'),
    plugin('plugins-collision', '/plugins'),
    plugin('builtin-collision', '/logs'),
    plugin('hidden-addon', '/hidden-addon', { hidden: true }),
    plugin('hidden-builtin', '/skills', { hidden: true }),
    plugin('hidden-plugins', '/plugins', { hidden: true }),
    plugin('hidden-unknown-override', '/unused-hidden-unknown', {
      override: '/also-unknown',
      hidden: true,
    }),
  ];
  const composition = composeRouteRegistry({ manifests });

  assert.deepEqual(
    composition.routes
      .filter((route) => ['/sessions', '/models'].includes(route.path))
      .map(({ key, path, pluginName }) => ({
        key,
        path,
        pluginName,
      })),
    [
      {
        key: 'override:last-override',
        path: '/sessions',
        pluginName: 'last-override',
      },
      {
        key: 'override:hidden-override',
        path: '/models',
        pluginName: 'hidden-override',
      },
    ],
  );
  assert.deepEqual(
    composition.routes.find((route) => route.path === '/models'),
    {
      key: 'override:hidden-override',
      path: '/models',
      source: 'plugin',
      // Overrides keep the builtin data route id so SwiftUI/API loaders resolve.
      routeId: 'models',
      pluginName: 'hidden-override',
    },
  );
  assert.deepEqual(
    composition.coreItems.find((item) => item.path === '/models'),
    {
      path: '/models',
      label: 'Models',
      icon: 'Cpu',
      source: 'builtin',
      routeId: 'models',
    },
  );
  assert.deepEqual(
    composition.routes.find((route) => route.path === '/hidden-addon'),
    {
      key: 'plugin:hidden:hidden-addon',
      path: '/hidden-addon',
      source: 'plugin',
      pluginName: 'hidden-addon',
    },
  );
  assert.equal(
    [...composition.coreItems, ...composition.pluginItems].some(
      (item) => item.path === '/hidden-addon',
    ),
    false,
  );
  assert.equal(
    [...composition.coreItems, ...composition.pluginItems].some(
      (item) => item.path === '/plugins',
    ),
    false,
  );
  assert.equal(
    composition.routes.some((route) => 'hidden' in route),
    false,
  );
  assert.deepEqual(
    composition.routes.slice(-3).map(({ key, path }) => ({ key, path })),
    [
      { key: 'plugin:duplicate', path: '/addon' },
      { key: 'plugin:duplicate', path: '/addon' },
      { key: 'plugin:hidden:hidden-addon', path: '/hidden-addon' },
    ],
  );
  for (const name of [
    'first-override',
    'unknown-override',
    'plugins-collision',
    'builtin-collision',
    'hidden-builtin',
    'hidden-plugins',
    'hidden-unknown-override',
  ]) {
    assert.equal(
      composition.routes.some((route) => route.pluginName === name),
      false,
    );
  }
});

test('plugin icons use the exact WebUI allow-list and Puzzle fallback', () => {
  const allowed = [
    'Activity',
    'BarChart3',
    'Clock',
    'Cpu',
    'FileText',
    'FolderOpen',
    'KeyRound',
    'MessageSquare',
    'Package',
    'Settings',
    'Puzzle',
    'Sparkles',
    'Terminal',
    'Globe',
    'Database',
    'Shield',
    'Users',
    'Wrench',
    'Zap',
    'Heart',
    'Star',
    'Code',
    'Eye',
  ] as const;

  for (const icon of allowed) assert.equal(resolvePluginIcon(icon), icon);
  for (const icon of ['Plug', 'MessagesSquare', '', 'activity']) {
    assert.equal(resolvePluginIcon(icon), 'Puzzle');
  }
});
