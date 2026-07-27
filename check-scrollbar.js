const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3001/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  const data = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    htmlClientWidth: document.documentElement.clientWidth,
    bodyClientWidth: document.body.clientWidth,
    htmlOffsetWidth: document.documentElement.offsetWidth,
    scrollbarGutter: getComputedStyle(document.documentElement).scrollbarGutter,
    overflowX: getComputedStyle(document.documentElement).overflowX,
    htmlClass: document.documentElement.className,
  }));
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
