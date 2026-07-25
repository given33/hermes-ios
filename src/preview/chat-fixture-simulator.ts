import type { HermesChatViewMessage as ChatMessage } from '../api/chat-view-model';
import type { CollaborationMessage, SingleConversation } from '../api/HermesCloudApi';

export function previewConversationHistory(isChinese: boolean): SingleConversation[] {
  const now = Date.now();
  const definitions = [
    {
      age: 2 * 60_000,
      model: 'claude-sonnet-4',
      title: isChinese ? '\u0069\u004f\u0053 \u539f\u751f\u8fc1\u79fb\u65b9\u6848' : 'iOS native migration plan',
      turns: isChinese
        ? ['\u5206\u6790\u73b0\u6709\u9879\u76ee\u7684 iOS \u8fc1\u79fb\u8303\u56f4\u3002', '\u5df2\u68b3\u7406\u5bfc\u822a\u3001\u4f1a\u8bdd\u3001\u9644\u4ef6\u4e0e\u540e\u53f0\u6258\u7ba1\u8fb9\u754c\u3002', '\u7ee7\u7eed\u6838\u5bf9\u79fb\u52a8\u7aef\u4ea4\u4e92\u3002', '\u5df2\u5b8c\u6210\u624b\u52bf\u3001\u952e\u76d8\u548c\u54cd\u5e94\u5f0f\u5e03\u5c40\u68c0\u67e5\u3002']
        : ['Review the iOS migration scope.', 'Navigation, conversations, attachments, and hosted work are mapped.', 'Continue with mobile interactions.', 'Gestures, keyboard behavior, and responsive layout are verified.'],
    },
    {
      age: 48 * 60_000,
      model: 'qwen3-235b',
      title: isChinese ? '\u7f51\u5173\u90e8\u7f72\u5ba1\u8ba1' : 'Gateway deployment audit',
      turns: isChinese
        ? ['\u68c0\u67e5\u7f51\u5173\u90e8\u7f72\u548c\u5065\u5eb7\u72b6\u6001\u3002', '\u5df2\u6838\u5bf9\u670d\u52a1\u3001\u7248\u672c\u3001\u8fde\u63a5\u5668\u548c\u5065\u5eb7\u7aef\u70b9\u3002', '\u662f\u5426\u6709\u9700\u8981\u5904\u7406\u7684\u5f02\u5e38\uff1f', '\u672a\u53d1\u73b0\u4f1a\u963b\u65ad\u5f53\u524d\u4f1a\u8bdd\u7684\u5f02\u5e38\u3002']
        : ['Audit gateway deployment and health.', 'Services, versions, connector, and health endpoints are checked.', 'Any blocking issue?', 'No issue currently blocks conversations.'],
    },
    {
      age: 24 * 60 * 60_000,
      model: 'hermes-4-405b',
      title: isChinese ? 'Hermes \u63d2\u4ef6\u517c\u5bb9\u6027' : 'Hermes plugin compatibility',
      turns: isChinese
        ? ['\u68c0\u67e5\u63d2\u4ef6\u4e0e\u79fb\u52a8\u7aef\u8def\u7531\u7684\u517c\u5bb9\u6027\u3002', '\u5df2\u68c0\u67e5 Skills\u3001Plugins\u3001MCP \u548c\u770b\u677f\u8def\u7531\u3002', '\u4fdd\u7559\u73b0\u6709\u6269\u5c55\u80fd\u529b\u3002', '\u6269\u5c55\u5165\u53e3\u548c\u539f\u6709\u80fd\u529b\u5747\u5df2\u4fdd\u7559\u3002']
        : ['Check plugin and mobile route compatibility.', 'Skills, Plugins, MCP, and Kanban routes were reviewed.', 'Keep all existing extensions.', 'Extension entry points and existing behavior are preserved.'],
    },
    {
      age: 7 * 24 * 60 * 60_000,
      model: 'claude-sonnet-4',
      title: isChinese ? '\u7814\u7a76\u6458\u8981\u81ea\u52a8\u5316' : 'Research digest automation',
      turns: isChinese
        ? ['\u521b\u5efa\u6bcf\u65e5\u7814\u7a76\u6458\u8981\u3002', '\u5df2\u521b\u5efa\u5de5\u4f5c\u65e5\u8ba1\u5212\u5e76\u914d\u7f6e\u6d88\u606f\u6295\u9012\u3002', '\u5c06\u7ed3\u679c\u4fdd\u7559\u5230\u4f1a\u8bdd\u3002', '\u6bcf\u6b21\u6267\u884c\u7684\u5b8c\u6574\u8fc7\u7a0b\u548c\u7ed3\u679c\u90fd\u4f1a\u56de\u5199\u3002']
        : ['Create a daily research digest.', 'A weekday schedule and message delivery were configured.', 'Keep results in the conversation.', 'Every run writes the complete process and result back to this conversation.'],
    },
  ] as const;
  return definitions.map((definition, index) => {
    const updatedAt = now - definition.age;
    const messages: CollaborationMessage[] = definition.turns.map((content, turnIndex) => ({
      content,
      created_at: updatedAt - (definition.turns.length - turnIndex) * 1_000,
      id: `preview-history-${index}-${turnIndex}`,
      name: turnIndex % 2 === 0 ? 'Given' : 'Hermes Agent',
      role: turnIndex % 2 === 0 ? 'user' : 'assistant',
      status: 'completed',
      updated_at: updatedAt - (definition.turns.length - turnIndex - 1) * 1_000,
    }));
    return {
      created_at: updatedAt - 60_000,
      id: `preview-history-${index}`,
      message_count: messages.length,
      messages,
      official_model: definition.model,
      profile: 'default',
      title: definition.title,
      updated_at: updatedAt,
    };
  });
}

export function previewNeedsCollaboration(content: string, attachmentCount: number): boolean {
  const normalized = content.trim().toLowerCase();
  if (attachmentCount > 1) return true;
  const actionMatches = normalized.match(
    /修复|实现|开发|分析|调研|审查|审核|测试|复测|部署|发布|汇总|报告|分步骤|多阶段|fix|implement|develop|analy[sz]e|research|review|test|deploy|release|report|multi[- ]?step|workflow/g,
  ) || [];
  return actionMatches.length >= 3 || (normalized.length >= 120 && actionMatches.length >= 1);
}

export function previewDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function previewTurnMessages({
  collaborative,
  isChinese,
  startedAt,
  turnId,
}: {
  collaborative: boolean;
  isChinese: boolean;
  startedAt: number;
  turnId: string;
}): ChatMessage[] {
  if (!collaborative) {
    const completedAt = startedAt + 620;
    return [{
      activities: [{
        category: 'runtime',
        completedAt,
        duration: '0.6s',
        durationMs: 620,
        id: `${turnId}-thinking`,
        name: isChinese ? '模型思考' : 'Model reasoning',
        output: isChinese ? '识别为简单对话，由单 Hermes 直接回复。' : 'Classified as a simple turn and answered by a single Hermes agent.',
        preview: isChinese ? '简单对话' : 'Simple turn',
        startedAt,
        status: 'completed',
      }],
      avatarRole: 'hermes',
      completedAt,
      content: isChinese
        ? '你好，我是 Hermes。当前消息按简单对话处理，没有启动协作群聊。'
        : 'Hello, I am Hermes. This was handled as a simple turn without starting collaboration.',
      createdAt: startedAt,
      durationMs: 620,
      firstTokenAt: startedAt,
      id: `${turnId}-hermes`,
      model: 'preview/local-hermes',
      name: 'Hermes Agent',
      role: 'assistant',
      roleStage: 'chat',
      runtimeTurnId: turnId,
      startedAt,
      status: 'completed',
      updatedAt: completedAt,
    }];
  }
  const roles: Array<{
    avatarRole: NonNullable<ChatMessage['avatarRole']>;
    content: string;
    name: string;
    roleStage: NonNullable<ChatMessage['roleStage']>;
    statusText: string;
  }> = [
    {
      avatarRole: 'dispatcher',
      content: isChinese ? '已完成难度评估和任务拆分，正在把执行步骤交给 Worker。' : 'Difficulty assessed and the task plan has been dispatched to Worker.',
      name: isChinese ? 'Hermes 调度员' : 'Hermes Manager',
      roleStage: 'dispatcher',
      statusText: isChinese ? '规划与调度完成' : 'Planning and dispatch completed',
    },
    {
      avatarRole: 'dbb3-worker',
      content: isChinese ? '已按计划完成实现与验证，并提交执行结果和产物清单。' : 'Implementation and validation are complete, with results and artifacts submitted.',
      name: 'Hermes Worker',
      roleStage: 'worker',
      statusText: isChinese ? '执行完成' : 'Execution completed',
    },
    {
      avatarRole: 'reviewer',
      content: isChinese ? '已复核执行证据、异常路径和完成标准，本轮审阅通过。' : 'Evidence, failure paths, and completion criteria were reviewed. The review passed.',
      name: isChinese ? 'Hermes 审阅员' : 'Hermes Reviewer',
      roleStage: 'reviewer',
      statusText: isChinese ? '审阅通过' : 'Review passed',
    },
    {
      avatarRole: 'reporter',
      content: isChinese ? '任务已完成。这里汇总展示经过调度、执行和审阅确认后的最终结果。' : 'Task completed. This is the final result verified through planning, execution, and review.',
      name: isChinese ? 'Hermes 汇报员' : 'Hermes Reporter',
      roleStage: 'reporter',
      statusText: isChinese ? '最终汇报完成' : 'Final report completed',
    },
  ];
  return roles.map((definition, index) => {
    const messageStartedAt = startedAt + index * 380;
    const completedAt = messageStartedAt + 360;
    return {
      activities: [{
        category: 'workflow',
        completedAt,
        duration: '0.4s',
        durationMs: 360,
        id: `${turnId}-${definition.roleStage}-status`,
        name: isChinese ? '运行状态' : 'Runtime status',
        output: definition.statusText,
        preview: definition.statusText,
        startedAt: messageStartedAt,
        status: 'completed',
      }],
      avatarRole: definition.avatarRole,
      completedAt,
      content: definition.content,
      createdAt: messageStartedAt,
      durationMs: 360,
      firstTokenAt: messageStartedAt,
      id: `${turnId}-${definition.roleStage}`,
      model: 'preview/local-hermes',
      name: definition.name,
      role: 'assistant',
      roleStage: definition.roleStage,
      runtimeTurnId: turnId,
      startedAt: messageStartedAt,
      status: 'completed',
      updatedAt: completedAt,
    };
  });
}
