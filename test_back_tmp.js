const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  await page.goto('http://localhost:3099/debates/850', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));

  const before = await page.evaluate(() => {
    const modal = document.getElementById('debate-iframe-modal');
    const closeBtn = document.getElementById('debate-iframe-modal-close');
    const style = closeBtn ? window.getComputedStyle(closeBtn) : null;
    return {
      url: location.href,
      modalOpen: modal ? modal.classList.contains('open') : null,
      modalClasses: modal ? modal.className : null,
      closeBtnExists: !!closeBtn,
      closeBtnDisplay: style ? style.display : null,
      closeBtnRect: closeBtn ? closeBtn.getBoundingClientRect() : null,
      agonModalOpenFlag: window.__agonDebateModalOpen,
    };
  });
  console.log('BEFORE CLICK:', JSON.stringify(before, null, 2));

  try {
    await page.click('#debate-iframe-modal-close');
    await new Promise(r => setTimeout(r, 1500));
  } catch (e) {
    console.log('CLICK ERROR:', e.message);
  }

  const after = await page.evaluate(() => {
    const modal = document.getElementById('debate-iframe-modal');
    return {
      url: location.href,
      modalOpen: modal ? modal.classList.contains('open') : null,
      modalClasses: modal ? modal.className : null,
      bodyClasses: document.body.className,
      agonModalOpenFlag: window.__agonDebateModalOpen,
    };
  });
  console.log('AFTER CLICK:', JSON.stringify(after, null, 2));

  await browser.close();
})();
