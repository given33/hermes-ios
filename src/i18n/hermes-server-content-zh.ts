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
];

export function localizeHermesServerText(value: string, chinese: boolean): string {
  if (!chinese || !value) return value;
  const exact = EXACT_TRANSLATIONS[value.trim().toLowerCase()];
  if (exact) return exact;
  return PHRASE_TRANSLATIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}
