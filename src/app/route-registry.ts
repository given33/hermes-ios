export type NativeRouteId =
  | 'root'
  | 'sessions'
  | 'files'
  | 'analytics'
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
  | 'profile-new'
  | 'config'
  | 'env'
  | 'docs'
  | 'chat';

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
    redirectTo: '/sessions',
    visibleInSidebar: false,
  },
  { id: 'sessions', path: '/sessions', visibleInSidebar: true },
  { id: 'files', path: '/files', visibleInSidebar: false },
  { id: 'analytics', path: '/analytics', visibleInSidebar: true },
  { id: 'models', path: '/models', visibleInSidebar: true },
  { id: 'logs', path: '/logs', visibleInSidebar: true },
  { id: 'cron', path: '/cron', visibleInSidebar: true },
  { id: 'skills', path: '/skills', visibleInSidebar: true },
  { id: 'plugins', path: '/plugins', visibleInSidebar: true },
  { id: 'mcp', path: '/mcp', visibleInSidebar: true },
  { id: 'pairing', path: '/pairing', visibleInSidebar: true },
  { id: 'channels', path: '/channels', visibleInSidebar: true },
  { id: 'webhooks', path: '/webhooks', visibleInSidebar: true },
  { id: 'system', path: '/system', visibleInSidebar: true },
  { id: 'profiles', path: '/profiles', visibleInSidebar: true },
  { id: 'profile-new', path: '/profiles/new', visibleInSidebar: false },
  { id: 'config', path: '/config', visibleInSidebar: true },
  { id: 'env', path: '/env', visibleInSidebar: true },
  { id: 'docs', path: '/docs', visibleInSidebar: true },
  { id: 'chat', path: '/chat', visibleInSidebar: true },
] as const satisfies readonly NativeRouteDefinition[];

export type NativeRoutePath = (typeof HERMES_NATIVE_ROUTES)[number]['path'];
