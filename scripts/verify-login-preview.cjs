const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const url = new URL(process.env.HERMES_PREVIEW_URL || 'http://localhost:8083');
url.searchParams.set('view', 'login');
const output = process.env.HERMES_PREVIEW_ARTIFACTS || '../findings/login-preview-20260905';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const results = [];
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 1440, height: 1000 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const requests = [];
      await context.route('**/auth/mobile/**', async (route) => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        requests.push({ pathname, method: request.method() });
        if (pathname.endsWith('/status')) return route.fulfill({ headers, json: {
          registration_open: true, account_configured: true, email_verification_required: true, owner_email_configured: true,
        } });
        if (pathname.endsWith('/registration-code')) return route.fulfill({ headers, json: { ok: true, expires_in: 600, resend_after: 60 } });
        return route.fulfill({ status: 401, headers, json: { error: 'Invalid credentials' } });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url.href);
      await page.getByRole('textbox', { name: '账号', exact: true }).waitFor();
      const submit = page.getByRole('button', { name: '登录', exact: true });
      assert.equal(await submit.getAttribute('aria-disabled'), 'true');
      await page.screenshot({ path: path.join(output, `login-light-${viewport.width}.png`), animations: 'disabled' });
      const username = page.getByRole('textbox', { name: '账号', exact: true });
      const password = page.getByLabel('密码', { exact: true });
      await username.fill('preview-account');
      await password.fill('preview-invalid-password');
      await page.getByRole('button', { name: '显示密码', exact: true }).click();
      assert.equal(await password.evaluate((element) => element.type), 'text');
      await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
      assert.equal(await password.evaluate((element) => element.type), 'password');
      await page.getByRole('checkbox', { name: '记住账号和密码' }).click();
      assert.equal(await page.getByRole('checkbox').getAttribute('aria-checked'), 'true');
      await password.press('Enter');
      await page.getByRole('alert').waitFor();
      assert.ok(requests.some((request) => request.pathname.endsWith('/token') && request.method === 'POST'));
      await page.getByRole('button', { name: /深色/ }).click();
      const color = await password.evaluate((element) => getComputedStyle(element).color);
      assert.equal(color, 'rgb(243, 245, 249)');
      await page.screenshot({ path: path.join(output, `login-dark-${viewport.width}.png`), animations: 'disabled' });
      await page.getByRole('tab', { name: '注册', exact: true }).click();
      assert.equal(await page.getByRole('alert').count(), 0, 'login errors must not carry into the registration form');
      await page.getByRole('textbox', { name: 'QQ 邮箱', exact: true }).fill('preview@example.invalid');
      const code = page.getByRole('textbox', { name: '邮箱验证码', exact: true });
      await code.fill('123456');
      assert.equal(await code.evaluate((element) => getComputedStyle(element).color), color);
      await page.getByRole('button', { name: '发送验证码', exact: true }).click();
      await page.getByText('验证码已发送，请查看 QQ 邮箱。', { exact: true }).waitFor();
      assert.ok(requests.some((request) => request.pathname.endsWith('/registration-code')));
      await page.screenshot({ path: path.join(output, `register-dark-${viewport.width}.png`), animations: 'disabled', fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false);
      const inputBoxes = await page.locator('input').evaluateAll((elements) => elements.map((element) => {
        const r = element.getBoundingClientRect(); return { x: r.x, width: r.width, height: r.height };
      }));
      assert.ok(inputBoxes.every((box) => box.height >= 44 && box.x >= 0 && box.x + box.width <= viewport.width));
      assert.deepEqual(errors, []);
      results.push({ viewport, disabledEmptyForm: true, passwordVisibility: true, rememberToggle: true,
        rejectedLogin: true, registrationCode: true, darkInputContrast: true, overflow, errors });
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ url: url.href,
      runtime: 'Edge headless / Expo Web dev / real LoginScreen / mocked auth HTTP responses / no account mutation', results }, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
