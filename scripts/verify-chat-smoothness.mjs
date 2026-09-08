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
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
const networkErrors = [];
const lifecycle = [];
let submittedTurn = '';
page.on('request', request => {
  if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/enqueue')) {
    submittedTurn = request.postDataJSON()?.turn_id || '';
  }
});
page.on('websocket', socket => {
  if (!socket.url().includes('hosted-events')) return;
  socket.on('framereceived', ({ payload }) => {
    if (typeof payload !== 'string') return;
    try {
      for (const event of JSON.parse(payload).events || []) {
        if (event.turn_id === submittedTurn) lifecycle.push({
          type: event.event_type, at: Date.now(), name: event.payload?.name,
        });
      }
    } catch { /* Transport keepalive. */ }
  });
});
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() !== 'error') return;
  const text = message.text().slice(0, 8000);
  if (text.startsWith('Failed to load resource:')) networkErrors.push(text);
  else errors.push(text);
});
try {
  await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('账号', { exact: true }).fill(credentials.username, { timeout: 120000 });
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('开始语音会话', { exact: true }).waitFor({ timeout: 60000 });
  const newChat = page.getByLabel('新建会话', { exact: true });
  if (!(await newChat.isVisible())) await page.getByLabel('会话', { exact: true }).click();
  await newChat.click();
  await newChat.waitFor({ state: 'hidden', timeout: 5000 });
  await page.evaluate(() => {
    window.chatFrames = [];
    window.chatMutations = [];
    window.chatLongTasks = [];
    let last = performance.now();
    const frame = now => {
      window.chatFrames.push(now - last);
      last = now;
      window.chatFrameId = requestAnimationFrame(frame);
    };
    window.chatFrameId = requestAnimationFrame(frame);
    window.chatObserver = new MutationObserver(records => {
      window.chatMutations.push({ at: performance.now(), records: records.length,
        textChanges: records.filter(r => r.type === 'characterData').length });
    });
    window.chatObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
    new PerformanceObserver(list => window.chatLongTasks.push(...list.getEntries().map(e => e.duration)))
      .observe({ type: 'longtask', buffered: false });
  });
  await page.getByPlaceholder('发送消息给 Hermes').fill(
    '请在当前阿里云主机先用中文简短汇报你将检查主机名，然后使用 terminal 执行 hostname，再用中文分三段汇报主机名、执行过程和结果，每段约80字，必须真实调用工具，最后写 smoothness_done。');
  const started = Date.now();
  await page.getByLabel('发送消息', { exact: true }).click();
  let completed = false;
  for (let index = 0; index < 150; index++) {
    if (Date.now() - started > 120000) break;
    await page.waitForTimeout(1000);
    if (await page.getByText('Hermes 会话界面遇到错误', { exact: true }).isVisible()) break;
    if ([3, 8, 15, 25].includes(index)) await page.screenshot({ path: `${output}/mobile-${index}.png` });
    const cancel = page.getByLabel('取消当前任务', { exact: true });
    if (index > 5 && !(await cancel.isVisible())) {
      const body = await page.locator('body').innerText();
      completed = (body.match(/smoothness_done/g) || []).length >= 2
        && lifecycle.some(event => event.type === 'turn.completed')
        && lifecycle.some(event => event.type === 'tool.completed');
      break;
    }
  }
  await page.screenshot({ path: `${output}/mobile-final.png` });
  const measurements = await page.evaluate(() => {
    cancelAnimationFrame(window.chatFrameId);
    window.chatObserver.disconnect();
    return { frames: window.chatFrames, mutations: window.chatMutations, longTasks: window.chatLongTasks };
  });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.screenshot({ path: `${output}/desktop-final.png` });
  await writeFile(`${output}/measurements.json`, JSON.stringify({ completed, elapsedMs: Date.now() - started,
    errors, networkErrors, lifecycle, ...measurements }, null, 2));
  console.log(JSON.stringify({ completed, errors, longTasks: measurements.longTasks.length,
    framesOver50ms: measurements.frames.filter(value => value > 50).length,
    frames: measurements.frames.length }));
  if (!completed || errors.length) process.exitCode = 1;
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  const cancel = page.getByLabel('取消当前任务', { exact: true });
  if (await cancel.isVisible().catch(() => false)) await cancel.click().catch(() => undefined);
  await browser.close();
}
