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
  for (let i = 0; i < 60; i++) {
    const rect = await page.evaluate(() => {
      const p = document.getElementById('debate-iframe-parent-loading-title');
      const pVisible = p && p.offsetParent !== null;
      const modal = document.getElementById('debate-iframe-modal');
      const frame = document.getElementById('debate-iframe-modal-frame');
      let innerTitle = null;
      try {
        const doc = frame && frame.contentDocument;
        const el = doc && doc.getElementById('page-arrival-loading-title');
        if (el) innerTitle = { top: Math.round(el.getBoundingClientRect().top), classes: doc.getElementById('page-arrival-loading-overlay')?.className };
      } catch (e) { innerTitle = { error: String(e) }; }
      return {
        t: Date.now(),
        parentVisible: pVisible,
        parentTop: pVisible ? Math.round(p.getBoundingClientRect().top) : null,
        modalLoading: modal && modal.classList.contains('loading'),
        modalClasses: modal && modal.className,
        innerTitle
      };
    });
    console.log(i, JSON.stringify(rect));
    await new Promise(r => setTimeout(r, 150));
  }
  await browser.close();
})();
