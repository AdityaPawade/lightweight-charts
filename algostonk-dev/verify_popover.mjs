import puppeteer from 'puppeteer';
const URL = process.argv[2];
const OUT = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const R = { steps: [], errors: [] };
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  p.on('console', (m) => { if (m.type() === 'error') R.errors.push('console: ' + m.text()); });
  p.on('pageerror', (e) => R.errors.push('pageerror: ' + String(e.message || e)));
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(6500); // chart + two-phase bars

  const info = await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    const main = cs[0]?.getBoundingClientRect();
    const tvLogo = [...document.querySelectorAll('a')].filter((a) => /tradingview/i.test(a.href || '') || /tradingview/i.test(a.id || '')).length;
    const legend = /O\s.*H\s.*L\s.*C/.test(document.body.innerText);
    return { canvases: cs.length, main: main ? { x: main.x, y: main.y, w: main.width, h: main.height } : null, tvLogo, legend };
  });
  R.steps.push({ load: info });
  await p.screenshot({ path: OUT + '/01_loaded.png' });

  // scroll the drawing rail (and thus the chart) into view, list the rail tools
  const rail = await p.evaluate(() => {
    const magnet = [...document.querySelectorAll('button[title]')].find((b) => /magnet/i.test(b.title));
    const el = magnet?.parentElement;
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    return { titles: [...el.querySelectorAll('button[title]')].map((b) => b.title) };
  });
  R.steps.push({ railTitles: rail?.titles });
  await sleep(600);
  const rb = await p.evaluate(() => {
    const magnet = [...document.querySelectorAll('button[title]')].find((b) => /magnet/i.test(b.title));
    const r = magnet?.parentElement?.getBoundingClientRect();
    return r ? { right: r.right, top: r.top, h: r.height } : null;
  });
  if (!rb) { R.errors.push('no drawing rail'); console.log(JSON.stringify(R, null, 2)); await b.close(); process.exit(0); }

  // pick a straight-line tool (skip Cursor) and draw a diagonal in the chart area to the rail's right
  const tool = await p.evaluate(() => {
    const magnet = [...document.querySelectorAll('button[title]')].find((b) => /magnet/i.test(b.title));
    const btns = [...magnet.parentElement.querySelectorAll('button[title]')];
    const line = btns.find((b) => /trend|line|ray/i.test(b.title) && !/cursor/i.test(b.title)) || btns[1];
    if (line) { line.click(); return { ok: true, title: line.title }; }
    return { ok: false };
  });
  R.steps.push({ toolClick: tool });
  await sleep(350);
  // the Lines group opens a flyout — pick its first item (trend line), which sets the tool and closes the flyout
  const picked = await p.evaluate(() => {
    const fly = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && /min-w-\[214px\]/.test(d.className));
    const item = fly?.querySelector('button');
    if (item) { item.click(); return { ok: true, label: item.textContent.trim().slice(0, 24) }; }
    return { ok: false };
  });
  R.steps.push({ flyoutPick: picked });
  await sleep(350);

  const x1 = rb.right + 260, y1 = rb.top + 90, x2 = rb.right + 640, y2 = rb.top + 250;
  // trend line is a click-click tool (only brush/highlighter are press-drag): click A, then click B
  await p.mouse.click(x1, y1); await sleep(250);
  await p.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 6 }); await sleep(150);
  await p.mouse.click(x2, y2); await sleep(900);

  let hasPop = await p.evaluate(() => !!document.querySelector('button[title="Colour"]'));
  if (!hasPop) { await p.mouse.click((x1 + x2) / 2, (y1 + y2) / 2); await sleep(600); hasPop = await p.evaluate(() => !!document.querySelector('button[title="Colour"]')); }
  R.steps.push({ hasPopover: hasPop, hasDragHandle: await p.evaluate(() => !!document.querySelector('span[title="Drag to move"]')) });
  await p.screenshot({ path: OUT + '/02_popover_collapsed.png' });

  if (hasPop) {
    await p.evaluate(() => document.querySelector('button[title="Colour"]').click()); await sleep(350);
    const swatches = await p.evaluate(() => document.querySelectorAll('div[class*="shadow-lg"] button[style*="background"]').length);
    R.steps.push({ paletteSwatches: swatches });
    await p.screenshot({ path: OUT + '/03_color_expanded.png' });

    await p.evaluate(() => document.querySelector('button[title="Colour"]').click()); await sleep(150);
    await p.evaluate(() => document.querySelector('button[title="Line width"]').click()); await sleep(350);
    const widths = await p.evaluate(() => [...document.querySelectorAll('div[class*="shadow-lg"] button')].map((b) => b.textContent.trim()).filter((t) => /px$/.test(t)));
    R.steps.push({ widthOptions: widths });
    await p.screenshot({ path: OUT + '/04_width_dropdown.png' });
    await p.evaluate(() => document.querySelector('button[title="Line width"]').click()); await sleep(150);

    const h = await p.evaluate(() => { const e = document.querySelector('span[title="Drag to move"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const before = await p.evaluate(() => { const e = document.querySelector('span[title="Drag to move"]')?.closest('div'); const r = e?.getBoundingClientRect(); return r ? { x: r.x, y: r.y } : null; });
    if (h) {
      await p.mouse.move(h.x, h.y); await p.mouse.down(); await sleep(90);
      await p.mouse.move(h.x + 230, h.y + 130, { steps: 14 }); await sleep(90); await p.mouse.up(); await sleep(400);
      const after = await p.evaluate(() => { const e = document.querySelector('span[title="Drag to move"]')?.closest('div'); const r = e?.getBoundingClientRect(); return r ? { x: r.x, y: r.y } : null; });
      R.steps.push({ dragMovedBy: before && after ? { dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y) } : null });
      await p.screenshot({ path: OUT + '/05_dragged.png' });
    }
  }
  console.log(JSON.stringify(R, null, 2));
} catch (e) {
  R.fatal = String(e.message || e); console.log(JSON.stringify(R, null, 2));
} finally { await b.close(); }
