import puppeteer from 'puppeteer';
const url = process.argv[2], out = process.argv[3], waitMs = Number(process.argv[4] || 3500);
const actions = process.argv[5] ? JSON.parse(process.argv[5]) : [];
const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 820, deviceScaleFactor: 1 });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message || e)));
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, waitMs));
  for (const a of actions) {
    if (a[0] === 'clicksel') { try { const box = await p.$eval(a[1], (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }); await p.mouse.click(box.x, box.y); } catch (e) { errs.push('clicksel ' + a[1] + ': ' + e.message); } }
    else if (a[0] === 'wait') await new Promise((r) => setTimeout(r, a[1]));
  }
  await p.screenshot({ path: out });
  console.log(JSON.stringify({ ok: true, out, errors: errs.slice(0, 20) }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e.message || e) }));
} finally { await b.close(); }
