const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto('http://localhost:3001/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.home-bottom-nav-item, .home-bottom-nav a'));
    const target = items.find(el => /apprentissage/i.test(el.getAttribute('aria-label') || el.textContent || ''));
    if (target) target.click();
  });
  // Wait until just before the 2.5s reveal delay window, then sample densely
  await new Promise(r => setTimeout(r, 3300));
  for (let i = 0; i < 20; i++) {
    const rect = await page.evaluate(() => {
      const el = document.querySelector('#page-arrival-loading-title, #debate-iframe-parent-loading-title');
      if (!el || el.offsetParent === null) return null;
      const r = el.getBoundingClientRect();
      return { id: el.id, top: Math.round(r.top), text: el.textContent };
    });
    console.log(i, JSON.stringify(rect));
    await page.screenshot({ path: `t2-${String(i).padStart(2,'0')}.png` });
    await new Promise(r => setTimeout(r, 150));
  }
  await browser.close();
})();
