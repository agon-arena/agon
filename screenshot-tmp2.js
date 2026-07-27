const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3001/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));
  const sel = await page.evaluate(() => {
    const el = document.querySelector('.theme-row-section--a-la-une');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.top - 20);
    return true;
  });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'screenshot-alaune.png' });
  await browser.close();
})();
