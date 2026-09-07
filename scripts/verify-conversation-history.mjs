import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const input = createInterface({ input: process.stdin, terminal: false });
const credentials = JSON.parse(await input.question(''));
input.close();
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const output = process.argv[3];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const report = { errors: [], counts: {}, messages: [] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('response', async response => {
  if (!response.url().match(/\/single\/conversations\/chat_ae8eff3e341f(?:\?|$)/) || response.status() !== 200) return;
  const data = await response.json().catch(() => null);
  const messages = data?.conversation?.messages;
  if (messages) report.transcript = messages.map(item => ({ id: item.id, role: item.role }));
});
try {
  await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('账号', { exact: true }).fill(credentials.username, { timeout: 60000 });
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('开始语音会话', { exact: true }).waitFor({ timeout: 90000 });
  if (!(await page.getByLabel('新建会话', { exact: true }).isVisible())) await page.getByLabel('会话', { exact: true }).click();
  await page.getByTestId('open-conversation-chat_ae8eff3e341f').waitFor({ timeout: 90000 });
  for (const category of ['chat', 'test', 'draft']) {
    await page.getByTestId(`history-category-${category}`).click();
    await page.waitForTimeout(200);
    const rows = await page.locator('[data-testid^="open-conversation-"]').evaluateAll(items => items.map(item => ({ id: item.dataset.testid, text: item.textContent })));
    assert.equal(new Set(rows.map(item => item.id)).size, rows.length);
    report.counts[category] = rows.length;
    report[category] = rows;
    console.log(JSON.stringify({ category, rows: rows.length }));
  }
  assert(report.counts.chat < 60, 'Chat history still contains internal execution or test rows');
  await page.getByTestId('history-category-chat').click();
  const main = page.getByTestId('open-conversation-chat_ae8eff3e341f');
  assert.match(await main.innerText(), /创建于 2026\/09\/06/);
  await page.screenshot({ path: `${output}/history-desktop.png` });
  await main.click();
  await page.getByLabel('发送消息', { exact: true }).waitFor({ timeout: 90000 });
  const deadline = Date.now() + 90000;
  while (!report.transcript && Date.now() < deadline) await page.waitForTimeout(250);
  assert(report.transcript?.length >= 68, 'Server did not restore the complete original transcript');
  report.messages = await page.locator('[data-testid^="chat-message-"]').evaluateAll(items => items.map(item => ({ id: item.dataset.testid, text: item.textContent?.slice(0, 160) })));
  report.users = report.transcript.filter(item => item.role === 'user').length;
  assert(report.users >= 20, 'Original user messages were not restored');
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (!(await page.getByLabel('新建会话', { exact: true }).filter({ visible: true }).count())) await page.getByLabel('会话', { exact: true }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${output}/history-${width}.png` });
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ counts: report.counts, users: report.users, rows: report.messages.length, errors: report.errors }));
} finally {
  await page.screenshot({ path: `${output}/final.png` }).catch(() => undefined);
  await writeFile(`${output}/history-ui.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
