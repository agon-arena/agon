const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto('http://localhost:3001/mon-univers', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  const result = await page.evaluate(() => {
    const panel = document.getElementById('universe-star-panel');
    const list = document.getElementById('universe-star-panel-list');
    if (!panel || !list) return { error: 'panel/list not found' };
    panel.hidden = false;
    document.body.classList.add('universe-star-panel-open');
    // Inject a long fake fiche to see if the list can actually scroll
    list.innerHTML = '<li class="universe-star-panel__knowledge-sheet"><div class="universe-star-panel__knowledge-content">' +
      Array.from({length: 40}, (_, i) => `<p>Paragraphe de test numero ${i} pour verifier le scroll interne de la fiche dans le panneau etoile.</p>`).join('') +
      '</div></li>';
    const box = document.querySelector('.universe-star-panel__box');
    const boxCS = getComputedStyle(box);
    const listCS = getComputedStyle(list);
    const before = list.scrollTop;
    list.scrollTop = 500;
    const after = list.scrollTop;
    return {
      boxMaxHeight: boxCS.maxHeight,
      boxOverflow: boxCS.overflow,
      boxHeight: Math.round(box.getBoundingClientRect().height),
      listOverflowY: listCS.overflowY,
      listScrollHeight: list.scrollHeight,
      listClientHeight: list.clientHeight,
      scrollBefore: before,
      scrollAfterSetTo500: after,
      canScroll: after > before
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({ path: 'univers-scroll-test.png' });
  await browser.close();
})();
