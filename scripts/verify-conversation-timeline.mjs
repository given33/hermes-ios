import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const origin = process.argv[3] || 'http://localhost:8083';
const output = '.expo/timeline-verification';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 860 }, { width: 320, height: 568 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`${origin}/timeline-preview`, route => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex:1}</style></head><body><div id="root"></div><script src="/scripts/fixtures/timeline-preview.bundle?platform=web&dev=false&hot=false&lazy=false"></script></body></html>' }));
    await page.goto(`${origin}/timeline-preview`, { waitUntil: 'load', timeout: 120000 });
    const rail = page.getByLabel('\u4f1a\u8bdd\u65f6\u95f4\u8f74', { exact: true });
    await rail.waitFor({ timeout: 120000 });
    await page.waitForTimeout(1300);
    assert.ok(await rail.evaluate(node => node.scrollHeight > node.clientHeight), 'Long timeline must scroll independently');
    await rail.evaluate(node => { node.scrollTop = 0; });
    const first = page.getByRole('button', { name: /^\u8df3\u8f6c\u5230\u4efb\u52a1 1:/ });
    const idleShort = await page.getByTestId('timeline-bar-task-0').boundingBox();
    const idleLong = await page.getByTestId('timeline-bar-task-5').boundingBox();
    assert.ok(Math.abs(idleShort.width - idleLong.width) < 1, 'Idle bars must have equal widths');
    const navigationStarted = performance.now();
    await first.click();
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-testid="chat-message-task-0-user"]');
      const box = node?.getBoundingClientRect();
      return box && box.top >= 0 && box.top < 150;
    }, undefined, { timeout: 1000 });
    const navigationMs = Math.round(performance.now() - navigationStarted);
    await page.waitForTimeout(100);
    const user = page.getByText(/^Task 1: /).first();
    const box = await user.boundingBox();
    assert.ok(box && box.y >= 0 && box.y < 150, `Task 1 is not near top: ${JSON.stringify(box)}`);
    assert.equal(await first.getAttribute('aria-selected'), 'true');
    const before = box.y;
    await page.waitForTimeout(650);
    assert.ok(Math.abs((await user.boundingBox()).y - before) < 3, 'New output pulled reader away from selected task');
    const shortBar = await page.getByTestId('timeline-bar-task-0').boundingBox();
    const longBar = await page.getByTestId('timeline-bar-task-5').boundingBox();
    assert.ok(Math.abs(longBar.width - idleLong.width) < 1, 'Unselected bars must retain their width');
    assert.ok(Math.abs(shortBar.width - idleShort.width) > 1, 'Click must change the selected bar width');
    await first.hover();
    await page.screenshot({ path: `${output}/${viewport.width}-selected.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: '\u56de\u5230\u6700\u65b0\u6d88\u606f', exact: true }).click();
    await page.waitForTimeout(950);
    const last = page.getByRole('button', { name: /^\u8df3\u8f6c\u5230\u4efb\u52a1 24:/ });
    await last.waitFor();
    assert.equal(await last.getAttribute('aria-selected'), 'true');
    assert.deepEqual(errors, []);
    const result = { viewport, navigationMs, taskTop: box.y, shortWidth: shortBar.width, longWidth: longBar.width, errors };
    results.push(result);
    console.log(JSON.stringify(result));
    await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
