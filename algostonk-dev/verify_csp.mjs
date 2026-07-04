import puppeteer from 'puppeteer';
// Visits the chart-heavy routes on the no-auth :8088 view and reports CSP violations / console errors / render health.
const BASE = process.argv[2] || 'http://picloud:8088';
const OUT = process.argv[3] || '.';
const ROUTES = ['/', '/instrument/RELIANCE', '/charts', '/sectors', '/etfs'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const R = {};
try {
  for (const route of ROUTES) {
    const p = await b.newPage();
    await p.setViewport({ width: 1440, height: 900 });
    const rec = { errors: [], csp: [], canvases: 0 };
    p.on('console', (m) => { const t = m.text(); if (m.type() === 'error') rec.errors.push(t.slice(0, 200)); if (/content security policy/i.test(t)) rec.csp.push(t.slice(0, 200)); });
    p.on('pageerror', (e) => rec.errors.push('pageerror: ' + String(e.message || e).slice(0, 200)));
    try {
      await p.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 40000 });
      await sleep(4000);
      rec.canvases = await p.evaluate(() => document.querySelectorAll('canvas').length);
      await p.screenshot({ path: `${OUT}/csp_${route.replace(/[^a-z0-9]/gi, '_') || 'root'}.png` });
    } catch (e) { rec.fatal = String(e.message || e); }
    R[route] = rec;
    await p.close();
  }
  console.log(JSON.stringify(R, null, 2));
} catch (e) {
  console.log(JSON.stringify({ fatal: String(e.message || e), partial: R }, null, 2));
} finally { await b.close(); }
