const puppeteer = require("puppeteer");
(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.goto("http://localhost:3001/mon-univers?demo=1", { waitUntil: "networkidle0", timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    [...document.querySelectorAll('.universe-zoom-bubble[data-kind="galaxy"]')]
      .find((b) => b.textContent.includes("Sciences")).click();
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => {
    [...document.querySelectorAll('.universe-zoom-bubble[data-kind="solarSystem"].is-revealed')]
      .find((b) => b.textContent.includes("Espace et technologies spatiales")).click();
  });
  await new Promise((r) => setTimeout(r, 900));

  const cam = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--universe-cam-scale"));
  console.log("cam scale at solarSystem focus:", cam);

  await page.screenshot({ path: "/tmp/final-1-system.png" });

  // Essaie de zoomer encore (molette) pour vérifier le plafond.
  const viewportBox = await page.$eval(".universe-zoom-viewport", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(viewportBox.x, viewportBox.y);
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.wheel({ deltaY: -150 });
    await new Promise((r) => setTimeout(r, 16));
  }
  await new Promise((r) => setTimeout(r, 400));
  const camAfterScroll = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--universe-cam-scale"));
  console.log("cam scale after extra scroll (plafond ?):", camAfterScroll);
  await page.screenshot({ path: "/tmp/final-2-maxzoom.png" });

  await browser.close();
})();
