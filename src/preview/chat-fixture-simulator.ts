import type { HermesChatViewMessage as ChatMessage } from '../api/chat-view-model';
import type { CollaborationMessage, SingleConversation } from '../api/HermesCloudApi';

function previewExecutionSteps(turnId: string): NonNullable<ChatMessage['activities']> {
  const base = { duration: '', preview: '', status: 'completed' as const };
  return [
    { ...base, id: `${turnId}-search`, category: 'search', name: 'web_search', toolName: 'web_search', durationMs: 840,
      input: JSON.stringify({ query: 'Hermes Agent releases' }),
      output: JSON.stringify({ results: [{ title: 'Hermes Agent releases', url: 'https://github.com/NousResearch/hermes-agent/releases', snippet: 'Official release history' }] }) },
    { ...base, id: `${turnId}-read`, category: 'browser', name: 'web_extract', durationMs: 420,
      input: JSON.stringify({ url: 'https://github.com/NousResearch/hermes-agent' }), output: 'Demo excerpt from a source.' },
    { ...base, id: `${turnId}-edit`, category: 'edit', name: 'file_edit', durationMs: 90,
      input: JSON.stringify({ path: 'src/client.ts', old_text: 'const retryLimit = 0;\n', new_text: 'const retryLimit = 3;\n' }), output: 'Demo change only.' },
    { ...base, id: `${turnId}-terminal`, category: 'command', name: 'terminal', durationMs: 1200,
      input: JSON.stringify({ command: 'pnpm test' }),
      output: Array.from({ length: 140 }, (_, i) => `demo test ${i + 1}: sample execution output`).join('\n') },
    { ...base, id: `${turnId}-failed`, category: 'command', name: 'terminal', status: 'failed', durationMs: 1500,
      input: JSON.stringify({ command: 'curl https://unavailable.invalid' }), error: 'Demo error: connection timed out' },
    { ...base, id: `${turnId}-schedule`, category: 'schedule', name: 'cronjob', status: 'queued',
      input: JSON.stringify({ action: 'create', schedule: '0 9 * * 1-5' }) },
    { ...base, id: `${turnId}-agent`, category: 'subagent', name: 'delegate_task', status: 'cancelled',
      input: JSON.stringify({ task: 'Review client changes', profile: 'research' }) },
  ];
}

export function previewConversationHistory(
  isChinese: boolean,
  accountGeneration: string,
): SingleConversation[] {
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
      account_generation: accountGeneration,
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
      activities: previewExecutionSteps(turnId),
      avatarRole: 'hermes',
      completedAt,
      content: isChinese
        ? '演示执行记录：包含成功、失败、取消和待执行步骤。未执行真实请求。'
        : 'Demo execution record: successful, failed, cancelled and pending steps. No real requests were executed.',
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
  // Multi-member hosted team: the dispatcher plans, independent workers run
  // in parallel, each worker returns evidence, and the dispatcher publishes
  // one answer. The HK lane exercises the production four-member roster.
  // Stages with `streamRunning` first emit a running snapshot under the same
  // id so the roster live states (typing/thinking/executing/reviewing/
  // reporting) are driven by upserted fixture events, exactly like SSE.
  interface TeamStageFixture {
    avatarRole: NonNullable<ChatMessage['avatarRole']>;
    completeOffset: number;
    content: string;
    handoffTo?: string[];
    key: string;
    memberId: string;
    name: string;
    rawRoleStage: string;
    roleLabel: string;
    roleStage: NonNullable<ChatMessage['roleStage']>;
    runningContent?: string;
    startOffset: number;
    statusText: string;
    streamRunning?: boolean;
  }
  const managerName = isChinese ? 'Hermes 调度员' : 'Hermes Manager';
  const dbb3Name = isChinese ? 'DBB3 执行员' : 'DBB3 Worker';
  const pcName = isChinese ? 'PC/WSL 执行员' : 'PC/WSL Worker';
  const hkName = isChinese ? 'HK 执行员' : 'Hong Kong Worker';
  const stages: TeamStageFixture[] = [
    {
      avatarRole: 'dispatcher',
      completeOffset: 720,
      content: isChinese
        ? '已完成难度评估：拆分为 DBB3、PC/WSL 与 HK 三个子任务，并行派发给三名执行员。'
        : 'Difficulty assessed: split into DBB3, PC/WSL, and Hong Kong work, dispatched in parallel.',
      handoffTo: ['dbb3-worker', 'pc-worker', 'hk-worker'],
      key: 'manager-plan',
      memberId: 'dispatcher',
      name: managerName,
      rawRoleStage: 'manager_planning',
      roleLabel: isChinese ? 'Hermes 调度员 · 规划' : 'Hermes Manager · Planning',
      roleStage: 'dispatcher',
      startOffset: 0,
      statusText: isChinese ? '规划与派发完成' : 'Planning and dispatch completed',
      streamRunning: true,
    },
    {
      avatarRole: 'dbb3-worker',
      completeOffset: 1_980,
      content: isChinese
        ? '部署完成：服务已在 DBB3 重启并通过健康检查。'
        : 'Deployment done: the service restarted on DBB3 and passed health checks.',
      handoffTo: ['dispatcher'],
      key: 'dbb3-run',
      memberId: 'dbb3-worker',
      name: dbb3Name,
      rawRoleStage: 'worker:dbb3-worker',
      roleLabel: isChinese ? 'DBB3 执行员 · 执行' : 'DBB3 Worker · Execution',
      roleStage: 'worker',
      startOffset: 760,
      statusText: isChinese ? '执行完成' : 'Execution completed',
      streamRunning: true,
    },
    {
      avatarRole: 'pc-worker',
      completeOffset: 2_160,
      content: isChinese
        ? '本地验证完成：WSL 网关连通，冒烟用例全部通过。'
        : 'Local verification done: the WSL gateway is reachable and smoke tests pass.',
      handoffTo: ['dispatcher'],
      key: 'pc-run',
      memberId: 'pc-worker',
      name: pcName,
      rawRoleStage: 'worker:pc-worker',
      roleLabel: isChinese ? 'PC/WSL 执行员 · 执行' : 'PC/WSL Worker · Execution',
      roleStage: 'worker',
      startOffset: 800,
      statusText: isChinese ? '执行完成' : 'Execution completed',
      streamRunning: true,
    },
    {
      avatarRole: 'hk-worker',
      completeOffset: 2_980,
      content: isChinese
        ? '香港执行节点发现回滚证据缺口，已重新执行验证。'
        : 'The Hong Kong execution lane found a rollback evidence gap and reran verification.',
      handoffTo: ['dispatcher'],
      key: 'hk-run',
      memberId: 'hk-worker',
      name: hkName,
      rawRoleStage: 'worker:hk-worker',
      roleLabel: isChinese ? 'HK 执行员 · 执行' : 'Hong Kong Worker · Execution',
      roleStage: 'worker',
      startOffset: 820,
      statusText: isChinese ? '执行完成' : 'Execution completed',
      streamRunning: true,
    },
    {
      avatarRole: 'dbb3-worker',
      completeOffset: 3_900,
      content: isChinese
        ? '返工完成：已补充回滚演练记录与回执哈希。'
        : 'Rework done: rollback drill log and receipt hash attached.',
      handoffTo: ['dispatcher'],
      key: 'dbb3-rework',
      memberId: 'dbb3-worker',
      name: dbb3Name,
      rawRoleStage: 'worker:dbb3-worker:rework:1',
      roleLabel: isChinese ? 'DBB3 执行员 · 第 1 轮返工' : 'DBB3 Worker · Rework round 1',
      roleStage: 'worker',
      startOffset: 3_040,
      statusText: isChinese ? '返工完成' : 'Rework completed',
      streamRunning: true,
    },
    {
      avatarRole: 'pc-worker',
      completeOffset: 4_000,
      content: isChinese
        ? '返工完成：本地回滚脚本验证通过并附执行日志。'
        : 'Rework done: the local rollback script passed with logs attached.',
      handoffTo: ['dispatcher'],
      key: 'pc-rework',
      memberId: 'pc-worker',
      name: pcName,
      rawRoleStage: 'worker:pc-worker:rework:1',
      roleLabel: isChinese ? 'PC/WSL 执行员 · 第 1 轮返工' : 'PC/WSL Worker · Rework round 1',
      roleStage: 'worker',
      startOffset: 3_080,
      statusText: isChinese ? '返工完成' : 'Rework completed',
      streamRunning: true,
    },
    {
      avatarRole: 'hk-worker',
      completeOffset: 4_560,
      content: isChinese
        ? '补充验证完成：证据完整，交给 Hermes 调度员汇总交接。'
        : 'Supplemental verification is complete; handing off to the Hermes Dispatcher.',
      handoffTo: ['dispatcher'],
      key: 'hk-summary',
      memberId: 'hk-worker',
      name: hkName,
      rawRoleStage: 'worker:hk-worker:rework:1',
      roleLabel: isChinese ? 'HK 执行员 · 复验' : 'Hong Kong Worker · Verification',
      roleStage: 'worker',
      startOffset: 4_040,
      statusText: isChinese ? '补充验证完成' : 'Supplemental verification completed',
    },
    {
      avatarRole: 'dispatcher',
      completeOffset: 5_000,
      content: isChinese
        ? '结构化交接已生成：包含计划、三条执行结果与返工记录。'
        : 'Structured handoff ready: plan, three worker results, and rework evidence.',
      handoffTo: ['dispatcher'],
      key: 'manager-handoff',
      memberId: 'dispatcher',
      name: managerName,
      rawRoleStage: 'manager_handoff',
      roleLabel: isChinese ? 'Hermes 调度员 · 交接' : 'Hermes Manager · Handoff',
      roleStage: 'dispatcher',
      runningContent: isChinese ? '正在汇总三条执行证据…' : 'Collecting execution evidence…',
      startOffset: 4_600,
      statusText: isChinese ? '交接完成' : 'Handoff completed',
      streamRunning: true,
    },
    {
      avatarRole: 'dispatcher',
      completeOffset: 5_750,
      content: isChinese
        ? '任务完成：DBB3、PC/WSL 与 HK 执行结果均已汇总。'
        : 'Task complete: DBB3, PC/WSL, and Hong Kong execution results are summarized.',
      key: 'dispatcher-summary',
      memberId: 'dispatcher',
      name: managerName,
      rawRoleStage: 'dispatcher',
      roleLabel: isChinese ? 'Hermes 调度员 · 完成' : 'Hermes Dispatcher · Complete',
      roleStage: 'dispatcher',
      startOffset: 5_040,
      statusText: isChinese ? '任务完成' : 'Task completed',
      streamRunning: true,
    },
  ];
  const messageFor = (stage: TeamStageFixture, running: boolean): ChatMessage => {
    const messageStartedAt = startedAt + stage.startOffset;
    const completedAt = startedAt + stage.completeOffset;
    const durationMs = stage.completeOffset - stage.startOffset;
    return {
      activities: running ? [] : [{
        category: 'workflow',
        completedAt,
        duration: `${(durationMs / 1000).toFixed(1)}s`,
        durationMs,
        id: `${turnId}-${stage.key}-status`,
        name: isChinese ? '运行状态' : 'Runtime status',
        output: stage.statusText,
        preview: stage.statusText,
        startedAt: messageStartedAt,
        status: 'completed',
      }],
      avatarRole: stage.avatarRole,
      completedAt: running ? undefined : completedAt,
      content: running ? stage.runningContent ?? '' : stage.content,
      createdAt: messageStartedAt,
      durationMs: running ? undefined : durationMs,
      firstTokenAt: running && !stage.runningContent ? undefined : messageStartedAt + 120,
      handoffTarget: running ? undefined : stage.handoffTo?.join(', '),
      id: `${turnId}-${stage.key}`,
      memberId: stage.memberId,
      model: 'preview/local-hermes',
      name: stage.name,
      rawRoleStage: stage.rawRoleStage,
      role: 'assistant',
      roleLabel: stage.roleLabel,
      roleStage: stage.roleStage,
      runtimeTurnId: turnId,
      startedAt: messageStartedAt,
      status: running ? 'running' : 'completed',
      updatedAt: running ? messageStartedAt : completedAt,
    };
  };
  const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
  const playback: Array<[key: string, running: boolean]> = [
    ['manager-plan', true],
    ['manager-plan', false],
    ['dbb3-run', true],
    ['pc-run', true],
    ['dbb3-run', false],
    ['pc-run', false],
    ['hk-run', true],
    ['hk-run', false],
    ['dbb3-rework', true],
    ['pc-rework', true],
    ['dbb3-rework', false],
    ['pc-rework', false],
    ['hk-summary', false],
    ['manager-handoff', true],
    ['manager-handoff', false],
    ['dispatcher-summary', true],
    ['dispatcher-summary', false],
  ];
  return playback.flatMap(([key, running]) => {
    const stage = stageByKey.get(key);
    if (!stage || (running && !stage.streamRunning)) return [];
    return [messageFor(stage, running)];
  });
}
