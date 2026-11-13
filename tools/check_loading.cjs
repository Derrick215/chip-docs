// Exercise a stalled PDF download, timeout, cancellation and successful retry.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.clock.install();
    let block = true;
    const requests = [];
    await page.route('**/DS/*.pdf', route => {
      requests.push(route.request());
      if (!block) return route.continue();
      // Leave this request pending until PDF.js destroys its loading task.
    });
    await page.goto('http://localhost:8000');
    await page.locator('#document-type').selectOption('DS');
    const stalledRequest = page.waitForRequest('**/DS/*.pdf');
    await page.locator('.card-action').first().click();
    await page.waitForFunction(() => document.getElementById('reader-status').textContent.includes('初始化'));
    await stalledRequest;
    await page.clock.fastForward(13000);
    assert.ok((await page.locator('#reader-status').textContent()).includes('加载较慢'));
    await page.clock.fastForward(90000);
    await page.getByRole('button', { name: '重新加载', exact: true }).waitFor();
    assert.ok((await page.locator('#reader-status').textContent()).includes('超时'));
    assert.equal(await page.locator('.spinner').count(), 0);
    block = false;
    await page.clock.resume();
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.locator('.pdf-page[data-page="1"].is-rendered').waitFor({ timeout: 30000 });
    assert.equal(await page.locator('#reader-status').isVisible(), false);
    assert.ok(requests.length >= 2);
    // PDF.js 4.10 may report its worker termination when cancelling an in-flight
    // fetch. Keep all unrelated browser errors fatal, and verify retry succeeds.
    assert.deepEqual(errors.filter(error => !/^Error: Worker was terminated\n.*ensureNotTerminated/s.test(error)), []);
    console.log('PASS: slow-load hint, timeout stops spinner, retry opens PDF; no unrelated browser errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
