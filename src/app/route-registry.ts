export interface NativeRouteDefinition {
  id: 'chat' | 'sessions' | 'models' | 'logs' | 'cron' | 'skills' | 'plugins' |
    'mcp' | 'channels' | 'webhooks' | 'pairing' | 'profiles' | 'config' | 'env' |
    'system' | 'docs' | 'kanban' | 'achievements';
  label: string;
  title: string;
}

export const HERMES_NATIVE_ROUTES = [
  { id: 'chat', label: '单聊', title: '单聊' },
  { id: 'sessions', label: '会话', title: '会话' },
  { id: 'models', label: '模型', title: '模型' },
  { id: 'logs', label: '日志', title: '日志' },
  { id: 'cron', label: '定时任务', title: '定时任务' },
  { id: 'skills', label: '技能', title: '技能' },
  { id: 'plugins', label: '插件管理', title: '插件管理' },
  { id: 'mcp', label: 'MCP', title: 'MCP' },
  { id: 'channels', label: '消息渠道', title: '消息渠道' },
  { id: 'webhooks', label: '网络钩子', title: '网络钩子' },
  { id: 'pairing', label: '设备配对', title: '设备配对' },
  { id: 'profiles', label: '多Agent配置', title: '多Agent配置' },
  { id: 'config', label: '配置', title: '配置' },
  { id: 'env', label: '密钥', title: '密钥' },
  { id: 'system', label: '系统监控', title: '系统监控' },
  { id: 'docs', label: '文档', title: '文档' },
  { id: 'kanban', label: '看板', title: '看板' },
  { id: 'achievements', label: '成就', title: '成就' },
] as const satisfies readonly NativeRouteDefinition[];
