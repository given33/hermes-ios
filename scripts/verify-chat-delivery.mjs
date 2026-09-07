import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const input = createInterface({ input: process.stdin, terminal: false });
const credentials = JSON.parse(await input.question(''));
input.close();
const output = process.argv[3];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const records = [];
const existingConversation = process.argv[4] && process.argv[4] !== 'new' ? process.argv[4] : '';
await page.exposeFunction('recordDelivery', (record) => {
  records.push(record);
  if (record.kind === 'event' && !record.snapshot && !/delta$/.test(record.type)) {
    const { text, ...summary } = record;
    console.log(JSON.stringify(summary));
  }
});
await page.addInitScript(() => {
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.recordDelivery({ kind: 'longtask', received: Date.now(), duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  }
  const original = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = String(args[0]?.url || args[0]);
    const start = Date.now();
    if (url.includes('/enqueue')) {
      const request = JSON.parse(args[1]?.body || '{}');
      window.recordDelivery({ kind: 'enqueue', turn: request.turn_id || request.turnId, path: new URL(url, location.href).pathname, start });
    }
    const response = await original(...args);
    if (/enqueue|hosted-events/.test(url)) window.recordDelivery({ kind: 'http', path: new URL(url, location.href).pathname, start, received: Date.now(), status: response.status });
    if (url.includes('/hosted-events') && response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.clone().body.getReader();
      void (async () => {
        let buffer = '';
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            try {
              const payload = JSON.parse(data);
              for (const event of payload.events || []) window.recordDelivery({ kind: 'event', type: event.event_type,
                turn: event.turn_id, source: event.occurred_at, received: Date.now(), length: (event.payload?.text || '').length,
                text: event.payload?.text || event.payload?.delta || event.payload?.content, stage: event.role_stage, snapshot: Boolean(payload.conversation),
                finalReport: event.payload?.final_report, action: event.payload?.action,
                cursor: event.cursor, role: event.payload?.role, sourceType: event.payload?.source_event_type });
            } catch { /* Ignore keepalive frames. */ }
          }
        }
      })().catch(() => undefined);
    }
    return response;
  };
});
page.on('pageerror', error => records.push({ kind: 'error', message: error.message }));
try {
  await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('账号', { exact: true }).fill(credentials.username, { timeout: 60000 });
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('开始语音会话', { exact: true }).waitFor({ timeout: 60000 });
  await page.getByTestId('chat-host-aliyun').waitFor({ timeout: 30000 });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(350);
    const header = await page.getByTestId('chat-header').boundingBox();
    const modes = await page.getByTestId('chat-mode-switch').boundingBox();
    assert(Math.abs((header.x + header.width / 2) - (modes.x + modes.width / 2)) <= 2, 'Modes must be centered');
    const hostRows = await page.getByTestId('chat-host-matrix').locator('[data-testid^="chat-host-"]').evaluateAll((rows) => rows.map((row) => {
      const box = row.getBoundingClientRect();
      return { text: row.textContent, x: box.x, y: box.y, width: box.width, overflow: row.scrollWidth > row.clientWidth + 1 };
    }));
    assert.equal(hostRows.length, 4);
    assert.equal(new Set(hostRows.map(row => Math.round(row.x))).size, 2);
    assert.equal(new Set(hostRows.map(row => Math.round(row.y))).size, 2);
    assert(hostRows.every(row => !row.overflow && /\d+\.\d+\.\d+/.test(row.text)), 'Full host versions must be visible');
    records.push({ kind: 'header', width, hosts: hostRows });
    await page.screenshot({ path: `${output}/header-${width}.png` });
  }
  if (!(await page.getByLabel('新建会话', { exact: true }).isVisible())) await page.getByLabel('会话', { exact: true }).click();
  if (existingConversation) {
    await page.getByLabel('刷新会话历史', { exact: true }).click();
    await page.getByTestId('history-category-test').click();
    await page.getByTestId(`open-conversation-${process.argv[4]}`).click({ timeout: 90000 });
    if (!(await page.getByTestId(`open-conversation-${process.argv[4]}`).isVisible())) {
      await page.getByLabel('会话', { exact: true }).click();
    }
    await page.getByTestId(`open-conversation-${process.argv[4]}`).click();
  } else {
    await page.getByLabel('新建会话', { exact: true }).click();
  }
  if (await page.getByLabel('新建会话', { exact: true }).isVisible()) await page.getByLabel('会话', { exact: true }).click();
  let sentCount = 0;
  for (const [index, task] of [
    '请直接计算 137×29，只回复结果。',
    '先回复一句正在准备执行，然后直接在当前会话用 terminal 运行 python3 -u -c "import time; print(\'phase_one\', flush=True); time.sleep(3); print(\'phase_two\', flush=True)"。这是单步任务，无需团队或派发。工具完成后最终回复 delivery_done。',
    '先简短说明正在搜索，然后用 web_search 搜索 Hermes Agent 官方 profiles 文档，读取其中一个官方页面，用中文说明独立配置的作用并给出来源链接。直接完成，不派发成员，最终回复末尾写 search_done。',
    '请直接使用 write_file 在当前会话工作目录创建 delivery_check.md，内容为 file_delivery_verified，然后用 read_file 读取并核实。不要写代码安装目录，不要派发成员。完成后回复 file_done 和实际文件路径。',
    '先回复开始文件校验，再使用 write_file 尝试创建 /opt/hermes-agent/delivery_permission_check.md，内容为 permission_check。如果权限不足，请改为在当前会话工作目录写入同名文件，然后使用 read_file 核实实际内容。直接完成，不派发成员。最终说明真实保存结果，末尾写 file_done。',
    '请明确派发给 dbb3-worker 执行一项真实验收：先简短汇报将检查本机，然后在 DBB3 上使用 terminal 运行 python3 -u -c "import socket,time; print(socket.gethostname(),flush=True); time.sleep(8); print(\'remote_done\',flush=True)"。执行成员直接返回实际主机名和命令输出，结尾写 remote_done。',
    '以后称呼我皇上。你现在运行在哪个服务器上？我问的是当前会话的你，直接回答即可，最后写 identity_done。',
    '请派发给 pc-worker 在 Windows WSL 使用 terminal 执行 hostname，执行成员直接回复真实输出，结尾写 pc_done。',
    '请派发给 hk-worker 在香港主机使用 terminal 执行 hostname，执行成员直接回复真实输出，结尾写 hk_done。',
    '请同时派发给 dbb3-worker 和 pc-worker，各自在自己主机上使用 terminal 执行 hostname，分别汇报真实主机名；两个成员完成后，当前会话 Hermes 汇总一次，结尾写 team_done。',
    '请派发给 pc-worker，使用已经配置的 MCP filesystem 的 list_allowed_directories 工具读取允许访问的目录，不要使用 terminal 替代。执行成员直接汇报工具实际返回的目录路径，结尾写 mcp_lazy_done。',
  ].entries()) {
    if (process.argv[5] && !process.argv[5].split(',').includes(String(index))) continue;
    sentCount++;
    await page.getByPlaceholder('发送消息给 Hermes').fill(task);
    const sent = Date.now();
    records.push({ kind: 'send', index, sent });
    console.log(JSON.stringify({ kind: 'send', index, sent }));
    const traceNode = process.env.HERMES_TRACE_WSL && index === 7 ? 'wsl'
      : process.env.HERMES_TRACE_DBB3 && [5, 9].includes(index) ? 'dbb3' : '';
    if (traceNode) {
      const connectorPid = traceNode === 'wsl' ? process.env.HERMES_TRACE_WSL : process.env.HERMES_TRACE_DBB3;
      assert(/^\d+$/.test(connectorPid), 'Trace target must be a process ID');
      const command = traceNode === 'wsl'
        ? `sudo python3 /tmp/hermes-trace-worker-startup.py ${connectorPid} /tmp/hermes-pyspy-diag/bin/py-spy`
        : `python3 /tmp/hermes-trace-worker-startup.py ${connectorPid} /tmp/hermes-pyspy-diag/bin/py-spy`;
      const trace = spawn('ssh', [`hermes-${traceNode}`, command]);
      let traceOutput = '';
      trace.stdout.on('data', data => { traceOutput += data; });
      trace.on('close', () => { void writeFile(`${output}/startup-${index}.jsonl`, traceOutput); });
    }
    await page.getByLabel('发送消息', { exact: true }).click();
    let previous = '', firstVisible = 0, doneAt = 0, prematureSince = 0;
    while (Date.now() - sent < 180000) {
      const body = await page.locator('body').innerText();
      if (body !== previous) {
        records.push({ kind: 'ui', index, received: Date.now(), text: body.slice(-5000) });
        previous = body;
      }
      const turn = records.find((record) => record.kind === 'enqueue' && record.start >= sent)?.turn;
      const reply = turn ? page.getByTestId(`chat-message-${turn}-assistant`) : null;
      const replyText = reply ? (await reply.allTextContents()).join('\n') : '';
      if (!firstVisible && /思考/.test(replyText)) {
        firstVisible = Date.now();
        await page.screenshot({ path: `${output}/task-${index}-live.png` });
      }
      const expected = index === 0 ? '3973' : index === 1 ? 'delivery_done' : index === 2 ? 'search_done'
        : index === 5 ? 'remote_done' : index === 6 ? 'identity_done' : index === 7 ? 'pc_done'
          : index === 8 ? 'hk_done' : index === 9 ? 'team_done' : index === 10 ? 'mcp_lazy_done' : 'file_done';
      const promptRows = await page.locator('[data-testid^="chat-message-"][data-testid$="-user"]').evaluateAll(rows => rows.map(row => {
        let opaque = true;
        for (let node = row; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (Number(style.opacity) === 0 || style.visibility === 'hidden' || style.display === 'none') opaque = false;
        }
        return { id: row.dataset.testid, opaque, text: row.textContent };
      }));
      if (Date.now() - sent > 2000) assert(promptRows.length >= sentCount, 'User messages disappeared while streaming');
      assert(promptRows.every(row => row.opaque), 'User messages have invisible ancestors');
      const completedEvent = records.some((record) => record.kind === 'event' && record.turn === turn
        && record.type === 'message.completed' && record.text?.includes(expected) && record.received >= sent);
      const finalRoleEvent = records.some(record => record.kind === 'event' && record.turn === turn
        && ((record.type === 'message.completed' && record.stage === 'chat' && record.sourceType === 'message.complete')
          || ['turn.completed', 'turn.failed', 'turn.cancelled'].includes(record.type)));
      const verifiedOutput = index === 7 ? replyText.includes('LAPTOP-DQNM5NRK')
        : index === 9 ? replyText.includes('dbb3-hermes') && replyText.includes('LAPTOP-DQNM5NRK')
          : replyText.includes(expected);
      const answered = finalRoleEvent && verifiedOutput;
      const completedChip = reply && await reply.getByText('已完成', { exact: true }).count();
      if (completedChip && !finalRoleEvent) {
        prematureSince ||= Date.now();
        assert(Date.now() - prematureSince < 300, 'An interim milestone marked the executing turn completed');
      } else { prematureSince = 0; }
      if (records.some((record) => record.kind === 'event' && record.turn === turn
        && ['turn.failed', 'turn.cancelled'].includes(record.type))) {
        records.push({ kind: 'unexpected-terminal', index, received: Date.now(), replyText });
        break;
      }
      if (answered && !(await page.getByLabel('取消当前任务', { exact: true }).isVisible())) {
        assert(finalRoleEvent, 'Only a root chat final or parent turn terminal may release the composer');
        if (!doneAt) doneAt = Date.now();
        if (Date.now() - doneAt > 4000) break;
      }
      await page.waitForTimeout(100);
    }
    await page.screenshot({ path: `${output}/task-${index}-final.png` });
    const summary = { kind: 'task', index, sent, firstVisible, doneAt, elapsed: (doneAt || Date.now()) - sent };
    records.push(summary);
    console.log(JSON.stringify(summary));
    if (existingConversation) {
      const calls = records.filter(record => record.kind === 'enqueue');
      assert(calls.every(record => record.path.includes(`/conversations/${process.argv[4]}/enqueue`)), 'Every message must stay in the selected conversation');
    }
    if (!doneAt) {
      if (await page.getByLabel('取消当前任务', { exact: true }).isVisible()) {
        const cancellation = page.waitForResponse(response => response.url().includes('/cancel')
          && response.request().method() === 'POST', { timeout: 30000 });
        await page.getByLabel('取消当前任务', { exact: true }).click();
        assert((await cancellation).ok(), 'Timed-out acceptance task must acknowledge cancellation');
      }
      process.exitCode = 1;
      break;
    }
    if ([5, 7, 8, 9, 10].includes(index)) {
      const turn = records.find(record => record.kind === 'enqueue' && record.start >= sent)?.turn;
      const events = records.filter(record => record.kind === 'event' && record.turn === turn);
      assert(!events.some(record => record.stage?.includes('server-fallback')), 'Remote acceptance failed: server fallback executed this probe');
      assert(events.some(record => record.type === 'tool.started' && record.stage?.startsWith('worker')), 'The member did not stream a real tool start');
      const finalSpeakers = events.filter(record => record.finalReport === true
        && (record.action === 'final_report' || record.type === 'message.completed'));
      assert.equal(finalSpeakers.length, 1, 'Exactly one final speaker must be delivered live');
      assert(index === 9 ? finalSpeakers[0].stage === 'aggregator' : finalSpeakers[0].stage === 'worker');
      const reasoning = events.filter(record => /^(thinking|reasoning)\.delta$/.test(record.type) && record.text);
      const terminal = events.find(record => record.type === 'turn.completed');
      if (reasoning.length) assert(reasoning[0].received < terminal.received - 500, 'Reasoning arrived only at completion');
      if (index === 5) {
        const reply = page.getByTestId(`chat-message-${turn}-assistant`);
        await reply.getByLabel('执行过程', { exact: true }).click();
        assert(await reply.getByRole('button', { name: /^terminal ·/ }).count(), 'Final delivery must retain tool history');
      }
      if (index === 5) assert.match((await page.getByTestId(`chat-message-${turn}-assistant`).allTextContents()).join('\n'), /dbb3-hermes/i);
      if (index === 10) {
        const reply = page.getByTestId(`chat-message-${turn}-assistant`);
        await reply.getByLabel('执行过程', { exact: true }).click();
        assert(await reply.getByRole('button', { name: /list_allowed_directories/ }).count(), 'Cached MCP tools must connect and run on first use');
      }
    }
    assert.match(await page.getByTestId('reply-completed-time').last().innerText(), /\d+月\d+日 \d{2}:\d{2}/);
    if (index === 1) {
      const details = page.getByLabel('执行过程', { exact: true }).last();
      await details.click();
      const tool = page.getByRole('button', { name: /^terminal ·/ }).last();
      const opened = Date.now();
      await tool.click();
      await page.getByText('结果', { exact: true }).last().waitFor();
      records.push({ kind: 'tool-expanded', latency: Date.now() - opened,
        text: (await page.locator('body').innerText()).slice(-2400) });
      await page.screenshot({ path: `${output}/tool-detail-desktop.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByText('delivery_done', { exact: true }).last().waitFor({ timeout: 10000 });
      await page.getByText('结果', { exact: true }).last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/tool-detail-mobile.png` });
    }
    if (index === 2) {
      await page.getByLabel('执行过程', { exact: true }).last().click();
      await page.getByRole('button', { name: /^搜索 ·/ }).last().waitFor();
      await page.getByRole('button', { name: /^搜索 ·/ }).last().scrollIntoViewIfNeeded();
      assert(await page.getByRole('link').count() > 0, 'Search must expose navigable sources');
      await page.screenshot({ path: `${output}/search-sources-mobile.png` });
      const reply = page.locator('[data-testid^="chat-message-"][data-testid$="-assistant"]').last();
      assert(await reply.locator('[data-testid^="execution-phase-"]').count() >= 2, 'Reports must retain distinct model passes');
      assert.doesNotMatch(await reply.innerText(), /Hermes.*阶段\s*\d/);
      const summary = page.getByLabel('执行过程', { exact: true }).first();
      await summary.scrollIntoViewIfNeeded();
      const before = await summary.boundingBox();
      await summary.click();
      await page.waitForTimeout(400);
      await summary.click();
      await page.waitForTimeout(400);
      const after = await summary.boundingBox();
      assert(Math.abs(before.y - after.y) < 12, 'Collapsing history must retain the reading position');
      records.push({ kind: 'collapse-anchor', before: before.y, after: after.y });
    }
    if (index === 4) {
      await page.getByLabel('执行过程', { exact: true }).last().click();
      await page.getByRole('button', { name: /write_file.*失败/ }).last().waitFor();
      const body = await page.locator('body').innerText();
      assert(!body.includes('File-mutation verifier:'), 'Show the localized failure explanation');
      assert(body.includes('文件保存失败'), 'Do not hide the failed attempt');
      await page.screenshot({ path: `${output}/write-recovered.png` });
    }
  }
} catch (error) {
  await page.screenshot({ path: `${output}/error.png` });
  console.log(JSON.stringify({ error: error.message, ui: (await page.locator('body').innerText()).slice(-1500) }));
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/delivery.json`, JSON.stringify(records, null, 2));
  await browser.close();
}
