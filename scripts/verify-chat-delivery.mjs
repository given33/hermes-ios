import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const input = createInterface({ input: process.stdin, terminal: false });
const credentials = JSON.parse(await input.question(''));
input.close();
const output = process.argv[3];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const records = [];
await page.exposeFunction('recordDelivery', (record) => {
  records.push(record);
  if (record.kind === 'event' && !record.snapshot && !/delta$/.test(record.type)) {
    const { text, ...summary } = record;
    console.log(JSON.stringify(summary));
  }
});
await page.addInitScript(() => {
  const original = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = String(args[0]?.url || args[0]);
    const start = Date.now();
    if (url.includes('/enqueue')) {
      const request = JSON.parse(args[1]?.body || '{}');
      window.recordDelivery({ kind: 'enqueue', turn: request.turn_id || request.turnId, start });
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
                text: event.payload?.text, stage: event.role_stage, snapshot: Boolean(payload.conversation),
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
  if (!(await page.getByLabel('新建会话', { exact: true }).isVisible())) await page.getByLabel('会话', { exact: true }).click();
  if (process.argv[4]) {
    await page.getByTestId(`open-conversation-${process.argv[4]}`).click();
    if (!(await page.getByTestId(`open-conversation-${process.argv[4]}`).isVisible())) {
      await page.getByLabel('会话', { exact: true }).click();
    }
    await page.getByTestId(`open-conversation-${process.argv[4]}`).click();
  } else {
    await page.getByLabel('新建会话', { exact: true }).click();
  }
  if (await page.getByLabel('新建会话', { exact: true }).isVisible()) await page.getByLabel('会话', { exact: true }).click();
  for (const [index, task] of [
    '请直接计算 137×29，只回复结果。',
    '请你直接在当前会话用 terminal 运行 python3 -u -c "import time; print(\'phase_one\', flush=True); time.sleep(3); print(\'phase_two\', flush=True)"。这是单步任务，无需团队或派发。完成后只回复 delivery_done。',
  ].entries()) {
    await page.getByPlaceholder('发送消息给 Hermes').fill(task);
    const sent = Date.now();
    records.push({ kind: 'send', index, sent });
    console.log(JSON.stringify({ kind: 'send', index, sent }));
    await page.getByLabel('发送消息', { exact: true }).click();
    let previous = '', firstVisible = 0, doneAt = 0;
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
      const expected = index === 0 ? '3973' : 'delivery_done';
      const completedEvent = records.some((record) => record.kind === 'event' && record.turn === turn
        && record.type === 'message.completed' && record.text?.includes(expected) && record.received >= sent);
      const answered = completedEvent && replyText.includes(expected);
      if (records.some((record) => record.kind === 'event' && record.turn === turn
        && ['turn.failed', 'turn.cancelled'].includes(record.type))) {
        records.push({ kind: 'unexpected-terminal', index, received: Date.now(), replyText });
        break;
      }
      if (answered && !(await page.getByLabel('取消当前任务', { exact: true }).isVisible())) {
        if (!doneAt) doneAt = Date.now();
        if (Date.now() - doneAt > 4000) break;
      }
      await page.waitForTimeout(100);
    }
    await page.screenshot({ path: `${output}/task-${index}-final.png` });
    const summary = { kind: 'task', index, sent, firstVisible, doneAt, elapsed: (doneAt || Date.now()) - sent };
    records.push(summary);
    console.log(JSON.stringify(summary));
    if (!doneAt) {
      if (await page.getByLabel('取消当前任务', { exact: true }).isVisible()) {
        await page.getByLabel('取消当前任务', { exact: true }).click();
      }
      process.exitCode = 1;
      break;
    }
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
  }
} catch (error) {
  await page.screenshot({ path: `${output}/error.png` });
  console.log(JSON.stringify({ error: error.message, ui: (await page.locator('body').innerText()).slice(-1500) }));
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/delivery.json`, JSON.stringify(records, null, 2));
  await browser.close();
}
