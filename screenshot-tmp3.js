const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3001/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));
  await page.evaluate(() => {
    const el = document.querySelector('.theme-row-section--a-la-une');
    const r = el.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.top - 20);
  });
  await new Promise(r => setTimeout(r, 1000));
  // click next hint repeatedly
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => {
      const btn = document.querySelector('.theme-row-section--a-la-une .theme-carousel-next-hint');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'screenshot-alaune-end.png' });

  const data = await page.evaluate(() => {
    function info(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { sel, left: r.left, right: r.right, width: r.width };
    }
    return {
      innerWidth: window.innerWidth,
      results: [
        info('.theme-row-section--a-la-une'),
        info('.theme-row-section--a-la-une .theme-horizontal-row'),
        info('.theme-row-section--a-la-une .theme-horizontal-inner'),
      ]
    };
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
