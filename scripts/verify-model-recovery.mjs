import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const input = createInterface({ input: process.stdin, terminal: false });
const credentials = JSON.parse(await input.question(''));
input.close();
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const output = process.argv[3];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const probes = [];
let attempts = 0;
let delayedStatusRequests = 0;
await page.route('**/api/model/options*', async (route) => {
  if (!route.request().url().includes('catalog_only')) { await route.continue(); return; }
  probes.push({ attempt: ++attempts, time: Date.now() });
  if (attempts <= 2) await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Service Unavailable' });
  else await route.continue();
});
await page.route('**/mobile/conversations/*/commands', async (route) => {
  const body = route.request().postDataJSON();
  if (body?.command === 'model' && body?.value === 'status') {
    delayedStatusRequests++;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  await route.continue();
});
try {
  const tokenResponse = await page.request.post('http://localhost:8082/auth/mobile/token', { data: credentials });
  assert(tokenResponse.ok());
  const { access_token } = await tokenResponse.json();
  const cancel = await page.request.post('http://localhost:8082/api/plugins/collaboration/single/conversations/chat_user-mtqwuldd-af799bdc-9b9b-4437-b7fa-9e26a7413c80/hosted-turns/hosted-mtqwvebg-4dfee321-6789-435c-b87d-d7bc6f3c364d/cancel', {
    headers: { Authorization: `Bearer ${access_token}` }, data: { reason: 'acceptance_cleanup', request_id: 'cancel-streaming-acceptance-r' },
  });
  probes.push({ cancelAcceptanceStatus: cancel.status() });
  await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('账号', { exact: true }).fill(credentials.username, { timeout: 60000 });
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const model = page.getByLabel('切换模型', { exact: true });
  await model.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => {
    const label = document.querySelector('[aria-label="切换模型"]');
    return label?.textContent && !/^(模型|Model)$/.test(label.textContent.trim());
  }, null, { timeout: 30000 });
  assert(attempts >= 3, 'Model options must retry both 503 responses automatically');
  await page.getByLabel('会话', { exact: true }).click();
  await page.getByLabel('新建会话', { exact: true }).click();
  await page.getByLabel('新建会话', { exact: true }).waitFor({ state: 'hidden' });
  const name = await model.innerText();
  assert(!name.includes('503'));
  const opened = Date.now();
  await model.click();
  await page.getByText('选择模型', { exact: true }).waitFor();
  probes.push({ name, openMs: Date.now() - opened });
  await page.screenshot({ path: `${output}/model-recovered.png` });
  await page.getByLabel('关闭', { exact: true }).click();
  assert.equal(await model.innerText(), name);
  await page.getByLabel('会话', { exact: true }).click();
  await page.getByTestId('history-category-test').click();
  await page.getByTestId('open-conversation-chat_user-mtrjp9om-82cfa7aa-2535-4ad1-858f-bceae6061cc4').click();
  await page.getByLabel('新建会话', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await model.innerText(), name, 'Opening history retains the cached profile model while session status loads');
  await page.waitForTimeout(4000);
  assert(delayedStatusRequests > 0);
  assert.equal(await model.innerText(), name);
  probes.push({ delayedStatusRequests, retainedModel: await model.innerText() });
  console.log(JSON.stringify(probes));
} finally {
  await writeFile(`${output}/model-recovery.json`, JSON.stringify(probes, null, 2));
  await browser.close();
}
