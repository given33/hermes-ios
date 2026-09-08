import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { MobileAuthApiClient } from '../src/auth/mobile-auth';
import { HermesApiClient } from '../src/api/HermesApiClient';
import { HermesCloudApi } from '../src/api/HermesCloudApi';
import { consumeHostedConversationEvents } from '../src/api/hosted-conversation-events';

async function main() {
  const input = createInterface({ input: process.stdin, terminal: false });
  const credentials = JSON.parse(await input.question(''));
  input.close();
  const origin = 'https://daxueshenmai.top';
  const auth = new MobileAuthApiClient(origin, fetch, 20000);
  const session = await auth.login(credentials.username, credentials.password);
  const cloud = new HermesCloudApi(new HermesApiClient(origin, session.accessToken, fetch, fetch));
  const id = 'chat_user-mtrjp9om-82cfa7aa-2535-4ad1-858f-bceae6061cc4';
  const out = process.argv[2];
  await mkdir(out, { recursive: true });
  const tasks: Record<string, string> = {
    dbb3: '请派发给 dbb3-worker 在本机使用 terminal 执行 hostname，执行成员直接回复真实输出，结尾写 remote_done。',
    wsl: '请派发给 pc-worker 在 Windows WSL 使用 terminal 执行 hostname，执行成员直接回复真实输出，结尾写 pc_done。',
    hk: '请派发给 hk-worker 在香港主机使用 terminal 执行 hostname，执行成员直接回复真实输出，结尾写 hk_done。',
    mcp: '请派发给 pc-worker，使用已经配置的 MCP filesystem 的 list_allowed_directories 工具读取允许访问的目录，不要使用 terminal 替代。执行成员直接汇报工具实际返回的目录路径，结尾写 mcp_lazy_done。',
    team: '请同时派发给 dbb3-worker 和 pc-worker，各自在自己主机上使用 terminal 执行 hostname，分别汇报真实主机名；两个成员完成后，当前会话 Hermes 汇总一次，结尾写 team_done。',
    direct: '你好，请只回复：latency_direct_done',
  };
  for (const [index, name] of (process.argv[3] || 'hk,wsl,dbb3,mcp,team,direct').split(',').entries()) {
    const turnId = `latency-${randomUUID()}`;
    const controller = new AbortController();
    const events: any[] = [];
    const start = performance.now();
    const startedAt = Date.now();
    let terminal = '';
    console.log(JSON.stringify({ name, turnId, startedAt }));
    await cloud.enqueueHostedTurn(id, {
      requestId: turnId, turnId,
      message: { id: `user-${turnId}`, role: 'user', name: 'You', content: tasks[name],
        status: 'completed', kind: 'message', created_at: startedAt, updated_at: startedAt,
        meta: { runtime_turn_id: turnId } },
      profiles: ['default'], recentMessages: [], attachmentIds: [], deliveryContext: '',
    });
    const enqueueMs = performance.now() - start;
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      await consumeHostedConversationEvents(cloud, id, 0, session.account.accountGeneration,
        controller.signal, frame => {
          for (const event of frame.events) {
            if (event.turn_id !== turnId || events.some(item => item.id === event.event_id)) continue;
            const p = event.payload || {};
            const item = { id: event.event_id, ms: Math.round(performance.now() - start),
              type: event.event_type, stage: event.role_stage, occurredAt: event.occurred_at,
              text: p.text || p.content || p.delta, name: p.name || p.tool_name,
              error: p.error, result: p.result, final: p.final_report, action: p.action };
            events.push(item);
            if (!item.type.endsWith('.delta')) console.log(JSON.stringify(item));
            if (['turn.completed', 'turn.failed', 'turn.cancelled'].includes(item.type)) {
              terminal = item.type;
              controller.abort();
            }
          }
        }, undefined, 5000).catch(error => {
          if (!controller.signal.aborted) throw error;
        });
    } finally {
      clearTimeout(timeout);
      if (!terminal) {
        await fetch(`${origin}/api/plugins/collaboration/single/conversations/${id}/hosted-turns/${turnId}/cancel`, {
          method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'latency_acceptance_timeout', request_id: `cancel-${turnId}` }),
        });
      }
      const first = (type: string) => events.find(e => e.type === type)?.ms;
      const firstText = (type: string) => events.find(e => e.type === type &&
        typeof e.text === 'string' && e.text.trim().length > 0)?.ms;
      const finals = events.filter(e => e.final && (e.action === 'final_report' || e.type === 'message.completed'));
      const summary = { name, turnId, startedAt, enqueueMs: Math.round(enqueueMs),
        modelRequestMs: first('agent.started'), thinkingMs: firstText('thinking.delta'),
        messageMs: firstText('message.delta'), firstTokenMs: events.find(e =>
          ['thinking.delta', 'message.delta'].includes(e.type) &&
          typeof e.text === 'string' && e.text.trim().length > 0)?.ms,
        terminalMs: first(terminal),
        finalSpeakers: finals.map(e => e.stage), terminal };
      const latest = await cloud.getConversation(id);
      const run = latest.conversation.hosted_turns?.[turnId] as any;
      const timing = (value: any) => Object.fromEntries(Object.entries(value || {}).filter(([key]) =>
        /^(status|stage|.*_at|remote_task_id|root_task_id|session_id|execution_profile)$/.test(key)));
      const server = { ...timing(run), remote: Object.fromEntries(Object.entries(run?.remote_runs || {})
        .map(([key, value]) => [key, timing(value)])) };
      await writeFile(`${out}/${index}-${name}.json`, JSON.stringify({ summary, server, events }, null, 2));
      console.log(JSON.stringify({ summary }));
      assert.equal(terminal, 'turn.completed');
      assert(!events.some(e => e.stage?.includes('server-fallback')), 'Remote task fell back to Hub');
      assert(!events.some(e => e.type === 'tool.completed' && e.error), 'Tool failed');
      if (name !== 'direct') {
        assert(events.some(e => e.type === 'tool.started' && e.stage?.startsWith('worker')));
        assert(events.some(e => e.type === 'tool.completed' && e.name === 'kanban_complete'),
          'Worker did not finish through its native Kanban tool');
        if (name === 'mcp') {
          assert(events.some(e => e.type === 'tool.completed' &&
            e.name === 'mcp__filesystem__list_allowed_directories'), 'MCP was not executed');
        } else {
          assert(events.some(e => e.type === 'tool.completed' && e.name === 'terminal' &&
            typeof e.result === 'string' && e.result.length > 0), 'No real terminal output');
        }
        assert.equal(finals.length, 1);
        assert.equal(finals[0].stage, name === 'team' ? 'aggregator' : 'worker');
      }
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
