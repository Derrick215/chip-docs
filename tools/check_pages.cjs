// Check the built site under a repository-style URL prefix.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(process.env.PAGES_PREVIEW_URL || 'http://localhost:8000/.preview/pages-ready/');
    assert.equal(await page.locator('.document-card').count(), 16);
    for (const type of ['DS', 'RM']) {
      await page.locator('#document-type').selectOption(type);
      assert.equal(await page.locator('.document-card').count(), 8);
      await page.locator('.card-action').first().click();
      await page.locator('.pdf-page[data-page="1"].is-rendered').waitFor({ timeout: 60000 });
      assert.ok(await page.locator('#reader-original').getAttribute('href').then((url) => url.startsWith(type + '/')));
      await page.locator('#reader-close').click();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: Pages artifact works under a repository subdirectory; DS/RM PDFs and bundled worker load successfully.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
