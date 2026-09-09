const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 900 });
  await page.goto('http://localhost:3001/meilleures-idees', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  // Open the first outer accordion, then the first nested one
  await page.evaluate(() => {
    const outer = document.querySelectorAll('.contributions-accordion')[0];
    outer.open = true;
  });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: 'nested-outer-open.png' });
  await page.evaluate(() => {
    const nested = document.querySelectorAll('.contributions-accordion-nested')[0];
    nested.open = true;
  });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: 'nested-both-open.png' });
  await browser.close();
})();
