import {
  HERMES_NATIVE_ROUTES,
  type NativeRouteDefinition,
  type NativeRouteId,
} from './route-registry';

export interface PluginManifest {
  name: string;
  label: string;
  description: string;
  icon: string;
  version: string;
  tab: {
    path: string;
    position?: string;
    override?: string;
    hidden?: boolean;
  };
  slots?: string[];
  entry: string;
  css?: string | null;
  has_api: boolean;
  source: string;
  integrity?: string;
}

export const BASELINE_PLUGIN_MANIFESTS = [
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
  {
    name: 'workflows',
    label: '\u5de5\u4f5c\u6d41',
    description:
      'Versioned Hermes DAG workflows compiled to durable Kanban execution.',
    icon: 'Zap',
    version: '1.0.0',
    tab: { path: '/workflows', position: 'after:kanban' },
    slots: [],
    entry: 'dist/index.js?v=1.0.0',
    css: 'dist/style.css?v=1.0.0',
    has_api: true,
    source: 'bundled',
  },
] as const satisfies readonly PluginManifest[];

export const PLUGIN_ICON_NAMES = [
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

export type PluginIconName = (typeof PLUGIN_ICON_NAMES)[number];
export type NativeNavigationIconName =
  | PluginIconName
  | 'Plug'
  | 'Radio'
  | 'Webhook'
  | 'ShieldCheck'
  | 'BookOpen';
export type NativeRouteLocale = 'en' | 'zh';

export interface RouteDashboardConfig {
  dashboard?: unknown;
}

export interface RouteCompositionOptions {
  embeddedChat?: boolean;
  config?: RouteDashboardConfig | null;
  locale?: NativeRouteLocale;
  manifests?: readonly PluginManifest[];
}

export interface ComposedRoute {
  key: string;
  path: string;
  source: 'builtin' | 'plugin';
  routeId?: NativeRouteId;
  pluginName?: string;
  redirectTo?: string;
}

export interface ComposedNavigationItem {
  path: string;
  label: string;
  icon: NativeNavigationIconName;
  source: 'builtin' | 'plugin';
  routeId?: NativeRouteId;
  pluginName?: string;
}

export interface ComposedRouteRegistry {
  routes: ComposedRoute[];
  coreItems: ComposedNavigationItem[];
  pluginItems: ComposedNavigationItem[];
}

interface BuiltinNavigationDefinition {
  routeId: NativeRouteId;
  path: string;
  labels: Record<NativeRouteLocale, string>;
  icon: NativeNavigationIconName;
}

const CHAT_NAV_ITEM: BuiltinNavigationDefinition = {
  routeId: 'chat',
  path: '/chat',
  labels: { en: 'Chat', zh: '\u5355\u804a' },
  icon: 'Terminal',
};

const BUILTIN_NAV_REST = [
  {
    routeId: 'sessions',
    path: '/sessions',
    labels: { en: 'Sessions', zh: '\u4f1a\u8bdd' },
    icon: 'MessageSquare',
  },
  {
    routeId: 'analytics',
    path: '/analytics',
    labels: { en: 'Analytics', zh: '\u5206\u6790' },
    icon: 'BarChart3',
  },
  {
    routeId: 'smart-weather',
    path: '/smart-weather',
    labels: { en: 'Smart Weather', zh: '\u667a\u80fd\u5929\u6c14' },
    icon: 'Globe',
  },
  {
    routeId: 'models',
    path: '/models',
    labels: { en: 'Models', zh: '\u6a21\u578b' },
    icon: 'Cpu',
  },
  {
    routeId: 'logs',
    path: '/logs',
    labels: { en: 'Logs', zh: '\u65e5\u5fd7' },
    icon: 'FileText',
  },
  {
    routeId: 'cron',
    path: '/cron',
    labels: { en: 'Cron', zh: '\u5b9a\u65f6\u4efb\u52a1' },
    icon: 'Clock',
  },
  {
    routeId: 'skills',
    path: '/skills',
    labels: { en: 'Skills', zh: '\u6280\u80fd' },
    icon: 'Package',
  },
  {
    routeId: 'mcp',
    path: '/mcp',
    labels: { en: 'MCP', zh: 'MCP' },
    icon: 'Plug',
  },
  {
    routeId: 'channels',
    path: '/channels',
    labels: { en: 'Channels', zh: '\u6d88\u606f\u6e20\u9053' },
    icon: 'Radio',
  },
  {
    routeId: 'webhooks',
    path: '/webhooks',
    labels: { en: 'Webhooks', zh: '\u7f51\u7edc\u94a9\u5b50' },
    icon: 'Webhook',
  },
  {
    routeId: 'pairing',
    path: '/pairing',
    labels: { en: 'Pairing', zh: '\u8bbe\u5907\u914d\u5bf9' },
    icon: 'ShieldCheck',
  },
  {
    routeId: 'profiles',
    path: '/profiles',
    labels: { en: 'Profiles', zh: '\u591aAgent\u914d\u7f6e' },
    icon: 'Users',
  },
  {
    routeId: 'config',
    path: '/config',
    labels: { en: 'Config', zh: '\u914d\u7f6e' },
    icon: 'Settings',
  },
  {
    routeId: 'account',
    path: '/account',
    labels: { en: 'Account', zh: '\u8d26\u6237' },
    icon: 'Users',
  },
  {
    routeId: 'approvals',
    path: '/approvals',
    labels: { en: 'Approvals', zh: '\u5ba1\u6279\u4e2d\u5fc3' },
    icon: 'ShieldCheck',
  },
  {
    routeId: 'runtime-center',
    path: '/runtime-center',
    labels: { en: 'Runtime Center', zh: '\u8fd0\u884c\u4e2d\u5fc3' },
    icon: 'Activity',
  },
  {
    routeId: 'env',
    path: '/env',
    labels: { en: 'Keys', zh: '\u5bc6\u94a5' },
    icon: 'KeyRound',
  },
  {
    routeId: 'system',
    path: '/system',
    labels: { en: 'System', zh: '\u7cfb\u7edf\u76d1\u63a7' },
    icon: 'Wrench',
  },
  {
    routeId: 'docs',
    path: '/docs',
    labels: { en: 'Documentation', zh: '\u6587\u6863' },
    icon: 'BookOpen',
  },
] as const satisfies readonly BuiltinNavigationDefinition[];

const PLUGIN_ICON_SET: ReadonlySet<string> = new Set(PLUGIN_ICON_NAMES);
const CHAT_ROUTE = HERMES_NATIVE_ROUTES[HERMES_NATIVE_ROUTES.length - 1];

export function resolvePluginIcon(name: string): PluginIconName {
  return PLUGIN_ICON_SET.has(name) ? (name as PluginIconName) : 'Puzzle';
}

export function composeRouteRegistry(
  options: RouteCompositionOptions = {},
): ComposedRouteRegistry {
  const embeddedChat = options.embeddedChat ?? true;
  const locale = options.locale ?? 'en';
  const manifests = options.manifests ?? [];
  const builtinRoutes = getBuiltinRoutes(embeddedChat);
  const builtinNav = getBuiltinNavigation(
    embeddedChat,
    isTokenAnalyticsEnabled(options.config),
    locale,
  );
  const { coreItems, pluginItems } = partitionSidebarNav(
    builtinNav,
    manifests,
  );

  return {
    routes: buildRoutes(builtinRoutes, manifests),
    coreItems,
    pluginItems,
  };
}

function getBuiltinRoutes(embeddedChat: boolean): NativeRouteDefinition[] {
  const coreRoutes: NativeRouteDefinition[] = HERMES_NATIVE_ROUTES.filter(
    (route) => route.id !== 'chat',
  );
  return embeddedChat ? [...coreRoutes, CHAT_ROUTE] : coreRoutes;
}

function isTokenAnalyticsEnabled(
  config: RouteDashboardConfig | null | undefined,
): boolean {
  const dashboard = config?.dashboard;
  if (!dashboard || typeof dashboard !== 'object') return false;
  return (
    (dashboard as Record<string, unknown>).show_token_analytics === true
  );
}

function getBuiltinNavigation(
  embeddedChat: boolean,
  showTokenAnalytics: boolean,
  locale: NativeRouteLocale,
): ComposedNavigationItem[] {
  const definitions = embeddedChat
    ? [CHAT_NAV_ITEM, ...BUILTIN_NAV_REST]
    : [...BUILTIN_NAV_REST];
  const visibleDefinitions = showTokenAnalytics
    ? definitions
    : definitions.filter((item) => item.path !== '/analytics');

  return visibleDefinitions.map((item) => ({
    path: item.path,
    label: item.labels[locale],
    icon: item.icon,
    source: 'builtin',
    routeId: item.routeId,
  }));
}

function buildNavItems(
  builtIn: readonly ComposedNavigationItem[],
  manifests: readonly PluginManifest[],
): ComposedNavigationItem[] {
  const items = [...builtIn];

  for (const manifest of manifests) {
    if (manifest.tab.override) continue;
    if (manifest.tab.hidden) continue;
    if (manifest.tab.path === '/plugins') continue;

    const pluginItem: ComposedNavigationItem = {
      path: manifest.tab.path,
      label: manifest.label,
      icon: resolvePluginIcon(manifest.icon),
      source: 'plugin',
      pluginName: manifest.name,
    };
    const position = manifest.tab.position ?? 'end';

    if (position === 'end') {
      items.push(pluginItem);
    } else if (position.startsWith('after:')) {
      const target = `/${position.slice(6)}`;
      const index = items.findIndex((item) => item.path === target);
      items.splice(index >= 0 ? index + 1 : items.length, 0, pluginItem);
    } else if (position.startsWith('before:')) {
      const target = `/${position.slice(7)}`;
      const index = items.findIndex((item) => item.path === target);
      items.splice(index >= 0 ? index : items.length, 0, pluginItem);
    } else {
      items.push(pluginItem);
    }
  }

  return items;
}

function partitionSidebarNav(
  builtIn: readonly ComposedNavigationItem[],
  manifests: readonly PluginManifest[],
): Pick<ComposedRouteRegistry, 'coreItems' | 'pluginItems'> {
  const merged = buildNavItems(builtIn, manifests);
  const builtinPaths = new Set(builtIn.map((item) => item.path));
  const coreItems: ComposedNavigationItem[] = [];
  const pluginItems: ComposedNavigationItem[] = [];

  for (const item of merged) {
    if (builtinPaths.has(item.path)) coreItems.push(item);
    else pluginItems.push(item);
  }

  return { coreItems, pluginItems };
}

/** Map bundled plugin package names to the SwiftUI / HermesCloudApi route ids. */
const PLUGIN_ROUTE_IDS: Readonly<Record<string, NativeRouteId>> = {
  collaboration: 'collaboration',
  'hermes-achievements': 'achievements',
  kanban: 'kanban',
  workflows: 'workflows',
};

function pluginRouteId(name: string): NativeRouteId | undefined {
  return PLUGIN_ROUTE_IDS[name];
}

function buildRoutes(
  builtinRoutes: readonly NativeRouteDefinition[],
  manifests: readonly PluginManifest[],
): ComposedRoute[] {
  const byOverride = new Map<string, PluginManifest>();
  const addons: PluginManifest[] = [];

  for (const manifest of manifests) {
    if (manifest.tab.override) {
      byOverride.set(manifest.tab.override, manifest);
    } else {
      addons.push(manifest);
    }
  }

  const routes: ComposedRoute[] = [];
  const builtinPaths = new Set(builtinRoutes.map((route) => route.path));

  for (const route of builtinRoutes) {
    const override = byOverride.get(route.path);
    if (override) {
      routes.push({
        key: `override:${override.name}`,
        path: route.path,
        source: 'plugin',
        // Preserve the builtin data route so SwiftUI/API loaders still resolve.
        routeId: route.id,
        pluginName: override.name,
      });
    } else {
      routes.push({
        key: `builtin:${route.path}`,
        path: route.path,
        source: 'builtin',
        routeId: route.id,
        redirectTo: route.redirectTo,
      });
    }
  }

  for (const manifest of addons) {
    if (manifest.tab.hidden) continue;
    if (manifest.tab.path === '/plugins') continue;
    if (builtinPaths.has(manifest.tab.path)) continue;
    const routeId = pluginRouteId(manifest.name);
    routes.push({
      key: `plugin:${manifest.name}`,
      path: manifest.tab.path,
      source: 'plugin',
      pluginName: manifest.name,
      ...(routeId ? { routeId } : {}),
    });
  }

  for (const manifest of manifests) {
    if (!manifest.tab.hidden) continue;
    if (manifest.tab.path === '/plugins') continue;
    if (builtinPaths.has(manifest.tab.path) || manifest.tab.override) continue;
    const routeId = pluginRouteId(manifest.name);
    routes.push({
      key: `plugin:hidden:${manifest.name}`,
      path: manifest.tab.path,
      source: 'plugin',
      pluginName: manifest.name,
      ...(routeId ? { routeId } : {}),
    });
  }

  return routes;
}
