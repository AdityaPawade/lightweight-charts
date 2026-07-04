import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://picloud:8088/';
const OUT = process.argv[3] || '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const R = { url: URL, errors: [], csp: [] };
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error') R.errors.push(t.slice(0, 200)); if (/content security policy/i.test(t)) R.csp.push(t.slice(0, 160)); });
  p.on('pageerror', (e) => R.errors.push('pageerror: ' + String(e.message || e)));
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(4500);

  const info = await p.evaluate(() => {
    const flat = document.body.innerText.replace(/\s+/g, ' ').toLowerCase();
    const has = (s) => flat.includes(s.toLowerCase());
    // Regime exposure % and the broad-market tile trend, to verify they're CONSISTENT.
    const expM = flat.match(/(\d{1,3})% equity/);
    const exposurePct = expM ? parseInt(expM[1], 10) : null;
    const broadTrend = (/broad market (uptrend|downtrend)/.exec(flat) || [])[1] || null;
    // A downtrend must cap exposure low (<=45). This is the whole fix.
    const consistencyOk = broadTrend === 'downtrend' ? (exposurePct !== null && exposurePct <= 45) : true;
    return {
      hasRegimeVerdict: has('market regime'),
      hasBroadMarketTile: has('broad market'),
      hasBroadChart: has('broad market · nifty 500'),
      headlineStillNifty50: has('headline index'),     // should be FALSE now
      hasPeriodSelect: !!document.querySelector('select[aria-label="Chart period"]'),
      hasDrivers: has("what's driving the call"),
      hasEtfLeaders: has('etf leaders'),
      exposurePct,
      broadTrend,
      consistencyOk,
      canvases: document.querySelectorAll('canvas').length,
      bodyLen: document.body.innerText.length
    };
  });
  R.checks = info;
  await p.screenshot({ path: OUT + '/overview_full.png', fullPage: true });
  await p.screenshot({ path: OUT + '/overview_viewport.png' });
  console.log(JSON.stringify(R, null, 2));
} catch (e) {
  R.fatal = String(e.message || e); console.log(JSON.stringify(R, null, 2));
} finally { await b.close(); }
