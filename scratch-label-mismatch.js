const puppeteer = require("puppeteer");
(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto("http://localhost:3001/mon-univers?demo=1", { waitUntil: "networkidle0", timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));

  const box = await page.$eval(".universe-zoom-viewport", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.evaluate(() => document.querySelector('.universe-zoom-bubble[data-kind="galaxy"]').click());
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => document.querySelector('.universe-zoom-bubble[data-kind="solarSystem"]').click());
  await new Promise((r) => setTimeout(r, 600));
  await page.mouse.move(box.x, box.y);
  for (let i = 0; i < 12; i += 1) { await page.mouse.wheel({ deltaY: -100 }); await new Promise((r) => setTimeout(r, 16)); }
  await new Promise((r) => setTimeout(r, 500));

  const info = await page.evaluate(() => {
    const stars = [...document.querySelectorAll('.universe-zoom-bubble[data-kind="star"].is-revealed')];
    return stars.map((el) => {
      const bubbleRect = el.getBoundingClientRect();
      const nodeId = el.dataset.nodeId;
      // Retrouve le label correspondant via la Map interne n'est pas exposée : on cherche par
      // texte (aria-label contient le nom) parmi les labels révélés.
      const name = el.getAttribute("aria-label").replace(/^Voir la liste de \d+ articles? sous /, "");
      const labels = [...document.querySelectorAll(".universe-zoom-bubble-label.is-revealed")];
      const matchingLabel = labels.find((l) => l.textContent === name);
      const labelRect = matchingLabel ? matchingLabel.getBoundingClientRect() : null;
      return {
        name,
        bubble: { x: bubbleRect.x + bubbleRect.width / 2, y: bubbleRect.y + bubbleRect.height / 2 },
        label: labelRect ? { x: labelRect.x + labelRect.width / 2, y: labelRect.y + labelRect.height / 2 } : null
      };
    });
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
