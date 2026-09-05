const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const url = process.env.HERMES_PREVIEW_URL || 'http://localhost:8083';
const output = process.env.HERMES_PREVIEW_ARTIFACTS || '../findings/workflow-preview-20260905';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const results = [];
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 1440, height: 1000 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const loadStart = performance.now();
      await page.goto(url);
      await page.getByText('演示数据 · 未连接后端', { exact: true }).waitFor();
      const historyBox = await page.getByRole('button', { name: '会话', exact: true }).boundingBox();
      assert.ok(historyBox && historyBox.x >= 0 && historyBox.x + historyBox.width <= viewport.width);
      const composer = page.getByPlaceholder('输入消息（@ 可提醒成员）', { exact: true });
      await composer.fill('展示执行记录');
      const readyMs = performance.now() - loadStart;
      await page.getByLabel('发送消息', { exact: true }).click();
      await page.getByText('演示执行记录：', { exact: false }).waitFor();
      const summary = page.getByRole('button', { name: '执行步骤', exact: true }).last();
      await summary.click();
      const search = page.getByRole('button', { name: /^搜索 · web_search/ });
      await search.waitFor();
      await search.click();
      const source = page.getByRole('link', { name: 'Hermes Agent releases', exact: true });
      await source.waitFor();
      // Observe the actual opened URL without depending on an external site's availability.
      await context.route('https://github.com/**', (route) => route.fulfill({ status: 200, body: 'Source navigation check' }));
      const popupPromise = page.waitForEvent('popup');
      await source.click();
      const popup = await popupPromise;
      await popup.waitForURL('https://github.com/NousResearch/hermes-agent/releases');
      await popup.close();
      await page.getByRole('button', { name: '复制工具详情', exact: true }).first().click();
      assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Hermes Agent releases/);
      await search.click();
      const edit = page.getByRole('button', { name: /^代码修改 · file_edit/ });
      await edit.click();
      await page.getByText('请求变更', { exact: true }).waitFor();
      assert.match(await page.locator('body').innerText(), /-const retryLimit = 0;/);
      assert.match(await page.locator('body').innerText(), /\+const retryLimit = 3;/);
      await edit.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `changes-${viewport.width}.png`), animations: 'disabled' });
      await edit.click();
      const terminal = page.getByRole('button', { name: /^命令 · terminal · 已完成/ });
      await terminal.click();
      const more = page.getByRole('button', { name: '展开更多输出', exact: true }).first();
      await more.waitFor();
      assert.equal((await page.locator('body').innerText()).includes('demo test 140:'), false);
      for (let attempt = 0; attempt < 4 && await more.count(); attempt++) await more.click();
      assert.match(await page.locator('body').innerText(), /demo test 140:/);
      await page.getByRole('button', { name: '收起输出', exact: true }).click();
      assert.equal((await page.locator('body').innerText()).includes('demo test 140:'), false);
      await terminal.click();
      const failed = page.getByRole('button', { name: /^命令 · terminal · 失败/ });
      await failed.click();
      await page.getByText('Demo error: connection timed out', { exact: true }).waitFor();
      await failed.click();
      await page.getByRole('button', { name: /^计划任务 · cronjob · 排队中/ }).waitFor();
      const cancelled = page.getByRole('button', { name: /delegate_task · 已取消/ });
      await cancelled.click();
      await page.getByText('Review client changes', { exact: true }).last().waitFor();
      await cancelled.click();
      await search.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `timeline-${viewport.width}.png`), animations: 'disabled' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, 'page must not scroll horizontally');
      const stepBoxes = await page.getByRole('button').evaluateAll(
        (elements) => elements.filter((element) => / · (web_search|web_extract|file_edit|terminal|cronjob|delegate_task) · /.test(element.getAttribute('aria-label') || ''))
          .map((element) => { const r = element.getBoundingClientRect(); return { x: r.x, width: r.width, height: r.height }; }));
      assert.equal(stepBoxes.length, 7);
      assert.ok(stepBoxes.every((box) => box.height >= 44 && box.x >= 0 && box.x + box.width <= viewport.width + 1));
      assert.deepEqual(errors, []);
      results.push({ viewport, readyMs: Math.round(readyMs), steps: stepBoxes.length,
        sourceNavigation: true, clipboard: true, requestedDiff: true, progressiveOutput: true, overflow, errors });
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ url, runtime: 'Edge headless / Expo Web dev / demo data / reduced motion', results }, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
