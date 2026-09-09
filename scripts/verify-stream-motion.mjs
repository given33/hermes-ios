import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Usage: node scripts/verify-stream-motion.mjs <playwright/index.mjs> [origin]
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const origin = process.argv[3] || 'http://localhost:8083';
const output = '.expo/motion-verification';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  for (const scenario of [
    { width: 390, height: 844, interact: true, reducedMotion: 'no-preference' },
    { width: 1280, height: 860, interact: false, reducedMotion: 'no-preference' },
    { width: 390, height: 844, interact: false, reducedMotion: 'reduce' },
  ]) {
    const { width, height, reducedMotion, interact } = scenario;
    const viewport = { width, height };
    const label = `${width}-${reducedMotion}`;
    const page = await browser.newPage({ viewport, reducedMotion });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`${origin}/motion-preview`, route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex:1}</style></head><body><div id="root"></div><script src="/scripts/fixtures/chat-motion-preview.bundle?platform=web&dev=false&hot=false&lazy=false"></script></body></html>`,
    }));
    await page.goto(`${origin}/motion-preview`, { waitUntil: 'load', timeout: 120000 });
    await page.getByTestId('chat-message-motion-turn-assistant').waitFor({ timeout: 120000 });
    await page.evaluate(() => {
      window.motionFrames = [];
      window.motionLongTasks = [];
      window.motionScroll = [];
      const observer = new PerformanceObserver(list => window.motionLongTasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: 'longtask', buffered: false });
      let last = performance.now();
      const tick = now => {
        window.motionFrames.push(now - last);
        last = now;
        const scroller = [...document.querySelectorAll('div')].find(node => getComputedStyle(node).overflowY === 'auto' && node.scrollHeight > node.clientHeight);
        if (scroller) window.motionScroll.push({ y: scroller.scrollTop, height: scroller.scrollHeight, viewport: scroller.clientHeight, at: now });
        window.motionFrame = requestAnimationFrame(tick);
      };
      window.motionFrame = requestAnimationFrame(tick);
    });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${output}/${label}-reasoning.png` });
    await page.waitForTimeout(3100);
    if (interact) {
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, -80);
    await page.waitForTimeout(250);
    const tool = page.getByRole('button', { name: /terminal/ }).first();
    await tool.click();
    await page.waitForTimeout(300);
    const toolBounds = await page.getByRole('button', { name: /terminal/ }).evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, position: getComputedStyle(node.parentElement).position };
    }));
    for (let index = 0; index < toolBounds.length; index += 1) {
      assert.notEqual(toolBounds[index].position, 'absolute', 'tool row left normal layout flow');
      if (index) assert.ok(toolBounds[index].top >= toolBounds[index - 1].bottom, 'tool rows overlap or change order');
    }
    await writeFile(`${output}/${label}-layout.json`, JSON.stringify(await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label]')].filter(node => /terminal|\u601d\u8003/.test(node.getAttribute('aria-label') || '')).map(node => {
        const parents = [];
        for (let current = node; current && parents.length < 6; current = current.parentElement) {
          const rect = current.getBoundingClientRect();
          const style = getComputedStyle(current);
          parents.push({ tag: current.tagName, label: current.getAttribute('aria-label'), top: rect.top, height: rect.height,
            position: style.position, transform: style.transform, inline: current.getAttribute('style'), overflow: style.overflow });
        }
        return parents;
      })), null, 2));
    await page.screenshot({ path: `${output}/${label}-tool.png` });
    // A deliberate upward gesture must stop following even as more events arrive.
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, -350);
    await page.waitForTimeout(350);
    const readScroll = () => page.evaluate(() => {
      const node = [...document.querySelectorAll('div')].find(el => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight);
      return node?.scrollTop || 0;
    });
    const paused = await readScroll();
    await page.waitForTimeout(450);
    assert.ok(Math.abs(await readScroll() - paused) < 3, 'stream pulled reader back after manual scroll');
    const latest = page.getByLabel('\u56de\u5230\u6700\u65b0\u6d88\u606f', { exact: true });
    await writeFile(`${output}/${label}-paused.html`, await page.content());
    await latest.click();
    await page.waitForTimeout(600);
    assert.ok(await readScroll() > paused + 100, 'jump to latest did not resume following');
    }
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${output}/${label}-report.png` });
    await page.getByText('motion_complete', { exact: false }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(1100);
    await page.screenshot({ path: `${output}/${label}-final.png` });
    assert.equal(await page.getByRole('button', { name: '\u6267\u884c\u8fc7\u7a0b', exact: true }).getAttribute('aria-expanded'), String(interact));
    const measurements = await page.evaluate(() => {
      cancelAnimationFrame(window.motionFrame);
      const sorted = [...window.motionFrames].sort((a, b) => a - b);
      return {
        frames: sorted.length, p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        over50Ms: sorted.filter(duration => duration > 50).length,
        longTasks: window.motionLongTasks, scroll: window.motionScroll,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    results.push({ scenario, errors, ...measurements });
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(measurements.horizontalOverflow, false);
    console.log(JSON.stringify({ scenario, errors, frames: measurements.frames, p95Ms: measurements.p95Ms, over50Ms: measurements.over50Ms }));
    await page.close();
  }
} finally {
  await writeFile(`${output}/measurements.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
