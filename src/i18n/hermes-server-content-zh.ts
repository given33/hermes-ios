const EXACT_TRANSLATIONS: Readonly<Record<string, string>> = Object.freeze({
  browser: '浏览器',
  terminal: '终端',
  notes: '笔记',
  collaboration: '协作',
  'hermes achievements': 'Hermes 成就',
  kanban: '看板',
  filesystem: '文件系统',
  memory: '记忆',
  default: '主 Agent',
  researcher: '研究员',
  coder: '开发者',
  reviewer: '审阅员',
  reporter: '汇报员',
  worker: '执行员',
  orchestrator: '编排员',
  assistant: '助手',
  user: '用户',
  tool: '工具',
  triage: '待分类',
  todo: '待办',
  scheduled: '已计划',
  running: '运行中',
  backlog: '待办',
  ready: '就绪',
  doing: '进行中',
  in_progress: '进行中',
  review: '审阅中',
  done: '已完成',
  completed: '已完成',
  blocked: '已阻塞',
  archived: '已归档',
  enabled: '已启用',
  disabled: '已停用',
  'not configured': '未配置',
  'daily summary': '每日总结',
  'workspace backup': '工作区备份',
  'security audit': '安全审计',
  'search and inspect web content': '搜索并查看网页内容',
  'execute commands and inspect workspaces': '执行命令并检查工作区',
  'issues, pull requests, and releases': '管理 Issue、Pull Request 和发布版本',
  'capture structured project notes': '记录结构化项目笔记',
  'multi-agent rooms': '多 Agent 协作房间',
  'progress and milestones': '进度与里程碑',
  'task board': '任务看板',
  'summarize active sessions and completed tasks.': '总结活跃会话和已完成任务。',
  'create a workspace backup and report the result.': '备份工作区并汇报结果。',
  'audit credentials and configuration changes.': '审查凭据和配置变更。',
  'disk-cleanup': '临时文件清理',
  'security-guidance': '安全指导',
  'teams_pipeline': 'Teams 会议工作流',
  'google_meet': 'Google Meet 会议',
});

const PHRASE_TRANSLATIONS: readonly [RegExp, string][] = [
  [/WebSocket client connected/gi, 'WebSocket 客户端已连接'],
  [/WebSocket client disconnected/gi, 'WebSocket 客户端已断开'],
  [/gateway started/gi, '网关已启动'],
  [/gateway stopped/gi, '网关已停止'],
  [/session resumed/gi, '会话已恢复'],
  [/session created/gi, '会话已创建'],
  [/task completed/gi, '任务已完成'],
  [/task failed/gi, '任务执行失败'],
  [/configuration updated/gi, '配置已更新'],
  [/gateway restart(?:ed)?/gi, '网关已重启'],
  [/task started/gi, '任务已开始'],
  [/task cancelled/gi, '任务已取消'],
  [/connection established/gi, '连接已建立'],
  [/connection closed/gi, '连接已关闭'],
  [/authentication succeeded/gi, '身份验证成功'],
  [/authentication failed/gi, '身份验证失败'],
];

const PRODUCT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  alibaba: '阿里云',
  dingtalk: '钉钉',
  feishu: '飞书',
  wecom: '企业微信',
  email: '邮件',
  sms: '短信',
  browserbase: 'Browserbase',
  firecrawl: 'Firecrawl',
  browser_use: 'Browser Use',
  'browser-use': 'Browser Use',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  openrouter: 'OpenRouter',
  deepinfra: 'DeepInfra',
  xai: 'xAI',
  fal: 'FAL.ai',
  krea: 'Krea',
  spotify: 'Spotify',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  discord: 'Discord',
  slack: 'Slack',
  matrix: 'Matrix',
  mattermost: 'Mattermost',
  google_chat: 'Google Chat',
  homeassistant: 'Home Assistant',
  supermemory: 'Supermemory',
  mem0: 'Mem0',
  honcho: 'Honcho',
  langfuse: 'Langfuse',
  nous: 'Nous',
});

export function localizeHermesIntegrationName(
  id: string,
  value: string,
  kind: string,
  chinese: boolean,
): string {
  if (!chinese) return value;
  const normalized = id.trim().toLowerCase();
  const exact = EXACT_TRANSLATIONS[normalized];
  if (exact) return exact;
  const base = normalized
    .replace(/-(?:provider|platform)$/u, '')
    .replace(/^(?:browser|web|memory|image_gen|video_gen|observability|dashboard_auth|model-providers?)[-_]/u, '');
  const product = PRODUCT_NAMES[base]
    || PRODUCT_NAMES[base.replaceAll('-', '_')]
    || titleCaseIdentifier(base || value);
  if (kind === 'mcp') return `${product} MCP 服务`;
  if (kind === 'channels' || normalized.endsWith('-platform')) return `${product} 消息渠道`;
  if (kind === 'webhooks') return localizeHermesServerText(value, true);
  if (normalized.startsWith('browser-')) return `${product} 浏览器后端`;
  if (normalized.startsWith('web-')) return `${product} 网页搜索`;
  if (normalized.startsWith('memory-')) return `${product} 长期记忆`;
  if (normalized.startsWith('image_gen-') || normalized.startsWith('image-gen-')) return `${product} 图像生成`;
  if (normalized.startsWith('video_gen-') || normalized.startsWith('video-gen-')) return `${product} 视频生成`;
  if (normalized.includes('auth')) return `${product} 身份验证`;
  if (normalized.includes('observability')) return `${product} 可观测性`;
  if (normalized.endsWith('-provider')) return `${product} 模型服务`;
  return localizeHermesServerText(value, true);
}

export function localizeHermesIntegrationDescription(
  id: string,
  value: string,
  kind: string,
  chinese: boolean,
): string {
  if (!chinese || !value) return value;
  const normalized = id.trim().toLowerCase();
  if (kind === 'mcp') {
    if (/^(?:https?:\/\/|npx\b|uvx\b|python\b|node\b|docker\b)/iu.test(value.trim())) return value;
    return `连接并管理 ${localizeHermesIntegrationName(id, id, kind, true)} 提供的工具。`;
  }
  if (kind === 'channels' || normalized.endsWith('-platform')) return `通过 ${localizeHermesIntegrationName(id, id, 'channels', true)}收发 Hermes 消息。`;
  if (kind === 'webhooks') return '在指定事件发生时调用 Webhook 端点。';
  if (normalized === 'disk-cleanup') return '自动跟踪并清理 Hermes 会话产生的测试脚本、临时输出和定时任务日志。';
  if (normalized === 'security-guidance') return '在写入内容包含已知高风险模式时附加安全提示。';
  if (normalized === 'google_meet') return '加入 Google Meet 会议，转录实时字幕并支持会后处理。';
  if (normalized === 'spotify') return '通过 Spotify Web API 管理播放、设备、队列、搜索和曲库。';
  if (normalized.startsWith('browser-')) return '为 Hermes 提供云端浏览器会话、页面操作和内容获取能力。';
  if (normalized.startsWith('web-')) return '为 Hermes 提供网页搜索、内容提取和页面抓取能力。';
  if (normalized.startsWith('memory-')) return '为 Hermes 提供跨会话记忆、语义搜索和知识召回。';
  if (normalized.startsWith('image_gen-') || normalized.startsWith('image-gen-')) return '为 Hermes 提供文本生图和图像编辑能力。';
  if (normalized.startsWith('video_gen-') || normalized.startsWith('video-gen-')) return '为 Hermes 提供文本生视频和图像生视频能力。';
  if (normalized.includes('auth')) return '为 Hermes 仪表盘提供登录、会话与身份验证能力。';
  if (normalized.includes('observability')) return '记录 Hermes 会话、模型调用和工具执行的可观测数据。';
  if (normalized.endsWith('-provider')) return `使用 ${localizeHermesIntegrationName(id, id, kind, true)} 提供模型推理。`;
  return localizeHermesServerText(value, true);
}

export function localizeHermesServerText(value: string, chinese: boolean): string {
  if (!chinese || !value) return value;
  const exact = EXACT_TRANSLATIONS[value.trim().toLowerCase()];
  if (exact) return exact;
  return PHRASE_TRANSLATIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

function titleCaseIdentifier(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
    .join(' ');
}
