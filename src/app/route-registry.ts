export type NativeRouteId =
  | 'root'
  | 'sessions'
  | 'memory'
  | 'files'
  | 'git'
  | 'analytics'
  | 'smart-weather'
  | 'browser'
  | 'models'
  | 'logs'
  | 'cron'
  | 'skills'
  | 'plugins'
  | 'mcp'
  | 'pairing'
  | 'channels'
  | 'webhooks'
  | 'system'
  | 'profiles'
  | 'bots'
  | 'profile-new'
  | 'config'
  | 'account'
  | 'env'
  | 'docs'
  | 'chat'
  | 'agent-group'
  | 'durable-group-chat'
  | 'agent-workspace'
  | 'achievements'
  | 'kanban'
  | 'collaboration'
  | 'workflows'
  | 'approvals'
  | 'agent-hub'
  | 'runtime-center';

export interface NativeRouteDefinition {
  id: NativeRouteId;
  path: string;
  visibleInSidebar: boolean;
  redirectTo?: string;
}

export const HERMES_NATIVE_ROUTES = [
  {
    id: 'root',
    path: '/',
    redirectTo: '/chat',
    visibleInSidebar: false,
  },
  { id: 'sessions', path: '/sessions', visibleInSidebar: false },
  { id: 'memory', path: '/memory', visibleInSidebar: true },
  { id: 'files', path: '/files', visibleInSidebar: false },
  { id: 'git', path: '/git', visibleInSidebar: true },
  { id: 'analytics', path: '/analytics', visibleInSidebar: true },
  { id: 'smart-weather', path: '/smart-weather', visibleInSidebar: true },
  { id: 'browser', path: '/browser', visibleInSidebar: true },
  { id: 'models', path: '/models', visibleInSidebar: true },
  { id: 'logs', path: '/logs', visibleInSidebar: true },
  { id: 'cron', path: '/cron', visibleInSidebar: true },
  { id: 'skills', path: '/skills', visibleInSidebar: true },
  { id: 'plugins', path: '/plugins', visibleInSidebar: false },
  { id: 'mcp', path: '/mcp', visibleInSidebar: true },
  { id: 'pairing', path: '/pairing', visibleInSidebar: true },
  { id: 'channels', path: '/channels', visibleInSidebar: true },
  { id: 'webhooks', path: '/webhooks', visibleInSidebar: true },
  { id: 'system', path: '/system', visibleInSidebar: true },
  { id: 'profiles', path: '/profiles', visibleInSidebar: true },
  { id: 'bots', path: '/bots', visibleInSidebar: true },
  { id: 'profile-new', path: '/profiles/new', visibleInSidebar: false },
  { id: 'config', path: '/config', visibleInSidebar: true },
  { id: 'account', path: '/account', visibleInSidebar: true },
  { id: 'approvals', path: '/approvals', visibleInSidebar: true },
  { id: 'agent-hub', path: '/agent-hub', visibleInSidebar: true },
  { id: 'runtime-center', path: '/runtime-center', visibleInSidebar: true },
  { id: 'env', path: '/env', visibleInSidebar: true },
  { id: 'docs', path: '/docs', visibleInSidebar: true },
  { id: 'agent-group', path: '/agent-group', visibleInSidebar: true },
  { id: 'durable-group-chat', path: '/durable-group-chat', visibleInSidebar: true },
  { id: 'agent-workspace', path: '/agent-workspace', visibleInSidebar: true },
  { id: 'chat', path: '/chat', visibleInSidebar: true },
] as const satisfies readonly NativeRouteDefinition[];

export type NativeRoutePath = (typeof HERMES_NATIVE_ROUTES)[number]['path'];

/**
 * Route names used by the official desktop shell that are intentionally
 * overlays (or historical names) rather than separate mobile screens.
 *
 * Desktop notifications, copied links, and server-side redirects can still
 * hand the iOS client `/artifacts`, `/messaging`, etc.  Falling through to
 * `/chat` made those links look broken even though the mobile equivalent was
 * already implemented.  Resolve them at the navigation boundary so we keep
 * one canonical API/config implementation per feature.
 */
export const HERMES_DESKTOP_ROUTE_ALIASES = {
  '/agents': '/agent-hub',
  '/artifacts': '/files',
  '/command-center': '/sessions',
  '/messaging': '/channels',
  '/settings': '/config',
  '/starmap': '/skills',
} as const satisfies Readonly<Record<string, NativeRoutePath>>;

export type HermesDesktopRouteAlias = keyof typeof HERMES_DESKTOP_ROUTE_ALIASES;
